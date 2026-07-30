// WP-105 (ISS-107): one effective approval policy, resolved in one place.
//
// Permissions are security-adjacent, so the negative cases carry the weight here: the
// point is not only that a rule CAN relax a gate, but that the wrong rule CANNOT. A
// generated agent writing its own capability into its own autoAllow list must not be able
// to hand itself the ability to send, pay, or reach outside the household.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveEffectivePolicy, reachesOutside, ALLOWED, BLOCKED, NEEDS_APPROVAL } from "../policy.mjs";

const lowRead = { id: "weather.current", name: "Current conditions", requiresApproval: false, risk: "Low", action: "Read" };
const gatedLow = { id: "notes.write", name: "Write a note", requiresApproval: true, risk: "Low", action: "Read" };
const highSend = { id: "sms.send", name: "Send text", requiresApproval: true, risk: "High", action: "Send", delivers: true };
const agentWith = (over) => ({ approvalPolicy: { autoAllow: [], alwaysApprove: [] }, ...over });

/* ---- defaults, and the "generated agent inherits" acceptance criterion ---- */

test("a capability with no gate is allowed, and says which rule decided", () => {
  const r = resolveEffectivePolicy({ cap: lowRead });
  assert.equal(r.decision, ALLOWED);
  assert.equal(r.rule, "capability.default");
  assert.ok(r.reason.length > 0, "every decision names its reason");
});

test("a gated capability needs approval by default", () => {
  const r = resolveEffectivePolicy({ cap: gatedLow });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "capability.requires_approval");
  assert.equal(r.requiresApproval, true);
});

/* ---- canAutoAllow: the refusal in rule 6, answered BEFORE it is set ---- */

test("canAutoAllow says up front where \"run without asking\" can apply…", () => {
  assert.equal(resolveEffectivePolicy({ cap: gatedLow }).canAutoAllow, true);
  assert.equal(resolveEffectivePolicy({ cap: lowRead }).canAutoAllow, true);
});

test("…and where it cannot, so a control is greyed instead of quietly ignored", () => {
  // The web now offers per-capability "Don't ask" and reads this to decide whether the button
  // is live. Rule 6 refuses it for anything high-stakes; a family shouldn't have to set it,
  // leave, come back and read `agent.auto_allow_refused` to find that out.
  assert.equal(resolveEffectivePolicy({ cap: highSend }).canAutoAllow, false);
  const deliversButReadsLow = { id: "mail.send", name: "Send mail", requiresApproval: true, risk: "Low", action: "Write", delivers: true };
  assert.equal(resolveEffectivePolicy({ cap: deliversButReadsLow }).canAutoAllow, false,
    "delivering is what matters, not the label on the risk");
});

test("canAutoAllow follows a household risk override, because rule 6 does", () => {
  // A household that re-classed this tool UP has changed the answer for its own family; the
  // control has to move with it or it goes back to lying, just in the other direction.
  const r = resolveEffectivePolicy({ cap: gatedLow, override: { riskClass: "High" } });
  assert.equal(r.canAutoAllow, false);
});

test("canAutoAllow is present on every decision, including refusals and blocks", () => {
  const blocked = resolveEffectivePolicy({ cap: highSend, settings: { externalActionsEnabled: false } });
  assert.equal(blocked.decision, BLOCKED);
  assert.equal(typeof blocked.canAutoAllow, "boolean", "a UI reading this field must never get undefined");
});

test("a freshly generated agent inherits with NO manual configuration", () => {
  // The acceptance criterion: an agent created with an empty policy behaves exactly like
  // the household/capability defaults — no per-entity toggling required to be correct.
  const bare = resolveEffectivePolicy({ cap: gatedLow, agent: agentWith({}) });
  const none = resolveEffectivePolicy({ cap: gatedLow, agent: null });
  assert.equal(bare.decision, none.decision);
  assert.equal(bare.rule, none.rule);
});

/* ---- tightening: always honoured ---- */

test("alwaysApprove adds a gate to a capability that had none", () => {
  const r = resolveEffectivePolicy({ cap: lowRead, agent: agentWith({ approvalPolicy: { autoAllow: [], alwaysApprove: ["weather.current"] } }) });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "agent.always_approve");
});

