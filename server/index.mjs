// FamiliOS AI — backend control plane (Node built-in http; no extra dependencies).
// Deny-by-default authority: origin allowlist, authenticated sessions, CSRF on
// mutations, role checks, server-side approval records (consume-once), PKCE OAuth,
// HMAC webhooks, SSRF-guarded egress, a real job scheduler, AI provider adapters,
// and audit logging with actor/origin/request identity.
import "./loadEnv.mjs"; // must run before modules that read env at import time (auth.mjs)
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getConnectorConfig, setConnectorConfig, revokeConnector, getSecret,
  appendAudit, readAudit, getWebhookEvents, addWebhookEvent, getSettings, setSettings, getDataRev,
  getDataRevForTenant, revEmitter,
  quarantinedCollections, acknowledgeQuarantine, CURRENT_TENANT, forEachTenant, runWithTenant,
  tenantEngine, sysDoc, putSysDoc, deleteSessionsForHousehold, getPlan, setPlanFromEntitlement,
  createSession, deleteSession, deleteSessionsForActor, createApproval, getApproval, decideApproval, consumeApproval, listApprovals,
  putOAuthState, takeOAuthState, getHealth, setHealth, getJobState, setJobState, seenWebhookNonce,
  getPushTokens, addPushToken, removePushToken,
  getRun, listRuns, getSkill, listSkills,
  listEvolutions, getEvolution, patchEvolution, putEvolution,
  getMember, listMembers, putMember, canApprove, isAdultRole,
  listEvents, getEvent, putEvent, patchEvent, deleteEventRec,
  listTasks, getTask, putTask, patchTask, deleteTaskRec,
  listSubscriptions, getSubscription, putSubscription, patchSubscription, deleteSubscriptionRec,
  listMeals, getMeal, putMeal, patchMeal, deleteMealRec,
  listKnowledge, getKnowledge, addKnowledge, patchKnowledge, removeKnowledge,
  listConversations, getConversation, putConversation, appendConversationMessage, deleteConversationRec,
  canSeeEntity, listMemory, listArtifacts, getMemoryEntry, deleteMemoryEntry,
  listRiskOverrides, putRiskOverride, deleteRiskOverrideRec, getRiskOverride,
  listNotifications, markNotificationRead,
  listContactMethods, getContactMethod, putContactMethod, patchContactMethod, deleteContactMethodRec,
  getContactVerification, putContactVerification, patchContactVerification, deleteContactVerification,
  listFiles, getFileRec, putFileRec, patchFileRec, writeFileBlob, readFileBlob, deleteFileRec,
  listPlaybooks, getPlaybook, putPlaybook, deletePlaybookRec,
  listHelpRequests, getHelpRequest, putHelpRequest, patchHelpRequest,
  addNotification, getAccountRaw,
  clearCollection,
} from "./store.mjs";
import { startRun, resumeRun, cancelRun, recoverRuns, findRunByApprovalId, runEmitter, expireStaleRuns, setDraining, releaseAllLeases, applyEvolutionToTarget } from "./engine.mjs";
import { revertEvolution, resolveEvolutionBefore, canRevertEvolution, listEvolutionArchive } from "./evolution-revert.mjs";
import { createBackup, listBackups, readBackup, restoreBackup, backupTick } from "./backup.mjs";
import { registerAssistantRunHooks } from "./assistant-runs.mjs";
import { closeBrowser } from "./browser.mjs";
import { orchestrate, ensureOpenDefaultAgent } from "./orchestrator.mjs";
import { sandboxEnabled, seedSandboxAccounts, listSandboxEffects } from "./sandbox-connectors.mjs";
import { seedDefaults } from "./seed.mjs";
import { syncSubscription, removeSubscriptionEvents, pullGoogleEdits, resolveConflictPatch, pushEventToGoogle, autoSyncGoogle, mealEventNotes, isEditableLinkedGoogle, editLinkedGoogleEvent, deleteLinkedGoogleEvent, deleteGoogleCopy } from "./calendar.mjs";
import { twilioAuthToken, twilioSignatureValid, handleInboundSms, twiml } from "./sms.mjs";
import {
  createAgent, replaceAgent, partialUpdateAgent, deleteAgent, duplicateAgent,
  rollbackAgent, listAgentVersions, agentContext, selectAgent, publicAgent, listPublicAgents,
  deriveCapabilitiesFromSteps, agentVisibleTo,
} from "./agents.mjs";
import { agentTemplateSections } from "./agent-templates.mjs";
import { nameConversation } from "./planner.mjs";
import { suggestAddresses } from "./places.mjs";
import { createNest, inviteToNest, respondToNest, leaveNest, nestsFor, nestInvitesFor, canSeeNest, publicNest, nestLabel } from "./nests.mjs";
import { understandFile } from "./file-understanding.mjs";
import { isValidReminder, sweepTaskReminders } from "./reminders.mjs";
import { getAgent } from "./store.mjs";
import {
  createSkill, replaceSkill, partialUpdateSkill, deleteSkill, duplicateSkill,
  promoteSkill, rollbackSkill, inferFunctions, testSkill, listSkillVersions, skillReadiness,
} from "./skills.mjs";
import {
  createFunction, replaceFunction, partialUpdateFunction, deleteFunction, duplicateFunction,
  promoteFunction, deprecateFunction, rollbackFunction, testFunction,
  listPublicFunctions, publicFunction, FUNCTION_TYPES, FUNCTION_STATES, draftFunction,
} from "./functions.mjs";
import { getFunction, listFunctionVersions } from "./store.mjs";
import {
  createTrigger, updateTrigger, deleteTrigger, fireTrigger, fireWebhookTrigger, fireConnectorEvent,
  publicTrigger, listPublicTriggers, getTriggerSecret, tick, TRIGGER_TYPES, registerTriggerRunHooks, scheduleTextFor,
} from "./triggers.mjs";
import { getTrigger } from "./store.mjs";
import { pushApprovalNotification, deliverNotification, sendVerificationCode, sendRecoveryCode, pushToMember } from "./notify.mjs";
import { listConnectors, connectorById, publicConnector, healthCheck, executeTool, readinessOf } from "./connectors.mjs";
import { gate, corsHeaders, sessionCookie, clearSessionCookie, isAllowedOrigin, ALLOWED_ORIGINS, IS_PROD, roleAtLeast, sessionFromReq } from "./auth.mjs";
import { memoryProvider } from "./memory-provider.mjs";

// Sliding-window rate-limit buckets (in-process; per-IP pre-auth, per-actor assistant).
const _rateBuckets = new Map();
setInterval(() => { if (_rateBuckets.size > 5000) _rateBuckets.clear(); }, 10 * 60_000).unref();
import { listProviders as listAIProviders, aiProviderById, setProviderConfig, revokeProvider, setActiveProvider, providerHealth, providerModels, providerChat, bootstrapAIFromEnv } from "./ai.mjs";
import { listProviders as listConnectorProviders, providerById as connectorProviderById, providerConfigured, publicProvider as publicConnectorProvider, findToolGlobal } from "./providers.mjs";
import { buildAuthUrl, exchangeCode, apiForAccount } from "./oauth.mjs";
import { listAccountsFor, getOwnedAccount, upsertAccount, revokeAccount, checkAccountHealth, sweepAccountHealth, publicAccount, accountStatusById } from "./accounts.mjs";
import { planFromGoal, generateMiniApp, generatePlaybook, assistantRespond, assistantStream, proposeEvolution, toolCatalog } from "./planner.mjs";
import { preflightAutomation } from "./automation-preflight.mjs";

const PORT = Number(process.env.PORT || 8787);
const VERSION = "1.2.0";

// WP-006 s3 (connector sandbox): when HOMEOPS_CONNECTOR_SANDBOX=1, an OWNER
// session seeds deterministic sandbox connector accounts for its household, so
// OAuth-gated tools run against in-process mocks (transport only — consent gates,
// approvals, and policy clamps still run for real; see server/sandbox-connectors.mjs).
// Owner-only on purpose: connections are per-actor in this app, and sandbox mode
// must not conjure accounts for actors who never connected anything (the
// sandbox-e2e "no conjure" invariant) — other actors stay truthfully
// not_connected until seeded explicitly. Idempotent; a no-op in real mode.
/* ---- D5 [02:25] — "I am the inventor and owner. I need an interface to generate invite
 * codes for any household. New households do not get this."
 *
 * That is a PLATFORM role, not a household role: no value of `session.role` can express it,
 * because every role is scoped to one household by design and inventing a role that reaches
 * across tenants would put a cross-household capability inside the same field a household
 * Owner controls.
 *
 * So it lives where no household can reach it: a deployment env listing the operator's own
 * sign-in email(s). An empty env means NOBODY is an operator and the routes 404 — which is
 * exactly right for the "new households do not get this" half of the ask, and it means a
 * self-hosted copy of FamiliOS has the surface switched off unless its own operator turns it
 * on. Every use is audited.
 */
