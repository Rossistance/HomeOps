// A list is a thing, not a coincidence of its tasks.
//
// Cluster L: "After you delete the last task on a given list, the actual list disappears.
// That should not be the case — that list name should persist until the user decides they
// would like to click and delete it." And the inverse: "there's no immediate way to click
// and hold and delete this list."
//
// Lists used to be derived from whichever tasks carried their name — so empty meant gone,
// and delete meant nothing. The registry makes existence and deletion real, with the same
// three rooms (Everyone / My Nest / Just me) as everything else.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, adult;

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
  adult = await makeSession(ctx, "m-morgan");
});
after(async () => { await stopServer(ctx); });

test("THE REPORTED CASE: an empty list persists — existence is not borrowed from tasks", async () => {
  const made = await adult.req("/api/task-lists", { method: "POST", body: JSON.stringify({ name: "Summer Camp", visibility: "household" }) });
  assert.equal(made.status, 200, JSON.stringify(made.data));

  const tk = await adult.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Pack sunscreen", type: "list", listName: "Summer Camp", visibility: "household" }) });
  await adult.req(`/api/tasks/${tk.data.task.id}`, { method: "DELETE" });

  const lists = (await adult.req("/api/task-lists")).data.lists.map((l) => l.name);
  assert.ok(lists.includes("Summer Camp"), "deleting the last task must not delete the list");
});

test("deleting a list takes its tasks with it — no orphans haunting the All view", async () => {
  const made = await adult.req("/api/task-lists", { method: "POST", body: JSON.stringify({ name: "The Move", visibility: "household" }) });
  await adult.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Book van", type: "list", listName: "The Move", visibility: "household" }) });
  const r = await adult.req(`/api/task-lists/${made.data.list.id}`, { method: "DELETE" });
  assert.equal(r.status, 200);
  assert.equal(r.data.tasksRemoved, 1, "the reply counts what it cost");
  const titles = (await adult.req("/api/tasks")).data.tasks.map((t) => t.title);
  assert.ok(!titles.includes("Book van"));
});

test("a private list is invisible to everyone else — same rooms as everything", async () => {
  await adult.req("/api/task-lists", { method: "POST", body: JSON.stringify({ name: "Gift ideas", visibility: "private" }) });
  const mine = (await adult.req("/api/task-lists")).data.lists.map((l) => l.name);
  const theirs = (await owner.req("/api/task-lists")).data.lists.map((l) => l.name);
  assert.ok(mine.includes("Gift ideas"));
  assert.ok(!theirs.includes("Gift ideas"), "a surprise list the household Owner can read is not a surprise");
});

test("the same name in the same room is a typo, not a second list", async () => {
  const r = await adult.req("/api/task-lists", { method: "POST", body: JSON.stringify({ name: "summer camp", visibility: "household" }) });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, "list_exists");
});

test("…but the same name in a DIFFERENT room is fine — rooms are separate worlds", async () => {
  const r = await adult.req("/api/task-lists", { method: "POST", body: JSON.stringify({ name: "Summer Camp", visibility: "private" }) });
  assert.equal(r.status, 200, "his private packing list and the family's camp list may share a name");
});

test("only an adult or the creator deletes a list", async () => {
  const lists = (await adult.req("/api/task-lists")).data.lists;
  const target = lists.find((l) => l.name === "Gift ideas");
  const child = await makeSession(ctx, "m-lily");
  const r = await child.req(`/api/task-lists/${target.id}`, { method: "DELETE" });
  assert.equal(r.status, 404, "a child can't even see a private list to delete it — visibility gates first");
});
