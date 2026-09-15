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
import { startServer, stopServer, makeSession, readStoreRecord } from "./harness.mjs";
import { useFakeModel } from "./fake-model.mjs";

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

test("a durable run born inside a helper's turn carries the ASK, not just the step's name", async () => {
  /* The route-level half of the first test. It used to POST /api/agents/:id/run, whose title
   * for an agent run was the AGENT'S NAME — telling a step-level model nothing about what was
   * asked of it. That route is gone with the seven-concepts collapse: a helper runs the chat
   * tool loop, and the only durable run it creates is the one an approval-gated tool parks.
   * That run is where the goal has to land, so this checks it there. */
  const fake = await useFakeModel(adult);
  try {
    const helper = (await adult.req("/api/helpers", {
      method: "POST",
      body: JSON.stringify({ name: "Goal Carrier", instructions: "Raise an approval whenever something needs a person to sign it off." }),
    })).data.helper;
    fake.state.script = [
      { toolCalls: [{ name: "homeops__create_approval", args: { subject: "Confirm the dentist", detail: "Amelia, the 14th" } }] },
      { text: "Raised it for the family to approve." },
    ];
    const ran = await adult.req(`/api/helpers/${helper.id}/run`, { method: "POST" });
    assert.equal(ran.status, 200, JSON.stringify(ran.data));
    const runId = (ran.data.runIds ?? [])[0];
    assert.ok(runId, `the gated step must have parked a durable run: ${JSON.stringify(ran.data).slice(0, 300)}`);

    /* Read out of the SPAWNED server's own data dir: this run was created over there, and
     * publicRun deliberately does not echo `goal` back, so the route cannot answer for it. */
    const run = readStoreRecord(ctx, "runs", runId);
    assert.ok(run, "the parked run is in the server's store");
    assert.ok(run.goal, "a parked run must say what was being attempted");
    assert.match(run.goal, /Do your job/, "and the ask is the helper's own, in the words it was given");
    assert.notEqual(run.goal, run.title, "the step's name is not a substitute for the request");
  } finally {
    await new Promise((r) => fake.server.close(r));
  }
});
