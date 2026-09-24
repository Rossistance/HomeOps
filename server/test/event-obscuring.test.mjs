// Hidden events and Work calendars on the app's own event API (ADR-005), through the real
// server. event-privacy.test.mjs pins the decisions in isolation; this pins that the doors
// actually ask: GET /api/events presents through presentEvents, the eye toggle is the owner's
// alone, create honours `hidden` only for an adult owner, every write route refuses a hidden
// event to anyone but its owner (the household Owner included), and a re-sync never undoes
// the owner's choice.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, readStoreRecord, writeStoreRecord } from "./harness.mjs";
import { validateInput } from "../actions/define-action.mjs";
import { EVENT_RECORD, newEventRecord } from "../actions/schemas/event.mjs";

// Casey's work calendar: 9–10 and 10–11 back to back (one merged block), 14–15 alone.
const WORK_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:budget@acme
SUMMARY:Quarterly budget review
LOCATION:Board room 4B
DTSTART:20261006T130000Z
DTEND:20261006T140000Z
END:VEVENT
BEGIN:VEVENT
UID:zephyr@acme
SUMMARY:Zephyr launch sync
LOCATION:Zoom bridge 77
DTSTART:20261006T140000Z
DTEND:20261006T150000Z
END:VEVENT
BEGIN:VEVENT
UID:oneonone@acme
SUMMARY:Performance chat with Pat
LOCATION:Cafe Lumen
DTSTART:20261006T180000Z
DTEND:20261006T190000Z
END:VEVENT
END:VCALENDAR`;
const SECRETS = ["Quarterly budget review", "Board room 4B", "Zephyr launch sync", "Zoom bridge 77", "Performance chat with Pat", "Cafe Lumen", "Acme Corp", "budget@acme", "zephyr@acme"];

let ctx, owner, admin, member, limited, child, subId, hh;
const byTitle = {};

const events = async (who) => {
  const r = await who.req("/api/events");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.events;
};
const blocksOf = (list, name) => list.filter((e) => e.block && e.title === name).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
const share = (who, id, hidden, extra = {}) => who.req("/api/events/sharing", { method: "POST", body: JSON.stringify({ id, hidden, ...extra }) });

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");     // Owner
  admin = await makeSession(ctx, "m-morgan");   // Adult Admin
  child = await makeSession(ctx, "m-noah");     // Child View
  const am = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Casey Quinn", role: "Adult Member" }) });
  const lm = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Riley Quinn", role: "Limited Member" }) });
  member = await makeSession(ctx, am.data.member.actorId);
  limited = await makeSession(ctx, lm.data.member.actorId);
  const imp = await member.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "Acme Corp", ics: WORK_ICS }) });
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  subId = imp.data.subscription.id;
  const work = await member.req(`/api/calendar/subscriptions/${subId}`, { method: "PATCH", body: JSON.stringify({ isWork: true }) });
  assert.equal(work.status, 200, JSON.stringify(work.data));
  assert.equal(work.data.subscription.isWork, true);
  for (const e of await events(member)) if (e.provenance?.subscriptionId === subId) byTitle[e.title] = e;
  assert.equal(Object.keys(byTitle).length, 3);
  hh = byTitle["Zephyr launch sync"].householdId;
});
after(async () => { await stopServer(ctx); });

test("a Work calendar's events reach everyone else as \"<Name> working\" blocks, merged, with nothing of the meetings", async () => {
  for (const who of [owner, admin, limited, child]) {
    const list = await events(who);
    const raw = JSON.stringify(list);
    for (const s of SECRETS) assert.ok(!raw.includes(s), `${who.actorId} must not see "${s}"`);
    assert.ok(!list.some((e) => e.provenance?.subscriptionId === subId), `${who.actorId}: no record from the calendar itself`);
    assert.ok(!list.some((e) => Object.values(byTitle).some((w) => w.id === e.id)), `${who.actorId}: no real event id`);
    const blocks = blocksOf(list, "Casey Quinn working");
    assert.equal(blocks.length, 2, `${who.actorId}: 9–11 merged, 14–15 alone`);
    assert.deepEqual(blocks.map((b) => b.block), [{ kind: "work", count: 2 }, { kind: "work", count: 1 }]);
    assert.equal(blocks[0].startAt, byTitle["Quarterly budget review"].startAt);
    assert.equal(Date.parse(blocks[0].endAt), Date.parse(byTitle["Zephyr launch sync"].endAt));
    for (const b of blocks) {
      assert.ok(b.id.startsWith("blk_"));
      assert.equal(b.editable, false); assert.equal(b.appendable, false); assert.equal(b.myNotes, null);
      assert.ok(!("staleSource" in b)); assert.ok(!("privacy" in b));
      assert.equal(b.location, ""); assert.equal(b.notes, ""); assert.deepEqual(b.participantIds, []);
    }
  }
});

test("the owner sees their own Work events in full, decorated with privacy", async () => {
  const mine = (await events(member)).filter((e) => e.provenance?.subscriptionId === subId);
  assert.equal(mine.length, 3);
  for (const e of mine) {
    assert.deepEqual(e.privacy, { obscured: true, kind: "work", secret: false, canToggle: true });
    assert.equal(e.appendable, true);
    assert.ok(!e.block);
  }
  assert.equal(blocksOf(await events(member), "Casey Quinn working").length, 0, "no block of your own time");
});

test("only the event's adult owner may use the eye: the household Owner is not_event_owner, a Limited Member cannot_hide", async () => {
  const id = byTitle["Zephyr launch sync"].id;
  for (const who of [owner, admin, limited, child]) {
    const r = await share(who, id, false);
    // Everyone here can SEE the record (household visibility) — they are just not its owner.
    assert.equal(r.status, 403, `${who.actorId}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.error, "not_event_owner");
  }
  assert.equal(readStoreRecord(ctx, "events", id).shareState, undefined, "nothing moved");

  const own = await limited.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Riley practice", startAt: "2026-10-07T20:00:00Z" }) });
  assert.equal(own.status, 200, JSON.stringify(own.data));
  const lmHide = await share(limited, own.data.event.id, true);
  assert.equal(lmHide.status, 403);
  assert.equal(lmHide.data.error, "cannot_hide");

  assert.equal((await share(member, "blk_0000000000000000", true)).status, 404, "a block is not an event");
  assert.equal((await share(member, "ev_nope", true)).status, 404);
  assert.equal((await share(member, id, "maybe")).status, 400, "hidden must be a boolean");
});

