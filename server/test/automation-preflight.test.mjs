// WP-101 slice 4 — POST /api/automations/validate: the "compile step" template
// instantiation never had. Exercises the real server route (session/CSRF/role gating,
// the real agent + tool + connector registries) through the harness, never the module
// in isolation, so these tests prove the WIRED behavior a sibling client is coding
// against, not just the validator function.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, readStoreDoc } from "./harness.mjs";

let ctx, owner, adultAdmin;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");        // Owner
  adultAdmin = await makeSession(ctx, "m-morgan");  // Adult Admin
});
after(async () => { await stopServer(ctx); });

function validate(client, body) {
  return client.req("/api/automations/validate", { method: "POST", body: JSON.stringify(body) });
}

test("authz: no session is refused", async () => {
  const r = await ctx.fetch("/api/automations/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan: { steps: [] } }),
  });
  assert.equal(r.status, 401);
});

test("a valid plan (household-default agent, real internal tool) resolves ready", async () => {
  const plan = { title: "Add a chore", steps: [{ toolId: "homeops.create_task", title: "Add task", input: { title: "Take out trash" } }] };
  const r = await validate(owner, { plan });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.lifecycleState, "ready");
  assert.deepEqual(r.data.errors, []);
  assert.equal(typeof r.data.compiledManifestVersion, "string");
  assert.ok(r.data.compiledManifestVersion.length > 0);
});

test("compiledManifestVersion is a stable hash of the same graph", async () => {
  const plan = { title: "Add a chore", steps: [{ toolId: "homeops.create_task", title: "Add task", input: { title: "Take out trash" } }] };
  const a = await validate(owner, { plan, templateId: "tmpl_chore" });
  const b = await validate(owner, { plan, templateId: "tmpl_chore" });
  assert.equal(a.data.compiledManifestVersion, b.data.compiledManifestVersion);
  const c = await validate(owner, { plan: { ...plan, title: "Different" }, templateId: "tmpl_chore" });
  assert.notEqual(a.data.compiledManifestVersion, c.data.compiledManifestVersion);
});

test("a reasoning step (toolId: null) needs no handler and doesn't block", async () => {
  const plan = { steps: [{ toolId: null, title: "Think about it", detail: "no tool needed" }] };
  const r = await validate(owner, { plan });
  assert.equal(r.data.ok, true);
  assert.equal(r.data.lifecycleState, "ready");
});

test("an explicit agentId that doesn't exist blocks with missing_agent", async () => {
  const plan = { steps: [] };
  const r = await validate(owner, { plan, agentId: "agt_does_not_exist" });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, false);
  assert.equal(r.data.lifecycleState, "blocked_configuration");
  const err = r.data.errors.find((e) => e.kind === "missing_agent");
  assert.ok(err, "expected a missing_agent error");
  assert.equal(err.node, "agent");
  assert.equal(err.repairSurface, "/agents");
});