test("NEGATIVE: alwaysApprove beats a household override that would clear the gate", () => {
  // Tightening must win over relaxing regardless of which layer asked, or "always ask me"
  // would be quietly cancelled by a household setting the member never sees.
  const r = resolveEffectivePolicy({
    cap: gatedLow,
    agent: agentWith({ approvalPolicy: { autoAllow: [], alwaysApprove: ["notes.write"] } }),
    override: { skipApproval: true },
  });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "agent.always_approve");
});

test("NEGATIVE: alwaysApprove beats the agent's own autoAllow for the same capability", () => {
  const r = resolveEffectivePolicy({
    cap: gatedLow,
    agent: agentWith({ approvalPolicy: { autoAllow: ["notes.write"], alwaysApprove: ["notes.write"] } }),
  });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "agent.always_approve");
});

/* ---- relaxing: bounded ---- */

test("a household risk override clears a gate (deliberate, audited, Owner-level)", () => {
  const r = resolveEffectivePolicy({ cap: gatedLow, override: { skipApproval: true } });
  assert.equal(r.decision, ALLOWED);
  assert.equal(r.rule, "household.risk_override");
  assert.equal(r.riskOverridden, true);
  assert.equal(r.baseRequiresApproval, true, "the base requirement is kept so the bypass stays auditable");
});

test("autoAllow clears a gate on a genuinely low-risk capability", () => {
  const r = resolveEffectivePolicy({ cap: gatedLow, agent: agentWith({ approvalPolicy: { autoAllow: ["notes.write"], alwaysApprove: [] } }) });
  assert.equal(r.decision, ALLOWED);
  assert.equal(r.rule, "agent.auto_allow");
});

test("NEGATIVE: autoAllow CANNOT clear a high-risk gate — the agent can't grant itself send", () => {
  // The exact self-granting case: an agent lists its own delivery tool in its own policy.
  const r = resolveEffectivePolicy({ cap: highSend, agent: agentWith({ approvalPolicy: { autoAllow: ["sms.send"], alwaysApprove: [] } }) });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "agent.auto_allow_refused");
  assert.match(r.reason, /still needs you/, "the refusal is reported, not silently ignored");
});

test("NEGATIVE: autoAllow CANNOT clear a delivering capability even when risk reads Low", () => {
  const sneaky = { id: "mail.send", name: "Send mail", requiresApproval: true, risk: "Low", action: "Read", delivers: true };
  const r = resolveEffectivePolicy({ cap: sneaky, agent: agentWith({ approvalPolicy: { autoAllow: ["mail.send"], alwaysApprove: [] } }) });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "agent.auto_allow_refused");
});

test("NEGATIVE: a household risk override cannot make a Send action skip the kill switch", () => {
  const r = resolveEffectivePolicy({
    cap: highSend, settings: { externalActionsEnabled: false }, override: { skipApproval: true },
  });
  assert.equal(r.decision, BLOCKED);
  assert.equal(r.rule, "household.kill_switch");
});

test("NEGATIVE: autoAllow cannot reach past the household kill switch either", () => {
  const r = resolveEffectivePolicy({
    cap: highSend,
    agent: agentWith({ approvalPolicy: { autoAllow: ["sms.send"], alwaysApprove: [] } }),
    settings: { externalActionsEnabled: false },
  });
  assert.equal(r.decision, BLOCKED);
  assert.equal(r.rule, "household.kill_switch");
});

/* ---- the agent's permission surface ---- */

test("an explicitly denied capability is blocked, whatever the approval rules say", () => {
  const r = resolveEffectivePolicy({
    cap: gatedLow,
    agent: agentWith({ deniedToolIds: ["notes.write"], approvalPolicy: { autoAllow: ["notes.write"], alwaysApprove: [] } }),
  });
  assert.equal(r.decision, BLOCKED);
  assert.equal(r.rule, "agent.denied");
});