test("the owner shares one event: everyone sees it in full and the block splits; re-hiding merges it back", async () => {
  const id = byTitle["Zephyr launch sync"].id;
  const r = await share(member, id, false);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.event.id, id);
  assert.equal(r.data.event.shareState, "shared");
  assert.deepEqual(r.data.event.privacy, { obscured: false, secret: false, canToggle: true });
  assert.equal(readStoreRecord(ctx, "events", id).shareState, "shared");

  for (const who of [owner, admin, limited, child]) {
    const list = await events(who);
    const shown = list.find((e) => e.id === id);
    assert.ok(shown, `${who.actorId} sees the shared event`);
    assert.equal(shown.title, "Zephyr launch sync");
    assert.equal(shown.location, "Zoom bridge 77");
    assert.ok(!("privacy" in shown), "the privacy decoration is the owner's alone");
    const raw = JSON.stringify(list);
    for (const s of ["Quarterly budget review", "Performance chat with Pat", "Board room 4B"]) assert.ok(!raw.includes(s), `${who.actorId}: ${s}`);
    const blocks = blocksOf(list, "Casey Quinn working");
    assert.deepEqual(blocks.map((b) => b.block.count), [1, 1], `${who.actorId}: the 9–11 block is now 9–10`);
  }

  const back = await share(member, id, true);
  assert.equal(back.status, 200);
  assert.equal(back.data.event.shareState, "hidden");
  assert.equal(back.data.event.privacy.obscured, true);
  const list = await events(owner);
  assert.ok(!list.some((e) => e.id === id));
  assert.deepEqual(blocksOf(list, "Casey Quinn working").map((b) => b.block.count), [2, 1]);
});

test("secret: true and false are stored, null removes the switch", async () => {
  const id = byTitle["Quarterly budget review"].id;
  let r = await share(member, id, true, { secret: true });
  assert.equal(r.status, 200);
  assert.equal(readStoreRecord(ctx, "events", id).secret, true);
  assert.equal(r.data.event.privacy.secret, true);
  r = await share(member, id, true, { secret: false });
  assert.equal(readStoreRecord(ctx, "events", id).secret, false);
  r = await share(member, id, true, { secret: null });
  assert.equal(r.status, 200);
  assert.ok(!("secret" in readStoreRecord(ctx, "events", id)), "back to judging by the words");
  r = await share(member, id, true);
  assert.equal(readStoreRecord(ctx, "events", id).shareState, "hidden");
});

