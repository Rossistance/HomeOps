// MEMORY — household/personal knowledge written by real runs (Phase G: delete/archive).
// Deleting a memory entry is safe by construction: it's a reference record for future
// grounding, not a live dependency any already-accepted skill/agent version holds a
// pointer to (see the comment on deleteMemoryEntry in store.mjs).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult, child;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");   // Child View
});
after(async () => { await stopServer(ctx); });

// homeops.write_memory only executes through the real run engine (it's an internal
// function, not a directly-executable platform/legacy tool) — this is the real path
// a plan takes, not a shortcut.
async function writeMemoryViaRun(session, input) {
  const start = await session.req("/api/runs/start", {
    method: "POST",
    body: JSON.stringify({ source: "manual", plan: { title: "Test memory write", steps: [{ toolId: "homeops.write_memory", title: "Remember it", input, requiresApproval: false }] } }),
  });
  const runId = start.data.run.id;
  for (let i = 0; i < 20; i++) {
    const r = await session.req(`/api/runs/${runId}`);
    if (r.data.run.status === "completed" || r.data.run.status === "failed") return r.data.run;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error("run did not finish");
}

test("a real run writes memory; it's visible via GET /api/memory", async () => {
  const run = await writeMemoryViaRun(adult, { text: "Noah is allergic to peanuts.", scope: "family", type: "Fact" });
  assert.equal(run.status, "completed");
  const list = (await adult.req("/api/memory")).data.memory;
  assert.ok(list.some((m) => m.text === "Noah is allergic to peanuts."));
});

test("family-scoped memory is visible to a child; personal memory is not (unless it's theirs)", async () => {
  await writeMemoryViaRun(adult, { text: "Family memory visible to all.", scope: "family" });
  await writeMemoryViaRun(adult, { text: "Adult's personal note.", scope: "personal" });
  const childList = (await child.req("/api/memory")).data.memory;
  assert.ok(childList.some((m) => m.text === "Family memory visible to all."));
  assert.ok(!childList.some((m) => m.text === "Adult's personal note."), "a child cannot see another actor's personal memory");
});

test("deleting a memory entry removes it for everyone, and a re-fetch never resurrects it", async () => {
  const run = await writeMemoryViaRun(adult, { text: "Temporary fact to delete.", scope: "family" });
  const id = run.steps[0].result.id;
  assert.ok((await adult.req("/api/memory")).data.memory.some((m) => m.id === id));
  const del = await adult.req(`/api/memory/${id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  assert.equal(del.data.ok, true);
  const after1 = (await adult.req("/api/memory")).data.memory;
  assert.ok(!after1.some((m) => m.id === id));
  // Idempotent-ish: deleting again is a clean 404, not a crash.
  const del2 = await adult.req(`/api/memory/${id}`, { method: "DELETE" });
  assert.equal(del2.status, 404);
});

test("a child cannot delete another actor's personal memory (404, not 403 — existence not leaked)", async () => {
  const run = await writeMemoryViaRun(adult, { text: "Private adult note to protect.", scope: "personal" });
  const id = run.steps[0].result.id;
  const del = await child.req(`/api/memory/${id}`, { method: "DELETE" });
  assert.equal(del.status, 404);
  // Still there — the child's delete attempt had no effect.
  assert.ok((await adult.req("/api/memory")).data.memory.some((m) => m.id === id));
});
