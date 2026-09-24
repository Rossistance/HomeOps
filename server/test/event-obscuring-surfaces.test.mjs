// HIDDEN EVENTS BEYOND THE CALENDAR SCREEN (ADR-005) — every OTHER surface that shows or
// touches an event: reminders, share cards, help requests, message suggestions, the
// coordination audit, the four older assistant event tools, and the household export.
//
// One Work calendar, set up the way a family does it: an Adult Member (Casey) pastes their
// work feed and marks it as work. From then on, for everyone but Casey — the household Owner
// included — Casey's meetings are "Casey Quinn working" and nothing more: no title, no place,
// no notes. Casey still gets all of it. Each test below is one surface, and each asserts both
// halves: the secret words never reach a non-owner, and the owner still gets theirs.
//
// Surfaces with an HTTP route are driven through the real server; the three that are only a
// sweep or a tool (reminders, coordination, the internal tools) run in this process against
// the spawned server's own data dir (the connector-park-ttl.test.mjs pattern).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

const TITLE = "Quarterly board review";
const TITLE_2 = "Budget sync";
const PLACE = "Conference Room 9";
const NOTES = "SECRET-NOTES-7731";
const SECRETS = [TITLE, TITLE_2, PLACE, NOTES];
const BLOCK = "Casey Quinn working";

/** None of the hidden event's words anywhere in `value` (any JSON-able thing). */
function assertClean(value, where) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  for (const w of SECRETS) assert.ok(!s.includes(w), `${where}: "${w}" leaked — ${s.slice(0, 400)}`);
}

