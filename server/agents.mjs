// HomeOps AI — server-side agent registry.
// The server is the source of truth for which agents exist, what each is permitted
// to do, and which skills it owns. CRUD + versioning + duplicate + rollback follow
// the skills.mjs pattern. The security-critical piece is the CAPABILITY CONTEXT:
//   permitted ∩ available  =  (allow-list − deny-list)  ∩  (executable tools / available functions)
// computed server-side and re-validated in the durable executor so a denied or
// unpermitted tool can never enter an agent's run, regardless of what a plan proposes.
import crypto from "node:crypto";
import {
  listAgents, getAgent, putAgent, patchAgent, deleteAgentRec,
  readJSON, writeJSON,
} from "./store.mjs";
import { toolCatalog } from "./planner.mjs";
import { listPublicFunctions } from "./functions.mjs";
import { listInternalFunctions } from "./internal-functions.mjs";

/* ------------------------------ versioning ------------------------------ */
export function listAgentVersions(agentId) {
  return readJSON("agent_versions.json", {})[agentId] ?? [];
}
function snapshotAgent(agent) {
  const all = readJSON("agent_versions.json", {});
  all[agent.id] = [...(all[agent.id] ?? []).slice(-19), { ...agent, snapshotAt: new Date().toISOString() }];
  writeJSON("agent_versions.json", all);
}

/* --------------------------------- shape -------------------------------- */
const AGENT_STATUSES = ["Active", "Paused", "Draft", "Needs Attention", "Archived"];
function normalizeAgent(body, base = {}) {
  return {
    icon: body.icon ?? base.icon ?? "Bot",
    purpose: body.purpose ?? base.purpose ?? "",
    instructions: body.instructions ?? base.instructions ?? "",
    status: AGENT_STATUSES.includes(body.status) ? body.status : (base.status ?? "Draft"),
    spaceType: body.spaceType ?? base.spaceType ?? "Family",
    skillIds: Array.isArray(body.skillIds) ? body.skillIds : (base.skillIds ?? []),
    allowedToolIds: Array.isArray(body.allowedToolIds) ? body.allowedToolIds : (base.allowedToolIds ?? []),
    allowedFunctionIds: Array.isArray(body.allowedFunctionIds) ? body.allowedFunctionIds : (base.allowedFunctionIds ?? []),
    deniedToolIds: Array.isArray(body.deniedToolIds) ? body.deniedToolIds : (base.deniedToolIds ?? []),
    deniedFunctionIds: Array.isArray(body.deniedFunctionIds) ? body.deniedFunctionIds : (base.deniedFunctionIds ?? []),
    approvalPolicy: body.approvalPolicy ?? base.approvalPolicy ?? { autoAllow: [], alwaysApprove: [] },
    triggers: Array.isArray(body.triggers) ? body.triggers : (base.triggers ?? []),
  };
}

/* --------------------------- capability derivation ----------------------- */
// Intelligent tool preselection for chat-built agents: an agent created alongside a
// skill inherits the capabilities its skill's steps actually reference, split against
// the live catalogs (real tool ids → allowedToolIds, internal function ids →
// allowedFunctionIds). Without this, chat-built agents landed with empty allow-lists
// and permitted∩available made them inert — "created" but unable to execute anything.
export function deriveCapabilitiesFromSteps(stepToolIds, session) {
  const tools = new Set();
  const fns = new Set();
  const catalogIds = new Set(toolCatalog(session).map((t) => t.toolId));
  // Function ids come from BOTH registries: built-in internal functions (homeops.*)
  // and household-defined custom functions.
  const functionIds = new Set([
    ...listInternalFunctions().map((f) => f.id),
    ...listPublicFunctions(session).map((f) => f.id),
  ]);
  for (const id of stepToolIds) {
    if (!id) continue; // null = reasoning step, no capability needed
    if (functionIds.has(id)) fns.add(id);
    else tools.add(id); // catalog tools AND unknown ids — permitted∩available filters unknowns at run time
  }
  return { allowedToolIds: [...tools], allowedFunctionIds: [...fns], knownToolCount: [...tools].filter((t) => catalogIds.has(t)).length };
}

