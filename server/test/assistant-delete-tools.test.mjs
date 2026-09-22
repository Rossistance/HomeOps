/* ANYTHING THE ASSISTANT CAN PLANT, IT CAN PULL.
 *
 * The App QA helper (2026-09-22) ran three simulated passes, cleaned up after itself, and
 * reported — correctly — that four test meals and one memory line were stuck: "There is no
 * delete for either, so they persist until a person clears them in the app." The API had
 * DELETE routes for both. The assistant's tool set did not, so a helper that could create
 * a meal and write a memory could not undo either, and a family got left with test data on
 * its planner.
 *
 * Two tools, under the API's own ownership rules, driven here through the real chat route
 * with a scripted model. And one repair the delete tool needed: search_memory returned no
 * ids, so a wrong memory could be found but never pointed at.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-delete-tools-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession } = await import("./harness.mjs");
const { useFakeModel } = await import("./fake-model.mjs");

let ctx, alex, morgan, fake;
before(async () => {
  ctx = await startServer({ env: { HOMEOPS_PLANNER_CATALOG_BUDGET: "400" } });
  alex = await makeSession(ctx, "m-alex");     // Owner
  morgan = await makeSession(ctx, "m-morgan"); // Adult Admin
  fake = await useFakeModel(morgan);
});
after(async () => { await stopServer(ctx); try { fake.server.close(); } catch { /* best effort */ } });

/** One scripted chat turn as `who`: the model calls the given tools, then answers. */
function turn(who, message, script) {
  fake.state.script.push(...script);
  return who.req("/api/assistant", { method: "POST", body: JSON.stringify({ message }) });
}
const toolRows = (req) => (req?.messages ?? []).filter((m) => m.role === "tool");
const meals = async (who) => (await who.req("/api/meals")).data.meals ?? [];
const events = async (who) => (await who.req("/api/events")).data.events ?? [];
const tasks = async (who) => (await who.req("/api/tasks")).data.tasks ?? [];
const memory = async (who) => (await who.req("/api/memory")).data.memory ?? [];

test("DELETE_MEAL: the meal and its calendar event go; its grocery items stay, unlinked", async () => {
  const planned = await turn(morgan, "plan tacos for the 1st", [
    { toolCalls: [{ name: "homeops__plan_meal", args: { title: "QA Tacos", date: "2031-05-01", slot: "dinner", ingredients: ["tortillas", "salsa"] } }] },
    { text: "Planned." },
  ]);
  assert.equal(planned.data.ok, true, JSON.stringify(planned.data));
  const meal = (await meals(morgan)).find((m) => m.title === "QA Tacos");
  assert.ok(meal, "the meal exists");
  assert.equal((await events(morgan)).filter((e) => e.mealId === meal.id).length, 1, "with its calendar event");
  const groceries = (await tasks(morgan)).filter((t) => t.mealId === meal.id);
  assert.equal(groceries.length, 2, "and its grocery items");

  const removed = await turn(morgan, "take the tacos off", [
    { toolCalls: [{ name: "famili__delete_meal", args: { mealId: meal.id } }] },
    { text: "Removed." },
  ]);
  assert.equal(removed.data.ok, true, JSON.stringify(removed.data));
  assert.equal(removed.data.toolCalls?.[0]?.status, "done", JSON.stringify(removed.data.toolCalls));
  assert.ok(!(await meals(morgan)).some((m) => m.id === meal.id), "the meal is gone");
  assert.equal((await events(morgan)).filter((e) => e.mealId === meal.id).length, 0, "its calendar event is gone");
  const after1 = (await tasks(morgan)).filter((t) => groceries.some((g) => g.id === t.id));
  assert.equal(after1.length, 2, "the grocery items survive — a still-wanted item outlives its source meal");
  assert.ok(after1.every((t) => t.mealId == null), "…but no longer point at a meal that does not exist");
});

