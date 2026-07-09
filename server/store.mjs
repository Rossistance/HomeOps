// FamiliOS AI — backend persistence + secrets vault (local development boundary).
// Real, file-backed storage with AES-256-GCM encryption for secret config values.
// Secrets are only ever decrypted inside this backend process and are redacted in
// every API response. No secrets are stored in the frontend or browser.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Data dir is overridable (HOMEOPS_DATA_DIR) so the test harness can point at an
// isolated temp directory and never touch the real server/.data store.
const DATA_DIR = process.env.HOMEOPS_DATA_DIR
  ? process.env.HOMEOPS_DATA_DIR
  : join(__dirname, ".data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const KEY_FILE = join(DATA_DIR, "key");
function loadKey() {
  const envKey = process.env.HOMEOPS_SECRET_KEY;
  if (envKey && envKey.length >= 32) return crypto.createHash("sha256").update(envKey).digest();
  if (fs.existsSync(KEY_FILE)) return Buffer.from(fs.readFileSync(KEY_FILE, "utf8"), "hex");
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString("hex"), { mode: 0o600 });
  return key;
}
const KEY = loadKey();

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}
export function decrypt(blob) {
  try {
    const [iv, tag, ct] = blob.split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function readJSON(file, fallback) {
  const p = join(DATA_DIR, file);
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}
// Atomic write: write to a temp file then rename (atomic on the same volume), so a
// crash mid-write can never leave a half-written / corrupt JSON file behind.
function writeJSON(file, value) {
  const p = join(DATA_DIR, file);
  const tmp = `${p}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, p);
}
// Exported for the run engine and the agent/skill/function registries, which build
// their own accessors on top of the same file-backed, atomic-write substrate.
export { readJSON, writeJSON };

/* ---- In-process async mutex (serializes read-modify-write on one entity) ----
   Single-process Node: a per-key promise chain is sufficient to prevent the
   last-writer-wins races that whole-file JSON writes would otherwise have. */
const _locks = new Map();
export function withLock(key, fn) {
  const prev = _locks.get(key) ?? Promise.resolve();
  // Run fn after the previous holder settles (success OR failure), so one rejection
  // never deadlocks the chain.
  const run = prev.then(() => fn(), () => fn());
  _locks.set(key, run.then(() => {}, () => {}));
  return run;
}
// All mutations of a single run funnel through this so steps/cursor stay consistent.
export function withRunLock(runId, fn) {
  return withLock(`run:${runId}`, fn);
}

/* ---- Idempotency (at-most-once side effects, durable across restart) ---- */
export function idempotencyKey(...parts) {
  return crypto.createHash("sha256").update(parts.map(String).join("|")).digest("hex").slice(0, 24);
}
export function checkIdempotency(key) {
  return readJSON("idempotency.json", {})[key] ?? null;
}
export function recordIdempotency(key, value) {
  const all = readJSON("idempotency.json", {});
  all[key] = { at: Date.now(), ...value };
  writeJSON("idempotency.json", all);
  return all[key];
}

/* ---- Connector configuration (non-secret fields kept plain; secret fields encrypted) ---- */
// shape: { [connectorId]: { fields: {plainField: value}, secrets: {secretField: encBlob}, updatedAt } }
export function getConfig() {
  return readJSON("connectors.json", {});
}
export function getConnectorConfig(id) {
  return getConfig()[id] ?? { fields: {}, secrets: {}, updatedAt: null };
}
export function setConnectorConfig(id, fields, secrets) {
  const all = getConfig();
  const existing = all[id] ?? { fields: {}, secrets: {}, updatedAt: null };
  const nextSecrets = { ...existing.secrets };
  for (const [k, v] of Object.entries(secrets ?? {})) {
    if (v === "" || v == null) continue; // empty means "leave unchanged"
    nextSecrets[k] = encrypt(v);
  }
  all[id] = { fields: { ...existing.fields, ...(fields ?? {}) }, secrets: nextSecrets, updatedAt: new Date().toISOString() };
  writeJSON("connectors.json", all);
  return all[id];
}
export function revokeConnector(id) {
  const all = getConfig();
  delete all[id];
  writeJSON("connectors.json", all);
}
export function getSecret(id, field) {
  const cfg = getConnectorConfig(id);
  const blob = cfg.secrets?.[field];
  return blob ? decrypt(blob) : null;
}

/* ---- Audit log (append-only, redacted) ---- */
export function appendAudit(event) {
  const line = JSON.stringify({ id: crypto.randomUUID(), at: new Date().toISOString(), ...event });
  fs.appendFileSync(join(DATA_DIR, "audit.jsonl"), line + "\n");
}
export function readAudit(limit = 100) {
  const p = join(DATA_DIR, "audit.jsonl");
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/* ---- Webhook events (real receiver storage) ---- */
export function getWebhookEvents(id) {
  return readJSON("webhooks.json", {})[id] ?? [];
}
export function addWebhookEvent(id, event) {
  const all = readJSON("webhooks.json", {});
  all[id] = [{ id: crypto.randomUUID(), receivedAt: new Date().toISOString(), ...event }, ...(all[id] ?? [])].slice(0, 100);
  writeJSON("webhooks.json", all);
  return all[id][0];
}

/* ---- Settings (kill switch for all external write actions) ---- */
export function getSettings() {
  return readJSON("settings.json", { externalActionsEnabled: true });
}
export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJSON("settings.json", next);
  return next;
}

/* ---- Canonical input hashing (stable, key-sorted) for approval binding ---- */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, k) => { acc[k] = canonicalize(value[k]); return acc; }, {});
  }
  return value;
}
export function hashInput(input) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(input ?? {}))).digest("hex");
}

/* ---- Sessions (httpOnly cookie token + CSRF double-submit token) ---- */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
export function createSession({ actorId, actorName, role, householdId }) {
  const all = readJSON("sessions.json", {});
  const token = crypto.randomBytes(32).toString("hex");
  const csrf = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  all[token] = { token, csrf, actorId, actorName, role, householdId: householdId ?? "local", createdAt: now, expiresAt: now + SESSION_TTL_MS };
  writeJSON("sessions.json", all);
  return all[token];
}
export function getSession(token) {
  if (!token) return null;
  const all = readJSON("sessions.json", {});
  const s = all[token];
  if (!s) return null;
  if (s.expiresAt < Date.now()) { delete all[token]; writeJSON("sessions.json", all); return null; }
  return s;
}
export function deleteSession(token) {
  const all = readJSON("sessions.json", {});
  if (all[token]) { delete all[token]; writeJSON("sessions.json", all); return true; }
  return false;
}

/* ---- Household members (server-owned role source of truth) ----
 * Authority is NEVER taken from the client. A session's effective role is resolved
 * from this registry by actorId. members.json is seeded on boot (seed.mjs) and is
 * the only place a member's role may be changed (by an authorized server path). */
export function listMembers({ householdId } = {}) {
  const all = Object.values(readJSON("members.json", {}));
  return householdId ? all.filter((m) => m.householdId === householdId) : all;
}
export function getMember(actorId) {
  if (!actorId) return null;
  return readJSON("members.json", {})[actorId] ?? null;
}
// Adult roles may observe the household's operational data (runs, traces, etc.).
// Low-trust roles (Limited Member, Child View, Guest/Helper) are scoped to their own.
export function isAdultRole(role) {
  return role === "Owner" || role === "Adult Admin" || role === "Adult Member";
}
// Object-level visibility for family data (events/tasks). The owner and any
// participant/assignee always see it; otherwise the entity's `visibility` scope decides:
//   household    → everyone in the household (shared family calendar, the default)
//   childVisible → everyone (explicitly surfaced to kids)
//   adults       → adult roles only (bills, medical, sensitive coordination)
//   private      → owner + participants only
export function canSeeEntity(entity, { role, actorId } = {}) {
  if (!entity) return false;
  const isOwner = entity.ownerId === actorId || entity.createdBy === actorId;
  const members = entity.participantIds ?? entity.memberIds ?? [];
  const isParticipant = (Array.isArray(members) && members.includes(actorId)) || entity.assignedMemberId === actorId;
  if (isOwner || isParticipant) return true;
  const vis = entity.visibility ?? "household";
  if (vis === "private") return false;
  if (vis === "adults") return isAdultRole(role);
  return true; // household | childVisible
}
export function putMember(member) {
  const all = readJSON("members.json", {});
  const now = new Date().toISOString();
  const existing = all[member.actorId];
  all[member.actorId] = {
    householdId: "local",
    createdAt: existing?.createdAt ?? now,
    ...existing,
    ...member,
    updatedAt: now,
  };
  writeJSON("members.json", all);
  return all[member.actorId];
}

/* ---- Server-side approval records (bound to actor/tool/input; consume-once) ----
 * Approvals carry an explicit authority policy. Who may APPROVE is resolved by the
 * tool's risk (children/guests can never approve external actions) plus any explicit
 * allowed-approver ids. The policy is enforced at decide time and re-verified, fail-
 * closed, at consume time. Sample (demo) approvals are never executable. */
const APPROVAL_TTL_MS = 30 * 60 * 1000; // 30 min
const APPROVER_DEFAULTS = {
  Sensitive: ["Owner", "Adult Admin"],
  High: ["Owner", "Adult Admin"],
  Medium: ["Owner", "Adult Admin", "Adult Member"],
  Low: ["Owner", "Adult Admin", "Adult Member", "Limited Member"],
};
export function defaultApproverRoles(risk) {
  return APPROVER_DEFAULTS[risk] ?? ["Owner", "Adult Admin"];
}
export function createApproval({ actorId, householdId, connectorId, toolId, input, risk, category, preview, allowedApproverRoles, allowedApproverIds, source }) {
  const all = readJSON("approvals.json", {});
  const id = "apr_" + crypto.randomBytes(12).toString("hex");
  const now = Date.now();
  const toolRisk = risk ?? "High";
  all[id] = {
    id, actorId, requestedBy: actorId, householdId: householdId ?? "local", connectorId, toolId,
    inputHash: hashInput(input), risk: toolRisk, toolRisk, category: category ?? "Message",
    preview: preview ?? "", status: "pending", source: source ?? "executable",
    allowedApproverRoles: allowedApproverRoles ?? defaultApproverRoles(toolRisk),
    allowedApproverIds: allowedApproverIds ?? [],
    createdAt: now, expiresAt: now + APPROVAL_TTL_MS, decidedBy: null, decidedAt: null, consumedBy: null, consumedAt: null,
  };
  writeJSON("approvals.json", all);
  return all[id];
}
export function getApproval(id) {
  return readJSON("approvals.json", {})[id] ?? null;
}
// True if a member with `role`/`actorId` is permitted to approve this approval.
export function canApprove(a, { role, actorId } = {}) {
  if (!a) return false;
  const roleOk = Array.isArray(a.allowedApproverRoles) && a.allowedApproverRoles.includes(role);
  const idOk = Array.isArray(a.allowedApproverIds) && a.allowedApproverIds.includes(actorId);
  return roleOk || idOk;
}
export function decideApproval(id, { decision, actorId, actorRole }) {
  const all = readJSON("approvals.json", {});
  const a = all[id];
  if (!a) return { error: "not_found" };
  if (a.status !== "pending") return { error: "not_pending", approval: a };
  if (a.expiresAt < Date.now()) { a.status = "expired"; writeJSON("approvals.json", all); return { error: "expired", approval: a }; }
  // Authority gate: only an allowed approver (by role or explicit id) may decide.
  if (!canApprove(a, { role: actorRole, actorId })) return { error: "approver_not_allowed", approval: a };
  a.status = decision === "approve" ? "approved" : "denied";
  a.decidedBy = actorId; a.decidedAt = Date.now();
  writeJSON("approvals.json", all);
  return { approval: a };
}
// List approval records, newest first, scoped to a household (for mobile/web clients).
export function listApprovals({ householdId } = {}) {
  const all = Object.values(readJSON("approvals.json", {}));
  const scoped = householdId ? all.filter((a) => a.householdId === householdId) : all;
  return scoped.sort((a, b) => b.createdAt - a.createdAt);
}
// Atomically validate + consume an approval for execution. Returns {ok} or {error}.
// Fails CLOSED: a sample/demo approval, a missing authority policy, or a decider who
// is not (still) an allowed approver all block execution — defense in depth behind the
// decide-time gate, so a bad/legacy approval can never reach a real tool call.
export function consumeApproval({ id, actorId, householdId, toolId, input }) {
  const all = readJSON("approvals.json", {});
  const a = all[id];
  if (!a) return { error: "approval_not_found" };
  if (a.toolId !== toolId) return { error: "approval_tool_mismatch" };
  if (a.householdId !== (householdId ?? "local")) return { error: "approval_scope_mismatch" };
  if (a.status === "consumed") return { error: "approval_already_used" };
  if (a.status !== "approved") return { error: "approval_not_approved" };
  if (a.expiresAt < Date.now()) { a.status = "expired"; writeJSON("approvals.json", all); return { error: "approval_expired" }; }
  if (a.inputHash !== hashInput(input)) return { error: "approval_input_changed" };
  if (a.source === "sample") return { error: "approval_not_executable" };
  if (!Array.isArray(a.allowedApproverRoles) || a.allowedApproverRoles.length === 0) return { error: "approval_policy_missing" };
  // Re-verify the decider is STILL an authorized approver (role may have changed).
  const decider = getMember(a.decidedBy);
  if (!canApprove(a, { role: decider?.role, actorId: a.decidedBy })) return { error: "approver_not_allowed" };
  a.status = "consumed"; a.consumedAt = Date.now(); a.consumedBy = actorId;
  writeJSON("approvals.json", all);
  return { ok: true, approval: a };
}

/* ---- OAuth state (server-persisted, bound to session + connector + PKCE verifier) ---- */
const OAUTH_TTL_MS = 10 * 60 * 1000;
export function putOAuthState(state, data) {
  const all = readJSON("oauth_states.json", {});
  all[state] = { ...data, createdAt: Date.now(), expiresAt: Date.now() + OAUTH_TTL_MS };
  writeJSON("oauth_states.json", all);
}
export function takeOAuthState(state) {
  const all = readJSON("oauth_states.json", {});
  const s = all[state];
  if (s) { delete all[state]; writeJSON("oauth_states.json", all); }
  if (!s || s.expiresAt < Date.now()) return null;
  return s;
}

/* ---- Connector health (configured readiness is separate from live health) ---- */
export function setHealth(id, health) {
  const all = readJSON("health.json", {});
  all[id] = { ...health, at: new Date().toISOString() };
  writeJSON("health.json", all);
  return all[id];
}
export function getHealth(id) {
  return readJSON("health.json", {})[id] ?? null;
}

/* ---- Job run state (real scheduler) ---- */
export function getJobState(id) {
  return readJSON("jobs.json", {})[id] ?? null;
}
export function setJobState(id, patch) {
  const all = readJSON("jobs.json", {});
  all[id] = { ...(all[id] ?? {}), ...patch };
  writeJSON("jobs.json", all);
  return all[id];
}

/* ---- Connected accounts (per household + per user/actor) ---- */
// Account metadata is non-secret; tokens are stored encrypted in the vault under
// the synthetic id `acct:<id>` so they decrypt only inside this backend process.
export function listAccountsRaw() {
  return readJSON("accounts.json", []);
}
export function putAccount(acct) {
  const all = listAccountsRaw();
  const i = all.findIndex((a) => a.id === acct.id);
  if (i >= 0) all[i] = acct; else all.push(acct);
  writeJSON("accounts.json", all);
  return acct;
}
export function getAccountRaw(id) {
  return listAccountsRaw().find((a) => a.id === id) ?? null;
}
export function deleteAccountRaw(id) {
  writeJSON("accounts.json", listAccountsRaw().filter((a) => a.id !== id));
}
export function setAccountTokens(id, tokens) {
  setConnectorConfig(`acct:${id}`, {}, { tokens: JSON.stringify(tokens) });
}
export function getAccountTokens(id) {
  const s = getSecret(`acct:${id}`, "tokens");
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}
export function clearAccountTokens(id) {
  revokeConnector(`acct:${id}`);
}

/* ---- Webhook replay protection (nonce window) ---- */
export function seenWebhookNonce(nonce) {
  if (!nonce) return false;
  const all = readJSON("webhook_nonces.json", {});
  const now = Date.now();
  // prune old
  for (const k of Object.keys(all)) if (all[k] < now - 10 * 60 * 1000) delete all[k];
  if (all[nonce]) { writeJSON("webhook_nonces.json", all); return true; }
  all[nonce] = now; writeJSON("webhook_nonces.json", all);
  return false;
}

/* ---- Expo push tokens (registered by native clients on login) ---- */
export function getPushTokens() {
  return readJSON("push-tokens.json", []);
}
export function addPushToken(token) {
  if (!token || typeof token !== "string") return;
  const tokens = getPushTokens();
  if (!tokens.includes(token)) writeJSON("push-tokens.json", [...tokens, token]);
}
export function removePushToken(token) {
  writeJSON("push-tokens.json", getPushTokens().filter((t) => t !== token));
}

/* =======================================================================
   Server-side engine substrate (Slice 0) — durable, file-backed entities.
   The server is the source of truth for agents, skills, functions, runs,
   run steps, memory, artifacts, routing decisions, and evolution records.
   ======================================================================= */

// Generic keyed-object collection helper (mirrors the connectors.json shape).
function keyedCollection(file) {
  return {
    all: () => readJSON(file, {}),
    get: (id) => readJSON(file, {})[id] ?? null,
    put: (obj) => {
      const all = readJSON(file, {});
      all[obj.id] = obj;
      writeJSON(file, all);
      return obj;
    },
    patch: (id, patch) => {
      const all = readJSON(file, {});
      if (!all[id]) return null;
      all[id] = { ...all[id], ...patch, updatedAt: new Date().toISOString() };
      writeJSON(file, all);
      return all[id];
    },
    remove: (id) => {
      const all = readJSON(file, {});
      const had = !!all[id];
      delete all[id];
      writeJSON(file, all);
      return had;
    },
    list: (filter) => {
      const arr = Object.values(readJSON(file, {}));
      return filter ? arr.filter(filter) : arr;
    },
  };
}

/* ---- Runs + embedded run steps + tool calls (the durable execution trace) ----
   shape: { id, householdId, actorId, source, sourceRef, title, summary, status,
            params, plan, cursor, steps:[{ index, toolId|functionId, title, input,
            requiresApproval, risk, status, approvalId, idempotencyKey, attempts,
            toolCalls:[], startedAt, finishedAt }], error, lease, timestamps } */
export function createRun(run) {
  const all = readJSON("runs.json", {});
  all[run.id] = run;
  writeJSON("runs.json", all);
  return run;
}
export function getRun(id) {
  return readJSON("runs.json", {})[id] ?? null;
}
export function patchRun(id, patch) {
  const all = readJSON("runs.json", {});
  if (!all[id]) return null;
  all[id] = { ...all[id], ...patch, updatedAt: new Date().toISOString() };
  writeJSON("runs.json", all);
  return all[id];
}
export function patchRunStep(id, index, patch) {
  const all = readJSON("runs.json", {});
  const r = all[id];
  if (!r || !r.steps?.[index]) return null;
  r.steps[index] = { ...r.steps[index], ...patch, updatedAt: new Date().toISOString() };
  r.updatedAt = new Date().toISOString();
  writeJSON("runs.json", all);
  return r;
}
export function appendToolCall(id, index, call) {
  const all = readJSON("runs.json", {});
  const r = all[id];
  if (!r || !r.steps?.[index]) return null;
  (r.steps[index].toolCalls ??= []).push({ at: new Date().toISOString(), ...call });
  r.updatedAt = new Date().toISOString();
  writeJSON("runs.json", all);
  return r;
}
export function listRuns({ householdId, status, source, agentId, skillId, functionId, limit = 100 } = {}) {
  let arr = Object.values(readJSON("runs.json", {}));
  if (householdId) arr = arr.filter((r) => r.householdId === householdId);
  if (status) arr = arr.filter((r) => r.status === status);
  if (source) arr = arr.filter((r) => r.source === source);
  if (agentId) arr = arr.filter((r) => r.sourceRef?.agentId === agentId);
  if (skillId) arr = arr.filter((r) => r.sourceRef?.skillId === skillId);
  if (functionId) arr = arr.filter((r) => r.steps?.some((s) => s.functionId === functionId));
  arr.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return arr.slice(0, limit);
}
export function deleteRun(id) {
  const all = readJSON("runs.json", {});
  const had = !!all[id];
  delete all[id];
  writeJSON("runs.json", all);
  return had;
}

/* ---- Agents (server-side registry) ---- */
const _agents = keyedCollection("agents.json");
export const listAgents = (filter) => _agents.list(filter);
export const getAgent = (id) => _agents.get(id);
export const putAgent = (a) => _agents.put(a);
export const patchAgent = (id, patch) => _agents.patch(id, patch);
export const deleteAgentRec = (id) => _agents.remove(id);

/* ---- Skills (server-side hybrid registry) ---- */
const _skills = keyedCollection("skills.json");
export const listSkills = (filter) => _skills.list(filter);
export const getSkill = (id) => _skills.get(id);
export const putSkill = (s) => _skills.put(s);
export const patchSkill = (id, patch) => _skills.patch(id, patch);
export const deleteSkillRec = (id) => _skills.remove(id);

/* ---- Triggers (server-side: schedule / recurring / webhook / connector_event / manual) ---- */
const _triggers = keyedCollection("triggers.json");
export const listTriggers = (filter) => _triggers.list(filter);
export const getTrigger = (id) => _triggers.get(id);
export const putTrigger = (t) => _triggers.put(t);
export const patchTrigger = (id, patch) => _triggers.patch(id, patch);
export const deleteTriggerRec = (id) => _triggers.remove(id);

/* ---- Functions (definitions + append-only versions) ---- */
const _functions = keyedCollection("function_definitions.json");
export const listFunctions = (filter) => _functions.list(filter);
export const getFunction = (id) => _functions.get(id);
export const putFunction = (f) => _functions.put(f);
export const patchFunction = (id, patch) => _functions.patch(id, patch);
export const deleteFunctionRec = (id) => _functions.remove(id);
export function listFunctionVersions(fnId) {
  return readJSON("function_versions.json", {})[fnId] ?? [];
}
export function getFunctionVersion(fnId, version) {
  return (readJSON("function_versions.json", {})[fnId] ?? []).find((v) => v.version === version) ?? null;
}
export function addFunctionVersion(fnId, version) {
  const all = readJSON("function_versions.json", {});
  all[fnId] = [...(all[fnId] ?? []), version];
  writeJSON("function_versions.json", all);
  return version;
}

/* ---- Memory entries (household/personal knowledge written by runs) ---- */
export function listMemory({ householdId, scope, type, limit = 200 } = {}) {
  let arr = readJSON("memory.json", []);
  if (householdId) arr = arr.filter((m) => m.householdId === householdId);
  if (scope) arr = arr.filter((m) => m.scope === scope);
  if (type) arr = arr.filter((m) => m.type === type);
  arr.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return arr.slice(0, limit);
}
export function getMemoryEntry(id) {
  return readJSON("memory.json", []).find((m) => m.id === id) ?? null;
}
export function addMemory(entry) {
  const all = readJSON("memory.json", []);
  const rec = { id: "mem_" + crypto.randomBytes(8).toString("hex"), createdAt: Date.now(), ...entry };
  all.push(rec);
  writeJSON("memory.json", all);
  return rec;
}
// Archiving/deleting a memory entry only removes it as a future reference — it's a
// standing record of something already learned, not a live dependency any in-flight
// agent/skill/tool/function behavior holds a pointer to. Deleting one can never break
// prior evolution: whatever was already baked into an accepted skill/agent version
// stays baked in regardless of whether the memory entry that originally informed it
// still exists.
export function deleteMemoryEntry(id) {
  const all = readJSON("memory.json", []);
  const had = all.some((m) => m.id === id);
  if (!had) return false;
  writeJSON("memory.json", all.filter((m) => m.id !== id));
  return true;
}

/* ---- Artifacts (reports/briefings/checklists produced by runs) ---- */
export function listArtifacts({ householdId, runId, limit = 100 } = {}) {
  let arr = readJSON("artifacts.json", []);
  if (householdId) arr = arr.filter((a) => a.householdId === householdId);
  if (runId) arr = arr.filter((a) => a.runId === runId);
  arr.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return arr.slice(0, limit);
}
export function getArtifact(id) {
  return readJSON("artifacts.json", []).find((a) => a.id === id) ?? null;
}
export function addArtifact(artifact) {
  const all = readJSON("artifacts.json", []);
  const rec = { id: "art_" + crypto.randomBytes(8).toString("hex"), createdAt: Date.now(), ...artifact };
  all.push(rec);
  writeJSON("artifacts.json", all);
  return rec;
}

/* ---- Routing decisions (orchestrator: which agent/skill/tools, and why) ---- */
export function addRouting(rec) {
  const all = readJSON("routing.json", []);
  const r = { id: "rt_" + crypto.randomBytes(8).toString("hex"), at: Date.now(), ...rec };
  all.push(r);
  writeJSON("routing.json", all.slice(-1000)); // cap history
  return r;
}
export function listRouting({ runId, limit = 200 } = {}) {
  let arr = readJSON("routing.json", []);
  if (runId) arr = arr.filter((r) => r.runId === runId);
  return arr.slice(-limit).reverse();
}

/* ---- Evolution records (skill/agent/tool/function improvement proposals) ---- */
const _evolution = keyedCollection("evolution.json");
export const listEvolutions = (filter) => _evolution.list(filter);
export const getEvolution = (id) => _evolution.get(id);
export const putEvolution = (e) => _evolution.put(e);
export const patchEvolution = (id, patch) => _evolution.patch(id, patch);
export const deleteEvolution = (id) => _evolution.remove(id);

/* ---- Server-owned family data (P1/P4): the canonical household graph ----
 * Events and tasks become server-owned entities (previously client-only seed) so the
 * assistant/agents can ground on real data, runs can mutate them durably, and role-
 * based visibility is enforced server-side. Events carry the rich family-operations
 * model (participants, driver/owner, what-to-bring, checklist, provenance, layer). */
const _events = keyedCollection("events.json");
export const listEvents = (filter) => _events.list(filter);
export const getEvent = (id) => _events.get(id);
export const putEvent = (e) => _events.put(e);
export const patchEvent = (id, patch) => _events.patch(id, patch);
export const deleteEventRec = (id) => _events.remove(id);

const _tasks = keyedCollection("tasks.json");
export const listTasks = (filter) => _tasks.list(filter);
export const getTask = (id) => _tasks.get(id);
export const putTask = (t) => _tasks.put(t);
export const patchTask = (id, patch) => _tasks.patch(id, patch);
export const deleteTaskRec = (id) => _tasks.remove(id);

// Meal plan — a week of family meals. Grocery items reuse tasks.json (type:"list").
const _meals = keyedCollection("meals.json");
export const listMeals = (filter) => _meals.list(filter);
export const getMeal = (id) => _meals.get(id);
export const putMeal = (m) => _meals.put(m);
export const patchMeal = (id, patch) => _meals.patch(id, patch);
export const deleteMealRec = (id) => _meals.remove(id);

// Calendar subscriptions (ICS feeds) — the source records for the read-only "linked"
// calendar layer. Synced events are stored in events.json with layer:"linked".
const _subs = keyedCollection("calendar_subscriptions.json");
export const listSubscriptions = (filter) => _subs.list(filter);
export const getSubscription = (id) => _subs.get(id);
export const putSubscription = (s) => _subs.put(s);
export const patchSubscription = (id, patch) => _subs.patch(id, patch);
export const deleteSubscriptionRec = (id) => _subs.remove(id);

/* ---- Playbooks (Phase 6): server-owned step-by-step household workflows ---- */
const _playbooks = keyedCollection("playbooks.json");
export const listPlaybooks = (filter) => _playbooks.list(filter);
export const getPlaybook = (id) => _playbooks.get(id);
export const putPlaybook = (p) => _playbooks.put(p);
export const patchPlaybook = (id, patch) => _playbooks.patch(id, patch);
export const deletePlaybookRec = (id) => _playbooks.remove(id);

/* ---- Household files (Phase 5): server-owned file library ----
 * Metadata lives in household_files.json (keyed collection, visibility-scoped like
 * events/tasks); the bytes live beside it in DATA_DIR/files/<id>.bin so JSON files
 * stay small and atomic writes stay fast. */
const _files = keyedCollection("household_files.json");
export const listFiles = (filter) => _files.list(filter);
export const getFileRec = (id) => _files.get(id);
export const putFileRec = (f) => _files.put(f);
export const patchFileRec = (id, patch) => _files.patch(id, patch);
const FILES_DIR = join(DATA_DIR, "files");
export function writeFileBlob(id, buf) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  fs.writeFileSync(join(FILES_DIR, `${id}.bin`), buf);
}
export function readFileBlob(id) {
  const p = join(FILES_DIR, `${id}.bin`);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
export function deleteFileRec(id) {
  _files.remove(id);
  try { fs.unlinkSync(join(FILES_DIR, `${id}.bin`)); } catch { /* already gone */ }
}

/* ---- Server-durable assistant conversations (P1.1) ----
 * Threads + messages live server-side so history survives refresh and the assistant
 * context can be retrieved from the server rather than trusted from the client. */
const _conversations = keyedCollection("conversations.json");
export const listConversations = (filter) => _conversations.list(filter);
export const getConversation = (id) => _conversations.get(id);
export const putConversation = (c) => _conversations.put(c);
export const patchConversation = (id, patch) => _conversations.patch(id, patch);
export const deleteConversationRec = (id) => _conversations.remove(id);
// Append a message to a conversation's durable transcript (atomic read-modify-write).
export function appendConversationMessage(id, message) {
  const all = readJSON("conversations.json", {});
  const c = all[id];
  if (!c) return null;
  c.messages = [...(c.messages ?? []), message];
  c.updatedAt = new Date().toISOString();
  writeJSON("conversations.json", all);
  return c;
}

/* ---- Per-entity risk-class overrides (item 9) ----
 * A household may lower (or raise) a tool/function's risk class and skip the human
 * approval gate for it. Server-owned and consulted inside the engine's authoritative
 * resolveTool — the client can never grant itself a skip. Records are keyed
 * `${householdId}:${toolId}` so overrides can never leak across households. */
const _riskOverrides = keyedCollection("risk_overrides.json");
export const listRiskOverrides = (filter) => _riskOverrides.list(filter);
export const putRiskOverride = (r) => _riskOverrides.put(r);
export const deleteRiskOverrideRec = (id) => _riskOverrides.remove(id);
export function getRiskOverride(householdId, toolId) {
  return _riskOverrides.get(`${householdId}:${toolId}`) ?? null;
}

/* ---- Contact methods (server-owned registry) ----
 * The canonical per-member delivery registry (email/phone/in-app/dashboard) with
 * verified + opt-in state and a per-agent allowlist. Previously client-only
 * (IndexedDB); server-owned so mobile can manage it and notify.mjs can resolve a
 * method's real channel/address instead of trusting ad-hoc per-call input. */
const _contactMethods = keyedCollection("contact_methods.json");
export const listContactMethods = (filter) => _contactMethods.list(filter);
export const getContactMethod = (id) => _contactMethods.get(id);
export const putContactMethod = (c) => _contactMethods.put(c);
export const patchContactMethod = (id, patch) => _contactMethods.patch(id, patch);
export const deleteContactMethodRec = (id) => _contactMethods.remove(id);

/* ---- Contact verification challenges (the true verification loop) ----
 * One pending challenge per contact method (keyed by methodId): a 6-digit code
 * sent through the method's REAL channel; entering it proves control of the
 * address and flips the method to verified + opted-in. Codes are stored plain:
 * they are short-lived (10 min), single-use, attempt-limited, and live in the
 * same local data dir that already holds the vault key file and plaintext
 * session bearer tokens — disk access is total compromise regardless. */
const _contactVerifications = keyedCollection("contact_verifications.json");
export const getContactVerification = (methodId) => _contactVerifications.get(methodId);
export const putContactVerification = (v) => _contactVerifications.put(v);
export const patchContactVerification = (methodId, patch) => _contactVerifications.patch(methodId, patch);
export const deleteContactVerification = (methodId) => _contactVerifications.remove(methodId);

/* ---- In-app notifications (item 16b) ----
 * Durable per-household notification records — the "in-app / family dashboard" delivery
 * channel, and the audit trail for email/text sends. Actor-scoped reads. */
const _notifications = keyedCollection("notifications.json");
export const listNotifications = (filter) => _notifications.list(filter);
export function addNotification(n) {
  const rec = { id: "ntf_" + crypto.randomBytes(8).toString("hex"), read: false, createdAt: Date.now(), ...n };
  _notifications.put(rec);
  return rec;
}
export function markNotificationRead(id) { return _notifications.patch(id, { read: true }); }

export { DATA_DIR };
