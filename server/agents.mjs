// FamiliOS AI — server-side agent registry.
// The server is the source of truth for which agents exist, what each is permitted
// to do, and which skills it owns. CRUD + versioning + duplicate + rollback follow
// the skills.mjs pattern. The security-critical piece is the CAPABILITY CONTEXT:
//   permitted ∩ available  =  (allow-list − deny-list)  ∩  (executable tools / available functions)
// computed server-side and re-validated in the durable executor so a denied or
// unpermitted tool can never enter an agent's run, regardless of what a plan proposes.
import crypto from "node:crypto";
import {
  listAgents, getAgent, putAgent, patchAgent, deleteAgentRec,
  readJSON, writeJSON, listContactMethods, patchContactMethod,
  getSettings, getRiskOverride, getSkill,
} from "./store.mjs";
import { resolveEffectivePolicy } from "./policy.mjs";
import { toolCatalog } from "./planner.mjs";
import { listPublicFunctions } from "./functions.mjs";
import { listInternalFunctions } from "./internal-functions.mjs";
import { skillReadiness } from "./skills.mjs";

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

/**
 * G4/G5 — "There should be an override to run all the time no matter what" [18:47], and for
 * a helper built from chat, "don't ask for permission, you have approval" [18:52].
 *
 * `approvalPolicy.unattended` is what policy.mjs rule 6b reads, and its high-risk tier is
 * honoured only when `setByRole` says an Owner or Adult Admin chose it. That makes this
 * function security-relevant: `setBy`/`setByRole`/`setAt` are STAMPED FROM THE SESSION and
 * whatever the request body claimed is thrown away. Otherwise the flag that authorises
 * unattended sending could be forged by the same generated agent it authorises — which is
 * exactly the hole rule 6's low-risk bound exists to close.
 *
 * With no session (migrations, internal edits, the repair path) the tier cannot be raised at
 * all: an unattended flag arrives un-attributed, so it only ever covers low-risk steps.
 */
function sanitizeApprovalPolicy(incoming, base, session) {
  const prev = base?.approvalPolicy ?? { autoAllow: [], alwaysApprove: [] };
  if (incoming === undefined) return prev;
  const p = incoming && typeof incoming === "object" ? incoming : {};
  const out = {
    autoAllow: Array.isArray(p.autoAllow) ? p.autoAllow : (prev.autoAllow ?? []),
    alwaysApprove: Array.isArray(p.alwaysApprove) ? p.alwaysApprove : (prev.alwaysApprove ?? []),
  };
  const un = p.unattended;
  if (un === undefined) {
    if (prev.unattended) out.unattended = prev.unattended;   // untouched by this write
    return out;
  }
  if (!un || typeof un !== "object" || un.enabled !== true) return out;  // turned off → gone
  const role = session?.role ?? null;
  const canRaise = ["Owner", "Adult Admin"].includes(String(role));
  const wantsHigh = un.includeHighRisk === true;
  out.unattended = {
    enabled: true,
    // Asking for the high-risk tier without the standing to grant it is recorded as the
    // low tier, not as an error — the UI reads back what actually applies.
    includeHighRisk: wantsHigh && canRaise,
    setBy: session?.actorId ?? null,
    setByRole: canRaise ? role : null,
    setAt: new Date().toISOString(),
  };
  return out;
}

function normalizeAgent(body, base = {}, session = null) {
  return {
    icon: body.icon ?? base.icon ?? "Bot",
    purpose: body.purpose ?? base.purpose ?? "",
    instructions: body.instructions ?? base.instructions ?? "",
    status: AGENT_STATUSES.includes(body.status) ? body.status : (base.status ?? "Draft"),
    spaceType: body.spaceType ?? base.spaceType ?? "Family",
    // Personal-space agents are visible/usable only by their creator; family
    // (household) agents — the default — are shared with everyone.
    visibility: body.visibility === "personal" ? "personal" : body.visibility === "household" ? "household" : (base.visibility ?? "household"),
    skillIds: Array.isArray(body.skillIds) ? body.skillIds : (base.skillIds ?? []),
    allowedToolIds: Array.isArray(body.allowedToolIds) ? body.allowedToolIds : (base.allowedToolIds ?? []),
    allowedFunctionIds: Array.isArray(body.allowedFunctionIds) ? body.allowedFunctionIds : (base.allowedFunctionIds ?? []),
    deniedToolIds: Array.isArray(body.deniedToolIds) ? body.deniedToolIds : (base.deniedToolIds ?? []),
    deniedFunctionIds: Array.isArray(body.deniedFunctionIds) ? body.deniedFunctionIds : (base.deniedFunctionIds ?? []),
    approvalPolicy: sanitizeApprovalPolicy(body.approvalPolicy, base, session),
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
    createdBy: session?.actorId ?? null,
    name: body.name ?? "Untitled agent",
    ...normalizeAgent(body, {}, session),
    system: false,
    version: 1,
    createdAt: Date.now(),
    updatedAt: now,
  };
  putAgent(agent);
  return agent;
}