test("delete_meal: an adult can remove a meal someone else planned; a meal already gone is 'no such meal'", async () => {
  await turn(alex, "plan soup", [
    { toolCalls: [{ name: "homeops__plan_meal", args: { title: "QA Soup", date: "2031-05-02", slot: "lunch", ingredients: ["stock"] } }] },
    { text: "ok" },
  ]);
  const meal = (await meals(alex)).find((m) => m.title === "QA Soup");
  assert.ok(meal);
  const r = await turn(morgan, "remove the soup", [{ toolCalls: [{ name: "famili__delete_meal", args: { mealId: meal.id } }] }, { text: "ok" }]);
  assert.equal(r.data.toolCalls?.[0]?.status, "done", JSON.stringify(r.data.toolCalls));
  const again = await turn(morgan, "remove the soup again", [{ toolCalls: [{ name: "famili__delete_meal", args: { mealId: meal.id } }] }, { text: "ok" }]);
  assert.equal(again.data.toolCalls?.[0]?.status, "failed");
  assert.match(String(again.data.toolCalls?.[0]?.summary ?? ""), /No such meal/);
});

test("SEARCH_MEMORY NOW RETURNS IDS, and delete_memory forgets exactly that entry", async () => {
  await turn(morgan, "remember the QA note is disposable", [
    { toolCalls: [{ name: "homeops__write_memory", args: { text: "QA disposable note — delete me", scope: "household" } }] },
    { text: "Noted." },
  ]);
  const entry = (await memory(morgan)).find((m) => /QA disposable note/.test(m.text));
  assert.ok(entry, "the memory exists");

  fake.state.requests = [];
  const s = await turn(morgan, "what do you remember about the QA note?", [
    { toolCalls: [{ name: "famili__search_memory", args: { query: "QA disposable" } }] },
    { text: "found it" },
  ]);
  assert.equal(s.data.ok, true, JSON.stringify(s.data));
  const shown = JSON.stringify(toolRows(fake.state.requests[1]));
  assert.ok(shown.includes(entry.id), `the search result carries the id the delete tool needs: ${shown.slice(0, 400)}`);
  assert.ok(!shown.includes("sm_mem_"), "…as the store's id, not the index's prefixed copy");

  const d = await turn(morgan, "forget it", [{ toolCalls: [{ name: "famili__delete_memory", args: { memoryId: entry.id } }] }, { text: "Forgotten." }]);
  assert.equal(d.data.toolCalls?.[0]?.status, "done", JSON.stringify(d.data.toolCalls));
  assert.ok(!(await memory(morgan)).some((m) => m.id === entry.id), "and it is gone");
});

test("A PERSONAL MEMORY CANNOT BE FORGOTTEN BY ANYONE BUT ITS OWNER — not even an adult; to them it does not exist", async () => {
  await turn(alex, "remember this just for me", [
    { toolCalls: [{ name: "homeops__write_memory", args: { text: "Alex's private QA note", scope: "personal" } }] },
    { text: "ok" },
  ]);
  const entry = (await memory(alex)).find((m) => /Alex's private QA note/.test(m.text));
  assert.ok(entry, "alex sees their own note");
  assert.equal(entry.scope, "personal");

  const r = await turn(morgan, "delete alex's note", [{ toolCalls: [{ name: "famili__delete_memory", args: { memoryId: entry.id } }] }, { text: "ok" }]);
  assert.equal(r.data.toolCalls?.[0]?.status, "failed", JSON.stringify(r.data.toolCalls));
  assert.match(String(r.data.toolCalls?.[0]?.summary ?? ""), /No such memory/, "not 'forbidden' — the entry is not disclosed to exist");
  assert.ok((await memory(alex)).some((m) => m.id === entry.id), "still there for its owner");

  const own = await turn(alex, "forget my note", [{ toolCalls: [{ name: "famili__delete_memory", args: { memoryId: entry.id } }] }, { text: "ok" }]);
  assert.equal(own.data.toolCalls?.[0]?.status, "done", JSON.stringify(own.data.toolCalls));
});

test("update_task through chat refuses a made-up assignee instead of assigning a ghost", async () => {
  const tk = (await morgan.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "QA assign me" }) })).data.task;
  const r = await turn(morgan, "assign it to bob", [{ toolCalls: [{ name: "famili__update_task", args: { taskId: tk.id, assignedMemberId: "m-bob" } }] }, { text: "ok" }]);
  assert.equal(r.data.toolCalls?.[0]?.status, "failed", JSON.stringify(r.data.toolCalls));
  assert.match(String(r.data.toolCalls?.[0]?.summary ?? ""), /m-bob/);
  const fresh = (await tasks(morgan)).find((t) => t.id === tk.id);
  assert.equal(fresh.assignedMemberId ?? null, null, "nothing was written");
});
