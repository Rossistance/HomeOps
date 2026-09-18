// FamiliOS AI — CONNECTOR SANDBOX (WP-006 slice 3).
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SEAM (3 sentences)
// 1. When HOMEOPS_CONNECTOR_SANDBOX=1, the two OUTBOUND TRANSPORT chokepoints the
//    server owns are swapped for in-process deterministic mocks: `apiForAccount`
//    (oauth.mjs) — the bound provider `api()` every PROVIDERS tool and notify.mjs's
//    email path call — and `executeTool` (connectors.mjs) for the credentialed
//    `sms` connector.
// 2. The swap happens AFTER every CONSENT gate has already run for real (notify.mjs
//    verified + opted-in + per-agent allowlist + kill switch, the approval-consumed
//    check, and connector readiness), so sandbox mode replaces the WIRE, never the
//    decision to send — an unverified/blocked send still refuses and records nothing.
// 3. Every would-be side effect (send/label/upload/create/announce) is written to a
//    per-tenant `sandbox_effects` collection plus a `sandbox.effect` audit event so a
//    spec can assert exactly what WOULD have been delivered — content, recipient,
//    channel — while NO socket is ever opened to an external host (mocks are pure
//    in-process fixtures; net.mjs egress policy is untouched and never widened).
//
// HONEST COVERAGE — see SANDBOX_COVERAGE below and server/test/README-sandbox.md.
// Mocked: google (gmail, calendar, drive, google-home/SDM), microsoft365 (outlook,
// calendar, onedrive), slack, dropbox, amazon-alexa, and the sms/BlueBubbles connector.
// NOT mocked (fail closed / real path, honestly): notion, todoist, ticktick, and the
// no-credential connectors (weather, rss, http, web, browser) which already run for
// real without provisioned secrets.
// ─────────────────────────────────────────────────────────────────────────────

import {
  readJSON, writeJSON, appendAudit,
  getAccountRaw, putAccount, setAccountTokens, runWithTenant,
} from "./store.mjs";
import { providerById } from "./providers.mjs";

/** Live env check (never cached) so tests can toggle and real mode is byte-for-byte today's. */
export function sandboxEnabled() {
  return process.env.HOMEOPS_CONNECTOR_SANDBOX === "1";
}

// Providers whose account is seeded + whose api() is mocked. Anything else stays
// "not connected" and parks honestly (its real credential is the named blocker).
export const MOCKED_PROVIDER_IDS = ["google", "microsoft", "slack", "dropbox", "amazon-alexa"];
// Credentialed connectors (connectors.mjs CONNECTORS registry) covered on the executeTool path.
export const SANDBOX_CONNECTOR_IDS = new Set(["sms"]);
export const SANDBOX_CONNECTOR_TOOLS = new Set(["sms.send"]);

export function isSandboxConnectorTool(toolId) {
  return SANDBOX_CONNECTOR_TOOLS.has(toolId);
}

/* ------------------------------------------------------------------ *
 * Deterministic fake identities                                       *
 * ------------------------------------------------------------------ */
const IDENTITY = {
  google: { externalAccountId: "sbx-google-uid", displayName: "family.sandbox@gmail.com", email: "family.sandbox@gmail.com" },
  microsoft: { externalAccountId: "sbx-ms-uid", displayName: "family.sandbox@outlook.com", email: "family.sandbox@outlook.com" },
  slack: { externalAccountId: "T_SBX", displayName: "Sandbox Family (Slack)", team: "Sandbox Family" },
  dropbox: { externalAccountId: "dbid:sbx", displayName: "family.sandbox@dropbox.example", email: "family.sandbox@dropbox.example" },
  "amazon-alexa": { externalAccountId: "amzn1.sbx", displayName: "Sandbox Family (Amazon)", email: "family.sandbox@amazon.example" },
};
export function sandboxIdentity(providerId) {
  return IDENTITY[providerId] ?? { externalAccountId: `sbx-${providerId}`, displayName: `${providerId} (sandbox)` };
}

/* ------------------------------------------------------------------ *
 * Sandbox env fixtures for device layers whose tools fail closed on a *
 * missing project-id/endpoint BEFORE they call api() (SDM, Alexa).    *
 * Only fills UNSET vars, only in sandbox mode — real mode never sees   *
 * these, and the values are obviously synthetic + never contacted      *
 * (the api() mock intercepts before any socket).                       *
 * ------------------------------------------------------------------ */