export function replaceAgent(id, body, session = null) {
  const existing = getAgent(id);
  if (!existing) return null;
  snapshotAgent(existing);
  const next = {
    ...existing,
    name: body.name ?? existing.name,
    ...normalizeAgent(body, existing, session),
    id, householdId: existing.householdId, system: existing.system,
    version: (existing.version ?? 1) + 1,
    updatedAt: new Date().toISOString(),
  };
  putAgent(next);
  return next;
}

export function partialUpdateAgent(id, patch, session = null) {
  const existing = getAgent(id);
  if (!existing) return null;
  snapshotAgent(existing);
  const next = {
    ...existing,
    ...patch,
    // A PATCH spreads the body verbatim, so approvalPolicy has to be re-stamped here too —
    // this is the route a client actually uses to turn unattended running on.
    ...(patch && Object.prototype.hasOwnProperty.call(patch, "approvalPolicy")
      ? { approvalPolicy: sanitizeApprovalPolicy(patch.approvalPolicy, existing, session) }
      : {}),
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
  // SECURITY (adversarial review, finding H1): deleting a helper is how a family
  // expects to REVOKE it. Its standing send-consent lives on the contact methods that
  // allowlisted it, not on the agent record, so deleting the agent alone left live
  // grants pointing at an id that no longer resolves. Purge them here so revocation
  // means what a family thinks it means.
  try {
    for (const m of listContactMethods((c) => (c.allowedAgentIds ?? []).includes(id))) {
      patchContactMethod(m.id, { allowedAgentIds: (m.allowedAgentIds ?? []).filter((a) => a !== id) });
    }
  } catch { /* revocation is best-effort; the engine also hard-fails unknown agents */ }
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

  // WP-105/ISS-107 — the effective-policy view, computed HERE so the same pass that
  // produces the counts also produces the decision and the rule behind it. One
  // computation, so a row and a count can never tell different stories.
  //
  // toolCatalog has already applied any household risk override (keeping defaultRisk /
  // defaultRequiresApproval as the pre-override values), so the resolver is fed the
  // PRE-override capability plus the override itself — otherwise it would be applied
  // twice and report the wrong rule for why the gate cleared.
  const householdId = session?.householdId;
  const settings = householdId ? getSettings(householdId) : {};
  const policyFor = (cap) => resolveEffectivePolicy({
    cap, agent, settings,
    override: householdId ? getRiskOverride(householdId, cap.id) : null,
  });

  const catalog = toolCatalog(session);
  const toolView = catalog.map((t) => {
    const permitted = !deniedTools.has(t.toolId) && (allowTools.length === 0 || allowTools.includes(t.toolId));
    const policy = policyFor({
      id: t.toolId, name: t.name, action: t.action,
      risk: t.defaultRisk ?? t.risk,
      requiresApproval: t.defaultRequiresApproval ?? t.requiresApproval,
    });
    return { toolId: t.toolId, name: t.name, connectorName: t.connectorName, action: t.action, requiresApproval: t.requiresApproval, available: execTools.has(t.toolId), permitted, denied: deniedTools.has(t.toolId), policy };
  });
  const fnView = listPublicFunctions(session).map((f) => {
    const permitted = !deniedFns.has(f.id) && (allowFns.length === 0 || allowFns.includes(f.id));
    const policy = policyFor({ id: f.id, name: f.name, action: f.action, risk: f.risk, requiresApproval: f.requiresApproval });
    return { id: f.id, name: f.name, type: f.type, requiresApproval: f.requiresApproval, available: f.state === "available", state: f.state, permitted, denied: deniedFns.has(f.id), policy };
  });

  const executable = [
    ...toolView.filter((t) => t.permitted && t.available).map((t) => t.toolId),
    ...fnView.filter((f) => f.permitted && f.available).map((f) => f.id),
  ];
  // G3 — "will it run unattended?" answered from the policy, not from a label. A helper runs
  // unattended when nothing it can actually execute would stop and wait for a person.
  const unattended = agent.approvalPolicy?.unattended ?? null;
  const gatedNow = [
    ...toolView.filter((t) => t.permitted && t.available && t.policy?.requiresApproval).map((t) => t.name),
    ...fnView.filter((f) => f.permitted && f.available && f.policy?.requiresApproval).map((f) => f.name),
  ];
  // G2 — [18:06] "It says it runs the assigned use case skill. Well, what IS that skill?"
  // The agent detail screen showed that sentence with no way to find out. Name them, say how
  // many steps each has, and say whether it can actually run today.
  const skills = (agent.skillIds ?? []).map((sid) => {
    const s = getSkill(sid);
    if (!s) return { id: sid, name: "Missing skill", stepCount: 0, ready: false, blockedReason: "It no longer exists." };
    const readiness = skillReadiness(s, session);
    return {
      id: s.id,
      name: s.name ?? "Untitled skill",
      description: s.description ?? "",
      stepCount: (s.steps ?? []).length,
      stepNames: (s.steps ?? []).slice(0, 8).map((st) => st.name ?? st.step_id ?? "Untitled step"),
      ready: !!readiness.ready,
      blockedReason: readiness.ready ? null : (readiness.unresolved?.[0]?.detail ?? "Something it needs isn't set up yet."),
    };
  });

  return {
    agentId: agent.id,
    openAllowList: allowTools.length === 0 && allowFns.length === 0, // permissive (deny-only) default
    skills,
    unattended: unattended?.enabled
      ? { enabled: true, includeHighRisk: !!unattended.includeHighRisk, setByRole: unattended.setByRole ?? null, setAt: unattended.setAt ?? null }
      : { enabled: false, includeHighRisk: false, setByRole: null, setAt: null },
    // The honest answer, and the exact steps that would still park. An empty list with
    // executables present is the only thing that means "this runs start to finish alone".
    runsUnattended: gatedNow.length === 0 && executable.length > 0,
    gatedCapabilityNames: gatedNow.slice(0, 8),
    gatedCount: gatedNow.length,
    // ISS-124: tools and functions carry INDEPENDENT allow-lists, so a single
    // "openAllowList" boolean can't describe the state honestly — restricting tools while
    // leaving functions open reads as "explicit" overall even though every function is
    // still permitted. Surfaced per kind so the UI can say which is which instead of
    // making a claim that is half true.
    openToolAllowList: allowTools.length === 0,
    openFunctionAllowList: allowFns.length === 0,
    tools: toolView,
    functions: fnView,
    executable,
    // ISS-124 — "Six executed, six permitted. Okay, five permitted. That doesn't make
    // any sense." All three counts derive from the SAME toolView/fnView above, and each
    // means one specific thing:
    //   available  — could run right now (connected/ready), ignoring this agent's policy
    //   permitted  — allowed by this agent's policy; with an OPEN allow-list that is
    //                every capability except denied ones, which is why this number drops
    //                the moment a family starts listing tools explicitly. That change is
    //                correct, and the UI now labels it so it stops reading as a bug.
    //   executable — permitted ∩ available, i.e. what can actually run now
    availableCount: toolView.filter((t) => t.available).length + fnView.filter((f) => f.available).length,
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

/** Personal agents exist only for the member who created them. */
export function agentVisibleTo(a, session) {
  if (!a) return false;
  return !(a.visibility === "personal" && a.createdBy && a.createdBy !== session?.actorId);
}

/* ------------------------- orchestrator selection ----------------------- */
// Pick the agent for a run. Explicit id wins (scope-checked). Otherwise the household's
// default active agent, else any active agent, else the seeded household assistant.
export function selectAgent({ agentId, session } = {}) {
  const hh = session?.householdId ?? "local";
  const scoped = (a) => a && (a.householdId === hh || a.householdId === "local") && agentVisibleTo(a, session);
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
  return listAgents((a) => (a.householdId === hh || a.householdId === "local") && agentVisibleTo(a, session))
    .filter((a) => !status || a.status === status)
    .map(publicAgent)
    .sort((a, b) => (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? 1 : -1);
}
