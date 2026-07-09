// FamiliOS AI — connector registry, tool/trigger manifests, and REAL executors.
// Readiness is computed from actual configuration. Nothing is simulated:
// configured read connectors perform real network calls; unconfigured connectors
// fail honestly with a typed reason and never fabricate success.
import { getConnectorConfig, setConnectorConfig, getSecret, getSettings, appendAudit, setHealth, getHealth } from "./store.mjs";
import { safeFetch, assertSafeUrl } from "./net.mjs";
import { searchWeb, readPage, extractRecipe } from "./web.mjs";

/**
 * Readiness levels (per the no-mocks mandate):
 * not_installed | not_configured | needs_auth | authorized_readonly |
 * authorized_write | connected | degraded | error | revoked | local_only | runtime_unavailable
 */

export const CONNECTORS = [
  {
    id: "weather",
    name: "Weather",
    provider: "Open-Meteo",
    category: "Information & Feeds",
    authType: "none",
    runtime: "backend",
    risk: "Low",
    description: "Real local weather for your household — drives briefings and weather-sensitive plans. No account required.",
    configSchema: [
      { key: "latitude", label: "Latitude", type: "text", default: "40.7128" },
      { key: "longitude", label: "Longitude", type: "text", default: "-74.0060" },
      { key: "label", label: "Location label", type: "text", default: "Home" },
    ],
    tools: [{ id: "weather.current", name: "Current conditions", action: "Read", risk: "Low", requiresApproval: false, description: "Fetch current temperature and conditions." }],
    triggers: [{ id: "weather.daily", name: "Daily forecast", type: "schedule", description: "Polls each morning for the day's forecast." }],
  },
  {
    id: "rss",
    name: "RSS / Feed",
    provider: "Any RSS feed",
    category: "Information & Feeds",
    authType: "none",
    runtime: "backend",
    risk: "Low",
    description: "Monitor blogs, school district pages, or podcast feeds. Reads a real feed URL you provide.",
    configSchema: [{ key: "feedUrl", label: "Feed URL", type: "text", required: true, placeholder: "https://example.com/feed.xml" }],
    tools: [{ id: "rss.latest", name: "Latest items", action: "Read", risk: "Low", requiresApproval: false, description: "Fetch the most recent feed items." }],
    triggers: [{ id: "rss.new", name: "New item published", type: "poll", description: "Polls the feed and fires on new items." }],
  },
  {
    id: "http",
    name: "Custom HTTP",
    provider: "Custom API",
    category: "Developer",
    authType: "apiKey",
    runtime: "backend",
    risk: "Medium",
    description: "Connect any HTTP API by base URL, with an optional API key header. Real requests run from the backend.",
    configSchema: [
      { key: "baseUrl", label: "Base URL", type: "text", required: true, placeholder: "https://api.example.com" },
      { key: "apiKeyHeader", label: "API key header name", type: "text", placeholder: "Authorization" },
      { key: "apiKey", label: "API key", type: "secret", placeholder: "Bearer …" },
    ],
    tools: [
      { id: "http.get", name: "GET request", action: "Read", risk: "Medium", requiresApproval: false, description: "Perform a GET request to a path on the base URL.", inputs: [{ key: "path", label: "Path", type: "text", placeholder: "/v1/status", default: "/" }] },
      { id: "http.post", name: "POST request", action: "Write", risk: "High", requiresApproval: true, description: "Perform a POST request (requires approval).", inputs: [{ key: "path", label: "Path", type: "text", placeholder: "/v1/items", default: "/" }, { key: "body", label: "JSON body", type: "json", placeholder: "{ \"name\": \"value\" }" }] },
    ],
    triggers: [],
  },
  {
    id: "webhook",
    name: "Webhook Receiver",
    provider: "FamiliOS backend",
    category: "Developer",
    authType: "signature",
    runtime: "backend",
    risk: "Low",
    description: "A real inbound endpoint that receives order/confirmation/form events and routes them to an agent.",
    configSchema: [{ key: "signingSecret", label: "Signing secret (optional)", type: "secret", placeholder: "whsec_…" }],
    tools: [],
    triggers: [{ id: "webhook.received", name: "Webhook received", type: "webhook", description: "Fires on each validated inbound POST." }],
    endpoint: "/api/webhooks/webhook",
  },
  {
    id: "files-local",
    name: "Local Files",
    provider: "This device",
    category: "Documents & Storage",
    authType: "none",
    runtime: "client",
    risk: "Low",
    description: "Import and process files from this device. Local-only — files never leave your browser.",
    configSchema: [],
    tools: [{ id: "file.import", name: "Import file", action: "Read", risk: "Low", requiresApproval: false, runtime: "client", description: "Read a local file in the browser." }],
    triggers: [],
  },
  {
    id: "browser",
    name: "Browser Automation",
    provider: "Playwright runtime",
    category: "Automation",
    authType: "runtime",
    runtime: "browser-automation",
    risk: "Sensitive",
    description: "Drive websites with a real headless browser runtime. Start the bundled runtime (server/browser-runtime: npm install && npm run setup && npm start) and set BROWSER_RUNTIME_URL. Login handoff required — we never ask for your password.",
    configSchema: [{ key: "runtimeUrl", label: "Runtime URL", type: "text", env: "BROWSER_RUNTIME_URL", placeholder: "http://localhost:9223" }],
    tools: [
      { id: "browser.open", name: "Open & extract", action: "Browser Action", risk: "Medium", requiresApproval: false, description: "Open a page and read its content.", inputs: [{ key: "url", label: "Page URL", type: "text", required: true, placeholder: "https://example.com/orders" }, { key: "extract", label: "What to extract (optional)", type: "text", placeholder: "order totals" }] },
      { id: "browser.download", name: "Download document", action: "Download", risk: "High", requiresApproval: true, description: "Open a page and download a file (requires approval).", inputs: [{ key: "url", label: "Page URL", type: "text", required: true }, { key: "selector", label: "Download link selector (optional)", type: "text", placeholder: "a.download-pdf" }] },
    ],
    triggers: [],
  },
  {
    id: "web",
    name: "Web Search & Reading",
    provider: "FamiliOS backend",
    category: "Information & Feeds",
    authType: "none",
    runtime: "backend",
    risk: "Medium",
    description: "Search the web in plain English and read pages — runs on the backend so it works on any deployment (web + mobile) with no local runtime. When the headless Browser Automation runtime is connected it is used automatically for JS-heavy pages.",
    configSchema: [],
    tools: [
      { id: "web.search", name: "Search the web", action: "Read", risk: "Low", requiresApproval: false, description: "Plain-English web search (no API key). Returns result titles, URLs, and snippets to pick pages worth reading.", inputs: [{ key: "query", label: "Search query", type: "text", required: true, placeholder: "easy weeknight dinner recipes" }] },
      { id: "web.read", name: "Read a page", action: "Read", risk: "Medium", requiresApproval: false, description: "Fetch a page and return its readable text and links.", inputs: [{ key: "url", label: "Page URL", type: "text", required: true, placeholder: "https://example.com/article" }] },
      { id: "web.recipe", name: "Extract recipe", action: "Read", risk: "Low", requiresApproval: false, description: "Extract a structured recipe (name, ingredients, step-by-step instructions, source URL) from a recipe page.", inputs: [{ key: "url", label: "Recipe URL", type: "text", required: true, placeholder: "https://example.com/best-chili" }] },
    ],
    triggers: [],
  },
  {
    id: "sms",
    name: "Text Messaging",
    provider: "Twilio",
    category: "Messaging",
    authType: "apiKey",
    runtime: "backend",
    risk: "High",
    description: "Send text-style alerts to household contacts. Requires Twilio credentials.",
    configSchema: [
      { key: "accountSid", label: "Account SID", type: "text", env: "TWILIO_ACCOUNT_SID", required: true },
      { key: "authToken", label: "Auth Token", type: "secret", env: "TWILIO_AUTH_TOKEN", required: true },
      { key: "fromNumber", label: "From number", type: "text", env: "TWILIO_FROM_NUMBER", required: true },
      { key: "messagingServiceSid", label: "Messaging Service SID (A2P 10DLC)", type: "text", env: "TWILIO_MESSAGING_SERVICE_SID", required: false },
    ],
    tools: [{ id: "sms.send", name: "Send text", action: "Send", risk: "High", requiresApproval: true, description: "Send a text message (requires approval).", inputs: [{ key: "to", label: "To number", type: "text", placeholder: "+15551234567", required: true }, { key: "body", label: "Message", type: "textarea", placeholder: "Your text…", required: true }] }],
    triggers: [],
  },
];

