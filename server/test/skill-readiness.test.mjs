// WP-108 / ISS-117: "Skill builder allows real tests against incomplete handlers."
//
// "Infer capabilities" produced drafts whose steps named no handler — or named one the
// household doesn't have — and Real Test stayed pressable throughout. The only way to
// find out was to run it and read the wreckage: "Finish configuring the handler before
// testing"; "the app should be doing this by itself."
//
// The gate lives on the SERVER, not just in the button's disabled state. A disabled
// button alone would be the same decorative control this mission already found in the
// approval policy — right up until something calls the API directly.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner;

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
});
after(async () => { await stopServer(ctx); });

async function makeSkill(steps, name = "Draft skill") {
  const r = await owner.req("/api/skills", {
    method: "POST",
    body: JSON.stringify({ name, description: "test draft", planner_guidance: "n/a", steps }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.skill;
}
const readiness = async (id) => (await owner.req(`/api/skills/${id}/readiness`)).data.readiness;
const runTest = (id) => owner.req(`/api/skills/${id}/test`, { method: "POST", body: JSON.stringify({}) });

test("ISS-117: a step with NO handler is unresolved, and the real test is refused", async () => {
  const skill = await makeSkill([
    { step_id: "s1", name: "Look up the daycare email", tool_id: null, input_mapping: {}, approval_required: false },
  ]);

  const r = await readiness(skill.id);
  assert.equal(r.ready, false);
  assert.equal(r.unresolved.length, 1);
  assert.equal(r.unresolved[0].reason, "no_handler");
  assert.equal(r.unresolved[0].name, "Look up the daycare email", "names the step, so it's actionable");

  const attempt = await runTest(skill.id);
  assert.equal(attempt.status, 422, "the server refuses — not just a greyed-out button");
  assert.equal(attempt.data.error, "skill_not_ready");
  assert.equal(attempt.data.unresolved.length, 1, "and the refusal carries the list, not a bare code");
});

test("ISS-117: a step citing a capability the household doesn't have is unresolved", async () => {
  const skill = await makeSkill([
    { step_id: "s1", name: "Send the form", tool_id: "daycare.submitForm", input_mapping: {}, approval_required: true },
  ]);
  const r = await readiness(skill.id);
  assert.equal(r.ready, false);
  assert.equal(r.unresolved[0].reason, "unknown_capability");
  assert.equal(r.unresolved[0].toolId, "daycare.submitForm");
  assert.match(r.unresolved[0].detail, /daycare\.submitForm/, "the exact missing dependency is named");
  assert.equal((await runTest(skill.id)).status, 422);
});

test("ISS-117: a skill with no steps at all is not runnable", async () => {
  const skill = await makeSkill([]);
  const r = await readiness(skill.id);
  assert.equal(r.ready, false);
  assert.equal(r.unresolved[0].reason, "no_steps");
  assert.equal((await runTest(skill.id)).status, 422);
});

test("ISS-117: a fully-bound skill IS ready, and the real test is allowed through", async () => {
  // weather.current is an always-available internal/provider capability in the catalog.
  const skill = await makeSkill([
    { step_id: "s1", name: "Check the weather", tool_id: "weather.current", input_mapping: {}, approval_required: false },
  ], "Complete skill");

  const r = await readiness(skill.id);
  assert.equal(r.ready, true, JSON.stringify(r.unresolved));
  assert.equal(r.unresolved.length, 0);

  const attempt = await runTest(skill.id);
  assert.notEqual(attempt.data.error, "skill_not_ready", "readiness must not block a complete skill");
});

test("ISS-117 (the recorded Daycare flow): a PARTIALLY inferred draft reports every gap at once", async () => {
  // The shape the recording produced: inference bound the step it could and left the
  // rest dangling. A family needs the WHOLE list, not the first failure — otherwise
  // fixing one thing just reveals the next.
  const skill = await makeSkill([
    { step_id: "s1", name: "Check the weather", tool_id: "weather.current", input_mapping: {}, approval_required: false },
    { step_id: "s2", name: "Read the daycare newsletter", tool_id: null, input_mapping: {}, approval_required: false },
    { step_id: "s3", name: "File it in the daycare folder", tool_id: "daycare.fileDocument", input_mapping: {}, approval_required: true },
  ], "Daycare agent");

  const r = await readiness(skill.id);
  assert.equal(r.ready, false);
  assert.equal(r.unresolved.length, 2, "both gaps reported together, not one at a time");
  assert.deepEqual(r.unresolved.map((u) => u.reason).sort(), ["no_handler", "unknown_capability"]);
  assert.ok(!r.unresolved.some((u) => u.stepId === "s1"), "the step that IS bound is not flagged");

  const attempt = await runTest(skill.id);
  assert.equal(attempt.status, 422);
  assert.equal(attempt.data.unresolved.length, 2);
});