/* --------------------------------- CRUD --------------------------------- */
// createAgent accepts an optional id so the one-time IndexedDB→server migration can
// preserve local agent ids (so existing runs' sourceRef.agentId resolves). If an id
// is supplied and already exists, the existing record is returned unchanged
// (idempotent migration — never clobbers a server agent).
export function createAgent(body, session) {
  const id = body.id?.trim() || "agt_" + crypto.randomBytes(10).toString("hex");
  const existing = getAgent(id);
  if (existing) return existing;
  const now = new Date().toISOString();
  const agent = {
    id,
    householdId: session?.householdId ?? "local",
    name: body.name ?? "Untitled agent",
    ...normalizeAgent(body),
    system: false,
    version: 1,
    createdAt: Date.now(),
    updatedAt: now,
  };
  putAgent(agent);
  return agent;
}

export function replaceAgent(id, body) {
  const existing = getAgent(id);
  if (!existing) return null;
  snapshotAgent(existing);
  const next = {
    ...existing,
    name: body.name ?? existing.name,
    ...normalizeAgent(body, existing),
    id, householdId: existing.householdId, system: existing.system,
    version: (existing.version ?? 1) + 1,
    updatedAt: new Date().toISOString(),
  };
  putAgent(next);
  return next;
}

export function partialUpdateAgent(id, patch) {
  const existing = getAgent(id);
  if (!existing) return null;
  snapshotAgent(existing);
  const next = {
    ...existing,
    ...patch,
    id, householdId: existing.householdId, system: existing.system,
    version: (existing.version ?? 1) + 1,
    updatedAt: new Date().toISOString(),
  };
  putAgent(next);
  return next;
}

export function deleteAgent(id) {
  const existing = getAgent(id);
  if (!existing) return { error: "not_found" };
  if (existing.system) return { error: "system_agent_protected" };
  snapshotAgent(existing);
  deleteAgentRec(id);
  return { ok: true };
}

export function duplicateAgent(id, session) {
  const existing = getAgent(id);
  if (!existing) return null;
  const newId = "agt_" + crypto.randomBytes(10).toString("hex");
  const now = new Date().toISOString();
  const copy = {
    ...existing,
    id: newId,
    name: `${existing.name} (copy)`,
    status: "Draft",
    system: false,
    version: 1,
    householdId: session?.householdId ?? existing.householdId,
    createdAt: Date.now(),
    updatedAt: now,
  };
  putAgent(copy);
  return copy;
}

export function rollbackAgent(id, targetVersion) {
  const versions = listAgentVersions(id);
  if (!versions.length) return { error: "no_versions" };
  const snap = targetVersion != null ? versions.find((v) => v.version === targetVersion) : versions[versions.length - 1];
  if (!snap) return { error: "version_not_found" };
  const existing = getAgent(id);
  if (!existing) return { error: "not_found" };
  if (existing.system) return { error: "system_agent_protected" };
  snapshotAgent(existing);
  const { snapshotAt, ...rest } = snap;
  const restored = { ...rest, version: (existing.version ?? 1) + 1, updatedAt: new Date().toISOString() };
  putAgent(restored);
  return restored;
}

/* --------------------- capability context (the crux) -------------------- */
// Live executable tool ids for this actor (connected provider tools + ready connectors).
function executableToolIds(session) {
  return new Set(toolCatalog(session).filter((t) => t.connected).map((t) => t.toolId));
}
// Live available function ids for this actor (passed a real test + deps satisfied).
function availableFunctionIds(session) {
  return new Set(listPublicFunctions(session).filter((f) => f.state === "available").map((f) => f.id));
}

