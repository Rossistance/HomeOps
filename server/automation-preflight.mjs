// FamiliOS AI — WP-101 slice 4: the missing "compile step" between a template and an
// executable automation.
//
// grep -r "useTemplate|createFromTemplate|instantiateTemplate" server/ returns ZERO
// matches — template instantiation happens entirely client-side
// (src/store/useStore.ts createAutomationFromTemplate, ~L2234) with no server
// validation. An automation can therefore land "Active" while referencing an agent,
// tool, integration, or multi-agent role assignment that doesn't actually exist —
// and the run engine only discovers the gap at run time, deep in a failed run's
// trace (no_acting_agent / no_recipient — see internal-functions.mjs homeops.notify_contact).
//
// This module is that compile step: given a candidate plan (+ the agent/role
// assignments it resolved to), validate every reference against the REAL server
// registries — agents.mjs' own agent store, and the tool registries in
// providers.mjs / connectors.mjs / internal-functions.mjs, via planner.mjs's own
// toolCatalog() for real per-actor connectedness — and report back exactly what's
// unresolved and where to fix it, so a client can refuse to activate instead of
// finding out mid-run.
//
// READ-ONLY BY CONSTRUCTION: every helper below only reads (getAgent/listAgents,
// toolCatalog, the provider/connector/internal-function registries). Nothing here
// calls a tool's run(), a store put/patch/delete, or the run engine. No registry data
// is duplicated — existence/connectedness are always resolved by asking the real
// registry modules, never by a local copy of their contents.
import crypto from "node:crypto";
import { listAgents } from "./store.mjs";
import { selectAgent, agentVisibleTo } from "./agents.mjs";
import { resolveActingAgent as resolveRunActingAgent } from "./orchestrator.mjs";
import { toolCatalog, INTERNAL_INPUTS } from "./planner.mjs";
import { findToolGlobal } from "./providers.mjs";
import { CONNECTORS } from "./connectors.mjs";
import { getInternalFunction } from "./internal-functions.mjs";

// Input keys that name an actual recipient across the tool registries — gmail.send /
// outlook.send / sms.send `to`, slack.postMessage `channel`, homeops.notify_contact
// `to`/`methodId`. Deliberately narrow: a delivering tool with NONE of these among its
// declared inputs (e.g. alexa.announce, whose blank `device` means "all") has no
// resolvable-recipient concept to check here, so it's left alone rather than guessed at.
const RECIPIENT_INPUT_KEYS = new Set(["to", "channel", "methodId"]);

function inputKeysOf(inputs) {
  return (Array.isArray(inputs) ? inputs : []).map((i) => (typeof i === "string" ? i : i?.key)).filter(Boolean);
}

// A usable acting agent: exists, belongs to this household (or the shared "local" seed
// household), is visible to the requesting actor (personal agents stay creator-only) —
// and, the one piece selectAgent()'s own scoping does not check, is not archived.
function agentUsable(a, session) {
  if (!a) return false;
  if (a.status === "Archived") return false;
  const hh = session?.householdId ?? "local";
  if (!(a.householdId === hh || a.householdId === "local")) return false;
  return agentVisibleTo(a, session);
}

