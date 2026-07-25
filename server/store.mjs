// FamiliOS AI — backend persistence + secrets vault (local development boundary).
// Real, file-backed storage with AES-256-GCM encryption for secret config values.
// Secrets are only ever decrypted inside this backend process and are redacted in
// every API response. No secrets are stored in the frontend or browser.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { createEngine } from "./tenant-db.mjs";
import { currentTenant, runWithTenant, RESIDENT_TENANT } from "./tenant-context.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Data dir is overridable (HOMEOPS_DATA_DIR) so the test harness can point at an
// isolated temp directory and never touch the real server/.data store.
//
// Hard guard (ISS-001): inside a `node --test` process (NODE_TEST_CONTEXT is set)
// this module must NEVER fall back to the live server/.data. A bare
// `import("../store.mjs")` from a test once resolved the default dir, ran the
// stall sweeper against the live tenant DB, and wedged the running backend's
// node:sqlite handle into permanent disk I/O errors. Fail loudly instead.
if (process.env.NODE_TEST_CONTEXT && !process.env.HOMEOPS_DATA_DIR) {
  throw new Error(
    "server/store.mjs: refusing to open the default server/.data from a test process " +
    "(NODE_TEST_CONTEXT is set but HOMEOPS_DATA_DIR is not). This would point the test at " +
    "LIVE data and can corrupt a running backend. Fix: set process.env.HOMEOPS_DATA_DIR to an " +
    "isolated temp dir BEFORE the first import of ../store.mjs (see server/test/harness.mjs), " +
    "or seed through the spawned test server's API instead of importing the store directly."
  );
}
const DATA_DIR = process.env.HOMEOPS_DATA_DIR
  ? process.env.HOMEOPS_DATA_DIR
  : join(__dirname, ".data");
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---- Tenant storage engine (ADR-001): SQLite database per household ----
 * The original production household is tenant "local"; opening it migrates any
 * legacy JSON collections into tenants/local/household.db (originals preserved
 * under .migrated/). Every accessor below keeps its synchronous signature and
 * resolves WHICH household at call time from the async tenant context (C1.4):
 * requests act as their session's household, engine runs as their run's,
 * anything outside a context as the resident household. */
const engine = createEngine(DATA_DIR);
engine.openTenant(RESIDENT_TENANT);
const T = () => currentTenant();
/** The storage engine, for per-household export/import (backups). */
export function tenantEngine() { return engine; }
export const CURRENT_TENANT = RESIDENT_TENANT;
export { runWithTenant, currentTenant };
/** Run fn once per known household, inside that household's tenant context. */
export async function forEachTenant(fn) {
  const ids = [...new Set([RESIDENT_TENANT, ...engine.tenantIds()])].filter((t) => t !== SYSTEM_TENANT);
  for (const t of ids) {
    try { await runWithTenant(t, () => fn(t)); } catch { /* one household must never break the loop for the rest */ }
  }
}

/* ---- System tenant: cross-household registries (identities, sessions) ----
 * Sessions and login identities can't live inside a household db — at login
 * time we don't yet know which household the caller belongs to. They live in
 * a dedicated "_system" tenant instead (same engine, same backup coverage).
 * One-shot migration: sessions born in the legacy single-tenant era move over
 * so nobody gets logged out by the upgrade. */
const SYSTEM_TENANT = "_system";
engine.openTenant(SYSTEM_TENANT);
{
  const sysSessions = engine.getDoc(SYSTEM_TENANT, "sessions.json", {});
  if (Object.keys(sysSessions).length === 0) {
    const legacy = engine.getDoc(RESIDENT_TENANT, "sessions.json", {});
    if (Object.keys(legacy).length > 0) {
      engine.putDoc(SYSTEM_TENANT, "sessions.json", legacy);
      engine.putDoc(RESIDENT_TENANT, "sessions.json", {});
    }
  }
}
const sysDoc = (file, fallback) => engine.getDoc(SYSTEM_TENANT, file, fallback);
const putSysDoc = (file, value) => engine.putDoc(SYSTEM_TENANT, file, value);
export { sysDoc, putSysDoc, SYSTEM_TENANT };

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

