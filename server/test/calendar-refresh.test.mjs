// The household calendar refresh engine (server/calendar-refresh.mjs) and what it replaced.
//
// Two halves. IN-PROCESS: the engine's own rules (single-flight, the one-minute floor,
// force, one household never touching another's calendars), the attribution of synced
// events, the cross-account merge-back bug, and the triggers inside the declared actions —
// all through the engine's test seam or a stubbed fetch, so nothing reaches Google.
// OVER HTTP (a real server in a child process): who may ask for a refresh, the old
// sync-all shape build-79 iOS still reads, and that each write route kicks a refresh after
// it succeeded and never after it failed. The child server can't be spied on directly, so
// it runs with HOMEOPS_CAL_REFRESH_MIN_MS=0 and every refresh leaves its reason in the
// subscription's lastResult.via — the route's own observable trace.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

const DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-calrefresh-"));
process.env.HOMEOPS_DATA_DIR = DATA_DIR;
process.env.HOMEOPS_SECRET_KEY = process.env.HOMEOPS_SECRET_KEY ?? "test-secret-key-test-secret-key-32";
delete process.env.HOMEOPS_CONNECTOR_SANDBOX;
delete process.env.HOMEOPS_CAL_REFRESH_MIN_MS;
process.on("exit", () => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const store = await import("../store.mjs");
const refresh = await import("../calendar-refresh.mjs");
const { syncSubscription, pullGoogleEdits } = await import("../calendar.mjs");
const { newEventRecord } = await import("../actions/schemas/event.mjs");
const { createEvent } = await import("../actions/events.mjs");
const { createTask } = await import("../actions/tasks.mjs");
const { familiUpdateEvent, familiDeleteEvent } = await import("../actions/native/events.mjs");
const { familiUpdateTask, familiDeleteTask } = await import("../actions/native/tasks.mjs");
const { startServer, stopServer, makeSession, writeStoreDoc, readStoreDoc } = await import("./harness.mjs");

const HH = "local";
const HH_B = "hh-other";
const day = (n, h = 10) => { const d = new Date(Date.now() + n * 864e5); d.setUTCHours(h, 0, 0, 0); return d; };
const icsStamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function ics(events) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0",
    ...events.flatMap((e) => ["BEGIN:VEVENT", `UID:${e.uid}`, `SUMMARY:${e.title}`, `DTSTART:${icsStamp(e.start)}`, `DTEND:${icsStamp(new Date(e.start.getTime() + 3600e3))}`, "END:VEVENT"]),
    "END:VCALENDAR"].join("\r\n");
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// Members of the in-process household, and a second household in its own tenant.
store.putMember({ actorId: "m-alex", householdId: HH, displayName: "Alex", role: "Owner" });
store.putMember({ actorId: "m-morgan", householdId: HH, displayName: "Morgan", role: "Adult Admin" });
store.putMember({ actorId: "m-noah", householdId: HH, displayName: "Noah", role: "Child View" });
store.runWithTenant(HH_B, () => store.putMember({ actorId: "b-owner", householdId: HH_B, displayName: "Bea", role: "Owner" }));

