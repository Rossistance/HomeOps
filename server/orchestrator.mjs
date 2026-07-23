// FamiliOS AI — orchestrator: turns an entry point (skill run, agent run, chat plan)
// into a concrete plan, records the routing decision, and starts a durable run.
// Slice 1 implements deterministic skill→plan expansion + routing; agent/skill
// SELECTION from a free-text goal is fleshed out in later slices.
import { getSkill, getAgent, putAgent, patchAgent, addRouting, appendAudit } from "./store.mjs";
import { currentTenant } from "./tenant-context.mjs";
import { startRun } from "./engine.mjs";
import { selectAgent, agentContext, isToolStepAllowed } from "./agents.mjs";
import { planFromGoal } from "./planner.mjs";

// WP-101 slice 1 — rollback flag for the acting-agent PREFLIGHT. Default ON; set
// HOMEOPS_REQUIRE_ACTING_AGENT=off to restore the exact pre-WP-101 shape (a skill with
// no default helper starts a run whose sourceRef.agentId is null, and the refusal
// arrives late, from internal-functions.mjs, after steps have been consumed). Read live
// so a spawned test server can flip it per instance (mirrors the two flags above).
function requireActingAgentEnabled() {
  return String(process.env.HOMEOPS_REQUIRE_ACTING_AGENT ?? "on").trim().toLowerCase() !== "off";
}

// WP-002 slice 2 — rollback flag for chat-run agent attribution. Default ON; set
// HOMEOPS_CHAT_AGENT_ATTRIBUTION=off to instantly revert chat runs to the pre-WP-002
// shape (no agentId — homeops.notify_contact goes back to refusing them). Read live
// (not cached at module load) so a test harness can flip it per spawned server.
function chatAttributionEnabled() {
  return String(process.env.HOMEOPS_CHAT_AGENT_ATTRIBUTION ?? "on").trim().toLowerCase() !== "off";
}

// WP-006 slice 1 — rollback flag for the unified orchestrate() entry. Default ON; set
// HOMEOPS_ORCHESTRATE_ENTRY=off to reproduce the exact pre-WP-006 sourceRef shape (no
// unified `via` stamp), keeping every legacy delegate path — runAssistantPlan / runAgent
// / runSkill / startRun — byte-for-byte reachable. Read live so a spawned test server can
// flip it per instance (mirrors the chatAttribution flag pattern above).
function orchestrateEntryEnabled() {
  return String(process.env.HOMEOPS_ORCHESTRATE_ENTRY ?? "on").trim().toLowerCase() !== "off";
}