// Acting-agent resolution DELEGATES to the run path's own resolver
// (orchestrator.resolveActingAgent) so that preflight validates the agent that will
// actually execute the run. This matters: agents.mjs' selectAgent() falls back to
// `all.find(a => a.status === "Active") ?? all[0]` — ANY active agent — whereas the run
// path walks an explicit [agentId → skill.defaultAgentId → agt_household] chain and
// refuses rather than borrowing an unrelated helper's send allow-list. Validating with
// selectAgent would approve against agent X while the run executed as agent Y, which is
// the very "first active agent" guess ISS-103 exists to eliminate — reintroduced inside
// the validator meant to prevent it. One resolver, one answer.
//
// Two distinct failure kinds, per the contract: an EXPLICITLY named agent that doesn't
// resolve (or is archived) is "missing_agent"; falling through the chain and finding
// nothing usable is "no_acting_agent" (mirrors homeops.notify_contact's run-time code).
// DELIBERATE ASYMMETRY, explicit case: when the caller NAMES an agent, preflight resolves
// that exact agent and blocks if it isn't usable — it does NOT accept the run path's
// fallback. The run path falls through [named → skill default → agt_household] as
// defense-in-depth so a live run still executes; preflight is deliberately stricter,
// because activating an automation whose named agent doesn't exist is exactly the broken
// reference ISS-103 is about. Stricter-at-compile / self-healing-at-run is the intended
// relationship, not a contradiction.
function resolveActingAgent({ agentId, session }) {
  const explicit = !!(agentId && String(agentId).trim());
  const agent = explicit
    ? selectAgent({ agentId, session })            // exact lookup, no fallback
    : resolveRunActingAgent({ agentId: null, session }); // same chain the run will walk
  if (agentUsable(agent, session)) return { ok: true, agent };
  return {
    ok: false,
    error: explicit
      ? {
          node: "agent",
          kind: "missing_agent",
          message: `The agent "${agentId}" doesn't exist in this household, or has been archived — pick an active agent to run this automation.`,
          repairSurface: "/agents",
        }
      : {
          node: "agent",
          kind: "no_acting_agent",
          message: "No agent is set up to run this automation yet — create or activate an agent first.",
          repairSurface: "/agents",
        },
  };
}

// Resolve a step's tool id against every REAL registry — the same three sources
// planner.mjs' toolCatalog() draws from, but reaching the raw tool def (delivers /
// inputs) that toolCatalog's projection doesn't carry.
function findConnectorTool(toolId) {
  for (const c of CONNECTORS) {
    const t = (c.tools ?? []).find((x) => x.id === toolId);
    if (t) return { connector: c, tool: t };
  }
  return null;
}
function resolveRawTool(toolId) {
  const pf = findToolGlobal(toolId);
  if (pf) return { connectorId: pf.provider.id, connectorName: pf.provider.name, delivers: !!pf.tool.delivers, inputs: pf.tool.inputs };
  const cf = findConnectorTool(toolId);
  if (cf) return { connectorId: cf.connector.id, connectorName: cf.connector.name, delivers: !!cf.tool.delivers, inputs: cf.tool.inputs };
  const fn = getInternalFunction(toolId);
  if (fn) return { connectorId: fn.connectorId, connectorName: fn.connectorName, delivers: !!fn.delivers, inputs: INTERNAL_INPUTS[toolId] };
  return null;
}

function stepsOf(plan) {
  return plan && Array.isArray(plan.steps) ? plan.steps : [];
}
// Accepts either the RunnablePlan step shape (`toolId`) or the template WorkflowStep
// shape (`tool`) — the client hands this endpoint whichever it currently has in hand.
function stepToolId(step) {
  const t = step?.toolId ?? step?.tool ?? null;
  return t ? String(t) : null;
}
function stepLabel(step, fallback) {
  return String(step?.title ?? step?.label ?? fallback);
}
function stepInput(step) {
  return step && typeof step.input === "object" && step.input ? step.input : {};
}

