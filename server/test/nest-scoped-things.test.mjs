// T1, in full — "keep their own agents and grocery list and task list available between the
// two of them, and yet still isolated from the broader family group."
//
// The nest itself already existed (see nests.test.mjs); this is what you can put IN one.
// Grocery items are tasks (type:"list", listName:"Groceries"), so scoping tasks covers both
// lists he named, and agents get the same treatment.
//
// The load-bearing test in this file is the OWNER one, repeated per thing: the household's
// administrator can read everything else in the app, and if he can read this too then a nest
// is a label rather than a space. Role must be no way in.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, alex, morgan, beannie, nest;

before(async () => {
  ctx = await startServer();
  alex = await makeSession(ctx, "m-alex");       // Owner — deliberately NOT in the nest
  morgan = await makeSession(ctx, "m-morgan");   // Adult Admin
  // The pair from the video: a married couple inside the household, one of them an ordinary
  // Adult Member. That's the real shape — a nest is not an admin feature.
  await alex.req("/api/members", {
    method: "POST",
    body: JSON.stringify({ actorId: "m-beannie", displayName: "Beannie Harper", role: "Adult Member", relationship: "Grandparent" }),
  });
  beannie = await makeSession(ctx, "m-beannie");
  const r = await morgan.req("/api/nests", { method: "POST", body: JSON.stringify({ name: "GPop + Beannie", inviteActorIds: ["m-beannie"] }) });
  nest = r.data.nest;
  await beannie.req(`/api/nests/${nest.id}/accept`, { method: "POST" });
});
after(async () => { await stopServer(ctx); });

const mkTask = (as, body) => as.req("/api/tasks", { method: "POST", body: JSON.stringify(body) });
const tasksFor = async (as) => (await as.req("/api/tasks")).data.tasks;
const agentsFor = async (as) => (await as.req("/api/agents")).data.agents ?? [];

/* ------------------------------- task list ------------------------------- */

test("a task can be scoped to a nest", async () => {
  const r = await mkTask(morgan, { title: "Book the anniversary dinner", visibility: "nest", nestId: nest.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.task.visibility, "nest");
  assert.equal(r.data.task.nestId, nest.id);
});

test("ISOLATION: the household OWNER cannot see a nest task", async () => {
  const r = await mkTask(morgan, { title: "Private errand", visibility: "nest", nestId: nest.id });
  const owner = await tasksFor(alex);
  assert.ok(!owner.some((t) => t.id === r.data.task.id), "role must not be a way into a nest");
});

test("…and the other person in the nest can", async () => {
  const r = await mkTask(morgan, { title: "Shared errand", visibility: "nest", nestId: nest.id });
  const theirs = await tasksFor(beannie);
  assert.ok(theirs.some((t) => t.id === r.data.task.id));
});

/* CHANGED DELIBERATELY: this now REFUSES rather than silently downgrading.
 *
 * The old fallback to "private" was the safe direction for the nest, but it was dishonest to
 * the person: the task was created, the call returned 200, and it was not where they put it.
 * Since the three scopes became a real control they choose from, a scope that can't be
 * honoured has to be said out loud — the same rule an existing task's PATCH has always used
 * (see the next test), which is where the inconsistency was. */
test("NEGATIVE: naming a nest you're not in is refused, not silently downgraded", async () => {
  const r = await mkTask(alex, { title: "Nice try", visibility: "nest", nestId: nest.id });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "not_in_nest");
  const theirs = await tasksFor(beannie);
  assert.ok(!theirs.some((t) => t.title === "Nice try"), "and nothing landed in their nest");
});

test("NEGATIVE: an existing task can't be pushed into a nest you're not in", async () => {
  const own = await mkTask(alex, { title: "Owner's own task" });
  const r = await alex.req(`/api/tasks/${own.data.task.id}`, {
    method: "PATCH", body: JSON.stringify({ visibility: "nest", nestId: nest.id }),
  });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "not_in_nest");
});

