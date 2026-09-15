// FamiliOS — the one way a durable run gets created.
//
// This module used to turn four different entry points (a skill, an agent goal, a chat
// plan, a manual plan) into four different kinds of plan, with a model call in the middle
// to invent the steps. All of that is gone: the assistant and every helper now execute
// through the observed tool loop in assistant-agent.mjs, which does not produce plans.
//
// What durable runs are still FOR is the approval gate. When a tool the policy says a
// person must sign off on comes up, the turn does not execute it — it creates a one-step
// run here, which parks, notifies the right people, and executes only after a real human
// approval, exactly as it always did. That machinery (engine.mjs) is untouched; this file
// is just the front door to it.
import { getAgent, putAgent, patchAgent, addRouting, appendAudit } from "./store.mjs";
import { currentTenant } from "./tenant-context.mjs";
import { startRun } from "./engine.mjs";
import { isToolStepAllowed, helperVisibleTo } from "./helper-shape.mjs";

/** The household's default assistant identity. Chat turns and any run that does not name
 *  a helper act as this one, so per-helper consent (a contact method's allowlist) always
 *  has something real to check. */
export const DEFAULT_HOUSEHOLD_AGENT_ID = "agt_household";

/* A household created through signup never ran the boot seed, so it had no default
 * assistant at all — and every per-helper-gated delivery hard-refused a plain chat ask,
 * for every new family, forever. Created here, at the one choke point that needs it, so
 * the fix reaches existing households too and not just future signups. */
export function ensureDefaultHelper(agentId = DEFAULT_HOUSEHOLD_AGENT_ID) {
  const existing = getAgent(agentId);
  if (existing) {
    // The seed once shipped this helper with a six-tool allow-list scoped to the one
    // briefing it ran. Left alone, that list silently clamps ordinary chat actions the
    // moment they gain an identity. Widen it to the documented open default — but only
    // while it still matches the pristine seed, so a family's own choice is never touched.
    const pristine = ["weather.current", "calendar.list", "gmail.search", "homeops.write_memory", "homeops.create_artifact", "homeops.create_approval"];
    const same = (a, b) => Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x));
    if (same(existing.allowedToolIds, pristine)) {
      patchAgent(agentId, { allowedToolIds: [], allowedFunctionIds: [] });
      return getAgent(agentId);
    }
    return existing;
  }
  putAgent({
    id: agentId,
    householdId: currentTenant(),
    name: "Famili",
    icon: "Bot",
    purpose: "The family's everyday assistant.",
    instructions: "Help with whatever the family asks: the calendar, tasks, meals, lists and reminders. Check what is already there before adding anything, and say plainly when something needs a person to approve it.",
    status: "Active",
    enabled: true,
    visibility: "household",
    schedule: { kind: "manual" },
    system: true,
    allowedToolIds: [], allowedFunctionIds: [], deniedToolIds: [], deniedFunctionIds: [],
    approvalPolicy: {},
    conversationId: null,
    lastRun: null,
    version: 1,
    createdAt: Date.now(),
    updatedAt: new Date().toISOString(),
  });
  appendAudit({ type: "helper.default_seeded", agentId, reason: "no_default_helper" });
  return getAgent(agentId);
}

/** Resolve the identity a run acts as. An explicit helper wins when it belongs to this
 *  household and this person can see it; otherwise the household default. Deliberately
 *  never borrows an unrelated helper: a wrong identity would lend the run that helper's
 *  standing send consent, which is worse than an honest refusal. */
export function resolveActingHelper({ agentId = null, session = null } = {}) {
  const runHouseholdId = session?.householdId ?? "local";
  if (agentId && agentId !== DEFAULT_HOUSEHOLD_AGENT_ID) {
    const a = getAgent(agentId);
    if (a && (a.householdId === runHouseholdId || a.householdId === "local") && helperVisibleTo(a, session)) return a;
  }
  if (runHouseholdId !== currentTenant()) return getAgent(DEFAULT_HOUSEHOLD_AGENT_ID);
  return ensureDefaultHelper();
}

/**
 * Start a durable run from a pre-built plan.
 *
 * Steps the acting helper is not allowed to reach SURVIVE into the run carrying their
 * refusal, and the engine records them as skipped with the honest reason. They used to be
 * filtered out before the run started, so a run completed and reported success while the
 * one step the family cared about had been deleted without a trace.
 *
 * @returns {Promise<{ok:true, run:object, droppedSteps:number} | {error:string, message?:string}>}
 */
export async function orchestrate({
  source = "manual", via, plan = null, goal = null, agentId = null,
  params = {}, session, conversationId = null, sourceRef = {}, visibility,
} = {}) {
  if (!plan || typeof plan !== "object") {
    return { error: "nothing_to_run", message: "A run needs a plan." };
  }
  const viaLabel = via ?? (source === "assistant" || source === "chat" ? "chat" : source === "trigger" ? "schedule" : "manual");

  /* A hand-rolled plan submitted through the manual API is deliberately left
   * UNATTRIBUTED: lending it the household assistant's identity would lend it that
   * helper's standing consent to send, which is exactly the impersonation a client must
   * not be able to buy by posting a sourceRef. Only chat and helper runs get an identity. */
  const attributed = viaLabel === "chat" || viaLabel === "schedule" || viaLabel === "agent";
  const helper = attributed ? resolveActingHelper({ agentId, session }) : null;

  const steps = (plan.steps ?? []).map((s) => {
    if (!helper) return s;
    const verdict = isToolStepAllowed(helper, s.toolId ?? null);
    return verdict.ok ? s : { ...s, clampedOut: { reason: verdict.reason, message: verdict.message ?? "Not something this helper is allowed to use." } };
  });
  const droppedSteps = steps.filter((s) => s.clampedOut).length;

  const run = await startRun({
    source,
    // agentId is stamped LAST so nothing in a caller's sourceRef can null it back out.
    sourceRef: { via: viaLabel, conversationId, ...sourceRef, agentId: helper?.id ?? null, skillId: null },
    plan: { ...plan, steps },
    params, session, goal,
    title: plan.title ?? "Run",
    // A run born in a PERSONAL conversation must not fan its approvals out to the whole
    // family: someone's private ask would announce itself to everyone who can approve.
    visibility,
  });
  addRouting({ runId: run.id, agentId: helper?.id ?? null, skillId: null, mode: "tool", reason: `${source} run`, stepCount: steps.length, droppedSteps });
  return { ok: true, run, droppedSteps };
}
