// FamiliOS AI — orchestrator: turns an entry point (skill run, agent run, chat plan)
// into a concrete plan, records the routing decision, and starts a durable run.
// Slice 1 implements deterministic skill→plan expansion + routing; agent/skill
// SELECTION from a free-text goal is fleshed out in later slices.
import { getSkill, getAgent, patchAgent, addRouting } from "./store.mjs";
import { startRun } from "./engine.mjs";
import { selectAgent, agentContext, isToolStepAllowed } from "./agents.mjs";
import { planFromGoal } from "./planner.mjs";

// WP-002 slice 2 — rollback flag for chat-run agent attribution. Default ON; set
// HOMEOPS_CHAT_AGENT_ATTRIBUTION=off to instantly revert chat runs to the pre-WP-002
// shape (no agentId — homeops.notify_contact goes back to refusing them). Read live
// (not cached at module load) so a test harness can flip it per spawned server.
function chatAttributionEnabled() {
  return String(process.env.HOMEOPS_CHAT_AGENT_ATTRIBUTION ?? "on").trim().toLowerCase() !== "off";
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
function ensureOpenDefaultAgent(agentId) {
  if (agentId !== "agt_household") return;
  const agent = getAgent(agentId);
  if (!agent) return;
  const stillPristine = sameIdSet(agent.allowedToolIds ?? [], SEEDED_DEFAULT_ALLOWED_TOOL_IDS) && sameIdSet(agent.allowedFunctionIds ?? [], SEEDED_DEFAULT_ALLOWED_FUNCTION_IDS);
  if (stillPristine) patchAgent(agentId, { allowedToolIds: [], allowedFunctionIds: [] });
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

// Run a skill deterministically (typed steps). Returns the durable run.
export async function runSkill({ skillId, params = {}, session, agentId, source = "skill", sourceRef = {} }) {
  const skill = getSkill(skillId);
  if (!skill) return { error: "unknown_skill" };
  if (skill.householdId && session?.householdId && skill.householdId !== session.householdId) return { error: "scope_mismatch" };
  const plan = buildPlanFromSkill(skill, params);
  const ref = { skillId, agentId: agentId ?? skill.defaultAgentId ?? null, ...sourceRef };
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
export async function runAssistantPlan({ plan, session, conversationId, agentId = "agt_household", via = "chat" }) {
  const attributed = chatAttributionEnabled() ? agentId : null;
  if (attributed) ensureOpenDefaultAgent(attributed);
  const agent = attributed ? getAgent(attributed) : null;
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
    const p = await planFromGoal({ goal: String(goal), session });
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
  const run = await startRun({ source, sourceRef: { agentId: agent.id, skillId: null, ...sourceRef }, plan: { ...plan, steps: clamped }, params, session, title: agent.name, visibility: agent.visibility });
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
