// Deterministic step-input threading: a plan step arriving with an EMPTY required
// input (planners leave unknown values as "") must not execute empty and fail with
// invalid_input. Without an AI provider the engine falls back to deterministic
// threading — first-step text-like fields fill from the step's own instruction.
// (Repro of the mobile "Provide a search `query`" run failures, 2026-07-05.)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex"); // Owner
});
after(async () => { await stopServer(ctx); });

async function waitForRun(id, tries = 30) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const g = await owner.req(`/api/runs/${id}`);
    const run = g.data?.run;
    if (run && ["completed", "failed", "cancelled", "waiting_for_approval"].includes(run.status)) return run;
  }
  const g = await owner.req(`/api/runs/${id}`);
  return g.data?.run;
}

test("a first step with an empty required text input fills from its instruction instead of failing", async () => {
  const plan = {
    title: "Note the pediatrician",
    summary: "Write one memory entry.",
    steps: [
      // homeops.write_memory requires `text`; the planner left it empty. The
      // deterministic filler must source it from detail — never execute with "".
      { toolId: "homeops.write_memory", title: "Remember the pediatrician", detail: "Pediatrician is Dr. Rivera at Northside Clinic", input: { text: "", scope: "household" } },
    ],
  };
  const start = await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "manual", plan }) });
  assert.equal(start.status, 200);
  const run = await waitForRun(start.data.run.id);
  assert.equal(run.status, "completed", JSON.stringify(run.steps?.map((s) => ({ t: s.toolId, st: s.status, d: s.detail }))));
  assert.equal(run.steps[0].status, "succeeded");

  // The memory record must carry the threaded text, proving the input was filled.
  const mem = await owner.req("/api/memory");
  const items = mem.data?.memory ?? mem.data?.items ?? [];
  assert.ok(items.some((m) => String(m.text ?? "").includes("Dr. Rivera")), "threaded memory text not found");
});
