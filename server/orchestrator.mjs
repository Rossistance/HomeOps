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
/* WHAT A CHAT VERDICT WAS COMPUTED FROM (ADR-004 Stage 2). A step the chat turn parked is
 * re-judged by the run engine when the run drives, and it has to be judged on the same
 * inputs or the verdict can change on the way: policy rule 4b needs to know the asker was
 * not an adult, and the native lane needs the channel and the asker's role. They ride on
 * sourceRef — where the engine reads authority — and, like agentId, they are SERVER-ASSIGNED:
 * a caller's sourceRef can never carry them in (they are dropped from it here, and
 * index.mjs clientSourceRef strips them from a request body), and only the parameters below,
 * which only server code passes, can put them on a run.
 *
 * `audience` and `secret` (ADR-005) ride the same way. audience ("self" | "shared") is who
 * can read the conversation the step came from — whether an owner's surprise may be spoken
 * there — so a write executed later from an approval reads events as the turn did. secret
 * marks a run born in a turn that handed a surprise over: it records nothing to memory and
 * only its requester can see it. A body that could set either could unlock a surprise in a
 * group thread, or hide its run from the household. */
const VERDICT_INPUTS = ["channel", "actorIsAdult", "actorRole", "audience", "secret"];

/* ---- SECURITY (WP-005 adversarial review, finding C1) ----
 * `sourceRef` is not decoration: the engine reads `sourceRef.agentId` to decide which
 * agent's POLICY applies (engine.mjs) and, since WP-005, which agent's standing
 * send-consent applies (a contact method's per-agent allowlist). POST /api/runs/start
 * previously forwarded the caller's `sourceRef` verbatim, so any Limited Member could
 * name any agent and inherit its send authority — reading the allowlists first from
 * GET /api/contact-methods. That turns "the allowlist IS the approval" into "the
 * caller picks their own identity", which is not an allowlist at all.
 *
 * Agent identity is therefore SERVER-ASSIGNED ONLY: it is set by runAgent/runSkill/
 * fireTrigger, never accepted from a request body. Clients may still pass harmless
 * correlation fields.
 *
 * Only the AUTHORITY-BEARING fields are stripped. The rest of sourceRef is benign
 * correlation metadata (conversationId, isRepair, repairedFrom, via …) that the chat
 * layer legitimately sets and depends on, so a blanket allow-list would break it.
 * These are exactly the fields the server reads to decide what a run MAY DO:
 *   agentId      → whose tool policy applies, and (WP-005) whose send consent applies
 *   skillId      → attribution the policy path and save-offer gating key off
 *   triggerId    → which automation's status this run writes back to
 *   automationId → the same, on the legacy field name
 *   channel, actorIsAdult, actorRole → what a queued chat step was judged on (ADR-004
 *                  Stage 2): whether policy rule 4b applies in the run, whether a native
 *                  write is held for an adult, and the role a native step runs as. A body
 *                  that could set them could clear its own park or run as an Owner.
 *   audience, secret → who could read the turn, and whether it handed over a surprise
 *                  (ADR-005): a body that set them could read a surprise in a shared room,
 *                  or hide a run from the household.
 *
 * Moved here from index.mjs (which starts a server when it loads) so it can be tested on its
 * own. It is the route's half of the guard; orchestrate's own drop of VERDICT_INPUTS below is
 * the other, and each is tested without the other. */
const SERVER_ASSIGNED_SOURCEREF = ["agentId", "skillId", "triggerId", "automationId", "channel", "actorIsAdult", "actorRole", "audience", "secret"];
export function clientSourceRef(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = { ...raw };
  for (const k of SERVER_ASSIGNED_SOURCEREF) delete out[k];
  return out;
}

export async function orchestrate({
  source = "manual", via, plan = null, goal = null, agentId = null,
  params = {}, session, conversationId = null, sourceRef = {}, visibility,
  channel = null, actorIsAdult = null, actorRole = null, audience = null, secret = false,
} = {}) {
  if (!plan || typeof plan !== "object") {
    return { error: "nothing_to_run", message: "A run needs a plan." };
  }
  const viaLabel = via ?? (source === "assistant" || source === "chat" ? "chat" : source === "trigger" ? "schedule" : "manual");

  /* A hand-rolled plan submitted through the manual API is deliberately left
   * UNATTRIBUTED: lending it the household assistant's identity would lend it that
   * helper's standing consent to send, which is exactly the impersonation a client must
   * not be able to buy by posting a sourceRef.
   *
   * "group_chat" is attributed, and the distinction against that rule is worth stating
   * because it looks adjacent. What the rule guards is a CLIENT choosing an identity: the
   * manual run API takes a sourceRef from the request body, so a caller could name any
   * helper and inherit its standing consent. A group run's sourceRef is assembled
   * server-side from a secret-gated webhook, a chat record an authenticated adult bound,
   * and a verified member's reply; no part of it comes from a client. And the identity it
   * gets, agt_chat, ships with unattended DISABLED, so there is no standing consent to
   * lend until an Owner deliberately creates one.
   *
   * Leaving it unattributed would be the worse answer, not the safer one: helper = null
   * below skips the allow-list check on every step. Attribution is what makes the
   * allow-list and the policy ladder apply at all. */
  const attributed = viaLabel === "chat" || viaLabel === "schedule" || viaLabel === "agent" || viaLabel === "group_chat";
  const helper = attributed ? resolveActingHelper({ agentId, session }) : null;

  const steps = (plan.steps ?? []).map((s) => {
    if (!helper) return s;
    const verdict = isToolStepAllowed(helper, s.toolId ?? null);
    return verdict.ok ? s : { ...s, clampedOut: { reason: verdict.reason, message: verdict.message ?? "Not something this helper is allowed to use." } };
  });
  const droppedSteps = steps.filter((s) => s.clampedOut).length;

  const callerRef = { ...sourceRef };
  for (const k of VERDICT_INPUTS) delete callerRef[k];
  const verdictInputs = {
    ...(typeof channel === "string" && channel ? { channel } : {}),
    ...(typeof actorIsAdult === "boolean" ? { actorIsAdult } : {}),
    ...(typeof actorRole === "string" && actorRole ? { actorRole } : {}),
    ...(audience === "self" || audience === "shared" ? { audience } : {}),
    ...(secret === true ? { secret: true } : {}),
  };

  const run = await startRun({
    source,
    // agentId is stamped LAST so nothing in a caller's sourceRef can null it back out; the
    // verdict inputs likewise come only from this function's own parameters.
    sourceRef: { via: viaLabel, conversationId, ...callerRef, ...verdictInputs, agentId: helper?.id ?? null, skillId: null },
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
