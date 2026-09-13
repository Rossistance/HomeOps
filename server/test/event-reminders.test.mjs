// CALENDAR EVENT REMINDERS — the half of Cluster N that was never built. Tasks could nudge a
// phone; the calendar could not. Same contract as task reminders: fired once per offset,
// stamped before the push, retired when more than a day late, addressed to the people ON the
// event, worded on the household's clock.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-event-reminders-"));
const { sweepEventReminders, eventReminderPlan } = await import("../reminders.mjs");
const { putEvent, getEvent, listEvents, deleteEventRec, runWithTenant, addPushToken, setSettings, putMember } = await import("../store.mjs");

const HH = "local";
const T = (fn) => runWithTenant(HH, fn);
const MIN = 60_000;

const realFetch = globalThis.fetch;
let sent = [];
before(async () => {
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, headers: { get: () => null }, body: null, text: async () => "{}" };
  };
  await T(async () => {
    putMember({ actorId: "m-alex", householdId: HH, displayName: "Alex", role: "Owner" });
    putMember({ actorId: "m-morgan", householdId: HH, displayName: "Morgan", role: "Adult Admin" });
    putMember({ actorId: "m-gone", householdId: HH, displayName: "Gone", role: "Adult Member", archived: true });
    addPushToken("tok-alex", { householdId: HH, actorId: "m-alex" });
    addPushToken("tok-morgan", { householdId: HH, actorId: "m-morgan" });
    addPushToken("tok-gone", { householdId: HH, actorId: "m-gone" });
    setSettings({ timezone: "America/New_York" }, HH);
  });
});
after(() => {
  globalThis.fetch = realFetch;
  try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {}
});
beforeEach(async () => {
  sent = [];
  await T(async () => { for (const e of listEvents(() => true)) deleteEventRec(e.id); });
});

let seq = 0;
const event = (over) => {
  const id = `ev_test_${++seq}`;
  return T(async () => putEvent({
    id, householdId: HH, title: "Soccer pickup", startAt: null, endAt: null, allDay: false, location: "",
    participantIds: [], ownerId: "m-alex", createdBy: "m-alex", visibility: "household", status: "confirmed",
    layer: "canonical", remindOffsets: [15], remindersSent: [],
    createdAt: Date.now(), updatedAt: new Date().toISOString(),
    ...over,
  }));
};

test("the plan reads valid offsets and what already fired", () => {
  assert.deepEqual(eventReminderPlan({ remindOffsets: [15, 60, 15], remindersSent: [60] }).offsets, [15, 60]);
  assert.deepEqual([...eventReminderPlan({ remindOffsets: [15, 60], remindersSent: [60] }).sent], [60]);
  assert.deepEqual(eventReminderPlan({ remindOffsets: [7] }).offsets, [], "an offset the app never offers is ignored");
});

test("a due reminder goes to everyone on the event, once, worded on the household's clock", async () => {
  const now = Date.parse("2030-09-20T21:50:00Z"); // 5:50 PM New York
  const ev = await event({ startAt: "2030-09-20T22:00:00Z", participantIds: ["m-alex", "m-morgan"], remindOffsets: [15] });
  const r1 = await T(() => sweepEventReminders(now));
  assert.equal(r1.sent, 1);
  const tokens = sent.flat().map((m) => m.to).sort();
  assert.deepEqual(tokens, ["tok-alex", "tok-morgan"]);
  assert.match(sent.flat()[0].body, /In 15 minutes — 6:00 PM/, "6 PM on the family's clock, not 22:00 UTC");
  assert.equal(sent.flat()[0].priority, "high");
  const after1 = await T(() => getEvent(ev.id));
  assert.deepEqual(after1.remindersSent, [15], "stamped");
  sent = [];
  const r2 = await T(() => sweepEventReminders(now + MIN));
  assert.equal(r2.sent, 0, "never twice");
  assert.equal(sent.length, 0);
});

test("an event with no participants reminds its owner; an archived member is never pushed", async () => {
  const now = Date.parse("2030-09-21T21:50:00Z");
  await event({ startAt: "2030-09-21T22:00:00Z", participantIds: ["m-gone"], remindOffsets: [15] });
  await event({ startAt: "2030-09-21T22:00:00Z", participantIds: [], ownerId: "m-morgan", remindOffsets: [15] });
  await T(() => sweepEventReminders(now));
  const tokens = sent.flat().map((m) => m.to);
  assert.ok(!tokens.includes("tok-gone"), "a removed member's phone stays quiet");
  assert.ok(tokens.includes("tok-morgan"), "the owner of a participant-less event is the audience");
});

test("a reminder more than a day late is retired without a push", async () => {
  const now = Date.parse("2030-09-25T00:00:00Z");
  const ev = await event({ startAt: "2030-09-20T22:00:00Z", remindOffsets: [15] });
  const r = await T(() => sweepEventReminders(now));
  assert.equal(r.sent, 0);
  assert.equal(r.skipped, 1);
  assert.equal(sent.length, 0);
  assert.deepEqual((await T(() => getEvent(ev.id))).remindersSent, [15], "retired, so it never fires later either");
});

test("an all-day event's reminder names the day rather than a fake midnight", async () => {
  // Midnight Sept 22 in New York = 04:00Z; a 1-day-before reminder is due at 04:00Z Sept 21.
  const now = Date.parse("2030-09-21T04:05:00Z");
  await event({ startAt: "2030-09-22T04:00:00.000Z", allDay: true, remindOffsets: [1440], title: "Field day" });
  await T(() => sweepEventReminders(now));
  assert.equal(sent.length, 1);
  assert.match(sent.flat()[0].body, /^Tomorrow — \w{3}, Sep 22/);
});