export function connectorById(id) {
  return CONNECTORS.find((c) => c.id === id);
}

// Does config (env or stored) satisfy all required fields?
function requiredSatisfied(c) {
  const cfg = getConnectorConfig(c.id);
  for (const f of c.configSchema) {
    if (!f.required) continue;
    const fromEnv = f.env && process.env[f.env];
    const fromStore = f.type === "secret" ? !!cfg.secrets?.[f.key] : !!cfg.fields?.[f.key];
    if (!fromEnv && !fromStore) return false;
  }
  return true;
}

function hasTokens(c) {
  const cfg = getConnectorConfig(c.id);
  return !!cfg.secrets?.accessToken;
}

export function readinessOf(c) {
  const cfg = getConnectorConfig(c.id);
  if (c.runtime === "client") return "local_only";
  if (c.id === "webhook") return "connected"; // receiver is always live
  if (c.authType === "none") {
    // configured by defaults or stored fields
    return requiredSatisfied(c) || c.configSchema.every((f) => !f.required) ? "connected" : "not_configured";
  }
  if (c.runtime === "browser-automation") {
    // Truthful: a runtime URL is NOT proof of an executable runtime. We only report
    // "connected" if a real handshake has succeeded (recorded in health). Otherwise
    // the connector is runtime_unavailable, regardless of any configured URL.
    const url = (c.configSchema[0]?.env && process.env[c.configSchema[0].env]) || cfg.fields?.runtimeUrl;
    if (!url) return "runtime_unavailable";
    try { const u = new URL(url); if (!["ws:", "wss:", "http:", "https:"].includes(u.protocol)) return "error"; } catch { return "error"; }
    const h = getHealth(c.id);
    return h && h.ok ? "connected" : "runtime_unavailable";
  }
  if (c.authType === "oauth2") {
    if (!requiredSatisfied(c)) return "not_configured";
    return hasTokens(c) ? "authorized_write" : "needs_auth";
  }
  if (c.authType === "apiKey") {
    return requiredSatisfied(c) ? "connected" : "not_configured";
  }
  return "not_configured";
}

