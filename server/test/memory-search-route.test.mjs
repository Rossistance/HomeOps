// WP-007 s5 — GET /api/memory/search: household-scoped provider search + profile, the
// route the Memory tab's search box calls. Full HTTP-level test via the real server
// (server/test/harness.mjs), same pattern as other route tests.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, alex;

before(async () => {
  ctx = await startServer();
  alex = await makeSession(ctx, "m-alex");
});
after(async () => { await stopServer(ctx); });

test("requires a session", async () => {
  const r = await ctx.fetch("/api/memory/search?q=taco");
  assert.equal(r.status, 401);
});

test("empty q returns the household profile with no results, not an error", async () => {
  const r = await alex.req("/api/memory/search");
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.deepEqual(r.data.results, []);
  assert.ok(r.data.profile === null || typeof r.data.profile.totalMemories === "number");
});

test("write_memory (via a run) then search finds it via the provider", async () => {
  // homeops.write_memory is an internal run-engine tool (executed as a plan step), not a
  // provider tool reachable through /api/tools/:id/execute — same invocation path as
  // server/test/auto-memory.test.mjs.
  const plan = { title: "Remember something", steps: [{ toolId: "homeops.write_memory", title: "Remember taco night", detail: "", input: { text: "The family does taco night on Wednesdays", scope: "household", type: "Routine" } }] };
  const started = await alex.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "manual", plan }) });
  assert.equal(started.status, 200);
  const runId = started.data.run.id;
  const t0 = Date.now();
  let run;
  for (;;) {
    run = (await alex.req(`/api/runs/${runId}`)).data.run;
    if (["completed", "failed", "cancelled", "expired"].includes(run.status) || Date.now() - t0 > 8000) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.equal(run.status, "completed");

  const r = await alex.req("/api/memory/search?q=taco+night");
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.degraded, false);
  assert.ok(r.data.results.some((m) => /taco night/.test(m.text)));
  assert.ok(r.data.profile.totalMemories >= 1);
});
