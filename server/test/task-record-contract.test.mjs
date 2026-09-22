/* EVERY STORED TASK FITS THE ONE DECLARED RECORD — including the writers not yet declared.
 *
 * TASK_RECORD is mostly optional on purpose: a list item has no dueAt, an old row has no
 * remindOffsets. The point of this file is that whatever a writer DOES put there is
 * declared. Two halves: the HTTP writers through the real server (the action, a status
 * patch that stamps completedAt, task → calendar that stamps eventId), and the in-process
 * tools that still write by hand (create_list_item, plan_meal's groceries) against this
 * process's own store. Every task from both is validated with unknown keys REJECTED.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-taskcontract-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession } = await import("./harness.mjs");
const { validateInput } = await import("../actions/define-action.mjs");
const { TASK_RECORD } = await import("../actions/schemas/task.mjs");
const { createTask } = await import("../actions/tasks.mjs");
const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
const store = await import("../store.mjs");
const { seedDefaults } = await import("../seed.mjs");
seedDefaults();

const ok200 = (r, what) => { assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.data)}`); return r.data; };
const fits = (t, what) => {
  const v = validateInput(TASK_RECORD, t, { unknown: "reject" });
  assert.ok(v.ok, `${what} (${t.id}, type ${t.type}, source ${t.source}) does not fit TASK_RECORD: ${v.field} — ${v.message}`);
};

let ctx, adult;
before(async () => { ctx = await startServer(); adult = await makeSession(ctx, "m-morgan"); });
after(async () => { await stopServer(ctx); });

test("HTTP WRITERS: the action, a completion, a calendar link — every task GET returns fits", async () => {
  const a = ok200(await adult.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Fix the gate", startAt: "2031-06-02T10:00:00Z", endAt: "2031-06-02T11:00:00Z", remindOffsets: [30], notes: "hinge side" }) }), "POST /api/tasks").task;
  const b = ok200(await adult.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Pay water", type: "bill", amount: 80, dueAt: "2031-06-05T12:00:00Z", assignedMemberId: "m-alex" }) }), "POST bill").task;
  ok200(await adult.req(`/api/tasks/${b.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) }), "PATCH done");
  ok200(await adult.req(`/api/tasks/${a.id}/to-calendar`, { method: "POST", body: "{}" }), "task → calendar");
  const tasks = ok200(await adult.req("/api/tasks"), "GET /api/tasks").tasks;
  for (const t of tasks) fits(t, "a listed task");
  const done = tasks.find((t) => t.id === b.id); assert.ok(done.completedAt, "completion is stamped, and declared");
  const linked = tasks.find((t) => t.id === a.id); assert.ok(linked.eventId?.startsWith("ev_"), "the calendar link is stamped, and declared");
  const v = validateInput(createTask.output, { task: a }, { unknown: "reject", defs: createTask.$defs });
  assert.ok(v.ok, `the action's own output holds: ${v.field} — ${v.message}`);
});

test("IN-PROCESS WRITERS fit the same record — the list-item action, and the grocery writers still by hand", async () => {
  const tctx = { householdId: "local", actorId: "m-alex", runId: "run_test" };
  const li = await INTERNAL_FUNCTIONS["homeops.create_list_item"].run(tctx, { text: "Batteries", listName: "Shopping" });
  assert.equal(li.ok, true, JSON.stringify(li));
  fits(store.getTask(li.result.task.id), "create_list_item");
  assert.ok(li.result.task.id.startsWith("li_"), "a list item's id says what it is");
  const meal = await INTERNAL_FUNCTIONS["homeops.plan_meal"].run(tctx, { title: "Contract chili", date: "2031-07-09", slot: "dinner", ingredients: ["beans", { item: "salt", have: true }] });
  assert.equal(meal.ok, true, JSON.stringify(meal));
  const groceries = store.listTasks((t) => t.mealId === meal.result.mealId);
  assert.ok(groceries.length >= 1, "plan_meal wrote groceries");
  for (const g of groceries) fits(g, "a plan_meal grocery");
  const viaTool = await INTERNAL_FUNCTIONS["homeops.create_task"].run(tctx, { title: "From the tool", dueAt: "2031-07-01", remindMinutesBefore: 30 });
  assert.equal(viaTool.ok, true, JSON.stringify(viaTool));
  fits(viaTool.result.task, "create_task through the registry");
  assert.equal(viaTool.result.task.source, "agent");
  assert.deepEqual(viaTool.result.task.remindOffsets, [30]);
});

test("EVERY WRITER NOW SHARES ONE SET OF DEFAULTS — a grocery item has the same keys as a typed task", async () => {
  /* Before newTaskRecord a list item had no dueAt, no assignee, no reminder plan; a typed
   * task had them as nulls and empties. Now every task written from any door carries the
   * same structural keys — the ones the schema leaves optional only for rows written
   * before this existed. */
  const structural = ["type", "status", "dueAt", "startAt", "endAt", "assignedMemberId", "spaceId", "priority", "amount", "visibility", "nestId",
    "notes", "remindMinutesBefore", "remindOffsets", "remindersSent", "reminderSentAt", "source", "createdBy", "createdAt", "updatedAt"];
  const viaHttp = ok200(await adult.req("/api/tasks"), "GET /api/tasks").tasks;
  const inProcess = store.listTasks((t) => t.householdId === "local");
  assert.ok(viaHttp.length >= 2 && inProcess.length >= 3, "both halves wrote tasks");
  const sources = new Set([...viaHttp, ...inProcess].map((t) => t.source));
  for (const s of ["user", "agent", "assistant"]) assert.ok(sources.has(s), `writer "${s}" is exercised: ${[...sources]}`);
  for (const t of [...viaHttp, ...inProcess]) {
    const missing = structural.filter((k) => !(k in t));
    assert.deepEqual(missing, [], `${t.source} (${t.type}) lacks ${missing.join(", ")}`);
  }
  const grocery = inProcess.find((t) => t.type === "list" && t.mealId);
  assert.ok(grocery && grocery.dueAt === null && Array.isArray(grocery.remindOffsets) && grocery.startAt === null, "a plan_meal grocery got the same defaults");
});

test("a task with an invented field is refused by the same validator", () => {
  const v = validateInput(TASK_RECORD, { id: "tk_x", householdId: "local", title: "x", type: "task", status: "todo", spaceId: "sp-family", priority: "low", visibility: "household", source: "user", createdBy: "m-alex", createdAt: "2031-01-01T00:00:00Z", updatedAt: "2031-01-01T00:00:00Z", colour: "teal" }, { unknown: "reject" });
  assert.equal(v.ok, false); assert.equal(v.field, "colour");
});
