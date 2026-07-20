// FamiliOS — WP-005: homeops.notify_contact, the registry delivery tool.
//
// This is the mission's only change that EXPANDS unattended external-send authority,
// so the suite is written adversarially: most of these tests assert that a send does
// NOT happen. Every gate is probed from the outside, through the real server.
//
// NO REAL EMAIL IS EVER SENT HERE. No Google account is connected in the harness
// tenant, so the Gmail branch of notify.mjs terminates at its "not connected" guard
// before any network call. The tests assert the DECISION each gate reaches — which is
// the security property that matters — rather than mocking a transport and trusting it.
//
// Gates under test (all must fail CLOSED):
//   1. no acting agent            → refuses (the allowlist is per-agent; no agent, no gate)
//   2. unregistered recipient     → refuses, never invents a contact method
//   3. unverified method          → refuses
//   4. not opted in               → refuses
//   5. agent not on the allowlist → refuses (agent_not_allowed)
//   6. household kill switch on   → refuses, nothing sent
//   7. all gates satisfied        → proceeds to the channel, and reports the REAL
//                                    transport outcome honestly (here: Google not
//                                    connected) rather than claiming delivery.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTerminal(runId, extra = [], timeoutMs = 25000) {
  const terminal = ["completed", "failed", "cancelled", "expired", ...extra];
  const t0 = Date.now();
  let run = null;
  while (Date.now() - t0 < timeoutMs) {
    const r = await owner.req(`/api/runs/${runId}`);
    run = r.data?.run ?? null;
    if (run && terminal.includes(run.status)) return run;
    await sleep(250);
  }
  return run;
}

// Run a one-step notify_contact plan AS a given agent, and return the step's outcome.
async function notifyStep({ agentId, input }) {
  const skill = await owner.req("/api/skills", {
    method: "POST",
    body: JSON.stringify({
      name: `TG-notify-${Math.random().toString(16).slice(2, 8)}`,
      description: "TG test: registry delivery",
      domain: "Family",
      steps: [{ step_id: "s1", name: "Send to contact", tool_id: "homeops.notify_contact", approval_required: false, input_mapping: input }],
    }),
  });
  const skillId = skill.data?.skill?.id;
  assert.ok(skillId, `skill creation failed: ${JSON.stringify(skill.data)}`);
  const tr = await owner.req("/api/triggers", {
    method: "POST",
    body: JSON.stringify({ name: "TG-notify trigger", type: "manual", target: { kind: "agent", agentId, skillId } }),
  });
  const fire = await owner.req(`/api/triggers/${tr.data.trigger.id}/fire`, { method: "POST", body: JSON.stringify({}) });
  const run = await waitTerminal(fire.data.runId, ["waiting_for_approval", "waiting_for_connector"]);
  return { run, step: run?.steps?.[0] };
}

async function makeMethod({ label, value, verified, optInStatus, allowedAgentIds }) {
  const r = await owner.req("/api/contact-methods", {
    method: "POST",
    body: JSON.stringify({ label, type: "Email", value, verified, optInStatus, allowedAgentIds }),
  });
  assert.ok(r.data?.contactMethod, `contact method creation failed: ${JSON.stringify(r.data)}`);
  return r.data.contactMethod;
}

let agent, otherAgent;

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex"); // Owner (adult) — may self-attest verified
  const a = await owner.req("/api/agents", {
    method: "POST",
    body: JSON.stringify({ name: "TG-Briefing Agent", purpose: "TG test", instructions: "test", status: "Active", allowedFunctionIds: ["homeops.notify_contact"] }),
  });
  agent = a.data.agent;
  const b = await owner.req("/api/agents", {
    method: "POST",
    body: JSON.stringify({ name: "TG-Other Agent", purpose: "TG test", instructions: "test", status: "Active", allowedFunctionIds: ["homeops.notify_contact"] }),
  });
  otherAgent = b.data.agent;
});
after(async () => { await stopServer(ctx); });