// Build the agent's effective capability context: which tools/functions are PERMITTED
// (allow-list − deny-list; empty allow-list = "all", restricted only by deny), and of
// those which are AVAILABLE right now. The browser renders this; it never decides it.
export function agentContext(agent, session) {
  const execTools = executableToolIds(session);
  const availFns = availableFunctionIds(session);
  const deniedTools = new Set(agent.deniedToolIds ?? []);
  const deniedFns = new Set(agent.deniedFunctionIds ?? []);
  const allowTools = agent.allowedToolIds ?? [];
  const allowFns = agent.allowedFunctionIds ?? [];

  const catalog = toolCatalog(session);
  const toolView = catalog.map((t) => {
    const permitted = !deniedTools.has(t.toolId) && (allowTools.length === 0 || allowTools.includes(t.toolId));
    return { toolId: t.toolId, name: t.name, connectorName: t.connectorName, action: t.action, requiresApproval: t.requiresApproval, available: execTools.has(t.toolId), permitted, denied: deniedTools.has(t.toolId) };
  });
  const fnView = listPublicFunctions(session).map((f) => {
    const permitted = !deniedFns.has(f.id) && (allowFns.length === 0 || allowFns.includes(f.id));
    return { id: f.id, name: f.name, type: f.type, requiresApproval: f.requiresApproval, available: f.state === "available", state: f.state, permitted, denied: deniedFns.has(f.id) };
  });

  const executable = [
    ...toolView.filter((t) => t.permitted && t.available).map((t) => t.toolId),
    ...fnView.filter((f) => f.permitted && f.available).map((f) => f.id),
  ];
  return {
    agentId: agent.id,
    openAllowList: allowTools.length === 0 && allowFns.length === 0, // permissive (deny-only) default
    tools: toolView,
    functions: fnView,
    executable,
    permittedCount: toolView.filter((t) => t.permitted).length + fnView.filter((f) => f.permitted).length,
    executableCount: executable.length,
  };
}

// Engine-facing policy guard (re-validated at run time). A reasoning step (no tool)
// is always allowed. A denied id is always blocked. With a non-empty allow-list, only
// listed ids pass; an empty allow-list is permissive (deny-only). Availability is
// enforced separately by the executor, so this is purely the allow/deny POLICY.
export function isToolStepAllowed(agent, toolId, _session) {
  if (!toolId) return { ok: true };
  if ((agent.deniedToolIds ?? []).includes(toolId) || (agent.deniedFunctionIds ?? []).includes(toolId)) {
    return { ok: false, reason: "denied", message: `"${toolId}" is on this agent's deny list.` };
  }
  const allow = [...(agent.allowedToolIds ?? []), ...(agent.allowedFunctionIds ?? [])];
  if (allow.length > 0 && !allow.includes(toolId)) {
    return { ok: false, reason: "not_permitted", message: `"${toolId}" is not in this agent's allowed tools/functions.` };
  }
  return { ok: true };
}

/* ------------------------- orchestrator selection ----------------------- */
// Pick the agent for a run. Explicit id wins (scope-checked). Otherwise the household's
// default active agent, else any active agent, else the seeded household assistant.
export function selectAgent({ agentId, session } = {}) {
  const hh = session?.householdId ?? "local";
  const scoped = (a) => a && (a.householdId === hh || a.householdId === "local");
  if (agentId) { const a = getAgent(agentId); return scoped(a) ? a : null; }
  const all = listAgents(scoped);
  return all.find((a) => a.id === "agt_household") ?? all.find((a) => a.status === "Active") ?? all[0] ?? null;
}

/* ----------------------------- public view ------------------------------ */
export function publicAgent(agent) {
  return agent; // all fields non-secret
}
export function listPublicAgents(session, { status } = {}) {
  const hh = session?.householdId ?? "local";
  return listAgents((a) => a.householdId === hh || a.householdId === "local")
    .filter((a) => !status || a.status === status)
    .map(publicAgent)
    .sort((a, b) => (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? 1 : -1);
}
