// H5 [22:19] — "reminders: 15 minutes before, 30 minutes before, producing a real
// notification."
//
// The design decision under test is that this is SERVER-side. A task you assign to someone
// else has to reach their phone; a reminder scheduled on your device can only reach yours.
// So the sweep resolves the assignee and pushes to their registered devices — and fires each
// reminder exactly once, because a nudge that arrives four times is worse than one that's a
// few seconds late.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-reminders-"));
const { reminderAt, isValidReminder, sweepTaskReminders } = await import("../reminders.mjs");
const { putTask, getTask, listTasks, runWithTenant, addPushToken } = await import("../store.mjs");

const HH = "local";
const T = (fn) => runWithTenant(HH, fn);
const MIN = 60_000;

// Capture what would have gone to Expo instead of sending it.
const realFetch = globalThis.fetch;
let sent = [];
before(() => {
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, headers: { get: () => null }, body: null, text: async () => "{}" };
  };
});
after(() => {
  globalThis.fetch = realFetch;
  try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {}
});
beforeEach(async () => {
  sent = [];
  await T(async () => { for (const t of listTasks(() => true)) putTask({ ...t, status: "done" }); });
});

let seq = 0;
const task = (over) => {
  const id = `tk_test_${++seq}`;
  return T(async () => putTask({
    id, householdId: HH, title: "Leave for practice", type: "task", status: "todo",
    dueAt: null, startAt: null, endAt: null, assignedMemberId: null, createdBy: "m-alex",
    priority: "medium", visibility: "household", notes: "",
    remindMinutesBefore: null, reminderSentAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...over,
  }));
};

/* ---- when it should fire ---- */

test("the reminder time is measured from the START, not the deadline", () => {
  // Nudging someone 15 minutes before a deadline they were supposed to have already met is
  // the wrong end of the event.
  const start = "2026-08-01T15:00:00.000Z";
  const at = reminderAt({ startAt: start, dueAt: "2026-08-01T20:00:00.000Z", remindMinutesBefore: 15 });
  assert.equal(at, Date.parse(start) - 15 * MIN);
});

test("a task with only a due date still gets its reminder", () => {
  const due = "2026-08-01T17:00:00.000Z";
  assert.equal(reminderAt({ dueAt: due, remindMinutesBefore: 30 }), Date.parse(due) - 30 * MIN);
});

test("no time, or no lead, means no reminder — never a nudge about nothing", () => {
  assert.equal(reminderAt({ remindMinutesBefore: 15 }), null);
  assert.equal(reminderAt({ startAt: "2026-08-01T15:00:00.000Z" }), null);
  assert.equal(reminderAt({ startAt: "not a date", remindMinutesBefore: 15 }), null);
});

test("0 is a real choice (\"at the time\") and is not confused with \"none\"", () => {
  assert.equal(isValidReminder(0), true);
  assert.equal(isValidReminder(null), true);
  assert.equal(isValidReminder(7), false);
  const at = reminderAt({ startAt: "2026-08-01T15:00:00.000Z", remindMinutesBefore: 0 });
  assert.equal(at, Date.parse("2026-08-01T15:00:00.000Z"));
});

/* ---- the sweep ---- */

test("THE POINT: it reaches the ASSIGNEE's phone, not the creator's", async () => {
  await T(() => addPushToken("ExponentPushToken[noah]", { actorId: "m-noah", householdId: HH }));
  await T(() => addPushToken("ExponentPushToken[alex]", { actorId: "m-alex", householdId: HH }));
  const t = await task({ startAt: new Date(Date.now() + 10 * MIN).toISOString(), remindMinutesBefore: 15, assignedMemberId: "m-noah" });
  const out = await T(() => sweepTaskReminders());
  assert.equal(out.sent, 1);
  const to = sent.flat().map((m) => m.to);
  assert.deepEqual(to, ["ExponentPushToken[noah]"], "a chore assigned to Beannie must not nudge me");
  assert.equal(sent.flat()[0].title, t.title);
  assert.equal(sent.flat()[0].data.id, t.id);
});

test("an unassigned task nudges whoever created it — it's still somebody's", async () => {
  await T(() => addPushToken("ExponentPushToken[alex]", { actorId: "m-alex", householdId: HH }));
  await task({ dueAt: new Date(Date.now() + 5 * MIN).toISOString(), remindMinutesBefore: 15 });
  const out = await T(() => sweepTaskReminders());
  assert.equal(out.sent, 1);
  assert.equal(sent.flat()[0].to, "ExponentPushToken[alex]");
});

test("it fires ONCE — a second sweep sends nothing", async () => {
  await T(() => addPushToken("ExponentPushToken[alex]", { actorId: "m-alex", householdId: HH }));
  const t = await task({ startAt: new Date(Date.now() + 5 * MIN).toISOString(), remindMinutesBefore: 15 });
  await T(() => sweepTaskReminders());
  sent = [];
  const again = await T(() => sweepTaskReminders());
  assert.equal(again.sent, 0);
  assert.equal(sent.length, 0);
  assert.ok((await T(() => getTask(t.id))).reminderSentAt, "the send is stamped so a restart can't repeat it");
});

test("a reminder that isn't due yet stays quiet", async () => {
  await task({ startAt: new Date(Date.now() + 3 * 60 * MIN).toISOString(), remindMinutesBefore: 15 });
  const out = await T(() => sweepTaskReminders());
  assert.equal(out.sent, 0);
  assert.equal(sent.length, 0);
});

test("a completed task is never reminded about", async () => {
  await task({ status: "done", startAt: new Date(Date.now() + 5 * MIN).toISOString(), remindMinutesBefore: 15 });
  const out = await T(() => sweepTaskReminders());
  assert.equal(out.sent, 0);
});

test("a window missed by more than a day is retired quietly, not fired late", async () => {
  // The server was down through the reminder window. Firing now is noise about something
  // already past — but leaving it armed would fire it on every future sweep.
  await T(() => addPushToken("ExponentPushToken[alex]", { actorId: "m-alex", householdId: HH }));
  const t = await task({ startAt: new Date(Date.now() - 3 * 24 * 60 * MIN).toISOString(), remindMinutesBefore: 15 });
  const out = await T(() => sweepTaskReminders());
  assert.equal(out.sent, 0);
  assert.equal(sent.length, 0);
  assert.ok((await T(() => getTask(t.id))).reminderSentAt, "and it's retired so it can't re-fire forever");
});

test("a task with no reminder set is untouched by the sweep", async () => {
  const t = await task({ startAt: new Date(Date.now() - MIN).toISOString() });
  await T(() => sweepTaskReminders());
  assert.equal((await T(() => getTask(t.id))).reminderSentAt, null);
});