// agt_household is seeded (seed.mjs) as the household's DEFAULT identity — it's also
// agents.mjs' selectAgent() fallback when no explicit agent is named, so it is meant to
// be general-purpose. It was seeded with an allow-list scoped to exactly the one
// skill it originally ran (the morning briefing: write_memory/create_artifact/
// create_approval + a few reads). Chat runs are now ALSO attributed to it (see
// runAssistantPlan below) so per-agent-gated tools like homeops.notify_contact can run
// from a plain ask — but engine.mjs re-validates EVERY attributed run's steps against
// the agent's stored allow-list (defense in depth against a plan that slips a
// disallowed step past this module's own pre-clamp). Left as seeded, that narrow list
// would silently clamp ordinary chat actions (create_task, gmail.send, …) the moment
// they gained an identity — a capability regression, not a safety feature.
//
// So: widen it to the documented "empty allow-list = permissive, deny-only" default
// (agents.mjs: agentContext's openAllowList) — but ONLY when it still exactly matches
// the pristine seed value, i.e. nobody (household admin or a future UI) has customized
// it. Any deliberate customization, including a MORE restrictive one, is left
// completely untouched — this is a one-time unblock of an artifact of seeding, never
// an override of a household's own choice. A DENY list is never touched either way,
// so an explicit deny on the household's assistant is always still honored (see the
// chat-agent-attribution test for a policy-denied tool showing up as a visible skip).
const SEEDED_DEFAULT_ALLOWED_TOOL_IDS = ["weather.current", "calendar.list", "gmail.search", "homeops.write_memory", "homeops.create_artifact", "homeops.create_approval"];
const SEEDED_DEFAULT_ALLOWED_FUNCTION_IDS = ["homeops.write_memory", "homeops.create_artifact", "homeops.create_approval"];
const sameIdSet = (a, b) => Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x));
// Returns the (possibly widened) agent record so a caller can plan against the agent's
// EFFECTIVE permissions — the seeded-narrow allow-list is an artifact this neutralizes,
// so the planner's permitted-tools pruning (WP-006 slice 2) must see the open default,
// not the pristine six-tool seed.
export function ensureOpenDefaultAgent(agentId) {
  if (agentId !== "agt_household") return getAgent(agentId);
  const agent = getAgent(agentId);
  if (!agent) {
    // WP-002 gap, found by the 22-UC benchmark on a disposable household:
    // seedDefaults() only ever seeds the RESIDENT tenant at boot, so a household
    // created via /api/signup never had an agt_household at all. Chat attribution
    // then silently no-oped (runAssistantPlan: getAgent → null → sourceRef.agentId
    // null) and every per-agent-gated delivery (homeops.notify_contact) hard-refused
    // a plain chat ask — for EVERY new family, forever. Create the default agent
    // here, at the one choke point that needs it: self-healing covers existing
    // signed-up households too, not just future signups. Allow-lists start at the
    // documented open default (empty = permissive, deny-only) — the same effective
    // state the pristine-seed widening below produces for the resident tenant.
    putAgent({
      id: agentId,
      householdId: currentTenant(),
      name: "Household Assistant",
      icon: "Bot",
      purpose: "General family operations helper.",
      instructions: "Help with daily household coordination. Always pause for approval before sending or sharing anything sensitive.",
      status: "Active",
      spaceType: "Family",
      system: true,
      skillIds: [],
      allowedToolIds: [],
      allowedFunctionIds: [],
      deniedFunctionIds: [],
      approvalPolicy: {},
      triggers: [],
      version: 1,
      createdAt: Date.now(),
      updatedAt: new Date().toISOString(),
    });
    appendAudit({ type: "agent.default_seeded", agentId, reason: "chat_attribution_missing_default_agent" });
    return getAgent(agentId);
  }
  const stillPristine = sameIdSet(agent.allowedToolIds ?? [], SEEDED_DEFAULT_ALLOWED_TOOL_IDS) && sameIdSet(agent.allowedFunctionIds ?? [], SEEDED_DEFAULT_ALLOWED_FUNCTION_IDS);
  if (stillPristine) { patchAgent(agentId, { allowedToolIds: [], allowedFunctionIds: [] }); return getAgent(agentId); }
  return agent;
}

/* ================= WP-101 slices 1+2 (ISS-102): NO RUN WITHOUT AN ACTING AGENT =======
 * Before this, `runSkill` computed its identity inline as
 *     agentId: agentId ?? skill.defaultAgentId ?? null
 * so a skill with no default helper — every skill created through POST /api/skills, and
 * most of the seeded use-case skills (seed.mjs: `defaultAgentId: null`) — started a
 * durable run whose sourceRef.agentId was NULL. Nothing rejected that at creation. The
 * consequence only surfaced later, mid-run, at TOOL EXECUTION time: homeops.notify_contact
 * (internal-functions.mjs) refuses "no_acting_agent" because the recipient allowlist is
 * granted per helper and there is no helper to check. By then the run had started, burned
 * its earlier steps, and the family got a half-done run whose failure names an internal
 * condition they can do nothing about.
 *
 * So the identity is resolved BEFORE the run exists (slice 2: a preflight class, not a
 * late runtime surprise), reusing the SAME household-default self-heal chat already
 * relies on (ensureOpenDefaultAgent — 2026-07-22, commit 368514d). The
 * internal-functions.mjs guard stays exactly as it is: it is defense in depth for any
 * path that does not come through here (a hand-rolled manual plan, deliberately
 * unattributed — see orchestrate() case 4).
 */
export const DEFAULT_HOUSEHOLD_AGENT_ID = "agt_household";

// The one typed, plain-language creation-time refusal. It names the fix, because the
// person reading it can actually do both of these things.
export const NO_ACTING_AGENT_ERROR = {
  error: "no_acting_agent",
  message: "This can't run yet because there's no helper to run it as — sends and other actions are granted per helper, so an unassigned run could never act. Give this skill a default helper (Skills ▸ Default helper), or create a household assistant, then start it again.",
};