describe("the engine (in-process, through the seam)", () => {
  before(() => {
    refresh._resetRefreshForTests();
    store.putSubscription({ id: "sub_a1", householdId: HH, source: "url", name: "A1", url: "http://127.0.0.1:1/a1.ics", ownerActorId: "m-alex", createdBy: "m-alex" });
    store.putSubscription({ id: "sub_a2", householdId: HH, source: "url", name: "A2", url: "http://127.0.0.1:1/a2.ics", createdBy: "m-morgan" });
    store.putSubscription({ id: "sub_imp", householdId: HH, source: "import", name: "Pasted", icsText: "BEGIN:VCALENDAR\r\nEND:VCALENDAR", createdBy: "m-alex" });
    store.runWithTenant(HH_B, () => store.putSubscription({ id: "sub_b1", householdId: HH_B, source: "url", name: "B1", url: "http://127.0.0.1:1/b1.ics", createdBy: "b-owner" }));
  });
  after(() => refresh._resetRefreshForTests());

  function recordingSync(delayMs = 30) {
    const calls = [];
    refresh._setRefreshSyncForTests({
      sync: async ({ sub, session }) => {
        calls.push({ id: sub.id, hh: sub.householdId, tenant: store.currentTenant(), actorId: session.actorId, role: session.role });
        await tick(delayMs);
        return { ok: true, imported: 1, updated: 0, removed: 0, total: 1 };
      },
      pull: async () => ({ ok: true, checked: 0, merged: 0, conflicts: 0, unlinked: 0 }),
    });
    return calls;
  }

  test("single-flight: two concurrent refreshes of one household sync each calendar once", async () => {
    refresh._resetRefreshForTests();
    const calls = recordingSync();
    const [a, b] = await Promise.all([refresh.refreshHouseholdCalendars(HH), refresh.refreshHouseholdCalendars(HH, { reason: "other" })]);
    assert.deepEqual(calls.map((c) => c.id).sort(), ["sub_a1", "sub_a2"], "one sync per calendar, and the pasted import is not re-synced");
    assert.deepEqual(a, b, "the second caller shares the first caller's run");
    assert.equal(a.synced, 2); assert.equal(a.imported, 2);
    assert.deepEqual(Object.keys(a.pulled).sort(), ["checked", "conflicts", "merged", "unlinked"]);
    assert.equal(store.getSubscription("sub_a1").lastResult.via, "manual", "lastResult says how the sync came about");
    assert.equal(typeof store.getSubscription("sub_a1").lastSyncAt, "number");
  });

  test("each calendar syncs AS ITS OWNER, whoever asked", async () => {
    refresh._resetRefreshForTests();
    const calls = recordingSync(0);
    await refresh.refreshHouseholdCalendars(HH, { reason: "app-open" });
    const byId = Object.fromEntries(calls.map((c) => [c.id, c]));
    assert.equal(byId.sub_a1.actorId, "m-alex"); assert.equal(byId.sub_a1.role, "Owner");
    assert.equal(byId.sub_a2.actorId, "m-morgan", "no assigned member → whoever added it"); assert.equal(byId.sub_a2.role, "Adult Admin");
  });

  test("the one-minute floor skips a second refresh; force does not", async () => {
    refresh._resetRefreshForTests();
    const calls = recordingSync(0);
    const first = await refresh.refreshHouseholdCalendars(HH);
    assert.equal(first.synced, 2);
    const again = await refresh.refreshHouseholdCalendars(HH);
    assert.equal(again.ok, true); assert.equal(again.skipped, "recent"); assert.equal(typeof again.at, "number");
    assert.equal(calls.length, 2, "the floor never touched a calendar");
    const forced = await refresh.refreshHouseholdCalendars(HH, { force: true });
    assert.equal(forced.synced, 2); assert.equal(calls.length, 4);
    assert.equal(refresh.REFRESH_MIN_MS, 60_000);
  });

  test("one failing calendar never stops the rest, and a failure is audited", async () => {
    refresh._resetRefreshForTests();
    const seen = [];
    refresh._setRefreshSyncForTests({
      sync: async ({ sub }) => { seen.push(sub.id); if (sub.id === "sub_a1") throw new Error("boom"); return { ok: false, error: "fetch_failed" }; },
      pull: async () => { throw new Error("no google"); },
    });
    const r = await refresh.refreshHouseholdCalendars(HH, { reason: "test-fail" });
    assert.deepEqual(seen.sort(), ["sub_a1", "sub_a2"]);
    assert.equal(r.ok, true); assert.equal(r.synced, 0);
    assert.deepEqual(r.errors.map((e) => e.id).sort(), ["sub_a1", "sub_a2"]);
    assert.equal(store.getSubscription("sub_a2").lastResult.error, "fetch_failed");
    const audit = store.readAudit(20).find((a) => a.type === "calendar.refresh" && a.reason === "test-fail");
    assert.ok(audit, "a failed refresh is audited"); assert.equal(audit.householdId, HH);
  });

  test("a refresh that changed nothing leaves no audit line", async () => {
    refresh._resetRefreshForTests();
    refresh._setRefreshSyncForTests({
      sync: async () => ({ ok: true, imported: 0, updated: 0, removed: 0, total: 0 }),
      pull: async () => ({ ok: true, checked: 0, merged: 0, conflicts: 0, unlinked: 0 }),
    });
    await refresh.refreshHouseholdCalendars(HH, { reason: "quiet-one" });
    assert.equal(store.readAudit(50).some((a) => a.reason === "quiet-one"), false);
  });

  test("a refresh in one household never syncs another's calendars, and runs in its own tenant", async () => {
    refresh._resetRefreshForTests();
    const calls = recordingSync(0);
    await refresh.refreshHouseholdCalendars(HH);
    assert.ok(calls.length > 0);
    assert.ok(calls.every((c) => c.hh === HH && c.tenant === HH), JSON.stringify(calls));
    calls.length = 0;
    // Started from INSIDE household A's context — the engine still switches to B's tenant.
    await store.runWithTenant(HH, () => refresh.refreshHouseholdCalendars(HH_B));
    assert.deepEqual(calls.map((c) => [c.id, c.tenant, c.actorId]), [["sub_b1", HH_B, "b-owner"]]);
  });

  test("awaitCalendarRefresh answers pending when the refresh outlasts the wait", async () => {
    refresh._resetRefreshForTests();
    recordingSync(200);
    const r = await refresh.awaitCalendarRefresh(HH, { reason: "slow", waitMs: 20 });
    assert.deepEqual(r, { ok: true, pending: true });
    const done = await refresh.refreshHouseholdCalendars(HH); // joins the one still running
    assert.equal(done.synced, 2);
  });

  test("kickCalendarRefresh never throws and never runs synchronously", async () => {
    refresh._resetRefreshForTests();
    const calls = recordingSync(0);
    refresh.kickCalendarRefresh(HH, "kick");
    assert.equal(calls.length, 0, "nothing ran before the caller's response could go out");
    for (let i = 0; i < 50 && calls.length < 2; i++) await tick(10);
    assert.equal(calls.length, 2);
  });
});