function operatorEmails() {
  return String(process.env.HOMEOPS_OPERATOR_EMAILS ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}
/** The signed-in session's own email, read from the identity registry — never from a body. */
function sessionEmail(session) {
  if (!session?.householdId || !session?.actorId) return null;
  const idn = listIdentitiesForHousehold(session.householdId).find((i) => i.actorId === session.actorId);
  return idn?.email ? String(idn.email).toLowerCase() : null;
}
function isOperator(session) {
  const allow = operatorEmails();
  if (allow.length === 0) return false;
  const email = sessionEmail(session);
  return !!email && allow.includes(email);
}

// Break-glass recovery: the sha256 of HOMEOPS_BOOTSTRAP_PIN (operator-only env), or null when
// unset. While present it is accepted as an alternative Owner/Adult-Admin PIN on both sign-in
// paths — seeding the gate before a first PIN exists AND recovering a forgotten one. Every
// break-glass sign-in is audited (session.login.breakglass); the operator clears the env after.
function pinHashOfBootstrap() {
  const bp = process.env.HOMEOPS_BOOTSTRAP_PIN;
  return bp ? crypto.createHash("sha256").update(String(bp)).digest("hex") : null;
}
function maybeSeedSandbox(s) {
  if (!sandboxEnabled() || !s?.actorId || s.role !== "Owner") return;
  try { seedSandboxAccounts({ householdId: s.householdId, actorId: s.actorId }); }
  catch (e) { console.warn("[sandbox] account seed failed:", e?.message ?? e); }
}
// ISS-105 ("a created event never appears"): an event whose stamp can't parse renders on
// NO day in either client — apps/mobile event-days.ts `coversDay` and calendar.tsx
// `dayKeys` both drop it — so storing one produced a create that returned 200, sat in the
// GET payload, and was still absent after add, after nav, and after sync. Refuse it at the
// boundary instead. `null` and `""` stay legal: the mobile form's "scheduled" toggle sends
// startAt:null on purpose, and the web store represents an unscheduled event as "".
function badTimestamp(v) {
  return v != null && v !== "" && isNaN(+new Date(v));
}

// Per-member accent color: one of the app accent names, or a hex string. Optional and
// back-compat — an unrecognized value is ignored (never stored) rather than erroring.
const MEMBER_COLORS = ["ink", "sage", "coral", "amber", "sky", "lavender"];
function normalizeMemberColor(v) {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (MEMBER_COLORS.includes(s)) return s;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return s;
  return undefined;
}
// Per-calendar-subscription accent: each connected calendar (a Google account's
// calendar, an ICS feed, a pasted import) gets the next unused accent so its
// events render as distinctly colored cards. Cycles when a household outgrows
// the palette.
const SUB_COLORS = ["sky", "sage", "amber", "lavender", "coral", "ember"];
function nextSubscriptionColor(householdId) {
  const used = listSubscriptions((s) => s.householdId === householdId).map((s) => s.color).filter(Boolean);
  return SUB_COLORS.find((c) => !used.includes(c)) ?? SUB_COLORS[used.length % SUB_COLORS.length];
}
// Chat spaces: a conversation lives in its creator's PERSONAL space (private to
// them — the long-standing behavior and the default) or in the FAMILY space
// (visibility "household"), where any household member can read and continue it.
function canSeeConversation(c, session) {
  if (!c || c.householdId !== session.householdId) return false;
  if (c.actorId === session.actorId) return true;
  // A nest thread is visible to the nest, and to nobody else — not to an Owner, not to an
  // Adult Admin. A space the household's administrator can read is not the space he asked for.
  if (c.visibility === "nest" && c.nestId) return canSeeNest(c.nestId, session.householdId, session.actorId);
  return c.visibility === "household";
}
const APP_ORIGIN = ALLOWED_ORIGINS[0] || "http://localhost:5173";
const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC_DIR = process.env.HOMEOPS_STATIC_DIR || join(ROOT_DIR, "dist");
const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
// Single OAuth callback path; deployments register this exact URI per provider app.
// HOMEOPS_PUBLIC_URL may be a comma-separated list (localhost + LAN IP for mobile);
// the FIRST entry is the canonical one providers redirect back to.
function oauthRedirectUri() {
  const base = (process.env.HOMEOPS_PUBLIC_URL || `http://localhost:${PORT}`).split(",")[0].trim();
  return `${base.replace(/\/$/, "")}/api/oauth/callback`;
}

/* ---- Expo push notifications (fire-and-forget; non-fatal) ---- */
// Shared with the run engine (which notifies when a run parks for approval with no
// browser open) via server/notify.mjs.
const notifyApproval = pushApprovalNotification;

function json(res, code, body, req, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", ...corsHeaders(req), ...extraHeaders });
  res.end(data);
}
function staticPathFor(path) {
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const target = normalize(join(STATIC_DIR, relativePath));
  const rel = relative(STATIC_DIR, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return target;
}
function serveStatic(req, res, path) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (path === "/api" || path.startsWith("/api/")) return false;

  const target = staticPathFor(path);
  if (target && fs.existsSync(target) && fs.statSync(target).isFile()) {
    return sendStatic(req, res, target);
  }

  // SPA fallback: browser routes such as /settings should load the built shell.
  if (!extname(path)) {
    const indexFile = join(STATIC_DIR, "index.html");
    if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) return sendStatic(req, res, indexFile);
  }
  return false;
}
function sendStatic(req, res, file) {
  const ext = extname(file).toLowerCase();
  const name = basename(file);
  const isAsset = file.includes(`${sep}assets${sep}`);
  const cacheControl = name === "index.html" || name === "sw.js" || name === "registerSW.js"
    ? "public, max-age=0, must-revalidate"
    : isAsset ? "public, max-age=31536000, immutable" : "public, max-age=3600";
  res.writeHead(200, {
    "content-type": STATIC_TYPES[ext] || "application/octet-stream",
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}
/* A request body was accumulated with no ceiling at all — any caller could stream an
 * unbounded string into memory. Capped now, and generously: the cap has to clear a real
 * upload (a 25 MB file is ~34 MB of base64 plus JSON overhead) while still being a ceiling.
 * Overflow resolves to null, which every caller already treats as malformed_json. */
const MAX_BODY_BYTES = 64 * 1024 * 1024;
/*
 * Reported as "the Daily Household Briefing has some odd characters in it" — the file was
 * stored as `Daily Household Briefing ÃÂÂ July 13, 2026.pdf`. The original had an em-dash.
 *
 * The cause was here: this used to accumulate with `b += chunk`, which coerces each Buffer to
 * a string SEPARATELY. A multi-byte UTF-8 character straddling a chunk boundary is therefore
 * decoded as two half-characters, and every accent, dash and emoji in a large enough request
 * comes out mangled. Small bodies arrive in one chunk and look perfect, which is exactly why
 * this survived so long — it only bites once a request is big enough to be split, i.e. an
 * upload.
 *
 * Buffers are collected and decoded ONCE, over the whole body, so a character can no longer be
 * torn in half by the network.
 */
function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let len = 0;
    let over = false;
    req.on("data", (c) => {
      if (over) return;
      len += c.length;
      if (len > MAX_BODY_BYTES) { over = true; chunks.length = 0; try { req.destroy(); } catch { /* already gone */ } return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}
async function readBody(req) {
  const raw = await readRaw(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { return null; }
}
function externalActionsEnabled(householdId) { return getSettings(householdId).externalActionsEnabled !== false; }
// A real IANA zone the platform's ICU data recognizes — rejects junk like "PST" or
// "America/Nowhere" before it can silently break trigger scheduling (server/triggers.mjs).
function isValidTimezone(tz) {
  try {
    if (typeof Intl.supportedValuesOf === "function") return Intl.supportedValuesOf("timeZone").includes(tz);
    new Intl.DateTimeFormat("en-US", { timeZone: tz }); // throws RangeError on an unknown zone
    return true;
  } catch { return false; }
}
// C1.5 plan gate for AI-spend routes: resident household and active trials/
// subscriptions pass; an expired household gets an honest 402 with its plan
// state. Family DATA routes are never gated — data is theirs regardless.
function planGate(g, res, req) {
  const plan = getPlan(g.session.householdId);
  if (plan.active) return null;
  return json(res, 402, { error: "plan_required", plan, message: "Your free trial has ended — subscribe to FamiliOS Plus to keep using the assistant and agents. Your family's data stays fully accessible either way." }, req);
}
// Child AI gate: a Child View profile may chat with the assistant only after an adult
// flips their aiEnabled toggle (PATCH /api/members/:id). Runs after gate() so the 403
// is about the toggle, never a session/CSRF leak.
function childAiGate(g, res, req) {
  if (g.session.role !== "Child View") return null;
  if (getMember(g.session.actorId)?.aiEnabled === true) return null;
  return json(res, 403, { error: "ai_disabled", message: "Ask a parent to turn on AI chat for your profile." }, req);
}
function audit(event, req, session) {
  appendAudit({
    ...event,
    actorId: session?.actorId ?? event.actorId ?? null,
    actorName: session?.actorName ?? null,
    role: session?.role ?? null,
    origin: req?.headers?.origin ?? null,
    requestId: req?.__rid ?? null,
    ip: req?.socket?.remoteAddress ?? null,
  });
}

/* I1 — rename a thread from its first exchange, once, and only while it still carries the
 * auto-title (the truncated first message). A family that renamed a chat themselves keeps
 * their name: overwriting a deliberate title with a generated one is worse than a bad title.
 * Fire-and-forget — the turn is already saved and must not wait on, or fail because of, this. */
function maybeNameConversation(convId, { question, answer, session }) {
  const conv = getConversation(convId);
  if (!conv || conv.titleAuto === false) return;
  // Only the FIRST exchange: 2 messages means the pair we just wrote.
  if ((conv.messages ?? []).length > 2) return;
  if (!String(answer ?? "").trim()) return;      // nothing to name it from
  void nameConversation({ question, answer, session })
    .then((title) => {
      if (!title) return;
      const fresh = getConversation(convId);
      if (!fresh || fresh.titleAuto === false) return;
      putConversation({ ...fresh, title, titleAuto: true, updatedAt: new Date().toISOString() });
    })
    .catch(() => { /* the thread keeps the title it already has */ });
}

/* ----------------------------- Job scheduler ---------------------------- */
// A real in-process scheduler. Jobs check connector readiness and run an actual
// read tool; outcomes (success/failure) are audited. Unknown jobs are 404.
const JOBS = [
  { id: "rss-poll", name: "RSS feed poll", connectorId: "rss", toolId: "rss.latest", intervalMs: 15 * 60_000 },
  { id: "weather-morning", name: "Morning weather refresh", connectorId: "weather", toolId: "weather.current", intervalMs: 60 * 60_000 },
];
const jobTimers = new Map();
let schedulerStarted = false;
async function runJob(job, trigger = "schedule") {
  const c = connectorById(job.connectorId);
  const readiness = c ? readinessOf(c) : "not_configured";
  const ready = ["connected", "authorized_write", "authorized_readonly", "local_only"].includes(readiness);
  setJobState(job.id, { lastRun: Date.now(), lastTrigger: trigger, running: true });
  // Scheduler jobs run for the resident household until C1.3 makes loops per-tenant.
  if (!externalActionsEnabled(CURRENT_TENANT)) { setJobState(job.id, { running: false, lastStatus: "blocked_kill_switch" }); appendAudit({ type: "job.run", jobId: job.id, connectorId: job.connectorId, ok: false, error: "kill_switch", trigger }); return { ok: false, error: "external_actions_disabled" }; }
  if (!ready) { setJobState(job.id, { running: false, lastStatus: `connector_${readiness}` }); appendAudit({ type: "job.run", jobId: job.id, connectorId: job.connectorId, ok: false, error: `connector_${readiness}`, trigger }); return { ok: false, error: `connector_${readiness}` }; }
  const out = await executeTool(job.toolId, {}, { actorId: "scheduler", householdId: CURRENT_TENANT });
  setJobState(job.id, { running: false, lastStatus: out.ok ? "success" : `error:${out.error}`, nextRun: Date.now() + job.intervalMs });
  appendAudit({ type: "job.run", jobId: job.id, connectorId: job.connectorId, ok: out.ok, error: out.ok ? undefined : out.error, trigger });
  // Connector-event triggers (Slice 6): fire only when the poll returns NEW data
  // (fingerprint changed since the last successful poll), so a trigger reacts to a
  // genuine event rather than every poll. Fire-and-forget through the canonical loop.
  if (out.ok) {
    const fp = crypto.createHash("sha256").update(JSON.stringify(out.result ?? {})).digest("hex").slice(0, 16);
    const prev = getJobState(job.id)?.lastHash;
    setJobState(job.id, { lastHash: fp });
    if (prev && prev !== fp) fireConnectorEvent(job.connectorId, { jobId: job.id, result: out.result }).catch(() => {});
  }
  return out;
}
function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  for (const job of JOBS) {
    setJobState(job.id, { nextRun: Date.now() + job.intervalMs, lastStatus: getJobState(job.id)?.lastStatus ?? "scheduled" });
    jobTimers.set(job.id, setInterval(() => { runJob(job).catch(() => {}); }, job.intervalMs));
  }
}
function jobView(job) {
  const st = getJobState(job.id) ?? {};
  return { id: job.id, name: job.name, connectorId: job.connectorId, intervalMs: job.intervalMs, lastRun: st.lastRun ?? null, nextRun: st.nextRun ?? null, lastStatus: st.lastStatus ?? "scheduled", enabled: true };
}

/* --------------------------------- Server ------------------------------- */
// Every request runs inside its own tenant context (C1.4): gate() fills in the
// household from the session, and every store accessor below follows it.
import { runWithRequestContext } from "./tenant-context.mjs";
import {
  createIdentity, verifyCredentials, consumeVerifyToken, beginPasswordReset, completePasswordReset,
  findByResetCode, findIdentityForRecovery,
  deleteIdentity, deleteIdentitiesForHousehold, listIdentitiesForHousehold, validEmail, validPassword,
  createInvite, getInvite, listInvites, revokeInvite, consumeInvite, INVITABLE_ROLES,
} from "./identity.mjs";
const server = http.createServer((req, res) => {
  runWithRequestContext(() => handleRequest(req, res)).catch(() => { try { res.writeHead(500); res.end(); } catch { /* socket gone */ } });
});
const handleRequest = async (req, res) => {
  req.__rid = crypto.randomUUID();
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // Preflight: reject disallowed origins outright (no ACAO emitted).
  if (method === "OPTIONS") {
    if (!isAllowedOrigin(req.headers.origin)) { res.writeHead(403); return res.end(); }
    res.writeHead(204, corsHeaders(req)); return res.end();
  }

  try {
    /* ---- Rate limits (in-process sliding window; public URL = hostile input) ----
     * Pre-auth routes limit per-IP (credential/claim probing); assistant routes
     * limit per-actor (runaway clients / cost abuse). Honest 429 + audit.
     * MUST run before any route handler — routing order is the firewall order. */
    const rlKeyIp = (req.socket?.remoteAddress ?? "unknown") + ":" + (req.headers["x-forwarded-for"] ?? "");
    const rateLimited = (bucket, key, limit, windowMs) => {
      const now = Date.now();
      const k = `${bucket}:${key}`;
      const arr = (_rateBuckets.get(k) ?? []).filter((t) => now - t < windowMs);
      if (arr.length >= limit) { _rateBuckets.set(k, arr); return true; }
      arr.push(now);
      _rateBuckets.set(k, arr);
      return false;
    };
    const AUTH_LIMITED = new Set(["/api/household/claim", "/api/signup", "/api/login", "/api/verify-email", "/api/password-reset/request", "/api/password-reset/verify-code", "/api/password-reset/complete", "/api/email-recovery/request"]);
    if ((path === "/api/session" && method === "POST") || AUTH_LIMITED.has(path)) {
      // Tunable so an operator can loosen it for a shared-NAT deployment (or a test suite
      // that legitimately signs up two dozen households in a row) without editing code.
      const authLimit = Math.max(5, parseInt(process.env.HOMEOPS_AUTH_RATE_LIMIT ?? "20", 10) || 20);
      if (rateLimited("auth", rlKeyIp, authLimit, 60_000)) {
        audit({ type: "rate.limited", route: path }, req);
        return json(res, 429, { error: "rate_limited", message: "Too many attempts — wait a minute and try again." }, req);
      }
    }
    if (path.startsWith("/api/assistant")) {
      const s0 = sessionFromReq(req);
      if (s0 && rateLimited("assistant", s0.actorId, 30, 60_000)) {
        audit({ type: "rate.limited", route: path, actorId: s0.actorId }, req);
        return json(res, 429, { error: "rate_limited", message: "That's a lot of messages at once — give it a minute." }, req);
      }
    }

    /* ---- Health (origin-allowed, no session; used to detect backend) ---- */
    if (path === "/api/health") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const browserCfg = getConnectorConfig("browser");
      const browserHealth = getHealth("browser");
      // WP-007 (DEC-014): surfaces which memory backend is actually answering (real
      // sidecar vs the local sqlite-FTS5 fallback) so Settings' runtime card can show
      // honest status instead of assuming the sidecar is up.
      const memHealth = await memoryProvider.health();
      return json(res, 200, {
        ok: true, version: VERSION, time: new Date().toISOString(), runtime: "node-http", node: process.version, env: IS_PROD ? "production" : "development",
        browserRuntime: !!(browserHealth && browserHealth.ok),
        memoryProvider: { ok: !!memHealth?.ok, degraded: !!memHealth?.degraded, backend: memHealth?.backend ?? memoryProvider.backend },
        externalActionsEnabled: externalActionsEnabled(CURRENT_TENANT),
        webhookBaseUrl: (process.env.HOMEOPS_PUBLIC_URL || `http://localhost:${PORT}`).split(",")[0].trim().replace(/\/$/, ""),
        authRequired: true,
      }, req);
    }

    /* ---- OAuth callback (top-level browser redirect from provider) ----
     * The session cookie is NOT available here (provider redirects straight to the
     * backend origin), so actor/household are carried in the server-persisted state. */
    if (path === "/api/oauth/callback" && method === "GET") {
      const code = url.searchParams.get("code"); const state = url.searchParams.get("state") || "";
      const st = takeOAuthState(state);
      // Mobile detection works even when the state record is gone: mobile starts
      // mint states shaped `<provider>.m.<nonce>` (see /api/oauth/:provider/start).
      const isMobileFlow = (st && st.from === "mobile") || /^[^.]+\.m\./.test(state);
      // ASWebAuthenticationSession intercepts any navigation to the app scheme, but a
      // bare 302 to a custom scheme is dropped by some iOS versions. Serve a tiny page
      // that navigates via JS immediately AND offers a tap-through link, so the user
      // is never stranded looking at a web page inside the auth browser.
      const finishMobile = (params) => {
        const deepLink = `familios://oauth-callback?${new URLSearchParams(params).toString()}`;
        const ok = params.ok === "1";
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#f4f0e9;color:#1f2535;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;max-width:28rem;padding:1rem"><div style="font-size:40px">${ok ? "✓" : "✕"}</div><h2>${ok ? `${escapeHtml(params.provider ?? "Account")} connected` : "Connection failed"}</h2><p style="color:#4a5568">${escapeHtml(params.message ?? (ok ? "Returning to FamiliOS…" : "Return to FamiliOS and try again."))}</p><p><a href="${deepLink}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#d26420;color:#fff;text-decoration:none;font-weight:600">Return to FamiliOS</a></p></div><script>location.replace(${JSON.stringify(deepLink)})</script></body>`);
      };
      if (!st || !code) {
        audit({ type: "oauth.callback", ok: false, error: "invalid_state" }, req);
        if (isMobileFlow) return finishMobile({ ok: "0", error: "expired", message: "This authorization expired. Please try connecting again." });
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(htmlMessage("Connection failed", "This authorization link is invalid or expired. Please start again from FamiliOS."));
      }
      const provider = connectorProviderById(st.provider);
      if (!provider) {
        if (isMobileFlow) return finishMobile({ ok: "0", error: "unknown_provider", message: "Unknown provider." });
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(htmlMessage("Connection failed", "Unknown provider."));
      }
      try {
        const ex = await exchangeCode(provider, { code, codeVerifier: st.codeVerifier, redirectUri: oauthRedirectUri() });
        if (!ex.ok) {
          audit({ type: "oauth.callback", provider: st.provider, ok: false, error: "token_exchange_failed" }, req);
          if (isMobileFlow) return finishMobile({ ok: "0", provider: provider.name, error: "exchange_failed", message: "The provider did not return an access token. Please try connecting again." });
          res.writeHead(200, { "content-type": "text/html" });
          return res.end(htmlMessage("Authorization error", "The provider did not return an access token. Please try connecting again."));
        }
        const acct = await upsertAccount({ provider: st.provider, householdId: st.householdId, actorId: st.actorId, tokens: ex.tokens });
        appendAudit({ type: "oauth.callback", provider: st.provider, ok: true, actorId: st.actorId, accountId: acct.id });
        // Mobile-initiated flows: hand control back to the app via the familios:// scheme.
        // Web flows: postMessage to the opener window.
        if (isMobileFlow) {
          return finishMobile({ ok: "1", provider: provider.name, displayName: acct.displayName ?? "" });
        }
        const target = st.appOrigin && isAllowedOrigin(st.appOrigin) ? st.appOrigin : APP_ORIGIN;
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#f4f0e9;color:#1f2535;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:40px">✓</div><h2>${escapeHtml(provider.name)} connected</h2><p style="color:#4a5568">Signed in as ${escapeHtml(acct.displayName)} — returning to FamiliOS…</p></div><script>try{window.opener&&window.opener.postMessage({type:"homeops-oauth",provider:${JSON.stringify(st.provider)},ok:true},${JSON.stringify(target)})}catch(e){}setTimeout(()=>window.close(),900)</script></body>`);
      } catch (e) {
        appendAudit({ type: "oauth.callback", provider: st.provider, ok: false, error: "exception" });
        if (isMobileFlow) return finishMobile({ ok: "0", provider: provider.name, error: "server_error", message: "Something went wrong completing the connection." });
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(htmlMessage("Connection failed", "Something went wrong completing the connection."));
      }
    }

    /* ---- Two-way SMS gateway (Twilio inbound; signature-gated, not session) ----
     * Family members text the household's Twilio number and the assistant answers
     * in the SAME thread (TwiML reply). Only VERIFIED + OPTED-IN Phone/Text contact
     * methods get a response — unknown senders receive empty TwiML (silence, so the
     * endpoint never confirms a number exists). Twilio signs every webhook with the
     * account auth token: configured token → signature required; no token → refused
     * in production (fail closed), accepted in dev for local testing. */
    if (path === "/api/webhooks/sms" && method === "POST") {
      const raw = await readRaw(req);
      const params = Object.fromEntries(new URLSearchParams(raw));
      const token = twilioAuthToken();
      const xml = (body) => { res.writeHead(200, { "content-type": "text/xml", ...corsHeaders(req) }); res.end(body); };
      if (token) {
        const base = (process.env.HOMEOPS_PUBLIC_URL || `http://localhost:${PORT}`).split(",")[0].trim().replace(/\/$/, "");
        if (!twilioSignatureValid({ url: `${base}/api/webhooks/sms`, params, authToken: token, signature: req.headers["x-twilio-signature"] })) {
          audit({ type: "sms.inbound", ok: false, error: "bad_signature" }, req);
          return json(res, 403, { ok: false, error: "signature_failed" }, req);
        }
      } else if (IS_PROD) {
        audit({ type: "sms.inbound", ok: false, error: "no_auth_token" }, req);
        return json(res, 403, { ok: false, error: "sms_not_configured" }, req);
      }
      const from = String(params.From ?? "");
      const smsBody = String(params.Body ?? "").trim();
      if (!from || !smsBody) { audit({ type: "sms.inbound", ok: false, error: "empty" }, req); return xml(twiml(null)); }
      const r = await handleInboundSms({ from, body: smsBody });
      if (r.unknownSender) {
        audit({ type: "sms.inbound", ok: false, error: "unknown_or_unverified_sender" }, req);
        return xml(twiml(null));
      }
      audit({ type: "sms.inbound", ok: true, actorId: r.actorId, conversationId: r.conversationId, kind: r.kind }, req);
      return xml(twiml(r.replyText));
    }

    // RevenueCat webhook (C1.5) — the ONLY writer of plan state. Fail closed:
    // without the shared secret configured, every delivery is refused. MUST sit
    // before the generic /api/webhooks/:id trigger receiver below.
    if (path === "/api/webhooks/revenuecat" && method === "POST") {
      const secret = process.env.HOMEOPS_RC_WEBHOOK_SECRET;
      if (!secret) return json(res, 503, { error: "webhook_not_configured", message: "Set HOMEOPS_RC_WEBHOOK_SECRET and configure the same value as the webhook's Authorization header in RevenueCat." }, req);
      const auth = req.headers.authorization ?? "";
      if (auth !== secret && auth !== `Bearer ${secret}`) {
        appendAudit({ type: "billing.webhook", ok: false, error: "unauthorized" });
        return json(res, 401, { error: "unauthorized" }, req);
      }
      const body = await readBody(req); if (!body?.event) return json(res, 400, { error: "malformed_json" }, req);
      const ev = body.event;
      const hh = String(ev.app_user_id ?? "");
      // Only real stranger households are billable app_user_ids; anything else is
      // acknowledged-and-ignored so RevenueCat doesn't retry forever.
      if (!/^hh_[a-z0-9]+$/.test(hh) || !tenantEngine().tenantIds().includes(hh)) {
        appendAudit({ type: "billing.webhook", ok: true, ignored: "unknown_household", eventType: ev.type });
        return json(res, 200, { ok: true, ignored: "unknown_household" }, req);
      }
      const entitlements = ev.entitlement_ids ?? (ev.entitlement_id ? [ev.entitlement_id] : []);
      const entitled = entitlements.includes("familios_plus");
      const expiresAt = ev.expiration_at_ms ?? null;
      const ACTIVATE = ["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "NON_RENEWING_PURCHASE", "SUBSCRIPTION_EXTENDED", "TRANSFER"];
      let applied = null;
      if (ACTIVATE.includes(ev.type) && entitled) applied = setPlanFromEntitlement(hh, { active: true, expiresAt });
      else if (ev.type === "BILLING_ISSUE") applied = setPlanFromEntitlement(hh, { active: true, expiresAt, graceUntil: ev.grace_period_expiration_at_ms ?? null });
      else if (ev.type === "EXPIRATION") applied = setPlanFromEntitlement(hh, { active: false, expiresAt });
      // CANCELLATION = auto-renew turned off; access runs to expiration — no change.
      await runWithTenant(hh, () => appendAudit({ type: "billing.webhook", ok: true, eventType: ev.type, applied: applied?.tier ?? "no_change" }));
      return json(res, 200, { ok: true, applied: applied?.tier ?? "no_change" }, req);
    }

    /* ---- Webhook receiver (external inbound; signature-gated, not session) ---- */
    const whMatch = path.match(/^\/api\/webhooks\/([^/]+)$/);
    if (whMatch && method === "POST") {
      const id = whMatch[1];
      const raw = await readRaw(req);
      let payload;
      try { payload = raw ? JSON.parse(raw) : {}; } catch { audit({ type: "webhook.received", connectorId: id, ok: false, error: "malformed_json" }, req); return json(res, 400, { ok: false, error: "malformed_json" }, req); }
      // A webhook TRIGGER (Slice 6) registered at this id uses its own signing secret;
      // otherwise fall back to the webhook connector's secret.
      const trig = getTrigger(id);
      const isTrigger = trig && trig.type === "webhook";
      const secret = (isTrigger ? getTriggerSecret(id) : null) ?? getSecret("webhook", "signingSecret");
      const sig = req.headers["x-homeops-signature"];
      const ts = req.headers["x-homeops-timestamp"];
      const nonce = req.headers["x-homeops-nonce"];
      let verified = false;
      if (secret) {
        const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
        const a = Buffer.from(String(sig ?? ""), "utf8"); const b = Buffer.from(expected, "utf8");
        verified = a.length === b.length && crypto.timingSafeEqual(a, b);
        if (!verified) { audit({ type: "webhook.received", connectorId: id, ok: false, error: "bad_signature" }, req); return json(res, 401, { ok: false, error: "signature_failed" }, req); }
        if (ts && Math.abs(Date.now() - Number(ts)) > 5 * 60_000) { audit({ type: "webhook.received", connectorId: id, ok: false, error: "stale_timestamp" }, req); return json(res, 401, { ok: false, error: "stale_timestamp" }, req); }
        if (nonce && seenWebhookNonce(nonce)) { audit({ type: "webhook.received", connectorId: id, ok: false, error: "replay" }, req); return json(res, 409, { ok: false, error: "replay_detected" }, req); }
      } else {
        // No signing secret configured. Production requires one; dev stores as unverified.
        if (IS_PROD) { audit({ type: "webhook.received", connectorId: id, ok: false, error: "unsigned_blocked" }, req); return json(res, 401, { ok: false, error: "signing_secret_required" }, req); }
        verified = false;
      }
      const evt = addWebhookEvent(id, { payload, source: req.headers["x-homeops-test"] ? "test" : "external", verified });
      audit({ type: "webhook.received", connectorId: id, ok: true, verified, trigger: isTrigger }, req);
      // If a webhook trigger is registered here, fire a real run (no session — the
      // trigger carries the household). Fire-and-forget; the run drives async.
      let firedRunId = null;
      if (isTrigger && trig.enabled) {
        const fired = await fireWebhookTrigger(id, payload).catch(() => null);
        firedRunId = fired?.runId ?? null;
      }
      return json(res, 200, { ok: true, event: evt, verified, runId: firedRunId }, req);
    }

    /* ---- Session (login / current / logout) ---- */
    if (path === "/api/session") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      if (method === "GET") {
        const g = gate(req, {});
        if (!g.ok || !g.session) return json(res, 200, { session: null }, req);
        const s = g.session;
        // isOperator is derived server-side from the deployment env + this session's own
        // registered email. The client can only ever READ it — it is not part of any body.
        return json(res, 200, { session: { actorId: s.actorId, actorName: s.actorName, role: s.role, csrf: s.csrf, householdId: s.householdId, isOperator: isOperator(s) } }, req);
      }
      if (method === "POST") {
        const body = await readBody(req);
        if (!body) return json(res, 400, { error: "malformed_json" }, req);
        const { actorId } = body;
        if (!actorId) return json(res, 400, { error: "actor_required" }, req);
        // WP-010 session-scoped picker entry into a signed-up (hh_*) household. When the
        // Lock screen remembered a household hint (client localStorage, id only — never a
        // secret), entry resolves the member from THAT household's roster instead of the
        // resident one. Two rules keep this from ever escalating privilege:
        //   1. A member who has an email+password identity (Owner, invited members) MUST
        //      authenticate via /api/login — passwordless picker entry is refused for them,
        //      so nobody enters a credentialed member's profile without their password.
        //   2. A member with NO identity (a child, or anyone an Owner added directly) enters
        //      under the SAME PIN rules as the resident household: elevated roles are
        //      PIN-gated (fail-closed in prod), low-trust roles (Child View, etc.) enter
        //      straight in — the shared family-device model, now reachable for a real family.
        // The hint must name a real, existing hh_* tenant; anything else falls through to the
        // unchanged resident path below.
        const sHintRaw = body.household;
        const sHint = (sHintRaw && /^hh_[a-z0-9]+$/.test(String(sHintRaw)) && tenantEngine().tenantIds().includes(String(sHintRaw))) ? String(sHintRaw) : null;
        if (sHint) {
          const hm = runWithTenant(sHint, () => getMember(actorId));
          if (!hm || hm.householdId !== sHint) { audit({ type: "session.login", ok: false, error: "unknown_actor", actorId, household: sHint }, req); return json(res, 403, { error: "unknown_actor", message: "This profile isn't part of that household." }, req); }
          if (hm.archived) { audit({ type: "session.login", ok: false, error: "member_archived", actorId, household: sHint }, req); return json(res, 403, { error: "member_archived", message: "This profile was removed from the household." }, req); }
          // A credentialed member (email+password identity) signs in with their password
          // via /api/login. For ELEVATED roles that is NOT the only authenticator: the
          // household Owner PIN checked just below is equally valid, and the resident
          // (non-hint) path already admits a credentialed Owner on the PIN alone. Hard-
          // refusing them only here left an Owner who forgot their signup password locked
          // out of their own household even while holding the PIN — an inconsistency
          // between the two sign-in paths, not a real security boundary. So: elevated
          // roles fall through to the Owner-PIN gate; NON-elevated credentialed members
          // (invited adults, who have no PIN gate of their own) still need their password.
          const hRole = hm.role;
          const isElevated = hRole === "Owner" || hRole === "Adult Admin";
          if (!isElevated && listIdentitiesForHousehold(sHint).some((i) => i.actorId === actorId)) {
            audit({ type: "session.login", ok: false, error: "password_required", actorId, household: sHint }, req);
            return json(res, 403, { error: "password_required", message: "This member signs in with their email and password." }, req);
          }
          const hName = hm.displayName ?? body.actorName ?? actorId;
          const hPinHash = getSettings(sHint).ownerPinHash; // that household's own PIN, never the resident's
          // Break-glass recovery: while HOMEOPS_BOOTSTRAP_PIN is set (operator-only env), it is
          // accepted as an ALTERNATIVE to the household's own PIN — even when one exists — so an
          // Owner locked out by a forgotten PIN or a lost email password can regain elevated entry,
          // reset a real PIN in Settings, then clear the env var. It is a STANDING override only
          // while the env is present; every break-glass use is audited. Remove after recovery.
          const bootHash = pinHashOfBootstrap();
          if (hRole === "Owner" || hRole === "Adult Admin") {
            if (!hPinHash && !bootHash && IS_PROD) {
              audit({ type: "session.login", ok: false, error: "pin_not_configured", actorId, household: sHint }, req);
              return json(res, 403, { error: "pin_not_configured", message: "Elevated sign-in is locked until this household sets an Owner PIN (or the deployment sets HOMEOPS_BOOTSTRAP_PIN)." }, req);
            }
            if (hPinHash || bootHash) {
              const given = crypto.createHash("sha256").update(String(body.pin ?? "")).digest("hex");
              const ownPinOk = hPinHash && given === hPinHash;
              const bootOk = bootHash && given === bootHash;
              if (!ownPinOk && !bootOk) { audit({ type: "session.login", ok: false, error: "bad_pin", actorId, household: sHint }, req); return json(res, 403, { error: "pin_required" }, req); }
              if (bootOk && !ownPinOk) audit({ type: "session.login.breakglass", actorId, household: sHint }, req);
            }
          }
          const hs = createSession({ actorId, actorName: hName, role: hRole, householdId: sHint });
          maybeSeedSandbox(hs);
          audit({ type: "session.login", ok: true, actorId, household: sHint }, req, hs);
          const hView = { actorId: hs.actorId, actorName: hs.actorName, role: hs.role, csrf: hs.csrf, householdId: hs.householdId };
          return json(res, 200, req.headers["x-homeops-bearer"] === "1" ? { session: hView, token: hs.token } : { session: hView }, req, { "set-cookie": sessionCookie(hs.token) });
        }
        // Authority is server-owned: the effective role is resolved from the household
        // member registry by actorId, NEVER from the client. A client may still send a
        // `role` (legacy/dev seed selector), but it is ignored for authorization — a
        // child posting role:"Owner" resolves to their real Child View role. Unknown
        // actors are rejected (no implicit account creation here).
        const member = getMember(actorId);
        if (!member) { audit({ type: "session.login", ok: false, error: "unknown_actor", actorId }, req); return json(res, 403, { error: "unknown_actor", message: "This profile isn't registered with the backend. Create your household (or ask an Owner to add you in Settings → Household)." }, req); }
        if (member.archived) { audit({ type: "session.login", ok: false, error: "member_archived", actorId }, req); return json(res, 403, { error: "member_archived", message: "This profile was removed from the household." }, req); }
        const role = member.role;
        const actorName = member.displayName ?? body.actorName ?? actorId;
        // Owner PIN gate for elevated roles (gated on the RESOLVED role). Dev keeps it
        // optional; PRODUCTION FAILS CLOSED — on a public deployment the seed actor ids
        // are public knowledge, so elevated sign-in with no PIN configured would hand
        // Owner to anyone who finds the URL. HOMEOPS_BOOTSTRAP_PIN (env) seeds the gate
        // before the first login; a PIN set later in Settings takes precedence.
        const pinHash = getSettings(CURRENT_TENANT).ownerPinHash; // login predates a session: resident household
        // Same break-glass as the hint path: HOMEOPS_BOOTSTRAP_PIN is an alternative to the
        // resident household's own PIN while set (seeds the gate before a first PIN exists AND
        // recovers a forgotten one). Break-glass uses are audited; clear the env after recovery.
        const bootHashR = pinHashOfBootstrap();
        if (role === "Owner" || role === "Adult Admin") {
          if (!pinHash && !bootHashR && IS_PROD) {
            audit({ type: "session.login", ok: false, error: "pin_not_configured", actorId }, req);
            return json(res, 403, { error: "pin_not_configured", message: "Elevated sign-in is locked until an Owner PIN exists. Set HOMEOPS_BOOTSTRAP_PIN in the deployment's environment, then sign in with it." }, req);
          }
          if (pinHash || bootHashR) {
            const given = crypto.createHash("sha256").update(String(body.pin ?? "")).digest("hex");
            const ownPinOk = pinHash && given === pinHash;
            const bootOk = bootHashR && given === bootHashR;
            if (!ownPinOk && !bootOk) { audit({ type: "session.login", ok: false, error: "bad_pin", actorId }, req); return json(res, 403, { error: "pin_required" }, req); }
            if (bootOk && !ownPinOk) audit({ type: "session.login.breakglass", actorId, household: CURRENT_TENANT }, req);
          }
        }
        const s = createSession({ actorId, actorName, role, householdId: member.householdId ?? "local" });
        maybeSeedSandbox(s);
        audit({ type: "session.login", ok: true, actorId }, req, s);
        const sessionView = { actorId: s.actorId, actorName: s.actorName, role: s.role, csrf: s.csrf, householdId: s.householdId };
        // Native/mobile clients can't use the httpOnly cookie — they ask for the bearer
        // token (stored in expo-secure-store). The web client omits this header and keeps
        // cookie-only auth, so its httpOnly posture is unchanged.
        const wantToken = req.headers["x-homeops-bearer"] === "1";
        return json(res, 200, wantToken ? { session: sessionView, token: s.token } : { session: sessionView }, req, { "set-cookie": sessionCookie(s.token) });
      }
      if (method === "DELETE") {
        const g = gate(req, {});
        if (!g.ok) return json(res, g.status, { error: g.error }, req);
        deleteSession(g.session.token);
        audit({ type: "session.logout", ok: true }, req, g.session);
        return json(res, 200, { ok: true }, req, { "set-cookie": clearSessionCookie() });
      }
    }

    /* ---- Profile picker (pre-auth) + one-time household claim ----
     * A family device must show who can sign in BEFORE anyone is signed in — same
     * information the lock screen displays. Origin-gated; no secrets (names/roles only). */
    const VALID_ROLES = ["Owner", "Adult Admin", "Adult Member", "Limited Member", "Child View", "Guest/Helper"];
    const SEED_ACTOR_IDS = ["m-alex", "m-morgan", "m-lily", "m-noah", "m-elaine", "m-sam"];
    // Contact-method vocabulary (mirrors the web ContactMethod type). In-App and
    // Family Dashboard aren't external addresses — their value is a fixed channel tag.
    const CONTACT_METHOD_TYPES = ["Email", "Phone/Text", "In-App", "Family Dashboard"];
    const CONTACT_FIXED_VALUES = { "In-App": "in-app", "Family Dashboard": "dashboard" };
    const OPT_IN_STATES = ["Opted In", "Pending", "Not Set"];
    const validContactValue = (type, value) =>
      type === "Email" ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      : type === "Phone/Text" ? String(value).replace(/\D/g, "").length >= 7
      : true;
    if (path === "/api/profiles" && method === "GET") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      // WP-010 session-scoped picker (ISS-012): a returning member's browser remembers
      // the household it last signed into and asks for THAT household's roster via a
      // `?household=hh_...` hint, so the Lock screen offers the family's own members
      // after sign-out instead of the resident household's. The hint must name a real,
      // existing signed-up (hh_*) tenant; anything else falls back to the resident
      // household — the unchanged fresh-browser behavior. The hint is only an id (never
      // a secret); it grants the picker roster, not a session (entry still needs the
      // member's PIN/password, see /api/session).
      const pHintRaw = url.searchParams.get("household");
      const pHint = (pHintRaw && /^hh_[a-z0-9]+$/.test(pHintRaw) && tenantEngine().tenantIds().includes(pHintRaw)) ? pHintRaw : null;
      const pTarget = pHint ?? CURRENT_TENANT;
      // Pre-auth privacy (ISS-015): `hideProfilesPreAuth` hides a household's roster from
      // anyone who lacks a session for it. It is a per-household setting, plus a deployment
      // env override that covers the RESIDENT household on a shared/public deployment.
      // Default OFF everywhere — the resident picker (ISS-009: names+roles+pinRequired the
      // Lock screen needs) is preserved verbatim until an Owner opts their family out.
      const pFlagOn = getSettings(pTarget).hideProfilesPreAuth === true
        || (pTarget === CURRENT_TENANT && /^(1|true|yes|on)$/i.test(String(process.env.HOMEOPS_HIDE_PROFILES_PREAUTH ?? "")));
      const pSess = sessionFromReq(req);
      if (pFlagOn && !(pSess && pSess.householdId === pTarget)) {
        audit({ type: "profiles.hidden", household: pTarget }, req);
        return json(res, 200, { profiles: [], hidden: true, claimed: false, householdName: null }, req);
      }
      // Pre-auth exposure: this endpoint answers BEFORE any session exists, so it carries
      // the minimum the Lock screen needs — actorId, displayName, role, pinRequired.
      // Relationship strings (which include child ages, e.g. "Child (age 9)", and caregiver
      // details) are deliberately excluded; they are available post-auth via /api/members.
      const pSettings = getSettings(pTarget);
      const pPinSet = !!(pSettings.ownerPinHash || (pTarget === CURRENT_TENANT && process.env.HOMEOPS_BOOTSTRAP_PIN));
      const rosterOf = () => listMembers({ householdId: pTarget }).filter((m) => !m.archived).map((m) => ({
        actorId: m.actorId, displayName: m.displayName, role: m.role,
        pinRequired: pPinSet && (m.role === "Owner" || m.role === "Adult Admin"),
        // The Lock screen showed flat, identical letter tiles. From the owner walkthrough:
        // "the individual profiles do not reuse the profile images for the actual profiles
        // inside the app — I actually would like them to, and it makes sense that they
        // should", and "these are not colored properly to match what's inside of the
        // application and they need to be."
        //
        // `color` is a display accent, not PII. `photoFileId` is an opaque id — the bytes
        // are served by /api/profiles/:actorId/avatar below, behind the SAME
        // hideProfilesPreAuth gate that already governs whether this roster is visible at
        // all, so a family that opts out of a public roster stays fully opted out.
        color: m.color ?? null,
        photoFileId: m.photoFileId ?? null,
      }));
      const profiles = pHint ? runWithTenant(pHint, rosterOf) : rosterOf();
      return json(res, 200, {
        profiles,
        claimed: profiles.some((p) => !SEED_ACTOR_IDS.includes(p.actorId)),
        householdName: pSettings.householdName ?? null,
      }, req);
    }
    /* ---- Pre-auth profile avatar (Lock screen) --------------------------------------
     * Serves ONLY the photo of a member who already appears in the pre-auth roster above,
     * for the SAME household, behind the SAME hideProfilesPreAuth gate. Nothing new is
     * disclosed: if the roster is public this face is already named on that screen, and if
     * a family hid the roster this 404s with it.
     *
     * Deliberately narrow: it resolves the member's OWN photoFileId and refuses any other
     * id, so it can never become a general unauthenticated file reader. */
    const preAuthAvatar = path.match(/^\/api\/profiles\/([^/]+)\/avatar$/);
    if (preAuthAvatar && method === "GET") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const aHintRaw = url.searchParams.get("household");
      const aHint = (aHintRaw && /^hh_[a-z0-9]+$/.test(aHintRaw) && tenantEngine().tenantIds().includes(aHintRaw)) ? aHintRaw : null;
      const aTarget = aHint ?? CURRENT_TENANT;
      const aFlagOn = getSettings(aTarget).hideProfilesPreAuth === true
        || (aTarget === CURRENT_TENANT && /^(1|true|yes|on)$/i.test(String(process.env.HOMEOPS_HIDE_PROFILES_PREAUTH ?? "")));
      const aSess = sessionFromReq(req);
      if (aFlagOn && !(aSess && aSess.householdId === aTarget)) return json(res, 404, { error: "not_found" }, req);
      const readAvatar = () => {
        const m = listMembers({ householdId: aTarget }).find((x) => x.actorId === preAuthAvatar[1] && !x.archived);
        const pid = m?.photoFileId ?? null;
        // "emoji:" avatars carry no blob — the client renders the glyph itself.
        if (!pid || pid.startsWith("emoji:")) return null;
        const f = getFileRec(pid);
        if (!f || f.householdId !== aTarget) return null;
        const blobIds = Array.isArray(f.pageBlobIds) && f.pageBlobIds.length ? f.pageBlobIds : [f.id];
        const buf = readFileBlob(blobIds[0]);
        return buf ? { buf, mime: f.mime ?? "image/jpeg" } : null;
      };
      const out = aHint ? runWithTenant(aHint, readAvatar) : readAvatar();
      if (!out) return json(res, 404, { error: "not_found" }, req);
      res.writeHead(200, { "content-type": out.mime, "cache-control": "private, max-age=300", ...corsHeaders(req) });
      return res.end(out.buf);
    }
    // Claim the household: replace the demo Harper roster with YOUR owner profile.
    // Unauthenticated by necessity (a new household has nobody to sign in as), but
    // origin-gated and one-time: it only works while every non-archived member is
    // still the demo seed. After the claim, membership changes require an Owner.
    if (path === "/api/household/claim" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const ownerName = String(body.ownerName ?? "").trim();
      if (!ownerName) return json(res, 400, { error: "owner_name_required" }, req);
      const actorId = String(body.actorId ?? "m-owner").trim();
      if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(actorId)) return json(res, 400, { error: "bad_actor_id" }, req);
      const live = listMembers({ householdId: "local" }).filter((m) => !m.archived);
      if (live.some((m) => !SEED_ACTOR_IDS.includes(m.actorId))) {
        audit({ type: "household.claim", ok: false, error: "already_claimed" }, req);
        return json(res, 409, { error: "already_claimed", message: "This household already has its own members. Sign in as an Owner to manage them." }, req);
      }
      // Archive the demo roster (kept on disk so the boot seed can't resurrect it),
      // then register the real owner.
      for (const m of live) putMember({ actorId: m.actorId, archived: true });
      const owner = putMember({ actorId, displayName: ownerName, role: "Owner", relationship: body.relationship ?? "Account owner", householdId: "local" });
      const claimedName = String(body.householdName ?? "").trim();
      if (claimedName) setSettings({ householdName: claimedName.slice(0, 60) }, CURRENT_TENANT);
      const s = createSession({ actorId, actorName: ownerName, role: "Owner", householdId: "local" });
      maybeSeedSandbox(s);
      audit({ type: "household.claim", ok: true, actorId, archivedDemo: live.length }, req, s);
      const sessionView = { actorId: s.actorId, actorName: s.actorName, role: s.role, csrf: s.csrf, householdId: s.householdId };
      const wantToken = req.headers["x-homeops-bearer"] === "1";
      return json(res, 200, {
        member: { actorId: owner.actorId, displayName: owner.displayName, role: owner.role },
        session: sessionView, ...(wantToken ? { token: s.token } : {}),
      }, req, { "set-cookie": sessionCookie(s.token) });
    }

    /* ---- Self-serve identity (C1.4): stranger households ----
     * Email+password accounts create and sign into their OWN household — a
     * fresh tenant database, physically separate from every other family's.
     * The resident household's profile-picker + PIN flow is untouched. */
    if (path === "/api/signup" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const email = String(body.email ?? "").trim().toLowerCase();
      const ownerName = String(body.ownerName ?? "").trim();
      if (!validEmail(email)) return json(res, 400, { error: "invalid_email" }, req);
      if (!validPassword(body.password)) return json(res, 400, { error: "weak_password", message: "Use at least 8 characters." }, req);
      if (!ownerName) return json(res, 400, { error: "owner_name_required" }, req);
      // Invite redemption: join the inviter's EXISTING household with the
      // invited role instead of creating a new one. Consume-once; never Owner.
      let householdId, actorId, role, relationship;
      const invite = body.inviteToken ? getInvite(body.inviteToken) : null;
      if (body.inviteToken && !invite) return json(res, 400, { error: "invalid_invite", message: "That invite code is invalid, used, or expired — ask for a new one." }, req);
      // D3 [02:12] — "the household name should be REQUIRED." It was optional, and the
      // fallback ("Ross's household") is the name the family then lived with everywhere the
      // household is named. Enforced here as well as in the form, because the form is not
      // the only caller. D4: the invite code stays optional — someone JOINING a household
      // isn't naming it, so the requirement applies only to creating one.
      if (!invite && !String(body.householdName ?? "").trim()) {
        return json(res, 400, { error: "household_name_required", message: "Give your household a name — it's what the family sees everywhere." }, req);
      }
      if (invite) {
        householdId = invite.householdId; actorId = "m-" + crypto.randomBytes(4).toString("hex");
        role = invite.role; relationship = "Invited member";
      } else {
        householdId = "hh_" + crypto.randomBytes(6).toString("hex"); actorId = "m-owner";
        role = "Owner"; relationship = "Account owner";
      }
      const made = createIdentity({ email, password: body.password, householdId, actorId, displayName: ownerName });
      if (made.error) return json(res, 409, { error: "email_taken", message: "An account with this email already exists — sign in instead." }, req);
      if (invite) consumeInvite(invite.token);
      await runWithTenant(householdId, () => {
        putMember({ actorId, displayName: ownerName, role, relationship, householdId });
        if (!invite) setSettings({ householdName: String(body.householdName).trim().slice(0, 60), householdCreatedAt: Date.now() }, householdId);
        appendAudit({ type: invite ? "household.join" : "household.signup", email, actorId, role });
      });
      const s = createSession({ actorId, actorName: ownerName, role, householdId });
      maybeSeedSandbox(s);
      const sessionView = { actorId: s.actorId, actorName: s.actorName, role: s.role, csrf: s.csrf, householdId: s.householdId };
      const wantToken = req.headers["x-homeops-bearer"] === "1";
      // Honest verification status: sending needs an email channel this fresh
      // household hasn't connected yet. The token exists; verification is
      // non-blocking until C2 compliance work wires a real sender.
      return json(res, 200, {
        session: sessionView, household: { id: householdId }, ...(wantToken ? { token: s.token } : {}),
        emailVerification: { sent: false, required: false, reason: "no_email_channel_yet" },
      }, req, { "set-cookie": sessionCookie(s.token) });
    }
    if (path === "/api/login" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const idn = verifyCredentials(body.email, body.password);
      if (!idn) { audit({ type: "identity.login", ok: false }, req); return json(res, 401, { error: "invalid_credentials" }, req); }
      const member = await runWithTenant(idn.householdId, () => getMember(idn.actorId));
      if (!member || member.archived) return json(res, 403, { error: "member_archived", message: "This account's household profile was removed." }, req);
      const s = createSession({ actorId: idn.actorId, actorName: member.displayName ?? idn.displayName, role: member.role, householdId: idn.householdId });
      maybeSeedSandbox(s);
      await runWithTenant(idn.householdId, () => appendAudit({ type: "identity.login", ok: true, actorId: idn.actorId }));
      const sessionView = { actorId: s.actorId, actorName: s.actorName, role: s.role, csrf: s.csrf, householdId: s.householdId };
      const wantToken = req.headers["x-homeops-bearer"] === "1";
      return json(res, 200, { session: sessionView, ...(wantToken ? { token: s.token } : {}) }, req, { "set-cookie": sessionCookie(s.token) });
    }
    if (path === "/api/verify-email" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const idn = consumeVerifyToken(String(body.token ?? ""));
      if (!idn) return json(res, 400, { error: "invalid_token" }, req);
      return json(res, 200, { ok: true, email: idn.email, verified: true }, req);
    }
    // D1 [01:32] — "Forgot password: it should send an email with a recovery code." The code
    // is now actually SENT (notify.mjs sendRecoveryCode, through the account's own household
    // Google connection — the only email transport this deployment has).
    //
    // The response is deliberately identical whether or not the account exists, and whether
    // or not the send succeeded. Anything else is account enumeration: "no email transport
    // configured for that household" tells an attacker the household is real. Failures are
    // recorded in the audit log instead, which is where an operator can see them.
    if (path === "/api/password-reset/request" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const email = String(body.email ?? "").trim();
      const idn = beginPasswordReset(email);
      if (idn?.resetCode) {
        // Fire-and-forget: the response must not vary with delivery timing either.
        void runWithTenant(idn.householdId, () => sendRecoveryCode({
          householdId: idn.householdId, actorId: idn.actorId, email: idn.email ?? email,
          code: idn.resetCode, kind: "password",
        })).catch(() => {});
      }
      return json(res, 200, { ok: true, message: "If that email has an account, a recovery code is on its way. It expires in 15 minutes." }, req);
    }
    // Exchange the 6-digit code for the one-time token the completion step wants. Separate
    // from /complete so the app can confirm the code BEFORE asking for a new password —
    // typing a password twice only to be told the code was wrong is a bad way to find out.
    if (path === "/api/password-reset/verify-code" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const found = findByResetCode(String(body.email ?? ""), String(body.code ?? ""));
      if (found.error) {
        return json(res, 400, {
          error: found.error,
          message: found.error === "too_many_attempts"
            ? "Too many tries with that code. Request a new one."
            : "That code isn't right, or it's expired. Check the email or request a new code.",
          ...(found.attemptsLeft != null ? { attemptsLeft: found.attemptsLeft } : {}),
        }, req);
      }
      return json(res, 200, { ok: true, token: found.identity.resetToken }, req);
    }
    // D2 [01:46] — "forgot email, or forgot username." The answer is emailed TO the account,
    // never returned in the response: a caller who controls that inbox learns their own
    // address (the point), and a caller who doesn't learns nothing. Proof of belonging is the
    // household's own join code, which a family has from another member.
    if (path === "/api/email-recovery/request" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const inv = getInvite(String(body.inviteCode ?? "").trim());
      if (inv?.householdId) {
        const idn = findIdentityForRecovery({ householdId: inv.householdId, displayName: String(body.displayName ?? "") });
        if (idn) {
          void runWithTenant(idn.householdId, () => sendRecoveryCode({
            householdId: idn.householdId, actorId: idn.actorId, email: idn.email, code: null, kind: "email",
          })).catch(() => {});
        }
      }
      return json(res, 200, { ok: true, message: "If that matches an account, we've emailed the address to itself." }, req);
    }
    if (path === "/api/password-reset/complete" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!validPassword(body.password)) return json(res, 400, { error: "weak_password", message: "Use at least 8 characters." }, req);
      const idn = completePasswordReset(String(body.token ?? ""), body.password);
      if (!idn) return json(res, 400, { error: "invalid_or_expired_token" }, req);
      deleteSessionsForActor(idn.actorId, idn.householdId); // every device re-authenticates
      return json(res, 200, { ok: true }, req);
    }
    /* ---- Plan & billing (C1.5) ---- */
    if (path === "/api/plan" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { plan: getPlan(g.session.householdId) }, req);
    }

    /* ---- The Adult Member silo -------------------------------------------------------------
 *
 * An Adult Member is a grown-up in the household who is NOT one of its administrators —
 * a partner, an adult child living at home, a live-in parent. Until now they were treated
 * as a spectator: they could read the family calendar and add a task, and that was it.
 * Asked for directly: they need their own connected accounts, their own calendars, their own
 * tasks, and their own assistant — "a standalone silo for each individual adult member".
 *
 * The shape of that silo, and the reason for each half:
 *
 *   PRIVATE OUTWARD. Their chats and helpers are theirs. A personal chat is already
 *   invisible to everyone else; what's added here is that an Adult Member can only ever
 *   CREATE personal ones, so a private thought can't be published into the family space by
 *   picking the wrong toggle. Their helpers are personal too, so nothing they build starts
 *   running on the household's behalf.
 *
 *   INFORMED INWARD. The silo is about authorship, not ignorance. Their assistant still sees
 *   the whole household — the calendar, the tasks, who's who, the meal plan, and now the
 *   family chats — because an assistant that can't see Thursday is useless to the person
 *   asking about Thursday. It reads all of it and writes none of it.
 *
 * The asymmetry is the whole design: full read of the household, writes confined to their own
 * things. Owner and Adult Admin are unchanged and keep every household-level power.
 */
function isAdultMemberOnly(session) {
  return session?.role === "Adult Member";
}
/** May this session create or change THIS agent? Admins: any. Adult Member: only their own,
 *  and only while it stays personal. Anyone else: no. */
function mayWriteAgent(session, agent, nextVisibility) {
  if (roleAtLeast(session?.role, "Adult Admin")) return { ok: true };
  if (!isAdultMemberOnly(session)) return { ok: false, error: "insufficient_role" };
  const vis = nextVisibility ?? agent?.visibility ?? "household";
  if (vis !== "personal") {
    return { ok: false, error: "personal_only", message: "You can create helpers for yourself. A helper that runs for the whole household needs an Owner or Adult Admin." };
  }
  if (agent && agent.createdBy && agent.createdBy !== session.actorId) {
    return { ok: false, error: "forbidden", message: "That helper belongs to someone else." };
  }
  if (agent && agent.system) return { ok: false, error: "forbidden" };
  return { ok: true };
}

