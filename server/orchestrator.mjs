// FamiliOS AI — orchestrator: turns an entry point (skill run, agent run, chat plan)
// into a concrete plan, records the routing decision, and starts a durable run.
// Slice 1 implements deterministic skill→plan expansion + routing; agent/skill
// SELECTION from a free-text goal is fleshed out in later slices.
import { getSkill, getAgent, addRouting } from "./store.mjs";
import { startRun } from "./engine.mjs";
import { selectAgent, agentContext, isToolStepAllowed } from "./agents.mjs";
import { planFromGoal } from "./planner.mjs";

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
export async function runAssistantPlan({ plan, session, conversationId, agentId = "agt_household" }) {
  const run = await startRun({ source: "assistant", sourceRef: { conversationId, agentId, skillId: null }, plan, session, title: plan?.title ?? "Assistant plan" });
  addRouting({ runId: run.id, agentId, skillId: null, mode: "planner", reason: "assistant chat plan", stepCount: (plan?.steps ?? []).length });
  return { ok: true, run };
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