// Three days out, so the server's own 30-second reminder sweep never finds anything due: the
// sweep here is run with an explicit clock instead.
const DAY = new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10);
const stamp = (hhmm) => `${DAY.replace(/-/g, "")}T${hhmm}00Z`;
const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:work-1@casey
SUMMARY:${TITLE}
LOCATION:${PLACE}
DTSTART:${stamp("1600")}
DTEND:${stamp("1700")}
END:VEVENT
BEGIN:VEVENT
UID:work-2@casey
SUMMARY:${TITLE_2}
DTSTART:${stamp("1700")}
DTEND:${stamp("1730")}
END:VEVENT
END:VCALENDAR`;

let ctx, alex, morgan, casey, store, privacy;
let subId, evA, evB, threadId;
const T0 = Date.now() - 60_000; // before the calendar existed — the coordination loop's "from"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (fn) => store.runWithTenant("local", fn);

before(async () => {
  ctx = await startServer({ env: { HOMEOPS_SUGGEST_FAKE: "1" } });
  alex = await makeSession(ctx, "m-alex");     // Owner
  morgan = await makeSession(ctx, "m-morgan"); // Adult Admin
  const am = await alex.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Casey Quinn", role: "Adult Member" }) });
  casey = await makeSession(ctx, am.data.member.actorId);
  assert.equal(casey.role, "Adult Member");

  const imp = await casey.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "Casey work", ics }) });
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  subId = imp.data.subscription.id;
  const work = await casey.req(`/api/calendar/subscriptions/${subId}`, { method: "PATCH", body: JSON.stringify({ isWork: true }) });
  assert.equal(work.status, 200, JSON.stringify(work.data));
  assert.equal(work.data.subscription.isWork, true);

  // Bind this process's store to the spawned server's data dir, never server/.data.
  process.env.HOMEOPS_DATA_DIR = ctx.dataDir;
  store = await import("../store.mjs");
  privacy = await import("../event-privacy.mjs");
  await T(async () => {
    const mine = store.listEvents((e) => e.provenance?.subscriptionId === subId);
    evA = mine.find((e) => e.title === TITLE);
    evB = mine.find((e) => e.title === TITLE_2);
    // ICS has no notes field we read; notes and people are what a family adds by hand.
    store.patchEvent(evA.id, { notes: NOTES, participantIds: [casey.actorId, "m-morgan"], attendees: [{ memberId: "m-alex" }] });
    evA = store.getEvent(evA.id);
  });
  assert.ok(evA && evB, "both work events were imported");

  const t = await alex.req("/api/threads", { method: "POST", body: JSON.stringify({ participantIds: ["m-morgan", casey.actorId], title: "Week plans" }) });
  threadId = t.data.thread.id;
});
after(async () => { await stopServer(ctx); });

const thread = (who) => who.req(`/api/threads/${threadId}`).then((r) => r.data.messages);
const send = (who, body) => who.req(`/api/threads/${threadId}/messages`, { method: "POST", body: JSON.stringify(body) });
const act = (who, mid, sid, action = "apply") => who.req(`/api/threads/${threadId}/messages/${mid}/suggestions/${sid}`, { method: "POST", body: JSON.stringify({ action }) });
async function waitSuggestions(who, messageId) {
  for (let i = 0; i < 40; i++) {
    const m = (await thread(who)).find((x) => x.id === messageId);
    if (m && (m.suggestions ?? []).length) return m;
    await sleep(100);
  }
  throw new Error("suggestions never arrived");
}

test("the setup: a Work calendar's events are hidden, and Casey owns them", () => {
  const st = T(() => privacy.obscureStateOf(evA, privacy.privacyContext("local")));
  assert.equal(st.obscured, true);
  assert.equal(st.kind, "work");
  assert.equal(st.ownerId, casey.actorId);
});

test("export: the Owner's export carries Casey's meetings as blocks — and the Owner's own hidden event in full", async () => {
  // The Owner hides one of their own by hand: theirs to export.
  const own = await alex.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Alex private errand", startAt: `${DAY}T14:00:00.000Z` }) });
  const ownId = own.data?.event?.id ?? own.data?.id;
  assert.ok(ownId, JSON.stringify(own.data));
  T(() => store.patchEvent(ownId, { shareState: "hidden" }));

  const r = await alex.req("/api/export");
  assert.equal(r.status, 200);
  assertClean(r.data.data["events.json"], "exported events");
  assertClean(r.data.data["calendar_subscriptions.json"], "exported calendar feed text");
  const events = Object.values(r.data.data["events.json"]);
  const blocks = events.filter((e) => e.block);
  assert.equal(blocks.length, 1, "the two back-to-back meetings merge into one block");
  assert.equal(blocks[0].title, BLOCK);
  assert.equal(blocks[0].startAt, evA.startAt);
  assert.ok(!events.some((e) => e.id === evA.id || e.id === evB.id), "the real records are not in it");
  assert.ok(events.some((e) => e.id === ownId && e.title === "Alex private errand"), "the exporter's own hidden event is there in full");
  assert.ok(r.data.meta.excluded.some((x) => /hidden events/.test(x)), "and the manifest says what was withheld");
});

test("share card: a non-owner sees the block, the owner sees their event", async () => {
  const m = (await send(casey, { text: "", attachments: [{ kind: "ref", type: "event", id: evA.id }] })).data.message;
  for (const who of [alex, morgan]) {
    const card = (await thread(who)).find((x) => x.id === m.id).attachments[0].preview;
    assert.equal(card.title, BLOCK);
    assert.equal(card.where, null);
    assert.equal(card.route, null, "nothing behind a block to open");
    assert.equal(card.when, evA.startAt);
    assertClean(card, `${who.actorId}'s card`);
  }
  const mine = (await thread(casey)).find((x) => x.id === m.id).attachments[0].preview;
  assert.equal(mine.title, TITLE);
  assert.equal(mine.where, PLACE);
});