// EXACTLY the rule engine.mjs re-checks at run time ("this run names a helper that no
// longer exists in this household, so its permissions can't be checked" — which
// hard-fails the whole run at its first step). Mirroring it here is the difference
// between a preflight and a late surprise: `startRun` stamps the run's household as
// `session?.householdId ?? "local"`, so that is the value compared, not the tenant.
function agentUsableForRun(agent, session) {
  if (!agent) return false;
  const runHouseholdId = session?.householdId ?? "local";
  return agent.householdId === runHouseholdId || agent.householdId === "local";
}

// Load a candidate identity, self-healing ONLY the household default and ONLY into the
// household this run will actually belong to — creating the default assistant in some
// other tenant would hand back an identity the engine then rejects, which is precisely
// the late failure this work package removes.
function loadActingAgent(agentId, session) {
  if (agentId !== DEFAULT_HOUSEHOLD_AGENT_ID) return getAgent(agentId);
  const runHouseholdId = session?.householdId ?? "local";
  if (runHouseholdId !== currentTenant()) return getAgent(agentId);
  return ensureOpenDefaultAgent(agentId);
}

/**
 * Resolve the identity a run will act as, in priority order:
 *   1. the caller's explicit agentId (runAgent has already selected + scope-checked it),
 *   2. the skill's own default helper,
 *   3. the household's default assistant — created if this household never had one
 *      (the same WP-002 self-heal chat uses; see ensureOpenDefaultAgent above).
 * Returns the agent record, or null when this household has no identity a run could
 * honestly act as. Deliberately does NOT fall back to `selectAgent`'s "any other active
 * agent": silently borrowing an unrelated helper would hand the run that helper's
 * allow-list (its steps would then hard-fail on policy) and its standing send consent.
 * A wrong identity is worse than an honest refusal.
 * Exported so a caller can preflight the same verdict without starting anything.
 */
export function resolveActingAgent({ agentId = null, skill = null, session = null } = {}) {
  for (const id of [agentId, skill?.defaultAgentId, DEFAULT_HOUSEHOLD_AGENT_ID]) {
    if (!id) continue;
    const candidate = loadActingAgent(id, session);
    if (agentUsableForRun(candidate, session)) return candidate;
  }
  return null;
}

// Resolve {{param}} placeholders throughout a step's input mapping.
function interpolate(value, params) {
  if (typeof value === "string") return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (params?.[k] != null ? String(params[k]) : ""));
  if (Array.isArray(value)) return value.map((v) => interpolate(v, params));
  if (value && typeof value === "object") {
    const o = {};
    for (const k of Object.keys(value)) o[k] = interpolate(value[k], params);
    return o;
  }
  return value;
}

// Build a concrete plan from a hybrid skill's deterministic typed steps.
export function buildPlanFromSkill(skill, params = {}) {
  const steps = (skill.steps ?? []).map((s) => ({
    toolId: s.tool_id ?? s.function_id ?? s.toolId ?? null,
    title: s.name ?? s.title ?? "Step",
    detail: s.description ?? "",
    input: interpolate(s.input_mapping ?? s.input ?? {}, params),
  }));
  return { title: skill.name, summary: skill.description ?? "", steps };
}

