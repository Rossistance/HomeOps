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
// HOW A SEND IS DRIVEN NOW. The seven agent concepts became one Helper, and running a
// helper is running the Ask Famili tool loop with that helper's standing instructions. So a
// send is no longer a hand-written skill step inside a durable plan: it is the model calling
// homeops.notify_contact during a helper's turn, and the outcome is the toolCall the turn
// records. That is a closer match to how a family actually reaches this tool, and the gates
// below are untouched by it — the acting helper's identity, which IS the consent, still
// comes from the helper being run and from nowhere else.
//
// Gates under test (all must fail CLOSED):
//   1. no acting helper           → refuses (the allowlist is per-helper; no helper, no gate)
//   2. unregistered recipient     → WP-002 slice 3: falls back to an honest, real
//                                    in-app notification to the REQUESTER instead of a
//                                    hard refusal — but STILL never invents a contact
//                                    method for the unregistered recipient, and can
//                                    NEVER reach email/SMS this way (see GATE 1 below).
//   3. unverified method          → refuses (fallback does NOT apply — the method
//                                    exists, the household just hasn't verified it)
//   4. not opted in               → refuses (fallback does NOT apply, same reason)
//   5. helper not on the allowlist → refuses (agent_not_allowed)
//   6. household kill switch on   → refuses, nothing sent
//   7. all gates satisfied        → proceeds to the channel, and reports the REAL
//                                    transport outcome honestly (here: Google not
//                                    connected) rather than claiming delivery.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { useFakeModel } from "./fake-model.mjs";

let ctx, owner, fake;
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

/* Run notify_contact AS a given helper, and return the toolCall the turn recorded.
 * The model is scripted to make exactly that one call, so the helper's identity — the only
 * thing the allowlist gate reads — is the helper being run and nothing the test asserts. */
async function notifyStep({ helperId, input }) {
  fake.state.script = [
    { toolCalls: [{ name: "homeops__notify_contact", args: input }] },
    { text: "That's what I did." },
  ];
  const r = await owner.req(`/api/helpers/${helperId}/run`, { method: "POST" });
  const step = (r.data?.toolCalls ?? []).find((c) => c.tool === "homeops.notify_contact");
  assert.ok(step, `the delivery tool was never reached: ${JSON.stringify(r.data).slice(0, 400)}`);
  return { run: r.data, step };
}

async function makeMethod({ label, value, verified, optInStatus, allowedAgentIds }) {
  const r = await owner.req("/api/contact-methods", {
    method: "POST",
    body: JSON.stringify({ label, type: "Email", value, verified, optInStatus, allowedAgentIds }),
  });
  assert.ok(r.data?.contactMethod, `contact method creation failed: ${JSON.stringify(r.data)}`);
  return r.data.contactMethod;
}

const INSTRUCTIONS = "When the family asks, send the briefing to the contact method they name, and never to anyone else.";
async function makeHelper(name) {
  const r = await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({ name, purpose: "TG test", instructions: INSTRUCTIONS }) });
  assert.equal(r.status, 200, `helper creation failed: ${JSON.stringify(r.data)}`);
  return r.data.helper;
}

let helper, otherHelper;

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex"); // Owner (adult) — may self-attest verified
  fake = await useFakeModel(owner);
  helper = await makeHelper("TG-Briefing Helper");
  otherHelper = await makeHelper("TG-Other Helper");
});
after(async () => { await stopServer(ctx); await new Promise((r) => fake.server.close(r)); });