export const SANDBOX_ALEXA_ENDPOINT = "https://alexa.sandbox.invalid";
// No one-shot cache here on purpose: a static env var (the real deployment case) is
// filled once for free either way, but a one-shot guard would permanently skip the
// fill if the var were ever unset again later in a long-lived process (e.g. a test
// process re-toggling env between cases) — cheap enough to just check every call.
function ensureSandboxEnvDefaults() {
  if (!sandboxEnabled()) return;
  if (!process.env.HOMEOPS_SDM_PROJECT_ID) process.env.HOMEOPS_SDM_PROJECT_ID = "sandbox-sdm-project";
  if (!process.env.HOMEOPS_ALEXA_ENDPOINT) process.env.HOMEOPS_ALEXA_ENDPOINT = SANDBOX_ALEXA_ENDPOINT;
}

/* ------------------------------------------------------------------ *
 * Per-tenant sandbox effect log                                        *
 * ------------------------------------------------------------------ */
let _seq = 0;
const nextId = (prefix) => `${prefix}-${++_seq}`;

/** Append an effect to the current tenant's sandbox_effects collection + audit. */
export function recordSandboxEffect(effect) {
  const rec = { id: nextId("sbx-eff"), at: new Date().toISOString(), sandbox: true, ...effect };
  try {
    const all = readJSON("sandbox_effects.json", []);
    all.push(rec);
    // keep the tail bounded — a long soak must not grow unbounded
    writeJSON("sandbox_effects.json", all.slice(-500));
  } catch { /* effect logging must never break a run */ }
  try {
    appendAudit({
      type: "sandbox.effect", toolId: rec.toolId, provider: rec.provider ?? null,
      connectorId: rec.connectorId ?? null, channel: rec.channel, recipient: rec.recipient ?? null,
      actorId: rec.actorId ?? null,
    });
  } catch { /* audit best-effort */ }
  return rec;
}
export function listSandboxEffects() {
  return readJSON("sandbox_effects.json", []);
}
export function clearSandboxEffects() {
  writeJSON("sandbox_effects.json", []);
}

/* ------------------------------------------------------------------ *
 * The mock provider transport — a drop-in for oauth.mjs apiForAccount. *
 * Contract MUST match rawFetch: resolves { ok, status, json, text }.   *
 * ------------------------------------------------------------------ */
function res(status, json) {
  return { ok: status >= 200 && status < 300, status, json, text: json == null ? "" : JSON.stringify(json) };
}
function unmocked(host, path) {
  // Honest fail-closed: no hollow success for a route we don't model.
  return res(501, { error: { message: `sandbox_unmocked:${host}${path}` } });
}

// base64url → utf8 (mirrors the encoder in server/mime.mjs buildRawEmail)
function decodeRaw(raw) {
  try {
    const b64 = String(raw || "").replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(b64, "base64").toString("utf8");
  } catch { return ""; }
}
/** RFC 2047 encoded-words (what mime.mjs emits for non-ASCII subjects) back to text. */
function decodeHeader(value) {
  return String(value ?? "").replace(/\r?\n[ \t]/g, "").replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gi, (_, b) => Buffer.from(b, "base64").toString("utf8"));
}
function splitHeadBody(text) {
  const idx = text.indexOf("\r\n\r\n") >= 0 ? text.indexOf("\r\n\r\n") : text.indexOf("\n\n");
  const head = idx >= 0 ? text.slice(0, idx) : text;
  const body = idx >= 0 ? text.slice(idx).replace(/^\s+/, "") : "";
  const headers = {};
  for (const line of head.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z-]+):\s?(.*)$/);
    if (m) headers[m[1].toLowerCase()] = decodeHeader(m[2]);
  }
  return { headers, body };
}
/** Headers + the human text of the message: the text/plain part of a multipart/alternative
 *  (base64-decoded, as mime.mjs writes it), or the whole body for a single-part message. */
function parseRfc822(text) {
  const { headers, body } = splitHeadBody(text);
  const boundary = (headers["content-type"] ?? "").match(/boundary="?([^";]+)"?/)?.[1];
  if (!boundary) return { headers, body };
  const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith("--"));
  const decodePart = (p) => {
    const { headers: ph, body: pb } = splitHeadBody(p.replace(/^\r?\n/, ""));
    const raw = pb.replace(/\r?\n--$/, "").trim();
    return /base64/i.test(ph["content-transfer-encoding"] ?? "") ? Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf8") : raw;
  };
  const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p)) ?? parts[0];
  return { headers, body: plain ? decodePart(plain) : body };
}
function bodyJson(opts) {
  try { return typeof opts.body === "string" ? JSON.parse(opts.body) : (opts.body ?? {}); } catch { return {}; }
}

