// HomeOps AI — backend control plane (Node built-in http; no extra dependencies).
// Deny-by-default authority: origin allowlist, authenticated sessions, CSRF on
// mutations, role checks, server-side approval records (consume-once), PKCE OAuth,
// HMAC webhooks, SSRF-guarded egress, a real job scheduler, AI provider adapters,
// and audit logging with actor/origin/request identity.
import "./loadEnv.mjs"; // must run before modules that read env at import time (auth.mjs)
import http from "node:http";
import crypto from "node:crypto";
import {
  getConnectorConfig, setConnectorConfig, revokeConnector, getSecret,
  appendAudit, readAudit, getWebhookEvents, addWebhookEvent, getSettings, setSettings,
  createSession, deleteSession, createApproval, getApproval, decideApproval, consumeApproval, listApprovals,
  putOAuthState, takeOAuthState, getHealth, setHealth, getJobState, setJobState, seenWebhookNonce,
  getPushTokens, addPushToken, removePushToken,
  getRun, listRuns, getSkill, listSkills,
  listEvolutions, getEvolution, patchEvolution, putEvolution,
  getMember, listMembers, canApprove, isAdultRole,
  listEvents, getEvent, putEvent, patchEvent, deleteEventRec,
  listTasks, getTask, putTask, patchTask, deleteTaskRec,
  listConversations, getConversation, putConversation, appendConversationMessage, deleteConversationRec,
  canSeeEntity, listMemory, listArtifacts,
} from "./store.mjs";
import { startRun, resumeRun, cancelRun, recoverRuns, findRunByApprovalId, runEmitter, expireStaleRuns } from "./engine.mjs";
import { runSkill, runAgent } from "./orchestrator.mjs";
import { seedDefaults } from "./seed.mjs";
import {
  createAgent, replaceAgent, partialUpdateAgent, deleteAgent, duplicateAgent,
  rollbackAgent, listAgentVersions, agentContext, selectAgent, publicAgent, listPublicAgents,
} from "./agents.mjs";
import { getAgent } from "./store.mjs";
import {
  createSkill, replaceSkill, partialUpdateSkill, deleteSkill, duplicateSkill,
  promoteSkill, rollbackSkill, inferFunctions, testSkill, listSkillVersions,
} from "./skills.mjs";
import {
  createFunction, replaceFunction, partialUpdateFunction, deleteFunction, duplicateFunction,
  promoteFunction, deprecateFunction, rollbackFunction, testFunction,
  listPublicFunctions, publicFunction, FUNCTION_TYPES, FUNCTION_STATES,
} from "./functions.mjs";
import { getFunction, listFunctionVersions } from "./store.mjs";
import {
  createTrigger, updateTrigger, deleteTrigger, fireTrigger, fireWebhookTrigger, fireConnectorEvent,
  publicTrigger, listPublicTriggers, getTriggerSecret, tick, TRIGGER_TYPES,
} from "./triggers.mjs";
import { getTrigger } from "./store.mjs";
import { pushApprovalNotification } from "./notify.mjs";
import { listConnectors, connectorById, publicConnector, healthCheck, executeTool, readinessOf } from "./connectors.mjs";
import { gate, corsHeaders, sessionCookie, clearSessionCookie, isAllowedOrigin, ALLOWED_ORIGINS, IS_PROD, roleAtLeast } from "./auth.mjs";
import { listProviders as listAIProviders, aiProviderById, setProviderConfig, revokeProvider, setActiveProvider, providerHealth, providerModels, providerChat } from "./ai.mjs";
import { listProviders as listConnectorProviders, providerById as connectorProviderById, providerConfigured, publicProvider as publicConnectorProvider, findToolGlobal } from "./providers.mjs";
import { buildAuthUrl, exchangeCode, apiForAccount } from "./oauth.mjs";
import { listAccountsFor, getOwnedAccount, upsertAccount, revokeAccount, checkAccountHealth, publicAccount } from "./accounts.mjs";
import { planFromGoal, generateMiniApp, generatePlaybook, assistantRespond, assistantStream, proposeEvolution, toolCatalog } from "./planner.mjs";

