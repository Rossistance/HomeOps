// FamiliOS AI — server-side tool/function registry + REAL executable handlers.
// A "function" is a user-authored, durable, executable capability that wraps one of
// several handler kinds. Every handler does real work — no mock/dry-run success:
//   • connector_api   — wraps a real provider/connector tool (Gmail/Calendar/Drive/…)
//   • internal        — wraps a first-class internal function (memory/artifact/sign-off)
//   • custom_http      — SSRF-guarded HTTP call to an allowlisted host (secret stays server-side)
//   • ai_local         — Ollama / LM Studio health, model discovery, or chat over loopback
//   • browser          — drives the real browser-automation runtime (only if healthy)
//   • sandbox_script   — reserved; honestly unavailable until a sandbox runtime is wired
//   • workflow_composed — sequences other available functions
//
// HARD RULES enforced here:
//   - A function is executable in a run ONLY when its LIVE state is "available"
//     (server-computed; reached only after a real passing test + satisfied deps).
//   - requiresApproval is server-authoritative and never relaxes below the wrapped
//     tool's own requirement.
//   - Secrets (custom_http auth) live in the vault; the frontend only ever sees a
//     `hasSecret` boolean. Empty secret on update means "leave unchanged".
//   - custom_http targets are SSRF-guarded AND host-allowlisted per function.
import crypto from "node:crypto";
import {
  listFunctions, getFunction, putFunction, patchFunction, deleteFunctionRec,
  listFunctionVersions, addFunctionVersion,
  readJSON, writeJSON, appendAudit, getSettings,
  setConnectorConfig, getSecret, revokeConnector,
} from "./store.mjs";
import { findToolGlobal, PROVIDERS } from "./providers.mjs";
import { CONNECTORS, connectorById, readinessOf, executeTool } from "./connectors.mjs";
import { getInternalFunction } from "./internal-functions.mjs";
import { listAccountsFor } from "./accounts.mjs";
import { apiForAccount } from "./oauth.mjs";
import { aiProviderById, providerReadiness, providerHealth, providerModels, providerChat } from "./ai.mjs";
import { assertSafeUrl, safeFetch } from "./net.mjs";

/* ---- the 11 truthful, server-computed function states ---- */
export const FUNCTION_STATES = [
  "draft", "needs_schema", "needs_connector", "needs_secret", "needs_runtime",
  "untested", "testing", "test_failed", "available", "degraded", "deprecated",
];

const EXECUTABLE_READINESS = ["connected", "authorized_write", "authorized_readonly", "local_only"];
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

/* ----------------------------- secret vault ----------------------------- */
// custom_http auth value is stored encrypted under a synthetic connector id so it
// decrypts only inside this backend process and is never serialized to a response.
function setFunctionSecret(id, value) {
  if (value == null || value === "") return; // empty = leave unchanged
  setConnectorConfig(`fn:${id}`, {}, { authValue: value });
}
function getFunctionSecret(id) {
  return getSecret(`fn:${id}`, "authValue");
}
function clearFunctionSecret(id) {
  revokeConnector(`fn:${id}`);
}
export function functionHasSecret(id) {
  return !!getFunctionSecret(id);
}

/* --------------------------- tool resolution ---------------------------- */
// Resolve a wrapped tool id to its static manifest (provider | connector | internal).
function underlyingTool(toolId) {
  if (!toolId) return null;
  const p = findToolGlobal(toolId);
  if (p) return { kind: "provider", provider: p.provider, tool: p.tool, requiresApproval: !!p.tool.requiresApproval, action: p.tool.action, risk: p.tool.risk, connectorId: p.provider.id, connectorName: p.provider.name };
  const conn = CONNECTORS.find((c) => c.tools.some((t) => t.id === toolId));
  const tool = conn?.tools.find((t) => t.id === toolId);
  if (tool) return { kind: "connector", connector: conn, tool, requiresApproval: !!tool.requiresApproval, action: tool.action, risk: tool.risk, connectorId: conn.id, connectorName: conn.name };
  const internal = getInternalFunction(toolId);
  if (internal) return { kind: "internal", def: internal, requiresApproval: !!internal.requiresApproval, action: internal.action, risk: internal.risk, connectorId: internal.connectorId, connectorName: internal.connectorName };
  return null;
}

function isWriteMethod(m) {
  return WRITE_METHODS.includes(String(m ?? "GET").toUpperCase());
}