// Corruption quarantine: storage that can't be read cleanly (a tenant db that
// fails integrity_check, an unparseable legacy file at migration, or a kv doc
// that won't parse) is preserved as-is and marked read-degraded — writes then
// REFUSE, because silently overwriting is how a family's data gets erased.
// Recovery: restore from a backup, then acknowledge via the Owner store route.
export function quarantinedCollections() {
  return engine.quarantined(T());
}
export function acknowledgeQuarantine(file) { return engine.acknowledge(T(), file); }

function readJSON(file, fallback) {
  return engine.getDoc(T(), file, fallback);
}
// Data revision — bumped on every meaningful write so clients can watch ONE tiny
// number and refetch only when something actually changed (cross-device
// freshness without websockets). Plumbing files that churn on their own are
// excluded so the rev only moves for user-visible data.
//
// WP-009 (ISS-010/HYP-006): this used to be a single process-global counter,
// so ANY household's write bumped rev for EVERY connected client — on a
// shared dev/test server (multiple disposable households, concurrent
// Playwright sessions) that made the "only refetch on real change" signal
// almost meaningless, since rev moved constantly for reasons that had
// nothing to do with a given household's own data. It's now tracked
// per-tenant (keyed by the same household id every other store accessor
// uses via T()), so a household's rev only advances on ITS OWN writes.
// revEmitter lets /api/changes (SSE) push a bump the instant it happens
// instead of every consumer having to poll for it.
export const revEmitter = new EventEmitter();
revEmitter.setMaxListeners(0);
const _dataRevByTenant = new Map(); // tenantId -> rev
const REV_EXCLUDE = new Set(["sessions.json", "idempotency.json", "health.json", "oauth_states.json", "contact_verifications.json"]);
function ensureRev(tenant) {
  if (!_dataRevByTenant.has(tenant)) _dataRevByTenant.set(tenant, Date.now());
  return _dataRevByTenant.get(tenant);
}
export function getDataRev() { return ensureRev(T()); }
export function getDataRevForTenant(tenant) { return ensureRev(tenant); }
function bumpRev(file) {
  if (REV_EXCLUDE.has(file)) return;
  const tenant = T();
  const next = ensureRev(tenant) + 1;
  _dataRevByTenant.set(tenant, next);
  revEmitter.emit("bump", { tenant, rev: next });
}

// Durability: the engine writes through SQLite WAL transactions — a crash
// mid-write rolls back cleanly instead of leaving a half-written file.
function writeJSON(file, value) {
  engine.putDoc(T(), file, value); // throws store_quarantined/tenant_quarantined
  bumpRev(file);
}
// Exported for the run engine and the agent/skill/function registries, which build
// their own accessors on top of the same file-backed, atomic-write substrate.
export { readJSON, writeJSON };