// Deterministic Gmail message fixtures.
function gmailListFixture() {
  return { messages: [{ id: "sbx-msg-1", threadId: "sbx-thr-1" }, { id: "sbx-msg-2", threadId: "sbx-thr-2" }, { id: "sbx-msg-3", threadId: "sbx-thr-3" }], resultSizeEstimate: 3 };
}
function gmailMetaFixture(id) {
  const n = id.replace(/\D/g, "") || "1";
  const rows = {
    "1": { subject: "Field trip permission slip due Friday", from: "Lincoln Elementary <office@lincoln.example>" },
    "2": { subject: "Your order has shipped", from: "Orders <orders@shop.example>" },
    "3": { subject: "Soccer practice moved to 5pm", from: "Coach Dana <coach@rec.example>" },
  };
  const row = rows[n] ?? { subject: `Sandbox message ${n}`, from: `sender${n}@sandbox.example` };
  return {
    id, threadId: `sbx-thr-${n}`, snippet: `${row.subject} — sandbox preview text.`,
    labelIds: ["INBOX", "UNREAD", "CATEGORY_PRIMARY"],
    payload: { headers: [{ name: "Subject", value: row.subject }, { name: "From", value: row.from }] },
  };
}

function respondGoogle(host, path, method, opts, ctx) {
  if (host === "gmail.googleapis.com") {
    if (path === "/gmail/v1/users/me/profile") return res(200, { emailAddress: IDENTITY.google.email, messagesTotal: 1234 });
    if (path === "/gmail/v1/users/me/labels" && method === "GET") {
      return res(200, { labels: [
        { id: "INBOX", name: "INBOX", type: "system" }, { id: "SENT", name: "SENT", type: "system" },
        { id: "UNREAD", name: "UNREAD", type: "system" }, { id: "Label_sbx_school", name: "School", type: "user" },
      ] });
    }
    if (path === "/gmail/v1/users/me/labels" && method === "POST") {
      const b = bodyJson(opts);
      return res(200, { id: nextId("Label_sbx"), name: b.name, type: "user" });
    }
    if (path === "/gmail/v1/users/me/messages/send" && method === "POST") {
      const b = bodyJson(opts);
      const { headers, body } = parseRfc822(decodeRaw(b.raw));
      recordSandboxEffect({
        provider: "google", connectorId: "google", toolId: "gmail.send", action: "Send", channel: "email",
        recipient: headers.to ?? null, subject: headers.subject ?? null, content: body,
        accountId: ctx.accountId, actorId: ctx.actorId, householdId: ctx.householdId,
      });
      return res(200, { id: nextId("sbx-sent"), threadId: nextId("sbx-thr"), labelIds: ["SENT"] });
    }
    if (path === "/gmail/v1/users/me/messages/batchModify" && method === "POST") {
      const b = bodyJson(opts);
      recordSandboxEffect({
        provider: "google", connectorId: "google", toolId: "gmail.modifyLabels", action: "Write", channel: "gmail-label",
        recipient: (b.ids ?? []).join(","), content: JSON.stringify({ addLabelIds: b.addLabelIds ?? [], removeLabelIds: b.removeLabelIds ?? [] }),
        accountId: ctx.accountId, actorId: ctx.actorId, householdId: ctx.householdId,
      });
      return res(200, {});
    }
    if (path === "/gmail/v1/users/me/messages" && method === "GET") return res(200, gmailListFixture());
    if (path.startsWith("/gmail/v1/users/me/messages/") && method === "GET") {
      return res(200, gmailMetaFixture(path.split("/").pop()));
    }
  }
  if (host === "www.googleapis.com") {
    if (path === "/oauth2/v2/userinfo") return res(200, { id: IDENTITY.google.externalAccountId, email: IDENTITY.google.email, verified_email: true });
    if (path.startsWith("/calendar/v3/calendars/primary/events") && method === "GET") {
      return res(200, { items: [
        { id: "sbx-evt-1", summary: "Dentist — Noah", start: { dateTime: "2026-07-22T15:00:00Z" }, location: "Bright Smiles" },
        { id: "sbx-evt-2", summary: "Soccer practice", start: { dateTime: "2026-07-22T17:00:00Z" }, location: "Rec Center" },
      ] });
    }
    if (path.startsWith("/calendar/v3/calendars/primary/events") && method === "POST") {
      const b = bodyJson(opts);
      const id = nextId("sbx-evt");
      recordSandboxEffect({
        provider: "google", connectorId: "google", toolId: "calendar.create", action: "Write", channel: "calendar",
        recipient: "primary", subject: b.summary ?? null, content: JSON.stringify({ start: b.start, end: b.end, location: b.location }),
        accountId: ctx.accountId, actorId: ctx.actorId, householdId: ctx.householdId,
      });
      return res(200, { id, htmlLink: `https://calendar.google.com/event?eid=${id}` });
    }
    if (path.startsWith("/drive/v3/files")) {
      return res(200, { files: [
        { id: "sbx-file-1", name: "Field trip form.pdf", mimeType: "application/pdf", modifiedTime: "2026-07-20T10:00:00Z" },
        { id: "sbx-file-2", name: "Grocery list.txt", mimeType: "text/plain", modifiedTime: "2026-07-19T09:00:00Z" },
      ] });
    }
  }
  if (host === "smartdevicemanagement.googleapis.com") {
    if (path.endsWith("/devices") && method === "GET") {
      return res(200, { devices: [
        { name: "enterprises/sandbox-sdm-project/devices/sbx-nest-1", type: "sdm.devices.types.THERMOSTAT", parentRelations: [{ displayName: "Living Room" }] },
      ] });
    }
    if (path.endsWith(":executeCommand") && method === "POST") {
      const b = bodyJson(opts);
      recordSandboxEffect({
        provider: "google", connectorId: "google", toolId: "smarthome.setThermostat", action: "Write", channel: "device",
        recipient: decodeURIComponent(path.split("/devices/")[1]?.replace(":executeCommand", "") ?? ""), content: JSON.stringify(b?.params ?? {}),
        accountId: ctx.accountId, actorId: ctx.actorId, householdId: ctx.householdId,
      });
      return res(200, { results: {} });
    }
  }
  return unmocked(host, path);
}