describe("WP-005 — homeops.notify_contact fails closed at every gate", () => {
  test("the tool is registered and exposed to the planner catalog", async () => {
    const r = await owner.req("/api/functions/tool-catalog");
    const ids = JSON.stringify(r.data ?? {});
    assert.match(ids, /homeops\.notify_contact/, "the delivery tool must be in the live catalog");
  });

  test("GATE 1 — an unregistered recipient is refused, never invented", async () => {
    const { step } = await notifyStep({
      agentId: agent.id,
      input: { to: "tg-nobody@example.invalid", subject: "TG", body: "TG test body long enough to pass the empty check." },
    });
    assert.equal(step.status, "failed", "an unknown recipient must not be delivered to");
    assert.match(String(step.detail), /isn't a verified contact method|not a verified/i,
      "and the refusal must name what to do about it");
  });

  test("GATE 2 — an UNVERIFIED method is refused", async () => {
    const m = await makeMethod({ label: "TG-unverified", value: "tg-unverified@example.invalid", verified: false, optInStatus: "Opted In", allowedAgentIds: [agent.id] });
    const { step } = await notifyStep({ agentId: agent.id, input: { methodId: m.id, subject: "TG", body: "TG test body long enough to pass." } });
    assert.equal(step.status, "failed");
    assert.match(String(step.detail), /verif/i, "an unverified address must never receive a send");
  });

  test("GATE 3 — a method that has NOT opted in is refused", async () => {
    const m = await makeMethod({ label: "TG-nooptin", value: "tg-nooptin@example.invalid", verified: true, optInStatus: "Pending", allowedAgentIds: [agent.id] });
    const { step } = await notifyStep({ agentId: agent.id, input: { methodId: m.id, subject: "TG", body: "TG test body long enough to pass." } });
    assert.equal(step.status, "failed");
    assert.match(String(step.detail), /opted in/i, "opt-in is a real gate, not decoration");
  });

  test("GATE 4 — an agent NOT on the allowlist is refused (agent_not_allowed)", async () => {
    const m = await makeMethod({ label: "TG-allowlisted", value: "tg-allow@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [agent.id] });
    // otherAgent is deliberately absent from allowedAgentIds.
    const { step } = await notifyStep({ agentId: otherAgent.id, input: { methodId: m.id, subject: "TG", body: "TG test body long enough to pass." } });
    assert.equal(step.status, "failed");
    assert.match(String(step.detail), /isn't allowed to message/i,
      "the per-agent allowlist IS the standing consent — a different agent must not inherit it");
  });

  test("GATE 5 — the household kill switch stops delivery outright", async () => {
    const m = await makeMethod({ label: "TG-killswitch", value: "tg-kill@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [agent.id] });
    await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ externalActionsEnabled: false }) });
    try {
      const { step } = await notifyStep({ agentId: agent.id, input: { methodId: m.id, subject: "TG", body: "TG test body long enough to pass." } });
      assert.equal(step.status, "failed", "a paused household must not send");
      assert.match(String(step.detail), /kill switch|paused/i, "and must say the switch is why");
    } finally {
      await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ externalActionsEnabled: true }) });
    }
  });

  test("GATE 6 — an empty body is refused (no blank briefings)", async () => {
    const m = await makeMethod({ label: "TG-empty", value: "tg-empty@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [agent.id] });
    const { step } = await notifyStep({ agentId: agent.id, input: { methodId: m.id, subject: "TG", body: "" } });
    assert.equal(step.status, "failed");
  });

  test("ALL GATES PASS — the send proceeds to the channel and reports the transport truth", async () => {
    const m = await makeMethod({ label: "TG-ready", value: "tg-ready@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [agent.id] });
    const { step } = await notifyStep({ agentId: agent.id, input: { methodId: m.id, subject: "TG briefing", body: "TG test body long enough to pass the empty check." } });
    // No Google account is connected in this harness tenant, so the honest outcome is
    // "connect Google" — NOT a claim of delivery. That distinction is the entire point
    // of this work package: the system reports what actually happened to the message.
    assert.equal(step.status, "failed", "with no mail account connected, this must NOT report success");
    assert.match(String(step.detail), /Connect a Google account|re-authorized|Send email permission/i,
      "the failure must name the real, actionable cause");
    assert.doesNotMatch(String(step.detail), /isn't allowed|verif|opted in/i,
      "all registry gates passed — the only remaining obstacle is the transport");
  });

  /* ---------------------------------------------------------------- *
   * Findings from the mandatory adversarial security review of WP-005.
   * Each of these was EXPLOITABLE before the fix; they are pinned here so
   * the fix cannot be quietly undone.
   * ---------------------------------------------------------------- */

  test("C1 — a client cannot supply sourceRef.agentId and inherit an agent's send consent", async () => {
    const m = await makeMethod({ label: "TG-c1", value: "tg-c1@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [agent.id] });
    // The attack: name an allowlisted agent in a hand-rolled run, with no legitimate
    // association to it, and inherit its standing consent.
    const r = await owner.req("/api/runs/start", {
      method: "POST",
      body: JSON.stringify({
        plan: { title: "TG-impersonation", summary: "", steps: [{ toolId: "homeops.notify_contact", title: "Send", detail: "", input: { methodId: m.id, subject: "TG", body: "TG impersonation attempt body." }, requiresApproval: false }] },
        sourceRef: { agentId: agent.id },
      }),
    });
    const runId = r.data?.run?.id ?? r.data?.runId;
    assert.ok(runId, `run should start: ${JSON.stringify(r.data).slice(0, 200)}`);
    const run = await waitTerminal(runId, ["waiting_for_approval", "waiting_for_connector"]);
    const step = run.steps[0];
    assert.equal(step.status, "failed", "an impersonated agent identity must not deliver");
    assert.match(String(step.detail), /needs to run as a specific helper/i,
      "the run must land with NO acting agent, so the allowlist gate cannot be satisfied");
    assert.equal(run.sourceRef?.agentId ?? null, null, "agent identity is server-assigned only; it must be stripped from client input");
  });

  test("C2 — changing a contact method's address clears its agent allowlist", async () => {
    const m = await makeMethod({ label: "TG-c2", value: "tg-c2@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [agent.id] });
    assert.deepEqual(m.allowedAgentIds, [agent.id]);
    const upd = await owner.req(`/api/contact-methods/${m.id}`, { method: "PATCH", body: JSON.stringify({ value: "tg-c2-moved@example.invalid" }) });
    const after = upd.data?.contactMethod;
    assert.equal(after.verified, false, "a new address is unverified");
    assert.deepEqual(after.allowedAgentIds, [], "standing send consent must NOT survive a repoint to a different address");
  });

  test("C3 — a non-adult cannot grant an agent permission to message a contact", async () => {
    const child = await makeSession(ctx, "m-lily"); // Child View
    const own = await child.req("/api/contact-methods", {
      method: "POST",
      body: JSON.stringify({ label: "TG-c3", type: "Email", value: "tg-c3@example.invalid", allowedAgentIds: [agent.id] }),
    });
    if (own.status < 400) {
      assert.deepEqual(own.data.contactMethod.allowedAgentIds, [],
        "a non-adult must not be able to mint standing send authority at creation time");
      const patched = await child.req(`/api/contact-methods/${own.data.contactMethod.id}`, { method: "PATCH", body: JSON.stringify({ allowedAgentIds: [agent.id] }) });
      assert.equal(patched.status, 403, "nor by patching it afterwards");
    }
  });

  test("C3b — an allowlist entry must resolve to a real agent in this household", async () => {
    const r = await owner.req("/api/contact-methods", {
      method: "POST",
      body: JSON.stringify({ label: "TG-c3b", type: "Email", value: "tg-c3b@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: ["agt_does_not_exist"] }),
    });
    assert.deepEqual(r.data.contactMethod.allowedAgentIds, [], "a phantom agent id must not be stored as consent");
  });

  test("H1 — deleting an agent revokes its standing send consent", async () => {
    const tmp = await owner.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "TG-Doomed Agent", purpose: "TG", instructions: "TG", status: "Active", allowedFunctionIds: ["homeops.notify_contact"] }) });
    const tmpId = tmp.data.agent.id;
    const m = await makeMethod({ label: "TG-h1", value: "tg-h1@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [tmpId] });
    await owner.req(`/api/agents/${tmpId}`, { method: "DELETE" });
    const after = (await owner.req(`/api/contact-methods`)).data.contactMethods.find((x) => x.id === m.id);
    assert.ok(!(after.allowedAgentIds ?? []).includes(tmpId),
      "deleting a helper is how a family revokes it — the grant must not outlive the agent");
  });

  test("H1b — a run naming a deleted agent fails closed instead of running unpoliced", async () => {
    const tmp = await owner.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "TG-Ghost", purpose: "TG", instructions: "TG", status: "Active", allowedFunctionIds: ["homeops.notify_contact"] }) });
    const tmpId = tmp.data.agent.id;
    const m = await makeMethod({ label: "TG-h1b", value: "tg-h1b@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [tmpId] });
    const tr = await owner.req("/api/triggers", { method: "POST", body: JSON.stringify({ name: "TG-ghost trigger", type: "manual", target: { kind: "agent", agentId: tmpId, goal: "notify the contact" } }) });
    await owner.req(`/api/agents/${tmpId}`, { method: "DELETE" });
    const fire = await owner.req(`/api/triggers/${tr.data.trigger.id}/fire`, { method: "POST", body: JSON.stringify({}) });
    // Either the fire is refused outright, or the run fails closed — never an
    // unpoliced run that still carries the deleted agent's identity.
    if (fire.data?.runId) {
      const run = await waitTerminal(fire.data.runId, ["waiting_for_approval", "waiting_for_connector"]);
      assert.notEqual(run.status, "completed", "a run naming a deleted helper must not complete unpoliced");
    } else {
      assert.ok(fire.data?.error, "the fire must fail with a stated reason");
    }
  });

  test("H2 — /api/notify to an EXTERNAL channel requires an adult", async () => {
    const child = await makeSession(ctx, "m-lily");
    const m = await makeMethod({ label: "TG-h2", value: "tg-h2@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [agent.id] });
    const r = await child.req("/api/notify", { method: "POST", body: JSON.stringify({ methodId: m.id, title: "TG", body: "TG external send attempt" }) });
    assert.equal(r.status, 403, "omitting agentId must not be a way around the allowlist");
  });

  test("the step is never silently dropped from the run", async () => {
    const m = await makeMethod({ label: "TG-trace", value: "tg-trace@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [agent.id] });
    const { run } = await notifyStep({ agentId: agent.id, input: { methodId: m.id, subject: "TG", body: "TG test body long enough to pass." } });
    assert.equal(run.steps.length, 1, "the delivery step must remain in the durable trace");
    assert.equal(run.steps[0].toolId, "homeops.notify_contact");
  });
});