describe("synced events are the calendar owner's, not the trigger's", () => {
  test("a sync run with a Child View session stamps createdBy = the calendar's owner", async () => {
    const assigned = store.putSubscription({ id: "sub_attr1", householdId: HH, source: "url", name: "Work", icsText: ics([{ uid: "attr-1", title: "Board meeting", start: day(2) }]), ownerActorId: "m-alex", createdBy: "m-morgan" });
    const unassigned = store.putSubscription({ id: "sub_attr2", householdId: HH, source: "url", name: "Club", icsText: ics([{ uid: "attr-2", title: "Club night", start: day(3) }]), createdBy: "m-morgan" });
    const child = { householdId: HH, actorId: "m-noah", role: "Child View" };
    assert.equal((await syncSubscription({ sub: assigned, session: child })).imported, 1);
    assert.equal((await syncSubscription({ sub: unassigned, session: child })).imported, 1);
    const one = store.listEvents((e) => e.provenance?.uid === "attr-1")[0];
    const two = store.listEvents((e) => e.provenance?.uid === "attr-2")[0];
    assert.equal(one.createdBy, "m-alex", "the assigned member");
    assert.equal(two.createdBy, "m-morgan", "no assigned member → whoever added the calendar");
    assert.notEqual(one.createdBy, "m-noah");
  });
});

/* ---- The cross-account unlink bug ----
 * A stubbed Google: each bearer token sees only the events in ITS calendar and answers 404
 * for anything else — exactly what the real API does. The old pull fetched every pushed
 * event with the caller's account, got 404s for everyone else's and unlinked them. */