describe("WP-005 — homeops.notify_contact fails closed at every gate", () => {
  test("the tool is registered and reaches the model's own menu", async () => {
    /* This used to read GET /api/functions/tool-catalog, which is gone with the Function
     * concept. Asserting it on the tools the MODEL was actually handed is the stronger
     * version of the same claim: a tool listed in a catalog nobody passes to the model is
     * not reachable, and that is what this was guarding against. */
    const m = await makeMethod({ label: "TG-menu", value: "tg-menu@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [helper.id] });
    await notifyStep({ helperId: helper.id, input: { methodId: m.id, subject: "TG", body: "TG test body long enough to pass." } });
    const toolNames = (fake.state.requests.at(-1)?.tools ?? []).map((t) => t.function?.name ?? t.name);
    assert.ok(toolNames.includes("homeops__notify_contact"), "the delivery tool must be on the live menu");
  });

  // WP-002 slice 3 — CHANGED FROM A HARD REFUSAL. Before this WP, an unregistered
  // recipient made notify_contact fail outright: a plain, un-set-up chat ask ("let
  // them know...") did NOTHING — not even the honesty of a visible result. This test
  // used to assert `step.status === "failed"`; that assertion embodied exactly the
  // "refuse instead of deliver anything at all" behavior WP-002 was scoped to fix (see
  // the mission's acceptance criterion: "notify_contact with no method delivers
  // in-app"). The recipient is still never invented — no contact method is created —
  // and this path can never reach email/SMS (deliverInAppFallback only ever writes the
  // in_app channel), so gates 2 (verified) through 6 (kill switch) below are untouched.
  test("GATE 1 — an unregistered recipient falls back to an honest in-app notification, and still never invents a contact method", async () => {
    const { step } = await notifyStep({
      helperId: helper.id,
      input: { to: "tg-nobody@example.invalid", subject: "TG", body: "TG test body long enough to pass the empty check." },
    });
    assert.equal(step.status, "done", "an unregistered recipient now falls back to an honest in-app delivery instead of a hard refusal");
    assert.match(String(step.summary ?? ""), /in-app/i, "and the card says which channel it really used");
    const methods = await owner.req("/api/contact-methods");
    assert.ok(!(methods.data?.contactMethods ?? []).some((m) => String(m.value ?? "").toLowerCase() === "tg-nobody@example.invalid"),
      "no contact method may be invented for the unregistered recipient");
  });

  test("GATE 2 — an UNVERIFIED method is refused", async () => {
    const m = await makeMethod({ label: "TG-unverified", value: "tg-unverified@example.invalid", verified: false, optInStatus: "Opted In", allowedAgentIds: [helper.id] });
    const { step } = await notifyStep({ helperId: helper.id, input: { methodId: m.id, subject: "TG", body: "TG test body long enough to pass." } });
    assert.equal(step.ok, false);
    assert.match(String(step.summary), /verif/i, "an unverified address must never receive a send");
  });

  test("GATE 3 — a method that has NOT opted in is refused", async () => {
    const m = await makeMethod({ label: "TG-nooptin", value: "tg-nooptin@example.invalid", verified: true, optInStatus: "Pending", allowedAgentIds: [helper.id] });
    const { step } = await notifyStep({ helperId: helper.id, input: { methodId: m.id, subject: "TG", body: "TG test body long enough to pass." } });
    assert.equal(step.ok, false);
    assert.match(String(step.summary), /opted in/i, "opt-in is a real gate, not decoration");
  });

  test("GATE 4 — a helper NOT on the allowlist is refused (agent_not_allowed)", async () => {
    const m = await makeMethod({ label: "TG-allowlisted", value: "tg-allow@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [helper.id] });
    // otherHelper is deliberately absent from allowedAgentIds — and running it is the ONLY
    // way to act as it, which is what makes the allowlist mean something.
    const { step } = await notifyStep({ helperId: otherHelper.id, input: { methodId: m.id, subject: "TG", body: "TG test body long enough to pass." } });
    assert.equal(step.ok, false);
    assert.match(String(step.summary), /isn't allowed to message/i,
      "the per-helper allowlist IS the standing consent — a different helper must not inherit it");
  });

  test("GATE 5 — the household kill switch stops delivery outright", async () => {
    const m = await makeMethod({ label: "TG-killswitch", value: "tg-kill@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [helper.id] });
    await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ externalActionsEnabled: false }) });
    try {
      const { step } = await notifyStep({ helperId: helper.id, input: { methodId: m.id, subject: "TG", body: "TG test body long enough to pass." } });
      assert.equal(step.ok, false, "a paused household must not send");
      // "blocked" rather than "failed": the turn distinguishes a policy refusal from a tool
      // that tried and could not. Both are ok:false, and neither delivered anything.
      assert.equal(step.status, "blocked");
      assert.match(String(step.summary), /kill switch|paused/i, "and must say the switch is why");
    } finally {
      await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ externalActionsEnabled: true }) });
    }
  });

  test("GATE 6 — an empty body is refused (no blank briefings)", async () => {
    const m = await makeMethod({ label: "TG-empty", value: "tg-empty@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [helper.id] });
    const { step } = await notifyStep({ helperId: helper.id, input: { methodId: m.id, subject: "TG", body: "" } });
    assert.equal(step.ok, false);
  });

  test("ALL GATES PASS — the send proceeds to the channel and reports the transport truth", async () => {
    const m = await makeMethod({ label: "TG-ready", value: "tg-ready@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [helper.id] });
    const { step } = await notifyStep({ helperId: helper.id, input: { methodId: m.id, subject: "TG briefing", body: "TG test body long enough to pass the empty check." } });
    // No Google account is connected in this harness tenant, so the honest outcome here is
    // "connect Google" — NOT a claim of delivery. That distinction is the entire point
    // of this work package: the system reports what actually happened to the message.
    assert.equal(step.ok, false, "with no mail account connected, this must NOT report success");
    assert.match(String(step.summary), /Connect a Google account|re-authorized|Send email permission/i,
      "the failure must name the real, actionable cause");
    assert.doesNotMatch(String(step.summary), /isn't allowed|verif|opted in/i,
      "all registry gates passed — the only remaining obstacle is the transport");
  });

  /* ---------------------------------------------------------------- *
   * Findings from the mandatory adversarial security review of WP-005.
   * Each of these was EXPLOITABLE before the fix; they are pinned here so
   * the fix cannot be quietly undone.
   * ---------------------------------------------------------------- */

  test("C1 — a client cannot supply sourceRef.agentId and inherit a helper's send consent", async () => {
    const m = await makeMethod({ label: "TG-c1", value: "tg-c1@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [helper.id] });
    // The attack: name an allowlisted helper in a hand-rolled run, with no legitimate
    // association to it, and inherit its standing consent. Unchanged by the rewrite —
    // /api/runs/start still accepts a raw plan, and still strips the identity off it.
    const r = await owner.req("/api/runs/start", {
      method: "POST",
      body: JSON.stringify({
        plan: { title: "TG-impersonation", summary: "", steps: [{ toolId: "homeops.notify_contact", title: "Send", detail: "", input: { methodId: m.id, subject: "TG", body: "TG impersonation attempt body." }, requiresApproval: false }] },
        sourceRef: { agentId: helper.id },
      }),
    });
    const runId = r.data?.run?.id ?? r.data?.runId;
    assert.ok(runId, `run should start: ${JSON.stringify(r.data).slice(0, 200)}`);
    const run = await waitTerminal(runId, ["waiting_for_approval", "waiting_for_connector"]);
    const step = run.steps[0];
    assert.equal(step.status, "failed", "an impersonated helper identity must not deliver");
    assert.match(String(step.detail), /needs to run as a specific helper/i,
      "the run must land with NO acting helper, so the allowlist gate cannot be satisfied");
    assert.equal(run.sourceRef?.agentId ?? null, null, "helper identity is server-assigned only; it must be stripped from client input");
  });

  test("C2 — changing a contact method's address clears its helper allowlist", async () => {
    const m = await makeMethod({ label: "TG-c2", value: "tg-c2@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [helper.id] });
    assert.deepEqual(m.allowedAgentIds, [helper.id]);
    const upd = await owner.req(`/api/contact-methods/${m.id}`, { method: "PATCH", body: JSON.stringify({ value: "tg-c2-moved@example.invalid" }) });
    const after = upd.data?.contactMethod;
    assert.equal(after.verified, false, "a new address is unverified");
    assert.deepEqual(after.allowedAgentIds, [], "standing send consent must NOT survive a repoint to a different address");
  });

  test("C3 — a non-adult cannot grant a helper permission to message a contact", async () => {
    const child = await makeSession(ctx, "m-lily"); // Child View
    const own = await child.req("/api/contact-methods", {
      method: "POST",
      body: JSON.stringify({ label: "TG-c3", type: "Email", value: "tg-c3@example.invalid", allowedAgentIds: [helper.id] }),
    });
    if (own.status < 400) {
      assert.deepEqual(own.data.contactMethod.allowedAgentIds, [],
        "a non-adult must not be able to mint standing send authority at creation time");
      const patched = await child.req(`/api/contact-methods/${own.data.contactMethod.id}`, { method: "PATCH", body: JSON.stringify({ allowedAgentIds: [helper.id] }) });
      assert.equal(patched.status, 403, "nor by patching it afterwards");
    }
  });

  test("C3b — an allowlist entry must resolve to a real helper in this household", async () => {
    const r = await owner.req("/api/contact-methods", {
      method: "POST",
      body: JSON.stringify({ label: "TG-c3b", type: "Email", value: "tg-c3b@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: ["agt_does_not_exist"] }),
    });
    assert.deepEqual(r.data.contactMethod.allowedAgentIds, [], "a phantom helper id must not be stored as consent");
  });

  test("H1 — deleting a helper revokes its standing send consent", async () => {
    /* Why this is asserted on the STORED allowlist and not on a later send: a helper id that
     * outlives its helper is a grant with nobody attached to it, and POST /api/helpers still
     * accepts a caller-chosen `id` (createHelper honours body.id when nothing holds it), so a
     * stale entry is claimable by the next helper to take that id. Revoking at deletion is
     * what keeps "deleting the helper is how you revoke it" true. */
    const tmp = await makeHelper("TG-Doomed Helper");
    const m = await makeMethod({ label: "TG-h1", value: "tg-h1@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [tmp.id] });
    await owner.req(`/api/helpers/${tmp.id}`, { method: "DELETE" });
    const after = (await owner.req(`/api/contact-methods`)).data.contactMethods.find((x) => x.id === m.id);
    assert.ok(!(after.allowedAgentIds ?? []).includes(tmp.id),
      "deleting a helper is how a family revokes it — the grant must not outlive the helper");
  });

  test("H1b — a schedule naming a deleted helper fails closed instead of running unpoliced", async () => {
    const tmp = await makeHelper("TG-Ghost");
    await makeMethod({ label: "TG-h1b", value: "tg-h1b@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [tmp.id] });
    // One target shape left: a trigger runs a HELPER. Deleting the helper leaves the row
    // pointing at nothing, and firing it must say so rather than running as anybody.
    const tr = await owner.req("/api/triggers", { method: "POST", body: JSON.stringify({ name: "TG-ghost trigger", type: "manual", target: { kind: "helper", helperId: tmp.id } }) });
    await owner.req(`/api/helpers/${tmp.id}`, { method: "DELETE" });
    const fire = await owner.req(`/api/triggers/${tr.data.trigger.id}/fire`, { method: "POST", body: JSON.stringify({}) });
    assert.equal(fire.data?.ok, false, "a fire at a deleted helper must not succeed");
    assert.ok(fire.data?.error, "the fire must fail with a stated reason");
    assert.equal(fire.data.runId ?? null, null, "and must not have started an unpoliced run");
  });

  test("H2 — /api/notify to an EXTERNAL channel requires an adult", async () => {
    const child = await makeSession(ctx, "m-lily");
    const m = await makeMethod({ label: "TG-h2", value: "tg-h2@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [helper.id] });
    const r = await child.req("/api/notify", { method: "POST", body: JSON.stringify({ methodId: m.id, title: "TG", body: "TG external send attempt" }) });
    assert.equal(r.status, 403, "omitting agentId must not be a way around the allowlist");
  });

  test("the step is never silently dropped from the record", async () => {
    /* The durable trace used to be the run; for a tool the policy lets straight through
     * there is no run any more, and the helper's own THREAD is the record instead. The
     * property is the same and matters as much: a refused send must be visible afterwards,
     * not swallowed by a turn that ends with a cheerful sentence. */
    const m = await makeMethod({ label: "TG-trace", value: "tg-trace@example.invalid", verified: true, optInStatus: "Opted In", allowedAgentIds: [helper.id] });
    await notifyStep({ helperId: helper.id, input: { methodId: m.id, subject: "TG", body: "TG test body long enough to pass." } });
    const hist = (await owner.req(`/api/helpers/${helper.id}/history`)).data.messages;
    const last = hist.at(-1);
    assert.equal(last.role, "assistant");
    const recorded = (last.toolCalls ?? []).find((c) => c.tool === "homeops.notify_contact");
    assert.ok(recorded, "the delivery attempt must remain in the helper's own history");
    assert.equal(recorded.ok, false, "…including the fact that it did not go");
  });
});