// Run a skill deterministically (typed steps). Returns the durable run — or, when this
// household has no identity the run could act as, a typed creation-time error and NO run.
export async function runSkill({ skillId, params = {}, session, agentId, source = "skill", sourceRef = {} }) {
  const skill = getSkill(skillId);
  if (!skill) return { error: "unknown_skill" };
  if (skill.householdId && session?.householdId && skill.householdId !== session.householdId) return { error: "scope_mismatch" };
  // WP-101 slice 1 (ISS-102) — PREFLIGHT THE ACTING AGENT, before anything durable exists.
  // The pre-WP-101 expression is kept verbatim under the rollback flag.
  let actingAgentId = agentId ?? skill.defaultAgentId ?? null;
  if (requireActingAgentEnabled()) {
    const acting = resolveActingAgent({ agentId, skill, session });
    if (!acting) {
      // Audited so the refusal is visible in Activity as a real event, rather than being
      // an HTTP 422 that leaves no trace of a run that was asked for and never happened.
      appendAudit({ type: "run.preflight_refused", reason: "no_acting_agent", skillId, source, householdId: session?.householdId ?? null, actorId: session?.actorId ?? null });
      return { ...NO_ACTING_AGENT_ERROR };
    }
    actingAgentId = acting.id;
    // NOTE: a skill that previously ran unattributed is now policy-checked step by step
    // by the engine against this identity. The household default resolves to the
    // documented OPEN (empty allow-list = permissive, deny-only) default, so this adds
    // accountability without shrinking capability — only a household's explicit DENY
    // now reaches a skill run, which is exactly the check an agent-attributed run
    // already got.
  }
  const plan = buildPlanFromSkill(skill, params);
  // agentId is stamped LAST: it is server-assigned (index.mjs strips it from client
  // input for the same reason), so nothing in a caller's sourceRef can null it back out
  // and re-open the hole this slice closes.
  const ref = { skillId, ...sourceRef, agentId: actingAgentId };
  const run = await startRun({ source, sourceRef: ref, plan, params, session, title: skill.name });
  addRouting({ runId: run.id, agentId: ref.agentId, skillId, mode: "deterministic", reason: "explicit skill run", stepCount: plan.steps.length });
  return { ok: true, run };
}

// Run a plan that the assistant brain produced from a chat message, through the
// same durable runtime. Records routing so chat and skills share one execution world.
//
// WP-002 slice 2 (Honest delivery — chat-run agent attribution). Before this, every
// chat-born run started with NO agentId at all: the two /api/assistant(/stream) routes
// called startRun directly, bypassing this function entirely (it was dead code — see
// the run's audit trail). Two consequences, both dishonest in the same direction:
//   1. homeops.notify_contact hard-refuses ANY run with no acting agent (its per-agent
//      allowlist has nothing to check against), so a plain chat ask could never
//      actually deliver a real notification — only ever draft one.
//   2. an agent-attributed run gets the WP-003 visible-skip policy clamp; an
//      unattributed one gets none at all, so a chat plan's steps were never
//      policy-checked the way an agent/skill run's steps already are.
// This routes chat through the SAME choke point runAgent already uses for a selected
// agent, attributing the household's default agent (agt_household) and pre-clamping
// disallowed steps into honest, visible skips (WP-003 ISS-005) — never a silent drop,
// never a silent run, and never (this is the part engine.mjs's OWN runtime re-check
// would otherwise turn into) a hard failure of the whole run over one denied step.
export async function runAssistantPlan({ plan, session, conversationId, agentId = DEFAULT_HOUSEHOLD_AGENT_ID, via = "chat" }) {
  // WP-101 slice 1 — the same preflight runSkill uses. resolveActingAgent() performs the
  // identical self-heal + pristine-allow-list widening this line used to do inline
  // (ensureOpenDefaultAgent), and additionally scope-checks the result the way the engine
  // will. Attribution OFF is the deliberate pre-WP-002 rollback shape (agentId null), so
  // it is left alone — the refusal only applies when we are supposed to have an identity
  // and genuinely cannot get one.
  const attributing = chatAttributionEnabled();
  const agent = attributing ? resolveActingAgent({ agentId, session }) : null;
  if (attributing && !agent && requireActingAgentEnabled()) {
    appendAudit({ type: "run.preflight_refused", reason: "no_acting_agent", conversationId: conversationId ?? null, source: "assistant", householdId: session?.householdId ?? null, actorId: session?.actorId ?? null });
    return { ...NO_ACTING_AGENT_ERROR };
  }
  const steps = (plan?.steps ?? []).map((s) => {
    if (!agent) return s;
    const verdict = isToolStepAllowed(agent, s.toolId ?? null, session);
    return verdict.ok ? s : { ...s, clampedOut: { reason: verdict.reason, message: verdict.message ?? "Not permitted for this agent." } };
  });
  const dropped = steps.filter((s) => s.clampedOut).length;
  const clampedPlan = agent ? { ...plan, steps } : plan;
  const run = await startRun({
    source: "assistant",
    sourceRef: { conversationId, agentId: agent ? agent.id : null, skillId: null, via },
    plan: clampedPlan, session, title: plan?.title ?? "Assistant plan",
  });
  addRouting({ runId: run.id, agentId: agent ? agent.id : null, skillId: null, mode: "planner", reason: "assistant chat plan", stepCount: steps.length, droppedSteps: dropped });
  return { ok: true, run, droppedSteps: dropped };
}

