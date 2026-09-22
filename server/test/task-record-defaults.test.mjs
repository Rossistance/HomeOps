/* ONE WRITER OF A TASK'S DEFAULTS — and the list-item tool on the same run as create_task.
 *
 * The task-side twin of event-record-defaults.test.mjs. Five writers built task records by
 * hand and a list item had no dueAt, no assignee, no reminder plan while a typed task had
 * them as nulls and empties. newTaskRecord fills every structural default, validates the
 * result against TASK_RECORD with unknown keys rejected, and throws; a source-text guard
 * refuses any putTask( that does not go through it. The last tests pin that
 * homeops.create_list_item keeps the contract the model knows (text + listName) while
 * running on create_task's code.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-tkdefaults-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { newTaskRecord, TASK_RECORD } = await import("../actions/schemas/task.mjs");
const { validateInput } = await import("../actions/define-action.mjs");
const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
const { getAction, actionForRoute } = await import("../actions/registry.mjs");
const { seedDefaults } = await import("../seed.mjs");
seedDefaults();

const ctx = { householdId: "local", actorId: "m-alex" };
const minimal = { title: "Fix the gate", source: "user" };

test("A WRITER PASSES WHAT IT KNOWS AND GETS A COMPLETE RECORD", () => {
  const rec = newTaskRecord(minimal, ctx);
  assert.ok(rec.id.startsWith("tk_"));
  assert.equal(rec.householdId, "local"); assert.equal(rec.createdBy, "m-alex");
  assert.match(rec.createdAt, /^\d{4}-\d{2}-\d{2}T/, "tasks stamp createdAt as ISO — every writer always did");
  assert.equal(rec.createdAt, rec.updatedAt);
  assert.equal(rec.type, "task"); assert.equal(rec.status, "todo");
  assert.equal(rec.dueAt, null); assert.equal(rec.startAt, null); assert.equal(rec.endAt, null);
  assert.equal(rec.assignedMemberId, null); assert.equal(rec.spaceId, "sp-family"); assert.equal(rec.priority, "medium"); assert.equal(rec.amount, null);
  assert.equal(rec.visibility, "household"); assert.equal(rec.nestId, null); assert.equal(rec.notes, "");
  assert.equal(rec.remindMinutesBefore, null); assert.deepEqual(rec.remindOffsets, []); assert.deepEqual(rec.remindersSent, []); assert.equal(rec.reminderSentAt, null);
  for (const k of ["listName", "eventId", "mealId", "completedAt", "createdByAgentId"]) assert.equal(k in rec, false, `${k} only when there is one`);
  assert.equal(validateInput(TASK_RECORD, rec, { unknown: "reject" }).ok, true);
});

test("a list item's id says what it is, and what a writer knows wins over the default", () => {
  const rec = newTaskRecord({ title: "Milk", type: "list", listName: "Groceries", priority: "low", mealId: "meal_1", source: "meal", createdByAgentId: null }, ctx);
  assert.ok(rec.id.startsWith("li_"));
  assert.equal(rec.listName, "Groceries"); assert.equal(rec.priority, "low"); assert.equal(rec.mealId, "meal_1");
  assert.equal(rec.createdByAgentId, null, "an explicit null is a value, not an absence");
  assert.equal(rec.dueAt, null, "…and a list item still carries the structural keys");
});

test("A TASK MUST SAY HOW IT GOT HERE", () => {
  assert.throws(() => newTaskRecord({ title: "x" }, ctx), /source is required/);
  assert.throws(() => newTaskRecord(minimal, { householdId: "local" }), /ctx needs householdId and actorId/);
});

test("A WRITER THAT INVENTS A FIELD, OR A WRONG TYPE, FAILS AT THE WRITE", () => {
  assert.throws(() => newTaskRecord({ ...minimal, colour: "teal" }, ctx), /"colour" is not a field of TASK_RECORD/);
  assert.throws(() => newTaskRecord({ ...minimal, id: "tk_mine" }, ctx), /"id" is decided here/);
  assert.throws(() => newTaskRecord({ ...minimal, completedAt: "now" }, ctx), /"completedAt" is decided here/);
  assert.throws(() => newTaskRecord({ ...minimal, priority: "urgent" }, ctx), /priority/);
  assert.throws(() => newTaskRecord({ ...minimal, remindOffsets: ["15"] }, ctx), /remindOffsets\[0\]/);
});

/* ───────────────── no other way to write one ───────────────── */

test("EVERY putTask( IN THE SERVER GOES THROUGH newTaskRecord", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!["test", "spike", "node_modules", ".data"].includes(e.name)) walk(p); }
      else if (e.name.endsWith(".mjs")) files.push(p);
    }
  };
  walk(root);
  const offenders = [];
  for (const f of files) {
    if (path.basename(f) === "store.mjs") continue;
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/putTask\(/g)) {
      const after = src.slice(m.index, m.index + 40);
      if (!after.startsWith("putTask(newTaskRecord(")) offenders.push(`${path.relative(root, f)}: ${after.split("\n")[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `a hand-built task record slipped in:\n${offenders.join("\n")}`);
});

/* ───────────────── the list-item tool, on create_task's run ───────────────── */

const run = (id, input) => INTERNAL_FUNCTIONS[id].run({ ...ctx, runId: "run_test" }, input);

test("CREATE_LIST_ITEM KEEPS ITS CONTRACT (text + listName) AND RUNS ON CREATE_TASK'S CODE", async () => {
  const r = await run("homeops.create_list_item", { text: "Milk", listName: "Groceries" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = r.result.task;
  assert.ok(t.id.startsWith("li_")); assert.equal(t.type, "list"); assert.equal(t.listName, "Groceries");
  assert.equal(t.priority, "low"); assert.equal(t.source, "agent"); assert.equal(t.status, "todo");
  assert.equal(t.dueAt, null); assert.deepEqual(t.remindOffsets, []);
  assert.equal(validateInput(TASK_RECORD, t, { unknown: "reject" }).ok, true);
  const dflt = await run("homeops.create_list_item", { text: "Sunscreen" });
  assert.equal(dflt.result.task.listName, "Shopping", "the default list is still Shopping");
});

test("…and refuses the way create_task refuses", async () => {
  const missing = await run("homeops.create_list_item", {});
  assert.equal(missing.error, "invalid_input"); assert.equal(missing.field, "text");
  assert.equal((await run("homeops.create_list_item", { text: "   " })).error, "empty_title");
  assert.equal((await run("homeops.create_list_item", { text: "Ours", visibility: "nest", nestId: "nest_nope" })).error, "not_in_nest");
  assert.equal((await run("homeops.create_list_item", { text: "Mine", visibility: "personal" })).result.task.visibility, "private");
});

test("it is a declared action with no HTTP door of its own — POST /api/tasks with type list is that door", () => {
  const a = getAction("homeops.create_list_item");
  assert.ok(a && Object.isFrozen(a));
  assert.equal(a.http, undefined);
  assert.equal(actionForRoute("POST", "/api/tasks")?.id, "homeops.create_task");
});