// Public, redacted connector view for the frontend.
export function publicConnector(c) {
  const cfg = getConnectorConfig(c.id);
  const fields = {};
  for (const f of c.configSchema) {
    if (f.type === "secret") {
      const set = !!cfg.secrets?.[f.key] || (f.env && !!process.env[f.env]);
      fields[f.key] = set ? "••••••••" : "";
    } else {
      fields[f.key] = cfg.fields?.[f.key] ?? (f.env && process.env[f.env] ? "(from environment)" : f.default ?? "");
    }
  }
  // Configured readiness (auth/config state) is reported separately from live
  // provider health, so the UI never claims a connector is "live" while its
  // executable path is actually failing.
  const readiness = readinessOf(c);
  const health = getHealth(c.id);
  const needsNetwork = ["weather", "rss", "http", "gmail", "gcal", "sms"].includes(c.id);
  const executable = ["connected", "authorized_write", "authorized_readonly", "local_only"].includes(readiness);
  let live = executable;
  if (executable && needsNetwork && health && health.ok === false) live = false; // degraded
  return {
    id: c.id, name: c.name, provider: c.provider, category: c.category, authType: c.authType,
    runtime: c.runtime, risk: c.risk, description: c.description,
    configSchema: c.configSchema.map((f) => ({ ...f })),
    config: fields,
    tools: c.tools, triggers: c.triggers, endpoint: c.endpoint ?? null,
    readiness, health: health ? { ok: health.ok, status: health.status, error: health.error ?? null, at: health.at, code: health.code ?? null } : null,
    live, updatedAt: cfg.updatedAt,
  };
}

export function listConnectors() {
  return CONNECTORS.map(publicConnector);
}