/* ---- server-authoritative approval / action / risk (never relaxes the wrapped tool) ---- */
export function functionRequiresApproval(fn) {
  if (fn?.approval_required) return true;
  switch (fn?.type) {
    case "connector_api":
    case "browser": {
      const u = underlyingTool(fn.config?.toolId);
      return !!u?.requiresApproval;
    }
    case "custom_http":
      return isWriteMethod(fn.config?.method);
    case "internal": {
      const u = underlyingTool(fn.config?.functionId);
      return !!u?.requiresApproval;
    }
    case "workflow_composed":
      return (fn.config?.steps ?? []).some((s) => { const sub = getFunction(s.functionId); return sub && functionRequiresApproval(sub); });
    default:
      return false;
  }
}
export function functionAction(fn) {
  if (fn?.type === "custom_http") return isWriteMethod(fn.config?.method) ? "Write" : "Read";
  const wrapped = fn?.type === "connector_api" || fn?.type === "browser" ? fn.config?.toolId : fn?.type === "internal" ? fn.config?.functionId : null;
  const u = wrapped ? underlyingTool(wrapped) : null;
  return u?.action ?? fn?.action ?? "Other";
}
export function functionRisk(fn) {
  const wrapped = fn?.type === "connector_api" || fn?.type === "browser" ? fn.config?.toolId : fn?.type === "internal" ? fn.config?.functionId : null;
  const u = wrapped ? underlyingTool(wrapped) : null;
  return u?.risk ?? fn?.risk ?? "Low";
}
function functionConnector(fn) {
  const wrapped = fn?.type === "connector_api" || fn?.type === "browser" ? fn.config?.toolId : fn?.type === "internal" ? fn.config?.functionId : null;
  const u = wrapped ? underlyingTool(wrapped) : null;
  if (u) return { connectorId: u.connectorId, connectorName: u.connectorName };
  if (fn?.type === "custom_http") { try { return { connectorId: "http", connectorName: new URL(fn.config.url).host }; } catch { return { connectorId: "http", connectorName: "Custom HTTP" }; } }
  if (fn?.type === "ai_local") return { connectorId: fn.config?.providerId ?? "ai_local", connectorName: aiProviderById(fn.config?.providerId)?.name ?? "Local AI" };
  return { connectorId: null, connectorName: null };
}

/* ------------------------------ validation ------------------------------ */
function schemaValid(fn) {
  const ok = (arr) => Array.isArray(arr) && arr.every((f) => f && typeof f.key === "string" && f.key.trim() && !/\s/.test(f.key));
  return ok(fn.input_schema ?? []) && ok(fn.output_schema ?? []);
}
function configComplete(fn) {
  switch (fn.type) {
    case "connector_api":
    case "browser": return !!fn.config?.toolId;
    case "internal": return !!fn.config?.functionId;
    case "custom_http": return !!fn.config?.url;
    case "ai_local": return !!fn.config?.providerId && !!fn.config?.op;
    case "workflow_composed": return Array.isArray(fn.config?.steps) && fn.config.steps.length > 0;
    case "sandbox_script": return false; // no runtime wired → never config-complete
    default: return false;
  }
}

// Synchronous dependency readiness for state display. Returns "ok" | a needs_* state.
// Live network reachability (SSRF resolution, provider reachability) is verified at
// test/exec time, not here — this is the honest "can it even be wired up" check.
function depReadiness(fn, ctx) {
  switch (fn.type) {
    case "connector_api":
    case "browser": {
      const u = underlyingTool(fn.config?.toolId);
      if (!u) return "needs_schema";
      if (fn.type === "browser") {
        const c = connectorById("browser");
        return c && readinessOf(c) === "connected" ? "ok" : "needs_runtime";
      }
      if (u.kind === "provider") {
        const accts = ctx ? listAccountsFor(ctx.householdId, ctx.actorId).filter((a) => a.provider === u.provider.id) : [];
        return accts.length ? "ok" : "needs_connector";
      }
      if (u.kind === "connector") {
        return EXECUTABLE_READINESS.includes(readinessOf(u.connector)) ? "ok" : "needs_connector";
      }
      return "ok"; // internal-backed
    }
    case "internal":
      return underlyingTool(fn.config?.functionId) ? "ok" : "needs_schema";
    case "custom_http": {
      let host;
      try { host = new URL(fn.config?.url).host; } catch { return "needs_schema"; }
      if (!host) return "needs_schema";
      if (fn.config?.secretHeaderName && !functionHasSecret(fn.id)) return "needs_secret";
      return "ok";
    }
    case "ai_local": {
      const p = aiProviderById(fn.config?.providerId);
      if (!p) return "needs_schema";
      return providerReadiness(p) === "not_configured" ? "needs_runtime" : "ok";
    }
    case "workflow_composed": {
      const steps = fn.config?.steps ?? [];
      if (!steps.length) return "needs_schema";
      for (const s of steps) { const sub = getFunction(s.functionId); if (!sub || sub.status === "deprecated") return "needs_schema"; }
      return "ok";
    }
    case "sandbox_script":
      return "needs_runtime";
    default:
      return "needs_schema";
  }
}

