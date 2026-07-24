// ONE effective approval policy, resolved in ONE place (WP-105 / ISS-107).
//
// Before this, approval was decided by two half-layers that didn't know about each other:
// a tool's own `requiresApproval` and a household risk override (engine.mjs resolveTool).
// Meanwhile every agent carried an `approvalPolicy: { autoAllow, alwaysApprove }` that the
// UI let you edit ("Runs without approval (low-risk)" / "Always requires your approval")
// and that NO decision point ever read. Those toggles were inert — which is why the
// reporter kept re-configuring the same thing and nothing changed: "Every single one of
// these skills also needs to be changed."
//
// PRECEDENCE — household → agent → capability, with one asymmetry that matters:
// TIGHTENING is always honoured, RELAXING is bounded. A rule that adds a gate can come
// from anywhere; a rule that removes one has to have the authority to do so. Otherwise a
// generated agent could hand itself the ability to send or pay by writing its own name
// into its own autoAllow list.
//
// Every result names the rule that produced it, so the UI can state not just WHAT the
// policy is but WHY — the "one effective-policy view" this WP asks for.

/** Decisions, in order of severity. */
export const BLOCKED = "blocked";
export const NEEDS_APPROVAL = "needs_approval";
export const ALLOWED = "allowed";

/** A capability whose risk is high, or that delivers something outside the household,
 * can never be relaxed by an AGENT-level rule — only by a household-level one. */
export function isHighStakes(cap) {
  return String(cap?.risk ?? "").toLowerCase() === "high"
    || cap?.delivers === true
    || ["send", "write", "download", "pay"].includes(String(cap?.action ?? "").toLowerCase());
}

/**
 * Resolve the effective policy for one capability (tool or function).
 *
 * Pure: every input is passed in, nothing is read from the store, so this is trivially
 * unit-testable — including the negative cases, which is the point for a security-adjacent
 * rule. engine.mjs owns the lookups and calls this.
 *
 * @param cap      {{ id, requiresApproval, risk, action, delivers }} the capability's own defaults
 * @param agent    {{ approvalPolicy?, allowedToolIds?, deniedToolIds? }|null} the acting agent
 * @param settings {{ externalActionsEnabled? }} household settings
 * @param override {{ skipApproval?, riskClass? }|null} household risk override for this capability
 * @returns {{ decision, rule, reason, requiresApproval, risk, baseRequiresApproval, riskOverridden }}
 */
export function resolveEffectivePolicy({ cap, agent = null, settings = {}, override = null } = {}) {
  const base = {
    baseRequiresApproval: !!cap?.requiresApproval,
    risk: override?.riskClass ?? cap?.risk ?? "Low",
    riskOverridden: !!override,
  };
  const effectiveCap = { ...cap, risk: base.risk };
  const decide = (decision, rule, reason) => ({
    ...base, decision, rule, reason,
    requiresApproval: decision === NEEDS_APPROVAL,
  });

  // 1. Household kill switch. A hard stop on anything that leaves the household — no
  //    agent-level rule can reach past it. Mirrors the gate in connectors.mjs.
  const external = ["send", "write", "download"].includes(String(cap?.action ?? "").toLowerCase());
  if (external && settings?.externalActionsEnabled === false) {
    return decide(BLOCKED, "household.kill_switch", "External actions are turned off for this household.");
  }

  // 2-3. The agent's permission surface. Denies beat allows; an explicit allow-list means
  //      anything not on it is out of scope for this agent.
  const denied = new Set(agent?.deniedToolIds ?? agent?.deniedFunctionIds ?? []);
  if (cap?.id && denied.has(cap.id)) {
    return decide(BLOCKED, "agent.denied", `This helper is explicitly denied ${cap.name ?? cap.id}.`);
  }
  const allow = agent?.allowedToolIds ?? agent?.allowedFunctionIds ?? [];
  if (cap?.id && allow.length > 0 && !allow.includes(cap.id)) {
    return decide(BLOCKED, "agent.not_permitted", `${cap.name ?? cap.id} isn't in this helper's allowed list.`);
  }

  // 4. TIGHTENING — always honoured, and deliberately ahead of every relaxation below, so
  //    "always ask me" wins over both a household override and the agent's own autoAllow.
  const alwaysApprove = agent?.approvalPolicy?.alwaysApprove ?? [];
  if (cap?.id && alwaysApprove.includes(cap.id)) {
    return decide(NEEDS_APPROVAL, "agent.always_approve", "This helper is set to always ask you first.");
  }

  // 5. RELAXING, household level. An Owner/Adult Admin re-classing a tool for their own
  //    household is a deliberate, audited act, so it may clear a gate outright.
  if (override?.skipApproval && base.baseRequiresApproval) {
    return decide(ALLOWED, "household.risk_override", "An Owner cleared the approval gate for this household.");
  }

  // 6. RELAXING, agent level — BOUNDED. autoAllow is labelled "low-risk" in the UI and is
  //    held to it: it can never clear the gate on a high-risk or delivering capability,
  //    because a generated agent must not be able to grant itself send/pay by listing its
  //    own capability. The refusal is reported, not silently ignored.
  const autoAllow = agent?.approvalPolicy?.autoAllow ?? [];
  if (cap?.id && autoAllow.includes(cap.id)) {
    if (isHighStakes(effectiveCap)) {
      return decide(NEEDS_APPROVAL, "agent.auto_allow_refused",
        `${cap.name ?? cap.id} is ${String(base.risk).toLowerCase()}-risk, so "run without approval" doesn't apply — it still needs you.`);
    }
    if (base.baseRequiresApproval) {
      return decide(ALLOWED, "agent.auto_allow", "This helper is set to run this low-risk step without asking.");
    }
  }

  // 7-8. Nothing overrode the capability's own default.
  if (base.baseRequiresApproval) {
    return decide(NEEDS_APPROVAL, "capability.requires_approval", `${cap?.name ?? cap?.id ?? "This step"} needs your approval by default.`);
  }
  return decide(ALLOWED, "capability.default", "No rule requires approval for this step.");
}