test("help request: the card and the accept line name the block; only the owner's card shows the event", async () => {
  const m = (await send(casey, { text: `Could Morgan drive me? [suggest help: Drive Casey Thursday | toActorId=m-morgan | eventId=${evA.id} | apply.driverId=m-morgan]` })).data.message;
  const withS = await waitSuggestions(casey, m.id);
  const s = withS.suggestions[0];
  assert.equal(s.patch.eventId, evA.id, "the owner may link their own hidden event");
  const applied = await act(casey, m.id, s.id);
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  const hrId = applied.data.created.id;

  const cardFor = async (who) => (await thread(who)).flatMap((x) => x.attachments ?? []).find((a) => a.type === "help_request" && a.id === hrId).preview;
  const alexCard = await cardFor(alex);
  assert.equal(alexCard.event.title, BLOCK);
  assert.notEqual(alexCard.event.id, evA.id);
  assert.deepEqual(alexCard.route, { pathname: "/help" });
  assertClean(alexCard, "the Owner's help card");
  assert.equal((await cardFor(casey)).event.title, TITLE);

  const yes = await morgan.req(`/api/help-requests/${hrId}/respond`, { method: "POST", body: JSON.stringify({ response: "accept" }) });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  assert.ok(yes.data.applied, "the owner asked, so the yes lands on the event");
  const line = (await thread(casey)).find((x) => x.kind === "system" && /accepted/.test(x.text ?? ""));
  assert.ok(line, "the accept line was posted");
  assert.match(line.text, new RegExp(BLOCK));
  assertClean(line.text, "the accept line (read by the whole thread)");
});

test("message suggestions: someone else's hidden event is not an update target, a duplicate or a quote", async () => {
  // Casey's own update suggestion keeps its target…
  const cm = (await send(casey, { text: `[suggest event update ${evA.id}: ${TITLE} | location=Room 12]` })).data.message;
  const cs = (await waitSuggestions(casey, cm.id)).suggestions[0];
  assert.equal(cs.kind, "update");
  assert.equal(cs.targetId, evA.id);
  // …but the Owner may not apply it: a parent's right to edit does not reach a hidden event.
  const refused = await act(alex, cm.id, cs.id);
  assert.equal(refused.status, 400);
  assert.equal(refused.data.error, "event_hidden");
  assertClean(refused.data.message, "the refusal");

  // The same words from the Owner do not find Casey's event at all.
  const am = (await send(alex, { text: `[suggest event update ${evA.id}: Moved | location=Room 12]` })).data.message;
  const as = (await waitSuggestions(alex, am.id)).suggestions[0];
  assert.equal(as.kind, "create");
  assert.equal(as.targetId, null);
  await act(alex, am.id, as.id, "dismiss");

  // The duplicate check reads what the thread may read: the block, never the title.
  const dm = (await send(alex, { text: `[suggest event: ${BLOCK} | startAt=${DAY}]` })).data.message;
  const ds = (await waitSuggestions(alex, dm.id)).suggestions[0];
  const dup = await act(alex, dm.id, ds.id);
  assert.equal(dup.status, 200, JSON.stringify(dup.data));
  assert.equal(dup.data.note, `Already on the calendar: “${BLOCK}”`);

  // Casey applying their own update: it lands, and the line the thread reads names the block.
  const ok = await act(casey, cm.id, cs.id);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(T(() => store.getEvent(evA.id)).location, "Room 12");
  const lines = (await thread(alex)).filter((x) => x.kind === "system").map((x) => x.text).join("\n");
  assert.match(lines, new RegExp(`updated “${BLOCK}”`));
  assertClean(lines, "system lines");
  T(() => store.patchEvent(evA.id, { location: PLACE }));
});