test("an archived agent named explicitly also blocks with missing_agent", async () => {
  const created = await adultAdmin.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "Retiring Helper" }) });
  const agentId = created.data.agent.id;
  const archived = await adultAdmin.req(`/api/agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ status: "Archived" }) });
  assert.equal(archived.data.agent.status, "Archived");
  const r = await validate(owner, { plan: { steps: [] }, agentId });
  assert.equal(r.data.ok, false);
  assert.ok(r.data.errors.some((e) => e.kind === "missing_agent"), "an archived agent must not resolve as the acting agent");
});

test("an unknown tool step blocks with missing_handler", async () => {
  const plan = { steps: [{ toolId: "not.a.real.tool", title: "Do the impossible" }] };
  const r = await validate(owner, { plan });
  assert.equal(r.data.ok, false);
  assert.equal(r.data.lifecycleState, "blocked_configuration");
  const err = r.data.errors.find((e) => e.kind === "missing_handler");
  assert.ok(err, "expected a missing_handler error");
  assert.equal(err.node, "step[0].tool");
  assert.equal(err.repairSurface, "/automations");
});

test("a real but disconnected integration blocks with missing_integration (node names the connector)", async () => {
  // Fresh test household has no Google account connected, so gmail.send resolves as a
  // real handler but fails the per-actor connectedness check.
  const plan = { steps: [{ toolId: "gmail.send", title: "Send email", input: { to: "friend@example.com", subject: "Hi", body: "Hello there" } }] };
  const r = await validate(owner, { plan });
  assert.equal(r.data.ok, false);
  const err = r.data.errors.find((e) => e.kind === "missing_integration");
  assert.ok(err, "expected a missing_integration error");
  assert.equal(err.node, "integration.google");
  assert.equal(err.repairSurface, "/connections");
  // The step's real `to` was provided — this must NOT also fire missing_recipient.
  assert.ok(!r.data.errors.some((e) => e.kind === "missing_recipient"));
});

test("an external-send step with no recipient blocks with missing_recipient", async () => {
  // homeops.notify_contact is an always-connected internal tool, so this isolates the
  // recipient check from the (separately tested) integration check above.
  const plan = { steps: [{ toolId: "homeops.notify_contact", title: "Notify someone", input: { body: "Reminder: pickup at 5" } }] };
  const r = await validate(owner, { plan });
  assert.equal(r.data.ok, false);
  assert.equal(r.data.errors.length, 1, "only the recipient should be flagged");
  const err = r.data.errors[0];
  assert.equal(err.kind, "missing_recipient");
  assert.equal(err.node, "step[0].recipient");
});

test("supplying a recipient (methodId) on the same tool clears missing_recipient", async () => {
  const plan = { steps: [{ toolId: "homeops.notify_contact", title: "Notify someone", input: { body: "Reminder: pickup at 5", methodId: "ct-alex-email" } }] };
  const r = await validate(owner, { plan });
  assert.ok(!r.data.errors.some((e) => e.kind === "missing_recipient"));
});

test("an unresolved multi-agent role blocks with unresolved_multi_agent_role", async () => {
  const plan = { steps: [] };
  const r = await validate(owner, { plan, multiAgentRoles: [{ name: "Ghost Agent", role: "researcher" }] });
  assert.equal(r.data.ok, false);
  const err = r.data.errors.find((e) => e.kind === "unresolved_multi_agent_role");
  assert.ok(err, "expected an unresolved_multi_agent_role error");
  assert.equal(err.node, "multiAgentRoles[0]");
  assert.equal(err.repairSurface, "/agents");
});

test("a multi-agent role that DOES resolve (by name) does not block", async () => {
  const created = await adultAdmin.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "Research Helper" }) });
  assert.equal(created.status, 200);
  const plan = { steps: [] };
  const r = await validate(owner, { plan, multiAgentRoles: [{ name: "Research Helper", role: "researcher" }] });
  assert.equal(r.data.ok, true);
  assert.equal(r.data.lifecycleState, "ready");
});

test("malformed body without a plan is a 400, not a validation result", async () => {
  const r = await owner.req("/api/automations/validate", { method: "POST", body: JSON.stringify({ agentId: "agt_household" }) });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "plan_required");
});

test("the endpoint creates nothing — store state is byte-identical before and after", async () => {
  const before = {
    agents: readStoreDoc(ctx, "agents.json", {}),
    tasks: readStoreDoc(ctx, "tasks.json", {}),
    artifacts: readStoreDoc(ctx, "artifacts.json", {}),
    memory: readStoreDoc(ctx, "memory.json", {}),
  };
  // A step referencing homeops.create_task (which, if EXECUTED, writes a task) and one
  // referencing homeops.notify_contact (which, if executed, could deliver a message) —
  // exactly the two write/send tools whose registries this endpoint reads but must
  // never invoke.
  const plan = {
    steps: [
      { toolId: "homeops.create_task", title: "Add task", input: { title: "Should never be created" } },
      { toolId: "homeops.notify_contact", title: "Notify", input: { body: "Should never be sent", methodId: "ct-alex-email" } },
    ],
  };
  const r = await validate(owner, { plan, agentId: "agt_household" });
  assert.equal(r.status, 200);
  const after = {
    agents: readStoreDoc(ctx, "agents.json", {}),
    tasks: readStoreDoc(ctx, "tasks.json", {}),
    artifacts: readStoreDoc(ctx, "artifacts.json", {}),
    memory: readStoreDoc(ctx, "memory.json", {}),
  };
  assert.deepEqual(after, before, "validate must never create/modify/delete anything");
});