describe("pullGoogleEdits checks each event with the account it lives in", () => {
  const CAL = { "tok-alex": new Set(["g-alex"]), "tok-morgan": new Set(["g-morgan", "g-morgan-legacy"]) };
  let realFetch; const asked = [];
  const ids = {};
  before(() => {
    realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const token = String(init.headers?.authorization ?? "").replace(/^Bearer /, "");
      const gid = decodeURIComponent(String(url).split("/events/")[1] ?? "");
      asked.push({ gid, token });
      const ev = Object.values(ids).map((id) => store.getEvent(id)).find((e) => e?.provenance?.googleEventId === gid);
      if (!CAL[token]?.has(gid) || !ev) return new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
      // Google's copy agrees with ours — nothing to merge.
      return new Response(JSON.stringify({ id: gid, status: "confirmed", summary: ev.title, location: ev.location ?? "", description: ev.notes ?? "", start: { dateTime: ev.startAt }, end: { dateTime: ev.endAt }, updated: new Date(0).toISOString() }), { status: 200 });
    };
    const acct = (id, actorId, status = "connected") => {
      store.putAccount({ id, provider: "google", householdId: HH, connectedByActorId: actorId, displayName: `${actorId}@example.com`, scopes: ["https://www.googleapis.com/auth/calendar"], status });
    };
    acct("acc-alex", "m-alex"); acct("acc-morgan", "m-morgan"); acct("acc-gone", "m-alex", "revoked");
    store.setAccountTokens("acc-alex", { access: "tok-alex" });
    store.setAccountTokens("acc-morgan", { access: "tok-morgan" });
    store.setAccountTokens("acc-gone", { access: "tok-alex" });
    const pushed = (key, owner, gid, accountId) => {
      const start = day(5 + Object.keys(ids).length);
      const ev = store.putEvent(newEventRecord({ title: `Pushed ${key}`, startAt: start.toISOString(), endAt: new Date(start.getTime() + 3600e3).toISOString(), ownerId: owner, provenance: { via: "user" } }, { householdId: HH, actorId: owner }));
      store.patchEvent(ev.id, { provenance: { via: "user", googleEventId: gid, ...(accountId ? { googleAccountId: accountId } : {}), pushedAt: Date.now() } });
      ids[key] = ev.id;
    };
    pushed("alex", "m-alex", "g-alex", "acc-alex");
    pushed("morgan", "m-morgan", "g-morgan", "acc-morgan");
    pushed("legacy", "m-morgan", "g-morgan-legacy", null);           // pushed before the account was recorded
    pushed("orphan", "m-noah", "g-orphan", null);                    // nobody's account can reach it
    pushed("revoked", "m-alex", "g-alex", "acc-gone");               // its account was disconnected
  });
  after(() => { globalThis.fetch = realFetch; });

  test("household-wide: nothing is unlinked because another member ran it; unreachable events are skipped", async () => {
    asked.length = 0;
    const r = await pullGoogleEdits({ householdId: HH });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.unlinked, 0, JSON.stringify(r));
    assert.equal(r.checked, 3); assert.equal(r.skipped, 2);
    for (const k of ["alex", "morgan", "legacy", "orphan", "revoked"]) assert.ok(store.getEvent(ids[k]).provenance.googleEventId, `${k} is still linked`);
    const tokenFor = Object.fromEntries(asked.map((a) => [a.gid, a.token]));
    assert.equal(tokenFor["g-morgan"], "tok-morgan"); assert.equal(tokenFor["g-morgan-legacy"], "tok-morgan", "a legacy event uses its owner's account");
    assert.equal(asked.some((a) => a.gid === "g-orphan"), false, "never borrow another member's account");
  });

  test("with actorId: only that member's own events, and no_account for a member without Google", async () => {
    asked.length = 0;
    const mine = await pullGoogleEdits({ householdId: HH, actorId: "m-alex" });
    assert.equal(mine.ok, true); assert.equal(mine.checked, 1); assert.equal(mine.unlinked, 0);
    assert.deepEqual(asked.map((a) => a.gid), ["g-alex"]);
    const none = await pullGoogleEdits({ householdId: HH, actorId: "m-noah" });
    assert.deepEqual(none, { ok: false, error: "no_account" });
  });

  test("an event really deleted on Google (by its own account) still unlinks", async () => {
    CAL["tok-alex"].delete("g-alex");
    try {
      const r = await pullGoogleEdits({ householdId: HH });
      assert.equal(r.unlinked, 1);
      assert.equal(store.getEvent(ids.alex).provenance.googleEventId, null);
      assert.ok(store.getEvent(ids.morgan).provenance.googleEventId, "Morgan's event is untouched");
    } finally { CAL["tok-alex"].add("g-alex"); }
  });
});

