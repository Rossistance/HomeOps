// The household's stance — one question instead of a capability matrix.
//
// Everything else in policy.mjs is per-helper or per-tool: real controls, and both advanced.
// A family that just wants the thing to work had two options — answer an approval for every
// summary and reminder, or go learn a matrix. That gap is why this product nags next to "just
// text your assistant": the nagging was never a decision anyone made, it was the absence of
// one.
//
// A preset that quietly widened what a helper may do would be worse than the nagging, so what
// these tests hold is the BOUND, not the feature: Balanced can never reach anything that sends
// or spends; Trusted can, and only for someone with the standing to have said so; and every
// more-specific rule above it still wins.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveEffectivePolicy, ALLOWED, BLOCKED, NEEDS_APPROVAL } from "../policy.mjs";

// A purely LOCAL gated write — adding a task, writing a memory, drafting an event. This is the
// work the preset is for, and the case that decides whether it's worth having.
const gatedLow = { id: "homeops.create_task", name: "Add a task", requiresApproval: true, risk: "Low", action: "Write" };
const highSend = { id: "sms.send", name: "Send text", requiresApproval: true, risk: "High", action: "Send", delivers: true };
const ungated = { id: "weather.current", name: "Current conditions", requiresApproval: false, risk: "Low", action: "Read" };
const agent = { approvalPolicy: { autoAllow: [], alwaysApprove: [] } };

const at = (autonomy, extra = {}) => ({ autonomy, ...extra });
const trusted = at("Trusted", { autonomySetByRole: "Owner", autonomySetBy: "m-owner" });

/* ---- Cautious, and what an unset stance means ---- */

test("an ABSENT stance changes nothing — existing families keep the behaviour they had", () => {
  // The migration hazard this design exists to avoid. Balanced is right for a family starting
  // today and is written at signup; making it the meaning of "unset" would have loosened
  // approvals retroactively for every household already running, without anyone choosing it.
  const r = resolveEffectivePolicy({ cap: gatedLow, agent, settings: {} });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "capability.requires_approval");
});

test("Cautious is explicitly the same as unset", () => {
  const r = resolveEffectivePolicy({ cap: gatedLow, agent, settings: at("Cautious") });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "capability.requires_approval");
});

/* ---- Balanced: the point of the feature, and its bound ---- */

test("Balanced stops asking about a local write — the whole point of the preset", () => {
  // If this had used isHighStakes (the AGENT-level bound, which counts every Write) the preset
  // would have shipped unable to clear "add a task to our own list", and a family would have
  // turned it on and noticed no difference. The bound is reachesOutside — the kill switch's
  // line — because a local write does not leave the house.
  const r = resolveEffectivePolicy({ cap: gatedLow, agent, settings: at("Balanced") });
  assert.equal(r.decision, ALLOWED);
  assert.equal(r.rule, "household.autonomy_low_risk");
  assert.match(r.reason, /without asking/i);
});

test("…and about a gated read", () => {
  const gatedRead = { id: "gmail.search", name: "Search inbox", requiresApproval: true, risk: "Low", action: "Read" };
  assert.equal(resolveEffectivePolicy({ cap: gatedRead, agent, settings: at("Balanced") }).decision, ALLOWED);
});

test("THE BOUND: a third-party write the engine marked external is NOT local", () => {
  // `external` is how engine.mjs flags a provider/connector step. A write into someone else's
  // system is not the same as a write into the family's own, and must not ride Balanced.
  const thirdParty = { id: "notion.createPage", name: "Create page", requiresApproval: true, risk: "Low", action: "Write", external: true };
  const r = resolveEffectivePolicy({ cap: thirdParty, agent, settings: at("Balanced") });
  assert.equal(r.decision, NEEDS_APPROVAL);
});

test("THE BOUND: Balanced can never clear a send, and says why", () => {
  const r = resolveEffectivePolicy({ cap: highSend, agent, settings: at("Balanced") });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "capability.requires_approval", "it isn't even a refusal — Balanced simply doesn't reach here");
});

test("THE BOUND: nor a capability that merely DELIVERS while reading low-risk", () => {
  const sneaky = { id: "mail.send", name: "Send mail", requiresApproval: true, risk: "Low", action: "Write", delivers: true };
  const r = resolveEffectivePolicy({ cap: sneaky, agent, settings: at("Balanced") });
  assert.equal(r.decision, NEEDS_APPROVAL);
});

