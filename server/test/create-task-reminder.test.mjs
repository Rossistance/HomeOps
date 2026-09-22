/* "SET A REMINDER" IN THE SAME BREATH AS "ADD A TASK".
 *
 * 2026-09-22, 01:07 EDT: asked to "set up a reminder … five minutes from now … high
 * priority", the assistant created a task and reported it done. Nothing arrived. The
 * phone's settings were checked, Focus was off, the device token was registered — and the
 * task carried no reminder at all, because the CREATE tool had no field for one. Only the
 * update tool did. Priority was set; priority does not page anyone.
 *
 * The record was right; the tool contract was not. This pins the contract end to end:
 * the field exists on the create tool, the sweep sends the push, and bad leads are refused
 * rather than stored as a nudge that will never fire.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-create-remind-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
const { INTERNAL_INPUTS } = await import("../context.mjs");
const { sweepTaskReminders } = await import("../reminders.mjs");
const { getTask, addPushToken, runWithTenant, readAudit } = await import("../store.mjs");
const { seedDefaults } = await import("../seed.mjs");

const HH = "local";
// The create tool refuses an assignee who is not on the roster; seed the roster it checks.
await runWithTenant(HH, () => seedDefaults());
const T = (fn) => runWithTenant(HH, fn);
const ctx = { householdId: HH, actorId: "m-alex", runId: "run_test" };
const create = (input) => T(() => INTERNAL_FUNCTIONS["homeops.create_task"].run(ctx, input));

// Capture what would have gone to Expo instead of sending it.
const realFetch = globalThis.fetch;
let sent = [];
/** What "Expo" replies. `{}` carries no tickets — nothing to judge; a test that wants a
 *  verdict sets `{ data: [{ status, message, details }] }`, Expo's real shape. */
let expoReply = {};
before(() => {
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, headers: { get: () => null }, body: null, text: async () => "{}", json: async () => expoReply };
  };
});
after(() => { globalThis.fetch = realFetch; });

test("THE CREATE TOOL DECLARES A REMINDER — the model is allowed to ask for one", () => {
  assert.ok(INTERNAL_INPUTS["homeops.create_task"].some((i) => i.key === "remindMinutesBefore"),
    "remindMinutesBefore is on the create contract, not only on update");
});