function respondMicrosoft(host, path, method, opts, ctx) {
  if (host !== "graph.microsoft.com") return unmocked(host, path);
  if (path === "/v1.0/me") return res(200, { id: IDENTITY.microsoft.externalAccountId, userPrincipalName: IDENTITY.microsoft.email, mail: IDENTITY.microsoft.email });
  if (path.startsWith("/v1.0/me/messages") && method === "GET") {
    return res(200, { value: [
      { subject: "Team lunch Thursday", from: { emailAddress: { address: "hr@work.example" } }, bodyPreview: "We're doing a team lunch…" },
      { subject: "Invoice #4471", from: { emailAddress: { address: "billing@vendor.example" } }, bodyPreview: "Attached is your invoice…" },
    ] });
  }
  if (path === "/v1.0/me/sendMail" && method === "POST") {
    const b = bodyJson(opts);
    const msg = b.message ?? {};
    recordSandboxEffect({
      provider: "microsoft", connectorId: "microsoft", toolId: "outlook.send", action: "Send", channel: "email",
      recipient: (msg.toRecipients ?? []).map((r) => r.emailAddress?.address).filter(Boolean).join(","),
      subject: msg.subject ?? null, content: msg.body?.content ?? "",
      accountId: ctx.accountId, actorId: ctx.actorId, householdId: ctx.householdId,
    });
    return res(202, null);
  }
  if (path.startsWith("/v1.0/me/events") && method === "GET") {
    return res(200, { value: [
      { subject: "1:1 with manager", start: { dateTime: "2026-07-22T14:00:00" }, location: { displayName: "Room 3" } },
    ] });
  }
  if (path === "/v1.0/me/events" && method === "POST") {
    const b = bodyJson(opts);
    const id = nextId("sbx-msevt");
    recordSandboxEffect({
      provider: "microsoft", connectorId: "microsoft", toolId: "mscal.create", action: "Write", channel: "calendar",
      recipient: "primary", subject: b.subject ?? null, content: JSON.stringify({ start: b.start, end: b.end }),
      accountId: ctx.accountId, actorId: ctx.actorId, householdId: ctx.householdId,
    });
    return res(201, { id });
  }
  if (path.startsWith("/v1.0/me/drive/root/children")) {
    return res(200, { value: [
      { name: "Budget.xlsx", size: 20481, lastModifiedDateTime: "2026-07-18T12:00:00Z" },
    ] });
  }
  return unmocked(host, path);
}

