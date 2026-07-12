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
} from "./store.mjs";
import { startRun, resumeRun, cancelRun, recoverRuns, findRunByApprovalId, runEmitter, expireStaleRuns, setDraining, releaseAllLeases } from "./engine.mjs";
import { createBackup, listBackups, readBackup, restoreBackup, backupTick } from "./backup.mjs";
import { registerAssistantRunHooks } from "./assistant-runs.mjs";
import { closeBrowser } from "./browser.mjs";
import { runSkill, runAgent } from "./orchestrator.mjs";
import { seedDefaults } from "./seed.mjs";
import { syncSubscription, removeSubscriptionEvents, pullGoogleEdits, resolveConflictPatch, pushEventToGoogle, autoSyncGoogle, mealEventNotes, isEditableLinkedGoogle, editLinkedGoogleEvent, deleteLinkedGoogleEvent, deleteGoogleCopy } from "./calendar.mjs";
import { twilioAuthToken, twilioSignatureValid, handleInboundSms, twiml } from "./sms.mjs";
import {
  createAgent, replaceAgent, partialUpdateAgent, deleteAgent, duplicateAgent,
  rollbackAgent, listAgentVersions, agentContext, selectAgent, publicAgent, listPublicAgents,
  deriveCapabilitiesFromSteps, agentVisibleTo,
} from "./agents.mjs";
import { getAgent } from "./store.mjs";
import {
  createSkill, replaceSkill, partialUpdateSkill, deleteSkill, duplicateSkill,
  promoteSkill, rollbackSkill, inferFunctions, testSkill, listSkillVersions,
} from "./skills.mjs";
import {
  createFunction, replaceFunction, partialUpdateFunction, deleteFunction, duplicateFunction,
  promoteFunction, deprecateFunction, rollbackFunction, testFunction,
  listPublicFunctions, publicFunction, FUNCTION_TYPES, FUNCTION_STATES, draftFunction,
} from "./functions.mjs";
import { getFunction, listFunctionVersions } from "./store.mjs";
import {
  createTrigger, updateTrigger, deleteTrigger, fireTrigger, fireWebhookTrigger, fireConnectorEvent,
  publicTrigger, listPublicTriggers, getTriggerSecret, tick, TRIGGER_TYPES,
} from "./triggers.mjs";
import { getTrigger } from "./store.mjs";
import { pushApprovalNotification, deliverNotification, sendVerificationCode, pushToMember } from "./notify.mjs";
import { listConnectors, connectorById, publicConnector, healthCheck, executeTool, readinessOf } from "./connectors.mjs";
import { gate, corsHeaders, sessionCookie, clearSessionCookie, isAllowedOrigin, ALLOWED_ORIGINS, IS_PROD, roleAtLeast, sessionFromReq } from "./auth.mjs";

// Sliding-window rate-limit buckets (in-process; per-IP pre-auth, per-actor assistant).
const _rateBuckets = new Map();
setInterval(() => { if (_rateBuckets.size > 5000) _rateBuckets.clear(); }, 10 * 60_000).unref();
import { listProviders as listAIProviders, aiProviderById, setProviderConfig, revokeProvider, setActiveProvider, providerHealth, providerModels, providerChat, bootstrapAIFromEnv } from "./ai.mjs";
import { listProviders as listConnectorProviders, providerById as connectorProviderById, providerConfigured, publicProvider as publicConnectorProvider, findToolGlobal } from "./providers.mjs";
import { buildAuthUrl, exchangeCode, apiForAccount } from "./oauth.mjs";
import { listAccountsFor, getOwnedAccount, upsertAccount, revokeAccount, checkAccountHealth, publicAccount } from "./accounts.mjs";
import { planFromGoal, generateMiniApp, generatePlaybook, assistantRespond, assistantStream, proposeEvolution, toolCatalog } from "./planner.mjs";

