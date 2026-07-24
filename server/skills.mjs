// FamiliOS AI — server-side skill registry.
// CRUD, versioning, duplicate, test, promote, rollback, and LLM-assisted function inference.
// The store.mjs accessors (listSkills / getSkill / putSkill / patchSkill / deleteSkillRec)
// handle raw persistence; this module adds the business logic layer.
import crypto from "node:crypto";
import {
  listSkills, getSkill, putSkill, patchSkill, deleteSkillRec,
  readJSON, writeJSON, appendAudit, getSettings,
} from "./store.mjs";
import { toolCatalog } from "./planner.mjs";
import { listPublicFunctions } from "./functions.mjs";
import { providerChat } from "./ai.mjs";
import { runSkill } from "./orchestrator.mjs";

/* ---- Skill versioning (append-only snapshot, capped at 20 per skill) ---- */
export function listSkillVersions(skillId) {
  return readJSON("skill_versions.json", {})[skillId] ?? [];
}
function snapshotSkill(skill) {
  const all = readJSON("skill_versions.json", {});
  const prev = all[skill.id] ?? [];
  all[skill.id] = [...prev.slice(-19), { ...skill, snapshotAt: new Date().toISOString() }];
  writeJSON("skill_versions.json", all);
}

/* ---- Create ---- */
export function createSkill(body, session) {
  const id = "skl_" + crypto.randomBytes(10).toString("hex");
  const now = new Date().toISOString();
  const skill = {
    id,
    householdId: session?.householdId ?? "local",
    name: body.name ?? "Untitled Skill",
    description: body.description ?? "",
    domain: body.domain ?? "General",
    type: body.type ?? "custom",
    mode: body.mode ?? "deterministic",
    defaultAgentId: body.defaultAgentId ?? null,
    planner_guidance: body.planner_guidance ?? "",
    input_schema: body.input_schema ?? [],
    output_schema: body.output_schema ?? [],
    required_connectors: body.required_connectors ?? [],
    required_tools: body.required_tools ?? [],
    required_functions: body.required_functions ?? [],
    optional_tools: body.optional_tools ?? [],
    optional_functions: body.optional_functions ?? [],
    steps: body.steps ?? [],
    approval_policy: body.approval_policy ?? {},
    risk_level: body.risk_level ?? "Low",
    memory_policy: body.memory_policy ?? {},
    test_cases: body.test_cases ?? [],
    version: 1,
    status: "draft",
    system: false,
    createdAt: Date.now(),
    updatedAt: now,
  };
  putSkill(skill);
  return skill;
}

/* ---- Full replace (PUT) — never changes id / householdId / system flag ---- */
export function replaceSkill(id, body) {
  const existing = getSkill(id);
  if (!existing) return null;
  snapshotSkill(existing);
  const now = new Date().toISOString();
  const next = {
    ...existing,
    ...body,
    id,
    householdId: existing.householdId,
    system: existing.system,
    version: (existing.version ?? 1) + 1,
    updatedAt: now,
  };
  putSkill(next);
  return next;
}

/* ---- Partial update (PATCH) ---- */
export function partialUpdateSkill(id, patch) {
  const existing = getSkill(id);
  if (!existing) return null;
  snapshotSkill(existing);
  const now = new Date().toISOString();
  const next = {
    ...existing,
    ...patch,
    id,
    householdId: existing.householdId,
    system: existing.system,
    version: (existing.version ?? 1) + 1,
    updatedAt: now,
  };
  putSkill(next);
  return next;
}

/* ---- Delete (protects system skills) ---- */
export function deleteSkill(id) {
  const existing = getSkill(id);
  if (!existing) return { error: "not_found" };
  if (existing.system) return { error: "system_skill_protected" };
  snapshotSkill(existing);
  deleteSkillRec(id);
  return { ok: true };
}

/* ---- Duplicate (creates a draft copy) ---- */
export function duplicateSkill(id, session) {
  const existing = getSkill(id);
  if (!existing) return null;
  const newId = "skl_" + crypto.randomBytes(10).toString("hex");
  const now = new Date().toISOString();
  const copy = {
    ...existing,
    id: newId,
    name: `${existing.name} (copy)`,
    status: "draft",
    system: false,
    version: 1,
    householdId: session?.householdId ?? existing.householdId,
    createdAt: Date.now(),
    updatedAt: now,
  };
  putSkill(copy);
  return copy;
}

/* ---- Promote (draft → available) ---- */
export function promoteSkill(id) {
  const existing = getSkill(id);
  if (!existing) return { error: "not_found" };
  if (existing.system) return { error: "system_skill" };
  snapshotSkill(existing);
  return patchSkill(id, { status: "available" });
}

/* ---- Rollback to a prior snapshot ---- */
export function rollbackSkill(id, targetVersion) {
  const versions = listSkillVersions(id);
  if (!versions.length) return { error: "no_versions" };
  const snap = targetVersion != null
    ? versions.find((v) => v.version === targetVersion)
    : versions[versions.length - 1];
  if (!snap) return { error: "version_not_found" };
  const existing = getSkill(id);
  if (!existing) return { error: "not_found" };
  if (existing.system) return { error: "system_skill_protected" };
  snapshotSkill(existing);
  // eslint-disable-next-line no-unused-vars
  const { snapshotAt, ...rest } = snap;
  const restored = { ...rest, version: (existing.version ?? 1) + 1, updatedAt: new Date().toISOString() };
  putSkill(restored);
  return restored;
}

