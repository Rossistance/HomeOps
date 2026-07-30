// WHAT THE FAMILY ASKED FOR, AND WHO IT WAS FOR.
//
// Two defects with the same shape: a run carried less context than the request that created
// it, and nothing failed loudly about it.
//
//   • run.goal was NEVER SET. Both step-level LLM calls — the reasoning step (engine.mjs) and
//     the input fill — read `run.goal ?? run.plan?.title` and label it "Run goal". Since
//     nothing ever wrote a goal, every run in the product's history took the fallback: a
//     model-generated plan TITLE stood in for the person's own sentence, and the names,
//     dates and quantities in it were discarded before any step executed.
//   • visibility was never forwarded from the conversation, so a plan born in a PERSONAL
//     chat inherited startRun's "household" default and fanned its approvals out to every
//     approver in the family.
//
// Asserted at the module level against the real engine, because the point is what lands in
// the durable run record — not what a route happens to echo back.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
});
after(async () => { await stopServer(ctx); });

const plan = (title) => ({
  title, summary: "test plan",
  steps: [{ toolId: null, title: "Work it out", detail: "A reasoning step, which is the one that reads run.goal.", input: {} }],
});

test("a chat run records the request in the family's own words", async () => {
  const { orchestrate } = await import("../orchestrator.mjs");
  const { getRun } = await import("../store.mjs");
  const { runWithTenant } = await import("../store.mjs");

  const ask = "Book Amelia's dentist for the 14th and tell Melissa once it's confirmed";
  const out = await runWithTenant("local", () => orchestrate({
    source: "assistant", via: "chat", plan: plan("Dental appointment"),
    session: { householdId: "local", actorId: "m-morgan", role: "Adult Admin" },
    conversationId: null, goal: ask,
  }));
  assert.ok(out.ok, JSON.stringify(out));
  const run = await runWithTenant("local", () => getRun(out.run.id));
  assert.equal(run.goal, ask, "the sentence the person actually typed");
  assert.notEqual(run.goal, run.title, "and it is NOT the model's plan title");
  assert.equal(run.title, "Dental appointment", "the human-scannable title is kept, separately");
});

test("NEGATIVE: with no goal supplied the field is null, never a fabricated one", async () => {
  // Honest absence. A run started from a pre-built plan has no user sentence, and inventing
  // one from the title is exactly the substitution this fix exists to remove.
  const { orchestrate } = await import("../orchestrator.mjs");
  const { getRun, runWithTenant } = await import("../store.mjs");
  const out = await runWithTenant("local", () => orchestrate({
    source: "manual", via: "manual", plan: plan("Hand-rolled"),
    session: { householdId: "local", actorId: "m-morgan", role: "Adult Admin" },
  }));
  assert.ok(out.ok, JSON.stringify(out));
  const run = await runWithTenant("local", () => getRun(out.run.id));
  assert.equal(run.goal, null);
});

test("a very long ask is trimmed rather than shipped whole into a prompt", async () => {
  const { orchestrate } = await import("../orchestrator.mjs");
  const { getRun, runWithTenant } = await import("../store.mjs");
  const out = await runWithTenant("local", () => orchestrate({
    source: "assistant", via: "chat", plan: plan("Long ask"),
    session: { householdId: "local", actorId: "m-morgan", role: "Adult Admin" },
    goal: "x".repeat(5000),
  }));
  const run = await runWithTenant("local", () => getRun(out.run.id));
  assert.equal(run.goal.length, 2000, "bounded — a pasted wall of text is a prompt hazard");
});

test("a run born in a personal conversation keeps its approvals personal", async () => {
  const { orchestrate } = await import("../orchestrator.mjs");
  const { getRun, runWithTenant } = await import("../store.mjs");
  const out = await runWithTenant("local", () => orchestrate({
    source: "assistant", via: "chat", plan: plan("Private thing"),
    session: { householdId: "local", actorId: "m-morgan", role: "Adult Admin" },
    goal: "something just for me", visibility: "personal",
  }));
  const run = await runWithTenant("local", () => getRun(out.run.id));
  assert.equal(run.visibility, "personal", "a private ask does not announce itself to the household");
});

test("a household conversation still fans out, so nothing under-notifies", async () => {
  // The other direction matters as much: under-notifying an approval is the worse error, so
  // anything not explicitly personal stays household.
  const { orchestrate } = await import("../orchestrator.mjs");
  const { getRun, runWithTenant } = await import("../store.mjs");
  for (const visibility of [undefined, "household", "nest"]) {
    const out = await runWithTenant("local", () => orchestrate({
      source: "assistant", via: "chat", plan: plan("Shared thing"),
      session: { householdId: "local", actorId: "m-morgan", role: "Adult Admin" },
      goal: "dinner plan", visibility,
    }));
    const run = await runWithTenant("local", () => getRun(out.run.id));
    assert.equal(run.visibility, "household", `visibility=${visibility} → household`);
  }
});

test("an agent run carries its goal, not just the agent's name", async () => {
  // startRun's title for an agent run is the AGENT'S NAME, which tells a step-level model
  // nothing about what was asked of it.
  const r = await adult.req("/api/agents/agt_household/run", {
    method: "POST", body: JSON.stringify({ goal: "Summarise what's on this week" }),
  });
  // No AI provider in the harness, so planning may honestly refuse — assert only when a run
  // was actually created.
  if (r.status === 200 && r.data?.run?.id) {
    const { getRun, runWithTenant } = await import("../store.mjs");
    const run = await runWithTenant("local", () => getRun(r.data.run.id));
    assert.equal(run.goal, "Summarise what's on this week");
  }
});