// The authoritative, live function state (one of FUNCTION_STATES). ctx scopes the
// connector check to the acting household/actor; pass null for an actor-agnostic view.
export function computeFunctionState(fn, ctx) {
  if (!fn) return { state: "needs_schema", reason: "Function not found." };
  if (fn.status === "deprecated") return { state: "deprecated", reason: "Retired by an admin." };
  if (fn._testing) return { state: "testing", reason: "A test run is in progress." };
  if (!schemaValid(fn)) return { state: "needs_schema", reason: "Input/output schema has invalid or blank keys." };
  if (!configComplete(fn)) {
    if (fn.type === "sandbox_script") return { state: "needs_runtime", reason: "No sandbox runtime is wired into this deployment." };
    return { state: "draft", reason: "Finish configuring the handler before testing." };
  }
  const dep = depReadiness(fn, ctx);
  if (dep !== "ok") {
    if (fn.lastTest?.ok) return { state: "degraded", reason: depReason(dep, fn) }; // passed before; a dependency regressed
    return { state: dep, reason: depReason(dep, fn) };
  }
  if (fn.lastTest?.ok) return { state: "available", reason: "Passed a real test; dependencies satisfied." };
  if (fn.lastTest && !fn.lastTest.ok) return { state: "test_failed", reason: fn.lastTest.error || "The last test failed." };
  return { state: "untested", reason: "Configured and ready — run a real test to make it available." };
}
function depReason(dep, fn) {
  switch (dep) {
    case "needs_connector": { const { connectorName } = functionConnector(fn); return `Connect ${connectorName ?? "the required service"} before this can run.`; }
    case "needs_secret": return "A required secret value has not been set.";
    case "needs_runtime": return fn.type === "sandbox_script" ? "No sandbox runtime is available." : fn.type === "browser" ? "The browser-automation runtime is not connected." : "The local AI provider is not configured.";
    case "needs_schema": return "Handler configuration is incomplete or references something that no longer exists.";
    default: return "";
  }
}

/* ------------------------------- versioning ----------------------------- */
function snapshotFunction(fn) {
  addFunctionVersion(fn.id, { ...stripRuntime(fn), snapshotAt: new Date().toISOString() });
  // cap at 20 snapshots
  const all = readJSON("function_versions.json", {});
  if ((all[fn.id]?.length ?? 0) > 20) { all[fn.id] = all[fn.id].slice(-20); writeJSON("function_versions.json", all); }
}
function stripRuntime(fn) {
  // never persist transient runtime flags into a snapshot
  const { _testing, ...rest } = fn;
  return rest;
}

/* --------------------------------- CRUD --------------------------------- */
export function createFunction(body, session) {
  const id = body.id?.trim() || "fn_" + crypto.randomBytes(10).toString("hex");
  const now = new Date().toISOString();
  const fn = {
    id,
    householdId: session?.householdId ?? "local",
    name: body.name ?? "Untitled function",
    description: body.description ?? "",
    type: FUNCTION_TYPES.includes(body.type) ? body.type : "connector_api",
    action: body.action ?? "Other",
    risk: body.risk ?? "Low",
    approval_required: !!body.approval_required,
    input_schema: body.input_schema ?? [],
    output_schema: body.output_schema ?? [],
    config: sanitizeConfig(body.type, body.config ?? {}),
    status: "draft",
    lastTest: null,
    system: false,
    version: 1,
    createdAt: Date.now(),
    updatedAt: now,
  };
  putFunction(fn);
  if (fn.type === "custom_http" && body.config?.secretValue) { setFunctionSecret(id, body.config.secretValue); if (fn.config.secretHeaderName) markHasSecret(id); }
  return getFunction(id);
}