test("a task created with a lead carries it in the shape the sweep reads", async () => {
  const dueAt = new Date(Date.now() + 2 * 3600e3).toISOString();
  const r = await create({ title: "Notification test", dueAt, priority: "high", remindMinutesBefore: 30 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.task.remindMinutesBefore, 30, "the result says a reminder was set");
  const t = await T(() => getTask(r.result.task.id));
  assert.deepEqual(t.remindOffsets, [30], "remindOffsets is what sweepTaskReminders reads");
  assert.equal(t.remindMinutesBefore, 30, "…and the legacy single value rides along");
  assert.deepEqual(t.remindersSent, []);
});

test("AND THE PUSH ACTUALLY GOES OUT — the whole reason the field exists", async () => {
  await T(() => addPushToken("ExponentPushToken[alex]", { householdId: HH, actorId: "m-alex" }));
  // Due in 20 minutes with a 30-minute lead: the reminder moment has already arrived.
  const dueAt = new Date(Date.now() + 20 * 60_000).toISOString();
  const r = await create({ title: "Call the plumber", dueAt, remindMinutesBefore: 30 });
  assert.equal(r.ok, true, JSON.stringify(r));
  sent = [];
  const out = await T(() => sweepTaskReminders());
  assert.equal(out.sent, 1, JSON.stringify(out));
  assert.equal(sent.length, 1, "one Expo push request");
  assert.equal(sent[0][0].title, "Call the plumber");
  assert.equal(sent[0][0].to, "ExponentPushToken[alex]");
  assert.equal(sent[0][0].priority, "high", "a reminder asks for high priority");
  // And only once.
  sent = [];
  await T(() => sweepTaskReminders());
  assert.equal(sent.length, 0, "the sweep does not nudge twice");
});

test("priority alone does NOT page anyone — the mistake this suite exists to prevent", async () => {
  await T(() => addPushToken("ExponentPushToken[alex]", { householdId: HH, actorId: "m-alex" }));
  const dueAt = new Date(Date.now() + 60_000).toISOString();
  const r = await create({ title: "High priority, no lead", dueAt, priority: "high" });
  assert.equal(r.ok, true);
  sent = [];
  await T(() => sweepTaskReminders());
  assert.equal(sent.filter((b) => b[0]?.title === "High priority, no lead").length, 0,
    "a high-priority task with no lead is a task, not a reminder");
});

test("a lead the app does not offer is refused, not stored as a nudge that never fires", async () => {
  const dueAt = new Date(Date.now() + 3600e3).toISOString();
  const r = await create({ title: "Odd lead", dueAt, remindMinutesBefore: 7 });
  assert.equal(r.ok, false);
  assert.equal(r.error, "bad_reminder");
});

test("a lead with no time to count back from is STORED ARMED, not refused — one rule with the route and the sheet", async () => {
  /* The tool used to refuse this ("reminder_needs_time") while POST /api/tasks accepted
   * it, and the task sheet sends remindOffsets before a day is picked. The declared action
   * runs both doors, so it keeps the product's rule: the nudge waits for a time, the sweep
   * counts back only once there is one, and re-dating re-arms it (task-scheduling.test). */
  const r = await create({ title: "No time", remindMinutesBefore: 15 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.task.dueAt, null);
  assert.deepEqual(r.result.task.remindOffsets, [15], "armed, waiting for a date");
  assert.equal(r.result.task.reminderSentAt, null);
});

test("A REMINDER NOBODY COULD RECEIVE IS WRITTEN DOWN, WITH WHY — the sweep no longer fails silently", async () => {
  /* The other half of the 2026-09-22 investigation: the first question was whether a push
   * had been attempted at all, and the server could not answer it — a failed send was
   * swallowed into `skipped`. Now it is an audit row a person can read. */
  const dueAt = new Date(Date.now() + 20 * 60_000).toISOString();
  // Lily is on the roster but has never registered a device.
  const r = await create({ title: "Pick up the dry cleaning", dueAt, remindMinutesBefore: 30, assignedMemberId: "m-lily" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const out = await T(() => sweepTaskReminders());
  assert.ok(out.skipped >= 1, JSON.stringify(out));
  const rows = await T(() => readAudit(50));
  const row = rows.find((a) => a.type === "reminder.push_failed" && a.taskId === r.result.task.id);
  assert.ok(row, `an audit row names the task: ${JSON.stringify(rows.map((a) => a.type))}`);
  assert.equal(row.reason, "no_tokens", "and says the actual reason — this member has no registered device");
  assert.equal(row.actorId, "m-lily");
});

test("EXPO'S VERDICT IS READ: a token Expo rejects is a failed push, named in the audit, and forgotten", async () => {
  /* Build 76, 2026-09-22: two reminders with valid leads, the sweep counted both as sent,
   * nothing arrived, and nothing on the server could say why — the reply from Expo was
   * discarded unread. This is the shape that would have answered the question in one glance. */
  const { getPushTokens } = await import("../store.mjs");
  await T(() => addPushToken("ExponentPushToken[dead]", { householdId: HH, actorId: "m-morgan" }));
  const dueAt = new Date(Date.now() + 20 * 60_000).toISOString();
  const r = await create({ title: "Renew the tags", dueAt, remindMinutesBefore: 30, assignedMemberId: "m-morgan" });
  assert.equal(r.ok, true, JSON.stringify(r));
  expoReply = { data: [{ status: "error", message: "\"ExponentPushToken[dead]\" is not a registered push notification recipient", details: { error: "DeviceNotRegistered" } }] };
  try {
    sent = [];
    const out = await T(() => sweepTaskReminders());
    assert.equal(sent.length, 1, "the push was attempted");
    assert.equal(out.sent, 0, `…but Expo's rejection makes it a failure, not a send: ${JSON.stringify(out)}`);
    const rows = await T(() => readAudit(100));
    const rejected = rows.find((a) => a.type === "push.rejected" && a.error === "DeviceNotRegistered");
    assert.ok(rejected, `Expo's own reason is in the audit: ${JSON.stringify(rows.map((a) => a.type))}`);
    assert.equal(rejected.tokenTail, "en[dead]", "which device, without the whole token");
    const failed = rows.find((a) => a.type === "reminder.push_failed" && a.taskId === r.result.task.id);
    assert.equal(failed?.reason, "expo_rejected:DeviceNotRegistered", "and the reminder row carries it up");
    assert.ok(!(await T(() => getPushTokens())).some((t) => t.token === "ExponentPushToken[dead]"), "a device Expo says is gone is forgotten");
  } finally { expoReply = {}; }
});

test("a reply with no tickets is 'nothing to judge', not a failure — the sweep's own tests rely on that", async () => {
  await T(() => addPushToken("ExponentPushToken[alex]", { householdId: HH, actorId: "m-alex" }));
  const dueAt = new Date(Date.now() + 20 * 60_000).toISOString();
  const r = await create({ title: "Sharpen the mower", dueAt, remindMinutesBefore: 30 });
  assert.equal(r.ok, true);
  expoReply = {};
  const out = await T(() => sweepTaskReminders());
  assert.ok(out.sent >= 1, JSON.stringify(out));
});

test("a task without a reminder is unchanged: no offsets, no lead, still created", async () => {
  const r = await create({ title: "Plain" });
  assert.equal(r.ok, true);
  const t = await T(() => getTask(r.result.task.id));
  assert.equal(t.remindMinutesBefore, null);
  assert.deepEqual(t.remindOffsets, []);
});