/* ----------------------------- Health checks ---------------------------- */
// Performs a real reachability check and PERSISTS the result so the connector
// list can show live health distinct from configured readiness.
export async function healthCheck(id) {
  const c = connectorById(id);
  if (!c) return { ok: false, error: "unknown_connector" };
  const readiness = readinessOf(c);
  const t0 = Date.now();
  const persist = (h) => setHealth(id, h);
  try {
    if (c.id === "weather") {
      const cfg = getConnectorConfig(c.id);
      const lat = cfg.fields?.latitude ?? "40.7128", lon = cfg.fields?.longitude ?? "-74.0060";
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m`).catch(() => null);
      return persist({ ok: !!r && r.ok, status: r && r.ok ? "healthy" : "unreachable", latencyMs: Date.now() - t0, code: r?.status });
    }
    if (c.id === "rss") {
      const cfg = getConnectorConfig(c.id);
      if (!cfg.fields?.feedUrl) return persist({ ok: false, status: "not_configured", error: "feed_url_missing" });
      const r = await safeFetch(cfg.fields.feedUrl, { headers: { "user-agent": "FamiliOS/1.0" } }, { allowLoopback: false });
      return persist({ ok: r.ok && r.httpOk, status: r.ok && r.httpOk ? "healthy" : "unreachable", latencyMs: Date.now() - t0, code: r.status, error: r.ok ? undefined : r.error });
    }
    if (c.id === "http") {
      const cfg = getConnectorConfig(c.id);
      if (!cfg.fields?.baseUrl) return persist({ ok: false, status: "not_configured", error: "base_url_missing" });
      const safe = await assertSafeUrl(cfg.fields.baseUrl, { allowLoopback: false });
      if (!safe.ok) return persist({ ok: false, status: "blocked", error: safe.error });
      const r = await safeFetch(cfg.fields.baseUrl, {}, { allowLoopback: false });
      return persist({ ok: r.ok && r.httpOk, status: r.ok && r.httpOk ? "healthy" : "unreachable", latencyMs: Date.now() - t0, code: r.status, error: r.ok ? undefined : r.error });
    }
    if (c.id === "webhook") return persist({ ok: true, status: "healthy", latencyMs: 0 });
    if (c.runtime === "browser-automation") {
      // A real handshake is required. http(s) runtimes are probed; ws(s) cannot be
      // verified here, so they remain unavailable until a real runtime is wired.
      const cfg = getConnectorConfig(c.id);
      const url = process.env.BROWSER_RUNTIME_URL || cfg.fields?.runtimeUrl;
      if (!url) return persist({ ok: false, status: "runtime_unavailable", error: "no_runtime_url" });
      if (/^wss?:/.test(url)) return persist({ ok: false, status: "runtime_unavailable", error: "no_executable_runtime" });
      const r = await safeFetch(url, {}, { allowLoopback: true });
      return persist({ ok: r.ok && r.httpOk, status: r.ok && r.httpOk ? "healthy" : "runtime_unavailable", latencyMs: Date.now() - t0, error: r.ok ? undefined : r.error });
    }
    const ok = ["connected", "authorized_write", "authorized_readonly", "local_only"].includes(readiness);
    return persist({ ok, status: ok ? "healthy" : readiness, latencyMs: Date.now() - t0 });
  } catch (e) {
    return persist({ ok: false, status: "error", error: String(e?.message ?? e) });
  }
}

/* ----------------------- Google token + provider calls ------------------ */
function googleCreds(id) {
  const cfg = getConnectorConfig(id);
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || cfg.fields?.clientId,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || getSecret(id, "clientSecret"),
    accessToken: getSecret(id, "accessToken"),
    refreshToken: getSecret(id, "refreshToken"),
  };
}

async function refreshGoogle(id) {
  const c = connectorById(id);
  const { clientId, clientSecret, refreshToken } = googleCreds(id);
  if (!refreshToken || !clientId || !clientSecret) return null;
  const r = await fetch(c.oauth.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (j.access_token) {
    setConnectorConfig(id, {}, { accessToken: j.access_token });
    return j.access_token;
  }
  return null;
}

// Authenticated Google API call with one automatic token refresh on 401.
async function googleApi(id, url, opts = {}) {
  let token = googleCreds(id).accessToken;
  const call = (t) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${t}` } });
  let r = await call(token);
  if (r.status === 401) {
    token = await refreshGoogle(id);
    if (!token) return { ok: false, status: 401, json: async () => ({ error: "token_refresh_failed" }) };
    r = await call(token);
  }
  return r;
}