function respondSlack(host, path, method, opts, ctx) {
  if (host !== "slack.com") return unmocked(host, path);
  if (path === "/api/auth.test") return res(200, { ok: true, team: IDENTITY.slack.team, team_id: IDENTITY.slack.externalAccountId, user: "famili-bot", user_id: "U_SBX" });
  if (path.startsWith("/api/conversations.list")) {
    return res(200, { ok: true, channels: [
      { id: "C_SBX_FAMILY", name: "family" }, { id: "C_SBX_LOGISTICS", name: "logistics" },
    ] });
  }
  if (path === "/api/chat.postMessage" && method === "POST") {
    const b = bodyJson(opts);
    recordSandboxEffect({
      provider: "slack", connectorId: "slack", toolId: "slack.postMessage", action: "Send", channel: "slack",
      recipient: b.channel ?? null, content: b.text ?? "",
      accountId: ctx.accountId, actorId: ctx.actorId, householdId: ctx.householdId,
    });
    return res(200, { ok: true, ts: "1750000000.000100", channel: b.channel });
  }
  return res(200, { ok: false, error: `sandbox_unmocked:${path}` });
}

function respondDropbox(host, path, method, opts, ctx) {
  if (host !== "api.dropboxapi.com") return unmocked(host, path);
  if (path === "/2/users/get_current_account") return res(200, { account_id: IDENTITY.dropbox.externalAccountId, email: IDENTITY.dropbox.email, name: { display_name: "Sandbox Family" } });
  if (path === "/2/files/list_folder") {
    return res(200, { entries: [
      { name: "Receipts", ".tag": "folder" }, { name: "2026-taxes.pdf", ".tag": "file" },
    ] });
  }
  if (path === "/2/files/create_folder_v2" && method === "POST") {
    const b = bodyJson(opts);
    recordSandboxEffect({
      provider: "dropbox", connectorId: "dropbox", toolId: "dropbox.createFolder", action: "Write", channel: "dropbox",
      recipient: b.path ?? null, content: b.path ?? "",
      accountId: ctx.accountId, actorId: ctx.actorId, householdId: ctx.householdId,
    });
    return res(200, { metadata: { path_display: b.path } });
  }
  return unmocked(host, path);
}

function respondAlexa(host, path, method, opts, ctx) {
  if (host === "api.amazon.com") {
    if (path === "/user/profile") return res(200, { user_id: IDENTITY["amazon-alexa"].externalAccountId, name: "Sandbox Family", email: IDENTITY["amazon-alexa"].email });
    return unmocked(host, path);
  }
  // The Alexa event-gateway base (HOMEOPS_ALEXA_ENDPOINT, default alexa.sandbox.invalid).
  if (path.endsWith("/v1/devices") && method === "GET") {
    return res(200, { devices: [
      { deviceSerialNumber: "SBX-ECHO-1", accountName: "Kitchen Echo", deviceType: "ECHO" },
    ] });
  }
  if (path.endsWith("/v1/announcements") && method === "POST") {
    const b = bodyJson(opts);
    recordSandboxEffect({
      provider: "amazon-alexa", connectorId: "amazon-alexa", toolId: "alexa.announce", action: "Send", channel: "alexa",
      recipient: b.target ?? "all", content: b.text ?? "",
      accountId: ctx.accountId, actorId: ctx.actorId, householdId: ctx.householdId,
    });
    return res(200, { ok: true });
  }
  return unmocked(host, path);
}

/**
 * Build the mock `api(url, opts)` for a connected account. Same resolve-shape as
 * oauth.mjs rawFetch/api: { ok, status, json, text }. Never opens a socket.
 */
export function sandboxApiFor(account) {
  ensureSandboxEnvDefaults();
  const providerId = account?.provider;
  const ctx = { accountId: account?.id ?? null, actorId: account?.connectedByActorId ?? null, householdId: account?.householdId ?? null };
  const api = async function api(url, opts = {}) {
    let u;
    try { u = new URL(url); } catch { return res(400, { error: { message: "sandbox_bad_url" } }); }
    const host = u.hostname;
    const path = u.pathname;
    const method = String(opts.method || "GET").toUpperCase();
    switch (providerId) {
      case "google": return respondGoogle(host, path, method, opts, ctx);
      case "microsoft": return respondMicrosoft(host, path, method, opts, ctx);
      case "slack": return respondSlack(host, path, method, opts, ctx);
      case "dropbox": return respondDropbox(host, path, method, opts, ctx);
      case "amazon-alexa": return respondAlexa(host, path, method, opts, ctx);
      default: return unmocked(host, path);
    }
  };
  api.__sandbox = true; // lets oauth.mjs callers / tests detect the swap without a socket
  return api;
}