export const FUNCTION_TYPES = ["connector_api", "internal", "custom_http", "ai_local", "browser", "sandbox_script", "workflow_composed"];

// Drop any client-supplied secret material from the stored config (vault only).
function sanitizeConfig(type, config) {
  const c = { ...(config ?? {}) };
  delete c.secretValue; // never persist the raw secret in the record
  if (type === "custom_http") {
    // record an allowlist of permitted hosts derived from the configured URL
    try { c.allowedHosts = [new URL(c.url).host]; } catch { /* validated later */ }
    c.method = String(c.method ?? "GET").toUpperCase();
    if (!WRITE_METHODS.includes(c.method) && c.method !== "GET") c.method = "GET";
  }
  return c;
}
function markHasSecret() { /* presence derived from vault; nothing to persist */ }

export function replaceFunction(id, body) {
  const existing = getFunction(id);
  if (!existing) return null;
  snapshotFunction(existing);
  const type = FUNCTION_TYPES.includes(body.type) ? body.type : existing.type;
  const next = {
    ...existing,
    ...body,
    id,
    householdId: existing.householdId,
    system: existing.system,
    type,
    config: sanitizeConfig(type, body.config ?? existing.config),
    version: (existing.version ?? 1) + 1,
    updatedAt: new Date().toISOString(),
  };
  // changing the definition invalidates a prior passing test
  next.lastTest = configFingerprint(existing) === configFingerprint(next) ? existing.lastTest : null;
  delete next._testing;
  putFunction(next);
  if (type === "custom_http" && body.config?.secretValue) setFunctionSecret(id, body.config.secretValue);
  return getFunction(id);
}

export function partialUpdateFunction(id, patch) {
  const existing = getFunction(id);
  if (!existing) return null;
  snapshotFunction(existing);
  const type = FUNCTION_TYPES.includes(patch.type) ? patch.type : existing.type;
  const next = {
    ...existing,
    ...patch,
    id,
    householdId: existing.householdId,
    system: existing.system,
    type,
    config: patch.config ? sanitizeConfig(type, { ...existing.config, ...patch.config }) : existing.config,
    version: (existing.version ?? 1) + 1,
    updatedAt: new Date().toISOString(),
  };
  next.lastTest = configFingerprint(existing) === configFingerprint(next) ? existing.lastTest : null;
  delete next._testing;
  putFunction(next);
  if (type === "custom_http" && patch.config?.secretValue) setFunctionSecret(id, patch.config.secretValue);
  return getFunction(id);
}

// A passing test is bound to the exact handler definition; any change clears it so
// "available" can never be claimed for a definition that was never actually tested.
function configFingerprint(fn) {
  return JSON.stringify({ type: fn.type, config: fn.config, input_schema: fn.input_schema, approval_required: fn.approval_required });
}

export function deleteFunction(id) {
  const existing = getFunction(id);
  if (!existing) return { error: "not_found" };
  if (existing.system) return { error: "system_function_protected" };
  snapshotFunction(existing);
  clearFunctionSecret(id);
  deleteFunctionRec(id);
  return { ok: true };
}

export function duplicateFunction(id, session) {
  const existing = getFunction(id);
  if (!existing) return null;
  const newId = "fn_" + crypto.randomBytes(10).toString("hex");
  const now = new Date().toISOString();
  const copy = {
    ...stripRuntime(existing),
    id: newId,
    name: `${existing.name} (copy)`,
    status: "draft",
    system: false,
    lastTest: null,
    version: 1,
    householdId: session?.householdId ?? existing.householdId,
    createdAt: Date.now(),
    updatedAt: now,
  };
  putFunction(copy);
  // secrets are intentionally NOT copied — the duplicate must set its own.
  return getFunction(newId);
}

// Promote to "available" — allowed ONLY when a real test has passed and deps are met.
export function promoteFunction(id, ctx) {
  const fn = getFunction(id);
  if (!fn) return { error: "not_found" };
  const { state } = computeFunctionState(fn, ctx);
  if (state !== "available") return { error: "not_available", state, message: "A function can only be promoted after a passing test with all dependencies satisfied." };
  snapshotFunction(fn);
  return patchFunction(id, { status: "available" });
}

