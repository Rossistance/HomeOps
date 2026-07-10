// Read-step soft failure: a failing read-only enrichment step (bot-walled page,
// unparseable recipe) must NOT kill the rest of the plan — later steps run with
// what succeeded, the step keeps an honest "failed" status, and the run can
// still complete. Writes and final steps keep hard-fail semantics.
// (Repro of the production meal-plan failure, 2026-07-09: 2 of 3 recipes
// extracted, third web.recipe failed, and every plan_meal step died pending.)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex"); // Owner
});
after(async () => { await stopServer(ctx); });

async function waitForRun(id, tries = 40) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const g = await owner.req(`/api/runs/${id}`);
    const run = g.data?.run;
    if (run && ["completed", "failed", "cancelled", "waiting_for_approval"].includes(run.status)) return run;
  }
  const g = await owner.req(`/api/runs/${id}`);
  return g.data?.run;
}

test("a failed read step fails SOFT and later steps still run to completion", async () => {
  const plan = {
    title: "Enrich then record",
    summary: "A read that will fail, then a write that must still happen.",
    steps: [
      // Guaranteed read failure: invalid URL — but it's a Read tool with a later step.
      { toolId: "web.read", title: "Read a page that cannot load", detail: "Fetch enrichment", input: { url: "not-a-real-url" } },
      { toolId: "homeops.write_memory", title: "Record the note anyway", detail: "Taco night is Thursday this week", input: { text: "Taco night is Thursday this week", scope: "household" } },
    ],
  };
  const start = await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "manual", plan }) });
  assert.equal(start.status, 200);
  const run = await waitForRun(start.data.run.id);
  assert.equal(run.status, "completed", JSON.stringify(run.steps?.map((s) => ({ t: s.toolId, st: s.status, d: s.detail }))));
  assert.equal(run.steps[0].status, "failed", "read step keeps an honest failed status");
  assert.match(String(run.steps[0].detail ?? ""), /continued without/i);
  assert.equal(run.steps[1].status, "succeeded", "the later write still ran");
});

test("a failing FINAL read step still fails the run (nothing left to salvage it)", async () => {
  const plan = {
    title: "Read only",
    summary: "One failing read, no later steps.",
    steps: [
      { toolId: "web.read", title: "Read a page that cannot load", detail: "Fetch enrichment", input: { url: "not-a-real-url" } },
    ],
  };
  const start = await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "manual", plan }) });
  const run = await waitForRun(start.data.run.id);
  assert.equal(run.status, "failed");
});
