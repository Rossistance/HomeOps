// P0.4 — object-level data filtering for runs (server returns already-scoped data).
// Low-trust roles see only runs they started and cannot initiate automation runs.
//
// A run no longer starts from a skillId — skills are gone, and a durable run exists only
// to carry a step through the approval gate — so these start from the raw plan
// /api/runs/start still accepts. The scoping rule under test is untouched by that.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, adultAdmin, child;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
  adultAdmin = await makeSession(ctx, "m-morgan");
  child = await makeSession(ctx, "m-noah");
});
after(async () => { await stopServer(ctx); });

const PLAN = {
  title: "Jot down one thing",
  summary: "",
  steps: [{ toolId: "homeops.create_task", title: "Add a task", detail: "", input: { title: "P0.4 filtering probe" }, requiresApproval: false }],
};

test("a child cannot start an automation run", async () => {
  const r = await child.req("/api/runs/start", { method: "POST", body: JSON.stringify({ plan: PLAN }) });
  assert.equal(r.status, 403);
  assert.equal(r.data?.error, "insufficient_role");
});

test("an adult-started run is visible to adults but NOT to the child", async () => {
  const start = await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ plan: PLAN }) });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const runId = start.data.run?.id;
  assert.ok(runId, "owner should get a run id");

  // Adult Admin sees the household's run.
  const adultRuns = await adultAdmin.req("/api/runs");
  assert.ok(adultRuns.data.runs.some((r) => r.id === runId), "an adult sees the household's runs");

  // Child sees none of it — already-filtered by the server, not hidden by the client.
  const childRuns = await child.req("/api/runs");
  assert.ok(!childRuns.data.runs.some((r) => r.id === runId), "child must not see adult runs");
});