describe("the declared actions kick a refresh after a successful write only", () => {
  const kicks = [];
  before(() => {
    refresh._resetRefreshForTests();
    refresh._setRefreshSyncForTests({
      sync: async () => ({ ok: true, imported: 0, updated: 0, removed: 0, total: 0 }),
      pull: async () => ({ ok: true, checked: 0, merged: 0, conflicts: 0, unlinked: 0 }),
      kick: (hh, reason) => kicks.push([hh, reason]),
    });
  });
  after(() => refresh._resetRefreshForTests());
  const app = { householdId: HH, actorId: "m-alex", role: "Owner", via: "user" };
  const chat = { session: { householdId: HH, actorId: "m-alex", role: "Owner" }, channel: "personal" };

  test("event create (the route and the tool share the run)", async () => {
    kicks.length = 0;
    const bad = await createEvent.run(app, { title: "  " });
    assert.equal(bad.ok, false); assert.deepEqual(kicks, [], "a refused write kicks nothing");
    const ok = await createEvent.run(app, { title: "Swim", startAt: day(4).toISOString() });
    assert.equal(ok.ok, true); assert.deepEqual(kicks, [[HH, "event.create"]]);
    const agent = await createEvent.run({ ...app, via: "agent" }, { title: "Drafted", startAt: day(4).toISOString() });
    assert.equal(agent.ok, true); assert.equal(kicks.length, 2);
  });

  test("task create", async () => {
    kicks.length = 0;
    assert.equal((await createTask.run(app, { title: "" })).ok, false);
    assert.deepEqual(kicks, []);
    assert.equal((await createTask.run(app, { title: "Bins out" })).ok, true);
    assert.deepEqual(kicks, [[HH, "task.create"]]);
  });

  test("the assistant's native event and task writes", async () => {
    const ev = (await createEvent.run(app, { title: "Recital", startAt: day(6).toISOString() })).result.event;
    const tk = (await createTask.run(app, { title: "Pack bag" })).result.task;
    kicks.length = 0;
    assert.equal((await familiUpdateEvent.run(chat, { eventId: "nope", title: "x" })).ok, false);
    assert.equal((await familiUpdateEvent.run({ ...chat, session: { ...chat.session, actorId: "m-noah", role: "Child View" } }, { eventId: ev.id, title: "x" })).ok, false);
    assert.deepEqual(kicks, [], "not found and read-only both kick nothing");
    assert.equal((await familiUpdateEvent.run(chat, { eventId: ev.id, title: "Recital (moved)" })).ok, true);
    assert.equal((await familiUpdateTask.run(chat, { taskId: tk.id, status: "done" })).ok, true);
    assert.equal((await familiDeleteTask.run(chat, { taskId: tk.id })).ok, true);
    assert.equal((await familiDeleteEvent.run(chat, { eventId: ev.id })).ok, true);
    assert.deepEqual(kicks.map(([, r]) => r), ["event.update", "task.update", "task.delete", "event.delete"]);
    assert.ok(kicks.every(([hh]) => hh === HH));
    kicks.length = 0;
    assert.equal((await familiDeleteTask.run(chat, { taskId: tk.id })).ok, false, "already gone");
    assert.deepEqual(kicks, []);
  });
});