test("reminders: a hidden event reminds its owner only", async () => {
  const realFetch = globalThis.fetch;
  const pushes = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("exp.host")) {
      const msgs = JSON.parse(init.body);
      pushes.push(...msgs);
      return { ok: true, status: 200, json: async () => ({ data: msgs.map(() => ({ status: "ok" })) }) };
    }
    return realFetch(url, init);
  };
  try {
    await T(async () => {
      store.addPushToken("tok-casey", { householdId: "local", actorId: casey.actorId });
      store.addPushToken("tok-alex", { householdId: "local", actorId: "m-alex" });
      store.addPushToken("tok-morgan", { householdId: "local", actorId: "m-morgan" });
      store.patchEvent(evA.id, { remindOffsets: [15], remindersSent: [] });
    });
    const { sweepEventReminders } = await import("../reminders.mjs");
    const at = Date.parse(evA.startAt) - 10 * 60_000;
    const out = await T(() => sweepEventReminders(at));
    assert.equal(out.sent, 1, JSON.stringify(out));
    assert.deepEqual(pushes.map((p) => p.to), ["tok-casey"], "participants and attendees get none while it is hidden");
    assert.equal(pushes[0].title, TITLE, "the owner's own reminder is the real thing");

    // Shared by its owner (the eye toggle): participants are reminded again, as before.
    pushes.length = 0;
    T(() => store.patchEvent(evA.id, { shareState: "shared", remindOffsets: [15], remindersSent: [] }));
    await T(() => sweepEventReminders(at));
    assert.deepEqual(pushes.map((p) => p.to).sort(), ["tok-alex", "tok-casey", "tok-morgan"]);
  } finally {
    globalThis.fetch = realFetch;
    T(() => {
      for (const t of ["tok-casey", "tok-alex", "tok-morgan"]) store.removePushToken(t);
      store.patchEvent(evA.id, { shareState: null, remindOffsets: [], remindersSent: [] });
    });
  }
});

test("coordination: a hidden event someone else owns is busy time, never the answer", async () => {
  const { calendarResolution, keywordsFrom } = await import("../coordination.mjs");
  const loop = (targetActorId) => ({
    id: "cl_test", householdId: "local", targetActorId, createdAt: new Date(T0).toISOString(),
    intent: { kind: "appointment", text: TITLE, keywords: keywordsFrom(TITLE) },
  });
  // Morgan is on the event — but it is Casey's, and hidden: evaluated as Morgan it is a block.
  assert.equal(T(() => calendarResolution(loop("m-morgan"), Date.now())), null);
  // Evaluated as Casey, their own event answers it.
  assert.equal(T(() => calendarResolution(loop(casey.actorId), Date.now()))?.id, evA.id);
});

test("the four assistant event tools refuse someone else's hidden event, and work for its owner", async () => {
  const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
  const calls = {
    "homeops.update_event_checklist": { eventId: evB.id, items: ["Slides"] },
    "homeops.assign_driver": { eventId: evB.id, driverId: "m-morgan" },
    "homeops.assign_what_to_bring": { eventId: evB.id, items: ["Laptop"] },
    "homeops.attach_note_or_file_reference": { eventId: evB.id, note: "bring the deck" },
  };
  for (const [id, input] of Object.entries(calls)) {
    for (const actorId of ["m-alex", "m-morgan"]) {
      const r = await T(() => INTERNAL_FUNCTIONS[id].run({ householdId: "local", actorId, runId: "run_t" }, input));
      assert.equal(r.ok, false, `${id} as ${actorId}`);
      assert.equal(r.error, "event_hidden", `${id} as ${actorId}`);
      assertClean(r, `${id} refusal`);
    }
    // Nobody in particular (no roster member) is refused outright.
    const ghost = await T(() => INTERNAL_FUNCTIONS[id].run({ householdId: "local", actorId: "m-nobody", runId: "run_t" }, input));
    assert.equal(ghost.error, "forbidden", `${id} as a non-member`);
  }
  const before = T(() => store.getEvent(evB.id));
  assert.ok(!(before.checklist ?? []).length && !before.driverId, "nothing was written by the refusals");
  for (const [id, input] of Object.entries(calls)) {
    const r = await T(() => INTERNAL_FUNCTIONS[id].run({ householdId: "local", actorId: casey.actorId, runId: "run_t" }, input));
    assert.equal(r.ok, true, `${id} as the owner: ${JSON.stringify(r)}`);
  }
  const after = T(() => store.getEvent(evB.id));
  assert.equal(after.checklist[0].text, "Slides");
  assert.equal(after.driverId, "m-morgan");
});
