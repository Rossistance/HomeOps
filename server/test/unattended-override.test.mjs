// G4/G5 — "There should be an override to run all the time no matter what" [18:47], and for
// a helper the family built by talking to it, "don't ask for permission, you have approval"
// [18:52].
//
// This is a relaxation, so the negative cases are the point. The blanket override earns the
// same asymmetry every other rule in policy.mjs has: it clears low-risk gates freely, and it
// clears send/spend gates ONLY when a real Owner or Adult Admin chose that — a fact the
// server stamps and a request body cannot claim.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveEffectivePolicy, ALLOWED, BLOCKED, NEEDS_APPROVAL } from "../policy.mjs";

const gatedLow = { id: "notes.write", name: "Write a note", requiresApproval: true, risk: "Low", action: "Read" };
const highSend = { id: "sms.send", name: "Send text", requiresApproval: true, risk: "High", action: "Send", delivers: true };
const ungated = { id: "weather.current", name: "Current conditions", requiresApproval: false, risk: "Low", action: "Read" };

const loose = (over = {}) => ({ approvalPolicy: { autoAllow: [], alwaysApprove: [], unattended: { enabled: true, ...over } } });
const ownerSet = loose({ includeHighRisk: true, setByRole: "Owner" });

/* ---- what it does ---- */

test("unattended clears a low-risk gate for ANY capability, with no list to maintain", () => {
  const r = resolveEffectivePolicy({ cap: gatedLow, agent: loose() });
  assert.equal(r.decision, ALLOWED);
  assert.equal(r.rule, "agent.unattended");
  assert.match(r.reason, /unattended/i);
});

test("an Owner can extend it to steps that send or spend", () => {
  const r = resolveEffectivePolicy({ cap: highSend, agent: ownerSet });
  assert.equal(r.decision, ALLOWED);
  assert.equal(r.rule, "agent.unattended_high_risk");
  assert.match(r.reason, /Owner/);
});

test("it changes nothing for a capability that was never gated", () => {
  const r = resolveEffectivePolicy({ cap: ungated, agent: ownerSet });
  assert.equal(r.decision, ALLOWED);
  assert.equal(r.rule, "capability.default", "no rule should claim credit for a gate that didn't exist");
});

/* ---- what it cannot do ---- */

test("NEGATIVE: unattended alone does NOT cover sending — and says why", () => {
  const r = resolveEffectivePolicy({ cap: highSend, agent: loose() });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "agent.unattended_refused");
  assert.match(r.reason, /Owner has to allow that separately/);
});

test("NEGATIVE: a forged setByRole is worthless — the flag must be SERVER-stamped", () => {
  // A generated agent writing includeHighRisk + setByRole into its own record is exactly the
  // hole this bound exists to close. The stamp is applied in agents.mjs from the session; a
  // role string that isn't one the server assigns can never satisfy the check.
  for (const role of ["Guest/Helper", "Adult Member", "Limited Member", "", null, "owner", "OWNER"]) {
    const r = resolveEffectivePolicy({ cap: highSend, agent: loose({ includeHighRisk: true, setByRole: role }) });
    assert.equal(r.decision, NEEDS_APPROVAL, `setByRole="${role}" must not unlock sending`);
    assert.equal(r.rule, "agent.unattended_refused");
  }
});

test("NEGATIVE: \"always ask me\" beats unattended, even the Owner's high-risk tier", () => {
  // A family must be able to turn a helper loose and still fence off one step.
  const agent = { approvalPolicy: { autoAllow: [], alwaysApprove: ["sms.send"], unattended: { enabled: true, includeHighRisk: true, setByRole: "Owner" } } };
  const r = resolveEffectivePolicy({ cap: highSend, agent });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "agent.always_approve");
});

test("NEGATIVE: the household kill switch still stops everything", () => {
  const r = resolveEffectivePolicy({ cap: highSend, agent: ownerSet, settings: { externalActionsEnabled: false } });
  assert.equal(r.decision, BLOCKED);
  assert.equal(r.rule, "household.kill_switch");
});

test("NEGATIVE: an explicit deny still wins — unattended is not a way around scope", () => {
  const agent = { deniedToolIds: ["sms.send"], approvalPolicy: { autoAllow: [], alwaysApprove: [], unattended: { enabled: true, includeHighRisk: true, setByRole: "Owner" } } };
  const r = resolveEffectivePolicy({ cap: highSend, agent });
  assert.equal(r.decision, BLOCKED);
  assert.equal(r.rule, "agent.denied");
});

test("enabled:false is inert — turning it back off restores the gate", () => {
  const r = resolveEffectivePolicy({ cap: gatedLow, agent: { approvalPolicy: { unattended: { enabled: false, includeHighRisk: true, setByRole: "Owner" } } } });
  assert.equal(r.decision, NEEDS_APPROVAL);
  assert.equal(r.rule, "capability.requires_approval");
});
