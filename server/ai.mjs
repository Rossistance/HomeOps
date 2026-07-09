// FamiliOS AI — real AI provider adapters. Cloud keys live only in the backend
// vault; local providers (Ollama / LM Studio) are discovered over their documented
// localhost APIs. Health means an actually reachable/configured provider, and chat
// performs a real provider call. Nothing here is simulated.
import { getConnectorConfig, setConnectorConfig, revokeConnector, getSecret, getSettings, setSettings, getHealth, setHealth } from "./store.mjs";
import { safeFetch, safeFetchStream } from "./net.mjs";

export const AI_PROVIDERS = [
  { id: "openai", name: "OpenAI", kind: "cloud", style: "openai", needsKey: true, defaultBaseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", docs: "Paste an API key from platform.openai.com." },
  { id: "anthropic", name: "Anthropic Claude", kind: "cloud", style: "anthropic", needsKey: true, defaultBaseUrl: "https://api.anthropic.com", defaultModel: "claude-3-5-haiku-latest", docs: "Paste an API key from console.anthropic.com." },
  { id: "gemini", name: "Google Gemini", kind: "cloud", style: "gemini", needsKey: true, defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-1.5-flash", docs: "Paste an API key from aistudio.google.com." },
  { id: "compatible", name: "OpenAI-compatible", kind: "cloud", style: "openai", needsKey: true, needsBaseUrl: true, defaultBaseUrl: "", defaultModel: "", docs: "Any OpenAI-compatible endpoint (Together, Groq, OpenRouter, vLLM, …). Set base URL + key." },
  { id: "ollama", name: "Ollama (local)", kind: "local", style: "ollama", needsKey: false, local: true, defaultBaseUrl: "http://localhost:11434", defaultModel: "", docs: "Runs locally. Start Ollama, then Discover models." },
  { id: "lmstudio", name: "LM Studio (local)", kind: "local", style: "openai", needsKey: false, local: true, defaultBaseUrl: "http://localhost:1234/v1", defaultModel: "", docs: "Open LM Studio's local server, then Discover models." },
];

export function aiProviderById(id) {
  return AI_PROVIDERS.find((p) => p.id === id);
}
const cfgId = (id) => `ai.${id}`;

function baseUrlOf(p) {
  const cfg = getConnectorConfig(cfgId(p.id));
  return (cfg.fields?.baseUrl || p.defaultBaseUrl || "").replace(/\/$/, "");
}
function modelOf(p) {
  const cfg = getConnectorConfig(cfgId(p.id));
  return cfg.fields?.model || p.defaultModel || "";
}
function keyOf(p) {
  return getSecret(cfgId(p.id), "apiKey");
}

// Truthful readiness vocabulary (P1.3). A default localhost URL is NOT proof a local
// runtime is up, and an API key is not proof a cloud endpoint is reachable — so we
// distinguish static configuration from verified health:
//   not_configured    → missing a required key/base URL
//   needs_health_check → configured-enough to probe, but never verified reachable
//   healthy            → last probe reached the provider (models discovered)
//   unreachable        → last probe failed (runtime down / bad key / DNS)
export function providerReadiness(p) {
  const cfg = getConnectorConfig(cfgId(p.id));
  const hasKey = !!getSecret(cfgId(p.id), "apiKey");
  const hasExplicitBase = !!cfg.fields?.baseUrl;
  if (p.needsKey && !hasKey) return "not_configured";
  if (p.needsBaseUrl && !hasExplicitBase) return "not_configured";
  // Local providers only carry a DEFAULT base URL until configured — that's not "configured".
  if (p.local && !hasExplicitBase && !hasKey) {
    const h = getHealth(cfgId(p.id));
    if (h?.ok) return "healthy";
    if (h && !h.ok) return "unreachable";
    return "needs_health_check";
  }
  const h = getHealth(cfgId(p.id));
  if (h?.ok) return "healthy";
  if (h && !h.ok) return "unreachable";
  return "configured";
}

export function publicProvider(p) {
  const cfg = getConnectorConfig(cfgId(p.id));
  const h = getHealth(cfgId(p.id));
  return {
    id: p.id, name: p.name, kind: p.kind, local: !!p.local, needsKey: !!p.needsKey, needsBaseUrl: !!p.needsBaseUrl,
    docs: p.docs, defaultBaseUrl: p.defaultBaseUrl, defaultModel: p.defaultModel,
    baseUrl: cfg.fields?.baseUrl || p.defaultBaseUrl || "",
    model: cfg.fields?.model || p.defaultModel || "",
    keySet: !!getSecret(cfgId(p.id), "apiKey"),
    readiness: providerReadiness(p),
    // Verified health is distinct from static readiness — the client renders both truthfully.
    health: h ? { ok: !!h.ok, status: h.status ?? (h.ok ? "reachable" : "unreachable"), at: h.at ?? null, latencyMs: h.latencyMs ?? null } : null,
    active: getSettings().aiActiveProvider === p.id,
    updatedAt: cfg.updatedAt,
  };
}
export function listProviders() {
  return AI_PROVIDERS.map(publicProvider);
}

export function setProviderConfig(id, body) {
  const p = aiProviderById(id);
  if (!p) return null;
  const fields = {};
  if (typeof body.baseUrl === "string") fields.baseUrl = body.baseUrl.trim();
  if (typeof body.model === "string") fields.model = body.model.trim();
  const secrets = {};
  if (typeof body.apiKey === "string") secrets.apiKey = body.apiKey;
  setConnectorConfig(cfgId(id), fields, secrets);
  return publicProvider(p);
}
export function revokeProvider(id) {
  const p = aiProviderById(id);
  if (!p) return null;
  revokeConnector(cfgId(id));
  if (getSettings().aiActiveProvider === id) setSettings({ aiActiveProvider: null });
  return publicProvider(p);
}
export function setActiveProvider(id) {
  setSettings({ aiActiveProvider: id });
  return id;
}

/* Env bootstrap for hosted deployments: hand keys via environment variables
 * (OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY) instead of pasting into
 * Settings after every fresh deploy. Runs once at startup. It NEVER overwrites a
 * provider that already has a key in the vault (a person's Settings choice wins),
 * and it only claims the active slot when no provider is active yet.
 * HOMEOPS_AI_MODEL sets the bootstrapped provider's model (e.g. "gpt-5.5"). */
export function bootstrapAIFromEnv() {
  const sources = [
    { id: "openai", env: "OPENAI_API_KEY" },
    { id: "anthropic", env: "ANTHROPIC_API_KEY" },
    { id: "gemini", env: "GEMINI_API_KEY" },
  ];
  const applied = [];
  for (const s of sources) {
    const key = process.env[s.env];
    if (!key || !String(key).trim()) continue;
    if (getSecret(cfgId(s.id), "apiKey")) continue; // already configured — hands off
    const body = { apiKey: String(key).trim() };
    if (process.env.HOMEOPS_AI_MODEL) body.model = String(process.env.HOMEOPS_AI_MODEL).trim();
    setProviderConfig(s.id, body);
    if (!getSettings().aiActiveProvider) setActiveProvider(s.id);
    applied.push(s.id);
  }
  return applied;
}

// Default 12s suits quick probes (health, model discovery). Chat completions pass a
// much longer budget — capable/reasoning models routinely take >12s on a real
// planning prompt, and aborting them surfaced as a bogus "fetch failed".
async function getJSON(url, opts, local, timeoutMs = 12000) {
  const r = await safeFetch(url, opts, { allowLoopback: !!local, timeoutMs, maxBytes: 2_000_000 });
  if (!r.ok) return { ok: false, error: r.error, message: r.message };
  let json = null;
  try { json = JSON.parse(r.text); } catch { json = null; }
  return { ok: true, status: r.status, httpOk: r.httpOk, json, raw: r.text };
}
const CHAT_TIMEOUT_MS = 120_000;

// ---- Model discovery ----
export async function providerModels(id) {
  const p = aiProviderById(id);
  if (!p) return { ok: false, error: "unknown_provider" };
  const base = baseUrlOf(p);
  if (!base) return { ok: false, error: "not_configured" };
  const key = keyOf(p);
  try {
    if (p.style === "ollama") {
      const r = await getJSON(`${base}/api/tags`, {}, p.local);
      if (!r.ok) return { ok: false, error: r.error, message: r.message };
      if (!r.httpOk) return { ok: false, error: "provider_error", status: r.status };
      return { ok: true, models: (r.json?.models ?? []).map((m) => m.name) };
    }
    if (p.style === "gemini") {
      if (!key) return { ok: false, error: "not_configured" };
      const r = await getJSON(`${base}/models?key=${encodeURIComponent(key)}`, {}, p.local);
      if (!r.ok) return { ok: false, error: r.error };
      if (!r.httpOk) return { ok: false, error: "provider_error", status: r.status };
      return { ok: true, models: (r.json?.models ?? []).map((m) => (m.name || "").replace("models/", "")).filter(Boolean) };
    }
    if (p.style === "anthropic") {
      if (!key) return { ok: false, error: "not_configured" };
      const r = await getJSON(`${base}/v1/models`, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }, p.local);
      if (!r.ok) return { ok: false, error: r.error };
      if (!r.httpOk) return { ok: false, error: "provider_error", status: r.status };
      return { ok: true, models: (r.json?.data ?? []).map((m) => m.id) };
    }
    // openai style (openai, compatible, lmstudio)
    const headers = key ? { authorization: `Bearer ${key}` } : {};
    const r = await getJSON(`${base}/models`, { headers }, p.local);
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    if (!r.httpOk) return { ok: false, error: "provider_error", status: r.status };
    return { ok: true, models: (r.json?.data ?? []).map((m) => m.id) };
  } catch (e) {
    return { ok: false, error: "provider_error", message: String(e?.message ?? e) };
  }
}

export async function providerHealth(id) {
  const p = aiProviderById(id);
  if (!p) return { ok: false, error: "unknown_provider" };
  if (providerReadiness(p) === "not_configured") return { ok: false, status: "not_configured" };
  const t0 = Date.now();
  const m = await providerModels(id);
  // Persist the probe result so readiness reflects verified reachability (not just a
  // default URL). This is what turns a local provider from needs_health_check → healthy.
  if (!m.ok) {
    const status = m.error === "fetch_failed" || m.error === "dns_failure" ? "unreachable" : m.error;
    setHealth(cfgId(id), { ok: false, status, latencyMs: Date.now() - t0 });
    return { ok: false, status, message: m.message, latencyMs: Date.now() - t0 };
  }
  setHealth(cfgId(id), { ok: true, status: "reachable", latencyMs: Date.now() - t0 });
  return { ok: true, status: "reachable", models: m.models, modelCount: m.models.length, latencyMs: Date.now() - t0 };
}

// ---- Chat (real provider call) ----
export async function providerChat(id, { messages = [], model } = {}) {
  const p = aiProviderById(id);
  if (!p) return { ok: false, error: "unknown_provider" };
  if (providerReadiness(p) === "not_configured") return { ok: false, error: "not_configured", message: `${p.name} is not configured.` };
  const base = baseUrlOf(p);
  const key = keyOf(p);
  const useModel = model || modelOf(p);
  if (!useModel && p.style !== "ollama") {
    // Try to auto-pick the first discovered model.
    const md = await providerModels(id);
    if (md.ok && md.models[0]) return providerChat(id, { messages, model: md.models[0] });
  }
  try {
    if (p.style === "anthropic") {
      const system = messages.find((m) => m.role === "system")?.content;
      const conv = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
      const r = await getJSON(`${base}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: useModel, max_tokens: 2048, ...(system ? { system } : {}), messages: conv }),
      }, p.local, CHAT_TIMEOUT_MS);
      if (!r.ok) return { ok: false, error: r.error, message: r.message };
      if (!r.httpOk) return { ok: false, error: "provider_error", message: sanitizeProviderError(r.json), status: r.status };
      return { ok: true, model: useModel, text: (r.json?.content ?? []).map((c) => c.text).join("").trim() };
    }
    if (p.style === "gemini") {
      const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
      const sys = messages.find((m) => m.role === "system")?.content;
      const r = await getJSON(`${base}/models/${encodeURIComponent(useModel)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents, ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}) }),
      }, p.local, CHAT_TIMEOUT_MS);
      if (!r.ok) return { ok: false, error: r.error, message: r.message };
      if (!r.httpOk) return { ok: false, error: "provider_error", message: sanitizeProviderError(r.json), status: r.status };
      const text = (r.json?.candidates?.[0]?.content?.parts ?? []).map((x) => x.text).join("").trim();
      return { ok: true, model: useModel, text };
    }
    if (p.style === "ollama") {
      const r = await getJSON(`${base}/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: useModel, messages, stream: false }),
      }, p.local, CHAT_TIMEOUT_MS);
      if (!r.ok) return { ok: false, error: r.error, message: r.message };
      if (!r.httpOk) return { ok: false, error: "provider_error", message: sanitizeProviderError(r.json), status: r.status };
      return { ok: true, model: useModel, text: (r.json?.message?.content ?? "").trim() };
    }
    // openai style
    const headers = { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };
    const r = await getJSON(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model: useModel, messages }) }, p.local, CHAT_TIMEOUT_MS);
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    if (!r.httpOk) return { ok: false, error: "provider_error", message: sanitizeProviderError(r.json), status: r.status };
    return { ok: true, model: useModel, text: (r.json?.choices?.[0]?.message?.content ?? "").trim() };
  } catch (e) {
    return { ok: false, error: "provider_error", message: String(e?.message ?? e) };
  }
}

// Never surface raw provider payloads/secrets; return a short, safe message.
function sanitizeProviderError(json) {
  const msg = json?.error?.message || json?.error || json?.message;
  if (typeof msg === "string") return msg.slice(0, 200);
  return "Provider returned an error.";
}

/**
 * Streaming chat — calls onToken(string) for each received text chunk, then
 * returns the same {ok, model, text} shape as providerChat once complete.
 * Gemini falls back to non-streaming (their API has a different streaming protocol).
 */
export async function providerChatStream(id, { messages = [], model } = {}, onToken) {
  const p = aiProviderById(id);
  if (!p) return { ok: false, error: "unknown_provider" };
  if (providerReadiness(p) === "not_configured") return { ok: false, error: "not_configured", message: `${p.name} is not configured.` };
  const base = baseUrlOf(p);
  const key = keyOf(p);
  const useModel = model || modelOf(p);
  if (!useModel && p.style !== "ollama") {
    const md = await providerModels(id);
    if (md.ok && md.models[0]) return providerChatStream(id, { messages, model: md.models[0] }, onToken);
  }
  if (p.style === "gemini") return providerChat(id, { messages, model });
  let fullText = "";
  try {
    if (p.style === "anthropic") {
      const system = messages.find((m) => m.role === "system")?.content;
      const conv = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
      let buf = "";
      const r = await safeFetchStream(
        `${base}/v1/messages`,
        { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: useModel, max_tokens: 2048, stream: true, ...(system ? { system } : {}), messages: conv }) },
        { allowLoopback: !!p.local, timeoutMs: 90_000 },
        (chunk) => {
          buf += chunk;
          const lines = buf.split("\n"); buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const ev = JSON.parse(data);
              if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
                fullText += ev.delta.text; onToken?.(ev.delta.text);
              }
            } catch {}
          }
        }
      );
      if (!r.ok) return { ok: false, error: r.error, message: r.message };
      if (!r.httpOk) { let j = null; try { j = JSON.parse(r.text ?? ""); } catch {} return { ok: false, error: "provider_error", message: sanitizeProviderError(j), status: r.status }; }
      return { ok: true, model: useModel, text: fullText.trim() };
    }
    if (p.style === "ollama") {
      let buf = "";
      const r = await safeFetchStream(
        `${base}/api/chat`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: useModel, messages, stream: true }) },
        { allowLoopback: true, timeoutMs: 90_000 },
        (chunk) => {
          buf += chunk;
          const lines = buf.split("\n"); buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try { const ev = JSON.parse(line); if (ev.message?.content) { fullText += ev.message.content; onToken?.(ev.message.content); } } catch {}
          }
        }
      );
      if (!r.ok) return { ok: false, error: r.error, message: r.message };
      return { ok: true, model: useModel, text: fullText.trim() };
    }
    // openai style
    const headers = { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };
    let buf = "";
    const r = await safeFetchStream(
      `${base}/chat/completions`,
      { method: "POST", headers, body: JSON.stringify({ model: useModel, messages, stream: true }) },
      { allowLoopback: !!p.local, timeoutMs: 90_000 },
      (chunk) => {
        buf += chunk;
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          try { const ev = JSON.parse(data); const tok = ev.choices?.[0]?.delta?.content; if (tok) { fullText += tok; onToken?.(tok); } } catch {}
        }
      }
    );
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    if (!r.httpOk) return { ok: false, error: "provider_error", status: r.status };
    return { ok: true, model: useModel, text: fullText.trim() };
  } catch (e) {
    return { ok: false, error: "provider_error", message: String(e?.message ?? e) };
  }
}
