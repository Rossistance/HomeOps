// The assistant could not change a helper — and said it had (Jam 9eb8935b).
//
// Recorded: a family spent ten minutes asking the assistant to fix their briefing helper
// because it kept omitting an event. The assistant answered "Update agent · ag-briefing"
// and repeatedly confirmed the fix. It had 13 internal tools at the time and every one of
// them moved DATA — create_task, plan_meal, write_memory. Not one could read or write an
// agent. There was no capability behind the claim.
//
// That is the point of connecting a model at all: the intelligence layer has to be able to
// look at a helper, see what it's doing wrong, and change it. These tests prove the three
// tools do real work against the real store — read the current instructions, write new
// ones, and have them persist — so a claim of "I fixed it" is now backed by a diff.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-agent-tools-"));
const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
const { createAgent } = await import("../agents.mjs");
const { runWithTenant } = await import("../store.mjs");

const HH = "local";
const ctx = { householdId: HH, actorId: "m-owner", runId: "run_test" };
const call = (id, input) => runWithTenant(HH, () => INTERNAL_FUNCTIONS[id].run(ctx, input));

let briefingId;
before(async () => {
  await runWithTenant(HH, async () => {
    const a = createAgent({
      name: "Family Briefing Agent",
      purpose: "Summarize the day",
      instructions: "Each morning, summarize upcoming events for the family.",
    }, { householdId: HH, actorId: "m-owner" });
    briefingId = a.id;
  });
  assert.ok(briefingId, "seeded a helper to edit");
});
after(() => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {} });

test("the three helper tools exist at all — this is what was missing", () => {
  for (const id of ["homeops.list_agents", "homeops.get_agent", "homeops.update_agent"]) {
    assert.ok(INTERNAL_FUNCTIONS[id], `${id} must be callable by the assistant`);
  }
});

test("list_agents lets the assistant see the household's helpers", async () => {
  const r = await call("homeops.list_agents", {});
  assert.equal(r.ok, true);
  assert.ok(r.result.agents.some((a) => a.id === briefingId), "the briefing helper is listed");
});

test("get_agent returns the helper's REAL instructions, not a guess from its name", async () => {
  const r = await call("homeops.get_agent", { agentId: briefingId });
  assert.equal(r.ok, true);
  assert.match(r.result.instructions, /summarize upcoming events/i,
    "the model can read what the helper actually says before changing it");
});

test("THE FIX: update_agent really rewrites the instructions, and they persist", async () => {
  const fixed = "Each morning, summarize the family's events. Include events happening TODAY, even if their start time has already passed — they remain relevant until the day ends.";
  const r = await call("homeops.update_agent", { agentId: briefingId, instructions: fixed });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.result.changed, ["instructions"]);

  // Read it back through a SEPARATE call — the change is durable, not just echoed.
  const after = await call("homeops.get_agent", { agentId: briefingId });
  assert.equal(after.result.instructions, fixed, "the edit survived; this is what never happened before");
  assert.ok(after.result.version > 1, "and it is versioned, so the change is auditable");
});

test("update_agent returns a before/after diff, so 'I fixed it' is evidenced", async () => {
  const r = await call("homeops.update_agent", { agentId: briefingId, purpose: "Daily family briefing" });
  assert.equal(r.ok, true);
  assert.equal(r.result.after.purpose, "Daily family briefing");
  assert.notEqual(r.result.before.purpose, r.result.after.purpose, "the change is demonstrable, not asserted");
});

test("update_agent is APPROVAL-GATED — it changes unattended behaviour", () => {
  // A helper's instructions decide what it does on its own at 7am next week. That edit
  // should be signed off by the family, not slipped in during a chat turn.
  assert.equal(INTERNAL_FUNCTIONS["homeops.update_agent"].requiresApproval, true);
  assert.equal(INTERNAL_FUNCTIONS["homeops.get_agent"].requiresApproval, false, "reading stays free");
  assert.equal(INTERNAL_FUNCTIONS["homeops.list_agents"].requiresApproval, false);
});

test("a chat turn cannot widen a helper's PERMISSIONS", async () => {
  // Only name/purpose/instructions/status are writable here. Tool allow/deny lists stay
  // with the policy screens (WP-105), where the effective-policy view can explain them.
  const r = await call("homeops.update_agent", {
    agentId: briefingId,
    instructions: "still fine",
    allowedToolIds: ["sms.send"], deniedToolIds: [],
  });
  assert.equal(r.ok, true);
  const after = await call("homeops.get_agent", { agentId: briefingId });
  assert.ok(!(after.result.allowedToolIds ?? []).includes("sms.send"),
    "a conversation must not be able to grant a helper the ability to text people");
});

test("an unknown helper fails honestly instead of pretending", async () => {
  const r = await call("homeops.update_agent", { agentId: "agt_does_not_exist", instructions: "x" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "unknown_agent");
  assert.match(r.message, /no helper/i);
});

test("an empty edit is refused rather than reported as a change", async () => {
  const r = await call("homeops.update_agent", { agentId: briefingId });
  assert.equal(r.ok, false);
  assert.equal(r.error, "nothing_to_change");
});

test("another household's OWN helper is invisible", async () => {
  // Note: agents stored under "local" are shared by design — that's the resident-tenant
  // convention used throughout (`householdId === hh || householdId === "local"`), which is
  // how seeded helpers reach every family. The isolation that must hold is between two
  // real signed-up households, so seed one and check from the other side.
  const OTHER = "hh_someone_else";
  let foreignId;
  await runWithTenant(OTHER, async () => {
    const a = createAgent({ name: "Their helper", instructions: "private" }, { householdId: OTHER, actorId: "m-x" });
    foreignId = a.id;
  });
  const r = await runWithTenant(OTHER, () => INTERNAL_FUNCTIONS["homeops.get_agent"].run(ctx, { agentId: foreignId }));
  assert.equal(r.ok, false, "our household must not be able to read their helper");
  assert.equal(r.error, "unknown_agent");

  const w = await runWithTenant(OTHER, () => INTERNAL_FUNCTIONS["homeops.update_agent"].run(ctx, { agentId: foreignId, instructions: "hijacked" }));
  assert.equal(w.ok, false, "nor edit it");
  assert.equal(w.error, "unknown_agent");
});