function base64url(str) {
  return Buffer.from(str, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Call the optional Playwright runtime (server/browser-runtime) over loopback.
// The runtime is a separate process; if it isn't running we fail honestly.
async function callBrowserRuntime(pathname, body) {
  const cfg = getConnectorConfig("browser");
  const baseRaw = process.env.BROWSER_RUNTIME_URL || cfg.fields?.runtimeUrl || "";
  const base = baseRaw.replace(/\/$/, "");
  if (!base) return { ok: false, error: "runtime_unavailable", message: "Browser automation runtime is not connected (set BROWSER_RUNTIME_URL)." };
  if (/^wss?:/.test(base)) return { ok: false, error: "runtime_unavailable", message: "Configured runtime is a websocket URL; set BROWSER_RUNTIME_URL to the HTTP runtime (e.g. http://localhost:9223)." };
  const r = await safeFetch(`${base}${pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { allowLoopback: true, timeoutMs: 35000, maxBytes: 4_000_000 });
  if (!r.ok) return { ok: false, error: r.policyBlocked ? "egress_blocked" : "runtime_unavailable", message: `Browser runtime unreachable: ${r.error}` };
  if (!r.httpOk) return { ok: false, error: "runtime_error", message: `Browser runtime returned HTTP ${r.status}` };
  let json = null; try { json = JSON.parse(r.text); } catch { /* ignore */ }
  if (!json || json.ok === false) return { ok: false, error: json?.error ?? "runtime_error", message: json?.message ?? "Browser action failed." };
  return { ok: true, result: json };
}

/* ----------------------------- Tool execution --------------------------- */
export async function executeTool(toolId, input = {}, ctx = {}) {
  const c = CONNECTORS.find((x) => x.tools.some((t) => t.id === toolId));
  const tool = c?.tools.find((t) => t.id === toolId);
  const base = { toolId, connectorId: c?.id, at: new Date().toISOString(), actorId: ctx.actorId ?? null, requestId: ctx.requestId ?? null };
  if (!c || !tool) {
    appendAudit({ type: "tool.execute", ...base, ok: false, error: "unknown_tool" });
    return { ok: false, error: "unknown_tool", message: "No such tool." };
  }
  const readiness = readinessOf(c);
  const configured = ["connected", "authorized_write", "authorized_readonly", "local_only"].includes(readiness);

  // Honest gating
  if (tool.runtime === "client") {
    return { ok: false, error: "client_only", message: "This tool runs locally in the browser, not on the backend." };
  }
  if (!configured) {
    appendAudit({ type: "tool.execute", ...base, ok: false, error: "not_configured", readiness });
    return { ok: false, error: "not_configured", readiness, message: `${c.name} is ${readiness.replace(/_/g, " ")} — configure it before this tool can run.` };
  }
  // Approval is enforced by the route via a consumed server-side approval record.
  // The legacy client `approved` boolean is intentionally NOT consulted here.
  if (tool.requiresApproval && !ctx.approvalConsumed) {
    appendAudit({ type: "tool.execute", ...base, ok: false, error: "approval_required" });
    return { ok: false, error: "approval_required", message: `${tool.name} is a ${tool.risk.toLowerCase()}-risk action and needs your approval.` };
  }
  if ((tool.action === "Send" || tool.action === "Write" || tool.action === "Download") && getSettings().externalActionsEnabled === false) {
    appendAudit({ type: "tool.execute", ...base, ok: false, error: "external_actions_disabled" });
    return { ok: false, error: "external_actions_disabled", message: "External actions are turned off by the household kill switch." };
  }

  try {
    let result;
    if (toolId === "weather.current") {
      const cfg = getConnectorConfig("weather");
      const lat = cfg.fields?.latitude ?? "40.7128", lon = cfg.fields?.longitude ?? "-74.0060";
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m`);
      const j = await r.json();
      result = { location: cfg.fields?.label ?? "Home", temperatureC: j?.current?.temperature_2m, windKph: j?.current?.wind_speed_10m, weatherCode: j?.current?.weather_code, fetchedAt: new Date().toISOString() };
    } else if (toolId === "rss.latest") {
      const cfg = getConnectorConfig("rss");
      const r = await safeFetch(cfg.fields.feedUrl, { headers: { "user-agent": "FamiliOS/1.0" } }, { allowLoopback: false });
      if (!r.ok) { appendAudit({ type: "tool.execute", ...base, ok: false, error: r.error, host: r.host }); return { ok: false, error: r.policyBlocked ? "egress_blocked" : "provider_error", message: `Feed fetch blocked or failed: ${r.error}` }; }
      const xml = r.text;
      const items = [...xml.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gi)].slice(1, 8).map((m) => m[1].trim());
      result = { feedUrl: cfg.fields.feedUrl, items, count: items.length };
    } else if (toolId === "http.get" || toolId === "http.post") {
      const cfg = getConnectorConfig("http");
      const url = cfg.fields.baseUrl.replace(/\/$/, "") + (input.path ?? "/");
      // SSRF guard: validate target host before egress; block private/loopback ranges.
      const safe = await assertSafeUrl(url, { allowLoopback: false });
      if (!safe.ok) {
        appendAudit({ type: "tool.execute", ...base, ok: false, error: "egress_blocked", host: safe.host, ip: safe.ip, policy: safe.error });
        return { ok: false, error: "egress_blocked", message: `Target blocked by egress policy (${safe.error}). Custom HTTP cannot reach private, loopback, or link-local addresses.` };
      }
      const headers = {};
      const key = getSecret("http", "apiKey");
      if (key && cfg.fields.apiKeyHeader) headers[cfg.fields.apiKeyHeader] = key;
      const r = await safeFetch(url, { method: toolId === "http.post" ? "POST" : "GET", headers: { ...headers, ...(toolId === "http.post" ? { "content-type": "application/json" } : {}) }, body: toolId === "http.post" ? JSON.stringify(input.body ?? {}) : undefined }, { allowLoopback: false });
      if (!r.ok) {
        appendAudit({ type: "tool.execute", ...base, ok: false, error: r.policyBlocked ? "egress_blocked" : "provider_error", host: r.host });
        return { ok: false, error: r.policyBlocked ? "egress_blocked" : "provider_error", message: `Request blocked or failed: ${r.error}` };
      }
      appendAudit({ type: "tool.execute", ...base, ok: true, action: tool.action, host: r.host, ipCategory: r.ipCategory, code: r.status });
      return { ok: true, result: { url: r.finalUrl, status: r.status, ok: r.httpOk, bodyPreview: r.text.slice(0, 600) } };
    } else if (toolId === "gmail.search") {
      if (!googleCreds("gmail").accessToken) return { ok: false, error: "not_authorized", message: "Gmail isn't authorized yet — click Authorize to sign in with Google." };
      const q = encodeURIComponent(input.query ?? "newer_than:7d");
      const list = await googleApi("gmail", `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=${q}`);
      const lj = await list.json();
      const ids = (lj.messages ?? []).slice(0, 5);
      const messages = [];
      for (const m of ids) {
        const mr = await googleApi("gmail", `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
        const mj = await mr.json();
        const hdr = (n) => mj.payload?.headers?.find((h) => h.name === n)?.value;
        messages.push({ id: m.id, subject: hdr("Subject"), from: hdr("From"), snippet: mj.snippet });
      }
      result = { query: input.query ?? "newer_than:7d", count: messages.length, messages };
    } else if (toolId === "gmail.send") {
      if (!input.to || !input.subject) return { ok: false, error: "invalid_input", message: "Provide `to` and `subject` to send an email." };
      const raw = base64url(`To: ${input.to}\r\nSubject: ${input.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${input.body ?? ""}`);
      const r = await googleApi("gmail", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ raw }) });
      const j = await r.json();
      if (!r.ok) return { ok: false, error: "provider_error", message: j.error?.message ?? "Gmail send failed" };
      result = { sent: true, id: j.id, to: input.to };
    } else if (toolId === "calendar.list") {
      if (!googleCreds("gcal").accessToken) return { ok: false, error: "not_authorized", message: "Google Calendar isn't authorized yet — click Authorize." };
      const r = await googleApi("gcal", `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=10&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(new Date().toISOString())}`);
      const j = await r.json();
      result = { count: (j.items ?? []).length, events: (j.items ?? []).map((e) => ({ summary: e.summary, start: e.start?.dateTime ?? e.start?.date, location: e.location })) };
    } else if (toolId === "calendar.create") {
      if (!input.summary || !input.start) return { ok: false, error: "invalid_input", message: "Provide `summary` and `start` (ISO datetime)." };
      const end = input.end ?? new Date(new Date(input.start).getTime() + 3600000).toISOString();
      const r = await googleApi("gcal", "https://www.googleapis.com/calendar/v3/calendars/primary/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ summary: input.summary, start: { dateTime: input.start }, end: { dateTime: end }, location: input.location }) });
      const j = await r.json();
      if (!r.ok) return { ok: false, error: "provider_error", message: j.error?.message ?? "Calendar create failed" };
      result = { created: true, id: j.id, htmlLink: j.htmlLink };
    } else if (toolId === "sms.send") {
      const cfg = getConnectorConfig("sms");
      const sid = process.env.TWILIO_ACCOUNT_SID || cfg.fields?.accountSid;
      const token = process.env.TWILIO_AUTH_TOKEN || getSecret("sms", "authToken");
      const from = cfg.fields?.fromNumber || process.env.TWILIO_FROM_NUMBER;
      // US carriers require A2P 10DLC: sending via the Messaging Service (whose
      // sender pool holds the campaign-registered number) instead of a bare From
      // avoids error 30034 once the campaign is approved.
      const msgService = cfg.fields?.messagingServiceSid || process.env.TWILIO_MESSAGING_SERVICE_SID;
      if (!input.to || !input.body) return { ok: false, error: "invalid_input", message: "Provide `to` and `body` to send a text." };
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(msgService ? { MessagingServiceSid: msgService, To: input.to, Body: input.body } : { From: from, To: input.to, Body: input.body }),
      });
      const j = await r.json();
      if (!r.ok) return { ok: false, error: "provider_error", message: j.message ?? "Twilio send failed" };
      result = { sent: true, sid: j.sid, to: input.to };
    } else if (toolId === "web.search") {
      if (!String(input.query ?? "").trim()) return { ok: false, error: "invalid_input", message: "Provide a search `query`." };
      const out = await searchWeb(input.query, { maxResults: Number(input.maxResults) || 8 });
      if (!out.ok) { appendAudit({ type: "tool.execute", ...base, ok: false, error: out.error }); return out; }
      result = { engine: out.engine, query: out.query, results: out.results };
    } else if (toolId === "web.read") {
      if (!input.url) return { ok: false, error: "invalid_input", message: "Provide a page `url`." };
      const out = await readPage(input.url);
      if (!out.ok) { appendAudit({ type: "tool.execute", ...base, ok: false, error: out.error }); return out; }
      // Raw HTML stays server-side; callers get the readable projection.
      result = { title: out.title, url: out.url, text: out.text, links: out.links, rendered: out.rendered };
    } else if (toolId === "web.recipe") {
      if (!input.url) return { ok: false, error: "invalid_input", message: "Provide a recipe `url`." };
      const out = await extractRecipe(input.url);
      if (!out.ok) { appendAudit({ type: "tool.execute", ...base, ok: false, error: out.error }); return out; }
      result = { source: out.source, recipe: out.recipe };
    } else if (toolId === "browser.open" || toolId === "browser.download") {
      if (!input.url) return { ok: false, error: "invalid_input", message: "Provide a page `url`." };
      const out = await callBrowserRuntime(toolId === "browser.open" ? "/open" : "/download", toolId === "browser.open" ? { url: input.url, extract: input.extract } : { url: input.url, selector: input.selector });
      if (!out.ok) { appendAudit({ type: "tool.execute", ...base, ok: false, error: out.error }); return out; }
      result = out.result;
    } else if (toolId.startsWith("browser.")) {
      return { ok: false, error: "not_implemented", message: "Browser tool not implemented." };
    } else {
      return { ok: false, error: "not_implemented", message: "Tool not implemented." };
    }
    appendAudit({ type: "tool.execute", ...base, ok: true, action: tool.action });
    return { ok: true, result };
  } catch (e) {
    appendAudit({ type: "tool.execute", ...base, ok: false, error: String(e?.message ?? e) });
    return { ok: false, error: "provider_error", message: String(e?.message ?? e) };
  }
}

/* ----------------------------- OAuth boundary --------------------------- */
// Builds the provider consent URL with PKCE (S256). State is persisted + bound to
// the session by the caller; the verifier is exchanged at the callback.
export function oauthStart(id, redirectUri, state, codeChallenge) {
  const c = connectorById(id);
  if (!c || c.authType !== "oauth2") return { ok: false, error: "not_oauth" };
  const cfg = getConnectorConfig(id);
  const clientId = (c.configSchema.find((f) => f.key === "clientId")?.env && process.env[c.configSchema.find((f) => f.key === "clientId").env]) || cfg.fields?.clientId;
  if (!clientId) return { ok: false, error: "setup_required", message: "Add an OAuth Client ID before connecting." };
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent", scope: c.oauth.scopes.join(" "), state });
  if (codeChallenge) { params.set("code_challenge", codeChallenge); params.set("code_challenge_method", "S256"); }
  return { ok: true, url: `${c.oauth.authUrl}?${params.toString()}`, tokenUrl: c.oauth.tokenUrl };
}

export function connectorTokenUrl(id) {
  return connectorById(id)?.oauth?.tokenUrl ?? null;
}