/* ============================ SINGLE ENTRY (WP-006 slice 1) ============================
 * orchestrate() is THE choke point every run source funnels through: chat (the assistant
 * routes), an agent "Run now", a schedule/webhook/connector-event trigger fire, and the
 * manual POST /api/runs/start. It resolves attribution, derives a consistent sourceRef
 * `via`, and delegates to the SAME durable machinery that already existed
 * (runAssistantPlan / runAgent / runSkill / startRun) — it does not re-implement policy
 * clamps or start runs itself except for the pre-built manual-plan case. This is the
 * only place that owns "how a run gets created", so a new source can never again invent
 * its own path around the policy clamp (the bug WP-006 exists to close). The single
 * behavioral addition over the legacy delegates is the unified `via` stamp; the rollback
 * flag reproduces the legacy sourceRef exactly (see orchestrateEntryEnabled()).
 *
 * Returns the delegate's shape verbatim: { ok:true, run, droppedSteps? } | { error, message? }.
 */
function deriveVia(source, triggerType) {
  if (source === "assistant" || source === "chat") return "chat";
  if (source === "agent") return "agent";
  if (source === "trigger") {
    if (triggerType === "webhook") return "webhook";
    if (triggerType === "connector_event") return "connector_event";
    return "schedule"; // schedule + recurring (+ any tick-fired target)
  }
  return "manual";
}

export async function orchestrate({
  source = "manual", via, plan = null, goal = null, skillId = null, agentId = null,
  params = {}, session, conversationId = null, triggerId = null, triggerType = null,
  sourceRef = {}, visibility,
} = {}) {
  const on = orchestrateEntryEnabled();
  // The CHAT entry is identified by the caller passing an explicit top-level via:"chat"
  // (only the assistant routes do). It must NOT be inferred from `source`: POST
  // /api/runs/start legitimately submits a PRE-BUILT plan with source:"assistant" (a
  // replay/manual start that carries its own sourceRef.conversationId) and that must run
  // as-is through startRun, never be re-planned/re-attributed by runAssistantPlan.
  const isChat = via === "chat";
  const viaLabel = via ?? deriveVia(source, triggerType);
  // The unified `via` stamp is the ONE thing orchestrate adds on top of the legacy
  // delegates. Flag-off drops it so the delegate receives the exact pre-WP-006 sourceRef.
  // A `via` inside the caller's sourceRef (e.g. a client-labeled "chat" replay) still wins,
  // exactly as the legacy clientSourceRef spread did.
  const baseRef = on ? { via: viaLabel, ...sourceRef } : { ...sourceRef };

  // 1) CHAT — the assistant produced a plan; runAssistantPlan attributes the household's
  //    default agent and applies the WP-003 visible-skip clamp. (via:"chat" both ways —
  //    it predates WP-006, so the flag never changes chat.)
  if (isChat) {
    return await runAssistantPlan({ plan, session, conversationId, agentId: agentId ?? DEFAULT_HOUSEHOLD_AGENT_ID, via: "chat" });
  }
  // 2) AGENT — an explicit agent run, or a trigger whose target is an agent (goal|skill).
  //    runAgent selects + clamps to the agent's permitted∩available set; the engine
  //    re-validates every step, so nothing forbidden can enter the run.
  if (agentId) {
    return await runAgent({ agentId, goal: goal ?? undefined, skillId: skillId ?? undefined, params, session, source, sourceRef: baseRef });
  }
  // 3) SKILL — a deterministic skill run (manual skill start, trigger skill target).
  if (skillId) {
    return await runSkill({ skillId, params, session, source, sourceRef: baseRef });
  }
  // 4) MANUAL raw plan — a pre-built plan executed as-is (no agent attribution). This is
  //    the one path that starts a run directly, and it lives HERE (not in a route) so the
  //    grep gate holds: no route calls startRun to create a run anymore.
  //    WP-101 slice 1 deliberately does NOT preflight an acting agent here. A hand-rolled
  //    plan has no association with any helper, and lending it the household assistant's
  //    identity would lend it that helper's standing send consent — the exact
  //    impersonation the WP-005 adversarial review closed (finding C1, pinned by
  //    server/test/notify-contact-delivery.test.mjs: "a client cannot supply
  //    sourceRef.agentId and inherit an agent's send consent", which asserts this path
  //    lands with NO acting agent). This is the one path where the LATE
  //    internal-functions.mjs refusal is the correct and intended outcome, which is
  //    exactly why slice 2 keeps that guard rather than replacing it.
  if (plan && typeof plan === "object") {
    const run = await startRun({ source, sourceRef: baseRef, plan, params, session, visibility });
    return { ok: true, run };
  }
  return { error: "nothing_to_run", message: "orchestrate() needs a plan, skillId, agentId, or goal." };
}