test("a non-empty allow-list makes anything absent from it out of scope", () => {
  const r = resolveEffectivePolicy({ cap: gatedLow, agent: agentWith({ allowedToolIds: ["something.else"] }) });
  assert.equal(r.decision, BLOCKED);
  assert.equal(r.rule, "agent.not_permitted");
});

test("an EMPTY allow-list means 'all', not 'none'", () => {
  const r = resolveEffectivePolicy({ cap: lowRead, agent: agentWith({ allowedToolIds: [] }) });
  assert.equal(r.decision, ALLOWED);
});

/* ---- the kill switch means "leaves the household", literally ----
 * Two bugs met here. `decide()` reports requiresApproval:false for every verdict that isn't
 * NEEDS_APPROVAL, and engine.mjs read only that field — so a BLOCKED capability became an
 * UNGATED one, and turning the kill switch ON removed the approval gate from the two gated
 * internal tools. Enforcing BLOCKED then exposed the second bug: the switch's reach test
 * counted every `Write` as external, which would have refused a family adding a task to
 * their own list. reachesOutside() is the narrowed test; the engine passes `external` for
 * provider and connector kinds because only it knows the capability's kind. */

test("reachesOutside: delivering, sending, paying and third-party capabilities do", () => {
  assert.equal(reachesOutside({ action: "Send" }), true, "a message going out");
  assert.equal(reachesOutside({ action: "Download" }), true, "bytes arriving from outside");
  assert.equal(reachesOutside({ action: "Pay" }), true, "money moving");
  assert.equal(reachesOutside({ action: "Read", delivers: true }), true, "declared reach beats a mild action");
  assert.equal(reachesOutside({ action: "Write", external: true }), true, "provider/connector kinds, per the engine");
});

test("reachesOutside: a purely LOCAL write does not", () => {
  // homeops.create_task, create_list_item, write_memory, create_artifact: Write, internal,
  // no delivery. Pausing external actions must not stop a family using their own app.
  assert.equal(reachesOutside({ action: "Write" }), false);
  assert.equal(reachesOutside({ action: "Read" }), false);
  assert.equal(reachesOutside({}), false);
});

test("the kill switch does NOT block a local write", () => {
  const localWrite = { id: "homeops.create_task", name: "Add a task", requiresApproval: false, risk: "Low", action: "Write" };
  const r = resolveEffectivePolicy({ cap: localWrite, settings: { externalActionsEnabled: false } });
  assert.equal(r.decision, ALLOWED, "adding a task to your own list is not an external action");
});

test("the kill switch DOES block a third-party write the engine marked external", () => {
  const providerWrite = { id: "calendar.create", name: "Create event", requiresApproval: false, risk: "Medium", action: "Write", external: true };
  const r = resolveEffectivePolicy({ cap: providerWrite, settings: { externalActionsEnabled: false } });
  assert.equal(r.decision, BLOCKED);
  assert.equal(r.rule, "household.kill_switch");
});

test("a BLOCKED verdict never reports itself as 'no approval needed'", () => {
  // The shape of the bypass: a caller that reads requiresApproval alone must not be able to
  // mistake a refusal for a clearance. requiresApproval is false on BLOCKED by design, so
  // `decision` is the field that carries the refusal — assert both, so the contract is
  // pinned for every future consumer.
  const r = resolveEffectivePolicy({ cap: highSend, settings: { externalActionsEnabled: false } });
  assert.equal(r.decision, BLOCKED);
  assert.equal(r.requiresApproval, false, "the historical shape, kept");
  assert.notEqual(r.decision, ALLOWED, "and it is NOT an allowance");
  assert.ok(r.reason.length > 0, "a refusal explains itself");
});

/* ---- risk re-classing ---- */

test("a household override that RAISES risk also blocks autoAllow from clearing it", () => {
  // Re-classing Low → High must actually bite: the agent's low-risk relaxation no longer
  // applies, because the effective risk is what counts, not the catalog's original.
  const r = resolveEffectivePolicy({
    cap: gatedLow,
    agent: agentWith({ approvalPolicy: { autoAllow: ["notes.write"], alwaysApprove: [] } }),
    override: { riskClass: "High" },
  });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "agent.auto_allow_refused");
  assert.equal(r.risk, "High");
});
