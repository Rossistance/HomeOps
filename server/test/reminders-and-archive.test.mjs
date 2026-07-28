// Both reminders, and where done goes to rest.
//
// Cluster N — "What if I want to be notified the day before and one hour before? Well I
// can't select both of them. I need to be able to select both — all of them if need be."
// Cluster M — "After so many days complete — I'll probably say three days — they should drop
// into another category called archived. That way the completed section will eventually
// entirely empty."
//
// The sweeps are exercised as FUNCTIONS against the real store (same tenant engine the
// server uses), because time is an input here and the HTTP layer has no honest way to hand
// a test yesterday's clock.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { startServer, stopServer, makeSession, readStoreDoc, writeStoreDoc } from "./harness.mjs";

/* The sweeps run in a FRESH node process against the same data dir. Importing reminders.mjs
 * in THIS process looked simpler and silently tested nothing: the in-process store engine
 * caches docs from import time, so it read an empty snapshot while the spawned server wrote
 * the real one — a sweep over nothing, passing vacuously. A subprocess gets a cold engine,
 * sees current disk, and its writes commit where the assertions read. */
function runSweep(fnName, nowMs, dataDir) {
  const url = new URL("../reminders.mjs", import.meta.url).href; // already a file:// URL
  const script = `import { ${fnName} } from ${JSON.stringify(url)}; const r = await ${fnName}(${nowMs}); console.log(JSON.stringify(r));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, HOMEOPS_DATA_DIR: dataDir, NODE_TEST_CONTEXT: "" },
    encoding: "utf8",
  });
  return JSON.parse(out.trim().split(/[\r\n]+/).pop());
}

let ctx, adult;

before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan");
});
after(async () => { await stopServer(ctx); });

const taskById = (id) => {
  const all = readStoreDoc(ctx, "tasks.json", {});
  return all[id] ?? Object.values(all).find((t) => t.id === id) ?? null;
};

test("THE ASK: a task can hold BOTH 'one day before' and 'one hour before'", async () => {
  const r = await adult.req("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ title: "Take meds", startAt: new Date(Date.now() + 2 * 86400000).toISOString(), remindOffsets: [24 * 60, 60] }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.task.remindOffsets, [24 * 60, 60]);
});

test("an offset off the menu is refused, not silently dropped", async () => {
  const r = await adult.req("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ title: "Weird reminder", startAt: new Date(Date.now() + 86400000).toISOString(), remindOffsets: [7] }),
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "bad_reminder");
});

test("each offset fires once, independently — the day-before firing must not spend the hour-before", async () => {
  const start = Date.now() + 2 * 60 * 60_000; // two hours out
  const made = await adult.req("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ title: "Two-step reminder", startAt: new Date(start).toISOString(), remindOffsets: [24 * 60, 60] }),
  });
  const id = made.data.task.id;

  // "Now": the day-before offset is already past (task is 2h away), the hour-before is not.
  runSweep("sweepTaskReminders", Date.now(), ctx.dataDir);
  let t = taskById(id);
  assert.deepEqual(t.remindersSent, [24 * 60], "only the elapsed offset is spent");

  // An hour and a bit later, the second one comes due and fires too.
  runSweep("sweepTaskReminders", start - 30 * 60_000, ctx.dataDir);
  t = taskById(id);
  assert.deepEqual([...t.remindersSent].sort((a, b) => a - b), [60, 24 * 60], "both spent, neither twice");

  // Sweeping again spends nothing more.
  runSweep("sweepTaskReminders", start - 20 * 60_000, ctx.dataDir);
  assert.equal(taskById(id).remindersSent.length, 2);
});

test("changing the time re-arms every offset", async () => {
  const made = await adult.req("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ title: "Moves later", startAt: new Date(Date.now() + 60_000).toISOString(), remindOffsets: [0] }),
  });
  runSweep("sweepTaskReminders", Date.now() + 2 * 60_000, ctx.dataDir);
  assert.equal(taskById(made.data.task.id).remindersSent.length, 1, "fired");
  const r = await adult.req(`/api/tasks/${made.data.task.id}`, {
    method: "PATCH", body: JSON.stringify({ startAt: new Date(Date.now() + 86400000).toISOString() }),
  });
  assert.deepEqual(r.data.task.remindersSent, [], "a moved task reminds again — a spent stamp on a new time is a silent no-show");
});

test("ARCHIVE: three days after completion, done drops into archived", async () => {
  const ARCHIVE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
  const made = await adult.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Old chore" }) });
  const doneAt = await adult.req(`/api/tasks/${made.data.task.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
  assert.ok(doneAt.data.task.completedAt, "done is a moment, and it gets a stamp");

  runSweep("sweepTaskArchive", Date.now() + 1 * 86400000, ctx.dataDir);
  assert.equal(taskById(made.data.task.id).status, "done", "one day in, still visible in Completed");

  runSweep("sweepTaskArchive", Date.parse(doneAt.data.task.completedAt) + ARCHIVE_AFTER_MS + 60_000, ctx.dataDir);
  assert.equal(taskById(made.data.task.id).status, "archived", "three days in, it rests");
});

test("…and tasks finished before completedAt existed drain on the same schedule", async () => {
  // His 26-item Completed backlog predates the stamp; updatedAt stands in for it.
  const made = await adult.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Legacy done" }) });
  await adult.req(`/api/tasks/${made.data.task.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
  // Simulate the legacy shape: strip the stamp.
  const all = readStoreDoc(ctx, "tasks.json", {});
  const key = Object.keys(all).find((k) => all[k].id === made.data.task.id);
  all[key] = { ...all[key], completedAt: undefined, updatedAt: new Date(Date.now() - 4 * 86400000).toISOString() };
  writeStoreDoc(ctx, "tasks.json", all);

  runSweep("sweepTaskArchive", Date.now(), ctx.dataDir);
  assert.equal(taskById(made.data.task.id).status, "archived");
});

test("reopening an archived task pulls it fully back into play", async () => {
  const archived = Object.values(readStoreDoc(ctx, "tasks.json", {})).find((t) => t.status === "archived");
  const r = await adult.req(`/api/tasks/${archived.id}`, { method: "PATCH", body: JSON.stringify({ status: "todo" }) });
  assert.equal(r.data.task.status, "todo");
  assert.equal(r.data.task.completedAt, null, "back in play means the completion moment is gone too");
});