// Bulk-clear an OPERATIONAL collection to empty — the "declutter / fresh start" primitive
// behind the Owner-only reset-assistant flow. Deliberately allowlisted: only the assistant's
// own operational history is clearable here (improvements, memory, chat/inbox, approvals,
// run history, generated artifacts/reports). Identity/config/asset collections — members,
// settings, accounts, connectors, calendar events, tasks/lists, files, knowledge/recipes,
// agents, skills, triggers — are NEVER wholesale-clearable through this path; they change
// only through their own audited endpoints.
const CLEARABLE_COLLECTIONS = new Set([
  "evolution.json", "memory.json", "conversations.json", "notifications.json",
  "help-requests.json", "approvals.json", "runs.json", "artifacts.json",
]);
// Array-shaped collections store a JSON array blob — their readers call .filter()/.push()
// on the value directly, so clearing them to {} (an object) makes those readers throw. Every
// other clearable collection is an id-keyed object. Clearing MUST write back the same shape.
const ARRAY_COLLECTIONS = new Set(["memory.json", "artifacts.json"]);
export function clearableCollections() { return [...CLEARABLE_COLLECTIONS]; }
export function clearCollection(file) {
  if (!CLEARABLE_COLLECTIONS.has(file)) return { error: "not_clearable" };
  const isArray = ARRAY_COLLECTIONS.has(file);
  const current = readJSON(file, isArray ? [] : {});
  const cleared = Array.isArray(current) ? current.length : Object.keys(current || {}).length;
  writeJSON(file, isArray ? [] : {}); // shape-correct empty — putDoc + bumpRev, atomic, tenant-scoped
  return { ok: true, cleared };
}

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
// Tenant-prefixed so two households can never contend on (or alias) one lock key.
export function withRunLock(runId, fn) {
  return withLock(`run:${T()}:${runId}`, fn);
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

/* ---- Audit log (append-only, redacted; lives beside the tenant db) ---- */
export function appendAudit(event) {
  const line = JSON.stringify({ id: crypto.randomUUID(), at: new Date().toISOString(), ...event });
  fs.appendFileSync(engine.tenantPath(T(), "audit.jsonl"), line + "\n");
}
export function readAudit(limit = 100) {
  const p = engine.tenantPath(T(), "audit.jsonl");
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

/* ---- Settings (kill switch, active AI provider, household prefs) ----
 * Household-scoped (C1.2): every call site passes the household it acts for —
 * a run's kill switch or AI provider must NEVER resolve from another family's
 * settings. Omitting householdId falls back to the resident household, which
 * is only correct for boot/bootstrap paths that predate a session. */
// WP-008a (DEC-015): a brand-new household (no settings.json row written yet) now
// defaults autoApproveImprovements OFF — self-changes to an agent's instructions or a
// skill's guidance require a human's review unless a family opts in. An EXISTING
// household's settings.json already exists (even without this key set), so getDoc
// returns its real stored doc as-is and this fallback never applies to it — its
// behavior is unchanged (still `!== false` → ON) until it explicitly toggles the
// setting. The first setSettings() call for a fresh household bakes this false in
// explicitly (see setSettings below), which is what lets the Improvements tab tell
// "explicitly on" apart from "on only because of this fallback."
export function getSettings(householdId) {
  return engine.getDoc(householdId ?? T(), "settings.json", { externalActionsEnabled: true, autoApproveImprovements: false });
}
export function setSettings(patch, householdId) {
  const t = householdId ?? T();
  const next = { ...getSettings(t), ...patch };
  engine.putDoc(t, "settings.json", next);
  bumpRev("settings.json"); // rev is a single shared signal until per-tenant rev lands
  return next;
}

/* ---- AI usage metering (C1.3 → C1.5 billing hook) ----
 * Every AI call made on a household's behalf is counted in that household's
 * own store, by day and kind ("run" = engine steps, "assistant" = chat/planner).
 * An optional settings.aiDailyCallBudget turns the meter into a cap: callers
 * check aiBudgetExhausted() and degrade honestly (like "no provider"), never
 * silently. No budget set = unlimited (the family's server stays unmetered
 * until a plan says otherwise). */
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
export function recordAiUsage(householdId, kind = "other") {
  const t = householdId ?? T();
  const all = engine.getDoc(t, "ai_usage.json", {});
  const day = dayKey();
  const rec = all[day] ?? {};
  rec[kind] = (rec[kind] ?? 0) + 1;
  rec.total = (rec.total ?? 0) + 1;
  all[day] = rec;
  // Keep ~60 days; usage history is operational, not archival.
  for (const k of Object.keys(all)) if (k < dayKey(new Date(Date.now() - 60 * 86400000))) delete all[k];
  engine.putDoc(t, "ai_usage.json", all);
  return rec;
}
export function getAiUsage(householdId, day = dayKey()) {
  return engine.getDoc(householdId ?? T(), "ai_usage.json", {})[day] ?? { total: 0 };
}
export function aiBudgetExhausted(householdId) {
  const budget = Number(getSettings(householdId).aiDailyCallBudget);
  if (!Number.isFinite(budget) || budget <= 0) return false; // unmetered
  return (getAiUsage(householdId).total ?? 0) >= budget;
}

/* ---- Plan & entitlement (C1.5) ----
 * The billing truth lives on each household's settings under `plan`, written
 * ONLY by the RevenueCat webhook (or an operator). Resolution order:
 *   resident household → always active (it's the family's own server);
 *   paid entitlement (familios_plus) → active until expiry (+ billing grace);
 *   otherwise → 21-day trial from household creation, then expired.
 * Apple's intro offers can't express a 21-day trial, so the trial is ours. */
const TRIAL_DAYS = 21;
export function getPlan(householdId) {
  const t = householdId ?? T();
  if (t === RESIDENT_TENANT) return { tier: "resident", active: true };
  const s = getSettings(t);
  const plan = s.plan ?? {};
  const now = Date.now();
  if (plan.tier === "plus") {
    if (!plan.expiresAt || plan.expiresAt > now) return { tier: "plus", active: true, expiresAt: plan.expiresAt ?? null };
    if (plan.graceUntil && plan.graceUntil > now) return { tier: "plus", active: true, grace: true, expiresAt: plan.expiresAt };
  }
  let createdAt = Number(s.householdCreatedAt ?? 0);
  if (!createdAt) { createdAt = now; setSettings({ householdCreatedAt: createdAt }, t); } // first-seen backfill
  const trialEndsAt = createdAt + TRIAL_DAYS * 86400000;
  return trialEndsAt > now
    ? { tier: "trial", active: true, trialEndsAt }
    : { tier: "expired", active: false, trialEndsAt };
}
/** Applied by the RevenueCat webhook — the only writer of plan state. */
export function setPlanFromEntitlement(householdId, { active, expiresAt = null, graceUntil = null, source = "revenuecat" }) {
  const next = active
    ? { tier: "plus", expiresAt, graceUntil, source, updatedAt: Date.now() }
    : { tier: "none", expiresAt, graceUntil: null, source, updatedAt: Date.now() };
  setSettings({ plan: next }, householdId);
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

/* ---- Sessions (httpOnly cookie token + CSRF double-submit token) ----
 * Sessions live in the _system tenant: they are resolved BEFORE we know which
 * household a request belongs to, and each carries the householdId the tenant
 * context is then set from. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
export function createSession({ actorId, actorName, role, householdId }) {
  const all = sysDoc("sessions.json", {});
  const token = crypto.randomBytes(32).toString("hex");
  const csrf = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  all[token] = { token, csrf, actorId, actorName, role, householdId: householdId ?? "local", createdAt: now, expiresAt: now + SESSION_TTL_MS };
  putSysDoc("sessions.json", all);
  return all[token];
}
export function getSession(token) {
  if (!token) return null;
  const all = sysDoc("sessions.json", {});
  const s = all[token];
  if (!s) return null;
  if (s.expiresAt < Date.now()) { delete all[token]; putSysDoc("sessions.json", all); return null; }
  return s;
}
export function deleteSession(token) {
  const all = sysDoc("sessions.json", {});
  if (all[token]) { delete all[token]; putSysDoc("sessions.json", all); return true; }
  return false;
}

/** Kill every live session (cookie + bearer) for an actor — called when a
 * member is archived so a removed person's devices lose access immediately,
 * not at token expiry. Also used on role demotion. Household-scoped: the same
 * actorId in another household is a different person. */
/** Kill every session belonging to a household — used when the household
 * itself is deleted (Apple 5.1.1(v) account deletion). */
export function deleteSessionsForHousehold(householdId) {
  const all = sysDoc("sessions.json", {});
  let killed = 0;
  for (const [token, s] of Object.entries(all)) {
    if ((s.householdId ?? "local") === householdId) { delete all[token]; killed++; }
  }
  if (killed) putSysDoc("sessions.json", all);
  return killed;
}
export function deleteSessionsForActor(actorId, householdId) {
  const hh = householdId ?? T();
  const all = sysDoc("sessions.json", {});
  let killed = 0;
  for (const [token, s] of Object.entries(all)) {
    if (s.actorId === actorId && (s.householdId ?? "local") === hh) { delete all[token]; killed++; }
  }
  if (killed) putSysDoc("sessions.json", all);
  return killed;
}

/* ---- Household members (server-owned role source of truth) ----
 * Authority is NEVER taken from the client. A session's effective role is resolved
 * from this registry by actorId. members.json is seeded on boot (seed.mjs) and is
 * the only place a member's role may be changed (by an authorized server path).
 * MemberRec = { actorId, householdId, displayName, role, relationship, spaceIds?,
 *   color?, archived?, createdAt, updatedAt } — `color` is an optional per-member
 *   accent (one of the app accent names, or a hex string), stored as-is and back-
 *   compat (members without it are unaffected). */
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
  // `uploadedBy` is the file collection's name for the same idea as ownerId/createdBy. Without
  // it, a visibility:"private" FILE was invisible to the person who uploaded it — which is how
  // a profile photo could upload successfully, save its id onto the member, and then silently
  // never render anywhere (the avatar fell back to initials and nothing reported a failure).
  const isOwner = entity.ownerId === actorId || entity.createdBy === actorId || entity.uploadedBy === actorId;
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
export function createApproval({ actorId, householdId, connectorId, toolId, input, risk, category, preview, allowedApproverRoles, allowedApproverIds, source, visibility }) {
  const all = readJSON("approvals.json", {});
  const id = "apr_" + crypto.randomBytes(12).toString("hex");
  const now = Date.now();
  const toolRisk = risk ?? "High";
  all[id] = {
    id, actorId, requestedBy: actorId, householdId: householdId ?? "local", connectorId, toolId,
    inputHash: hashInput(input), risk: toolRisk, toolRisk, category: category ?? "Message",
    // "personal" approvals never fan out beyond their requester (see notify.approvalAudience).
    visibility: visibility === "personal" ? "personal" : "household",
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

/* ---- Expo push tokens (registered by native clients on login) ----
 * Stored as { token, householdId, actorId, updatedAt } so a notification can target the
 * right person's device(s) — a personal approval must not fan out to the whole family.
 * Legacy entries were bare strings; getPushTokens() normalizes them to objects (with
 * null owner) so old registrations keep working until the client re-registers. */
function normalizePushRec(t) {
  if (typeof t === "string") return { token: t, householdId: null, actorId: null };
  return t && typeof t === "object" && t.token ? t : null;
}
export function getPushTokens() {
  return readJSON("push-tokens.json", []).map(normalizePushRec).filter(Boolean);
}
export function addPushToken(token, owner = {}) {
  if (!token || typeof token !== "string") return;
  const rows = getPushTokens().filter((r) => r.token !== token);
  rows.push({ token, householdId: owner.householdId ?? null, actorId: owner.actorId ?? null, updatedAt: Date.now() });
  writeJSON("push-tokens.json", rows);
}
export function removePushToken(token) {
  writeJSON("push-tokens.json", getPushTokens().filter((r) => r.token !== token));
}

/* =======================================================================
   Server-side engine substrate (Slice 0) — durable, file-backed entities.
   The server is the source of truth for agents, skills, functions, runs,
   run steps, memory, artifacts, routing decisions, and evolution records.
   ======================================================================= */

// Generic keyed-object collection helper. Point ops go through the engine's
// single-row fast path (one row, not a whole-collection parse); whole-set reads
// go through getDoc, which reconstructs from rows or falls back to a kv doc.
function keyedCollection(file) {
  const coll = file.replace(/\.json$/, "");
  return {
    all: () => readJSON(file, {}),
    get: (id) => engine.getRecord(T(), coll, id),
    put: (obj) => {
      engine.putRecord(T(), coll, obj.id, obj);
      bumpRev(file);
      return obj;
    },
    patch: (id, patch) => {
      const existing = engine.getRecord(T(), coll, id);
      if (!existing) return null;
      const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      engine.putRecord(T(), coll, id, next);
      bumpRev(file);
      return next;
    },
    remove: (id) => {
      const had = engine.deleteRecord(T(), coll, id);
      if (had) bumpRev(file);
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
// Run mutations are single-row engine ops: a step patch rewrites ONE run's row,
// not the whole runs collection (the old whole-file pattern cost ~25ms per step
// write once runs.json hit 2MB; this is ~1ms).
export function createRun(run) {
  engine.putRecord(T(), "runs", run.id, run);
  bumpRev("runs.json");
  return run;
}
export function getRun(id) {
  return engine.getRecord(T(), "runs", id);
}
export function patchRun(id, patch) {
  const r = engine.getRecord(T(), "runs", id);
  if (!r) return null;
  const next = { ...r, ...patch, updatedAt: new Date().toISOString() };
  engine.putRecord(T(), "runs", id, next);
  bumpRev("runs.json");
  return next;
}
export function patchRunStep(id, index, patch) {
  const r = engine.getRecord(T(), "runs", id);
  if (!r || !r.steps?.[index]) return null;
  r.steps[index] = { ...r.steps[index], ...patch, updatedAt: new Date().toISOString() };
  r.updatedAt = new Date().toISOString();
  engine.putRecord(T(), "runs", id, r);
  bumpRev("runs.json");
  return r;
}
export function appendToolCall(id, index, call) {
  const r = engine.getRecord(T(), "runs", id);
  if (!r || !r.steps?.[index]) return null;
  (r.steps[index].toolCalls ??= []).push({ at: new Date().toISOString(), ...call });
  r.updatedAt = new Date().toISOString();
  engine.putRecord(T(), "runs", id, r);
  bumpRev("runs.json");
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
  const had = engine.deleteRecord(T(), "runs", id);
  if (had) bumpRev("runs.json");
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

// Knowledge — user-authored household knowledge (custom instructions, family facts,
// preferences, rules, reference notes). Distinct from the auto-generated, read-only
// memory/artifacts above: this is a real CRUD collection the family owns and edits.
// Visibility-scoped ("household" | "personal") and tenant-scoped like meals/events.
const _knowledge = keyedCollection("knowledge.json");
export const listKnowledge = (filter) => _knowledge.list(filter);
export const getKnowledge = (id) => _knowledge.get(id);
export const addKnowledge = (k) => _knowledge.put(k);
export const patchKnowledge = (id, patch) => _knowledge.patch(id, patch);
export const removeKnowledge = (id) => _knowledge.remove(id);

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

/* ---- Help requests: "can you help?" asks between household members ----
 * A member (any role — children and helpers included) asks another member for a
 * hand, optionally anchored to an event or task. The recipient accepts/declines;
 * the requester (or an adult) may cancel while pending. Notifications are
 * targeted to the two people involved, never fanned out to the household. */
const _helpRequests = keyedCollection("help-requests.json");
export const listHelpRequests = (filter) => _helpRequests.list(filter);
export const getHelpRequest = (id) => _helpRequests.get(id);
export const putHelpRequest = (rec) => _helpRequests.put(rec);
export const patchHelpRequest = (id, patch) => _helpRequests.patch(id, patch);

/* ---- Household files (Phase 5): server-owned file library ----
 * Metadata lives in household_files.json (keyed collection, visibility-scoped like
 * events/tasks); the bytes live beside it in DATA_DIR/files/<id>.bin so JSON files
 * stay small and atomic writes stay fast. */
const _files = keyedCollection("household_files.json");
export const listFiles = (filter) => _files.list(filter);
export const getFileRec = (id) => _files.get(id);
export const putFileRec = (f) => _files.put(f);
export const patchFileRec = (id, patch) => _files.patch(id, patch);
// Resolved per call, not at boot — each household's blobs live beside ITS db.
const filesDir = () => engine.tenantPath(T(), "files");
export function writeFileBlob(id, buf) {
  fs.mkdirSync(filesDir(), { recursive: true });
  fs.writeFileSync(join(filesDir(), `${id}.bin`), buf);
}
export function readFileBlob(id) {
  const p = join(filesDir(), `${id}.bin`);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
export function deleteFileRec(id) {
  // A multi-page file has one blob per page (pageBlobIds); a legacy/single-page file
  // stores its single blob under the record id. Remove every backing blob so nothing leaks.
  const rec = _files.get(id);
  _files.remove(id);
  const blobIds = Array.isArray(rec?.pageBlobIds) && rec.pageBlobIds.length ? rec.pageBlobIds : [id];
  for (const bid of blobIds) { try { fs.unlinkSync(join(filesDir(), `${bid}.bin`)); } catch { /* already gone */ } }
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