/* ------------------------------------------------------------------ *
 * Connector-path (executeTool) mock — credentialed connectors only.    *
 * Called by connectors.mjs AFTER readiness + approval + kill switch.   *
 * ------------------------------------------------------------------ */
export async function sandboxConnectorExecute(toolId, input = {}, ctx = {}) {
  if (toolId === "sms.send") {
    if (!input.to || !input.body) return { ok: false, error: "invalid_input", message: "Provide `to` and `body` to send a text.", sandbox: true };
    recordSandboxEffect({
      provider: null, connectorId: "sms", toolId: "sms.send", action: "Send", channel: "sms",
      recipient: input.to, content: String(input.body),
      actorId: ctx.actorId, householdId: ctx.householdId,
    });
    // Real bridge shape: { sent, guid, chatGuid, to, action }. `sid` stays as the message id's
    // older name so nothing reading a step result has to change. Annotated sandbox:true.
    const guid = nextId("SBX-SM");
    return { ok: true, result: { sent: true, guid, sid: guid, chatGuid: null, to: input.to, action: "sent", sandbox: true }, sandbox: true };
  }
  return { ok: false, error: "sandbox_unmocked_tool", message: `No sandbox mock for connector tool ${toolId}.`, sandbox: true };
}

/* ------------------------------------------------------------------ *
 * Account seeding — so PROVIDER tools resolve a "connected" account     *
 * instead of parking on not_connected. Idempotent. Boot wiring is a     *
 * handoff (index.mjs owns the listen callback); call it inside the      *
 * target household's tenant context.                                    *
 * ------------------------------------------------------------------ */
export function seedSandboxAccounts({ householdId = "local", actorId } = {}) {
  if (!sandboxEnabled() || !actorId) return { seeded: [] };
  ensureSandboxEnvDefaults();
  return runWithTenant(householdId, () => {
    const seeded = [];
    const at = new Date().toISOString();
    for (const providerId of MOCKED_PROVIDER_IDS) {
      const def = providerById(providerId);
      if (!def) continue;
      const id = `sbx_${providerId}_${actorId}`;
      const ident = sandboxIdentity(providerId);
      if (!getAccountRaw(id)) {
        setAccountTokens(id, { access: `sandbox-${providerId}-access`, refresh: `sandbox-${providerId}-refresh`, expiresAt: null, raw: { sandbox: true } });
        putAccount({
          id, householdId, connectedByActorId: actorId, provider: providerId,
          externalAccountId: ident.externalAccountId, displayName: ident.displayName,
          scopes: def.scopes.map((s) => s.key), status: "connected",
          createdAt: at, updatedAt: at, lastHealthAt: at, lastHealthOk: true, sandbox: true,
        });
      }
      seeded.push(id);
    }
    return { seeded };
  });
}

/* ------------------------------------------------------------------ *
 * Honest coverage map (for the next-wave 22-UC spec authors)           *
 * ------------------------------------------------------------------ */
export const SANDBOX_COVERAGE = {
  mockedProviders: {
    google: { identity: true, tools: ["gmail.search", "gmail.send", "gmail.listLabels", "gmail.modifyLabels", "calendar.list", "calendar.create", "drive.list", "smarthome.listDevices", "smarthome.setThermostat"] },
    microsoft: { identity: true, tools: ["outlook.search", "outlook.send", "mscal.list", "mscal.create", "onedrive.list"] },
    slack: { identity: true, tools: ["slack.listChannels", "slack.postMessage"] },
    dropbox: { identity: true, tools: ["dropbox.list", "dropbox.createFolder"] },
    "amazon-alexa": { identity: true, tools: ["alexa.listDevices", "alexa.announce"] },
  },
  mockedConnectors: { sms: { tools: ["sms.send"] } },
  recordsEffectsFor: ["gmail.send", "gmail.modifyLabels", "calendar.create", "smarthome.setThermostat", "outlook.send", "mscal.create", "slack.postMessage", "dropbox.createFolder", "alexa.announce", "sms.send"],
  notMocked: {
    providers: ["notion", "todoist", "ticktick"],
    connectors: ["weather", "rss", "http", "web", "browser", "webhook", "files-local"],
    note: "Unmocked providers stay not_connected and park honestly; no-credential connectors already run for real.",
  },
};