export function deprecateFunction(id) {
  const fn = getFunction(id);
  if (!fn) return { error: "not_found" };
  if (fn.system) return { error: "system_function_protected" };
  snapshotFunction(fn);
  return patchFunction(id, { status: "deprecated" });
}

export function rollbackFunction(id, targetVersion) {
  const versions = listFunctionVersions(id);
  if (!versions.length) return { error: "no_versions" };
  const snap = targetVersion != null ? versions.find((v) => v.version === targetVersion) : versions[versions.length - 1];
  if (!snap) return { error: "version_not_found" };
  const existing = getFunction(id);
  if (!existing) return { error: "not_found" };
  if (existing.system) return { error: "system_function_protected" };
  snapshotFunction(existing);
  const { snapshotAt, _testing, ...rest } = snap;
  const restored = { ...rest, version: (existing.version ?? 1) + 1, updatedAt: new Date().toISOString() };
  // a restored definition is re-validated by a fresh test before it can be available
  if (configFingerprint(existing) !== configFingerprint(restored)) restored.lastTest = null;
  putFunction(restored);
  return getFunction(id);
}

/* ----------------------- engine-facing resolution ----------------------- */
// Synchronous resolver the durable executor calls. Returns a server-authoritative
// descriptor or null. The executor enforces the "available" gate via execFunction.
export function resolveRegisteredFunction(id) {
  const fn = getFunction(id);
  if (!fn) return null;
  const { connectorId, connectorName } = functionConnector(fn);
  return {
    kind: "function",
    fn,
    requiresApproval: functionRequiresApproval(fn),
    action: functionAction(fn),
    risk: functionRisk(fn),
    connectorId,
    connectorName,
  };
}

/* --------------------------- the real handlers -------------------------- */
function externalActionsEnabled(householdId) { return getSettings(householdId).externalActionsEnabled !== false; }
function mergeInput(fn, input) {
  return { ...(fn.config?.inputDefaults ?? {}), ...(input ?? {}) };
}

// Execute a function's handler for real. Used by BOTH the durable run executor
// (with the "available" gate) and the test endpoint (gate bypassed, deps still real).
// ctx: { householdId, actorId, runId }. opts: { approvalConsumed, isTest, confirm }.
export async function runFunctionHandler(fn, input = {}, ctx = {}, opts = {}) {
  const action = functionAction(fn);
  const sideEffecting = ["Write", "Send", "Download"].includes(action);
  if (sideEffecting && !externalActionsEnabled(ctx.householdId)) {
    return { ok: false, error: "external_actions_disabled", message: "External actions are paused by the household kill switch." };
  }
  // A side-effecting TEST must be explicitly confirmed (the test really performs it).
  if (opts.isTest && sideEffecting && !opts.confirm) {
    return { ok: false, error: "confirm_required", message: `This is a ${action.toLowerCase()} action — testing it performs the real effect. Re-run with confirmation to proceed.` };
  }
  const merged = mergeInput(fn, input);
  try {
    switch (fn.type) {
      case "internal": {
        const def = getInternalFunction(fn.config?.functionId);
        if (!def) return { ok: false, error: "unknown_internal", message: "Internal function not found." };
        if (def.requiresApproval && !opts.approvalConsumed && !opts.isTest) return { ok: false, error: "approval_required", message: `${def.name} needs approval.` };
        return await def.run({ householdId: ctx.householdId, actorId: ctx.actorId, runId: ctx.runId }, merged);
      }
      case "connector_api": {
        const u = underlyingTool(fn.config?.toolId);
        if (!u) return { ok: false, error: "unknown_tool", message: "Wrapped tool no longer exists." };
        if (u.requiresApproval && !opts.approvalConsumed && !opts.isTest) return { ok: false, error: "approval_required", message: `${u.tool?.name ?? "This action"} needs approval.` };
        if (u.kind === "internal") return await u.def.run({ householdId: ctx.householdId, actorId: ctx.actorId, runId: ctx.runId }, merged);
        if (u.kind === "provider") {
          const accounts = listAccountsFor(ctx.householdId, ctx.actorId).filter((a) => a.provider === u.provider.id);
          const account = ctx.accountId ? accounts.find((a) => a.id === ctx.accountId) : accounts[0];
          if (!account) return { ok: false, error: "not_connected", message: `Connect your ${u.provider.name} account to use this function.`, waiting: "connector" };
          try { const result = await u.tool.run(apiForAccount(account), merged); return { ok: true, result }; }
          catch (e) { return { ok: false, error: "provider_error", message: String(e?.message ?? e) }; }
        }
        // connector tool — executeTool re-checks readiness, approval, kill switch
        return await executeTool(u.tool.id, merged, { actorId: ctx.actorId, requestId: ctx.runId, approvalConsumed: !!opts.approvalConsumed || !!opts.isTest });
      }
      case "browser": {
        const u = underlyingTool(fn.config?.toolId);
        if (!u || u.kind !== "connector") return { ok: false, error: "unknown_tool", message: "Browser tool not found." };
        return await executeTool(u.tool.id, merged, { actorId: ctx.actorId, requestId: ctx.runId, approvalConsumed: !!opts.approvalConsumed || !!opts.isTest });
      }
      case "custom_http":
        return await runCustomHttp(fn, merged);
      case "ai_local":
        return await runAiLocal(fn, merged);
      case "workflow_composed":
        return await runComposed(fn, merged, ctx, opts);
      case "sandbox_script":
        return { ok: false, error: "runtime_unavailable", message: "No sandbox runtime is wired into this deployment, so this function cannot execute.", waiting: "connector" };
      default:
        return { ok: false, error: "unknown_type", message: `Unsupported function type: ${fn.type}` };
    }
  } catch (e) {
    return { ok: false, error: "handler_error", message: String(e?.message ?? e) };
  }
}