// Run an AGENT server-side. The orchestrator selects the agent, then routes:
//   • skillId  → run that skill as this agent (engine clamps steps to the agent's
//                permitted ∩ available context),
//   • goal     → plan with the LLM, clamp the plan to the agent's allowed set,
//   • neither  → a read-only pass over the agent's permitted, available read tools.
// In every case the durable executor re-validates each step against the agent policy,
// so a denied / unpermitted tool can never enter the run.
export async function runAgent({ agentId, goal, skillId, params = {}, session, source = "agent", sourceRef = {} } = {}) {
  const agent = selectAgent({ agentId, session });
  if (!agent) return { error: "unknown_agent" };

  if (skillId) {
    return await runSkill({ skillId, agentId: agent.id, params, session, source, sourceRef });
  }

  let plan;
  let mode;
  if (goal && String(goal).trim()) {
    // WP-006 slice 2 — plan against the acting agent's PERMITTED catalog only. The engine
    // clamps to permitted anyway; showing the model just the permitted (+ always-available
    // homeops.*) tools shrinks the prompt for local models and removes tools the agent
    // could never run from the menu in the first place.
    const p = await planFromGoal({ goal: String(goal), session, agent });
    if (!p.ok) return { error: p.error ?? "plan_failed", message: p.message };
    plan = p.plan;
    mode = "planner";
  } else {
    plan = buildReadonlyPlan(agent, session);
    mode = "deterministic";
  }

  // WP-003 (ISS-005) — CLAMP VISIBLY, NEVER SILENTLY. Disallowed tool steps used to be
  // FILTERED OUT of the plan before the run started. The run then completed with the
  // steps that remained and reported success, while the one step the user actually
  // cared about — "email the briefing" — had been deleted without a trace anywhere the
  // family could see (EV-014). Now the step SURVIVES into the run carrying its refusal,
  // and the engine records it as `skipped` with the honest reason. Nothing executes that
  // policy forbids; the difference is purely that the omission is now visible.
  const clamped = (plan.steps ?? []).map((s) => {
    const verdict = isToolStepAllowed(agent, s.toolId ?? null, session);
    return verdict.ok ? s : { ...s, clampedOut: { reason: verdict.reason, message: verdict.message ?? "Not permitted for this agent." } };
  });
  const dropped = clamped.filter((s) => s.clampedOut).length;
  // WP-101 slice 1 — agentId stamped LAST (see runSkill): `agent` is always a real,
  // server-selected identity here, and no caller sourceRef may null it out.
  const run = await startRun({ source, sourceRef: { skillId: null, ...sourceRef, agentId: agent.id }, plan: { ...plan, steps: clamped }, params, session, title: agent.name, visibility: agent.visibility });
  addRouting({ runId: run.id, agentId: agent.id, skillId: null, mode, reason: goal ? "agent goal" : "agent read-only run", stepCount: clamped.length, droppedSteps: dropped });
  return { ok: true, run, droppedSteps: dropped };
}

// A safe default run: the agent's permitted, available, non-approval READ tools.
function buildReadonlyPlan(agent, session) {
  const ctx = agentContext(agent, session);
  const reads = ctx.tools.filter((t) => t.permitted && t.available && !t.requiresApproval && t.action === "Read");
  const steps = reads.map((t) => ({ toolId: t.toolId, title: t.name, detail: `Read current data via ${t.connectorName}.`, input: {} }));
  return { title: `${agent.name} — status pass`, summary: agent.purpose ?? "", steps };
}