let morganHidden;
test("create with hidden:true: an adult owner's event is hidden (\"<Name> busy\"); a child's or someone else's is not", async () => {
  const r = await admin.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Therapy with Dr. Vale", location: "Vale Clinic", startAt: "2026-10-08T15:00:00Z", endAt: "2026-10-08T16:00:00Z", participantIds: ["m-alex"], hidden: true, secret: false }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  morganHidden = r.data.event;
  const stored = readStoreRecord(ctx, "events", morganHidden.id);
  assert.equal(stored.shareState, "hidden");
  assert.equal(stored.secret, false);

  for (const who of [owner, member, limited, child]) {
    const list = await events(who);
    const raw = JSON.stringify(list);
    assert.ok(!raw.includes("Dr. Vale") && !raw.includes("Vale Clinic"), `${who.actorId}: nothing of it — the household Owner, a participant, included`);
    const blocks = blocksOf(list, "Morgan Harper busy");
    assert.equal(blocks.length, 1, who.actorId);
    assert.deepEqual(blocks[0].block, { kind: "busy", count: 1 });
  }
  const mine = (await events(admin)).find((e) => e.id === morganHidden.id);
  assert.equal(mine.title, "Therapy with Dr. Vale");
  assert.deepEqual(mine.privacy, { obscured: true, kind: "busy", secret: false, canToggle: true });
  assert.equal(mine.editable, true);

  const kid = await child.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Noah secret fort", startAt: "2026-10-09T15:00:00Z", hidden: true, secret: true }) });
  if (kid.status === 200) {
    const rec = readStoreRecord(ctx, "events", kid.data.event.id);
    assert.ok(!("shareState" in rec) && !("secret" in rec), "a child cannot hide");
  } else {
    assert.equal(kid.status, 403, "a child may not create at all — then nothing can be hidden either");
  }
  const lm = await limited.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Riley band", startAt: "2026-10-09T18:00:00Z", hidden: true }) });
  assert.equal(lm.status, 200);
  assert.ok(!("shareState" in readStoreRecord(ctx, "events", lm.data.event.id)), "a Limited Member cannot hide");
  const forOther = await admin.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Casey's dentist", startAt: "2026-10-09T13:00:00Z", ownerId: member.actorId, hidden: true }) });
  assert.equal(forOther.status, 200);
  assert.ok(!("shareState" in readStoreRecord(ctx, "events", forOther.data.event.id)), "nobody hides an event that is not theirs");
  assert.ok((await events(owner)).some((e) => e.id === forOther.data.event.id && e.title === "Casey's dentist"));
});