test("a task CAN be moved into a nest you are in, and back out again", async () => {
  const t = await mkTask(morgan, { title: "Maybe shared" });
  const into = await morgan.req(`/api/tasks/${t.data.task.id}`, {
    method: "PATCH", body: JSON.stringify({ visibility: "nest", nestId: nest.id }),
  });
  assert.equal(into.data.task.visibility, "nest");
  assert.ok(!(await tasksFor(alex)).some((x) => x.id === t.data.task.id), "the Owner loses sight of it");

  const out = await morgan.req(`/api/tasks/${t.data.task.id}`, {
    method: "PATCH", body: JSON.stringify({ visibility: "household" }),
  });
  assert.equal(out.data.task.visibility, "household");
  assert.equal(out.data.task.nestId, null, "the pointer is cleared, not left dangling");
  assert.ok((await tasksFor(alex)).some((x) => x.id === t.data.task.id), "and it comes back to the family");
});

/* ----------------------------- grocery list ------------------------------ */

test("the grocery list is the same mechanism — a nest gets its own", async () => {
  // Grocery items are tasks with type:"list". Nothing about groceries needed its own
  // plumbing, which is the reason to have noticed that they were tasks already.
  const r = await mkTask(morgan, { title: "Anniversary champagne", type: "list", listName: "Groceries", visibility: "nest", nestId: nest.id });
  assert.equal(r.data.task.visibility, "nest");
  const owner = (await tasksFor(alex)).filter((t) => t.listName === "Groceries");
  assert.ok(!owner.some((t) => t.id === r.data.task.id), "not on the family's grocery list");
  const theirs = (await tasksFor(beannie)).filter((t) => t.listName === "Groceries");
  assert.ok(theirs.some((t) => t.id === r.data.task.id), "on theirs");
});

/* -------------------------------- agents --------------------------------- */

test("a helper can belong to a nest", async () => {
  const r = await morgan.req("/api/agents", {
    method: "POST", body: JSON.stringify({ name: "Anniversary planner", visibility: "nest", nestId: nest.id }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.agent.visibility, "nest");
  assert.equal(r.data.agent.nestId, nest.id);
});

test("ISOLATION: the OWNER cannot list, read, or edit a nest helper", async () => {
  const made = await morgan.req("/api/agents", {
    method: "POST", body: JSON.stringify({ name: "Just theirs", visibility: "nest", nestId: nest.id }),
  });
  const id = made.data.agent.id;
  assert.ok(!(await agentsFor(alex)).some((a) => a.id === id), "not in the list");
  assert.equal((await alex.req(`/api/agents/${id}`)).status, 404, "not readable by id either");
  const edit = await alex.req(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify({ name: "Renamed by the owner" }) });
  assert.equal(edit.status, 403, "and not editable — being the Owner is not membership");
});

test("both people in the nest can use and edit the shared helper", async () => {
  const made = await morgan.req("/api/agents", {
    method: "POST", body: JSON.stringify({ name: "Ours together", visibility: "nest", nestId: nest.id }),
  });
  const id = made.data.agent.id;
  assert.ok((await agentsFor(beannie)).some((a) => a.id === id), "the other member sees it");
  const edit = await beannie.req(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify({ name: "Ours, renamed" }) });
  assert.equal(edit.status, 200, "a nest helper is theirs jointly, not just its author's");
  assert.equal(edit.data.agent.name, "Ours, renamed");
});

test("NEGATIVE: naming a nest you're not in leaves the helper personal, not shared", async () => {
  const r = await alex.req("/api/agents", {
    method: "POST", body: JSON.stringify({ name: "Trojan helper", visibility: "nest", nestId: nest.id }),
  });
  assert.equal(r.data.agent.visibility, "personal");
  assert.ok(!(await agentsFor(beannie)).some((a) => a.id === r.data.agent.id));
});
