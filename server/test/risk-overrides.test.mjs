// Item 9 — per-entity risk-class overrides. An Owner/Adult Admin may re-class a
// tool's risk and skip its human-approval gate for THEIR household. Enforcement is
// server-owned (engine resolveTool); role-gated; audited; reversible. These tests
// prove the full loop: set → catalog reflects it → engine skips the gate → clear →
// the gate returns.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, admin, child;
before(async () => {
  ctx = await startServer();
  admin = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");   // Child View
});
after(async () => { await stopServer(ctx); });

// gmail.modifyLabels requires approval by default and needs a Google account —
// perfect probe: with the override, the step must NOT park for approval (it will
// fail later at not_connected, which is the honest expected outcome in tests).
const GATED_TOOL = "gmail.modifyLabels";
const PLAN = { title: "Override probe", steps: [{ toolId: GATED_TOOL, title: "Label", input: { messageIds: "x", addLabels: "Social" }, requiresApproval: true }] };

test("a child cannot set a risk override", async () => {
  const r = await child.req("/api/risk-overrides", { method: "PUT", body: JSON.stringify({ toolId: GATED_TOOL, skipApproval: true }) });
  assert.equal(r.status, 403);
});

test("an unknown tool id is rejected", async () => {
  const r = await admin.req("/api/risk-overrides", { method: "PUT", body: JSON.stringify({ toolId: "nope.not_a_tool", skipApproval: true }) });
  assert.equal(r.status, 404);
});

test("without an override, the gated tool parks the run for approval (baseline)", async () => {
  const r = await admin.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "manual", plan: PLAN }) });
  assert.equal(r.status, 200);
  const run = (await admin.req(`/api/runs/${r.data.run.id}`)).data.run;
  assert.equal(run.steps[0].status, "waiting_for_approval", "default gate holds");
});

test("an admin sets skip-approval; the catalog reports the effective value with the default preserved", async () => {
  const set = await admin.req("/api/risk-overrides", { method: "PUT", body: JSON.stringify({ toolId: GATED_TOOL, skipApproval: true, riskClass: "Low" }) });
  assert.equal(set.status, 200);
  const cat = (await admin.req("/api/risk-overrides")).data.catalog.find((t) => t.toolId === GATED_TOOL);
  assert.equal(cat.requiresApproval, false, "catalog shows the effective (skipped) gate");
  assert.equal(cat.defaultRequiresApproval, true, "the default is preserved, not erased");
  assert.equal(cat.risk, "Low");
  assert.equal(cat.riskOverridden, true);
});

test("with the override, the engine executes WITHOUT creating an approval", async () => {
  const r = await admin.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "manual", plan: PLAN }) });
  assert.equal(r.status, 200);
  const run = (await admin.req(`/api/runs/${r.data.run.id}`)).data.run;
  const step = run.steps[0];
  assert.notEqual(step.status, "waiting_for_approval", "did not park for approval");
  assert.equal(step.approvalId, null, "no approval record was created");
  // Honest failure is fine (no Google account in tests): execution was attempted and
  // parked "blocked" waiting for the connector — the point is the gate was skipped.
  assert.ok(["failed", "blocked", "succeeded", "running"].includes(step.status), `step progressed past the gate (got ${step.status})`);
});

test("clearing the override restores the approval gate", async () => {
  const del = await admin.req(`/api/risk-overrides/${encodeURIComponent(GATED_TOOL)}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  const r = await admin.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "manual", plan: PLAN }) });
  const run = (await admin.req(`/api/runs/${r.data.run.id}`)).data.run;
  assert.equal(run.steps[0].status, "waiting_for_approval", "gate is back after clearing");
});

test("a child cannot even list overrides (settings surface is admin-only)", async () => {
  const r = await child.req("/api/risk-overrides");
  assert.equal(r.status, 403);
});