test("THE BOUND: a household that re-classed a tool UP is respected by the preset", () => {
  const r = resolveEffectivePolicy({ cap: gatedLow, agent, settings: at("Balanced"), override: { riskClass: "High" } });
  assert.equal(r.decision, NEEDS_APPROVAL, "the preset reads the EFFECTIVE risk, not the shipped one");
});

/* ---- Trusted: the tier that can send, and who may grant it ---- */

test("Trusted clears a send gate when a real Owner chose it", () => {
  const r = resolveEffectivePolicy({ cap: highSend, agent, settings: trusted });
  assert.equal(r.decision, ALLOWED);
  assert.equal(r.rule, "household.autonomy_trusted");
  assert.match(r.reason, /Owner/);
});

test("FORGERY: Trusted without standing is refused, not silently downgraded", () => {
  // Same shape as rule 6b: the tier is reported as refused so a screen can say why the switch
  // didn't do what its label promised, instead of showing it on and behaving as if it were off.
  const r = resolveEffectivePolicy({ cap: highSend, agent, settings: at("Trusted", { autonomySetByRole: "Limited Member" }) });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "household.autonomy_trusted_unauthorized");
});

test("FORGERY: Trusted with no attribution at all reaches nothing", () => {
  const r = resolveEffectivePolicy({ cap: highSend, agent, settings: at("Trusted") });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "household.autonomy_trusted_unauthorized");
});

test("…while Trusted still covers low-risk steps under the ordinary rule", () => {
  const r = resolveEffectivePolicy({ cap: gatedLow, agent, settings: at("Trusted", { autonomySetByRole: "Limited Member" }) });
  assert.equal(r.decision, ALLOWED);
  assert.equal(r.rule, "household.autonomy_low_risk", "the refused tier doesn't cost a family the tier it does have");
});

/* ---- precedence: a preset is a default stance, never a ceiling and never a bypass ---- */

test("PRECEDENCE: the kill switch beats Trusted", () => {
  const r = resolveEffectivePolicy({ cap: highSend, agent, settings: { ...trusted, externalActionsEnabled: false } });
  assert.equal(r.decision, BLOCKED);
  assert.equal(r.rule, "household.kill_switch");
});

test("PRECEDENCE: \"always ask me for this one\" beats Trusted", () => {
  const fenced = { approvalPolicy: { autoAllow: [], alwaysApprove: ["sms.send"] } };
  const r = resolveEffectivePolicy({ cap: highSend, agent: fenced, settings: trusted });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "agent.always_approve", "a family can turn the house loose and still fence off one step");
});

test("PRECEDENCE: a denied capability stays denied under Trusted", () => {
  const denied = { deniedToolIds: ["sms.send"], approvalPolicy: { autoAllow: [], alwaysApprove: [] } };
  const r = resolveEffectivePolicy({ cap: highSend, agent: denied, settings: trusted });
  assert.equal(r.decision, BLOCKED);
});

test("PRECEDENCE: a per-helper grant still wins under Cautious — the preset is not a ceiling", () => {
  // If a preset could veto a deliberate, PIN-gated, per-helper decision, that control would be
  // decorative — which is the exact defect this work package exists to remove.
  const loosed = { approvalPolicy: { autoAllow: [], alwaysApprove: [], unattended: { enabled: true, includeHighRisk: true, setByRole: "Owner" } } };
  const r = resolveEffectivePolicy({ cap: highSend, agent: loosed, settings: at("Cautious") });
  assert.equal(r.decision, ALLOWED);
  assert.equal(r.rule, "agent.unattended_high_risk");
});

test("a capability with no gate is unaffected by any stance", () => {
  for (const s of [{}, at("Cautious"), at("Balanced"), trusted]) {
    const r = resolveEffectivePolicy({ cap: ungated, agent, settings: s });
    assert.equal(r.rule, "capability.default", "a preset relaxes gates; it never invents one");
  }
});

test("an unknown stance string is treated as Cautious, not as permission", () => {
  const r = resolveEffectivePolicy({ cap: gatedLow, agent, settings: at("YOLO") });
  assert.equal(r.decision, NEEDS_APPROVAL);
});