async function runCustomHttp(fn, input) {
  const cfg = fn.config ?? {};
  let url = cfg.url;
  if (input.path) { try { url = new URL(cfg.url).origin + (String(input.path).startsWith("/") ? "" : "/") + input.path; } catch { /* keep base */ } }
  // SSRF guard + per-function host allowlist (defends against input-driven host swap).
  const safe = await assertSafeUrl(url, { allowLoopback: false });
  if (!safe.ok) return { ok: false, error: "egress_blocked", message: `Target blocked by egress policy (${safe.error}).` };
  if (Array.isArray(cfg.allowedHosts) && cfg.allowedHosts.length && !cfg.allowedHosts.includes(safe.host)) {
    return { ok: false, error: "host_not_allowlisted", message: `Host ${safe.host} is not on this function's allowlist.` };
  }
  const headers = { ...(cfg.headers ?? {}) };
  if (cfg.secretHeaderName) {
    const secret = getFunctionSecret(fn.id);
    if (!secret) return { ok: false, error: "missing_secret", message: "This function needs its secret value set before it can run." };
    headers[cfg.secretHeaderName] = secret;
  }
  const method = String(cfg.method ?? "GET").toUpperCase();
  const body = isWriteMethod(method) ? JSON.stringify(input.body ?? cfg.body ?? {}) : undefined;
  if (body) headers["content-type"] = headers["content-type"] ?? "application/json";
  const r = await safeFetch(url, { method, headers, body }, { allowLoopback: false });
  if (!r.ok) return { ok: false, error: r.policyBlocked ? "egress_blocked" : "provider_error", message: `Request failed: ${r.error}` };
  return { ok: true, result: { url: r.finalUrl, status: r.status, ok: r.httpOk, bodyPreview: r.text.slice(0, 800) } };
}

async function runAiLocal(fn, input) {
  const { providerId, op } = fn.config ?? {};
  const p = aiProviderById(providerId);
  if (!p || !p.local) return { ok: false, error: "unknown_provider", message: "Local AI provider not found." };
  if (op === "health") { const h = await providerHealth(providerId); return h.ok ? { ok: true, result: h } : { ok: false, error: h.status ?? "unreachable", message: h.message ?? "Local AI provider is unreachable." }; }
  if (op === "models") { const m = await providerModels(providerId); return m.ok ? { ok: true, result: { models: m.models } } : { ok: false, error: m.error, message: m.message }; }
  if (op === "chat") {
    const messages = Array.isArray(input.messages) ? input.messages : [{ role: "user", content: String(input.prompt ?? "") }];
    if (!messages.length || !messages.some((m) => m.content)) return { ok: false, error: "empty_prompt", message: "Provide a prompt or messages." };
    const c = await providerChat(providerId, { messages, model: input.model });
    return c.ok ? { ok: true, result: { model: c.model, text: c.text } } : { ok: false, error: c.error, message: c.message };
  }
  return { ok: false, error: "unknown_op", message: `Unsupported local AI op: ${op}` };
}