/* ---- Infer required capabilities from a plain-English description via LLM ---- */
export async function inferFunctions({ description, session, providerId }) {
  const catalog = toolCatalog(session);
  const catalogSummary = catalog
    .slice(0, 60)
    .map((t) => `${t.toolId} — "${t.name}" (${t.action}${t.connected ? "" : ", not connected"})`)
    .join("\n");

  const prompt = `You are a FamiliOS skill designer. Given a skill description, suggest which tools are needed and provide a sequence of steps.

Skill description: "${description}"

Available tools (toolId — "name" action):
${catalogSummary}

Return ONLY valid JSON (no markdown fences, no commentary):
{
  "suggestedToolIds": ["tool.id1"],
  "missingCapabilities": ["description of a needed capability not in the available tools"],
  "suggestedSteps": [
    { "step_id": "s1", "name": "Step name", "description": "What this step does", "tool_id": "tool.id1", "input_mapping": {}, "approval_required": false }
  ]
}`;

  const pid = providerId || getSettings(session?.householdId).aiActiveProvider;
  if (!pid) return { ok: false, error: "no_provider", message: "No AI provider configured — add one in Settings first." };

  const out = await providerChat(pid, { messages: [{ role: "user", content: prompt }] });
  if (!out.ok) return { ok: false, error: out.error, message: out.message };

  try {
    const text = String(out.text ?? "");
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const raw = fence ? fence[1] : text;
    const first = raw.indexOf("{"), last = raw.lastIndexOf("}");
    if (first === -1 || last === -1) throw new Error("no json object");
    const parsed = JSON.parse(raw.slice(first, last + 1));
    return {
      ok: true,
      model: out.model,
      suggestedToolIds: Array.isArray(parsed.suggestedToolIds) ? parsed.suggestedToolIds : [],
      missingCapabilities: Array.isArray(parsed.missingCapabilities) ? parsed.missingCapabilities : [],
      suggestedSteps: Array.isArray(parsed.suggestedSteps) ? parsed.suggestedSteps : [],
    };
  } catch {
    return { ok: false, error: "parse_error", message: "AI returned an unparseable response." };
  }
}

/* ---- Test a skill as a real server run (source = "skill_test") ---- */
/**
 * WP-108 / ISS-117 — is this skill actually runnable, and if not, exactly what is missing?
 *
 * "Infer capabilities" happily produced a draft with steps that named no handler, or named
 * one the household doesn't have, and Real Test stayed pressable the whole time — so the
 * only way to discover a half-built skill was to run it and read the wreckage ("Finish
 * configuring the handler before testing"; "the app should be doing this by itself").
 *
 * Returns the UNRESOLVED list rather than a bare boolean, because the point is to tell a
 * family what to fix, not just that something is wrong. Server-side so the answer is the
 * same for the button, the API, and the run path — a disabled button alone would be the
 * same decorative control this mission already found in the approval policy.
 */
export function skillReadiness(skill, session) {
  const steps = skill?.steps ?? [];
  const unresolved = [];
  if (steps.length === 0) {
    unresolved.push({ stepId: null, name: skill?.name ?? "This skill", reason: "no_steps", detail: "It has no steps yet, so there is nothing to run." });
  }
  // A capability "resolves" if the household can name it: the live tool catalog
  // (provider/connector/internal) plus registered user functions.
  const known = new Set([
    ...toolCatalog(session).map((t) => t.toolId),
    ...listPublicFunctions(session).map((f) => f.id),
  ]);
  for (const s of steps) {
    const toolId = s.tool_id ?? s.toolId ?? null;
    if (!toolId) {
      unresolved.push({ stepId: s.step_id ?? null, name: s.name ?? "Untitled step", reason: "no_handler", detail: "No capability is bound to this step yet." });
      continue;
    }
    if (!known.has(toolId)) {
      unresolved.push({ stepId: s.step_id ?? null, name: s.name ?? "Untitled step", toolId, reason: "unknown_capability", detail: `"${toolId}" isn't a capability this household has — build or connect it first.` });
    }
  }
  return { ready: unresolved.length === 0, unresolved };
}

export async function testSkill({ skillId, params, session }) {
  // ISS-117: refuse a real test against an incomplete handler, and say exactly what is
  // unresolved. Enforced HERE, not only in the builder's disabled state, so the same
  // answer holds for the API and for anything else that reaches this path.
  const skill = getSkill(skillId);
  if (skill) {
    const readiness = skillReadiness(skill, session);
    if (!readiness.ready) {
      appendAudit({ type: "skill.test_refused", skillId, reason: "not_ready", unresolved: readiness.unresolved.length, householdId: session?.householdId ?? null, actorId: session?.actorId ?? null });
      return { error: "skill_not_ready", message: "This skill isn't finished yet — some steps have no capability behind them.", unresolved: readiness.unresolved };
    }
  }
  return await runSkill({ skillId, params: params ?? {}, session, source: "skill_test" });
}