/* ───────────────────────── over HTTP ───────────────────────── */
describe("routes (real server)", () => {
  let ctx, alex, noah, hh;
  const SUB = "sub_http";
  before(async () => {
    ctx = await startServer({ env: { HOMEOPS_CAL_REFRESH_MIN_MS: "0" } });
    alex = await makeSession(ctx, "m-alex");  // Owner
    noah = await makeSession(ctx, "m-noah");  // Child View
    hh = alex.raw?.session?.householdId ?? "local";
    // A feed that syncs without the network: pasted text on a url subscription (the sync
    // prefers the stored text), belonging to Alex and never assigned by hand.
    writeStoreDoc(ctx, "calendar_subscriptions.json", {
      [SUB]: { id: SUB, householdId: hh, source: "url", url: "http://127.0.0.1:1/feed.ics", name: "Alex's feed", createdBy: "m-alex", createdAt: Date.now(),
        icsText: ics([{ uid: "http-1", title: "Parents evening", start: day(2) }, { uid: "http-2", title: "Match", start: day(9) }]) },
    });
  });
  after(async () => { await stopServer(ctx); });

  const via = async () => (await alex.req("/api/calendar/subscriptions")).data.subscriptions.find((s) => s.id === SUB)?.lastResult?.via ?? null;
  async function waitForVia(reason) {
    for (let i = 0; i < 100; i++) { if ((await via()) === reason) return true; await tick(50); }
    assert.fail(`no refresh with reason ${reason} (last: ${await via()})`);
  }

  test("a Child View member may refresh the whole household — and the events stay the owner's", async () => {
    const r = await noah.req("/api/calendar/refresh", { method: "POST", body: JSON.stringify({ wait: true, reason: "app-open" }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.ok, true); assert.equal(r.data.synced, 1); assert.equal(r.data.imported, 2);
    const events = Object.values(readStoreDoc(ctx, "events.json", {}, hh)).filter((e) => e.provenance?.subscriptionId === SUB);
    assert.equal(events.length, 2);
    assert.ok(events.every((e) => e.createdBy === "m-alex"), JSON.stringify(events.map((e) => e.createdBy)));
    assert.equal(await via(), "app-open");
  });

  test("POST /api/calendar/refresh without wait answers at once; it still needs a session and CSRF", async () => {
    const r = await noah.req("/api/calendar/refresh", { method: "POST", body: "{}" });
    assert.equal(r.status, 200); assert.deepEqual(r.data, { ok: true, pending: true });
    const anon = await ctx.fetch("/api/calendar/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(anon.status, 401);
    const noCsrf = await ctx.fetch("/api/calendar/refresh", { method: "POST", headers: { "content-type": "application/json", Cookie: noah.cookie }, body: "{}" });
    assert.equal(noCsrf.status, 403);
  });

  test("sync-all (kept for old app builds) answers any member in its old shape", async () => {
    await waitForVia("manual"); // let the refresh the previous test kicked finish
    for (const who of [noah, alex]) {
      const r = await who.req("/api/calendar/sync-all", { method: "POST", body: "{}" });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.deepEqual(Object.keys(r.data).sort(), ["errors", "imported", "ok", "pulled", "removed", "synced", "updated"]);
      for (const k of ["synced", "imported", "updated", "removed"]) assert.equal(typeof r.data[k], "number", k);
      assert.deepEqual(Object.keys(r.data.pulled).sort(), ["checked", "conflicts", "merged", "unlinked"]);
      assert.ok(Array.isArray(r.data.errors));
    }
    assert.equal(await via(), "sync-all");
  });

  test("each write route kicks a refresh after it succeeded — and a failed write kicks nothing", async () => {
    await alex.req("/api/calendar/refresh", { method: "POST", body: JSON.stringify({ wait: true, reason: "baseline" }) });
    assert.equal(await via(), "baseline");

    const bad = await alex.req("/api/events", { method: "POST", body: JSON.stringify({ title: "" }) });
    assert.notEqual(bad.status, 200);
    await tick(300);
    assert.equal(await via(), "baseline", "a refused create kicks nothing");

    const ev = await alex.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Dentist", startAt: day(3).toISOString() }) });
    assert.equal(ev.status, 200, JSON.stringify(ev.data));
    await waitForVia("event.create");
    const eid = ev.data.event.id;

    assert.equal((await alex.req(`/api/events/${eid}`, { method: "PATCH", body: JSON.stringify({ title: "Dentist (moved)" }) })).status, 200);
    await waitForVia("event.update");
    const refused = await noah.req(`/api/events/${eid}`, { method: "PATCH", body: JSON.stringify({ title: "mine now" }) });
    assert.equal(refused.status, 403);
    await tick(300);
    assert.equal(await via(), "event.update", "a refused edit kicks nothing");

    const tk = await alex.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Book MOT", dueAt: day(5).toISOString() }) });
    assert.equal(tk.status, 200, JSON.stringify(tk.data));
    await waitForVia("task.create");
    const tid = tk.data.task.id;
    assert.equal((await alex.req(`/api/tasks/${tid}`, { method: "PATCH", body: JSON.stringify({ title: "Book the MOT" }) })).status, 200);
    await waitForVia("task.update");
    assert.equal((await alex.req(`/api/tasks/${tid}/to-calendar`, { method: "POST", body: "{}" })).status, 200);
    await waitForVia("task.to-calendar");
    assert.equal((await alex.req(`/api/tasks/${tid}`, { method: "DELETE" })).status, 200);
    await waitForVia("task.delete");

    const list = await alex.req("/api/task-lists", { method: "POST", body: JSON.stringify({ name: "Holiday packing" }) });
    assert.equal(list.status, 200, JSON.stringify(list.data));
    await waitForVia("tasklist.create");
    assert.equal((await alex.req(`/api/task-lists/${list.data.list.id}`, { method: "DELETE" })).status, 200);
    await waitForVia("tasklist.delete");

    const notYours = await noah.req(`/api/events/${eid}`, { method: "DELETE" });
    assert.equal(notYours.status, 403);
    await tick(300);
    assert.equal(await via(), "tasklist.delete", "a refused delete kicks nothing");
    assert.equal((await alex.req(`/api/events/${eid}`, { method: "DELETE" })).status, 200);
    await waitForVia("event.delete");
  });
});