const PORT = Number(process.env.PORT || 8787);
const VERSION = "1.2.0";
const APP_ORIGIN = ALLOWED_ORIGINS[0] || "http://localhost:5173";
// Single OAuth callback path; deployments register this exact URI per provider app.
function oauthRedirectUri() {
  const base = process.env.HOMEOPS_PUBLIC_URL || `http://localhost:${PORT}`;
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
function readRaw(req) {
  return new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(b)); });
}
async function readBody(req) {
  const raw = await readRaw(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { return null; }
}
function externalActionsEnabled() { return getSettings().externalActionsEnabled !== false; }
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
  if (!externalActionsEnabled()) { setJobState(job.id, { running: false, lastStatus: "blocked_kill_switch" }); appendAudit({ type: "job.run", jobId: job.id, connectorId: job.connectorId, ok: false, error: "kill_switch", trigger }); return { ok: false, error: "external_actions_disabled" }; }
  if (!ready) { setJobState(job.id, { running: false, lastStatus: `connector_${readiness}` }); appendAudit({ type: "job.run", jobId: job.id, connectorId: job.connectorId, ok: false, error: `connector_${readiness}`, trigger }); return { ok: false, error: `connector_${readiness}` }; }
  const out = await executeTool(job.toolId, {}, { actorId: "scheduler" });
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
const server = http.createServer(async (req, res) => {
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
    /* ---- Health (origin-allowed, no session; used to detect backend) ---- */
    if (path === "/api/health") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const browserCfg = getConnectorConfig("browser");
      const browserHealth = getHealth("browser");
      return json(res, 200, {
        ok: true, version: VERSION, time: new Date().toISOString(), runtime: "node-http", env: IS_PROD ? "production" : "development",
        browserRuntime: !!(browserHealth && browserHealth.ok),
        externalActionsEnabled: externalActionsEnabled(),
        webhookBaseUrl: `http://localhost:${PORT}`,
        authRequired: true,
      }, req);
    }

    /* ---- OAuth callback (top-level browser redirect from provider) ----
     * The session cookie is NOT available here (provider redirects straight to the
     * backend origin), so actor/household are carried in the server-persisted state. */
    if (path === "/api/oauth/callback" && method === "GET") {
      const code = url.searchParams.get("code"); const state = url.searchParams.get("state") || "";
      const st = takeOAuthState(state);
      if (!st || !code) {
        audit({ type: "oauth.callback", ok: false, error: "invalid_state" }, req);
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(htmlMessage("Connection failed", "This authorization link is invalid or expired. Please start again from HomeOps."));
      }
      const provider = connectorProviderById(st.provider);
      if (!provider) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(htmlMessage("Connection failed", "Unknown provider."));
      }
      try {
        const ex = await exchangeCode(provider, { code, codeVerifier: st.codeVerifier, redirectUri: oauthRedirectUri() });
        if (!ex.ok) {
          audit({ type: "oauth.callback", provider: st.provider, ok: false, error: "token_exchange_failed" }, req);
          res.writeHead(200, { "content-type": "text/html" });
          return res.end(htmlMessage("Authorization error", "The provider did not return an access token. Please try connecting again."));
        }
        const acct = await upsertAccount({ provider: st.provider, householdId: st.householdId, actorId: st.actorId, tokens: ex.tokens });
        appendAudit({ type: "oauth.callback", provider: st.provider, ok: true, actorId: st.actorId, accountId: acct.id });
        // Mobile-initiated flows: redirect to the homeops:// scheme so ASWebAuthenticationSession
        // hands control back to the app. Web flows: postMessage to the opener window.
        if (st.from === "mobile") {
          const mobileUri = `homeops://oauth-callback?ok=1&provider=${encodeURIComponent(st.provider)}&displayName=${encodeURIComponent(acct.displayName ?? "")}`;
          res.writeHead(302, { location: mobileUri });
          return res.end();
        }
        const target = st.appOrigin && isAllowedOrigin(st.appOrigin) ? st.appOrigin : APP_ORIGIN;
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#f4f0e9;color:#1f2535;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:40px">✓</div><h2>${escapeHtml(provider.name)} connected</h2><p style="color:#4a5568">Signed in as ${escapeHtml(acct.displayName)} — returning to HomeOps…</p></div><script>try{window.opener&&window.opener.postMessage({type:"homeops-oauth",provider:${JSON.stringify(st.provider)},ok:true},${JSON.stringify(target)})}catch(e){}setTimeout(()=>window.close(),900)</script></body>`);
      } catch (e) {
        appendAudit({ type: "oauth.callback", provider: st.provider, ok: false, error: "exception" });
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(htmlMessage("Connection failed", "Something went wrong completing the connection."));
      }
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
        if (!member) { audit({ type: "session.login", ok: false, error: "unknown_actor", actorId }, req); return json(res, 403, { error: "unknown_actor" }, req); }
        const role = member.role;
        const actorName = member.displayName ?? body.actorName ?? actorId;
        // Optional owner PIN gate for elevated roles (gated on the RESOLVED role).
        const pinHash = getSettings().ownerPinHash;
        if (pinHash && (role === "Owner" || role === "Adult Admin")) {
          const given = crypto.createHash("sha256").update(String(body.pin ?? "")).digest("hex");
          if (given !== pinHash) { audit({ type: "session.login", ok: false, error: "bad_pin", actorId }, req); return json(res, 403, { error: "pin_required" }, req); }
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
      const members = listMembers({ householdId: g.session.householdId }).map((m) => ({
        actorId: m.actorId, displayName: m.displayName, role: m.role, relationship: m.relationship ?? null,
        spaceIds: m.spaceIds ?? [], isCurrentUser: m.actorId === g.session.actorId,
      }));
      return json(res, 200, { members }, req);
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
        if (!externalActionsEnabled() && ["Write", "Send", "Download"].includes(platform.tool.action)) return json(res, 423, { ok: false, error: "external_actions_disabled", message: "External actions are paused by the household kill switch." }, req);
        const accounts = listAccountsFor(g.session.householdId, g.session.actorId).filter((a) => a.provider === platform.provider.id);
        const account = body.accountId ? accounts.find((a) => a.id === body.accountId) : accounts[0];
        if (!account) { audit({ type: "tool.execute", toolId, ok: false, error: "no_account" }, req, g.session); return json(res, 422, { ok: false, error: "not_connected", message: `Connect your ${platform.provider.name} account to use this tool.` }, req); }
        try {
          const result = await platform.tool.run(apiForAccount(account), input);
          audit({ type: "tool.execute", connectorId: platform.provider.id, toolId, accountId: account.id, ok: true, action: platform.tool.action }, req, g.session);
          return json(res, 200, { ok: true, result }, req);
        } catch (e) {
          audit({ type: "tool.execute", connectorId: platform.provider.id, toolId, accountId: account.id, ok: false, error: "provider_error" }, req, g.session);
          return json(res, 422, { ok: false, error: "provider_error", message: String(e?.message ?? e) }, req);
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
      return json(res, 200, { events: visible }, req);
    }
    if (path === "/api/events" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!String(body.title ?? "").trim()) return json(res, 400, { error: "title_required" }, req);
      const ev = putEvent({
        id: "ev_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        title: String(body.title).trim(), startAt: body.startAt ?? null, endAt: body.endAt ?? null,
        location: body.location ?? "", spaceId: body.spaceId ?? "sp-family",
        participantIds: Array.isArray(body.participantIds) ? body.participantIds : [],
        driverId: body.driverId ?? null, ownerId: body.ownerId ?? g.session.actorId, backupOwnerId: body.backupOwnerId ?? null,
        whatToBring: body.whatToBring ?? [], checklist: body.checklist ?? [], travel: body.travel ?? null,
        reminders: body.reminders ?? [], attachments: [], comments: [], mealImpact: body.mealImpact ?? null,
        visibility: body.visibility ?? "household", category: body.category ?? "Family",
        layer: body.layer ?? "canonical", status: body.status ?? "confirmed",
        source: body.source ?? "HomeOps", provenance: { via: "user", actorId: g.session.actorId },
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
      // Three-layer calendar: only canonical (HomeOps-owned) events are editable. Linked
      // (read-only synced) and public (ICS subscription) events are externally owned —
      // editing them would blur source-of-truth, so we refuse and tell the client to copy.
      if (ev.layer && ev.layer !== "canonical") return json(res, 409, { error: "read_only_layer", message: "This event is synced from an external calendar and can't be edited here — copy it to a HomeOps event first." }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const { id, householdId, createdBy, createdAt, ...patch } = body; // never reassign identity/ownership-of-record
      const updated = patchEvent(ev.id, patch);
      audit({ type: "event.update", eventId: ev.id, ok: true }, req, g.session);
      return json(res, 200, { event: updated }, req);
    }
    if (eventOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const ev = getEvent(eventOne[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && ev.ownerId !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
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
      const onlyStatus = Object.keys(body).every((k) => ["status"].includes(k));
      const mayEdit = isAdultRole(g.session.role) || tk.createdBy === g.session.actorId || (onlyStatus && tk.assignedMemberId === g.session.actorId);
      if (!mayEdit) return json(res, 403, { error: "forbidden" }, req);
      const { id, householdId, createdBy, createdAt, ...patch } = body;
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

    /* ---- Server-durable assistant conversations (P1.1) ----
     * Threads/messages live server-side, scoped to the actor who owns them. */
    if (path === "/api/conversations" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const mine = listConversations((c) => c.householdId === g.session.householdId && c.actorId === g.session.actorId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return json(res, 200, { conversations: mine }, req);
    }
    if (path === "/api/conversations" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const c = putConversation({
        id: "conv_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId, actorId: g.session.actorId,
        title: String(body.title ?? "New chat").slice(0, 80), messages: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      return json(res, 200, { conversation: c }, req);
    }
    const convOne = path.match(/^\/api\/conversations\/([^/]+)$/);
    if (convOne && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const c = getConversation(convOne[1]);
      if (!c || c.householdId !== g.session.householdId || c.actorId !== g.session.actorId) return json(res, 404, { error: "not_found" }, req);
      return json(res, 200, { conversation: c }, req);
    }
    if (convOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const c = getConversation(convOne[1]);
      if (!c || c.householdId !== g.session.householdId || c.actorId !== g.session.actorId) return json(res, 404, { error: "not_found" }, req);
      deleteConversationRec(c.id);
      return json(res, 200, { ok: true }, req);
    }

    /* ---- Memory & artifacts (read; written by runs) — household-scoped ---- */
    if (path === "/api/memory" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Personal-scoped memory is private to its actor; family/household memory is shared.
      const all = listMemory({ householdId: g.session.householdId, limit: 200 });
      const visible = all.filter((m) => m.scope !== "personal" || m.source?.actorId === g.session.actorId || isAdultRole(g.session.role));
      return json(res, 200, { memory: visible }, req);
    }
    if (path === "/api/artifacts" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const all = listArtifacts({ householdId: g.session.householdId, runId: url.searchParams.get("runId") || undefined, limit: 100 });
      return json(res, 200, { artifacts: all }, req);
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
        if (!a || (a.householdId !== "local" && a.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
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
      if (!externalActionsEnabled()) return json(res, 423, { ok: false, error: "external_actions_disabled" }, req);
      const provider = connectorProviderById(oauthStartMatch[1]);
      if (!provider) return json(res, 404, { ok: false, error: "unknown_provider" }, req);
      if (!providerConfigured(provider)) return json(res, 422, { ok: false, error: "not_configured_by_deployment", message: `This deployment has not set ${provider.clientIdEnv} / ${provider.clientSecretEnv}.` }, req);
      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = provider.usePKCE ? crypto.createHash("sha256").update(codeVerifier).digest("base64url") : undefined;
      const state = `${provider.id}.${crypto.randomBytes(16).toString("hex")}`;
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
      if (!externalActionsEnabled()) return json(res, 423, { ok: false, error: "external_actions_disabled" }, req);
      const h = await healthCheck("browser");
      audit({ type: "browser.session", ok: h.ok, error: h.ok ? undefined : h.status }, req, g.session);
      if (!h.ok) return json(res, 422, { ok: false, status: "runtime_unavailable", message: "No executable browser automation runtime is connected. Set BROWSER_RUNTIME_URL to a reachable runtime to enable." }, req);
      return json(res, 200, { ok: true, status: "login_required", message: "Runtime reachable. Sign in within the secure browser session — we never ask for your password." }, req);
    }

    /* ---- Settings (kill switch, owner PIN) — admin only ---- */
    if (path === "/api/settings" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const s = getSettings();
      return json(res, 200, { settings: { externalActionsEnabled: s.externalActionsEnabled !== false, ownerPinSet: !!s.ownerPinHash, aiActiveProvider: s.aiActiveProvider ?? null } }, req);
    }
    if (path === "/api/settings" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const prev = getSettings();
      const patch = {};
      if (typeof body.externalActionsEnabled === "boolean") patch.externalActionsEnabled = body.externalActionsEnabled;
      if (typeof body.ownerPin === "string" && body.ownerPin) patch.ownerPinHash = crypto.createHash("sha256").update(body.ownerPin).digest("hex");
      const next = setSettings(patch);
      audit({ type: "settings.update", ok: true, changed: Object.keys(patch), prevExternalActions: prev.externalActionsEnabled, nextExternalActions: next.externalActionsEnabled }, req, g.session);
      return json(res, 200, { settings: { externalActionsEnabled: next.externalActionsEnabled !== false, ownerPinSet: !!next.ownerPinHash, aiActiveProvider: next.aiActiveProvider ?? null } }, req);
    }

    /* ---- AI providers ---- */
    if (path === "/api/ai/providers" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { providers: listAIProviders() }, req);
    }
    const aiCfg = path.match(/^\/api\/ai\/providers\/([^/]+)\/config$/);
    if (aiCfg && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!aiProviderById(aiCfg[1])) return json(res, 404, { error: "unknown_provider" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const p = setProviderConfig(aiCfg[1], body);
      audit({ type: "ai.config", providerId: aiCfg[1], ok: true }, req, g.session);
      return json(res, 200, { provider: p }, req);
    }
    if (aiCfg && method === "DELETE") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const p = revokeProvider(aiCfg[1]); if (!p) return json(res, 404, { error: "unknown_provider" }, req);
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
      setActiveProvider(body.providerId ?? null);
      audit({ type: "ai.active", providerId: body.providerId ?? null, ok: true }, req, g.session);
      return json(res, 200, { activeProvider: body.providerId ?? null }, req);
    }
    if (path === "/api/ai/chat" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const id = body.providerId || getSettings().aiActiveProvider;
      if (!id) return json(res, 400, { error: "no_provider", message: "No AI provider selected." }, req);
      const out = await providerChat(id, { messages: body.messages ?? [], model: body.model });
      audit({ type: "ai.chat", providerId: id, ok: out.ok, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }

    /* ---- Planner brain: plain English → plan / mini app / playbook ---- */
    if (path === "/api/agent/plan" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const out = await planFromGoal({ goal: body.goal, session: g.session, providerId: body.providerId });
      audit({ type: "agent.plan", ok: out.ok, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }
    if (path === "/api/assistant" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const out = await assistantRespond({ message: body.message, context: body.context, session: g.session, providerId: body.providerId });
      // The assistant is advisory: it ANSWERS or proposes a PLAN. Executing the plan
      // is an explicit user action ("Run plan") that starts a durable server run via
      // POST /api/runs/start — so the browser never orchestrates, and nothing runs
      // before the user approves the plan itself.
      // Server-durable thread: if a conversation is named, persist the turn so history
      // survives refresh and is owned by the server, not the client.
      if (out.ok && body.conversationId) {
        const conv = getConversation(body.conversationId);
        if (conv && conv.householdId === g.session.householdId && conv.actorId === g.session.actorId) {
          const at = new Date().toISOString();
          appendConversationMessage(conv.id, { role: "user", text: String(body.message), at });
          appendConversationMessage(conv.id, { role: "assistant", kind: out.kind, text: out.answer ?? "", plan: out.plan ?? null, model: out.model ?? null, at });
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
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...corsHeaders(req) });
      let tokenCount = 0;
      try {
        const out = await assistantStream(
          { message: body.message, context: body.context, session: g.session, providerId: body.providerId },
          (_tok) => { tokenCount++; if (tokenCount % 4 === 0) res.write(`data: ${JSON.stringify({ type: "progress", tokens: tokenCount })}\n\n`); },
        );
        audit({ type: "assistant.stream", ok: out.ok, kind: out.kind, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
        res.write(`data: ${JSON.stringify({ type: "done", result: out })}\n\n`);
      } catch (e) {
        res.write(`data: ${JSON.stringify({ type: "done", result: { ok: false, error: "stream_error" } })}\n\n`);
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
      const all = listEvolutions((e) => !e.householdId || e.householdId === g.session.householdId);
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
      addPushToken(body.token);
      audit({ type: "push.register", ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }
    if (path === "/api/push-tokens" && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (body.token) removePushToken(body.token);
      return json(res, 200, { ok: true }, req);
    }

    return json(res, 404, { error: "not_found", path }, req);
  } catch (e) {
    return json(res, 500, { error: "server_error", message: String(e?.message ?? e) }, req);
  }
});

function publicSkill(s) {
  // All fields are non-secret — expose the full skill record to authenticated same-household clients.
  return s;
}
function publicApproval(a) {
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
      attribution: s.attribution, status: s.status, approvalId: s.approvalId, attempts: s.attempts,
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
  return `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#f4f0e9;color:#1f2535;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;max-width:28rem;padding:1rem"><h2>HomeOps — ${escapeHtml(title)}</h2><p style="color:#4a5568">${escapeHtml(body)}</p></div></body>`;
}

server.listen(PORT, () => {
  seedDefaults();          // ensure a real agent + runnable hybrid skill exist
  recoverRuns().catch(() => {}); // re-drive any runs that were mid-flight at shutdown
  setInterval(() => { try { expireStaleRuns(); } catch { /* non-fatal */ } }, 60_000); // sweep stale parked runs
  setInterval(() => { tick().catch(() => {}); }, 10_000); // fire due schedule/recurring triggers (no browser needed)
  startScheduler();
  // If a browser runtime URL is configured, probe it once so the connector's
  // readiness reflects reality (connected vs. runtime_unavailable) from the start.
  if (process.env.BROWSER_RUNTIME_URL) healthCheck("browser").catch(() => {});
  // eslint-disable-next-line no-console
  console.log(`HomeOps backend (control plane v${VERSION}) listening on http://localhost:${PORT} — env=${IS_PROD ? "production" : "development"}, origins=${ALLOWED_ORIGINS.join(",") || "(none)"}`);
});
