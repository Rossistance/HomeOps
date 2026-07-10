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
export async function testSkill({ skillId, params, session }) {
  return await runSkill({ skillId, params: params ?? {}, session, source: "skill_test" });
}