test("every write route refuses a hidden event to anyone but its owner (the household Owner too), and nothing changes", async () => {
  const targets = [
    { ev: morganHidden, askers: [owner, member, limited, child] },
    { ev: byTitle["Performance chat with Pat"], askers: [owner, admin, limited] },
  ];
  for (const { ev, askers } of targets) {
    const before = readStoreRecord(ctx, "events", ev.id);
    for (const who of askers) {
      const calls = [
        ["PATCH", `/api/events/${ev.id}`, { title: "Mine now" }],
        ["PATCH", `/api/events/${ev.id}`, { localNotes: "what is this?", myBring: [{ item: "cake" }] }],
        ["POST", `/api/events/${ev.id}`, { title: "Mine now" }],
        ["DELETE", `/api/events/${ev.id}`, null],
        ["POST", `/api/events/${ev.id}/attendees`, { memberIds: [who.actorId] }],
        ["POST", `/api/events/${ev.id}/rsvp`, { status: "accepted" }],
        ["POST", `/api/events/${ev.id}/request-attend`, {}],
        ["POST", `/api/events/${ev.id}/offer-drive`, {}],
        ["POST", `/api/events/${ev.id}/suggest-bring`, { item: "cake" }],
        ["POST", `/api/events/${ev.id}/requests/respond`, { kind: "attend", actorId: who.actorId, accept: true }],
        ["POST", `/api/events/${ev.id}/resolve-conflict`, { choice: "local" }],
        ["POST", `/api/calendar/push/${ev.id}`, {}],
      ];
      for (const [method, path, body] of calls) {
        const r = await who.req(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
        // Routes that close earlier by role (a child may not push or resolve at all) keep
        // doing so; everything that reaches the event must say event_hidden.
        if (r.status === 403 && r.data?.error === "insufficient_role") continue;
        assert.equal(r.status, 403, `${who.actorId} ${method} ${path}: ${JSON.stringify(r.data)}`);
        assert.equal(r.data.error, "event_hidden", `${who.actorId} ${method} ${path}`);
        assert.ok(!r.data.message.includes(ev.title), "the refusal names whose it is, never what");
      }
    }
    assert.deepEqual(readStoreRecord(ctx, "events", ev.id), before, `${ev.id} is untouched`);
  }
  // Nobody kept a private margin on a meeting they cannot see.
  for (const who of [owner, member, limited]) {
    for (const e of await events(who)) if (e.block) assert.equal(e.myNotes, null);
  }
  // Block ids are not events: every route answers 404, as for any unknown id.
  const blk = blocksOf(await events(owner), "Morgan Harper busy")[0].id;
  assert.equal((await owner.req(`/api/events/${blk}`, { method: "PATCH", body: JSON.stringify({ title: "x" }) })).status, 404);
  assert.equal((await owner.req(`/api/events/${blk}`, { method: "DELETE" })).status, 404);
  assert.equal((await owner.req(`/api/events/${blk}/rsvp`, { method: "POST", body: JSON.stringify({ status: "accepted" }) })).status, 404);
  // The owner still works on their own hidden event.
  const mine = await admin.req(`/api/events/${morganHidden.id}`, { method: "PATCH", body: JSON.stringify({ notes: "bring the forms" }) });
  assert.equal(mine.status, 200, JSON.stringify(mine.data));
  assert.equal(readStoreRecord(ctx, "events", morganHidden.id).shareState, "hidden");
});

test("the generic PATCH cannot touch shareState or secret — the eye is the one door", async () => {
  const id = morganHidden.id;
  const r = await admin.req(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify({ shareState: "shared", secret: true, privacy: { obscured: false }, block: { kind: "busy", count: 1 }, title: "Therapy with Dr. Vale" }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rec = readStoreRecord(ctx, "events", id);
  assert.equal(rec.shareState, "hidden");
  assert.equal(rec.secret, false);
  assert.ok(!("privacy" in rec) && !("block" in rec), "per-viewer decorations are never stored");
});

test("re-syncing the calendar keeps the owner's choice; a folded duplicate hands its choice to the survivor", async () => {
  await share(member, byTitle["Zephyr launch sync"].id, false);
  const s = await member.req(`/api/calendar/subscriptions/${subId}/sync`, { method: "POST" });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(readStoreRecord(ctx, "events", byTitle["Zephyr launch sync"].id).shareState, "shared");
  assert.equal(readStoreRecord(ctx, "events", byTitle["Quarterly budget review"].id).shareState, "hidden");
  assert.equal(readStoreRecord(ctx, "events", byTitle["Performance chat with Pat"].id).shareState, undefined, "the calendar default still hides it");
  assert.ok(!(await events(owner)).some((e) => e.title === "Performance chat with Pat"));

  // Two legacy copies of one event from before dedupe existed, outside the sync window so
  // the feed does not delete them: the OLDER (no choice) survives, the newer one carried
  // the owner's "hidden" + surprise switch.
  const mk = (uid, createdAt, extra) => {
    const rec = newEventRecord({
      title: "Legacy offsite", startAt: "2024-01-10T15:00:00.000Z", endAt: "2024-01-10T16:00:00.000Z", ownerId: member.actorId,
      category: "Calendar", layer: "linked", source: "Acme Corp", provenance: { via: "ics", subscriptionId: subId, uid },
    }, { householdId: hh, actorId: member.actorId });
    const out = { ...rec, createdAt, ...extra };
    writeStoreRecord(ctx, "events", out.id, out);
    return out;
  };
  const keeper = mk("legacy-a@acme", 1000, {});
  const dupe = mk("legacy-b@acme", 2000, { shareState: "shared", secret: true });
  const s2 = await member.req(`/api/calendar/subscriptions/${subId}/sync`, { method: "POST" });
  assert.equal(s2.status, 200);
  assert.ok(!readStoreRecord(ctx, "events", dupe.id), "the newer copy folded away");
  const kept = readStoreRecord(ctx, "events", keeper.id);
  assert.equal(kept.shareState, "shared");
  assert.equal(kept.secret, true);
});

test("every event and block GET returns fits EVENT_RECORD, for every viewer", async () => {
  for (const who of [owner, admin, member, limited, child]) {
    const list = await events(who);
    assert.ok(list.length > 0);
    for (const e of list) {
      const v = validateInput(EVENT_RECORD, e, { unknown: "reject" });
      assert.ok(v.ok, `${who.actorId} ${e.id}: ${v.field} — ${v.message}`);
    }
  }
});