// Every tool a step names must resolve to a real handler (missing_handler), and — when
// it does — the integration it belongs to must be connected for THIS actor
// (missing_integration), reusing toolCatalog(session)'s own real connectedness
// computation rather than re-deriving it. A `toolId`/`tool` of null/undefined is a
// reasoning step (no handler needed), same as the run engine treats it, and is skipped.
function validateSteps(plan, session, errors) {
  const catalog = toolCatalog(session);
  const byId = new Map(catalog.map((t) => [t.toolId, t]));
  stepsOf(plan).forEach((step, i) => {
    const toolId = stepToolId(step);
    if (!toolId) return;
    const raw = resolveRawTool(toolId);
    if (!raw) {
      errors.push({
        node: `step[${i}].tool`,
        kind: "missing_handler",
        message: `Step ${i + 1} ("${stepLabel(step, toolId)}") uses "${toolId}", which isn't a real tool in any registry — edit or remove this step.`,
        repairSurface: "/automations",
      });
      return;
    }
    const cat = byId.get(toolId);
    if (!cat || !cat.connected) {
      errors.push({
        node: `integration.${raw.connectorId}`,
        kind: "missing_integration",
        message: `Step ${i + 1} needs "${raw.connectorName}", which isn't connected yet — connect it before this automation can run.`,
        repairSurface: "/connections",
      });
    }
    if (raw.delivers === true) {
      const recipientKeys = inputKeysOf(raw.inputs).filter((k) => RECIPIENT_INPUT_KEYS.has(k));
      if (recipientKeys.length) {
        const input = stepInput(step);
        const provided = recipientKeys.some((k) => String(input[k] ?? "").trim() !== "");
        if (!provided) {
          errors.push({
            node: `step[${i}].recipient`,
            kind: "missing_recipient",
            message: `Step ${i + 1} ("${stepLabel(step, toolId)}") sends outside the household but has no recipient set — add one before this can run unattended.`,
            repairSurface: "/automations",
          });
        }
      }
    }
  });
}

// Every named multiAgentRole must resolve to a real, usable agent in this household —
// matched by id or by exact (case-insensitive) name, since a template may hand back
// either depending on how the user assigned the role in its picker.
function validateMultiAgentRoles(multiAgentRoles, session, errors) {
  if (!Array.isArray(multiAgentRoles) || multiAgentRoles.length === 0) return;
  const usable = listAgents((a) => agentUsable(a, session));
  multiAgentRoles.forEach((r, i) => {
    const wanted = String(r?.name ?? "").trim();
    const roleLabel = String(r?.role ?? "").trim() || `role ${i + 1}`;
    const match = wanted && usable.find((a) => a.id === wanted || a.name.toLowerCase() === wanted.toLowerCase());
    if (!match) {
      errors.push({
        node: `multiAgentRoles[${i}]`,
        kind: "unresolved_multi_agent_role",
        message: wanted
          ? `"${wanted}" assigned to the "${roleLabel}" role doesn't match any active agent in this household.`
          : `No agent is assigned to the "${roleLabel}" role yet.`,
        repairSurface: "/agents",
      });
    }
  });
}

// A stable hash of the validated graph — changes iff templateId/plan/agentId/roles
// change, so a client can cheaply tell "nothing changed since this was last compiled".
function compiledManifestVersion({ templateId, plan, agentId, multiAgentRoles }) {
  const canonical = JSON.stringify({
    templateId: templateId ?? null,
    plan: plan ?? null,
    agentId: agentId ?? null,
    multiAgentRoles: Array.isArray(multiAgentRoles) ? multiAgentRoles : [],
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * The compile step: validate a candidate automation (template + plan + agent/role
 * assignments) against the REAL registries. Read-only — never creates, modifies, or
 * deletes anything (see module comment).
 * @param {object} params
 * @param {string} [params.templateId]
 * @param {object} params.plan
 * @param {string} [params.agentId]
 * @param {Array<{name:string, role:string}>} [params.multiAgentRoles]
 * @param {object} params.session server session (householdId/actorId/role)
 * @returns {{ ok: boolean, lifecycleState: "ready"|"blocked_configuration", errors: Array, compiledManifestVersion: string }}
 */
export function preflightAutomation({ templateId, plan, agentId, multiAgentRoles, session } = {}) {
  const errors = [];
  const agentResult = resolveActingAgent({ agentId, session });
  if (!agentResult.ok) errors.push(agentResult.error);
  validateSteps(plan, session, errors);
  validateMultiAgentRoles(multiAgentRoles, session, errors);
  const ok = errors.length === 0;
  return {
    ok,
    lifecycleState: ok ? "ready" : "blocked_configuration",
    errors,
    compiledManifestVersion: compiledManifestVersion({ templateId, plan, agentId, multiAgentRoles }),
  };
}