/* ---- D5: operator-only, cross-household invite minting ----
     * 404 (not 403) when the deployment has no operator configured, so the surface does not
     * even announce itself on an install that has it switched off. */
    if (path === "/api/admin/households" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!isOperator(g.session)) return json(res, 404, { error: "not_found" }, req);
      const rows = [];
      for (const id of tenantEngine().tenantIds()) {
        if (!/^hh_[a-z0-9]+$/.test(id)) continue;   // skip "local" and "_system"
        const info = runWithTenant(id, () => {
          const members = listMembers(() => true);
          return { name: getSettings(id).householdName ?? null, memberCount: members.length, createdAt: getSettings(id).householdCreatedAt ?? null };
        });
        rows.push({ id, ...info });
      }
      rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      audit({ type: "admin.households_listed", count: rows.length, ok: true }, req, g.session);
      return json(res, 200, { households: rows }, req);
    }
    if (path === "/api/admin/invites" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!isOperator(g.session)) return json(res, 404, { error: "not_found" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const householdId = String(body.householdId ?? "").trim();
      if (!/^hh_[a-z0-9]+$/.test(householdId) || !tenantEngine().tenantIds().includes(householdId)) {
        return json(res, 400, { error: "unknown_household" }, req);
      }
      // Owner is still not grantable by invite — the operator can seat anyone in a household,
      // but not hand out its ownership. That stays with whoever created it.
      const role = INVITABLE_ROLES.includes(body.role) ? body.role : "Adult Member";
      const made = createInvite({
        householdId,
        householdName: runWithTenant(householdId, () => getSettings(householdId).householdName ?? null),
        displayName: String(body.displayName ?? "").trim() || "Invited member",
        role,
        invitedBy: g.session.actorId,
      });
      if (made.error) return json(res, 400, { error: made.error }, req);
      audit({ type: "admin.invite_created", householdId, role, ok: true }, req, g.session);
      return json(res, 200, made, req);   // createInvite already returns { invite }
    }

    /* ---- Nests: a small group inside the household ----
     * "There should be some way to associate two profiles… send an invite to create a nest…
     * and the other person would approve — you can either join or decline… and be able to
     * leave that nest at any point." Membership is consented both ways, and leaving never
     * deletes what was made inside. */
    if (path === "/api/nests" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const roster = new Map(listMembers((m) => m.householdId === g.session.householdId).map((m) => [m.actorId, m.displayName]));
      // Only what concerns THIS person: the nests they are in, and the invitations waiting on
      // them. A nest they were never asked to join is none of their business.
      const mine = nestsFor(g.session.householdId, g.session.actorId);
      const invites = nestInvitesFor(g.session.householdId, g.session.actorId);
      return json(res, 200, {
        nests: mine.map((n) => publicNest(n, roster, g.session.actorId)),
        invitations: invites.map((n) => publicNest(n, roster, g.session.actorId)),
      }, req);
    }
    if (path === "/api/nests" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Any adult may form one. It grants no authority over anyone — it is a shared room.
      if (!isAdultRole(g.session.role)) return json(res, 403, { error: "insufficient_role", message: "Adults can create a nest." }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const out = createNest({
        householdId: g.session.householdId, actorId: g.session.actorId,
        name: body.name, inviteActorIds: Array.isArray(body.inviteActorIds) ? body.inviteActorIds : [],
      });
      if (out.error) return json(res, 400, { error: out.error, ...(out.message ? { message: out.message } : {}) }, req);
      const roster = new Map(listMembers((m) => m.householdId === g.session.householdId).map((m) => [m.actorId, m.displayName]));
      // Tell the people invited — an invitation nobody sees is not an invitation.
      for (const m of out.nest.members.filter((x) => x.status === "invited")) {
        addNotification({
          householdId: g.session.householdId, actorId: m.actorId, channel: "in_app",
          title: `${roster.get(g.session.actorId) ?? "Someone"} invited you to a nest`,
          body: `${nestLabel(out.nest, roster)} — a shared space just for the two of you. Join or decline in Settings.`,
          to: null,
        });
        void pushToMember({
          householdId: g.session.householdId, actorId: m.actorId,
          title: "You've been invited to a nest",
          body: `${roster.get(g.session.actorId) ?? "Someone"} wants to share a space with you.`,
          data: { type: "nest", id: out.nest.id },
        }).catch(() => {});
      }
      audit({ type: "nest.create", nestId: out.nest.id, ok: true }, req, g.session);
      return json(res, 200, { nest: publicNest(out.nest, roster, g.session.actorId) }, req);
    }
    const nestAction = path.match(/^\/api\/nests\/([^/]+)\/(accept|decline|leave|invite)$/);
    if (nestAction && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const [, nestId, action] = nestAction;
      const roster = new Map(listMembers((m) => m.householdId === g.session.householdId).map((m) => [m.actorId, m.displayName]));
      let out;
      if (action === "accept" || action === "decline") {
        out = respondToNest({ nestId, householdId: g.session.householdId, actorId: g.session.actorId, accept: action === "accept" });
      } else if (action === "leave") {
        out = leaveNest({ nestId, householdId: g.session.householdId, actorId: g.session.actorId });
      } else {
        const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
        out = inviteToNest({ nestId, householdId: g.session.householdId, actorId: g.session.actorId, inviteActorIds: Array.isArray(body.inviteActorIds) ? body.inviteActorIds : [] });
      }
      if (out.error) {
        const code = out.error === "not_found" ? 404 : out.error === "forbidden" ? 403 : 400;
        return json(res, code, { error: out.error, ...(out.message ? { message: out.message } : {}) }, req);
      }
      audit({ type: `nest.${action}`, nestId, ok: true }, req, g.session);
      return json(res, 200, { nest: publicNest(out.nest, roster, g.session.actorId), ...(out.archived ? { archived: true } : {}) }, req);
    }

    /* ---- Household invites: join codes for existing households ---- */
    if (path === "/api/invites" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const made = createInvite({
        householdId: g.session.householdId, householdName: getSettings(g.session.householdId).householdName ?? null,
        displayName: body.displayName, role: body.role ?? "Adult Member", invitedBy: g.session.actorId,
      });
      if (made.error) return json(res, 400, { error: made.error }, req);
      audit({ type: "invite.created", role: made.invite.role, ok: true }, req, g.session);
      return json(res, 200, { invite: made.invite }, req);
    }
    if (path === "/api/invites" && method === "GET") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { invites: listInvites(g.session.householdId) }, req);
    }
    const invOne = path.match(/^\/api\/invites\/([a-z0-9]+)$/);
    if (invOne && method === "DELETE") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const had = revokeInvite(invOne[1], g.session.householdId);
      return json(res, had ? 200 : 404, had ? { ok: true } : { error: "not_found" }, req);
    }
    // Pre-auth preview so the signup screen can show what's being joined.
    const invPreview = path.match(/^\/api\/invites\/([a-z0-9]+)\/preview$/);
    if (invPreview && method === "GET") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const inv = getInvite(invPreview[1]);
      if (!inv) return json(res, 404, { error: "invalid_invite" }, req);
      return json(res, 200, { invite: { householdName: inv.householdName, displayName: inv.displayName, role: inv.role } }, req);
    }

    /* Apple 5.1.1(v) account deletion. An Owner deletes the WHOLE household —
     * physically: the tenant database directory is removed. A non-owner member
     * deletes their own identity and is archived from the roster. Requires the
     * account password again; the resident family household (PIN model, no
     * identity) can never be deleted through this route. */
    if (path === "/api/account" && method === "DELETE") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const idn = listIdentitiesForHousehold(g.session.householdId).find((i) => i.actorId === g.session.actorId);
      if (!idn) return json(res, 400, { error: "not_identity_account", message: "This profile signs in without an email account — remove members from Settings instead." }, req);
      if (!verifyCredentials(idn.email, body.password)) {
        audit({ type: "account.delete", ok: false, error: "bad_password" }, req, g.session);
        return json(res, 403, { error: "password_incorrect" }, req);
      }
      if (g.session.role === "Owner") {
        const hh = g.session.householdId;
        appendAudit({ type: "account.delete", scope: "household", by: g.session.actorId }); // last entry in the household's own log
        deleteIdentitiesForHousehold(hh);
        deleteSessionsForHousehold(hh);
        // Durable tombstone in the system registry (the household's own audit goes down with it).
        const gone = sysDoc("deleted_households.json", []);
        gone.push({ householdId: hh, at: new Date().toISOString(), by: g.session.actorId, email: idn.email });
        putSysDoc("deleted_households.json", gone);
        tenantEngine().deleteTenant(hh);
        return json(res, 200, { ok: true, deleted: "household" }, req, { "set-cookie": clearSessionCookie() });
      }
      putMember({ actorId: g.session.actorId, archived: true, householdId: g.session.householdId });
      deleteIdentity(idn.email);
      deleteSessionsForActor(g.session.actorId, g.session.householdId);
      audit({ type: "account.delete", scope: "member", ok: true }, req, g.session);
      return json(res, 200, { ok: true, deleted: "account" }, req, { "set-cookie": clearSessionCookie() });
    }

    /* ---- Backups & store health (Owner-only; the family's safety net) ---- */
    if (path === "/api/backups" && method === "GET") {
      const g = gate(req, { requireSession: true, minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { backups: listBackups(), quarantined: quarantinedCollections() }, req);
    }
    if (path === "/api/backups/run" && method === "POST") {
      const g = gate(req, { minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const name = createBackup();
      return json(res, 200, { ok: true, name }, req);
    }
    const backupOne = path.match(/^\/api\/backups\/([^/]+)$/);
    if (backupOne && backupOne[1] !== "run" && backupOne[1] !== "restore" && method === "GET") {
      const g = gate(req, { requireSession: true, minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const raw = readBackup(backupOne[1]);
      if (!raw) return json(res, 404, { error: "not_found" }, req);
      res.writeHead(200, { "content-type": "application/gzip", "content-disposition": `attachment; filename="${backupOne[1]}"`, ...corsHeaders(req) });
      return res.end(raw);
    }
    if (path === "/api/backups/restore" && method === "POST") {
      const g = gate(req, { minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body?.name) return json(res, 400, { error: "name_required" }, req);
      const out = restoreBackup(String(body.name));
      return json(res, out.ok ? 200 : 422, out, req);
    }
    /* Declutter / fresh start (Owner-only, backup-first). Bulk-clears the assistant's
     * OPERATIONAL history — improvements, memory, chat/inbox, notifications, help
     * requests, approvals, run history, and generated artifacts/reports — and removes
     * explicitly-named duplicate agents + orphaned skills. NEVER touches identity/config/assets: members, settings,
     * accounts, connectors, calendar, tasks/lists, files, knowledge/recipes, or any agent/
     * skill not named in the request. A fresh backup is taken FIRST and its name returned,
     * so the whole operation is reversible via /api/backups/restore. Requires confirm:"RESET". */
    if (path === "/api/household/reset-assistant" && method === "POST") {
      const g = gate(req, { minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (body.confirm !== "RESET") return json(res, 400, { error: "confirm_required", message: "Pass confirm:\"RESET\" — this bulk-clears the assistant's operational data (a backup is taken first)." }, req);
      const backup = createBackup(); // backup-first, ALWAYS
      const CLEAR = ["evolution.json", "memory.json", "conversations.json", "notifications.json", "help-requests.json", "approvals.json", "runs.json", "artifacts.json"];
      const cleared = {};
      for (const file of CLEAR) { const r = clearCollection(file); cleared[file] = r.ok ? r.cleared : (r.error || "err"); }
      const deletedAgents = [], deletedSkills = [], skippedAgents = [], skippedSkills = [];
      for (const id of (Array.isArray(body.deleteAgentIds) ? body.deleteAgentIds : [])) { const r = deleteAgent(String(id)); if (r?.ok) deletedAgents.push(id); else skippedAgents.push({ id, error: r?.error || "err" }); }
      for (const id of (Array.isArray(body.deleteSkillIds) ? body.deleteSkillIds : [])) { const r = deleteSkill(String(id)); if (r?.ok) deletedSkills.push(id); else skippedSkills.push({ id, error: r?.error || "err" }); }
      audit({ type: "household.reset_assistant", backup, clearedCounts: cleared, deletedAgents, deletedSkills, ok: true }, req, g.session);
      return json(res, 200, { ok: true, backup, cleared, deletedAgents, deletedSkills, skippedAgents, skippedSkills }, req);
    }
    if (path === "/api/store/quarantine/ack" && method === "POST") {
      const g = gate(req, { minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body?.file) return json(res, 400, { error: "file_required" }, req);
      const ok = acknowledgeQuarantine(String(body.file));
      audit({ type: "store.quarantine_ack", file: body.file, ok }, req, g.session);
      return json(res, 200, { ok }, req);
    }

    // Data revision — one tiny number that changes whenever household data does.
    // Clients poll this (cheap) and refetch screens only on change, which keeps
    // web and iOS in sync within seconds without websocket plumbing. rev is now
    // per-household (WP-009 / HYP-006) — see the comment on _dataRevByTenant in
    // store.mjs for why a global counter made this short-circuit ineffective.
    if (path === "/api/rev" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { rev: getDataRev() }, req);
    }

    // WP-009 (ISS-010/HYP-006): push channel for the rev signal above. Clients
    // that keep a fast poll of /api/rev to stay within a few seconds of fresh
    // blow the "idle app makes almost no requests" budget (PRD §14); a long-
    // lived SSE connection gives sub-second freshness for the cost of ONE
    // request instead of one every few seconds. Polling /api/rev remains the
    // documented fallback for clients that don't/can't hold an SSE connection
    // (see src/store/useStore.ts) — this endpoint is advisory, not the only path.
    if (path === "/api/changes" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const tenantId = g.session.householdId;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no", ...corsHeaders(req) });
      const send = (rev) => { try { res.write(`data: ${JSON.stringify({ rev })}\n\n`); } catch { /* client gone */ } };
      const onBump = ({ tenant, rev }) => { if (tenant === tenantId) send(rev); };
      revEmitter.on("bump", onBump);
      const hb = setInterval(() => { try { res.write(":keepalive\n\n"); } catch { /* ignore */ } }, 20000);
      const cleanup = () => { clearInterval(hb); revEmitter.off("bump", onBump); };
      req.on("close", cleanup);
      send(getDataRevForTenant(tenantId)); // initial snapshot so the client has a baseline immediately
      return; // hold the connection open
    }

    /* ---- Household identity: the name shows on the lock screen, briefings,
     * and invites. Any member can read it; renaming is Owner-only. ---- */
    if (path === "/api/household" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { household: { id: g.session.householdId, name: getSettings(g.session.householdId).householdName ?? null } }, req);
    }
    if (path === "/api/household" && method === "PATCH") {
      const g = gate(req, { minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const name = String(body.name ?? "").trim();
      if (!name) return json(res, 400, { error: "name_required" }, req);
      if (name.length > 60) return json(res, 400, { error: "name_too_long", message: "Keep the household name under 60 characters." }, req);
      setSettings({ householdName: name }, g.session.householdId);
      audit({ type: "household.rename", ok: true, name }, req, g.session);
      return json(res, 200, { household: { id: g.session.householdId, name } }, req);
    }

    /* ---- Everything below requires an authenticated, allowed-origin session ---- */
    // Connectors list
    if (path === "/api/connectors" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { connectors: listConnectors() }, req);
    }

    const connMatch = path.match(/^\/api\/connectors\/([^/]+)(\/(config|health))?$/);
    if (connMatch) {
      const id = connMatch[1]; const sub = connMatch[3];
      const c = connectorById(id);
      if (sub === "config" && method === "POST") {
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        if (!c) return json(res, 404, { error: "unknown_connector" }, req);
        const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
        const fields = {}, secrets = {};
        for (const f of c.configSchema) { if (!(f.key in body)) continue; if (f.type === "secret") secrets[f.key] = body[f.key]; else fields[f.key] = body[f.key]; }
        setConnectorConfig(id, fields, secrets);
        audit({ type: "connector.config", connectorId: id, ok: true, fields: Object.keys(fields) }, req, g.session);
        return json(res, 200, { connector: publicConnector(c) }, req);
      }
      if (sub === "config" && method === "DELETE") {
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        if (!c) return json(res, 404, { error: "unknown_connector" }, req);
        revokeConnector(id); setHealth(id, { ok: false, status: "revoked" });
        audit({ type: "connector.revoke", connectorId: id, ok: true }, req, g.session);
        return json(res, 200, { connector: publicConnector(c) }, req);
      }
      if (sub === "health" && method === "POST") {
        const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        if (!c) return json(res, 404, { error: "unknown_connector" }, req);
        const h = await healthCheck(id);
        audit({ type: "connector.health", connectorId: id, ok: h.ok }, req, g.session);
        return json(res, 200, h, req);
      }
      if (!sub && method === "GET") {
        const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        if (!c) return json(res, 404, { error: "unknown_connector" }, req);
        return json(res, 200, { connector: publicConnector(c) }, req);
      }
    }

    /* ---- Connector platform: providers + per-user connected accounts ---- */
    if (path === "/api/providers" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Attach this actor's accounts so the UI knows which providers are connected for them.
      const mine = listAccountsFor(g.session.householdId, g.session.actorId);
      const byProvider = {};
      for (const a of mine) (byProvider[a.provider] ||= []).push(a);
      /* B4 [09:48] — "the calendar account shows wr…@gmail.com. It should show ROSS. Our
       * family identifies each other by name, not by email address."
       *
       * The account's own displayName comes from the OAuth provider and is usually the email.
       * The member who connected it is recorded on the account (connectedByActorId), so the
       * name is right here — attached server-side so the web and the app say the same thing. */
      const roster = new Map(listMembers((m) => m.householdId === g.session.householdId).map((m) => [m.actorId, m.displayName]));
      const named = (a) => ({ ...a, memberName: roster.get(a.connectedByActorId) ?? null });
      const providers = listConnectorProviders().map((p) => ({ ...p, accounts: (byProvider[p.id] ?? []).map(named) }));
      return json(res, 200, { providers, redirectUri: oauthRedirectUri() }, req);
    }
    if (path === "/api/accounts" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { accounts: listAccountsFor(g.session.householdId, g.session.actorId) }, req);
    }
    // Sandbox-mode ONLY (WP-006 s4–s6): the recorded would-be effects for THIS tenant,
    // so a UI-driven use-case spec can assert what content/recipient/channel WOULD have
    // gone out (see server/test/README-sandbox.md). 404 in real mode — this surface
    // does not exist outside the sandbox, and it never exposes another tenant's data
    // (listSandboxEffects reads the session tenant's own collection).
    if (path === "/api/sandbox/effects" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!sandboxEnabled()) return json(res, 404, { error: "not_found" }, req);
      return json(res, 200, { sandbox: true, effects: listSandboxEffects() }, req);
    }
    // Household graph (P4.2): the server-owned member roster with roles + relationships.
    // This is the source of truth the session role is resolved from (P0.2); the client
    // renders it but cannot mint roles. No secrets — safe for any household member to read.
    if (path === "/api/members" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const members = listMembers({ householdId: g.session.householdId }).filter((m) => !m.archived).map((m) => ({
        actorId: m.actorId, displayName: m.displayName, role: m.role, relationship: m.relationship ?? null,
        color: m.color ?? null, spaceIds: m.spaceIds ?? [], isCurrentUser: m.actorId === g.session.actorId,
        // Self-service profile: an uploaded photo file id or a curated avatar id (e.g. "avatar:03").
        photoFileId: m.photoFileId ?? null,
        // Adult-granted AI access for a child (default off).
        aiEnabled: m.aiEnabled === true,
      }));
      return json(res, 200, { members }, req);
    }
    // Member management (post-claim): Owners/Adult Admins shape the roster. The last
    // Owner can never be demoted or archived, and you can't archive yourself.
    if (path === "/api/members" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const displayName = String(body.displayName ?? "").trim();
      if (!displayName) return json(res, 400, { error: "name_required" }, req);
      if (!VALID_ROLES.includes(body.role)) return json(res, 400, { error: "bad_role", valid: VALID_ROLES }, req);
      const actorId = String(body.actorId ?? ("m-" + crypto.randomBytes(4).toString("hex"))).trim();
      if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(actorId)) return json(res, 400, { error: "bad_actor_id" }, req);
      if (getMember(actorId)) return json(res, 409, { error: "actor_exists" }, req);
      const color = normalizeMemberColor(body.color);
      const m = putMember({ actorId, displayName, role: body.role, relationship: body.relationship ?? null, householdId: g.session.householdId, ...(color !== undefined ? { color } : {}) });
      audit({ type: "member.create", memberId: actorId, role: body.role, ok: true }, req, g.session);
      return json(res, 200, { member: { actorId: m.actorId, displayName: m.displayName, role: m.role, relationship: m.relationship ?? null, color: m.color ?? null } }, req);
    }
    const memberOne = path.match(/^\/api\/members\/([^/]+)$/);
    if (memberOne && method === "PATCH") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const m = getMember(memberOne[1]);
      if (!m || m.archived) return json(res, 404, { error: "not_found" }, req);
      // Self-service: a member may edit their OWN presentation (name/photo/color). Changing
      // relationship, role, or a child's AI access — or editing ANOTHER member — is Adult Admin+.
      const isSelf = m.actorId === g.session.actorId;
      const canManage = roleAtLeast(g.session.role, "Adult Admin");
      if (!canManage && !isSelf) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!canManage && (body.relationship !== undefined || body.role != null || body.aiEnabled !== undefined)) {
        return json(res, 403, { error: "insufficient_role", message: "Only an Owner or Adult Admin can change roles or relationships." }, req);
      }
      const patch = {};
      if (body.displayName != null) { const n = String(body.displayName).trim(); if (!n) return json(res, 400, { error: "name_required" }, req); patch.displayName = n; }
      if (body.relationship !== undefined) patch.relationship = body.relationship;
      // Color: an explicit null/"" clears it; a valid accent name or hex sets it; anything else is ignored.
      if (body.color !== undefined) {
        if (body.color === null || body.color === "") patch.color = null;
        else { const c = normalizeMemberColor(body.color); if (c) patch.color = c; }
      }
      if (body.role != null) {
        if (!VALID_ROLES.includes(body.role)) return json(res, 400, { error: "bad_role", valid: VALID_ROLES }, req);
        const owners = listMembers({ householdId: g.session.householdId }).filter((x) => !x.archived && x.role === "Owner");
        if (m.role === "Owner" && body.role !== "Owner" && owners.length <= 1) return json(res, 409, { error: "last_owner", message: "The household needs at least one Owner." }, req);
        patch.role = body.role;
      }
      // Profile photo / curated avatar id (self-service). An explicit null/"" clears it.
      if (body.photoFileId !== undefined) {
        patch.photoFileId = body.photoFileId ? String(body.photoFileId).slice(0, 120) : null;
        // A REAL uploaded photo is uploaded private, so another member's Today-strip card
        // 404s on it (canSeeEntity denies a private file they don't own). Flip that one
        // file to household visibility so the whole family can render the avatar. Curated
        // ("avatar:03") and emoji ("emoji:🦊") ids resolve to no file — left untouched.
        if (patch.photoFileId && !patch.photoFileId.startsWith("emoji:")) {
          const f = getFileRec(patch.photoFileId);
          if (f && f.householdId === g.session.householdId && f.visibility !== "household") patchFileRec(f.id, { visibility: "household" });
        }
      }
      // Child AI access — an adult toggles whether a child may chat with the assistant.
      if (body.aiEnabled !== undefined) patch.aiEnabled = !!body.aiEnabled;
      const updated = putMember({ actorId: m.actorId, ...patch });
      audit({ type: "member.update", memberId: m.actorId, fields: Object.keys(patch), ok: true }, req, g.session);
      return json(res, 200, { member: { actorId: updated.actorId, displayName: updated.displayName, role: updated.role, relationship: updated.relationship ?? null, color: updated.color ?? null, photoFileId: updated.photoFileId ?? null, aiEnabled: updated.aiEnabled === true } }, req);
    }
    if (memberOne && method === "DELETE") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const m = getMember(memberOne[1]);
      if (!m || m.archived) return json(res, 404, { error: "not_found" }, req);
      if (m.actorId === g.session.actorId) return json(res, 409, { error: "cannot_archive_self", message: "You can't remove the profile you're signed in as." }, req);
      const owners = listMembers({ householdId: g.session.householdId }).filter((x) => !x.archived && x.role === "Owner");
      if (m.role === "Owner" && owners.length <= 1) return json(res, 409, { error: "last_owner", message: "The household needs at least one Owner." }, req);
      putMember({ actorId: m.actorId, archived: true });
      // A removed member's devices lose access NOW, not at token expiry.
      const killed = deleteSessionsForActor(m.actorId);
      audit({ type: "member.archive", memberId: m.actorId, sessionsKilled: killed, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }
    const acctHealth = path.match(/^\/api\/accounts\/([^/]+)\/health$/);
    if (acctHealth && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const owned = getOwnedAccount(acctHealth[1], g.session);
      if (owned.error) return json(res, owned.error === "forbidden" ? 403 : 404, { error: owned.error }, req);
      const h = await checkAccountHealth(owned.account);
      audit({ type: "account.health", provider: owned.account.provider, accountId: owned.account.id, ok: h.ok }, req, g.session);
      return json(res, 200, h, req);
    }
    /* The manual counterpart to the timer. Any ADULT may run it for the whole household —
     * deliberately wider than POST /api/accounts/:id/health, which is restricted to the
     * member who connected that one account. That restriction is exactly why a stale status
     * on someone ELSE's account was unfixable from the screen showing it: Ross could see that
     * Melissa's calendar said "reconnect" and had no way to ask whether that was still true.
     * Re-checking is read-only — it can clear or confirm a status, never grant access. */
    if (path === "/api/accounts/health-check" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!isAdultRole(g.session.role)) return json(res, 403, { error: "insufficient_role" }, req);
      const out = await sweepAccountHealth({ householdId: g.session.householdId, force: true });
      audit({ type: "account.health_sweep", ...out, ok: true }, req, g.session);
      return json(res, 200, { ok: true, ...out }, req);
    }
    const acctMatch = path.match(/^\/api\/accounts\/([^/]+)$/);
    if (acctMatch && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const owned = getOwnedAccount(acctMatch[1], g.session);
      if (owned.error) return json(res, owned.error === "forbidden" ? 403 : 404, { error: owned.error }, req);
      revokeAccount(owned.account.id);
      audit({ type: "account.revoke", provider: owned.account.provider, accountId: owned.account.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }

    /* ---- Server-side approvals (list / create / decide) ----
     * Authority is role-safe: low-trust roles (Child View, Guest/Helper) cannot
     * initiate external actions or approve them, and only approvals an actor may
     * observe/decide are returned. The frozen-input hash + household IDOR checks are
     * preserved; the approver-role policy is the new layer. */
    if (path === "/api/approvals" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Only return approvals this actor may observe: ones they requested, or ones
      // they are an allowed approver for. A child never sees adult approvals.
      const visible = listApprovals({ householdId: g.session.householdId }).filter((a) =>
        a.requestedBy === g.session.actorId || canApprove(a, { role: g.session.role, actorId: g.session.actorId }));
      return json(res, 200, { approvals: visible.map(publicApproval) }, req);
    }
    if (path === "/api/approvals" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Children/guests cannot initiate external actions — requesting an executable
      // approval requires at least a Limited Member.
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      // Resolve the tool from the provider platform first, then legacy connectors.
      const platform = findToolGlobal(body.toolId);
      const conn = platform ? null : listConnectors().find((x) => x.tools.some((t) => t.id === body.toolId));
      const tool = platform?.tool ?? conn?.tools.find((t) => t.id === body.toolId);
      const connectorId = platform?.provider.id ?? conn?.id;
      if (!tool) return json(res, 404, { error: "unknown_tool" }, req);
      if (!tool.requiresApproval) return json(res, 400, { error: "approval_not_required" }, req);
      const a = createApproval({ actorId: g.session.actorId, householdId: g.session.householdId, connectorId, toolId: body.toolId, input: body.input ?? {}, risk: tool.risk, category: body.category, preview: body.preview, source: "executable" });
      audit({ type: "approval.create", connectorId, toolId: body.toolId, approvalId: a.id, ok: true }, req, g.session);
      void notifyApproval(a);
      return json(res, 200, { approval: publicApproval(a) }, req);
    }
    const aprDecide = path.match(/^\/api\/approvals\/([^/]+)\/decide$/);
    if (aprDecide && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      // Household scoping: only a member of the approval's own household may decide it
      // (mirrors the account routes' ownership check). Prevents cross-household IDOR.
      const existing = getApproval(aprDecide[1]);
      if (!existing || existing.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      // Authority gate: a low-trust role can no longer approve high-risk actions.
      const out = decideApproval(aprDecide[1], { decision: body.decision === "approve" ? "approve" : "deny", actorId: g.session.actorId, actorRole: g.session.role });
      if (out.error === "approver_not_allowed") { audit({ type: "approval.decide", approvalId: aprDecide[1], ok: false, error: out.error }, req, g.session); return json(res, 403, { error: out.error }, req); }
      if (out.error) { audit({ type: "approval.decide", approvalId: aprDecide[1], ok: false, error: out.error }, req, g.session); return json(res, 409, { error: out.error }, req); }
      audit({ type: "approval.decide", approvalId: aprDecide[1], ok: true, decision: out.approval.status }, req, g.session);
      // Auto-resume the durable run parked on this approval (fire-and-forget): on
      // approve it continues + consumes the approval; on deny the run fails cleanly.
      // Re-check the parked run is the same household before driving it.
      const parked = findRunByApprovalId(aprDecide[1]);
      if (parked && parked.householdId === g.session.householdId) resumeRun(parked.id).catch(() => {});
      return json(res, 200, { approval: publicApproval(out.approval) }, req);
    }
    const aprGet = path.match(/^\/api\/approvals\/([^/]+)$/);
    if (aprGet && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const a = getApproval(aprGet[1]);
      if (!a || a.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      return json(res, 200, { approval: publicApproval(a) }, req);
    }

    /* ---- Tool execution (approval enforced via server-side record) ---- */
    const toolMatch = path.match(/^\/api\/tools\/([^/]+)\/execute$/);
    if (toolMatch && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const toolId = toolMatch[1];
      const input = body.input ?? {};
      const platform = findToolGlobal(toolId);

      // Shared approval gate: the client `approved` boolean is ignored; a valid,
      // unconsumed, input-hash-matching server approval is required for gated tools.
      const requiresApproval = platform?.tool.requiresApproval ?? (listConnectors().find((x) => x.tools.some((t) => t.id === toolId))?.tools.find((t) => t.id === toolId)?.requiresApproval);
      let approvalId;
      if (requiresApproval) {
        const c = consumeApproval({ id: body.approvalId, actorId: g.session.actorId, householdId: g.session.householdId, toolId, input });
        if (c.error) { audit({ type: "tool.execute", toolId, ok: false, error: c.error }, req, g.session); return json(res, 422, { ok: false, error: c.error, message: approvalErrorMessage(c.error) }, req); }
        approvalId = c.approval.id;
      }

      if (platform) {
        // Provider-platform tool → run against THIS actor's connected account.
        if (!externalActionsEnabled(g.session.householdId) && ["Write", "Send", "Download"].includes(platform.tool.action)) return json(res, 423, { ok: false, error: "external_actions_disabled", message: "External actions are paused by the household kill switch." }, req);
        const accounts = listAccountsFor(g.session.householdId, g.session.actorId).filter((a) => a.provider === platform.provider.id);
        const account = body.accountId ? accounts.find((a) => a.id === body.accountId) : accounts[0];
        if (!account) { audit({ type: "tool.execute", toolId, ok: false, error: "no_account" }, req, g.session); return json(res, 422, { ok: false, error: "not_connected", message: `Connect your ${platform.provider.name} account to use this tool.` }, req); }
        try {
          const result = await platform.tool.run(apiForAccount(account), input);
          audit({ type: "tool.execute", connectorId: platform.provider.id, toolId, accountId: account.id, ok: true, action: platform.tool.action }, req, g.session);
          return json(res, 200, { ok: true, result }, req);
        } catch (e) {
          // Typed validation failures (e.code) surface honestly — an empty email body
          // is invalid_input, not a Google-side error.
          const code = e?.code === "invalid_input" ? "invalid_input" : "provider_error";
          audit({ type: "tool.execute", connectorId: platform.provider.id, toolId, accountId: account.id, ok: false, error: code }, req, g.session);
          return json(res, 422, { ok: false, error: code, message: String(e?.message ?? e) }, req);
        }
      }

      // Legacy utility connectors (weather/rss/http/sms/...).
      const out = await executeTool(toolId, input, { actorId: g.session.actorId, requestId: req.__rid, approvalConsumed: !!approvalId, approvalId });
      return json(res, out.ok ? 200 : 422, out, req);
    }

    /* ---- Durable runs (the canonical server-side runtime) ---- */
    if (path === "/api/runs" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const runs = listRuns({
        householdId: g.session.householdId,
        status: url.searchParams.get("status") || undefined,
        source: url.searchParams.get("source") || undefined,
        agentId: url.searchParams.get("agentId") || undefined,
        skillId: url.searchParams.get("skillId") || undefined,
        limit: Number(url.searchParams.get("limit") || 100),
      });
      // Object-level scope: adults see the household's runs; low-trust roles
      // (Child View, Guest/Helper, Limited Member) see only runs they started.
      const scoped = isAdultRole(g.session.role) ? runs : runs.filter((r) => r.actorId === g.session.actorId);
      return json(res, 200, { runs: scoped.map(publicRun) }, req);
    }
    if (path === "/api/runs/start" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Children/guests cannot initiate automation runs (which may reach external tools).
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      // WP-006 slice 1 — through the single orchestrate() entry (skillId → runSkill; raw
      // plan → startRun-as-is). No route creates a run directly anymore.
      const out = await orchestrate({
        source: body.skillId ? (body.source ?? "skill") : (body.source ?? "manual"),
        via: "manual",
        skillId: body.skillId ?? null,
        plan: (body.plan && typeof body.plan === "object") ? body.plan : null,
        params: body.params ?? {},
        session: g.session,
        sourceRef: clientSourceRef(body.sourceRef),
      });
      if (out.error) {
        const code = out.error === "unknown_skill" ? 404 : out.error === "nothing_to_run" ? 400 : 422;
        // WP-101 slice 1: typed preflight refusals (no_acting_agent) carry a plain-language
        // `message` naming the fix. Dropping it would leave the client with a bare error
        // code and nothing to show the family.
        return json(res, code, {
          error: out.error === "nothing_to_run" ? "plan_or_skill_required" : out.error,
          ...(out.message ? { message: out.message } : {}),
        }, req);
      }
      const run = out.run;
      audit({ type: "run.start", runId: run.id, source: run.source, ok: true }, req, g.session);
      return json(res, 200, { run: publicRun(run) }, req);
    }
    const runGet = path.match(/^\/api\/runs\/([^/]+)$/);
    if (runGet && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const r = getRun(runGet[1]);
      if (!r || r.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      return json(res, 200, { run: publicRun(r) }, req);
    }
    // Interactive email review (item 3): correlate a completed run's gmail.search results
    // (which carry subject/from per message) with its gmail.modifyLabels steps (which say
    // what was added/removed to which messageIds), producing a per-message review list the
    // chat can render with revert/relabel actions. Household-scoped; empty when the run
    // never touched Gmail labels.
    const runReview = path.match(/^\/api\/runs\/([^/]+)\/email-review$/);
    if (runReview && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const r = getRun(runReview[1]);
      if (!r || r.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      // 1) Metadata map: id -> {subject, from} from every gmail.search result.
      const meta = {};
      const labels = [];
      const labelSeen = new Set();
      for (const s of r.steps ?? []) {
        if (s.toolId === "gmail.search" && s.result && Array.isArray(s.result.messages)) {
          for (const m of s.result.messages) if (m?.id) meta[m.id] = { subject: m.subject ?? "", from: m.from ?? "", snippet: m.snippet ?? "" };
        }
        if (s.toolId === "gmail.listLabels" && s.result && Array.isArray(s.result.labels)) {
          for (const l of s.result.labels) if (l?.name && !labelSeen.has(l.name)) { labelSeen.add(l.name); labels.push({ id: l.id, name: l.name, type: l.type }); }
        }
      }
      // 2) Per-message applied changes from every SUCCEEDED gmail.modifyLabels step.
      const byId = new Map();
      for (const s of r.steps ?? []) {
        if (s.toolId !== "gmail.modifyLabels" || s.status !== "succeeded") continue;
        const ids = String(s.input?.messageIds ?? "").split(",").map((x) => x.trim()).filter(Boolean);
        const added = Array.isArray(s.result?.added) ? s.result.added : [];
        const removed = Array.isArray(s.result?.removed) ? s.result.removed : [];
        for (const id of ids) {
          const cur = byId.get(id) ?? { id, subject: meta[id]?.subject ?? "", from: meta[id]?.from ?? "", snippet: meta[id]?.snippet ?? "", added: [], removed: [] };
          for (const a of added) if (!cur.added.includes(a)) cur.added.push(a);
          for (const rm of removed) if (!cur.removed.includes(rm)) cur.removed.push(rm);
          byId.set(id, cur);
        }
      }
      const messages = [...byId.values()];
      return json(res, 200, { runId: r.id, messages, labels, touchedGmail: messages.length > 0 }, req);
    }
    const runResume = path.match(/^\/api\/runs\/([^/]+)\/resume$/);
    if (runResume && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const r = getRun(runResume[1]);
      if (!r || r.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      await resumeRun(runResume[1]);
      return json(res, 200, { run: publicRun(getRun(runResume[1])) }, req);
    }
    const runCancel = path.match(/^\/api\/runs\/([^/]+)\/cancel$/);
    if (runCancel && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const r = getRun(runCancel[1]);
      if (!r || r.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      await cancelRun(runCancel[1]);
      audit({ type: "run.cancel", runId: runCancel[1], ok: true }, req, g.session);
      return json(res, 200, { run: publicRun(getRun(runCancel[1])) }, req);
    }
    // Live run progress over Server-Sent Events: pushes a full run snapshot on every
    // state transition (engine.mjs emits per-run events). The /api/runs/{id} poll
    // remains the durable fallback — SSE is advisory; runs.json is the truth.
    const runEvents = path.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (runEvents && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const r0 = getRun(runEvents[1]);
      if (!r0 || r0.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no", ...corsHeaders(req) });
      // WP-101 slice 3: partially_failed is terminal. Omitting it here would leave the SSE
      // stream open forever on a finished run (the client waits on a run that will never
      // emit again).
      const TERMINAL_RUN = ["completed", "partially_failed", "failed", "cancelled", "expired"];
      const emitter = runEmitter(runEvents[1]);
      let hb;
      const cleanup = () => { clearInterval(hb); emitter.off("event", onEvent); };
      const send = (run) => { if (run) { try { res.write(`data: ${JSON.stringify(publicRun(run))}\n\n`); } catch { /* client gone */ } } };
      const onEvent = ({ run }) => {
        send(run);
        // Close the stream once the run can never change again — no lingering connection.
        if (run && TERMINAL_RUN.includes(run.status)) { cleanup(); try { res.end(); } catch { /* ignore */ } }
      };
      emitter.on("event", onEvent);
      hb = setInterval(() => { try { res.write(":keepalive\n\n"); } catch { /* ignore */ } }, 20000);
      req.on("close", cleanup);
      send(r0); // initial snapshot
      if (TERMINAL_RUN.includes(r0.status)) { cleanup(); try { res.end(); } catch { /* ignore */ } } // already done → one snapshot + close
      return; // hold the connection open for live runs
    }

    /* ---- Family data: server-owned events & tasks (P1.2 / P4.1) ----
     * Reads are object-level filtered by role/visibility (children/guests see only
     * household/childVisible items + their own); writes require Limited Member+. */
    if (path === "/api/events" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const visible = listEvents((e) => e.householdId === g.session.householdId).filter((e) => canSeeEntity(e, g.session));
      // Per-event edit affordance for the clients: a canonical (FamiliOS-owned) event is
      // editable by an adult or its owner; a linked Google event is editable ONLY by the
      // member who connected that Google account (edit-own-calendar-only). Everything else
      // (ICS mirrors, other members' synced events) is read-only.
      // ISS-121: an account that can no longer refresh must not go on contributing events
      // that LOOK current. Resolve each synced event's source account once per request and
      // flag the affected ones, so a disconnected calendar can never contribute SILENTLY.
      // Marked, not hidden: quietly removing a family's events would be a worse lie than
      // showing them with an honest "this calendar can't refresh" flag, and the clients
      // pair the flag with a reconnect action.
      const STALE_ACCOUNT_STATUS = new Set(["needs_reconnect", "revoked", "expired"]);
      const acctStatus = accountStatusById(g.session.householdId);
      const subToAccount = new Map();
      for (const s of listSubscriptions((s) => s.householdId === g.session.householdId)) {
        if (s.accountId) subToAccount.set(s.id, s.accountId);
      }
      const staleSourceOf = (e) => {
        const accountId = e.provenance?.googleAccountId ?? subToAccount.get(e.provenance?.subscriptionId) ?? null;
        if (!accountId) return null;
        const a = acctStatus.get(accountId);
        if (!a || !STALE_ACCOUNT_STATUS.has(a.status)) return null;
        return { accountId, status: a.status, provider: a.provider, connectedByActorId: a.connectedByActorId };
      };
      const withEditable = visible.map((e) => {
        const staleSource = staleSourceOf(e);
        return {
          ...e,
          editable: e.layer === "canonical"
            ? (isAdultRole(g.session.role) || e.ownerId === g.session.actorId)
            : isEditableLinkedGoogle(e, g.session.householdId, g.session.actorId),
          ...(staleSource ? { staleSource } : {}),
        };
      });
      return json(res, 200, { events: withEditable }, req);
    }
    if (path === "/api/events" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!String(body.title ?? "").trim()) return json(res, 400, { error: "title_required" }, req);
      // ISS-105: fail loudly rather than storing an event that can never render. The mobile
      // form already keeps the editor open and surfaces the server message on a non-2xx.
      if (badTimestamp(body.startAt)) return json(res, 400, { error: "invalid_startAt", message: "That start date/time isn't a valid timestamp." }, req);
      if (badTimestamp(body.endAt)) return json(res, 400, { error: "invalid_endAt", message: "That end date/time isn't a valid timestamp." }, req);
      const ev = putEvent({
        id: "ev_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        title: String(body.title).trim(), startAt: body.startAt ?? null, endAt: body.endAt ?? null,
        // WP-003/ISS-005: all-day is an explicit model concept (Google pushes use the `date` form).
        allDay: body.allDay === true,
        location: body.location ?? "", notes: typeof body.notes === "string" ? body.notes : "", spaceId: body.spaceId ?? "sp-family",
        participantIds: Array.isArray(body.participantIds) ? body.participantIds : [],
        driverId: body.driverId ?? null, ownerId: body.ownerId ?? g.session.actorId, backupOwnerId: body.backupOwnerId ?? null,
        whatToBring: body.whatToBring ?? [], checklist: body.checklist ?? [], travel: body.travel ?? null,
        reminders: body.reminders ?? [], attachments: [], comments: [], mealImpact: body.mealImpact ?? null,
        visibility: body.visibility ?? "household", category: body.category ?? "Family",
        layer: body.layer ?? "canonical", status: body.status ?? "confirmed",
        source: body.source ?? "FamiliOS", provenance: { via: "user", actorId: g.session.actorId },
        createdBy: g.session.actorId, createdAt: Date.now(), updatedAt: new Date().toISOString(),
      });
      audit({ type: "event.create", eventId: ev.id, ok: true }, req, g.session);
      return json(res, 200, { event: ev }, req);
    }
    /* ---- E5/E6/E7: who's coming, told, and answering ----
     * [12:26] "Replace or augment 'note for driver' with WHO'S ATTENDING — let me pick GPop,
     *          Beannie, Melissa."
     * [12:56] "Selecting them should notify them, or at least inform them they're on it."
     * [13:07] "And they should be able to accept or decline, like a meeting invite."
     *
     * `attendees` is a list of { memberId, status, respondedAt } living alongside the older
     * `participantIds` (which many screens and the Google push still read). Setting attendees
     * keeps participantIds in step, so nothing downstream has to learn a new field to keep
     * working — and an existing event with participants but no RSVP list is read as everyone
     * "invited", not as everyone silently accepted.
     */
    const eventAttendees = path.match(/^\/api\/events\/([^/]+)\/attendees$/);
    if (eventAttendees && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const ev = getEvent(eventAttendees[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(ev, g.session) || (!isAdultRole(g.session.role) && ev.ownerId !== g.session.actorId)) return json(res, 403, { error: "forbidden" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const wanted = Array.isArray(body.memberIds) ? body.memberIds.map(String) : null;
      if (!wanted) return json(res, 400, { error: "member_ids_required" }, req);
      // Only real, non-archived household members — an invite to an id nobody holds is a
      // row on a card that can never respond.
      const roster = new Map(listMembers((m) => m.householdId === g.session.householdId && !m.archived).map((m) => [m.actorId, m]));
      const ids = [...new Set(wanted.filter((x) => roster.has(x)))];
      const prior = new Map((ev.attendees ?? []).map((a) => [a.memberId, a]));
      // An existing answer is PRESERVED across an edit: re-saving the list must not silently
      // reset someone who already declined back to "invited".
      const attendees = ids.map((memberId) => prior.get(memberId) ?? { memberId, status: "invited", respondedAt: null });
      // Whoever is genuinely new AND isn't the person doing the adding — nobody needs a
      // notification telling them what they just did.
      const added = ids.filter((x) => !prior.has(x) && x !== g.session.actorId);
      const updated = patchEvent(ev.id, { attendees, participantIds: ids });

      // E6 — newly added people are actually told. Their own device (push) plus a durable
      // in-app notification, so it survives a phone that was off. Never re-notified on an
      // unrelated edit: only `added`.
      const when = updated.startAt
        ? new Date(updated.startAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : "no date set yet";
      for (const memberId of added) {
        addNotification({
          householdId: g.session.householdId, actorId: memberId, channel: "in_app",
          title: `You're on "${updated.title}"`,
          body: `${when}${updated.location ? ` · ${updated.location}` : ""}. Let them know if you can make it.`,
          to: null,
        });
        void pushToMember({
          householdId: g.session.householdId, actorId: memberId,
          title: `You're on "${updated.title}"`,
          body: `${when}. Accept or decline in FamiliOS.`,
          data: { type: "event", id: updated.id },
        }).catch(() => {});
      }
      audit({ type: "event.attendees_set", eventId: ev.id, count: ids.length, notified: added.length, ok: true }, req, g.session);
      return json(res, 200, { event: updated, notified: added.length }, req);
    }
    // E7 — accept or decline, for YOURSELF. An adult may answer on behalf of a child they can
    // already act for; nobody else can put words in another member's mouth.
    const eventRsvp = path.match(/^\/api\/events\/([^/]+)\/rsvp$/);
    if (eventRsvp && method === "POST") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const ev = getEvent(eventRsvp[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(ev, g.session)) return json(res, 403, { error: "forbidden" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const status = ["accepted", "declined", "invited"].includes(body.status) ? body.status : null;
      if (!status) return json(res, 400, { error: "bad_status", message: "Answer with accepted, declined, or invited." }, req);
      const memberId = String(body.memberId ?? g.session.actorId);
      if (memberId !== g.session.actorId && !isAdultRole(g.session.role)) {
        return json(res, 403, { error: "forbidden", message: "You can only answer for yourself." }, req);
      }
      const list = ev.attendees ?? (ev.participantIds ?? []).map((m) => ({ memberId: m, status: "invited", respondedAt: null }));
      if (!list.some((a) => a.memberId === memberId)) {
        return json(res, 400, { error: "not_an_attendee", message: "That person isn't on this event." }, req);
      }
      const attendees = list.map((a) => (a.memberId === memberId
        ? { ...a, status, respondedAt: status === "invited" ? null : new Date().toISOString() }
        : a));
      const updated = patchEvent(ev.id, { attendees });
      // The organizer finds out. Silent RSVPs are the reason people text "did you see my
      // reply?" — and the event owner is the one who has to plan around the answer.
      if (ev.ownerId && ev.ownerId !== memberId) {
        const who = getMember(memberId)?.displayName ?? "Someone";
        addNotification({
          householdId: g.session.householdId, actorId: ev.ownerId, channel: "in_app",
          title: `${who} ${status === "accepted" ? "is coming" : status === "declined" ? "can't make it" : "hasn't answered"}`,
          body: `"${updated.title}"`,
          to: null,
        });
      }
      audit({ type: "event.rsvp", eventId: ev.id, memberId, status, ok: true }, req, g.session);
      return json(res, 200, { event: updated }, req);
    }

    const eventOne = path.match(/^\/api\/events\/([^/]+)$/);
    if (eventOne && (method === "PATCH" || method === "POST")) {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const ev = getEvent(eventOne[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      // Only an adult, the owner, or a participant may edit; others can't even see it.
      if (!canSeeEntity(ev, g.session) || (!isAdultRole(g.session.role) && ev.ownerId !== g.session.actorId)) return json(res, 403, { error: "forbidden" }, req);
      // Three-layer calendar: canonical (FamiliOS-owned) events are always editable.
      // Linked events that originated in a connected Google Calendar are editable
      // TWO-WAY: the edit is written to Google first, then mirrored locally, so the
      // source of truth (Google) moves with us. ICS-fed linked/public events remain
      // read-only mirrors — editing them would blur source-of-truth, so we refuse
      // and tell the client to copy.
      // Edit-own-only: a linked Google event is two-way editable ONLY by the member who
      // connected that Google account. Another member's synced event (or an ICS mirror)
      // is read-only here — you can see it and it syncs, but you can't edit or push it.
      const linkedGoogle = ev.layer === "linked" && isEditableLinkedGoogle(ev, g.session.householdId, g.session.actorId);
      if (ev.layer && ev.layer !== "canonical" && !linkedGoogle) return json(res, 409, { error: "read_only_layer", message: "This event is synced from another calendar and can't be edited here — copy it to a FamiliOS event first." }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const { id, householdId, createdBy, createdAt, ifUpdatedAt, ...patch } = body; // never reassign identity/ownership-of-record
      // ISS-105: the same guard on edit — a bad stamp here would make an event that
      // renders today silently vanish from every day view.
      if (badTimestamp(patch.startAt)) return json(res, 400, { error: "invalid_startAt", message: "That start date/time isn't a valid timestamp." }, req);
      if (badTimestamp(patch.endAt)) return json(res, 400, { error: "invalid_endAt", message: "That end date/time isn't a valid timestamp." }, req);
      if (ifUpdatedAt && ev.updatedAt && ifUpdatedAt !== ev.updatedAt) {
        return json(res, 409, { error: "stale_write", message: "This event changed on another device — refresh and try again.", current: ev }, req);
      }
      if (linkedGoogle) {
        // Google-owned fields only — participants/checklists etc. stay FamiliOS-local
        // concepts and are patched on the mirror without touching Google.
        const { title, startAt, endAt, location, notes, ...localOnly } = patch;
        const gPatch = Object.fromEntries(Object.entries({ title, startAt, endAt, location, notes }).filter(([, v]) => v !== undefined));
        if (Object.keys(gPatch).length > 0) {
          if (!externalActionsEnabled(g.session.householdId)) return json(res, 423, { error: "external_actions_disabled" }, req);
          const r = await editLinkedGoogleEvent({ ev, patch: gPatch, householdId: g.session.householdId, actorId: g.session.actorId });
          audit({ type: "event.update", eventId: ev.id, ok: r.ok, target: "google-linked", ...(r.ok ? {} : { error: r.error }) }, req, g.session);
          if (!r.ok) return json(res, 422, { error: r.error, message: r.message ?? "Couldn't update the event in Google Calendar." }, req);
        }
        const updated = Object.keys(localOnly).length > 0 ? patchEvent(ev.id, localOnly) : getEvent(ev.id);
        return json(res, 200, { event: updated }, req);
      }
      const updated = patchEvent(ev.id, patch);
      audit({ type: "event.update", eventId: ev.id, ok: true }, req, g.session);
      // Auto-sync: a local edit to a Google-linked event mirrors to Google immediately
      // (server-triggered, no approval) when the household enabled calendar auto-sync.
      if (getSettings(g.session.householdId).calendarAutoSync === true && updated.provenance?.googleEventId && externalActionsEnabled(g.session.householdId)) {
        void pushEventToGoogle({ ev: updated, householdId: g.session.householdId, actorId: g.session.actorId })
          .then((r) => appendAudit({ type: "calendar.autopush", eventId: updated.id, ok: r.ok, ...(r.ok ? { action: r.action } : { error: r.error }) }))
          .catch(() => {});
      }
      return json(res, 200, { event: updated }, req);
    }
    if (eventOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const ev = getEvent(eventOne[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && ev.ownerId !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
      // Edit-own-only: a linked event you didn't connect is read-only — refuse rather than
      // delete the local mirror (which would just re-import on the next sync anyway).
      if (ev.layer && ev.layer !== "canonical" && !isEditableLinkedGoogle(ev, g.session.householdId, g.session.actorId)) {
        return json(res, 409, { error: "read_only_layer", message: "This event is synced from another calendar and can't be deleted here." }, req);
      }
      // Google-linked events delete two-way (Google first, then the local mirror) —
      // deleting only the mirror would just re-import on the next subscription sync.
      if (ev.layer === "linked" && isEditableLinkedGoogle(ev, g.session.householdId, g.session.actorId)) {
        if (!externalActionsEnabled(g.session.householdId)) return json(res, 423, { error: "external_actions_disabled" }, req);
        const r = await deleteLinkedGoogleEvent({ ev, householdId: g.session.householdId, actorId: g.session.actorId });
        audit({ type: "event.delete", eventId: ev.id, ok: r.ok, target: "google-linked", ...(r.ok ? {} : { error: r.error }) }, req, g.session);
        if (!r.ok) return json(res, 422, { error: r.error, message: r.message ?? "Couldn't delete the event in Google Calendar." }, req);
        return json(res, 200, { ok: true, google: "deleted" }, req);
      }
      // ISS-106: a CANONICAL event that was pushed to Google keeps a googleEventId.
      // Deleting only the local record left the Google copy alive, so the next
      // subscription sync re-imported it — the "deleted events come back" case. (Linked
      // events were already handled above; the meal-delete route already did this for
      // meal events, with the same reasoning.) Awaited rather than fire-and-forget so the
      // response can state the Google outcome instead of implying a clean delete.
      const gCopyId = ev.provenance?.googleEventId ?? null;
      let googleOutcome;
      if (gCopyId) {
        if (!externalActionsEnabled(g.session.householdId)) {
          googleOutcome = "kept_external_actions_disabled";
        } else {
          const r = await deleteGoogleCopy({ ev, householdId: g.session.householdId, actorId: g.session.actorId });
          googleOutcome = r?.ok ? "deleted" : "failed";
        }
      }
      deleteEventRec(ev.id);
      audit({ type: "event.delete", eventId: ev.id, ok: true, ...(googleOutcome ? { google: googleOutcome } : {}) }, req, g.session);
      return json(res, 200, { ok: true, ...(googleOutcome ? { google: googleOutcome } : {}) }, req);
    }
    if (path === "/api/tasks" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const visible = listTasks((t) => t.householdId === g.session.householdId).filter((t) => canSeeEntity(t, g.session));
      return json(res, 200, { tasks: visible }, req);
    }
    if (path === "/api/tasks" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!String(body.title ?? "").trim()) return json(res, 400, { error: "title_required" }, req);
      // H2 [21:49] — "it should have a start date and time and an end date and time, like a
      // calendar item, not just today/tomorrow/next week." Validated the same way events are:
      // an unparseable stamp is refused here rather than stored and rendered as "Invalid Date".
      for (const k of ["startAt", "endAt", "dueAt"]) {
        if (badTimestamp(body[k])) return json(res, 400, { error: "bad_timestamp", message: `"${k}" isn't a valid date and time.` }, req);
      }
      // H5 [22:19] — "reminders: 15 minutes before, 30 minutes before, producing a real
      // notification." Only the offsets the UI offers are storable, so nothing can be set
      // that no screen can show or explain.
      if (body.remindMinutesBefore !== undefined && !isValidReminder(body.remindMinutesBefore)) {
        return json(res, 400, { error: "bad_reminder" }, req);
      }
      const tk = putTask({
        id: "tk_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        title: String(body.title).trim(), type: body.type ?? "task", status: body.status ?? "todo",
        dueAt: body.dueAt ?? null, assignedMemberId: body.assignedMemberId ?? null, spaceId: body.spaceId ?? "sp-family",
        priority: body.priority ?? "medium", amount: body.amount ?? null, visibility: body.visibility ?? "household",
        listName: body.listName ?? undefined,
        startAt: body.startAt ?? null, endAt: body.endAt ?? null,
        remindMinutesBefore: body.remindMinutesBefore ?? null, reminderSentAt: null,
        notes: body.notes ?? "", source: "user", createdBy: g.session.actorId,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      audit({ type: "task.create", taskId: tk.id, ok: true }, req, g.session);
      return json(res, 200, { task: tk }, req);
    }
    const taskOne = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskOne && (method === "PATCH" || method === "POST")) {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const tk = getTask(taskOne[1]);
      if (!tk || tk.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(tk, g.session)) return json(res, 403, { error: "forbidden" }, req);
      // A child may complete a task assigned to them; broader edits need an adult/owner.
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const onlyStatus = Object.keys(body).every((k) => ["status", "ifUpdatedAt"].includes(k));
      const mayEdit = isAdultRole(g.session.role) || tk.createdBy === g.session.actorId || (onlyStatus && tk.assignedMemberId === g.session.actorId);
      if (!mayEdit) return json(res, 403, { error: "forbidden" }, req);
      const { id, householdId, createdBy, createdAt, ifUpdatedAt, ...patch } = body;
      if (ifUpdatedAt && tk.updatedAt && ifUpdatedAt !== tk.updatedAt) {
        return json(res, 409, { error: "stale_write", message: "This task changed on another device — refresh and try again.", current: tk }, req);
      }
      for (const k of ["startAt", "endAt", "dueAt"]) {
        if (k in patch && badTimestamp(patch[k])) return json(res, 400, { error: "bad_timestamp", message: `"${k}" isn't a valid date and time.` }, req);
      }
      if ("remindMinutesBefore" in patch && !isValidReminder(patch.remindMinutesBefore)) {
        return json(res, 400, { error: "bad_reminder" }, req);
      }
      // Moving the time, or changing the lead, must RE-ARM the reminder — otherwise a task
      // pushed from Tuesday to Friday keeps a spent stamp and silently never nudges again.
      const timingChanged = ["startAt", "dueAt", "remindMinutesBefore"].some((k) => k in patch && patch[k] !== tk[k]);
      if (timingChanged) patch.reminderSentAt = null;
      const updated = patchTask(tk.id, patch);
      audit({ type: "task.update", taskId: tk.id, ok: true }, req, g.session);
      return json(res, 200, { task: updated }, req);
    }
    if (taskOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const tk = getTask(taskOne[1]);
      if (!tk || tk.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && tk.createdBy !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
      deleteTaskRec(tk.id);
      audit({ type: "task.delete", taskId: tk.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }

    // H7 [23:18] — "when a task has a date it should append to the calendar, and push to
    // that person's Google account." Same back-reference pattern as meals: linked by taskId,
    // idempotent (re-adding updates the linked event rather than duplicating it), and once
    // it's a canonical event the existing approval-gated push sends it to Google. The
    // ASSIGNEE is the event's owner, because "that person's Google account" is the ask —
    // pushing a chore assigned to Beannie into my calendar helps nobody.
    const taskCal = path.match(/^\/api\/tasks\/([^/]+)\/to-calendar$/);
    if (taskCal && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const tk = getTask(taskCal[1]);
      if (!tk || tk.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(tk, g.session)) return json(res, 403, { error: "forbidden" }, req);
      const startAt = tk.startAt || tk.dueAt;
      if (!startAt) return json(res, 400, { error: "date_required", message: "Give the task a date before adding it to the calendar." }, req);
      const owner = tk.assignedMemberId || tk.createdBy || g.session.actorId;
      const fields = {
        title: tk.title,
        startAt,
        endAt: tk.endAt ?? null,
        notes: tk.notes ?? "",
      };
      const existing = listEvents((e) => e.householdId === g.session.householdId && e.taskId === tk.id)[0];
      if (existing) {
        const updated = patchEvent(existing.id, fields);
        if (getSettings(g.session.householdId).calendarAutoSync === true && updated.provenance?.googleEventId && externalActionsEnabled(g.session.householdId)) {
          void pushEventToGoogle({ ev: updated, householdId: g.session.householdId, actorId: owner })
            .then((r) => appendAudit({ type: "calendar.autopush", eventId: updated.id, ok: r.ok, ...(r.ok ? { action: r.action } : { error: r.error }) })).catch(() => {});
        }
        audit({ type: "task.to_calendar", taskId: tk.id, eventId: existing.id, action: "updated", ok: true }, req, g.session);
        return json(res, 200, { ok: true, event: updated, action: "updated" }, req);
      }
      const ev = putEvent({
        id: "ev_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        ...fields, allDay: false, location: "", spaceId: tk.spaceId ?? "sp-family",
        participantIds: tk.assignedMemberId ? [tk.assignedMemberId] : [],
        driverId: null, ownerId: owner, backupOwnerId: null,
        whatToBring: [], checklist: [], travel: null, reminders: [], attachments: [], comments: [],
        mealImpact: null, taskId: tk.id, visibility: tk.visibility ?? "household", category: "Task",
        layer: "canonical", status: "confirmed", source: "FamiliOS",
        provenance: { via: "task", actorId: g.session.actorId },
        createdBy: g.session.actorId, createdAt: Date.now(), updatedAt: new Date().toISOString(),
      });
      patchTask(tk.id, { eventId: ev.id });   // so the task row can say it's on the calendar
      audit({ type: "task.to_calendar", taskId: tk.id, eventId: ev.id, action: "created", ok: true }, req, g.session);
      return json(res, 200, { ok: true, event: ev, action: "created" }, req);
    }

    /* ---- Help requests: "can you help?" asks between members ----
     * ANY signed-in member may ask (children and grandparents included — asking for
     * help must never need a role); only the recipient can answer; the requester or
     * an adult can cancel while pending. Notifications go to the two people involved
     * (in-app record + targeted push), never the whole household. */
    if (path === "/api/help-requests" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const mine = listHelpRequests((h) => h.householdId === g.session.householdId)
        .filter((h) => h.fromActorId === g.session.actorId || h.toActorId === g.session.actorId || isAdultRole(g.session.role))
        .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
        // Direction: legacy rows have no `kind` — they were all "ask" (a requester asking
        // a helper). "offer" is a member offering to help with the RECIPIENT's item.
        .map((h) => ({ ...h, kind: h.kind === "offer" ? "offer" : "ask" }));
      return json(res, 200, { helpRequests: mine }, req);
    }
    if (path === "/api/help-requests" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const to = getMember(String(body.toActorId ?? ""));
      if (!to || to.archived) return json(res, 400, { error: "bad_recipient", message: "Pick a current household member to ask." }, req);
      const message = String(body.message ?? "").trim().slice(0, 500);
      if (!message) return json(res, 400, { error: "message_required", message: "Say what you need help with." }, req);
      // Direction: "ask" (default) = requester asking `to` to help with the requester's
      // item; "offer" = requester offering to help with `to`'s item. Recipient is `to` either way.
      const kind = body.kind === "offer" ? "offer" : "ask";
      // WP-001 (ISS-009 root): refuse a duplicate PENDING request for the same
      // (taskId, recipient) — re-asking piled up records that rendered as duplicate
      // cards. 409 returns the existing record so clients can point at it.
      if (body.taskId) {
        const existing = listHelpRequests((h) =>
          h.householdId === g.session.householdId && h.status === "pending" &&
          h.taskId === body.taskId && h.toActorId === String(body.toActorId ?? ""));
        if (existing.length) {
          return json(res, 409, {
            error: "duplicate_request",
            message: `${to.displayName} was already asked about this — waiting on their answer.`,
            helpRequest: existing[0],
          }, req);
        }
      }
      const fromName = getMember(g.session.actorId)?.displayName ?? g.session.actorId;
      const hr = putHelpRequest({
        id: "hr_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        fromActorId: g.session.actorId, fromName, toActorId: to.actorId, toName: to.displayName,
        kind,
        message, eventId: body.eventId ?? null, taskId: body.taskId ?? null,
        status: "pending", responseNote: null,
        createdAt: new Date().toISOString(), respondedAt: null,
      });
      const nTitle = kind === "offer" ? "Help offered" : "Can you help?";
      const nBody = kind === "offer" ? `${fromName} offered to help: ${message}` : `${fromName}: ${message}`;
      addNotification({ householdId: g.session.householdId, actorId: to.actorId, channel: "in_app", title: nTitle, body: nBody });
      void pushToMember({ householdId: g.session.householdId, actorId: to.actorId, title: nTitle, body: nBody, data: { type: "help_request", id: hr.id } });
      audit({ type: "help.request", helpRequestId: hr.id, toActorId: to.actorId, kind, ok: true }, req, g.session);
      return json(res, 200, { helpRequest: hr }, req);
    }
    const helpRespond = path.match(/^\/api\/help-requests\/([^/]+)\/respond$/);
    if (helpRespond && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const hr = getHelpRequest(helpRespond[1]);
      if (!hr || hr.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (hr.toActorId !== g.session.actorId) return json(res, 403, { error: "forbidden", message: "Only the person who was asked can answer this request." }, req);
      if (hr.status !== "pending") return json(res, 409, { error: "already_answered", helpRequest: hr }, req);
      const body = (await readBody(req)) ?? {};
      if (!["accept", "decline"].includes(body.response)) return json(res, 400, { error: "bad_response", message: 'response must be "accept" or "decline".' }, req);
      const status = body.response === "accept" ? "accepted" : "declined";
      const responseNote = String(body.note ?? "").trim().slice(0, 500) || null;
      const updated = patchHelpRequest(hr.id, { status, responseNote, respondedAt: new Date().toISOString() });
      // WP-001 (ISS-001): accepting help with a linked task TRANSFERS the task.
      // ask   → the helper is the recipient (hr.toActorId, the acceptor);
      // offer → the helper is the offerer (hr.fromActorId).
      // A missing/deleted task is reported honestly as reassigned:false — never faked.
      let reassignedTask = null;
      if (status === "accepted" && hr.taskId) {
        const linked = getTask(hr.taskId);
        if (linked && linked.householdId === g.session.householdId) {
          const helperId = hr.kind === "offer" ? hr.fromActorId : hr.toActorId;
          reassignedTask = patchTask(linked.id, { assignedMemberId: helperId });
        }
      }
      // Copy tracks direction: the notified party is always the creator (hr.fromActorId).
      // ask → "X accepted your request"; offer → "X accepted your help offer".
      const noun = hr.kind === "offer" ? "help offer" : "request";
      const title = hr.kind === "offer" ? `Help offer ${status}` : `Request ${status}`;
      const note = responseNote ? ` — ${responseNote}` : "";
      addNotification({ householdId: g.session.householdId, actorId: hr.fromActorId, channel: "in_app", title, body: `${hr.toName} ${status} your ${noun}${note}` });
      void pushToMember({ householdId: g.session.householdId, actorId: hr.fromActorId, title, body: `${hr.toName} ${status} your ${noun}${note}`, data: { type: "help_request", id: hr.id } });
      audit({ type: "help.respond", helpRequestId: hr.id, status, reassigned: !!reassignedTask, ...(reassignedTask ? { taskId: reassignedTask.id, assignedMemberId: reassignedTask.assignedMemberId } : {}), ok: true }, req, g.session);
      return json(res, 200, { helpRequest: updated, reassigned: !!reassignedTask, ...(reassignedTask ? { task: reassignedTask } : {}) }, req);
    }
    const helpCancel = path.match(/^\/api\/help-requests\/([^/]+)\/cancel$/);
    if (helpCancel && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const hr = getHelpRequest(helpCancel[1]);
      if (!hr || hr.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (hr.fromActorId !== g.session.actorId && !isAdultRole(g.session.role)) return json(res, 403, { error: "forbidden" }, req);
      if (hr.status !== "pending") return json(res, 409, { error: "already_answered", helpRequest: hr }, req);
      const updated = patchHelpRequest(hr.id, { status: "cancelled" });
      audit({ type: "help.cancel", helpRequestId: hr.id, ok: true }, req, g.session);
      return json(res, 200, { helpRequest: updated }, req);
    }

    /* ---- Meal plan (family meals) — household/visibility scoped; Limited Member+ writes.
     * Grocery items reuse tasks (type:"list", listName:"Groceries"). ---- */
    if (path === "/api/meals" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const visible = listMeals((m) => m.householdId === g.session.householdId).filter((m) => canSeeEntity(m, g.session));
      return json(res, 200, { meals: visible }, req);
    }
    /* P2 [09:20] — "are these ingredients automatically added to the grocery list? If not,
     * they need to be."
     *
     * They were, but only when the ASSISTANT planned the meal (homeops.plan_meal). A meal a
     * person typed in themselves never reached the list — the same recipe, added by hand,
     * silently produced no groceries. Same behaviour both ways now.
     *
     * Only ingredients not already marked `have`, deduped against what is already open on the
     * list so re-saving a meal doesn't stack a third "eggs", and linked by mealId so the
     * grocery item can be traced back to the meal that asked for it. */
    const syncMealGroceries = (meal, session) => {
      const wanted = (meal.ingredients ?? []).filter((i) => i?.item && !i.have);
      if (wanted.length === 0) return 0;
      const norm = (x) => String(x ?? "").trim().toLowerCase();
      const open = new Set(
        listTasks((t) => t.householdId === session.householdId && t.type === "list" && t.listName === "Groceries" && t.status !== "done")
          .map((t) => norm(t.title)),
      );
      let added = 0;
      for (const ing of wanted) {
        if (open.has(norm(ing.item))) continue;
        open.add(norm(ing.item));
        putTask({
          id: "tk_" + crypto.randomBytes(8).toString("hex"), householdId: session.householdId,
          title: String(ing.item).trim(), type: "list", listName: "Groceries", status: "todo",
          dueAt: null, assignedMemberId: null, spaceId: "sp-family", priority: "low",
          amount: null, visibility: meal.visibility ?? "household", mealId: meal.id,
          notes: `For ${meal.title}`, source: "meal", createdBy: session.actorId,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        added++;
      }
      return added;
    };

    if (path === "/api/meals" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!String(body.title ?? "").trim()) return json(res, 400, { error: "title_required" }, req);
      const ingredients = Array.isArray(body.ingredients) ? body.ingredients.map((i) => (typeof i === "string" ? { item: i, have: false } : { item: String(i.item ?? ""), have: !!i.have })).filter((i) => i.item) : [];
      const meal = putMeal({
        id: "meal_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        date: body.date ?? null, slot: ["breakfast", "lunch", "dinner", "snack"].includes(body.slot) ? body.slot : "dinner",
        // Optional suggested time (HH:MM) — used when pushing the meal to the calendar;
        // slot-default times apply when unset (item 5).
        time: typeof body.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time) ? body.time : null,
        title: String(body.title).trim(), notes: body.notes ?? "", ingredients, visibility: body.visibility ?? "household",
        // Recipe metadata (Phase 3): servings is a positive integer or null; recipeUrl free-form.
        servings: Number.isFinite(+body.servings) && +body.servings > 0 ? Math.floor(+body.servings) : null,
        recipeUrl: typeof body.recipeUrl === "string" ? body.recipeUrl.trim() : "",
        // Step-by-step instructions (extracted from the recipe source by web.recipe, or typed).
        instructions: Array.isArray(body.instructions) ? body.instructions.map((s) => String(s).trim()).filter(Boolean).slice(0, 60) : [],
        source: "user", createdBy: g.session.actorId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      const groceriesAdded = syncMealGroceries(meal, g.session);
      audit({ type: "meal.create", mealId: meal.id, groceriesAdded, ok: true }, req, g.session);
      // The count travels so the app can SAY what happened rather than the family finding
      // out later, or not at all.
      return json(res, 200, { meal, groceriesAdded }, req);
    }
    const mealOne = path.match(/^\/api\/meals\/([^/]+)$/);
    if (mealOne && (method === "PATCH" || method === "POST")) {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const m = getMeal(mealOne[1]);
      if (!m || m.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(m, g.session) || (!isAdultRole(g.session.role) && m.createdBy !== g.session.actorId)) return json(res, 403, { error: "forbidden" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const { id, householdId, createdBy, createdAt, ifUpdatedAt, ...patch } = body;
      // Optional optimistic-concurrency guard: two devices editing the same
      // record no longer silently clobber each other — the stale one gets a 409
      // and refetches. Opt-in field, so existing clients are unaffected.
      if (ifUpdatedAt && m.updatedAt && ifUpdatedAt !== m.updatedAt) {
        return json(res, 409, { error: "stale_write", message: "This was changed on another device — refresh and try again.", current: m }, req);
      }
      const updated = patchMeal(m.id, patch);
      audit({ type: "meal.update", mealId: m.id, ok: true }, req, g.session);
      return json(res, 200, { meal: updated }, req);
    }
    if (mealOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const m = getMeal(mealOne[1]);
      if (!m || m.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && m.createdBy !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
      deleteMealRec(m.id);
      // Grocery items carry a real mealId back-reference. Default: unlink (a
      // still-wanted item survives its source meal). With ?groceries=delete the
      // caller opted to remove the meal's ingredients from the list too.
      const dropGroceries = url.searchParams.get("groceries") === "delete";
      const linked = listTasks((t) => t.householdId === g.session.householdId && t.mealId === m.id);
      let removedGroceries = 0;
      for (const t of linked) {
        if (dropGroceries) { deleteTaskRec(t.id); removedGroceries++; }
        else patchTask(t.id, { mealId: null, notes: t.notes === `For ${m.title}` ? "" : t.notes });
      }
      // The meal's calendar event goes with the meal — including the pushed Google
      // copy (best-effort; without it the next subscription sync would resurrect it).
      const linkedEvents = listEvents((e) => e.householdId === g.session.householdId && e.mealId === m.id);
      for (const e of linkedEvents) {
        if (e.provenance?.googleEventId && externalActionsEnabled(g.session.householdId)) {
          void deleteGoogleCopy({ ev: e, householdId: g.session.householdId, actorId: g.session.actorId })
            .then((r) => appendAudit({ type: "calendar.googledelete", eventId: e.id, ok: r.ok }))
            .catch(() => {});
        }
        deleteEventRec(e.id);
      }
      audit({ type: "meal.delete", mealId: m.id, removedEvents: linkedEvents.length, removedGroceries, unlinkedGroceries: dropGroceries ? 0 : linked.length, ok: true }, req, g.session);
      return json(res, 200, { ok: true, removedEvents: linkedEvents.length, removedGroceries, unlinkedGroceries: dropGroceries ? 0 : linked.length }, req);
    }
    const mealGrocery = path.match(/^\/api\/meals\/([^/]+)\/to-grocery$/);
    if (mealGrocery && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const m = getMeal(mealGrocery[1]);
      if (!m || m.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      /* Shares ONE implementation with the automatic add on meal create (syncMealGroceries).
       * This route used to add unconditionally, so once creating a meal also added its
       * ingredients, pressing this button put a second "beans" on the list. Two code paths
       * writing the same list will always drift; now there is one, and it dedupes.
       *
       * Which makes this button a RE-SYNC rather than an add: press it after editing a meal
       * and only genuinely new ingredients appear. Adding nothing is the correct, common
       * answer, and `added: 0` says so honestly. */
      const added = syncMealGroceries(m, g.session);
      audit({ type: "meal.to_grocery", mealId: m.id, added, ok: true }, req, g.session);
      return json(res, 200, { ok: true, added }, req);
    }
    // Push a meal onto the household calendar as a CANONICAL event (item 5). Linked by
    // mealId (same back-reference pattern as groceries); idempotent — re-pushing updates
    // the linked event instead of duplicating it. Once it exists as a canonical event,
    // the existing approval-gated POST /api/calendar/push/:id sends it to Google.
    const mealCal = path.match(/^\/api\/meals\/([^/]+)\/to-calendar$/);
    if (mealCal && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const m = getMeal(mealCal[1]);
      if (!m || m.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!m.date) return json(res, 400, { error: "date_required", message: "Give the meal a date before adding it to the calendar." }, req);
      const SLOT_TIMES = { breakfast: "08:00", lunch: "12:00", dinner: "18:00", snack: "15:00" };
      const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(m.time ?? "") ? m.time : (SLOT_TIMES[m.slot] ?? "18:00");
      const startAt = `${m.date}T${time}:00`;
      const slotLabel = m.slot ? m.slot.charAt(0).toUpperCase() + m.slot.slice(1) : "Dinner";
      const title = `${slotLabel}: ${m.title}`;
      // The event body mirrors the full meal context (recipe link, ingredients,
      // instructions) so the SAME details land in Google Calendar's description.
      const notes = mealEventNotes(m);
      const existing = listEvents((e) => e.householdId === g.session.householdId && e.mealId === m.id)[0];
      if (existing) {
        const updated = patchEvent(existing.id, { title, startAt, notes });
        if (getSettings(g.session.householdId).calendarAutoSync === true && updated.provenance?.googleEventId && externalActionsEnabled(g.session.householdId)) {
          void pushEventToGoogle({ ev: updated, householdId: g.session.householdId, actorId: g.session.actorId })
            .then((r) => appendAudit({ type: "calendar.autopush", eventId: updated.id, ok: r.ok, ...(r.ok ? { action: r.action } : { error: r.error }) })).catch(() => {});
        }
        audit({ type: "meal.to_calendar", mealId: m.id, eventId: existing.id, action: "updated", ok: true }, req, g.session);
        return json(res, 200, { ok: true, event: updated, action: "updated" }, req);
      }
      const ev = putEvent({
        id: "ev_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        title, startAt, endAt: null, location: "", notes, spaceId: "sp-family",
        participantIds: [], driverId: null, ownerId: g.session.actorId, backupOwnerId: null,
        whatToBring: [], checklist: [], travel: null, reminders: [], attachments: [], comments: [],
        mealImpact: null, mealId: m.id, visibility: m.visibility ?? "household", category: "Meal",
        layer: "canonical", status: "confirmed", source: "FamiliOS",
        provenance: { via: "meal", actorId: g.session.actorId },
        createdBy: g.session.actorId, createdAt: Date.now(), updatedAt: new Date().toISOString(),
      });
      audit({ type: "meal.to_calendar", mealId: m.id, eventId: ev.id, action: "created", ok: true }, req, g.session);
      return json(res, 200, { ok: true, event: ev, action: "created" }, req);
    }

    /* ---- Knowledge (KN): user-authored household knowledge ----
     * A real CRUD collection the family owns (custom instructions, family facts,
     * preferences, rules, reference notes) — distinct from auto-generated memory.
     * Mirrors meals: Limited Member+ creates; adult OR the creator edits/deletes;
     * "personal" items are visible only to the creator + adults. Tenant-scoped. */
    if (path === "/api/knowledge" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const items = listKnowledge((k) => k.householdId === g.session.householdId)
        // household → everyone; personal → creator + adults only.
        .filter((k) => k.createdBy === g.session.actorId || k.visibility !== "personal" || isAdultRole(g.session.role))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return json(res, 200, { items }, req);
    }
    if (path === "/api/knowledge" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!String(body.title ?? "").trim()) return json(res, 400, { error: "title_required" }, req);
      const item = addKnowledge({
        id: "kn_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        title: String(body.title).trim(),
        // `type` is a free string (client uses "Custom Instruction","Family Fact","Preference","Rule","Reference Note").
        type: typeof body.type === "string" && body.type.trim() ? body.type.trim() : "Reference Note",
        content: typeof body.content === "string" ? body.content : "",
        tags: Array.isArray(body.tags) ? body.tags.map(String).filter(Boolean).slice(0, 20) : [],
        visibility: body.visibility === "personal" ? "personal" : "household",
        sensitive: !!body.sensitive,
        fileIds: Array.isArray(body.fileIds) ? body.fileIds.map(String).slice(0, 50) : [],
        createdBy: g.session.actorId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      audit({ type: "knowledge.create", knowledgeId: item.id, ok: true }, req, g.session);
      return json(res, 200, { item }, req);
    }
    const knowledgeOne = path.match(/^\/api\/knowledge\/([^/]+)$/);
    if (knowledgeOne && (method === "PATCH" || method === "POST")) {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const k = getKnowledge(knowledgeOne[1]);
      if (!k || k.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && k.createdBy !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const { ifUpdatedAt } = body;
      // Optional optimistic-concurrency guard (same as meals): a stale write 409s and refetches.
      if (ifUpdatedAt && k.updatedAt && ifUpdatedAt !== k.updatedAt) {
        return json(res, 409, { error: "stale_write", message: "This was changed on another device — refresh and try again.", current: k }, req);
      }
      // Never trust the client for id/household/createdBy/timestamps — build the patch from writable fields only.
      const patch = {};
      if (body.title !== undefined) { const t = String(body.title).trim(); if (!t) return json(res, 400, { error: "title_required" }, req); patch.title = t; }
      if (body.type !== undefined) patch.type = typeof body.type === "string" && body.type.trim() ? body.type.trim() : k.type;
      if (body.content !== undefined) patch.content = typeof body.content === "string" ? body.content : "";
      if (body.tags !== undefined) patch.tags = Array.isArray(body.tags) ? body.tags.map(String).filter(Boolean).slice(0, 20) : [];
      if (body.visibility !== undefined) patch.visibility = body.visibility === "personal" ? "personal" : "household";
      if (body.sensitive !== undefined) patch.sensitive = !!body.sensitive;
      if (body.fileIds !== undefined) patch.fileIds = Array.isArray(body.fileIds) ? body.fileIds.map(String).slice(0, 50) : [];
      const updated = patchKnowledge(k.id, patch);
      audit({ type: "knowledge.update", knowledgeId: k.id, ok: true }, req, g.session);
      return json(res, 200, { item: updated }, req);
    }
    if (knowledgeOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const k = getKnowledge(knowledgeOne[1]);
      if (!k || k.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && k.createdBy !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
      removeKnowledge(k.id);
      audit({ type: "knowledge.delete", knowledgeId: k.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }

    /* ---- Calendar subscriptions (CAL): the read-only "linked" calendar layer ----
     * Subscribe to an .ics feed (school/sports/holidays) or paste an .ics. Synced events
     * are layer:"linked" (the events PATCH route already refuses edits — copy to edit).
     * Creating a subscription is an Adult Member+ action; reads are household-scoped. */
    if (path === "/api/calendar/subscriptions" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const subs = listSubscriptions((s) => s.householdId === g.session.householdId).map((s) => {
        // Source account (google subs): the connected account's email + the member who
        // connected it — so the UI can say WHOSE calendar this is. ICS subs have none.
        const account = s.accountId ? getAccountRaw(s.accountId) : null;
        const ownerActorId = account?.connectedByActorId ?? null;
        return {
          id: s.id, name: s.name, url: s.url ?? null, source: s.source, color: s.color ?? null,
          lastSyncAt: s.lastSyncAt ?? null, lastResult: s.lastResult ?? null, eventCount: s.eventCount ?? 0, createdAt: s.createdAt,
          accountId: s.accountId ?? null,
          accountEmail: account?.displayName ?? null,
          ownerActorId,
          ownerName: ownerActorId ? (getMember(ownerActorId)?.displayName ?? null) : null,
        };
      });
      return json(res, 200, { subscriptions: subs }, req);
    }
    // One-call calendar sync: re-pull EVERY subscription (google + ics feeds), then merge
    // Google-side edits back into pushed canonical events — a single "sync now" for
    // clients, tolerant of individual feed failures.
    if (path === "/api/calendar/sync-all" && method === "POST") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const subs = listSubscriptions((s) => s.householdId === g.session.householdId);
      let synced = 0, imported = 0, updated = 0, removed = 0;
      const errors = [];
      for (const sub of subs) {
        try {
          const r = await syncSubscription({ sub, session: g.session });
          patchSubscription(sub.id, { lastSyncAt: Date.now(), lastResult: r.ok ? { imported: r.imported, updated: r.updated, removed: r.removed } : { error: r.error }, eventCount: r.ok ? r.total : (sub.eventCount ?? 0) });
          if (r.ok) { synced++; imported += r.imported; updated += r.updated; removed += r.removed; }
          else errors.push({ id: sub.id, error: r.error });
        } catch (e) { errors.push({ id: sub.id, error: String(e?.message ?? e) }); }
      }
      // Merge-back half (same as POST /api/calendar/pull-google-edits) — best-effort:
      // no connected Google account just means nothing to pull, not a failure.
      let pulled = { checked: 0, merged: 0, conflicts: 0, unlinked: 0 };
      try {
        const p = await pullGoogleEdits({ session: g.session });
        if (p.ok) pulled = { checked: p.checked, merged: p.merged, conflicts: p.conflicts, unlinked: p.unlinked };
      } catch { /* best effort */ }
      audit({ type: "calendar.sync_all", synced, imported, updated, removed, pulled, failed: errors.length, ok: true }, req, g.session);
      return json(res, 200, { ok: true, synced, imported, updated, removed, pulled, errors }, req);
    }
    if (path === "/api/calendar/subscriptions" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Adult Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!String(body.url ?? "").trim()) return json(res, 400, { error: "url_required" }, req);
      const sub = putSubscription({
        id: "sub_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        name: String(body.name ?? "Subscribed calendar").slice(0, 80), url: String(body.url).trim(), source: "url",
        color: nextSubscriptionColor(g.session.householdId),
        createdBy: g.session.actorId, createdAt: Date.now(), updatedAt: new Date().toISOString(),
      });
      const r = await syncSubscription({ sub, session: g.session });
      patchSubscription(sub.id, { lastSyncAt: Date.now(), lastResult: r.ok ? { imported: r.imported, updated: r.updated, removed: r.removed } : { error: r.error }, eventCount: r.ok ? r.total : 0 });
      audit({ type: "calendar.subscribe", subscriptionId: sub.id, ok: r.ok, error: r.ok ? undefined : r.error }, req, g.session);
      return json(res, r.ok ? 200 : 422, { subscription: getSubscription(sub.id), sync: r }, req);
    }
    // Push a FamiliOS canonical event TO Google Calendar (the write half of two-way sync).
    // Approval-first (writing to your real calendar needs sign-off) + deduped: a stored
    // provenance.googleEventId turns re-pushes into updates. Linked (synced) events can't be
    // pushed back. The live Google write goes through apiForAccount (auto-refresh).
    const pushMatch = path.match(/^\/api\/calendar\/push\/([^/]+)$/);
    if (pushMatch && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Adult Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = (await readBody(req)) ?? {};
      const ev = getEvent(pushMatch[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(ev, g.session)) return json(res, 403, { error: "forbidden" }, req);
      if (ev.layer && ev.layer !== "canonical") return json(res, 400, { error: "not_pushable", message: "This event is synced from another calendar — only your own FamiliOS events can be pushed to Google." }, req);
      if (!ev.startAt) return json(res, 400, { error: "no_start", message: "Give the event a start time before pushing it." }, req);
      const account = listAccountsFor(g.session.householdId, g.session.actorId).find((a) => a.provider === "google");
      if (!account) return json(res, 422, { error: "connect_google_first", message: "Connect your Google account (with calendar access) in Connections first." }, req);
      if (!(account.scopes ?? []).some((s) => /calendar/i.test(String(s)))) return json(res, 422, { error: "calendar_scope_missing", message: "Reconnect Google and grant calendar access." }, req);
      const input = { summary: ev.title, start: ev.startAt, location: ev.location ?? "" };
      const gid = ev.provenance?.googleEventId ?? null;
      // Approval-first by default. When the household turned on calendar auto-sync,
      // Google pushes are pre-authorized (an explicit Adult Admin setting) and the
      // gate is skipped — the audit log still records every write.
      const autoSync = getSettings(g.session.householdId).calendarAutoSync === true;
      if (!autoSync) {
        if (!body.approvalId) {
          const a = createApproval({ actorId: g.session.actorId, householdId: g.session.householdId, connectorId: "google", toolId: "calendar.create", input, risk: "Medium", category: "Calendar", preview: `${gid ? "Update" : "Add"} “${ev.title}” ${gid ? "on" : "to"} Google Calendar`, source: "executable" });
          void notifyApproval(a);
          return json(res, 200, { needsApproval: true, approval: publicApproval(a) }, req);
        }
        const c = consumeApproval({ id: body.approvalId, actorId: g.session.actorId, householdId: g.session.householdId, toolId: "calendar.create", input });
        if (c.error) { audit({ type: "calendar.push", eventId: ev.id, ok: false, error: c.error }, req, g.session); return json(res, 422, { error: c.error, message: approvalErrorMessage(c.error) }, req); }
      }
      const r = await pushEventToGoogle({ ev, householdId: g.session.householdId, actorId: g.session.actorId });
      if (!r.ok) { audit({ type: "calendar.push", eventId: ev.id, ok: false, error: r.error, status: r.status }, req, g.session); return json(res, 422, { error: r.error, status: r.status, message: r.message ?? "Google rejected the write." }, req); }
      audit({ type: "calendar.push", eventId: ev.id, googleEventId: r.googleEventId, action: r.action, autoSync, ok: true }, req, g.session);
      return json(res, 200, { ok: true, googleEventId: r.googleEventId, action: r.action }, req);
    }
    // Two-way sync, merge-back half (Phase 9): pull Google-side edits into pushed canonical
    // events. Clean Google edits merge; both-sides-changed flags provenance.conflict for
    // review (never silently overwritten); Google deletions unlink (FamiliOS stays canonical).
    if (path === "/api/calendar/pull-google-edits" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Adult Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const r = await pullGoogleEdits({ session: g.session });
      audit({ type: "calendar.pull_edits", ok: r.ok, ...(r.ok ? { checked: r.checked, merged: r.merged, conflicts: r.conflicts, unlinked: r.unlinked, errors: r.errors } : { error: r.error }) }, req, g.session);
      if (!r.ok) return json(res, 422, { error: r.error, message: r.error === "no_account" ? "Connect your Google account (with calendar access) in Connections first." : undefined }, req);
      return json(res, 200, r, req);
    }
    // Resolve a flagged pull conflict (provenance.conflict) — the human decision the
    // merge-back engine defers to. choice:"google" adopts Google's version; choice:"local"
    // keeps FamiliOS' fields (re-push to sync Google). Either way the flag clears and the
    // merge baseline resets so the next pull doesn't re-flag the same difference.
    const resolveMatch = path.match(/^\/api\/events\/([^/]+)\/resolve-conflict$/);
    if (resolveMatch && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Adult Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = (await readBody(req)) ?? {};
      const ev = getEvent(resolveMatch[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(ev, g.session)) return json(res, 403, { error: "forbidden" }, req);
      const patch = resolveConflictPatch(ev, body.choice);
      if (!patch) return json(res, 400, { error: ev.provenance?.conflict ? "bad_choice" : "no_conflict", message: ev.provenance?.conflict ? 'choice must be "google" or "local".' : "This event has no pending sync conflict." }, req);
      const updated = patchEvent(ev.id, patch);
      audit({ type: "calendar.resolve_conflict", eventId: ev.id, choice: body.choice, ok: true }, req, g.session);
      return json(res, 200, { ok: true, event: updated }, req);
    }
    // Connect the actor's Google Calendar as a read-only linked source (pull sync). Needs a
    // Google account connected in Connections with calendar access. One subscription per
    // account — repeat calls just re-sync. Push (FamiliOS → Google) is a separate build.
    if (path === "/api/calendar/connect-google" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Adult Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const account = listAccountsFor(g.session.householdId, g.session.actorId).find((a) => a.provider === "google");
      if (!account) return json(res, 422, { error: "connect_google_first", message: "Connect your Google account (with calendar access) in Connections first." }, req);
      if (!(account.scopes ?? []).some((s) => /calendar/i.test(String(s)))) return json(res, 422, { error: "calendar_scope_missing", message: "Your Google account isn't authorized for calendar. Reconnect it and grant calendar access." }, req);
      let sub = listSubscriptions((s) => s.householdId === g.session.householdId && s.source === "google" && s.accountId === account.id)[0];
      if (!sub) {
        sub = putSubscription({
          id: "sub_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
          name: `Google Calendar (${account.displayName ?? "primary"})`, url: null, source: "google", accountId: account.id,
          color: nextSubscriptionColor(g.session.householdId),
          createdBy: g.session.actorId, createdAt: Date.now(), updatedAt: new Date().toISOString(),
        });
      }
      const r = await syncSubscription({ sub, session: g.session });
      patchSubscription(sub.id, { lastSyncAt: Date.now(), lastResult: r.ok ? { imported: r.imported, updated: r.updated, removed: r.removed } : { error: r.error }, eventCount: r.ok ? r.total : (sub.eventCount ?? 0) });
      audit({ type: "calendar.connect_google", subscriptionId: sub.id, ok: r.ok, error: r.ok ? undefined : r.error }, req, g.session);
      return json(res, r.ok ? 200 : 422, { subscription: getSubscription(sub.id), sync: r }, req);
    }
    // Paste-import an .ics one-off (no URL); still grouped under a subscription so it's removable.
    if (path === "/api/calendar/import-ics" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Adult Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!String(body.ics ?? "").trim()) return json(res, 400, { error: "ics_required" }, req);
      const sub = putSubscription({
        id: "sub_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        name: String(body.name ?? "Imported calendar").slice(0, 80), url: null, source: "import",
        color: nextSubscriptionColor(g.session.householdId),
        icsText: String(body.ics).slice(0, 200_000), // kept so a re-sync can re-parse the pasted feed
        createdBy: g.session.actorId, createdAt: Date.now(), updatedAt: new Date().toISOString(),
      });
      const r = await syncSubscription({ sub, icsText: String(body.ics), session: g.session });
      if (!r.ok) { deleteSubscriptionRec(sub.id); return json(res, 422, { error: r.error, message: "That didn't look like a valid calendar file." }, req); }
      patchSubscription(sub.id, { lastSyncAt: Date.now(), lastResult: { imported: r.imported, updated: r.updated }, eventCount: r.total });
      audit({ type: "calendar.import", subscriptionId: sub.id, imported: r.imported, ok: true }, req, g.session);
      return json(res, 200, { subscription: getSubscription(sub.id), sync: r }, req);
    }
    const subSync = path.match(/^\/api\/calendar\/subscriptions\/([^/]+)\/sync$/);
    if (subSync && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Adult Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const sub = getSubscription(subSync[1]);
      if (!sub || sub.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      const r = await syncSubscription({ sub, session: g.session });
      patchSubscription(sub.id, { lastSyncAt: Date.now(), lastResult: r.ok ? { imported: r.imported, updated: r.updated, removed: r.removed } : { error: r.error }, eventCount: r.ok ? r.total : (sub.eventCount ?? 0) });
      audit({ type: "calendar.sync", subscriptionId: sub.id, ok: r.ok, error: r.ok ? undefined : r.error }, req, g.session);
      return json(res, r.ok ? 200 : 422, { subscription: getSubscription(sub.id), sync: r }, req);
    }
    const subOne = path.match(/^\/api\/calendar\/subscriptions\/([^/]+)$/);
    if (subOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Adult Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const sub = getSubscription(subOne[1]);
      if (!sub || sub.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      const removed = removeSubscriptionEvents(sub.id, g.session);
      deleteSubscriptionRec(sub.id);
      audit({ type: "calendar.unsubscribe", subscriptionId: sub.id, removedEvents: removed, ok: true }, req, g.session);
      return json(res, 200, { ok: true, removedEvents: removed }, req);
    }

    /* ---- Server-durable assistant conversations (P1.1) ----
     * Threads/messages live server-side, scoped to the actor who owns them. */
    if (path === "/api/conversations" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const mine = listConversations((c) => canSeeConversation(c, g.session))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return json(res, 200, { conversations: mine }, req);
    }
    if (path === "/api/conversations" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const c = putConversation({
        id: "conv_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId, actorId: g.session.actorId,
        // The client seeds this with the truncated first message; titleAuto marks it as a
        // placeholder the namer is allowed to replace (I1).
        title: String(body.title ?? "New chat").slice(0, 80), titleAuto: true, messages: [],
        // An Adult Member's chats are their own — see the silo note. Forced here rather than
        // trusted from the body, so a mis-set toggle can never publish a private thread.
        /* A chat can live in a nest — "it would say Personal, and then GPop + Beannie as its
         * own group, the way it does for the whole household where it says personal or
         * family". Membership is verified here; naming a nest you are not in does not put you
         * in it. An Adult Member is still barred from the HOUSEHOLD space (the silo), but a
         * nest is theirs by consent, so it is open to them. */
        ...(body.visibility === "nest" && body.nestId && canSeeNest(String(body.nestId), g.session.householdId, g.session.actorId)
          ? { visibility: "nest", nestId: String(body.nestId) }
          : { visibility: (body.visibility === "household" && !isAdultMemberOnly(g.session)) ? "household" : "personal" }),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      return json(res, 200, { conversation: c }, req);
    }
    const convOne = path.match(/^\/api\/conversations\/([^/]+)$/);
    if (convOne && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const c = getConversation(convOne[1]);
      if (!canSeeConversation(c, g.session)) return json(res, 404, { error: "not_found" }, req);
      return json(res, 200, { conversation: c }, req);
    }
    // I1 — renaming a thread by hand pins the name: titleAuto:false stops the auto-namer
    // from ever overwriting a title a person chose deliberately.
    // I3 — and the same route moves a thread between Personal and Family, which was
    // previously only possible by starting a new chat.
    if (convOne && method === "PATCH") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const c = getConversation(convOne[1]);
      if (!canSeeConversation(c, g.session)) return json(res, 404, { error: "not_found" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const patch = {};
      if (body.title !== undefined) {
        const title = String(body.title).trim();
        if (!title) return json(res, 400, { error: "title_required" }, req);
        patch.title = title.slice(0, 80);
        patch.titleAuto = false;
      }
      /* I3 [16:45] — "from inside a chat I can't switch between Personal and Family without
       * starting a new one. That's not the correct path."
       *
       * Moving a thread between spaces is a real visibility change, so only its OWNER may do
       * it: making a personal thread family-visible publishes everything already in it, and
       * that is not a decision for anyone else to take on your behalf. */
      if (body.visibility !== undefined) {
        if (c.actorId !== g.session.actorId) {
          return json(res, 403, { error: "forbidden", message: "Only the person who started this chat can move it between Personal and Family." }, req);
        }
        if (body.visibility === "household" && isAdultMemberOnly(g.session)) {
          return json(res, 403, { error: "personal_only", message: "Your chats stay private to you. Sharing one with the household needs an Owner or Adult Admin." }, req);
        }
        patch.visibility = body.visibility === "household" ? "household" : "personal";
      }
      if (Object.keys(patch).length === 0) return json(res, 400, { error: "nothing_to_change" }, req);
      const next = putConversation({ ...c, ...patch, updatedAt: new Date().toISOString() });
      audit({ type: "conversation.update", conversationId: c.id, changed: Object.keys(patch), ok: true }, req, g.session);
      return json(res, 200, { conversation: next }, req);
    }
    if (convOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const c = getConversation(convOne[1]);
      if (!canSeeConversation(c, g.session)) return json(res, 404, { error: "not_found" }, req);
      if (c.actorId !== g.session.actorId && !isAdultRole(g.session.role)) return json(res, 403, { error: "forbidden" }, req);
      deleteConversationRec(c.id);
      return json(res, 200, { ok: true }, req);
    }
    // Append a run-result note to a conversation the actor owns. This is how a
    // finished plan run reports back INTO the chat it was launched from (web +
    // iOS both use it), so results/artifacts live in the thread durably instead
    // of only on the Activity screen.
    const convMsg = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (convMsg && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const c = getConversation(convMsg[1]);
      if (!canSeeConversation(c, g.session)) return json(res, 404, { error: "not_found" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const text = String(body.text ?? "").trim();
      if (!text) return json(res, 400, { error: "text_required" }, req);
      c.messages.push({
        role: "assistant", text: text.slice(0, 8000), at: new Date().toISOString(),
        kind: body.kind === "run_result" ? "run_result" : "note",
        ...(body.runId ? { runId: String(body.runId).slice(0, 64) } : {}),
      });
      c.updatedAt = new Date().toISOString();
      putConversation(c);
      return json(res, 200, { conversation: c }, req);
    }

    /* ---- Memory & artifacts (read; written by runs) — household-scoped ---- */
    if (path === "/api/memory" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Personal-scoped memory is private to its actor; family/household memory is shared.
      const all = listMemory({ householdId: g.session.householdId, limit: 200 });
      const visible = all.filter((m) => m.scope !== "personal" || m.source?.actorId === g.session.actorId || isAdultRole(g.session.role));
      return json(res, 200, { memory: visible }, req);
    }
    // Archive/delete a memory entry the actor can see (mirrors the GET visibility rule).
    // Safe by construction: memory is a reference record, not a live dependency — see
    // deleteMemoryEntry's comment in store.mjs for why this never breaks baked-in behavior.
    const memOne = path.match(/^\/api\/memory\/([^/]+)$/);
    if (memOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const m = getMemoryEntry(memOne[1]);
      if (!m || m.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      const canSee = m.scope !== "personal" || m.source?.actorId === g.session.actorId || isAdultRole(g.session.role);
      if (!canSee) return json(res, 404, { error: "not_found" }, req); // don't leak existence
      deleteMemoryEntry(m.id);
      audit({ type: "memory.delete", memoryId: m.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }
    // WP-007 s5 — retrieval-quality memory search + profile for the Activity & Memory
    // tab's search box. Scoped to the session's own household (containerTag), same
    // visibility boundary as GET /api/memory. Honest degraded flag when the provider
    // (sidecar or its sqlite-FTS5 fallback — see memory-provider.mjs/DEC-014) can't answer,
    // so the client can show real fallback copy instead of silently returning nothing.
    if (path === "/api/memory/search" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const q = String(url.searchParams.get("q") ?? "").trim();
      const containerTag = g.session.householdId;
      const [searchRes, profileRes] = await Promise.all([
        q ? memoryProvider.search(q, { containerTag, limit: 20 }) : Promise.resolve({ ok: true, degraded: false, results: [] }),
        memoryProvider.profile({ containerTag }),
      ]);
      const degraded = !!(searchRes?.degraded || profileRes?.degraded);
      return json(res, 200, {
        ok: true,
        degraded,
        results: Array.isArray(searchRes?.results) ? searchRes.results : [],
        profile: profileRes?.ok ? { totalMemories: profileRes.totalMemories, byType: profileRes.byType, byScope: profileRes.byScope, highlights: profileRes.highlights } : null,
      }, req);
    }
    if (path === "/api/artifacts" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const all = listArtifacts({ householdId: g.session.householdId, runId: url.searchParams.get("runId") || undefined, limit: 100 });
      return json(res, 200, { artifacts: all }, req);
    }

    /* ---- Contact methods (server-owned registry) ----
     * Canonical per-member delivery addresses with verified/opt-in state and a
     * per-agent allowlist. Reads are household-scoped (the roster's coordination
     * data — no secrets). Writes are role-gated: adults manage anyone's methods,
     * everyone else manages only their own. Honest states: a new external method
     * starts unverified/Pending and notify refuses it until it's verified;
     * in-app/dashboard methods have no external address to confirm, so they are
     * born verified. Changing an external address resets verification. */
    if (path === "/api/contact-methods" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const methods = listContactMethods((c) => c.householdId === g.session.householdId);
      return json(res, 200, { contactMethods: methods }, req);
    }
    if (path === "/api/contact-methods" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const memberId = String(body.memberId ?? g.session.actorId).trim();
      if (!isAdultRole(g.session.role) && memberId !== g.session.actorId) return json(res, 403, { error: "insufficient_role" }, req);
      const member = getMember(memberId);
      if (!member || member.archived || (member.householdId ?? "local") !== g.session.householdId) return json(res, 404, { error: "member_not_found" }, req);
      const label = String(body.label ?? "").trim();
      if (!label) return json(res, 400, { error: "label_required" }, req);
      if (!CONTACT_METHOD_TYPES.includes(body.type)) return json(res, 400, { error: "bad_type", valid: CONTACT_METHOD_TYPES }, req);
      const fixed = CONTACT_FIXED_VALUES[body.type];
      const value = fixed ?? String(body.value ?? "").trim();
      if (!fixed && !validContactValue(body.type, value)) return json(res, 400, { error: "invalid_value", message: body.type === "Email" ? "Enter a valid email address." : "Enter a valid phone number." }, req);
      // Client→server migration preserves ids (idempotent: an existing id is returned
      // unchanged, mirroring the agents migration contract).
      const suppliedId = typeof body.id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(body.id) ? body.id : null;
      if (suppliedId) {
        const existing = getContactMethod(suppliedId);
        if (existing && existing.householdId === g.session.householdId) return json(res, 200, { contactMethod: existing }, req);
        if (existing) return json(res, 409, { error: "id_conflict" }, req);
      }
      const cm = putContactMethod({
        id: suppliedId ?? ("cm_" + crypto.randomBytes(8).toString("hex")),
        householdId: g.session.householdId, memberId, label, type: body.type, value,
        // Internal channels are deliverable by construction; external ones must be
        // verified first — via the code loop (send-verification/verify). Only an
        // adult may carry over an already-verified state on create (the migration
        // path); a non-adult can never self-attest an address they merely typed.
        verified: fixed ? true : (isAdultRole(g.session.role) && !!body.verified),
        optInStatus: fixed ? "Opted In" : (isAdultRole(g.session.role) && OPT_IN_STATES.includes(body.optInStatus) ? body.optInStatus : "Pending"),
        // SECURITY (finding C3): same adult gate on CREATE — otherwise the whole
        // check above is bypassed by setting the allowlist at creation time.
        allowedAgentIds: (isAdultRole(g.session.role) && Array.isArray(body.allowedAgentIds))
          ? body.allowedAgentIds.filter((a) => typeof a === "string" && (() => { const x = getAgent(a); return x && (x.householdId === g.session.householdId || x.householdId === "local"); })())
          : [],
        createdBy: g.session.actorId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      audit({ type: "contact_method.create", contactMethodId: cm.id, memberId, methodType: cm.type, ok: true }, req, g.session);
      return json(res, 200, { contactMethod: cm }, req);
    }
    /* ---- The true verification loop ----
     * send-verification: a 6-digit code goes out through the method's REAL channel
     * (email via the caller's connected Google, text via the SMS connector). Honest
     * when the channel isn't set up — nothing is sent and the response says so.
     * verify: entering the code proves control of the address → verified + opted-in.
     * One pending challenge per method; 10-minute expiry; 5 attempts; 60s resend
     * cooldown after a successful send. Manage-gated like every other write. */
    const contactSendVerification = path.match(/^\/api\/contact-methods\/([^/]+)\/send-verification$/);
    if (contactSendVerification && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const cm = getContactMethod(contactSendVerification[1]);
      if (!cm || cm.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && cm.memberId !== g.session.actorId) return json(res, 403, { error: "insufficient_role" }, req);
      if (cm.verified) return json(res, 400, { error: "already_verified", message: "This contact method is already verified." }, req);
      if (CONTACT_FIXED_VALUES[cm.type]) return json(res, 400, { error: "not_applicable", message: "In-app methods have no external address to verify." }, req);
      // Resend cooldown only counts sends that actually went out — a needs-setup
      // failure shouldn't lock the user out of retrying right after they fix it.
      const prior = getContactVerification(cm.id);
      if (prior?.delivered && prior.nextSendAt > Date.now()) {
        return json(res, 429, { error: "resend_too_soon", retryInMs: prior.nextSendAt - Date.now(), message: "A code was just sent — wait a moment before requesting another." }, req);
      }
      const code = String(crypto.randomInt(100000, 1000000));
      const out = await sendVerificationCode({ session: g.session, method: cm, code });
      if (!out.ok) {
        deleteContactVerification(cm.id); // no code reached the address; nothing to enter
        audit({ type: "contact_method.verification_sent", contactMethodId: cm.id, channel: out.channel, ok: false, needsSetup: out.needsSetup ?? undefined }, req, g.session);
        return json(res, 200, { ok: false, channel: out.channel, needsSetup: out.needsSetup, message: out.message ?? "Couldn't send the verification code." }, req);
      }
      putContactVerification({
        id: cm.id, householdId: g.session.householdId, code, channel: out.channel, delivered: true,
        attempts: 0, maxAttempts: 5, expiresAt: Date.now() + 10 * 60 * 1000, nextSendAt: Date.now() + 60 * 1000,
        requestedBy: g.session.actorId, createdAt: new Date().toISOString(),
      });
      audit({ type: "contact_method.verification_sent", contactMethodId: cm.id, channel: out.channel, ok: true }, req, g.session);
      return json(res, 200, { ok: true, channel: out.channel, expiresInMs: 10 * 60 * 1000, message: `Code sent to ${cm.value}.` }, req);
    }
    const contactVerify = path.match(/^\/api\/contact-methods\/([^/]+)\/verify$/);
    if (contactVerify && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const cm = getContactMethod(contactVerify[1]);
      if (!cm || cm.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && cm.memberId !== g.session.actorId) return json(res, 403, { error: "insufficient_role" }, req);
      if (cm.verified) return json(res, 200, { ok: true, alreadyVerified: true, contactMethod: cm }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const given = String(body.code ?? "").trim();
      if (!given) return json(res, 400, { error: "code_required" }, req);
      const ch = getContactVerification(cm.id);
      if (!ch) return json(res, 400, { error: "no_pending_verification", message: "No code has been sent — request one first." }, req);
      if (ch.expiresAt < Date.now()) {
        deleteContactVerification(cm.id);
        return json(res, 400, { error: "code_expired", message: "That code expired — request a new one." }, req);
      }
      if (ch.attempts >= ch.maxAttempts) {
        deleteContactVerification(cm.id);
        return json(res, 429, { error: "too_many_attempts", message: "Too many wrong attempts — request a new code." }, req);
      }
      // Constant-time compare; short-lived local codes, but no reason to be sloppy.
      // (Shape-check first — timingSafeEqual throws on unequal lengths.)
      const wellFormed = /^\d{6}$/.test(given);
      if (!wellFormed || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(String(ch.code)))) {
        const updated = patchContactVerification(cm.id, { attempts: ch.attempts + 1 });
        audit({ type: "contact_method.verify", contactMethodId: cm.id, ok: false, error: "code_incorrect" }, req, g.session);
        return json(res, 400, { error: "code_incorrect", attemptsLeft: Math.max(0, ch.maxAttempts - updated.attempts), message: "That code doesn't match." }, req);
      }
      deleteContactVerification(cm.id); // single-use
      const updated = patchContactMethod(cm.id, {
        verified: true, optInStatus: "Opted In",
        verifiedVia: ch.channel, verifiedBy: g.session.actorId, verifiedAt: new Date().toISOString(),
      });
      audit({ type: "contact_method.verify", contactMethodId: cm.id, via: ch.channel, ok: true }, req, g.session);
      return json(res, 200, { ok: true, contactMethod: updated }, req);
    }
    const contactOne = path.match(/^\/api\/contact-methods\/([^/]+)$/);
    if (contactOne && (method === "PATCH" || method === "POST")) {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const cm = getContactMethod(contactOne[1]);
      if (!cm || cm.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && cm.memberId !== g.session.actorId) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const patch = {};
      if (body.label != null) { const l = String(body.label).trim(); if (!l) return json(res, 400, { error: "label_required" }, req); patch.label = l; }
      if (body.value != null) {
        if (CONTACT_FIXED_VALUES[cm.type]) return json(res, 400, { error: "value_fixed", message: "This method type has no external address to change." }, req);
        const v = String(body.value).trim();
        if (!validContactValue(cm.type, v)) return json(res, 400, { error: "invalid_value" }, req);
        // A changed address is a NEW address — honesty requires re-verification,
        // and any code sent to the OLD address must stop working immediately.
        // SECURITY (adversarial review, finding C2): a changed address is a NEW address,
        // so verification resets — and the PER-AGENT SEND ALLOWLIST must reset with it.
        // Leaving `allowedAgentIds` intact let the method's owner (any role, including
        // Child View) repoint an adult-granted standing consent at an address they
        // control, re-verify via the household's own SMS connector, and receive the
        // family's automated messages at an outside number. Granting an agent send
        // rights is an adult act; re-granting after a repoint must be one too.
        if (v !== cm.value) {
          patch.value = v; patch.verified = false; patch.optInStatus = "Pending"; patch.verifiedVia = null;
          patch.verifiedBy = null; patch.verifiedAt = null; patch.allowedAgentIds = [];
          deleteContactVerification(cm.id);
        }
      }
      if (body.allowedAgentIds != null) {
        if (!Array.isArray(body.allowedAgentIds)) return json(res, 400, { error: "bad_allowed_agents" }, req);
        // SECURITY (adversarial review, finding C3): this allowlist IS the standing
        // consent that lets an agent send to this address unattended, with no per-run
        // approval. It was the only field on this record NOT adult-gated — so a
        // Guest could self-verify an address they control and then grant an agent
        // permission to mail it every morning, with no adult ever involved. It is
        // adult-only, and every id must resolve to an agent in THIS household.
        if (!isAdultRole(g.session.role)) {
          return json(res, 403, { error: "insufficient_role", message: "Allowing a helper to message a contact is an adult decision — ask an adult to grant it." }, req);
        }
        const ids = body.allowedAgentIds.filter((a) => typeof a === "string");
        const bad = ids.filter((id) => { const a = getAgent(id); return !a || (a.householdId !== g.session.householdId && a.householdId !== "local"); });
        if (bad.length) return json(res, 400, { error: "unknown_agent", message: "One of those helpers doesn't exist in this household.", ids: bad }, req);
        patch.allowedAgentIds = ids;
      }
      if (body.verified != null) {
        // The honest path to verified is the code loop (send-verification → verify).
        // Setting it directly is an ADULT-ONLY manual override, recorded as such —
        // a member can no longer self-attest an address by flipping a flag.
        if (body.verified && !isAdultRole(g.session.role)) {
          return json(res, 403, { error: "insufficient_role", message: "Verify with the code sent to this contact method, or ask an adult to override." }, req);
        }
        patch.verified = !!body.verified;
        patch.verifiedVia = body.verified ? "manual" : null;
        if (body.verified) { patch.verifiedBy = g.session.actorId; patch.verifiedAt = new Date().toISOString(); }
      }
      if (body.optInStatus != null) {
        if (!OPT_IN_STATES.includes(body.optInStatus)) return json(res, 400, { error: "bad_opt_in_status", valid: OPT_IN_STATES }, req);
        patch.optInStatus = body.optInStatus;
      }
      const updated = patchContactMethod(cm.id, patch);
      audit({ type: "contact_method.update", contactMethodId: cm.id, verified: updated.verified, ok: true }, req, g.session);
      return json(res, 200, { contactMethod: updated }, req);
    }
    if (contactOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const cm = getContactMethod(contactOne[1]);
      if (!cm || cm.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && cm.memberId !== g.session.actorId) return json(res, 403, { error: "insufficient_role" }, req);
      deleteContactMethodRec(cm.id);
      deleteContactVerification(cm.id); // a pending code for a deleted method is dead
      audit({ type: "contact_method.delete", contactMethodId: cm.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }

    /* ---- Notification delivery (item 16b) ----
     * Real routing to a contact method's channel (in-app/dashboard now; email via the
     * caller's connected Google; text via the sms connector). Honest about what needs
     * setup. Email/text use the SESSION actor's own connected account — never someone
     * else's. GET lists the actor's own in-app notifications.
     * Pass methodId to resolve the channel/address from the server-owned registry
     * (verified + opt-in enforced, per-agent allowlist honored); methodType/to stays
     * for ad-hoc sends. */
    if (path === "/api/notify" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const methodType = String(body.methodType ?? body.channel ?? "In-App");
      // SECURITY (adversarial review, finding H2): this route reaches the SAME external
      // delivery path as the scheduler, but had no role floor and made the per-agent
      // allowlist optional — a caller who simply omitted `agentId` skipped gate 3
      // entirely and could text any verified method in the household. Since WP-005
      // rests its whole consent story on that allowlist, an authenticated-but-
      // unprivileged bypass of it cannot stand. External channels now require an adult;
      // in-app/dashboard notifications stay open to everyone (they reach no one outside).
      // The hole is specifically messaging SOMEONE ELSE unattended; notifying your own
      // verified address is legitimate and stays open to every role.
      const target = typeof body.methodId === "string" ? getContactMethod(body.methodId) : null;
      const external = ["Email", "Phone/Text"].includes(methodType)
        || (target && ["Email", "Phone/Text"].includes(target.type));
      const ownMethod = target && target.memberId === g.session.actorId;
      if (external && !ownMethod && !isAdultRole(g.session.role)) {
        return json(res, 403, { error: "insufficient_role", message: "Messaging someone else outside the household is an adult action." }, req);
      }
      const out = await deliverNotification({
        session: g.session, methodId: typeof body.methodId === "string" ? body.methodId : null,
        methodType, to: body.to ?? null, title: body.title, body: body.body,
        agentId: typeof body.agentId === "string" ? body.agentId : null,
      });
      audit({ type: "notify", channel: out.channel, methodId: body.methodId ?? undefined, ok: out.ok, needsSetup: out.needsSetup ?? undefined }, req, g.session);
      return json(res, 200, out, req);
    }
    if (path === "/api/notifications" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const mine = listNotifications((n) => n.householdId === g.session.householdId && n.actorId === g.session.actorId)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 100);
      return json(res, 200, { notifications: mine }, req);
    }
    const notifRead = path.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (notifRead && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const all = listNotifications((n) => n.id === notifRead[1] && n.householdId === g.session.householdId && n.actorId === g.session.actorId);
      if (!all.length) return json(res, 404, { error: "not_found" }, req);
      markNotificationRead(notifRead[1]);
      return json(res, 200, { ok: true }, req);
    }

    /* ---- Risk-class overrides (item 9) ----
     * An Owner/Adult Admin may re-class a tool/function's risk and skip its approval
     * gate for their household. Server-enforced in the engine's resolveTool; every
     * change is audited. GET returns the effective catalog + current overrides so
     * clients render exactly what the engine will enforce. */
    if (path === "/api/risk-overrides" && method === "GET") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const overrides = listRiskOverrides((o) => o.householdId === g.session.householdId);
      return json(res, 200, { overrides, catalog: toolCatalog(g.session) }, req);
    }
    if (path === "/api/risk-overrides" && method === "PUT") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const toolId = String(body.toolId ?? "").trim();
      const known = toolCatalog(g.session).find((t) => t.toolId === toolId);
      if (!known) return json(res, 404, { error: "unknown_tool" }, req);
      const RISKS = ["Low", "Medium", "High", "Sensitive"];
      const riskClass = body.riskClass == null ? null : (RISKS.includes(body.riskClass) ? body.riskClass : undefined);
      if (riskClass === undefined) return json(res, 400, { error: "invalid_risk_class" }, req);
      const rec = putRiskOverride({
        id: `${g.session.householdId}:${toolId}`, householdId: g.session.householdId, toolId,
        riskClass, skipApproval: !!body.skipApproval,
        setBy: g.session.actorId, setAt: new Date().toISOString(),
      });
      audit({ type: "risk_override.set", toolId, riskClass: rec.riskClass, skipApproval: rec.skipApproval, ok: true }, req, g.session);
      return json(res, 200, { override: rec }, req);
    }
    const rovOne = path.match(/^\/api\/risk-overrides\/(.+)$/);
    if (rovOne && method === "DELETE") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const toolId = decodeURIComponent(rovOne[1]);
      const existing = getRiskOverride(g.session.householdId, toolId);
      if (!existing) return json(res, 404, { error: "not_found" }, req);
      deleteRiskOverrideRec(existing.id);
      audit({ type: "risk_override.cleared", toolId, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }

    /* ---- Playbooks (Phase 6): server-owned household workflow library ---- */
    if (path === "/api/playbooks" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const all = listPlaybooks((p) => p.householdId === g.session.householdId || p.householdId === "local")
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return json(res, 200, { playbooks: all }, req);
    }
    if (path === "/api/playbooks" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!String(body.name ?? "").trim()) return json(res, 400, { error: "name_required" }, req);
      const steps = (Array.isArray(body.steps) ? body.steps : []).map(String).filter(Boolean);
      if (steps.length === 0) return json(res, 400, { error: "steps_required" }, req);
      const pb = putPlaybook({
        id: "pb_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        name: String(body.name).trim(), description: String(body.description ?? ""),
        whenToUse: String(body.whenToUse ?? ""), category: String(body.category ?? "Custom"),
        steps, requiredConnections: (Array.isArray(body.requiredConnections) ? body.requiredConnections : []).map(String),
        outputFormat: String(body.outputFormat ?? ""), approvalRules: (Array.isArray(body.approvalRules) ? body.approvalRules : []).map(String),
        archived: false, system: false, createdBy: g.session.actorId,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      audit({ type: "playbook.create", playbookId: pb.id, ok: true }, req, g.session);
      return json(res, 200, { playbook: pb }, req);
    }
    const playbookOne = path.match(/^\/api\/playbooks\/([^/]+)$/);
    if (playbookOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const pb = getPlaybook(playbookOne[1]);
      if (!pb || (pb.householdId !== g.session.householdId && pb.householdId !== "local")) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && pb.createdBy !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
      deletePlaybookRec(pb.id);
      audit({ type: "playbook.delete", playbookId: pb.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }

    /* ---- Household files (Phase 5): server-owned file library ----
     * Metadata + bytes live server-side so every client (web/mobile) sees the same
     * library. Upload is JSON base64 (no multipart dependency), capped at ~5 MB. */
    if (path === "/api/files" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      /* Files uploaded BEFORE `kind` existed carry no kind, and the back-compat rule treats a
       * missing kind as a document — which is right for a school form and wrong for the photo
       * that is currently somebody's face. So the ones a member actually points at are
       * retagged here, once, on read: "the profile images are still not stored elsewhere…
       * they're shown as home files."
       *
       * Deliberately derived from the ROSTER rather than guessed from a filename: a file is an
       * avatar because a member's photoFileId names it, which is the only thing that makes it
       * one. Cheap (a Set built from members already in memory) and self-healing — a photo
       * replaced tomorrow stops being an avatar the moment nobody points at it.
       */
      {
        const claimed = new Set(
          listMembers((m) => m.householdId === g.session.householdId)
            .map((m) => m.photoFileId)
            .filter((x) => typeof x === "string" && !x.startsWith("emoji:")),
        );
        for (const fid of claimed) {
          const f = getFileRec(fid);
          if (f && f.householdId === g.session.householdId && (f.kind ?? "document") !== "avatar") {
            putFileRec({ ...f, kind: "avatar" });
          }
        }
      }
      // Avatars are excluded: they're chrome, not household documents (see the POST below).
      // `?include=all` exists so a future "everything stored for this household" view — or a
      // support question about disk use — can still see them, rather than the app pretending
      // the bytes aren't there.
      /* O3 [08:31] — the briefing was attributed to "m-owner". "It needs to be their real name
       * as it is in the app." The record stores an actor id, which is right; resolving it to a
       * name is the server's job, not something every screen should re-derive. */
      const roster = new Map(listMembers((m) => m.householdId === g.session.householdId).map((m) => [m.actorId, m.displayName]));
      const includeAll = url.searchParams.get("include") === "all";
      const visible = listFiles((f) => f.householdId === g.session.householdId)
        .filter((f) => includeAll || (f.kind ?? "document") !== "avatar")
        .filter((f) => canSeeEntity(f, g.session))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map((f) => ({ ...f, uploadedByName: roster.get(f.uploadedBy) ?? null }));
      return json(res, 200, { files: visible }, req);
    }
    if (path === "/api/files" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const name = String(body.name ?? "").trim();
      if (!name) return json(res, 400, { error: "name_required" }, req);
      /* "Photos, files, documents, videos, whatever seem to have a 5 MB cap, which is very
       * small." It was 5 MB — small enough that a phone photo at full resolution, or any
       * video at all, bounced. 25 MB per page now (base64 inflates by 4/3, hence ~34 MB), with
       * the request ceiling above sized to clear it. */
      const MAX_FILE_BYTES = 25 * 1024 * 1024;
      const CAP = Math.ceil(MAX_FILE_BYTES * 4 / 3); // ~34 MB of base64, enforced per page
      // A logical file can carry multiple pages (front+back of an ID card, a multi-page
      // scan). `pages: [{ name?, base64 }]` writes one blob per page; the classic single
      // `contentBase64` upload is preserved verbatim as a 1-page file (full back-compat).
      const hasPages = Array.isArray(body.pages) && body.pages.length > 0;
      const pageBufs = [];
      if (hasPages) {
        if (body.pages.length > 20) return json(res, 400, { error: "too_many_pages", message: "Cap is 20 pages per file." }, req);
        for (const p of body.pages) {
          const pb64 = String(p?.base64 ?? "");
          if (!pb64) return json(res, 400, { error: "content_required" }, req);
          if (pb64.length > CAP) return json(res, 413, { error: "too_large", message: "Each page is capped at 25 MB." }, req);
          let buf;
          try { buf = Buffer.from(pb64, "base64"); } catch { return json(res, 400, { error: "bad_base64" }, req); }
          if (!buf || buf.length === 0) return json(res, 400, { error: "bad_base64" }, req);
          pageBufs.push({ name: typeof p?.name === "string" && p.name.trim() ? p.name.trim() : null, buf });
        }
      } else {
        const b64 = String(body.contentBase64 ?? "");
        if (!b64) return json(res, 400, { error: "content_required" }, req);
        if (b64.length > CAP) return json(res, 413, { error: "too_large", message: "Files are capped at 25 MB." }, req);
        let buf;
        try { buf = Buffer.from(b64, "base64"); } catch { return json(res, 400, { error: "bad_base64" }, req); }
        if (!buf || buf.length === 0) return json(res, 400, { error: "bad_base64" }, req);
        pageBufs.push({ name: null, buf });
      }
      /* IMG_2957.PNG appeared three times in the library at 3.4 MB each — attaching the same
       * photo twice created a second copy of it, and a third. Same household, same name, same
       * bytes: that is one file the family uploaded more than once, not three documents.
       *
       * Deduped on a content hash. The EXISTING record is returned untouched, so anything
       * already pointing at it (a member's avatar, a chat attachment, a knowledge item) keeps
       * resolving. Different bytes under the same name are still a new file — a v2 of a form
       * is not a duplicate. */
      const contentHash = crypto.createHash("sha256")
        .update(String(name))
        .update(Buffer.concat(pageBufs.map((p) => p.buf)))
        .digest("hex");
      {
        const existing = listFiles((f) => f.householdId === g.session.householdId && f.contentHash === contentHash)[0];
        if (existing) {
          audit({ type: "file.upload", fileId: existing.id, name, deduped: true, ok: true }, req, g.session);
          return json(res, 200, { file: existing, deduped: true }, req);
        }
      }
      const id = "file_" + crypto.randomBytes(8).toString("hex");
      // Page 0's blob lives under the record id (so a legacy single-page reader still works);
      // extra pages get `<id>_p1`, `<id>_p2`, … . pageBlobIds indexes them in order.
      const pageBlobIds = pageBufs.map((_, i) => (i === 0 ? id : `${id}_p${i}`));
      const sizeBytes = pageBufs.reduce((n, p) => n + p.buf.length, 0);
      const rec = putFileRec({
        id, householdId: g.session.householdId,
        name, mime: typeof body.mime === "string" ? body.mime : "application/octet-stream",
        sizeBytes, pageCount: pageBufs.length, pageBlobIds, pageNames: pageBufs.map((p) => p.name),
        tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 10) : [],
        visibility: body.visibility ?? "household", spaceId: body.spaceId ?? "sp-family",
        uploadedBy: g.session.actorId, source: body.source ?? "upload",
        /* Reported: "the profile images are being stored as home files instead of in a
         * dedicated location." They were — an avatar went through the same upload path as a
         * school form, so everyone's face turned up in the family document library.
         *
         * The blob still lives in the same store (it has to; that's what serves the picture),
         * but the record now says what it is, and the library lists DOCUMENTS. An avatar is
         * chrome, not a household file. Anything without a kind stays a document, so every
         * file uploaded before today is unaffected. */
        kind: body.kind === "avatar" ? "avatar" : "document",
        contentHash,
        createdAt: new Date().toISOString(),
      });
      pageBufs.forEach((p, i) => writeFileBlob(pageBlobIds[i], p.buf));
      audit({ type: "file.upload", fileId: rec.id, name, sizeBytes, pageCount: pageBufs.length, ok: true }, req, g.session);
      return json(res, 200, { file: rec }, req);
    }
    /* O2 [08:24] — "the Daily Household Briefing has some odd characters in it, and it says
     * that it cannot be previewed. We need the ability to preview that."
     *
     * The odd characters were the split-UTF-8 bug (fixed in readRaw). The "cannot be
     * previewed" was real: the client only renders text and images inline, so a PDF got
     * "no inline preview — open it on the web app to download", which is a dead end on a phone.
     *
     * The server can now read a file (file-understanding.mjs) — so it does, and returns text a
     * phone can show. A PDF becomes its text, a photo becomes a description. Anything genuinely
     * unreadable returns the honest reason rather than a shrug. */
    const filePreview = path.match(/^\/api\/files\/([^/]+)\/preview$/);
    if (filePreview && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const f = getFileRec(filePreview[1]);
      if (!f || f.householdId !== g.session.householdId || !canSeeEntity(f, g.session)) return json(res, 404, { error: "not_found" }, req);
      const out = await understandFile(f.id, { householdId: g.session.householdId });
      if (!out.ok) return json(res, 200, { ok: false, error: out.error, message: out.message }, req);
      return json(res, 200, { ok: true, kind: out.kind, text: out.text, truncated: !!out.truncated }, req);
    }
    const fileContent = path.match(/^\/api\/files\/([^/]+)\/content$/);
    if (fileContent && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const f = getFileRec(fileContent[1]);
      if (!f || f.householdId !== g.session.householdId || !canSeeEntity(f, g.session)) return json(res, 404, { error: "not_found" }, req);
      // Legacy/single-page files have no pageBlobIds — their single blob is under the record id.
      const blobIds = Array.isArray(f.pageBlobIds) && f.pageBlobIds.length ? f.pageBlobIds : [f.id];
      const page = parseInt(url.searchParams.get("page") ?? "0", 10);
      const idx = Number.isFinite(page) ? page : 0;
      if (idx < 0 || idx >= blobIds.length) return json(res, 404, { error: "page_not_found" }, req);
      const buf = readFileBlob(blobIds[idx]);
      if (!buf) return json(res, 410, { error: "content_missing" }, req);
      const pageName = Array.isArray(f.pageNames) ? f.pageNames[idx] : null;
      return json(res, 200, { name: pageName || f.name, mime: f.mime, page: idx, pageCount: f.pageCount ?? blobIds.length, contentBase64: buf.toString("base64") }, req);
    }
    const fileOne = path.match(/^\/api\/files\/([^/]+)$/);
    if (fileOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const f = getFileRec(fileOne[1]);
      if (!f || f.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && f.uploadedBy !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
      deleteFileRec(f.id);
      audit({ type: "file.delete", fileId: f.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }

    /* ---- Skill registry ---- */
    if (path === "/api/skills" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const all = listSkills((s) => s.householdId === g.session.householdId || s.householdId === "local");
      const domain = url.searchParams.get("domain") || undefined;
      const status = url.searchParams.get("status") || undefined;
      const out = all
        .filter((s) => (!domain || s.domain === domain) && (!status || s.status === status))
        .sort((a, b) => (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? 1 : -1);
      return json(res, 200, { skills: out.map(publicSkill) }, req);
    }
    if (path === "/api/skills" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!body.name?.trim()) return json(res, 400, { error: "name_required" }, req);
      const skill = createSkill(body, g.session);
      audit({ type: "skill.create", skillId: skill.id, name: skill.name, ok: true }, req, g.session);
      return json(res, 200, { skill: publicSkill(skill) }, req);
    }
    // infer-functions must come before the /:id match
    if (path === "/api/skills/infer-functions" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!body.description?.trim()) return json(res, 400, { error: "description_required" }, req);
      const out = await inferFunctions({ description: body.description, session: g.session, providerId: body.providerId });
      audit({ type: "skill.infer", ok: out.ok, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }
    const skillBase = path.match(/^\/api\/skills\/([^/]+)$/);
    if (skillBase) {
      const id = skillBase[1];
      if (method === "GET") {
        const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const s = getSkill(id);
        if (!s || (s.householdId !== "local" && s.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        return json(res, 200, { skill: publicSkill(s) }, req);
      }
      if (method === "PUT") {
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const s = getSkill(id);
        if (!s || (s.householdId !== "local" && s.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
        const updated = replaceSkill(id, body);
        if (!updated) return json(res, 404, { error: "not_found" }, req);
        audit({ type: "skill.update", skillId: id, ok: true }, req, g.session);
        return json(res, 200, { skill: publicSkill(updated) }, req);
      }
      if (method === "PATCH") {
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const s = getSkill(id);
        if (!s || (s.householdId !== "local" && s.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
        const updated = partialUpdateSkill(id, body);
        audit({ type: "skill.patch", skillId: id, ok: true }, req, g.session);
        return json(res, 200, { skill: publicSkill(updated) }, req);
      }
      if (method === "DELETE") {
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const s = getSkill(id);
        if (!s || (s.householdId !== "local" && s.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        const r = deleteSkill(id);
        if (r.error) return json(res, r.error === "not_found" ? 404 : 422, { error: r.error }, req);
        audit({ type: "skill.delete", skillId: id, ok: true }, req, g.session);
        return json(res, 200, { ok: true }, req);
      }
    }
    const skillAction = path.match(/^\/api\/skills\/([^/]+)\/(run|test|duplicate|promote|rollback|versions|readiness)$/);
    if (skillAction) {
      const [, id, action] = skillAction;
      // readiness is a READ, like versions — it reports what's unfinished, it changes nothing.
      const isRead = action === "versions" || action === "readiness";
      const g = gate(req, isRead ? { requireSession: true } : { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const s = getSkill(id);
      if (!s || (s.householdId !== "local" && s.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
      if (action === "versions" && method === "GET") {
        return json(res, 200, { versions: listSkillVersions(id) }, req);
      }
      // ISS-117: the builder asks for readiness BEFORE offering a real test, so the
      // unresolved list can be shown while it's still fixable — rather than discovered
      // by running the thing and reading the wreckage.
      if (action === "readiness" && method === "GET") {
        return json(res, 200, { readiness: skillReadiness(s, g.session) }, req);
      }
      if (method !== "POST") return json(res, 405, { error: "method_not_allowed" }, req);
      if (action === "run") {
        const body = await readBody(req);
        const out = await testSkill({ skillId: id, params: body?.params ?? {}, session: g.session });
        // Forward message/unresolved: flattening this to a bare error code is what made a
        // half-built skill fail with nothing a family could act on (ISS-117).
        if (out.error) return json(res, out.error === "unknown_skill" ? 404 : 422, { error: out.error, ...(out.message ? { message: out.message } : {}), ...(out.unresolved ? { unresolved: out.unresolved } : {}) }, req);
        audit({ type: "skill.run", skillId: id, runId: out.run?.id, ok: true }, req, g.session);
        return json(res, 200, { run: out.run }, req);
      }
      if (action === "test") {
        const body = await readBody(req);
        const params = body?.params ?? (s.test_cases?.[0]?.params ?? {});
        const out = await testSkill({ skillId: id, params, session: g.session });
        if (out.error) return json(res, out.error === "unknown_skill" ? 404 : 422, { error: out.error, ...(out.message ? { message: out.message } : {}), ...(out.unresolved ? { unresolved: out.unresolved } : {}) }, req);
        audit({ type: "skill.test", skillId: id, runId: out.run?.id, ok: true }, req, g.session);
        return json(res, 200, { run: out.run }, req);
      }
      if (action === "duplicate") {
        const copy = duplicateSkill(id, g.session);
        if (!copy) return json(res, 404, { error: "not_found" }, req);
        audit({ type: "skill.duplicate", skillId: id, newId: copy.id, ok: true }, req, g.session);
        return json(res, 200, { skill: publicSkill(copy) }, req);
      }
      if (action === "promote") {
        const r = promoteSkill(id);
        if (r?.error) return json(res, 422, { error: r.error }, req);
        audit({ type: "skill.promote", skillId: id, ok: true }, req, g.session);
        return json(res, 200, { skill: publicSkill(r) }, req);
      }
      if (action === "rollback") {
        const body = await readBody(req);
        const r = rollbackSkill(id, body?.targetVersion ?? null);
        if (r?.error) return json(res, r.error === "not_found" ? 404 : 422, { error: r.error }, req);
        audit({ type: "skill.rollback", skillId: id, targetVersion: body?.targetVersion ?? null, ok: true }, req, g.session);
        return json(res, 200, { skill: publicSkill(r) }, req);
      }
    }

    /* ---- Function registry (Slice 4) ---- */
    // Draft a candidate function definition from a capability description (item 13) —
    // must precede the /:id match. Drafting only; the human reviews + saves via POST.
    if (path === "/api/functions/draft" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const out = await draftFunction({ description: body.description, session: g.session, providerId: body.providerId });
      audit({ type: "function.draft", ok: out.ok, fallback: !!out.fallback }, req, g.session);
      return json(res, out.ok ? 200 : 400, out, req);
    }
    if (path === "/api/functions" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const out = listPublicFunctions(g.session, { type: url.searchParams.get("type") || undefined, state: url.searchParams.get("state") || undefined });
      return json(res, 200, { functions: out }, req);
    }
    if (path === "/api/functions" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!body.name?.trim()) return json(res, 400, { error: "name_required" }, req);
      if (body.type && !FUNCTION_TYPES.includes(body.type)) return json(res, 400, { error: "unknown_type" }, req);
      const fn = createFunction(body, g.session);
      audit({ type: "function.create", functionId: fn.id, name: fn.name, fnType: fn.type, ok: true }, req, g.session);
      return json(res, 200, { function: publicFunction(fn, g.session) }, req);
    }
    // Metadata endpoints must precede the /:id match.
    if (path === "/api/functions/tool-catalog" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { tools: toolCatalog(g.session), types: FUNCTION_TYPES, states: FUNCTION_STATES }, req);
    }
    const fnBase = path.match(/^\/api\/functions\/([^/]+)$/);
    if (fnBase) {
      const id = fnBase[1];
      if (method === "GET") {
        const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const f = getFunction(id);
        if (!f || (f.householdId !== "local" && f.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        return json(res, 200, { function: publicFunction(f, g.session) }, req);
      }
      if (method === "PUT" || method === "PATCH") {
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const f = getFunction(id);
        if (!f || (f.householdId !== "local" && f.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
        const updated = method === "PUT" ? replaceFunction(id, body) : partialUpdateFunction(id, body);
        if (!updated) return json(res, 404, { error: "not_found" }, req);
        audit({ type: "function.update", functionId: id, ok: true }, req, g.session);
        return json(res, 200, { function: publicFunction(updated, g.session) }, req);
      }
      if (method === "DELETE") {
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const f = getFunction(id);
        if (!f || (f.householdId !== "local" && f.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        const r = deleteFunction(id);
        if (r.error) return json(res, r.error === "not_found" ? 404 : 422, { error: r.error }, req);
        audit({ type: "function.delete", functionId: id, ok: true }, req, g.session);
        return json(res, 200, { ok: true }, req);
      }
    }
    const fnAction = path.match(/^\/api\/functions\/([^/]+)\/(test|duplicate|promote|deprecate|rollback|versions)$/);
    if (fnAction) {
      const [, id, action] = fnAction;
      const g = gate(req, action === "versions" ? { requireSession: true } : { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const f = getFunction(id);
      if (!f || (f.householdId !== "local" && f.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
      if (action === "versions" && method === "GET") return json(res, 200, { versions: listFunctionVersions(id) }, req);
      if (method !== "POST") return json(res, 405, { error: "method_not_allowed" }, req);
      if (action === "test") {
        const body = await readBody(req);
        const out = await testFunction({ id, input: body?.input, confirm: !!body?.confirm, session: g.session });
        if (out.error === "not_found") return json(res, 404, { error: "not_found" }, req);
        audit({ type: "function.test", functionId: id, ok: !!out.ok, error: out.ok ? undefined : out.error }, req, g.session);
        return json(res, 200, out, req);
      }
      if (action === "duplicate") {
        const copy = duplicateFunction(id, g.session);
        if (!copy) return json(res, 404, { error: "not_found" }, req);
        audit({ type: "function.duplicate", functionId: id, newId: copy.id, ok: true }, req, g.session);
        return json(res, 200, { function: publicFunction(copy, g.session) }, req);
      }
      if (action === "promote") {
        const r = promoteFunction(id, { householdId: g.session.householdId, actorId: g.session.actorId });
        if (r?.error) return json(res, 422, { error: r.error, state: r.state, message: r.message }, req);
        audit({ type: "function.promote", functionId: id, ok: true }, req, g.session);
        return json(res, 200, { function: publicFunction(r, g.session) }, req);
      }
      if (action === "deprecate") {
        const r = deprecateFunction(id);
        if (r?.error) return json(res, 422, { error: r.error }, req);
        audit({ type: "function.deprecate", functionId: id, ok: true }, req, g.session);
        return json(res, 200, { function: publicFunction(r, g.session) }, req);
      }
      if (action === "rollback") {
        const body = await readBody(req);
        const r = rollbackFunction(id, body?.targetVersion ?? null);
        if (r?.error) return json(res, r.error === "not_found" ? 404 : 422, { error: r.error }, req);
        audit({ type: "function.rollback", functionId: id, targetVersion: body?.targetVersion ?? null, ok: true }, req, g.session);
        return json(res, 200, { function: publicFunction(r, g.session) }, req);
      }
    }

    // E1 [10:55] — "It's just raw text. It needs address autocomplete, smart sorting like
    // most web apps." Fires on keystrokes from the event location field, so it stays cheap:
    // labels and addresses only, no ratings, no drive times. A dead upstream returns an empty
    // list rather than an error — a lookup that can't answer must never interrupt typing.
    if (path === "/api/places/suggest" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
      const out = await suggestAddresses(url.searchParams.get("q") ?? "", {
        lat: num(url.searchParams.get("lat")), lng: num(url.searchParams.get("lng")),
      });
      return json(res, 200, out, req);
    }

    // G6 — the starter-helper catalog, grouped. Mobile carried four hand-written entries
    // while the web read thirteen from its own file; this is the one list both can ask for.
    // Static and household-independent, so any signed-in member may read it.
    if (path === "/api/agent-templates" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { sections: agentTemplateSections() }, req);
    }

    /* ---- Agent registry (Slice 5) ---- */
    if (path === "/api/agents" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { agents: listPublicAgents(g.session, { status: url.searchParams.get("status") || undefined }) }, req);
    }
    if (path === "/api/agents" && method === "POST") {
      // Adult Member may create helpers — PERSONAL ones only (see the silo note above).
      const g = gate(req, { minRole: "Adult Member" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!body.name?.trim()) return json(res, 400, { error: "name_required" }, req);
      const may = mayWriteAgent(g.session, null, body.visibility);
      if (!may.ok) return json(res, 403, { error: may.error, ...(may.message ? { message: may.message } : {}) }, req);
      const agent = createAgent(body, g.session);
      audit({ type: "agent.create", agentId: agent.id, name: agent.name, ok: true }, req, g.session);
      return json(res, 200, { agent: publicAgent(agent) }, req);
    }
    const agentBase = path.match(/^\/api\/agents\/([^/]+)$/);
    if (agentBase) {
      const id = agentBase[1];
      if (method === "GET") {
        const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const a = getAgent(id);
        if (!a || (a.householdId !== "local" && a.householdId !== g.session.householdId) || !agentVisibleTo(a, g.session)) return json(res, 404, { error: "not_found" }, req);
        return json(res, 200, { agent: publicAgent(a) }, req);
      }
      if (method === "PUT" || method === "PATCH") {
        const g = gate(req, { minRole: "Adult Member" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const a = getAgent(id);
        if (!a || (a.householdId !== "local" && a.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        {
          // An Adult Member edits their own personal helper. They cannot reach a household
          // helper, and cannot promote their own into one — that's a household-level act.
          const may = mayWriteAgent(g.session, a, undefined);
          if (!may.ok) return json(res, 403, { error: may.error, ...(may.message ? { message: may.message } : {}) }, req);
          const bodyPeek = await readBody(req);
          if (!bodyPeek) return json(res, 400, { error: "malformed_json" }, req);
          const promoting = mayWriteAgent(g.session, a, bodyPeek.visibility);
          if (!promoting.ok) return json(res, 403, { error: promoting.error, ...(promoting.message ? { message: promoting.message } : {}) }, req);
          req.__prereadBody = bodyPeek;
        }
        const body = req.__prereadBody ?? await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
        // The session travels so approvalPolicy.unattended can be attributed to a real
        // person with real standing (agents.mjs sanitizeApprovalPolicy) — its high-risk tier
        // is only honoured for an Owner/Adult Admin, and a request body can't claim that.
        const updated = method === "PUT" ? replaceAgent(id, body, g.session) : partialUpdateAgent(id, body, g.session);
        audit({ type: "agent.update", agentId: id, ok: true }, req, g.session);
        return json(res, 200, { agent: publicAgent(updated) }, req);
      }
      if (method === "DELETE") {
        const g = gate(req, { minRole: "Adult Member" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const a = getAgent(id);
        if (!a || (a.householdId !== "local" && a.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        const mayDel = mayWriteAgent(g.session, a, undefined);
        if (!mayDel.ok) return json(res, 403, { error: mayDel.error, ...(mayDel.message ? { message: mayDel.message } : {}) }, req);
        const r = deleteAgent(id);
        if (r.error) return json(res, r.error === "not_found" ? 404 : 422, { error: r.error }, req);
        audit({ type: "agent.delete", agentId: id, ok: true }, req, g.session);
        return json(res, 200, { ok: true }, req);
      }
    }
    const agentAction = path.match(/^\/api\/agents\/([^/]+)\/(run|duplicate|rollback|versions|context)$/);
    if (agentAction) {
      const [, id, action] = agentAction;
      const g = gate(req, (action === "versions" || action === "context") ? { requireSession: true } : { minRole: "Adult Member" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const a = getAgent(id);
      if (!a || (a.householdId !== "local" && a.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
      // Running or copying a helper is a write in every way that matters — it can reach
      // tools and send things — so it obeys the same rule as editing one.
      if (action === "run" || action === "duplicate" || action === "rollback") {
        const mayRun = mayWriteAgent(g.session, a, undefined);
        if (!mayRun.ok) return json(res, 403, { error: mayRun.error, ...(mayRun.message ? { message: mayRun.message } : {}) }, req);
      }
      if (action === "versions" && method === "GET") return json(res, 200, { versions: listAgentVersions(id) }, req);
      if (action === "context" && method === "GET") return json(res, 200, { context: agentContext(a, g.session) }, req);
      if (method !== "POST") return json(res, 405, { error: "method_not_allowed" }, req);
      if (action === "run") {
        const body = await readBody(req);
        const out = await orchestrate({ source: body?.source ?? "agent", via: "agent", agentId: id, goal: body?.goal, skillId: body?.skillId, params: body?.params ?? {}, session: g.session });
        if (out.error) return json(res, out.error === "unknown_agent" ? 404 : 422, { error: out.error, message: out.message }, req);
        audit({ type: "agent.run", agentId: id, runId: out.run?.id, droppedSteps: out.droppedSteps, ok: true }, req, g.session);
        return json(res, 200, { run: out.run, droppedSteps: out.droppedSteps }, req);
      }
      if (action === "duplicate") {
        const copy = duplicateAgent(id, g.session);
        if (!copy) return json(res, 404, { error: "not_found" }, req);
        audit({ type: "agent.duplicate", agentId: id, newId: copy.id, ok: true }, req, g.session);
        return json(res, 200, { agent: publicAgent(copy) }, req);
      }
      if (action === "rollback") {
        const body = await readBody(req);
        const r = rollbackAgent(id, body?.targetVersion ?? null);
        if (r?.error) return json(res, r.error === "not_found" ? 404 : 422, { error: r.error }, req);
        audit({ type: "agent.rollback", agentId: id, targetVersion: body?.targetVersion ?? null, ok: true }, req, g.session);
        return json(res, 200, { agent: publicAgent(r) }, req);
      }
    }

    /* ---- Trigger registry (Slice 6) — real server-side triggers ---- */
    if (path === "/api/triggers" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { triggers: listPublicTriggers(g.session, { type: url.searchParams.get("type") || undefined }) }, req);
    }
    if (path === "/api/triggers" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!body.name?.trim()) return json(res, 400, { error: "name_required" }, req);
      if (body.type && !TRIGGER_TYPES.includes(body.type)) return json(res, 400, { error: "unknown_type" }, req);
      const t = createTrigger(body, g.session, Date.now());
      audit({ type: "trigger.create", triggerId: t.id, name: t.name, triggerType: t.type, ok: true }, req, g.session);
      return json(res, 200, { trigger: publicTrigger(t) }, req);
    }
    const triggerBase = path.match(/^\/api\/triggers\/([^/]+)$/);
    if (triggerBase) {
      const id = triggerBase[1];
      if (method === "GET") {
        const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const t = getTrigger(id);
        if (!t || (t.householdId !== "local" && t.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        return json(res, 200, { trigger: publicTrigger(t) }, req);
      }
      if (method === "PUT" || method === "PATCH") {
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const t = getTrigger(id);
        if (!t || (t.householdId !== "local" && t.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
        const updated = updateTrigger(id, body, Date.now());
        audit({ type: "trigger.update", triggerId: id, ok: true }, req, g.session);
        return json(res, 200, { trigger: publicTrigger(updated) }, req);
      }
      if (method === "DELETE") {
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const t = getTrigger(id);
        if (!t || (t.householdId !== "local" && t.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        const r = deleteTrigger(id);
        if (r.error) return json(res, r.error === "not_found" ? 404 : 422, { error: r.error }, req);
        audit({ type: "trigger.delete", triggerId: id, ok: true }, req, g.session);
        return json(res, 200, { ok: true }, req);
      }
    }
    const triggerFire = path.match(/^\/api\/triggers\/([^/]+)\/fire$/);
    if (triggerFire && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const t = getTrigger(triggerFire[1]);
      if (!t || (t.householdId !== "local" && t.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
      const body = await readBody(req);
      const out = await fireTrigger(t, { triggerType: "manual", payload: body?.payload });
      audit({ type: "trigger.manual_fire", triggerId: t.id, runId: out.runId, ok: out.ok, error: out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }

    // WP-101 slice 4 — the "compile step" template instantiation never had: validate a
    // candidate automation's acting agent / tool steps / integrations / multi-agent role
    // assignments against the REAL registries before the client lets it go "Active".
    // Read-only (see automation-preflight.mjs) — any session member may check.
    if (path === "/api/automations/validate" && method === "POST") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!body.plan || typeof body.plan !== "object") return json(res, 400, { error: "plan_required" }, req);
      const result = preflightAutomation({
        templateId: typeof body.templateId === "string" ? body.templateId : undefined,
        plan: body.plan,
        agentId: typeof body.agentId === "string" ? body.agentId : undefined,
        multiAgentRoles: Array.isArray(body.multiAgentRoles) ? body.multiAgentRoles : undefined,
        session: g.session,
      });
      return json(res, 200, result, req);
    }

    /* ---- OAuth start (PKCE; state bound to actor + household + provider) ---- */
    const oauthStartMatch = path.match(/^\/api\/oauth\/([^/]+)\/start$/);
    if (oauthStartMatch && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!externalActionsEnabled(g.session.householdId)) return json(res, 423, { ok: false, error: "external_actions_disabled" }, req);
      const provider = connectorProviderById(oauthStartMatch[1]);
      if (!provider) return json(res, 404, { ok: false, error: "unknown_provider" }, req);
      if (!providerConfigured(provider)) return json(res, 422, { ok: false, error: "not_configured_by_deployment", message: `This deployment has not set ${provider.clientIdEnv} / ${provider.clientSecretEnv}.` }, req);
      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = provider.usePKCE ? crypto.createHash("sha256").update(codeVerifier).digest("base64url") : undefined;
      // Mobile flows mark the state string itself (`<provider>.m.<nonce>`) so the
      // callback can hand control back to the app even if the persisted state
      // record is lost or expired (otherwise the user is stranded in the browser).
      const isMobileStart = req.headers["x-homeops-mobile"] === "1";
      const state = `${provider.id}.${isMobileStart ? "m." : ""}${crypto.randomBytes(16).toString("hex")}`;
      const urlOut = buildAuthUrl(provider, oauthRedirectUri(), state, codeChallenge);
      putOAuthState(state, { provider: provider.id, actorId: g.session.actorId, householdId: g.session.householdId, codeVerifier, appOrigin: req.headers.origin, from: req.headers["x-homeops-mobile"] === "1" ? "mobile" : "web" });
      audit({ type: "oauth.start", provider: provider.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true, url: urlOut }, req);
    }

    /* ---- Jobs (list / run) ---- */
    if (path === "/api/jobs" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { jobs: JOBS.map(jobView) }, req);
    }
    const jobRun = path.match(/^\/api\/jobs\/([^/]+)\/run$/);
    if (jobRun && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const job = JOBS.find((x) => x.id === jobRun[1]);
      if (!job) return json(res, 404, { error: "unknown_job" }, req);
      const out = await runJob(job, "manual");
      audit({ type: "job.manual_run", jobId: job.id, ok: out.ok, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, { job: jobView(job), result: out }, req);
    }

    /* ---- Browser automation (honest handshake) ---- */
    if (path === "/api/browser/session" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!externalActionsEnabled(g.session.householdId)) return json(res, 423, { ok: false, error: "external_actions_disabled" }, req);
      const h = await healthCheck("browser");
      audit({ type: "browser.session", ok: h.ok, error: h.ok ? undefined : h.status }, req, g.session);
      if (!h.ok) return json(res, 422, { ok: false, status: "runtime_unavailable", message: "No executable browser automation runtime is connected. Set BROWSER_RUNTIME_URL to a reachable runtime to enable." }, req);
      return json(res, 200, { ok: true, status: "login_required", message: "Runtime reachable. Sign in within the secure browser session — we never ask for your password." }, req);
    }

    /* ---- Settings (kill switch, owner PIN) — admin only ---- */
    if (path === "/api/settings" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const s = getSettings(g.session.householdId);
      return json(res, 200, { settings: { externalActionsEnabled: s.externalActionsEnabled !== false, ownerPinSet: !!s.ownerPinHash, aiActiveProvider: s.aiActiveProvider ?? null, calendarAutoSync: s.calendarAutoSync === true, autoApproveImprovements: s.autoApproveImprovements !== false, autoApproveImprovementsDefaulted: typeof s.autoApproveImprovements !== "boolean", timezone: s.timezone ?? null, hideProfilesPreAuth: s.hideProfilesPreAuth === true } }, req);
    }
    if (path === "/api/settings" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const prev = getSettings(g.session.householdId);
      const patch = {};
      if (typeof body.externalActionsEnabled === "boolean") patch.externalActionsEnabled = body.externalActionsEnabled;
      // Calendar auto-sync: Adult Admin opt-in that pre-authorizes Google Calendar
      // pushes (no per-event approvals) and turns on the server-triggered two-way sweep.
      if (typeof body.calendarAutoSync === "boolean") patch.calendarAutoSync = body.calendarAutoSync;
      // AI-judged auto-approval of LOW-risk improvement proposals (default ON). When off,
      // every proposal — even low-risk — waits for a human in the evolution review queue.
      if (typeof body.autoApproveImprovements === "boolean") patch.autoApproveImprovements = body.autoApproveImprovements;
      // WP-010 pre-auth privacy (ISS-015): when ON, this household's roster is hidden from
      // the pre-auth profile picker to anyone without a session for it (see /api/profiles).
      if (typeof body.hideProfilesPreAuth === "boolean") patch.hideProfilesPreAuth = body.hideProfilesPreAuth;
      if (typeof body.ownerPin === "string" && body.ownerPin) patch.ownerPinHash = crypto.createHash("sha256").update(body.ownerPin).digest("hex");
      // Household timezone: an IANA zone name (e.g. "America/New_York") that anchors
      // "every day at 7 AM" triggers to a real wall-clock time (server/triggers.mjs
      // nextAnchorOccurrence). Without this, a scheduled trigger silently falls back to
      // the SERVER's clock (UTC on Render) — "7 AM" then means 7 AM UTC, not 7 AM local.
      // `timezone: null` explicitly clears it back to that disclosed fallback.
      if (body.timezone === null) patch.timezone = null;
      else if (typeof body.timezone === "string" && body.timezone) {
        if (!isValidTimezone(body.timezone)) return json(res, 400, { error: "invalid_timezone" }, req);
        patch.timezone = body.timezone;
      }
      const next = setSettings(patch, g.session.householdId);
      audit({ type: "settings.update", ok: true, changed: Object.keys(patch), prevExternalActions: prev.externalActionsEnabled, nextExternalActions: next.externalActionsEnabled }, req, g.session);
      return json(res, 200, { settings: { externalActionsEnabled: next.externalActionsEnabled !== false, ownerPinSet: !!next.ownerPinHash, aiActiveProvider: next.aiActiveProvider ?? null, calendarAutoSync: next.calendarAutoSync === true, autoApproveImprovements: next.autoApproveImprovements !== false, autoApproveImprovementsDefaulted: typeof next.autoApproveImprovements !== "boolean", timezone: next.timezone ?? null, hideProfilesPreAuth: next.hideProfilesPreAuth === true } }, req);
    }

    /* ---- AI providers ---- */
    if (path === "/api/ai/providers" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { providers: listAIProviders(g.session.householdId) }, req);
    }
    const aiCfg = path.match(/^\/api\/ai\/providers\/([^/]+)\/config$/);
    if (aiCfg && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!aiProviderById(aiCfg[1])) return json(res, 404, { error: "unknown_provider" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const p = setProviderConfig(aiCfg[1], body, g.session.householdId);
      audit({ type: "ai.config", providerId: aiCfg[1], ok: true }, req, g.session);
      return json(res, 200, { provider: p }, req);
    }
    if (aiCfg && method === "DELETE") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const p = revokeProvider(aiCfg[1], g.session.householdId); if (!p) return json(res, 404, { error: "unknown_provider" }, req);
      audit({ type: "ai.revoke", providerId: aiCfg[1], ok: true }, req, g.session);
      return json(res, 200, { provider: p }, req);
    }
    const aiHealth = path.match(/^\/api\/ai\/providers\/([^/]+)\/health$/);
    if (aiHealth && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const h = await providerHealth(aiHealth[1]);
      audit({ type: "ai.health", providerId: aiHealth[1], ok: h.ok }, req, g.session);
      return json(res, 200, h, req);
    }
    const aiModels = path.match(/^\/api\/ai\/providers\/([^/]+)\/models$/);
    if (aiModels && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const m = await providerModels(aiModels[1]);
      return json(res, m.ok ? 200 : 422, m, req);
    }
    if (path === "/api/ai/active" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (body.providerId && !aiProviderById(body.providerId)) return json(res, 404, { error: "unknown_provider" }, req);
      setActiveProvider(body.providerId ?? null, g.session.householdId);
      audit({ type: "ai.active", providerId: body.providerId ?? null, ok: true }, req, g.session);
      return json(res, 200, { activeProvider: body.providerId ?? null }, req);
    }
    if (path === "/api/ai/chat" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const gated = planGate(g, res, req); if (gated) return gated;
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const id = body.providerId || getSettings(g.session.householdId).aiActiveProvider;
      if (!id) return json(res, 400, { error: "no_provider", message: "No AI provider selected." }, req);
      const out = await providerChat(id, { messages: body.messages ?? [], model: body.model });
      audit({ type: "ai.chat", providerId: id, ok: out.ok, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }

    /* ---- Planner brain: plain English → plan / mini app / playbook ---- */
    if (path === "/api/agent/plan" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const gated = planGate(g, res, req); if (gated) return gated;
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const out = await planFromGoal({ goal: body.goal, session: g.session, providerId: body.providerId });
      audit({ type: "agent.plan", ok: out.ok, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }
    if (path === "/api/assistant" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const aiGated = childAiGate(g, res, req); if (aiGated) return aiGated;
      const gated = planGate(g, res, req); if (gated) return gated;
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      /* THE ATTACHMENT BUG. Recorded verbatim: "I'm not receiving readable attachment
       * contents, so I can't inspect the specific image you sent here."
       *
       * That was true. The client uploaded the file, showed the chip, and passed
       * `context.attachedFileId` — and nothing on this side ever opened it. The model got a
       * filename and was asked to describe a photo.
       *
       * The file is now READ before the turn: text is decoded, a photo goes through the
       * household's own vision model, and the result is handed to the assistant as context.
       * A file we genuinely can't read reports why, in the reply, instead of the assistant
       * apologising for an emptiness it can't explain. */
      await attachFileContext(body, g.session);

      // Prior turns from the durable conversation ride into the model call —
      // otherwise the assistant forgets facts stated one message earlier.
      const histConv = body.conversationId ? getConversation(body.conversationId) : null;
      const history = histConv && canSeeConversation(histConv, g.session) ? histConv.messages : [];
      // WP-006 slice 2 — plan chat against the acting agent's (agt_household, effective)
      // PERMITTED catalog. ensureOpenDefaultAgent neutralizes the seeded-narrow allow-list
      // (the same widening the chat run itself applies), so ordinary chat capability is
      // never shrunk — only a household's explicit DENY reaches the model's menu, and a
      // local provider additionally gets the relevance-ranked, budget-capped catalog.
      const actingAgent = ensureOpenDefaultAgent("agt_household");
      const out = await assistantRespond({ message: body.message, context: body.context, session: g.session, providerId: body.providerId, history, agent: actingAgent });
      demoteBuildForRole(out, g.session);
      // Do-requests EXECUTE immediately (C-intel): a plan from chat auto-starts as a
      // durable server run — no "Run plan" click. Approval-gated steps still pause
      // for human sign-off inside the run, and results append back to this thread.
      // Only BUILD proposals (agent creation) wait for explicit confirmation.
      if (out.ok && out.kind === "plan" && out.plan && roleAtLeast(g.session.role, "Limited Member")) {
        try {
          // WP-006 slice 1 — routed through the single orchestrate() choke point (which
          // delegates to runAssistantPlan). The chat run still carries the attributed
          // agent identity so per-agent-gated tools (notably homeops.notify_contact) run
          // from a plain ask with the WP-003 visible-skip clamp. Rollbacks: env
          // HOMEOPS_CHAT_AGENT_ATTRIBUTION=off (attribution) / HOMEOPS_ORCHESTRATE_ENTRY=off.
          const { run } = await orchestrate({ source: "assistant", via: "chat", plan: out.plan, session: g.session, conversationId: body.conversationId ?? null });
          out.run = publicRun(run);
          audit({ type: "run.start", runId: run.id, source: "assistant", ok: true }, req, g.session);
        } catch (e) {
          out.answer = `${out.answer}\n\n(I couldn't start it: ${String(e?.message ?? e)})`;
        }
      }
      // Server-durable thread: if a conversation is named, persist the turn so history
      // survives refresh and is owned by the server, not the client. Failed turns are
      // persisted too — the user saw their question and the honest error, so a refresh
      // must not erase the exchange (that was the "history gone after refresh" bug).
      if (body.conversationId) {
        const conv = getConversation(body.conversationId);
        if (conv && canSeeConversation(conv, g.session)) {
          const at = new Date().toISOString();
          appendConversationMessage(conv.id, { role: "user", text: String(body.message), at });
          // `build` persisted too — otherwise a build-proposal card vanished on refresh
          // and the user had no durable evidence the assistant ever offered to build.
          appendConversationMessage(conv.id, out.ok
            ? { role: "assistant", kind: out.kind, text: out.answer ?? "", plan: out.plan ?? null, build: out.build ?? null, runId: out.run?.id ?? null, model: out.model ?? null, at }
            : { role: "assistant", kind: "error", text: out.message || "I couldn't respond — no AI provider is available. Add one in Settings → AI Providers, then ask me again.", error: out.error ?? "assistant_error", at });
          // I1 — name the thread from the first exchange (see maybeNameConversation).
          if (out.ok) maybeNameConversation(conv.id, { question: String(body.message), answer: out.answer ?? out.plan?.summary ?? out.build?.summary ?? "", session: g.session });
        }
      }
      audit({ type: "assistant.respond", ok: out.ok, kind: out.kind, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }
    // SSE streaming assistant — same as POST /api/assistant but streams tokens to the
    // client as they arrive, then sends a "done" event with the fully parsed result.
    // Clients that don't support SSE can fall back to POST /api/assistant unchanged.
    if (path === "/api/assistant/stream" && method === "POST") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const aiGated = childAiGate(g, res, req); if (aiGated) return aiGated;
      const gated = planGate(g, res, req); if (gated) return gated;
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      // Same as POST /api/assistant — and this is the route the app really uses, so an
      // attachment that only worked on the non-streaming path would still look broken.
      await attachFileContext(body, g.session);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...corsHeaders(req) });
      let tokenCount = 0;
      try {
        const histConv = body.conversationId ? getConversation(body.conversationId) : null;
        const history = histConv && canSeeConversation(histConv, g.session) ? histConv.messages : [];
        // WP-006 slice 2 — same acting-agent catalog pruning as POST /api/assistant.
        const actingAgent = ensureOpenDefaultAgent("agt_household");
        const out = await assistantStream(
          { message: body.message, context: body.context, session: g.session, providerId: body.providerId, history, agent: actingAgent },
          (_tok) => { tokenCount++; if (tokenCount % 4 === 0) res.write(`data: ${JSON.stringify({ type: "progress", tokens: tokenCount })}\n\n`); },
        );
        demoteBuildForRole(out, g.session); // ISS-011 — the streaming path gates identically

        // WP-003 slice 4 (thread order, ISS-005/009/011/016) — persist the user's OWN
        // turn BEFORE the run below is ever started. startRun (engine.mjs) does not
        // await execution — driveRun runs in the background — so a fast, real,
        // no-approval step can finish and have onRunFinished (assistant-runs.mjs)
        // append a run_result to this SAME conversation before this handler got
        // around to recording what the user actually asked. That produced threads
        // where the run's own reaction to a message appeared ABOVE the message
        // itself. Moving this append here guarantees the user's turn's position in
        // the durable array can never be at the mercy of how fast the run resolves.
        //
        // Rejected alternative: sort by the `at` timestamp at render time instead.
        // Rejected because the race is a WRITE-time problem, not a display one — the
        // user-turn message used to be timestamped only AFTER the run had already
        // returned, so its `at` was genuinely later in wall-clock terms than the
        // run_result's; no render-side sort can un-invert a timestamp captured too
        // late, and every other reader of this durable array (another device, a
        // future admin tool) would still see the wrong order in the stored data.
        let conv = null;
        if (body.conversationId) {
          const c = getConversation(body.conversationId);
          if (c && canSeeConversation(c, g.session)) {
            conv = c;
            appendConversationMessage(conv.id, { role: "user", text: String(body.message), at: new Date().toISOString() });
          }
        }
        // Do-requests auto-execute here too (see POST /api/assistant): the run starts
        // before the "done" event so the client can attach to it immediately.
        if (out.ok && out.kind === "plan" && out.plan && roleAtLeast(g.session.role, "Limited Member")) {
          try {
            // WP-006 slice 1 — same single orchestrate() choke point as POST /api/assistant
            // (see the comment there); the streaming route must attribute identically.
            const { run } = await orchestrate({ source: "assistant", via: "chat", plan: out.plan, session: g.session, conversationId: body.conversationId ?? null });
            out.run = publicRun(run);
            audit({ type: "run.start", runId: run.id, source: "assistant", ok: true }, req, g.session);
          } catch (e) {
            out.answer = `${out.answer}\n\n(I couldn't start it: ${String(e?.message ?? e)})`;
          }
        }
        // Same server-durable persistence as POST /api/assistant — this was previously
        // MISSING here, which is why every conversation created through the real chat UI
        // (which always streams) stayed empty (messages: []) server-side forever: history
        // never survived a refresh because it was never written past the client's memory.
        // Failed turns persist as well (see POST /api/assistant).
        if (conv) {
          appendConversationMessage(conv.id, out.ok
            ? { role: "assistant", kind: out.kind, text: out.answer ?? "", plan: out.plan ?? null, build: out.build ?? null, runId: out.run?.id ?? null, model: out.model ?? null, at: new Date().toISOString() }
            : { role: "assistant", kind: "error", text: out.message || "I couldn't respond — no AI provider is available. Add one in Settings → AI Providers, then ask me again.", error: out.error ?? "assistant_error", at: new Date().toISOString() });
          // I1 — the streaming path is the one the real chat UI uses, so naming has to happen
          // here too or it would never fire in practice.
          if (out.ok) maybeNameConversation(conv.id, { question: String(body.message), answer: out.answer ?? out.plan?.summary ?? out.build?.summary ?? "", session: g.session });
        }
        audit({ type: "assistant.stream", ok: out.ok, kind: out.kind, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
        res.write(`data: ${JSON.stringify({ type: "done", result: out })}\n\n`);
      } catch (e) {
        res.write(`data: ${JSON.stringify({ type: "done", result: { ok: false, error: "stream_error" } })}\n\n`);
      }
      res.end();
      return;
    }
    // Unified chat-builder (UC.1): materialize a build spec proposed in chat into durable
    // entities through the SAME registry create paths the builder screens use — so a
    // conversation can stand up a skill + agent + automation in one approved step. Nothing
    // is auto-activated: skills land as drafts (available only after their tools are
    // available + a passing test), automations are created enabled but their gated steps
    // still pause for approval at run time. Adult Admin only (creating agents/automations).
    if (path === "/api/assistant/build" && method === "POST") {
      const g = gate(req, { minRole: "Adult Member" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const aiGated = childAiGate(g, res, req); if (aiGated) return aiGated;
      const gated = planGate(g, res, req); if (gated) return gated;
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const spec = body.build ?? body;
      // The same scoping the chat proposal got, applied to whatever actually arrives here —
      // the client is not the enforcement point.
      if (isAdultMemberOnly(g.session)) {
        if (spec?.agent) spec.agent.visibility = "personal";
        if (spec?.automation) delete spec.automation;
        if (Array.isArray(spec?.edits)) spec.edits = [];
      }
      const hasEdits = Array.isArray(spec?.edits) && spec.edits.length > 0;
      if (!spec || (typeof spec !== "object") || (!spec.skill && !spec.agent && !spec.automation && !hasEdits)) {
        return json(res, 400, { error: "empty_build", message: "Describe at least a skill, agent, automation, or edit to make." }, req);
      }
      try {
        const out = materializeBuild(spec, { session: g.session, req });
        persistBuildOutcome(body.conversationId, g.session, out);
        return json(res, 200, { ok: true, ...out }, req);
      } catch (e) {
        // WP-001 slice 3 — the refusal must reach the FAMILY, not just the HTTP client.
        // A build that cannot run is reported in the thread in plain language, so the
        // user never walks away believing an automation was set up.
        const code = e?.code ?? "build_failed";
        const message = String(e?.message ?? e).replace(/^unrunnable_automation:\s*/, "");
        persistBuildFailure(body.conversationId, g.session, code, message);
        return json(res, 422, { ok: false, error: code, message }, req);
      }
    }
    // Streaming variant (UC.6): same materialize, but emits an SSE event per entity as it's
    // created/updated, then a "done" event — so the chat can show the build happening live.
    if (path === "/api/assistant/build/stream" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const gated = planGate(g, res, req); if (gated) return gated;
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const spec = body.build ?? body;
      const hasEdits = Array.isArray(spec?.edits) && spec.edits.length > 0;
      if (!spec || (typeof spec !== "object") || (!spec.skill && !spec.agent && !spec.automation && !hasEdits)) {
        return json(res, 400, { error: "empty_build", message: "Describe at least a skill, agent, automation, or edit to make." }, req);
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...corsHeaders(req) });
      try {
        const out = materializeBuild(spec, { session: g.session, req, emit: (ev) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { /* client gone */ } } });
        persistBuildOutcome(body.conversationId, g.session, out);
        res.write(`data: ${JSON.stringify({ type: "done", result: { ok: true, ...out } })}\n\n`);
      } catch (e) {
        const code = e?.code ?? "build_failed";
        const message = String(e?.message ?? e).replace(/^unrunnable_automation:\s*/, "");
        persistBuildFailure(body.conversationId, g.session, code, message);
        res.write(`data: ${JSON.stringify({ type: "done", result: { ok: false, error: code, message } })}\n\n`);
      }
      res.end();
      return;
    }
    if (path === "/api/evolution/propose" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const out = await proposeEvolution({ trace: body.trace, session: g.session, providerId: body.providerId });
      audit({ type: "evolution.propose", ok: out.ok, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }
    // Manual evolution proposal — an Adult Admin proposes an improvement to an agent/
    // skill that then flows through the same review → version → rollback lifecycle as
    // auto-generated (failure-trace) proposals. Persists a reviewable pending record.
    if (path === "/api/evolution" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!["agent", "skill"].includes(body.kind)) return json(res, 400, { error: "invalid_kind" }, req);
      if (body.kind === "agent" && !body.agentId) return json(res, 400, { error: "agentId_required" }, req);
      if (body.kind === "skill" && !body.skillId) return json(res, 400, { error: "skillId_required" }, req);
      if (!String(body.after ?? "").trim()) return json(res, 400, { error: "after_required" }, req);
      const evo = putEvolution({
        id: "evo_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        kind: body.kind, agentId: body.agentId ?? null, skillId: body.skillId ?? null,
        title: body.title ?? "Manual improvement", reason: body.reason ?? "Proposed by an admin.",
        summary: body.summary ?? "", after: String(body.after), risk: body.risk ?? "Low",
        status: "pending", source: "manual", createdBy: g.session.actorId,
        createdAt: Date.now(), updatedAt: new Date().toISOString(),
      });
      audit({ type: "evolution.manual_propose", evolutionId: evo.id, kind: evo.kind, ok: true }, req, g.session);
      return json(res, 200, { evolution: evo }, req);
    }
    // Evolution registry — server-persisted improvement proposals generated from
    // real run traces. Accepting an agent proposal versions the agent server-side.
    if (path === "/api/evolution" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Project a stable review shape so clients can show/act on proposals: always carry
      // `after` (the concrete change), the resolved `agentName`, and the auto-approval
      // verdict (`autoApproved`/`autoReason`) even for legacy rows that predate them.
      const project = (e, archived) => ({
        ...e,
        source: e.source ?? "trace",
        after: e.after ?? null,
        before: resolveEvolutionBefore(e),
        risk: e.risk ?? null,
        agentId: e.agentId ?? null,
        agentName: e.agentId ? (getAgent(e.agentId)?.name ?? null) : null,
        autoApproved: e.autoApproved === true,
        autoReason: e.autoReason ?? null,
        revertible: archived ? false : canRevertEvolution(e),
        archived: !!archived,
      });
      const active = listEvolutions((e) => !e.householdId || e.householdId === g.session.householdId).map((e) => project(e, false));
      const archivedRows = listEvolutionArchive(g.session.householdId).map((e) => project(e, true));
      return json(res, 200, { evolutions: [...active, ...archivedRows] }, req);
    }
    const evoReviewMatch = path.match(/^\/api\/evolution\/([^/]+)\/review$/);
    if (evoReviewMatch && method === "POST") {
      // Accepting an evolution versions a skill/agent — an Adult Admin+ decision,
      // consistent with the skill/agent patch routes. Children/guests cannot promote.
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const id = evoReviewMatch[1];
      const e = getEvolution(id);
      if (!e) return json(res, 404, { error: "not_found" }, req);
      if (e.householdId && e.householdId !== g.session.householdId) return json(res, 403, { error: "forbidden" }, req);
      if (e.status !== "pending") return json(res, 409, { error: "already_reviewed", evolution: e }, req);
      const accept = !!body.accept;
      let applied = false; let applyError = null;
      if (accept && e.after) {
        // Shared with the engine's auto-accept path — also stamps beforeVersionId on
        // the evolution row at apply time (WP-008a), so reverts never need timestamp
        // correlation again.
        const r = applyEvolutionToTarget(e);
        applied = r.applied; applyError = r.applyError;
      }
      patchEvolution(id, { status: accept ? "accepted" : "rejected", reviewedAt: Date.now(), reviewedBy: g.session.actorId });
      audit({ type: "evolution.review", id, accept, applied, applyError, kind: e.kind, agentId: e.agentId }, req, g.session);
      return json(res, 200, { ok: true, applied, applyError, evolution: getEvolution(id) }, req);
    }
    const evoRevertMatch = path.match(/^\/api\/evolutions\/([^/]+)\/revert$/);
    if (evoRevertMatch && method === "POST") {
      // WP-008a: reverting an applied improvement restores the target's prior version
      // (self-snapshotting — the revert is itself reversible) and is audited.
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const out = revertEvolution(evoRevertMatch[1], g.session);
      audit({ type: "evolution.revert_request", id: evoRevertMatch[1], ok: out.ok, error: out.ok ? undefined : out.error }, req, g.session);
      if (!out.ok) {
        const status = out.error === "not_found" ? 404 : out.error === "forbidden" ? 403 : 409;
        return json(res, status, out, req);
      }
      return json(res, 200, out, req);
    }
    if (path === "/api/miniapps/generate" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const out = await generateMiniApp({ goal: body.goal, type: body.type, session: g.session, providerId: body.providerId });
      audit({ type: "miniapp.generate", ok: out.ok, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }
    if (path === "/api/playbooks/generate" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const out = await generatePlaybook({ goal: body.goal, session: g.session, providerId: body.providerId });
      audit({ type: "playbook.generate", ok: out.ok, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }

    /* ---- Webhook event history (auth-protected read) ---- */
    if (whMatch && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { events: getWebhookEvents(whMatch[1]) }, req);
    }

    /* ---- Audit (admin only) ---- */
    if (path === "/api/audit" && method === "GET") {
      const g = gate(req, { requireSession: true, minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { events: readAudit(Number(url.searchParams.get("limit") || 100)) }, req);
    }

    /* ---- Expo push token registration (mobile clients) ---- */
    if (path === "/api/push-tokens" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!body.token || typeof body.token !== "string") return json(res, 400, { error: "token_required" }, req);
      // Record who owns this device so an approval push can target the right person.
      addPushToken(body.token, { householdId: g.session?.householdId ?? null, actorId: g.session?.actorId ?? null });
      audit({ type: "push.register", ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }
    /* ---- Client crash / error reports ------------------------------------------
     * The iOS app had NO crash reporting of any kind: a render error was a white
     * screen on a device nobody watching the server could see. Rather than add a
     * third-party vendor (and a secret to manage), a client crash lands in the
     * household's OWN audit trail — the same place every other event goes, which
     * means it shows up in Activity with plain-language copy and a timestamp.
     *
     * Deliberately forgiving: a crash report must never be the thing that fails.
     * A missing session is accepted (a crash can happen before/at sign-in), and the
     * payload is truncated rather than rejected, because a rejected report is a
     * report nobody ever sees. */
    if (path === "/api/client-errors" && method === "POST") {
      const g = gate(req, {});                       // session optional by design
      const body = await readBody(req);
      if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : undefined);
      appendAudit({
        type: "client.error",
        ok: false,
        platform: clip(body.platform, 32) ?? "unknown",
        appVersion: clip(body.appVersion, 32),
        fatal: body.fatal === true,
        message: clip(body.message, 500) ?? "(no message)",
        stack: clip(body.stack, 4000),
        screen: clip(body.screen, 120),
        householdId: g.ok ? g.session?.householdId ?? null : null,
        actorId: g.ok ? g.session?.actorId ?? null : null,
      });
      return json(res, 200, { ok: true }, req);
    }
    if (path === "/api/push-tokens" && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (body.token) removePushToken(body.token);
      return json(res, 200, { ok: true }, req);
    }

    if (serveStatic(req, res, path)) return;
    return json(res, 404, { error: "not_found", path }, req);
  } catch (e) {
    return json(res, 500, { error: "server_error", message: String(e?.message ?? e) }, req);
  }
};

/* ---- SECURITY (WP-005 adversarial review, finding C1) ----
 * `sourceRef` is not decoration: the engine reads `sourceRef.agentId` to decide which
 * agent's POLICY applies (engine.mjs) and, since WP-005, which agent's standing
 * send-consent applies (a contact method's per-agent allowlist). POST /api/runs/start
 * previously forwarded the caller's `sourceRef` verbatim, so any Limited Member could
 * name any agent and inherit its send authority — reading the allowlists first from
 * GET /api/contact-methods. That turns "the allowlist IS the approval" into "the
 * caller picks their own identity", which is not an allowlist at all.
 *
 * Agent identity is therefore SERVER-ASSIGNED ONLY: it is set by runAgent/runSkill/
 * fireTrigger, never accepted from a request body. Clients may still pass harmless
 * correlation fields. */
// Only the AUTHORITY-BEARING fields are stripped. The rest of sourceRef is benign
// correlation metadata (conversationId, isRepair, repairedFrom, via …) that the chat
// layer legitimately sets and depends on, so a blanket allow-list would break it.
// These four are exactly the fields the server reads to decide what a run MAY DO:
//   agentId      → whose tool policy applies, and (WP-005) whose send consent applies
//   skillId      → attribution the policy path and save-offer gating key off
//   triggerId    → which automation's status this run writes back to
//   automationId → the same, on the legacy field name
const SERVER_ASSIGNED_SOURCEREF = ["agentId", "skillId", "triggerId", "automationId"];
function clientSourceRef(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = { ...raw };
  for (const k of SERVER_ASSIGNED_SOURCEREF) delete out[k];
  return out;
}

function publicSkill(s) {
  // All fields are non-secret — expose the full skill record to authenticated same-household clients.
  return s;
}
// Shared by the unified chat-builder's JSON + SSE routes: create/edit durable entities
// from a build spec via the real registry paths, calling emit(event) per entity so the
// streaming route can surface live progress. Throws on a hard failure (caller maps to 422).
function materializeBuild(spec, { session, req, emit = () => {} }) {
  const created = {};
  const updated = [];
  if (spec.skill && typeof spec.skill === "object") {
    const skill = createSkill(spec.skill, session);
    created.skill = { id: skill.id, name: skill.name, status: skill.status };
    audit({ type: "assistant.build", entity: "skill", skillId: skill.id, ok: true }, req, session);
    emit({ type: "progress", entity: "skill", action: "created", id: skill.id, name: skill.name, status: skill.status });
  }
  if (spec.agent && typeof spec.agent === "object") {
    const skillIds = [...(Array.isArray(spec.agent.skillIds) ? spec.agent.skillIds : []), ...(created.skill ? [created.skill.id] : [])];
    // Intelligent preselection (item 8): the agent inherits the tools/functions its
    // skill's steps reference — previously chat-built agents got empty allow-lists and
    // permitted∩available rendered them inert despite the chat saying "created".
    const stepToolIds = (spec.skill?.steps ?? []).map((s) => s?.tool_id).filter(Boolean);
    const derived = deriveCapabilitiesFromSteps(stepToolIds, session);
    // WP-001 slice 5 — ONE lifecycle, decided (DEC-I01). An agent that the same build
    // is about to put on a SCHEDULE lands Active. A Draft agent behind an enabled
    // trigger is the false-success shape in miniature: the chat says it's set up, the
    // schedule is real, and a status field nobody surfaced quietly says otherwise.
    // Safety still lives where it always did — the per-step approval gate — not in a
    // Draft flag that never blocked a run anyway. Builds with NO automation keep Draft:
    // nothing fires unattended, so there is nothing to misrepresent.
    const landsActive = !!(spec.automation && typeof spec.automation === "object");
    const agent = createAgent({
      ...spec.agent, skillIds,
      status: spec.agent.status ?? (landsActive ? "Active" : "Draft"),
      allowedToolIds: [...new Set([...(Array.isArray(spec.agent.allowedToolIds) ? spec.agent.allowedToolIds : []), ...derived.allowedToolIds])],
      allowedFunctionIds: [...new Set([...(Array.isArray(spec.agent.allowedFunctionIds) ? spec.agent.allowedFunctionIds : []), ...derived.allowedFunctionIds])],
    }, session);
    created.agent = { id: agent.id, name: agent.name, status: agent.status, allowedToolIds: agent.allowedToolIds, allowedFunctionIds: agent.allowedFunctionIds };
    audit({ type: "assistant.build", entity: "agent", agentId: agent.id, ok: true, tools: agent.allowedToolIds.length }, req, session);
    emit({ type: "progress", entity: "agent", action: "created", id: agent.id, name: agent.name, status: agent.status });
  }
  if (spec.automation && typeof spec.automation === "object") {
    const a = spec.automation;
    // WP-001 slice 1 — TARGET LINKAGE. The automation must carry what it should RUN,
    // not merely who should run it. Previously an agent target was `{kind:"agent",
    // agentId}` with no skillId and no goal, so every scheduled fire fell through
    // runAgent's third branch into buildReadonlyPlan — a zero-effect "status pass"
    // that reported success while delivering nothing (ISS-001, EV-011/EV-015).
    // Now the built skill (or, failing that, the agent's own instructions) rides on
    // the target so the fire executes the recipe the chat actually built.
    const goalFromSpec = String(spec.agent?.instructions ?? spec.summary ?? "").trim() || null;
    const target = a.target ?? (created.agent
      ? { kind: "agent", agentId: created.agent.id, skillId: created.skill?.id ?? null, goal: created.skill ? null : goalFromSpec, params: a.params ?? {} }
      : created.skill
        ? { kind: "skill", skillId: created.skill.id, params: a.params ?? {} }
        : a.target);
    // WP-001 slice 3 — REFUSE THE UNRUNNABLE. An automation whose resolved target can
    // neither run a skill nor plan from a goal has nothing to execute; creating it
    // would manufacture exactly the silent no-op this work package exists to kill.
    // Fail loudly at build time (caller maps the throw to 422) instead.
    const resolvedTarget = target ?? {};
    const runnable = !!(resolvedTarget.skillId || String(resolvedTarget.goal ?? "").trim());
    if (!runnable) {
      const err = new Error("unrunnable_automation: this automation has nothing to run — it needs a skill to execute or instructions to work from.");
      err.code = "unrunnable_automation";
      throw err;
    }
    const trig = createTrigger({ ...a, target }, session, Date.now());
    created.automation = { id: trig.id, name: trig.name, type: trig.type, enabled: trig.enabled, anchor: trig.anchor ?? null, nextRunAt: trig.nextRunAt ?? null, scheduleText: scheduleTextFor(trig) };
    audit({ type: "assistant.build", entity: "automation", triggerId: trig.id, ok: true }, req, session);
    emit({ type: "progress", entity: "automation", action: "created", id: trig.id, name: trig.name });
  }
  // Edits to EXISTING entities — versioned via partialUpdate (snapshots + rollback, P3).
  // Household-scoped; unknown/foreign ids are reported, never fatal.
  if (Array.isArray(spec.edits)) {
    for (const e of spec.edits) {
      if (e.kind === "skill") {
        const s = getSkill(e.id);
        if (!s || (s.householdId !== "local" && s.householdId !== session.householdId)) { updated.push({ kind: "skill", id: e.id, ok: false, error: "not_found" }); emit({ type: "progress", entity: "skill", action: "edit_skipped", id: e.id, ok: false }); continue; }
        const r = partialUpdateSkill(e.id, e.patch ?? {});
        updated.push({ kind: "skill", id: e.id, name: r?.name, version: r?.version, ok: !!r && !r.error });
        audit({ type: "assistant.build", entity: "skill_edit", skillId: e.id, ok: !!r, version: r?.version }, req, session);
        emit({ type: "progress", entity: "skill", action: "updated", id: e.id, name: r?.name, version: r?.version, ok: !!r });
      } else if (e.kind === "agent") {
        const a = getAgent(e.id);
        if (!a || (a.householdId !== "local" && a.householdId !== session.householdId)) { updated.push({ kind: "agent", id: e.id, ok: false, error: "not_found" }); emit({ type: "progress", entity: "agent", action: "edit_skipped", id: e.id, ok: false }); continue; }
        const r = partialUpdateAgent(e.id, e.patch ?? {});
        updated.push({ kind: "agent", id: e.id, name: r?.name, version: r?.version, ok: !!r && !r.error });
        audit({ type: "assistant.build", entity: "agent_edit", agentId: e.id, ok: !!r, version: r?.version }, req, session);
        emit({ type: "progress", entity: "agent", action: "updated", id: e.id, name: r?.name, version: r?.version, ok: !!r });
      }
    }
  }
  const notes = [];
  // Copy must not point users at builder dashboards hidden behind Advanced Mode —
  // everything needed should be doable from the default surface (chat + Helper Agents).
  if (created.agent && (created.agent.allowedToolIds?.length || created.agent.allowedFunctionIds?.length)) {
    const n = (created.agent.allowedToolIds?.length ?? 0) + (created.agent.allowedFunctionIds?.length ?? 0);
    notes.push(`I preselected ${n} capabilit${n === 1 ? "y" : "ies"} for the new helper from its skill steps — no manual tool wiring needed.`);
  } else if (created.agent) {
    // Honest build success: "created" but tool-less is inert (permitted∩available = ∅) —
    // say so instead of letting the family rely on a helper that can't execute anything.
    notes.push("Heads up: this helper has no usable tools yet — connect the services it needs or edit it before relying on it.");
  }
  if (created.skill && created.skill.status !== "available") notes.push("The new skill starts as a draft — it becomes available automatically once its connected services are ready and a first run succeeds.");
  if (created.agent && created.agent.status === "Draft") notes.push("The new helper is a draft — open Helper Agents to activate it. Nothing runs on its own until you do.");
  // WP-001 slice 1 + WP-002 — say what will run, and when, in the family's words.
  // The build card previously announced a schedule without ever naming the recipe
  // behind it, which is how "created" and "does nothing" coexisted for so long.
  if (created.automation) {
    const runs = created.skill ? `“${created.skill.name}”` : (created.agent ? `“${created.agent.name}”` : "this automation");
    const when = created.automation.scheduleText ?? "on its schedule";
    notes.push(`${when === "on its schedule" ? "On its schedule" : when} it will run ${runs}${created.agent && created.skill ? ` as “${created.agent.name}”` : ""}.`);
    const gated = (spec.skill?.steps ?? []).filter((s) => s?.approval_required).map((s) => s?.name).filter(Boolean);
    if (gated.length) notes.push(`${gated.length === 1 ? `The “${gated[0]}” step` : `These steps — ${gated.join(", ")} —`} will ask for your approval each time, so nothing goes out unattended until you allow it.`);
  }
  if (updated.some((u) => !u.ok)) notes.push("Some edits couldn't be applied (the target wasn't found in your household).");
  return { created, updated, notes };
}

// After a chat build materializes, make the OUTCOME durable on the conversation:
// mark the originating build-proposal message built (so the card survives refresh)
// and append the confirmation as a real message. Ownership-checked like every other
// conversation write; silently a no-op if the conversation isn't the caller's.
function persistBuildOutcome(conversationId, session, out) {
  if (!conversationId) return;
  const conv = getConversation(conversationId);
  if (!canSeeConversation(conv, session)) return;
  const builtIds = { skillId: out.created?.skill?.id, agentId: out.created?.agent?.id, triggerId: out.created?.automation?.id };
  const msgs = [...(conv.messages ?? [])];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].kind === "build" && !msgs[i].built) { msgs[i] = { ...msgs[i], built: true, builtIds }; break; }
  }
  putConversation({ ...conv, messages: msgs, updatedAt: new Date().toISOString() });
  const parts = [
    out.created?.skill && `skill “${out.created.skill.name}”`,
    out.created?.agent && `helper “${out.created.agent.name}”`,
    out.created?.automation && `automation “${out.created.automation.name}”`,
    ...(out.updated ?? []).filter((u) => u.ok).map((u) => `updated ${u.kind} “${u.name ?? u.id}”`),
  ].filter(Boolean);
  appendConversationMessage(conv.id, {
    role: "assistant", kind: "build_result", builtIds,
    text: `Done — I set up ${parts.join(", ")}.${out.notes?.length ? "\n\n" + out.notes.map((n) => `• ${n}`).join("\n") : ""}`,
    at: new Date().toISOString(),
  });
}
// WP-001 slice 3 — the other half of persistBuildOutcome: when a build is REFUSED,
// the conversation says so. Silence here is what let a family believe an automation
// existed when the server had declined to create one.
/* ---- WP-006 (ISS-011): ROLE-AWARE PROPOSALS ----
 * The assistant would happily hand a Guest/Helper a full build card — "here's the
 * helper I'll create, confirm?" — and the confirm then 403'd on /api/assistant/build,
 * because creating durable agents is Adult Admin only. A dead card is worse than a
 * refusal: it looks like progress and ends in a wall. So a build proposal aimed at
 * someone who cannot build is demoted, HERE at the single server authority, into a
 * plain answer that says what was understood and who can actually set it up. */
/**
 * Read whatever the user attached and fold it into the turn's context.
 *
 * Mutates `body.context` in place: `attachedFileText` is what the assistant reads, and
 * `attachedFileError` is the honest account when the file can't be read — which the planner
 * prompt is told to relay rather than blaming the attachment feature.
 */
async function attachFileContext(body, session) {
  const fileId = body?.context?.attachedFileId;
  if (!fileId || typeof fileId !== "string") return;
  try {
    const out = await understandFile(fileId, { householdId: session.householdId });
    body.context = { ...body.context };
    if (out.ok) {
      body.context.attachedFileText = out.text;
      body.context.attachedFileKind = out.kind;
      if (out.truncated) body.context.attachedFileTruncated = true;
    } else {
      body.context.attachedFileError = out.message ?? "That file couldn't be read.";
    }
  } catch (e) {
    body.context = { ...body.context, attachedFileError: String(e?.message ?? e) };
  }
}

function demoteBuildForRole(out, session) {
  if (!out?.ok || out.kind !== "build" || roleAtLeast(session.role, "Adult Admin")) return;
  /* An Adult Member CAN build — for themselves. Rather than refusing the proposal, scope it:
   * the helper becomes personal, and any automation is dropped, because an automation is by
   * definition something that runs on the household's schedule without them present. What
   * they get is a helper they can run; what they don't get is one that acts on its own. */
  if (isAdultMemberOnly(session)) {
    if (out.build?.agent) out.build.agent.visibility = "personal";
    if (out.build?.automation) {
      delete out.build.automation;
      out.build.summary = `${String(out.build.summary ?? "").trim()} (Set up for you to run — an automation that fires on its own needs an Owner or Adult Admin.)`.trim();
    }
    // Editing EXISTING household items is still out of scope for them.
    if (Array.isArray(out.build?.edits)) out.build.edits = [];
    return;
  }
  const what = String(out.build?.summary ?? out.build?.agent?.name ?? "that helper").slice(0, 160);
  out.kind = "answer";
  out.answer = `I can see what you're after — ${what}. Setting up a helper that runs on its own needs an adult admin on this household, so I can't create it from your account. Ask one of them to say the same thing to me and I'll build it, or I can just do it manually for you right now if you'd like.`;
  delete out.build;
}

function persistBuildFailure(conversationId, session, code, message) {
  if (!conversationId) return;
  const conv = getConversation(conversationId);
  if (!canSeeConversation(conv, session)) return;
  const text = code === "unrunnable_automation"
    ? `I couldn't set that automation up: ${message} Tell me what it should actually do on each run — the steps to take, or the skill it should use — and I'll build it properly.`
    : `I couldn't finish setting that up: ${message} Nothing was created.`;
  appendConversationMessage(conv.id, { role: "assistant", kind: "status", buildError: code, text, at: new Date().toISOString() });
}
function publicApproval(a) {
  // NOTE: the approval record deliberately never stores the raw input — only
  // `inputHash` (the consume-once integrity check against whatever input is supplied
  // at execution time). The real, human-readable content lives on the ORIGINATING RUN
  // STEP (see publicRun below) — that's what the client renders for a rich preview.
  return { id: a.id, connectorId: a.connectorId, toolId: a.toolId, status: a.status, risk: a.risk, category: a.category, preview: a.preview, createdAt: a.createdAt, expiresAt: a.expiresAt, decidedBy: a.decidedBy, decidedAt: a.decidedAt,
    requestedBy: a.requestedBy, source: a.source ?? "executable", allowedApproverRoles: a.allowedApproverRoles ?? [], consumedBy: a.consumedBy ?? null };
}
// Runs are the household's own data; the authenticated same-household session sees
// the full durable trace (steps, inputs, results). No cross-household leakage —
// callers always scope by g.session.householdId before calling this.
function publicRun(r) {
  return {
    id: r.id, householdId: r.householdId, actorId: r.actorId, source: r.source, sourceRef: r.sourceRef,
    title: r.title, summary: r.summary, status: r.status, cursor: r.cursor, error: r.error,
    createdAt: r.createdAt, updatedAt: r.updatedAt, startedAt: r.startedAt, finishedAt: r.finishedAt,
    steps: (r.steps ?? []).map((s) => ({
      index: s.index, toolId: s.toolId, functionId: s.functionId, title: s.title, detail: s.detail,
      requiresApproval: s.requiresApproval, risk: s.risk, connectorId: s.connectorId, connectorName: s.connectorName,
      attribution: s.attribution, status: s.status, approvalId: s.approvalId, attempts: s.attempts, input: s.input ?? {},
      // WP-003: the truth flags travel to both clients so a skipped step renders as
      // skipped rather than falling into an unknown-status default.
      effectClaimed: !!s.effectClaimed, clampedOut: s.clampedOut ?? null,
      result: s.result ?? null, toolCalls: s.toolCalls ?? [], startedAt: s.startedAt, finishedAt: s.finishedAt,
    })),
  };
}
function approvalErrorMessage(err) {
  const map = {
    approval_not_found: "No matching approval was found.",
    approval_tool_mismatch: "This approval is for a different action.",
    approval_scope_mismatch: "This approval belongs to another household.",
    approval_already_used: "This approval was already used.",
    approval_not_approved: "This action has not been approved.",
    approval_expired: "This approval has expired — request it again.",
    approval_input_changed: "The action details changed after approval — request approval again.",
    approval_not_executable: "This is a sample approval and cannot run a real action.",
    approval_policy_missing: "This approval has no authority policy — request it again.",
    approver_not_allowed: "The person who approved this isn't allowed to approve this action.",
  };
  return map[err] ?? "Approval could not be validated.";
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function htmlMessage(title, body) {
  return `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#f4f0e9;color:#1f2535;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;max-width:28rem;padding:1rem"><h2>FamiliOS — ${escapeHtml(title)}</h2><p style="color:#4a5568">${escapeHtml(body)}</p></div></body>`;
}

server.listen(PORT, () => {
  seedDefaults();          // ensure a real agent + runnable hybrid skill exist
  // Hosted deployments hand AI keys via env — configure + activate once, never
  // overwriting a Settings-made choice (see bootstrapAIFromEnv).
  try { const boot = bootstrapAIFromEnv(); if (boot.length) console.log(`[ai] bootstrapped from env: ${boot.join(", ")}`); } catch { /* non-fatal */ }
  registerAssistantRunHooks(); // inline chat results + one-shot self-repair for conversation runs
  registerTriggerRunHooks();   // WP-001: write each run's TERMINAL status back to its trigger
  // Recovery + sweeps + trigger tick run once PER HOUSEHOLD, each inside that
  // household's tenant context — one family's broken state never blocks another's.
  void forEachTenant(() => recoverRuns()); // re-drive any runs that were mid-flight at shutdown
  setInterval(() => { void forEachTenant(() => expireStaleRuns()); }, 60_000); // sweep stale parked runs
  setInterval(() => { void forEachTenant(() => tick()); }, 10_000); // fire due schedule/recurring triggers
  // H5 — task reminders reach the ASSIGNEE's phone, which is why they're swept here rather
  // than scheduled on whichever device happened to create the task. Every 30s so a
  // "15 minutes before" lands within half a minute of the mark.
  setInterval(() => { void forEachTenant(() => sweepTaskReminders()); }, 30_000);
  // Connection health, on a timer — see accounts.mjs sweepAccountHealth. Without this, an
  // account's status describes the last thing that happened to touch it rather than what the
  // credential can do now, which is how "needs reconnect" outlived the problem it named.
  // Every 5 minutes; each account is throttled to one real probe per 15.
  setInterval(() => { void forEachTenant(() => sweepAccountHealth({ householdId: CURRENT_TENANT })); }, 5 * 60_000);
  // Calendar auto-sync: re-pull url/google subscriptions that have gone stale so linked
  // events stay fresh without a manual "Sync now". Pasted imports are static — skipped.
  // Staleness window via HOMEOPS_CAL_SYNC_MINUTES (default 6h); swept every 15 minutes.
  const calSyncMs = Math.max(5, parseInt(process.env.HOMEOPS_CAL_SYNC_MINUTES ?? "360", 10) || 360) * 60_000;
  setInterval(() => void forEachTenant(async () => {
    const due = listSubscriptions((s) => s.source !== "import" && (Date.now() - (s.lastSyncAt ?? 0)) > calSyncMs);
    for (const sub of due) {
      try {
        // The subscription's creator is the acting identity (their Google account, their household).
        const session = { householdId: sub.householdId, actorId: sub.createdBy };
        const r = await syncSubscription({ sub, session });
        patchSubscription(sub.id, { lastSyncAt: Date.now(), lastResult: r.ok ? { imported: r.imported, updated: r.updated, removed: r.removed, auto: true } : { error: r.error, auto: true }, eventCount: r.ok ? r.total : (sub.eventCount ?? 0) });
        audit({ type: "calendar.auto_sync", subscriptionId: sub.id, ok: r.ok, error: r.ok ? undefined : r.error }, null, session);
      } catch { /* one bad feed must not stop the sweep */ }
    }
    // Two-way Google sweep (opt-in via Settings → calendar auto-sync): server-triggered,
    // no approvals — pull Google-side edits into pushed events AND push local edits back,
    // so both calendars mirror each other without anyone opening the app. Conflicts
    // (both sides changed) still flag for human review — auto-sync never clobbers.
    {
      const googleSubs = listSubscriptions((s) => s.source === "google");
      const seen = new Set();
      for (const sub of googleSubs) {
        // Auto-sync is a per-household opt-in — gate each subscription on ITS household.
        if (getSettings(sub.householdId).calendarAutoSync !== true || !externalActionsEnabled(sub.householdId)) continue;
        const key = `${sub.householdId}:${sub.createdBy}`;
        if (seen.has(key)) continue; seen.add(key);
        try {
          const r = await autoSyncGoogle({ householdId: sub.householdId, actorId: sub.createdBy });
          appendAudit({ type: "calendar.auto_two_way", householdId: sub.householdId, ok: true, merged: r.pull?.merged ?? 0, conflicts: r.pull?.conflicts ?? 0, pushed: r.pushed, pushErrors: r.pushErrors });
        } catch { /* one account must not stop the sweep */ }
      }
    }
  }), 15 * 60_000);
  startScheduler();
  // Probe the browser runtime once at boot (in-process Playwright first, then
  // any external BROWSER_RUNTIME_URL) so the connector's readiness — and the
  // /api/health browserRuntime flag — reflect reality from the start.
  healthCheck("browser").catch(() => {});
  // Nightly household backup (+ weekly Owner notice), piggybacked on a light timer.
  setInterval(() => { void backupTick(); }, 30 * 60_000);
  void backupTick();
  // eslint-disable-next-line no-console
  // Report the ACTUAL bound port (PORT=0 asks the OS for a free one — the test
  // harness relies on this line to learn where the server landed).
  const boundPort = server.address()?.port ?? PORT;
  console.log(`FamiliOS backend (control plane v${VERSION}) listening on http://localhost:${boundPort} — env=${IS_PROD ? "production" : "development"}, origins=${ALLOWED_ORIGINS.join(",") || "(none)"}`);

  // Graceful shutdown: deploys used to hard-kill mid-run ("interrupted" failures).
  // Now: refuse new runs, hand every lease back cleanly (recovery re-drives on the
  // next boot), close Chromium, and exit before the platform's SIGKILL deadline.
  let shuttingDown = false;
  const shutdown = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      setDraining(true);
      const released = releaseAllLeases();
      appendAudit({ type: "server.shutdown", signal: sig, leasesReleased: released });
    } catch { /* never block exit */ }
    void closeBrowser().catch(() => {}).finally(() => process.exit(0));
    // Hard floor: exit even if the browser hangs.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => shutdown(sig));
});