async function runComposed(fn, input, ctx, opts) {
  const steps = fn.config?.steps ?? [];
  const outputs = [];
  let carry = { ...input };
  for (const [i, s] of steps.entries()) {
    const sub = getFunction(s.functionId);
    if (!sub) return { ok: false, error: "missing_sub_function", message: `Composed step ${i + 1} references a function that no longer exists.` };
    const subInput = { ...carry, ...(s.input_mapping ?? {}) };
    const out = await runFunctionHandler(sub, subInput, ctx, { approvalConsumed: !!opts.approvalConsumed || !!opts.isTest, isTest: opts.isTest, confirm: opts.confirm });
    if (!out.ok) return { ok: false, error: "composed_step_failed", message: `Step ${i + 1} (${sub.name}) failed: ${out.message ?? out.error}`, step: i, cause: out.error };
    outputs.push({ functionId: sub.id, result: out.result });
    if (out.result && typeof out.result === "object") carry = { ...carry, ...out.result };
  }
  return { ok: true, result: { steps: outputs.length, outputs } };
}

/* ------------------------------- testing -------------------------------- */
// Run a REAL test. On success the function records a passing test (→ "available").
export async function testFunction({ id, input, confirm, session }) {
  const fn = getFunction(id);
  if (!fn) return { error: "not_found" };
  const ctx = { householdId: session?.householdId ?? "local", actorId: session?.actorId ?? "system", runId: "test_" + crypto.randomBytes(6).toString("hex") };
  // Pre-flight on the static config so we fail with an honest, specific reason.
  if (!schemaValid(fn)) return { ok: false, error: "needs_schema", message: "Fix the input/output schema before testing." };
  if (!configComplete(fn)) return { ok: false, error: "incomplete_config", message: "Finish configuring the handler before testing." };
  const out = await runFunctionHandler(fn, input ?? testInput(fn), ctx, { isTest: true, confirm });
  const at = Date.now();
  if (out.ok) {
    patchFunction(id, { lastTest: { ok: true, at, summary: summarize(out.result), input: input ?? null } });
    appendAudit({ type: "function.test", functionId: id, ok: true, action: functionAction(fn), householdId: ctx.householdId, actorId: ctx.actorId });
  } else if (out.error === "confirm_required") {
    // not a failure of the function — surface to the UI without recording a test result
    return { ok: false, error: out.error, message: out.message, needsConfirm: true };
  } else {
    patchFunction(id, { lastTest: { ok: false, at, error: out.message ?? out.error } });
    appendAudit({ type: "function.test", functionId: id, ok: false, error: out.error, householdId: ctx.householdId, actorId: ctx.actorId });
  }
  const updated = getFunction(id);
  return { ok: out.ok, result: out.ok ? out.result : undefined, error: out.ok ? undefined : out.error, message: out.message, function: publicFunction(updated, session) };
}

function testInput(fn) {
  // Build a sensible default input from the declared schema (defaults + required keys).
  const out = {};
  for (const f of fn.input_schema ?? []) { if (f.default != null && f.default !== "") out[f.key] = f.default; }
  return out;
}
function summarize(result) {
  if (result == null) return "ok";
  const s = typeof result === "string" ? result : JSON.stringify(result);
  return s.slice(0, 200);
}

/* ----------------------------- public view ------------------------------ */
// Redacted, state-annotated view for authenticated same-household clients. Secrets
// are NEVER included — only a `hasSecret` boolean.
export function publicFunction(fn, session) {
  if (!fn) return null;
  const ctx = session ? { householdId: session.householdId, actorId: session.actorId } : null;
  const { state, reason } = computeFunctionState(fn, ctx);
  const { connectorId, connectorName } = functionConnector(fn);
  const { _testing, config, ...rest } = fn;
  const safeConfig = { ...config };
  delete safeConfig.secretValue;
  return {
    ...rest,
    config: safeConfig,
    state,
    stateReason: reason,
    requiresApproval: functionRequiresApproval(fn),
    effectiveAction: functionAction(fn),
    effectiveRisk: functionRisk(fn),
    connectorId,
    connectorName,
    hasSecret: fn.type === "custom_http" ? functionHasSecret(fn.id) : false,
    executable: state === "available",
  };
}