const PORT = Number(process.env.PORT || 8787);
const VERSION = "1.2.0";
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
  return c.actorId === session.actorId || c.visibility === "household";
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
function readRaw(req) {
  return new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(b)); });
}
async function readBody(req) {
  const raw = await readRaw(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { return null; }
}
function externalActionsEnabled(householdId) { return getSettings(householdId).externalActionsEnabled !== false; }
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
  deleteIdentity, deleteIdentitiesForHousehold, listIdentitiesForHousehold, validEmail, validPassword,
  createInvite, getInvite, listInvites, revokeInvite, consumeInvite,
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
    const AUTH_LIMITED = new Set(["/api/household/claim", "/api/signup", "/api/login", "/api/verify-email", "/api/password-reset/request", "/api/password-reset/complete"]);
    if ((path === "/api/session" && method === "POST") || AUTH_LIMITED.has(path)) {
      if (rateLimited("auth", rlKeyIp, 20, 60_000)) {
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
      return json(res, 200, {
        ok: true, version: VERSION, time: new Date().toISOString(), runtime: "node-http", node: process.version, env: IS_PROD ? "production" : "development",
        browserRuntime: !!(browserHealth && browserHealth.ok),
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
        return json(res, 200, { session: { actorId: s.actorId, actorName: s.actorName, role: s.role, csrf: s.csrf, householdId: s.householdId } }, req);
      }
      if (method === "POST") {
        const body = await readBody(req);
        if (!body) return json(res, 400, { error: "malformed_json" }, req);
        const { actorId } = body;
        if (!actorId) return json(res, 400, { error: "actor_required" }, req);
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
        let pinHash = getSettings(CURRENT_TENANT).ownerPinHash; // login predates a session: resident household
        if (!pinHash && process.env.HOMEOPS_BOOTSTRAP_PIN) {
          pinHash = crypto.createHash("sha256").update(String(process.env.HOMEOPS_BOOTSTRAP_PIN)).digest("hex");
        }
        if (role === "Owner" || role === "Adult Admin") {
          if (!pinHash && IS_PROD) {
            audit({ type: "session.login", ok: false, error: "pin_not_configured", actorId }, req);
            return json(res, 403, { error: "pin_not_configured", message: "Elevated sign-in is locked until an Owner PIN exists. Set HOMEOPS_BOOTSTRAP_PIN in the deployment's environment, then sign in with it." }, req);
          }
          if (pinHash) {
            const given = crypto.createHash("sha256").update(String(body.pin ?? "")).digest("hex");
            if (given !== pinHash) { audit({ type: "session.login", ok: false, error: "bad_pin", actorId }, req); return json(res, 403, { error: "pin_required" }, req); }
          }
        }
        const s = createSession({ actorId, actorName, role, householdId: member.householdId ?? "local" });
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
      const pinSet = !!(getSettings(CURRENT_TENANT).ownerPinHash || process.env.HOMEOPS_BOOTSTRAP_PIN);
      const profiles = listMembers({ householdId: "local" }).filter((m) => !m.archived).map((m) => ({
        actorId: m.actorId, displayName: m.displayName, role: m.role, relationship: m.relationship ?? null,
        pinRequired: pinSet && (m.role === "Owner" || m.role === "Adult Admin"),
      }));
      return json(res, 200, {
        profiles,
        claimed: profiles.some((p) => !SEED_ACTOR_IDS.includes(p.actorId)),
        householdName: getSettings(CURRENT_TENANT).householdName ?? null,
      }, req);
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
        if (!invite) setSettings({ householdName: String(body.householdName ?? "").trim().slice(0, 60) || `${ownerName}'s household`, householdCreatedAt: Date.now() }, householdId);
        appendAudit({ type: invite ? "household.join" : "household.signup", email, actorId, role });
      });
      const s = createSession({ actorId, actorName: ownerName, role, householdId });
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
    if (path === "/api/password-reset/request" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      beginPasswordReset(String(body.email ?? "")); // 200 either way — no account enumeration
      return json(res, 200, { ok: true, message: "If that email has an account, a reset link is on its way." }, req);
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
    if (path === "/api/store/quarantine/ack" && method === "POST") {
      const g = gate(req, { minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body?.file) return json(res, 400, { error: "file_required" }, req);
      const ok = acknowledgeQuarantine(String(body.file));
      audit({ type: "store.quarantine_ack", file: body.file, ok }, req, g.session);
      return json(res, 200, { ok }, req);
    }

    // Data revision — one tiny number that changes whenever household data does.
    // Clients poll this (cheap) and refetch screens only on change, which keeps
    // web and iOS in sync within seconds without websocket plumbing.
    if (path === "/api/rev" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { rev: getDataRev() }, req);
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
      const providers = listConnectorProviders().map((p) => ({ ...p, accounts: byProvider[p.id] ?? [] }));
      return json(res, 200, { providers, redirectUri: oauthRedirectUri() }, req);
    }
    if (path === "/api/accounts" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { accounts: listAccountsFor(g.session.householdId, g.session.actorId) }, req);
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
      let run;
      if (body.skillId) {
        const out = await runSkill({ skillId: body.skillId, params: body.params ?? {}, session: g.session, source: body.source ?? "skill" });
        if (out.error) return json(res, out.error === "unknown_skill" ? 404 : 422, { error: out.error }, req);
        run = out.run;
      } else if (body.plan && typeof body.plan === "object") {
        run = await startRun({ source: body.source ?? "manual", sourceRef: body.sourceRef ?? {}, plan: body.plan, params: body.params ?? {}, session: g.session });
      } else {
        return json(res, 400, { error: "plan_or_skill_required" }, req);
      }
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
      const TERMINAL_RUN = ["completed", "failed", "cancelled", "expired"];
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
      const withEditable = visible.map((e) => ({
        ...e,
        editable: e.layer === "canonical"
          ? (isAdultRole(g.session.role) || e.ownerId === g.session.actorId)
          : isEditableLinkedGoogle(e, g.session.householdId, g.session.actorId),
      }));
      return json(res, 200, { events: withEditable }, req);
    }
    if (path === "/api/events" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!String(body.title ?? "").trim()) return json(res, 400, { error: "title_required" }, req);
      const ev = putEvent({
        id: "ev_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        title: String(body.title).trim(), startAt: body.startAt ?? null, endAt: body.endAt ?? null,
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
      deleteEventRec(ev.id);
      audit({ type: "event.delete", eventId: ev.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
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
      const tk = putTask({
        id: "tk_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        title: String(body.title).trim(), type: body.type ?? "task", status: body.status ?? "todo",
        dueAt: body.dueAt ?? null, assignedMemberId: body.assignedMemberId ?? null, spaceId: body.spaceId ?? "sp-family",
        priority: body.priority ?? "medium", amount: body.amount ?? null, visibility: body.visibility ?? "household",
        listName: body.listName ?? undefined,
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
      // Copy tracks direction: the notified party is always the creator (hr.fromActorId).
      // ask → "X accepted your request"; offer → "X accepted your help offer".
      const noun = hr.kind === "offer" ? "help offer" : "request";
      const title = hr.kind === "offer" ? `Help offer ${status}` : `Request ${status}`;
      const note = responseNote ? ` — ${responseNote}` : "";
      addNotification({ householdId: g.session.householdId, actorId: hr.fromActorId, channel: "in_app", title, body: `${hr.toName} ${status} your ${noun}${note}` });
      void pushToMember({ householdId: g.session.householdId, actorId: hr.fromActorId, title, body: `${hr.toName} ${status} your ${noun}${note}`, data: { type: "help_request", id: hr.id } });
      audit({ type: "help.respond", helpRequestId: hr.id, status, ok: true }, req, g.session);
      return json(res, 200, { helpRequest: updated }, req);
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
      audit({ type: "meal.create", mealId: meal.id, ok: true }, req, g.session);
      return json(res, 200, { meal }, req);
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
      // Add each not-yet-have ingredient to the shared Groceries list (reusing list-tasks).
      // mealId is a real back-reference (the notes string is just human-readable context).
      const added = [];
      for (const ing of (m.ingredients ?? []).filter((i) => !i.have && i.item)) {
        const tk = putTask({
          id: "tk_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
          title: ing.item, type: "list", status: "todo", listName: "Groceries", spaceId: "sp-family",
          priority: "low", visibility: "household", source: "user", createdBy: g.session.actorId,
          notes: `For ${m.title}`, mealId: m.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        added.push(tk.id);
      }
      audit({ type: "meal.to_grocery", mealId: m.id, added: added.length, ok: true }, req, g.session);
      return json(res, 200, { ok: true, added: added.length }, req);
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
        title: String(body.title ?? "New chat").slice(0, 80), messages: [],
        visibility: body.visibility === "household" ? "household" : "personal",
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
        allowedAgentIds: Array.isArray(body.allowedAgentIds) ? body.allowedAgentIds.filter((a) => typeof a === "string") : [],
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
        if (v !== cm.value) { patch.value = v; patch.verified = false; patch.optInStatus = "Pending"; patch.verifiedVia = null; deleteContactVerification(cm.id); }
      }
      if (body.allowedAgentIds != null) {
        if (!Array.isArray(body.allowedAgentIds)) return json(res, 400, { error: "bad_allowed_agents" }, req);
        patch.allowedAgentIds = body.allowedAgentIds.filter((a) => typeof a === "string");
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
      const visible = listFiles((f) => f.householdId === g.session.householdId).filter((f) => canSeeEntity(f, g.session))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return json(res, 200, { files: visible }, req);
    }
    if (path === "/api/files" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const name = String(body.name ?? "").trim();
      if (!name) return json(res, 400, { error: "name_required" }, req);
      const CAP = 7_000_000; // ~5 MB of base64, enforced per page
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
          if (pb64.length > CAP) return json(res, 413, { error: "too_large", message: "Each page is capped at ~5 MB." }, req);
          let buf;
          try { buf = Buffer.from(pb64, "base64"); } catch { return json(res, 400, { error: "bad_base64" }, req); }
          if (!buf || buf.length === 0) return json(res, 400, { error: "bad_base64" }, req);
          pageBufs.push({ name: typeof p?.name === "string" && p.name.trim() ? p.name.trim() : null, buf });
        }
      } else {
        const b64 = String(body.contentBase64 ?? "");
        if (!b64) return json(res, 400, { error: "content_required" }, req);
        if (b64.length > CAP) return json(res, 413, { error: "too_large", message: "Files are capped at ~5 MB." }, req);
        let buf;
        try { buf = Buffer.from(b64, "base64"); } catch { return json(res, 400, { error: "bad_base64" }, req); }
        if (!buf || buf.length === 0) return json(res, 400, { error: "bad_base64" }, req);
        pageBufs.push({ name: null, buf });
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
        createdAt: new Date().toISOString(),
      });
      pageBufs.forEach((p, i) => writeFileBlob(pageBlobIds[i], p.buf));
      audit({ type: "file.upload", fileId: rec.id, name, sizeBytes, pageCount: pageBufs.length, ok: true }, req, g.session);
      return json(res, 200, { file: rec }, req);
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
    const skillAction = path.match(/^\/api\/skills\/([^/]+)\/(run|test|duplicate|promote|rollback|versions)$/);
    if (skillAction) {
      const [, id, action] = skillAction;
      const g = gate(req, action === "versions" ? { requireSession: true } : { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const s = getSkill(id);
      if (!s || (s.householdId !== "local" && s.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
      if (action === "versions" && method === "GET") {
        return json(res, 200, { versions: listSkillVersions(id) }, req);
      }
      if (method !== "POST") return json(res, 405, { error: "method_not_allowed" }, req);
      if (action === "run") {
        const body = await readBody(req);
        const out = await testSkill({ skillId: id, params: body?.params ?? {}, session: g.session });
        if (out.error) return json(res, out.error === "unknown_skill" ? 404 : 422, { error: out.error }, req);
        audit({ type: "skill.run", skillId: id, runId: out.run?.id, ok: true }, req, g.session);
        return json(res, 200, { run: out.run }, req);
      }
      if (action === "test") {
        const body = await readBody(req);
        const params = body?.params ?? (s.test_cases?.[0]?.params ?? {});
        const out = await testSkill({ skillId: id, params, session: g.session });
        if (out.error) return json(res, out.error === "unknown_skill" ? 404 : 422, { error: out.error }, req);
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

    /* ---- Agent registry (Slice 5) ---- */
    if (path === "/api/agents" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { agents: listPublicAgents(g.session, { status: url.searchParams.get("status") || undefined }) }, req);
    }
    if (path === "/api/agents" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!body.name?.trim()) return json(res, 400, { error: "name_required" }, req);
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
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const a = getAgent(id);
        if (!a || (a.householdId !== "local" && a.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
        const updated = method === "PUT" ? replaceAgent(id, body) : partialUpdateAgent(id, body);
        audit({ type: "agent.update", agentId: id, ok: true }, req, g.session);
        return json(res, 200, { agent: publicAgent(updated) }, req);
      }
      if (method === "DELETE") {
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const a = getAgent(id);
        if (!a || (a.householdId !== "local" && a.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        const r = deleteAgent(id);
        if (r.error) return json(res, r.error === "not_found" ? 404 : 422, { error: r.error }, req);
        audit({ type: "agent.delete", agentId: id, ok: true }, req, g.session);
        return json(res, 200, { ok: true }, req);
      }
    }
    const agentAction = path.match(/^\/api\/agents\/([^/]+)\/(run|duplicate|rollback|versions|context)$/);
    if (agentAction) {
      const [, id, action] = agentAction;
      const g = gate(req, (action === "versions" || action === "context") ? { requireSession: true } : { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const a = getAgent(id);
      if (!a || (a.householdId !== "local" && a.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
      if (action === "versions" && method === "GET") return json(res, 200, { versions: listAgentVersions(id) }, req);
      if (action === "context" && method === "GET") return json(res, 200, { context: agentContext(a, g.session) }, req);
      if (method !== "POST") return json(res, 405, { error: "method_not_allowed" }, req);
      if (action === "run") {
        const body = await readBody(req);
        const out = await runAgent({ agentId: id, goal: body?.goal, skillId: body?.skillId, params: body?.params ?? {}, session: g.session, source: body?.source ?? "agent" });
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
      return json(res, 200, { settings: { externalActionsEnabled: s.externalActionsEnabled !== false, ownerPinSet: !!s.ownerPinHash, aiActiveProvider: s.aiActiveProvider ?? null, calendarAutoSync: s.calendarAutoSync === true, autoApproveImprovements: s.autoApproveImprovements !== false } }, req);
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
      if (typeof body.ownerPin === "string" && body.ownerPin) patch.ownerPinHash = crypto.createHash("sha256").update(body.ownerPin).digest("hex");
      const next = setSettings(patch, g.session.householdId);
      audit({ type: "settings.update", ok: true, changed: Object.keys(patch), prevExternalActions: prev.externalActionsEnabled, nextExternalActions: next.externalActionsEnabled }, req, g.session);
      return json(res, 200, { settings: { externalActionsEnabled: next.externalActionsEnabled !== false, ownerPinSet: !!next.ownerPinHash, aiActiveProvider: next.aiActiveProvider ?? null, calendarAutoSync: next.calendarAutoSync === true, autoApproveImprovements: next.autoApproveImprovements !== false } }, req);
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
      // Prior turns from the durable conversation ride into the model call —
      // otherwise the assistant forgets facts stated one message earlier.
      const histConv = body.conversationId ? getConversation(body.conversationId) : null;
      const history = histConv && canSeeConversation(histConv, g.session) ? histConv.messages : [];
      const out = await assistantRespond({ message: body.message, context: body.context, session: g.session, providerId: body.providerId, history });
      // Do-requests EXECUTE immediately (C-intel): a plan from chat auto-starts as a
      // durable server run — no "Run plan" click. Approval-gated steps still pause
      // for human sign-off inside the run, and results append back to this thread.
      // Only BUILD proposals (agent creation) wait for explicit confirmation.
      if (out.ok && out.kind === "plan" && out.plan && roleAtLeast(g.session.role, "Limited Member")) {
        try {
          const run = await startRun({
            source: "assistant",
            sourceRef: { conversationId: body.conversationId ?? null, via: "chat" },
            plan: out.plan, session: g.session, title: out.plan.title,
          });
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
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...corsHeaders(req) });
      let tokenCount = 0;
      try {
        const histConv = body.conversationId ? getConversation(body.conversationId) : null;
        const history = histConv && canSeeConversation(histConv, g.session) ? histConv.messages : [];
        const out = await assistantStream(
          { message: body.message, context: body.context, session: g.session, providerId: body.providerId, history },
          (_tok) => { tokenCount++; if (tokenCount % 4 === 0) res.write(`data: ${JSON.stringify({ type: "progress", tokens: tokenCount })}\n\n`); },
        );
        // Do-requests auto-execute here too (see POST /api/assistant): the run starts
        // before the "done" event so the client can attach to it immediately.
        if (out.ok && out.kind === "plan" && out.plan && roleAtLeast(g.session.role, "Limited Member")) {
          try {
            const run = await startRun({
              source: "assistant",
              sourceRef: { conversationId: body.conversationId ?? null, via: "chat" },
              plan: out.plan, session: g.session, title: out.plan.title,
            });
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
        if (body.conversationId) {
          const conv = getConversation(body.conversationId);
          if (conv && canSeeConversation(conv, g.session)) {
            const at = new Date().toISOString();
            appendConversationMessage(conv.id, { role: "user", text: String(body.message), at });
            appendConversationMessage(conv.id, out.ok
              ? { role: "assistant", kind: out.kind, text: out.answer ?? "", plan: out.plan ?? null, build: out.build ?? null, runId: out.run?.id ?? null, model: out.model ?? null, at }
              : { role: "assistant", kind: "error", text: out.message || "I couldn't respond — no AI provider is available. Add one in Settings → AI Providers, then ask me again.", error: out.error ?? "assistant_error", at });
          }
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
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const aiGated = childAiGate(g, res, req); if (aiGated) return aiGated;
      const gated = planGate(g, res, req); if (gated) return gated;
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const spec = body.build ?? body;
      const hasEdits = Array.isArray(spec?.edits) && spec.edits.length > 0;
      if (!spec || (typeof spec !== "object") || (!spec.skill && !spec.agent && !spec.automation && !hasEdits)) {
        return json(res, 400, { error: "empty_build", message: "Describe at least a skill, agent, automation, or edit to make." }, req);
      }
      try {
        const out = materializeBuild(spec, { session: g.session, req });
        persistBuildOutcome(body.conversationId, g.session, out);
        return json(res, 200, { ok: true, ...out }, req);
      } catch (e) {
        return json(res, 422, { ok: false, error: "build_failed", message: String(e?.message ?? e) }, req);
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
        res.write(`data: ${JSON.stringify({ type: "done", result: { ok: false, error: "build_failed", message: String(e?.message ?? e) } })}\n\n`);
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
      const all = listEvolutions((e) => !e.householdId || e.householdId === g.session.householdId).map((e) => ({
        ...e,
        source: e.source ?? "trace",
        after: e.after ?? null,
        risk: e.risk ?? null,
        agentId: e.agentId ?? null,
        agentName: e.agentId ? (getAgent(e.agentId)?.name ?? null) : null,
        autoApproved: e.autoApproved === true,
        autoReason: e.autoReason ?? null,
      }));
      return json(res, 200, { evolutions: all }, req);
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
        if (e.kind === "agent" && e.agentId) {
          const r = partialUpdateAgent(e.agentId, { instructions: e.after });
          if (r && !r.error) applied = true; else applyError = r?.error ?? "update_failed";
        } else if (e.kind === "skill" && e.skillId) {
          // Skill schema uses snake_case planner_guidance — the camelCase key silently
          // no-opped, so accepting a skill evolution never actually changed the guidance.
          const r = partialUpdateSkill(e.skillId, { planner_guidance: e.after });
          if (r && !r.error) applied = true; else applyError = r?.error ?? "update_failed";
        }
      }
      patchEvolution(id, { status: accept ? "accepted" : "rejected", reviewedAt: Date.now(), reviewedBy: g.session.actorId });
      audit({ type: "evolution.review", id, accept, applied, applyError, kind: e.kind, agentId: e.agentId }, req, g.session);
      return json(res, 200, { ok: true, applied, applyError, evolution: getEvolution(id) }, req);
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
    const agent = createAgent({
      ...spec.agent, skillIds,
      allowedToolIds: [...new Set([...(Array.isArray(spec.agent.allowedToolIds) ? spec.agent.allowedToolIds : []), ...derived.allowedToolIds])],
      allowedFunctionIds: [...new Set([...(Array.isArray(spec.agent.allowedFunctionIds) ? spec.agent.allowedFunctionIds : []), ...derived.allowedFunctionIds])],
    }, session);
    created.agent = { id: agent.id, name: agent.name, status: agent.status, allowedToolIds: agent.allowedToolIds, allowedFunctionIds: agent.allowedFunctionIds };
    audit({ type: "assistant.build", entity: "agent", agentId: agent.id, ok: true, tools: agent.allowedToolIds.length }, req, session);
    emit({ type: "progress", entity: "agent", action: "created", id: agent.id, name: agent.name, status: agent.status });
  }
  if (spec.automation && typeof spec.automation === "object") {
    const a = spec.automation;
    const target = a.target ?? (created.agent
      ? { kind: "agent", agentId: created.agent.id, params: a.params ?? {} }
      : created.skill
        ? { kind: "skill", skillId: created.skill.id, params: a.params ?? {} }
        : a.target);
    const trig = createTrigger({ ...a, target }, session, Date.now());
    created.automation = { id: trig.id, name: trig.name, type: trig.type, enabled: trig.enabled };
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
  if (created.agent && created.agent.status === "Draft") notes.push("The new helper is a draft — open Helper Agents to activate it.");
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
  // Recovery + sweeps + trigger tick run once PER HOUSEHOLD, each inside that
  // household's tenant context — one family's broken state never blocks another's.
  void forEachTenant(() => recoverRuns()); // re-drive any runs that were mid-flight at shutdown
  setInterval(() => { void forEachTenant(() => expireStaleRuns()); }, 60_000); // sweep stale parked runs
  setInterval(() => { void forEachTenant(() => tick()); }, 10_000); // fire due schedule/recurring triggers
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