export function listPublicFunctions(session, { type, state } = {}) {
  const hh = session?.householdId ?? "local";
  return listFunctions((f) => f.householdId === hh || f.householdId === "local")
    .map((f) => publicFunction(f, session))
    .filter((f) => (!type || f.type === type) && (!state || f.state === state))
    .sort((a, b) => (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? 1 : -1);
}

/* ---- Draft a function definition from a capability description (item 13) ----
 * When the planner / "infer capabilities" finds a missing tool, this drafts a candidate
 * function definition (shape only — never created live) for the human to review + save
 * in the Function Builder. A DRAFTING AID in front of the existing human-review gate:
 * nothing executes, no secrets, no auto-save. Falls back to a sensible skeleton if no
 * AI provider is configured so the builder still opens pre-filled rather than blank. */
export async function draftFunction({ description, session, providerId }) {
  const desc = String(description ?? "").trim();
  if (!desc) return { ok: false, error: "description_required" };
  // Skeleton used both as the no-provider fallback and as the shape the model fills.
  const skeleton = {
    name: desc.slice(0, 48), description: desc, type: "custom_http", action: "Read",
    risk: "Medium", approval_required: false,
    input_schema: [{ key: "query", label: "Query", type: "text", required: false }],
    output_schema: [{ key: "result", label: "Result", type: "text" }],
  };
  const pid = providerId || getSettings(session?.householdId).aiActiveProvider;
  if (!pid) return { ok: true, draft: skeleton, fallback: true, message: "Drafted a skeleton (no AI provider configured). Refine it in the Function Builder." };
  const prompt = `You design FamiliOS "functions" — durable, executable capabilities. Draft ONE function definition for this capability. Never invent secrets or endpoints you're unsure of; a human will review and complete it.
Capability needed: "${desc}"

type MUST be one of: connector_api, internal, custom_http, ai_local, browser, sandbox_script, workflow_composed.
action MUST be one of: Read, Write, Send, Other. Set approval_required true for anything that writes/sends externally, and set risk accordingly (Low/Medium/High/Sensitive).

Return ONLY JSON (no fences):
{"name": string, "description": string, "type": string, "action": "Read"|"Write"|"Send"|"Other", "risk": "Low"|"Medium"|"High"|"Sensitive", "approval_required": boolean, "input_schema": [{"key": string, "label": string, "type": "text"|"number"|"boolean", "required": boolean}], "output_schema": [{"key": string, "label": string, "type": string}]}`;
  const out = await providerChat(pid, { messages: [{ role: "user", content: prompt }] });
  if (!out.ok) return { ok: true, draft: skeleton, fallback: true, message: "Couldn't reach the AI — drafted a skeleton to refine." };
  try {
    const text = String(out.text ?? "");
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const raw = fence ? fence[1] : text;
    const first = raw.indexOf("{"), last = raw.lastIndexOf("}");
    const p = JSON.parse(raw.slice(first, last + 1));
    const TYPES = FUNCTION_TYPES;
    const ACTIONS = ["Read", "Write", "Send", "Other"];
    const RISKS = ["Low", "Medium", "High", "Sensitive"];
    const arr = (a, keys) => Array.isArray(a) ? a.filter((x) => x && x.key).map((x) => keys(x)) : [];
    const draft = {
      name: String(p.name ?? skeleton.name).slice(0, 80),
      description: String(p.description ?? desc).slice(0, 400),
      type: TYPES.includes(p.type) ? p.type : "custom_http",
      action: ACTIONS.includes(p.action) ? p.action : "Read",
      risk: RISKS.includes(p.risk) ? p.risk : "Medium",
      approval_required: !!p.approval_required,
      input_schema: arr(p.input_schema, (x) => ({ key: String(x.key).slice(0, 40), label: String(x.label ?? x.key).slice(0, 60), type: ["text", "number", "boolean"].includes(x.type) ? x.type : "text", required: !!x.required })),
      output_schema: arr(p.output_schema, (x) => ({ key: String(x.key).slice(0, 40), label: String(x.label ?? x.key).slice(0, 60), type: String(x.type ?? "text").slice(0, 20) })),
    };
    return { ok: true, draft, model: out.model };
  } catch {
    return { ok: true, draft: skeleton, fallback: true, message: "AI returned an unparseable draft — using a skeleton to refine." };
  }
}
