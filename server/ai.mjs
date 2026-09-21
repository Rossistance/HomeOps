// FamiliOS AI — real AI provider adapters. Cloud keys live only in the backend
// vault; local providers (Ollama / LM Studio) are discovered over their documented
// localhost APIs. Health means an actually reachable/configured provider, and chat
// performs a real provider call. Nothing here is simulated.
import { getConnectorConfig, setConnectorConfig, revokeConnector, getSecret, getSettings, setSettings, getHealth, setHealth } from "./store.mjs";
import { safeFetch, safeFetchStream } from "./net.mjs";

export const AI_PROVIDERS = [
  { id: "openai", name: "OpenAI", kind: "cloud", style: "openai", needsKey: true, defaultBaseUrl: "https://api.openai.com/v1", defaultModel: "gpt-5-mini", docs: "Paste an API key from platform.openai.com." },
  { id: "anthropic", name: "Anthropic Claude", kind: "cloud", style: "anthropic", needsKey: true, defaultBaseUrl: "https://api.anthropic.com", defaultModel: "claude-haiku-4-5", docs: "Paste an API key from console.anthropic.com." },
  { id: "gemini", name: "Google Gemini", kind: "cloud", style: "gemini", needsKey: true, defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-2.5-flash", docs: "Paste an API key from aistudio.google.com." },
  { id: "compatible", name: "OpenAI-compatible", kind: "cloud", style: "openai", needsKey: true, needsBaseUrl: true, defaultBaseUrl: "", defaultModel: "", docs: "Any OpenAI-compatible endpoint (OpenRouter, vLLM, …). Set base URL + key." },
  /* Serverless open-weights, as their own rows rather than the single `compatible` slot —
   * a two-tier split needs a cheap classifier AND a dense reasoner configured at the same
   * time, and `compatible` holds exactly one endpoint per household. Both speak the OpenAI
   * Chat Completions shape, so `style: "openai"` reuses the request path below unchanged.
   * (See ai-model.mjs: the SDK path routes them to createOpenAICompatible, NOT the
   * Responses API, which is correct for these two and is now said out loud there.) */
  /* defaultModel is a FALLBACK a household inherits before it ever runs Discover, so a
   * stale one is not a cosmetic problem: llama-3.3-70b-versatile was this default, and
   * Groq has since retired the whole Llama 3.x line — the API answers "The model ... does
   * not exist or you do not have access to it". A household that never opened the model
   * picker got a provider marked healthy (the /models probe succeeds) that failed on
   * every actual call. Verified against the live catalog on 2026-09-21. */
  { id: "groq", name: "Groq", kind: "cloud", style: "openai", needsKey: true, defaultBaseUrl: "https://api.groq.com/openai/v1", defaultModel: "openai/gpt-oss-120b", docs: "Paste an API key from console.groq.com. Fast open-weights inference, billed per token." },
  { id: "together", name: "Together AI", kind: "cloud", style: "openai", needsKey: true, defaultBaseUrl: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo", docs: "Paste an API key from api.together.ai. Open-weights inference, billed per token." },
  // needsKey stays false — a bare local Ollama has no auth and must keep working keyless.
  // keyOptional lets Settings store a bearer for ollama.com's cloud API (Authorization:
  // Bearer, keys at ollama.com/settings/keys) or an auth-protected remote/proxied Ollama;
  // a plain local server ignores the header harmlessly. All three ollama-style request
  // paths attach it when (and only when) a key is stored.
  { id: "ollama", name: "Ollama (local)", kind: "local", style: "ollama", needsKey: false, keyOptional: true, keyHint: "This Ollama endpoint rejected the request as unauthorized. If you're using ollama.com cloud or an auth-protected remote, add an API key in Settings → AI providers (keys: ollama.com/settings/keys), then test again.", local: true, defaultBaseUrl: "http://localhost:11434", defaultModel: "", docs: "Runs locally. Start Ollama, then Discover models." },
  // needsKey stays false — a bare LM Studio server with no auth configured must keep working.
  // keyOptional says the Settings UI should still offer a token field: newer LM Studio
  // builds gate their local server behind a bearer token (401 invalid_api_key otherwise).
  { id: "lmstudio", name: "LM Studio (local)", kind: "local", style: "openai", needsKey: false, keyOptional: true, local: true, defaultBaseUrl: "http://localhost:1234/v1", defaultModel: "", docs: "Open LM Studio's local server, then Discover models." },
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

/** The resolved connection details for a provider — base URL, vault key, chosen model —
 *  for the AI SDK model factory (ai-model.mjs). The key never leaves the backend. */
export function providerConnection(id) {
  const p = aiProviderById(id);
  if (!p) return null;
  return { provider: p, baseUrl: baseUrlOf(p), apiKey: keyOf(p) || "", model: modelOf(p) };
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

export function publicProvider(p, householdId) {
  const cfg = getConnectorConfig(cfgId(p.id));
  const h = getHealth(cfgId(p.id));
  return {
    id: p.id, name: p.name, kind: p.kind, local: !!p.local, needsKey: !!p.needsKey, keyOptional: !!p.keyOptional, needsBaseUrl: !!p.needsBaseUrl,
    docs: p.docs, defaultBaseUrl: p.defaultBaseUrl, defaultModel: p.defaultModel,
    baseUrl: cfg.fields?.baseUrl || p.defaultBaseUrl || "",
    model: cfg.fields?.model || p.defaultModel || "",
    keySet: !!getSecret(cfgId(p.id), "apiKey"),
    readiness: providerReadiness(p),
    // Verified health is distinct from static readiness — the client renders both truthfully.
    health: h ? { ok: !!h.ok, status: h.status ?? (h.ok ? "reachable" : "unreachable"), at: h.at ?? null, latencyMs: h.latencyMs ?? null } : null,
    active: getSettings(householdId).aiActiveProvider === p.id,
    updatedAt: cfg.updatedAt,
  };
}
export function listProviders(householdId) {
  return AI_PROVIDERS.map((p) => publicProvider(p, householdId));
}

export function setProviderConfig(id, body, householdId) {
  const p = aiProviderById(id);
  if (!p) return null;
  const fields = {};
  if (typeof body.baseUrl === "string") fields.baseUrl = body.baseUrl.trim();
  if (typeof body.model === "string") fields.model = body.model.trim();
  // No needsKey/keyOptional gate here by design: a keyOptional local provider (LM
  // Studio) must be able to store a token exactly like a needsKey cloud provider does.
  const secrets = {};
  if (typeof body.apiKey === "string") secrets.apiKey = body.apiKey;
  setConnectorConfig(cfgId(id), fields, secrets);
  return publicProvider(p, householdId);
}
export function revokeProvider(id, householdId) {
  const p = aiProviderById(id);
  if (!p) return null;
  revokeConnector(cfgId(id));
  if (getSettings(householdId).aiActiveProvider === id) setSettings({ aiActiveProvider: null }, householdId);
  return publicProvider(p, householdId);
}
export function setActiveProvider(id, householdId) {
  setSettings({ aiActiveProvider: id }, householdId);
  return id;
}

/* Env bootstrap for hosted deployments: hand keys via environment variables
 * (OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY) instead of pasting into
 * Settings after every fresh deploy. It NEVER overwrites a provider that already has a key
 * in the vault (a person's Settings choice wins), and it only claims the active slot when no
 * provider is active yet. HOMEOPS_AI_MODEL sets the bootstrapped provider's model.
 *
 * PER HOUSEHOLD (2026-07-30). This ran exactly once at boot, with no tenant context — so
 * `currentTenant()` fell back to the resident household and the deployment's own keys
 * configured that one family and nobody else. Every household that signed up afterwards had
 * NO AI provider and no way to get one but pasting a personal API key into Settings, which
 * for a paid product is not a rough edge, it is the product not working. The keys are
 * per-deployment, so every tenant is entitled to them; the caller now runs this once per
 * household at boot AND at signup, so a family created between restarts isn't left out.
 *
 * Still idempotent and still hands-off: a household that has set its own key — or pointed
 * itself at a local Ollama for privacy — keeps that choice untouched, which is what makes it
 * safe to call on every boot. */
export function bootstrapAIFromEnv(householdId) {
  const sources = [
    { id: "openai", env: "OPENAI_API_KEY" },
    { id: "anthropic", env: "ANTHROPIC_API_KEY" },
    { id: "gemini", env: "GEMINI_API_KEY" },
    // Without these two, a deployment-provided open-weights key could only ever arrive by
    // hand through Settings — which is not a thing a family does, and not a thing a
    // multi-tenant deployment can do on their behalf.
    { id: "groq", env: "GROQ_API_KEY" },
    { id: "together", env: "TOGETHER_API_KEY" },
  ];
  const applied = [];
  for (const s of sources) {
    const key = process.env[s.env];
    if (!key || !String(key).trim()) continue;
    if (getSecret(cfgId(s.id), "apiKey")) continue; // already configured — hands off
    const body = { apiKey: String(key).trim() };
    const willBeActive = !getSettings(householdId).aiActiveProvider;
    // HOMEOPS_AI_MODEL names a model for the provider this deployment actually runs on.
    // Stamping it onto every provider would hand Groq an OpenAI model id and call the
    // result "configured" — so it only applies to the one becoming active.
    if (willBeActive && process.env.HOMEOPS_AI_MODEL) body.model = String(process.env.HOMEOPS_AI_MODEL).trim();
    setProviderConfig(s.id, body);
    if (willBeActive) setActiveProvider(s.id, householdId);
    applied.push(s.id);
  }
  /* The triage tier is opt-in, but a deployment that supplied an open-weights key plainly
   * intends it to be used for the cheap tier. Claimed once, only when nothing is set, and
   * only for a provider whose key actually landed — never guessed into existence. */
  const st = getSettings(householdId);
  if (!st.aiTriageProvider) {
    const tier = ["groq", "together"].find((id) => applied.includes(id) || getSecret(cfgId(id), "apiKey"));
    if (tier) setSettings({ aiTriageProvider: tier, aiTriageModel: aiProviderById(tier)?.defaultModel ?? "" }, householdId);
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
      const headers = key ? { authorization: `Bearer ${key}` } : {};
      const r = await getJSON(`${base}/api/tags`, { headers }, p.local);
      if (!r.ok) return { ok: false, error: r.error, message: r.message };
      if (!r.httpOk) return { ok: false, error: "provider_error", status: r.status, message: sanitizeProviderError(r.json) };
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
    // Capture the provider's message (not just the status) — a 401 body is how a local
    // LM Studio server that now requires a token tells us that, and providerHealth needs
    // the text to recognize it and turn it into an actionable hint.
    if (!r.httpOk) return { ok: false, error: "provider_error", status: r.status, message: sanitizeProviderError(r.json) };
    /* TWO SHAPES WEAR THE SAME STYLE. OpenAI answers { data: [...] } and everything that
     * copies its API is expected to do the same — but Together AI answers a BARE ARRAY.
     * Reading only `.data` turned a perfectly good key into "0 models", which in the UI
     * reads as a broken connection rather than as a parse that missed: the request had
     * succeeded, the status was 200, and nothing said so. Both shapes are now accepted,
     * and `name` is taken as an id fallback for compatibles that label it that way. */
    const rows = Array.isArray(r.json) ? r.json : (r.json?.data ?? []);
    return { ok: true, models: rows.map((m) => (typeof m === "string" ? m : m?.id ?? m?.name)).filter(Boolean) };
  } catch (e) {
    return { ok: false, error: "provider_error", message: String(e?.message ?? e) };
  }
}

// A keyOptional local provider (LM Studio) answering 401/invalid_api_key needs a token
// FamiliOS doesn't have on file — name that explicitly instead of a bare "unreachable"
// so Settings can tell someone exactly what to go paste in. Never fires for providers
// that aren't keyOptional (their needsKey gate already gives them a clear affordance).
function authKeyHint(p, result) {
  if (!p?.keyOptional) return null;
  const msg = String(result?.message ?? "");
  const looksLikeAuthFailure = result?.status === 401 || /invalid[_ -]?api[_ -]?key|unauthorized|api key/i.test(msg);
  if (!looksLikeAuthFailure) return null;
  // A provider can carry its own wording (Ollama's token comes from ollama.com, not a
  // local Developer menu) — the generated default fits the LM-Studio-style local case.
  if (p.keyHint) return p.keyHint;
  const label = p.name.replace(/\s*\(local\)\s*$/i, "");
  return `Newer ${label} builds require an API token (${label} → Developer → API token). Add it in Settings → AI providers, then test again.`;
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
    const hint = authKeyHint(p, m);
    setHealth(cfgId(id), { ok: false, status, latencyMs: Date.now() - t0 });
    return { ok: false, status, message: m.message, ...(hint ? { hint } : {}), latencyMs: Date.now() - t0 };
  }
  setHealth(cfgId(id), { ok: true, status: "reachable", latencyMs: Date.now() - t0 });
  return { ok: true, status: "reachable", models: m.models, modelCount: m.models.length, latencyMs: Date.now() - t0 };
}

// ---- Chat (real provider call) ----
/** providerChat with resilience: one retry on transient failure (429/5xx/
 * timeout/network), then fall through to the next CONFIGURED provider so a
 * single vendor blip never takes the assistant down. Successful fallbacks are
 * labeled degraded:true + fellBackFrom so clients can show a quiet banner. */
export async function providerChatWithFallback(primaryId, opts) {
  const transient = (r) => !r.ok && (r.error === "provider_error" || r.error === "timeout" || r.error === "network" || (r.status && (r.status === 429 || r.status >= 500)));
  let out = await providerChat(primaryId, opts);
  if (transient(out)) {
    await new Promise((r) => setTimeout(r, 800));
    out = await providerChat(primaryId, opts);
  }
  if (out.ok || !transient(out)) return out;
  for (const p of AI_PROVIDERS) {
    if (p.id === primaryId) continue;
    const readiness = providerReadiness(p);
    if (!["healthy", "configured", "needs_health_check"].includes(readiness)) continue;
    const alt = await providerChat(p.id, { messages: opts?.messages });
    if (alt.ok) return { ...alt, degraded: true, fellBackFrom: primaryId };
  }
  return out; // honest original failure — nothing else could answer
}

/* ---- Vision: a message may carry IMAGES, not just text -----------------------------------
 *
 * Recorded verbatim, the assistant answering its own bug: "attachments are generally meant for
 * any file, document, or photo the chat UI passes through to me. In this conversation, though,
 * I'm NOT RECEIVING READABLE ATTACHMENT CONTENTS, so I can't inspect the specific image you
 * sent here."
 *
 * It was telling the truth. A message's `content` was a plain string everywhere in this file,
 * so an attached photo could never be part of the turn no matter what the upload did.
 *
 * A message content may now be either a string (unchanged, every existing caller) or
 * `{ text, images: [{ mime, base64 }] }`. Each provider needs its own shape for that, so the
 * conversion lives here rather than at the call sites — a caller should be able to attach a
 * photo without knowing which model the household happens to be using.
 */
function hasImages(m) {
  return m && typeof m.content === "object" && Array.isArray(m.content.images) && m.content.images.length > 0;
}
/** Any message anywhere in this conversation carrying an image. */
export function messagesHaveImages(messages) {
  return (messages ?? []).some(hasImages);
}
const contentText = (c) => (typeof c === "string" ? c : String(c?.text ?? ""));

function toOpenAIContent(c) {
  if (typeof c === "string") return c;
  const parts = [];
  if (c.text) parts.push({ type: "text", text: String(c.text) });
  for (const img of c.images ?? []) {
    parts.push({ type: "image_url", image_url: { url: `data:${img.mime || "image/jpeg"};base64,${img.base64}` } });
  }
  return parts.length ? parts : String(c.text ?? "");
}
function toAnthropicContent(c) {
  if (typeof c === "string") return c;
  const parts = [];
  // Images first: Anthropic's own guidance is that the image should precede the question
  // about it, and it measurably answers better that way.
  for (const img of c.images ?? []) {
    parts.push({ type: "image", source: { type: "base64", media_type: img.mime || "image/jpeg", data: img.base64 } });
  }
  if (c.text) parts.push({ type: "text", text: String(c.text) });
  return parts.length ? parts : String(c.text ?? "");
}
function toGeminiParts(c) {
  if (typeof c === "string") return [{ text: c }];
  const parts = [];
  if (c.text) parts.push({ text: String(c.text) });
  for (const img of c.images ?? []) {
    parts.push({ inline_data: { mime_type: img.mime || "image/jpeg", data: img.base64 } });
  }
  return parts.length ? parts : [{ text: String(c.text ?? "") }];
}
/** Ollama takes base64 images on a separate `images` array beside the text. */
function toOllamaMessage(m) {
  if (!hasImages(m)) return { ...m, content: contentText(m.content) };
  return { role: m.role, content: contentText(m.content), images: (m.content.images ?? []).map((i) => i.base64) };
}

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
      const system = contentText(messages.find((m) => m.role === "system")?.content);
      const conv = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: toAnthropicContent(m.content) }));
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
      const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: toGeminiParts(m.content) }));
      const sys = contentText(messages.find((m) => m.role === "system")?.content);
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
        method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: useModel, messages: messages.map(toOllamaMessage), stream: false }),
      }, p.local, CHAT_TIMEOUT_MS);
      if (!r.ok) return { ok: false, error: r.error, message: r.message };
      if (!r.httpOk) return { ok: false, error: "provider_error", message: sanitizeProviderError(r.json), status: r.status };
      return { ok: true, model: useModel, text: (r.json?.message?.content ?? "").trim() };
    }
    // openai style
    const headers = { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };
    const oaMessages = messages.map((m) => ({ ...m, content: toOpenAIContent(m.content) }));
    const r = await getJSON(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model: useModel, messages: oaMessages }) }, p.local, CHAT_TIMEOUT_MS);
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    if (!r.httpOk) return { ok: false, error: "provider_error", message: sanitizeProviderError(r.json), status: r.status };
    return { ok: true, model: useModel, text: (r.json?.choices?.[0]?.message?.content ?? "").trim() };
  } catch (e) {
    return { ok: false, error: "provider_error", message: String(e?.message ?? e) };
  }
}

/* ---- JSON-shaped provider calls -------------------------------------------------------
 *
 * Three separate tolerant extractors had grown up in this codebase — engine.mjs
 * (extractJSONLoose), context.mjs (extractJSON) and message-suggestions.mjs — at three
 * different robustness tiers. The weakest was the one doing the most model-facing work:
 * message-suggestions took the first `{` to the last `}` with NO code-fence handling, on a
 * prompt whose own first line says "no code fences". A fenced reply from a chattier model
 * parsed as null and the feature went quietly dead. This is the one extractor, at the
 * strongest tier: fences, surrounding prose, and the raw-newline-inside-a-string repair.
 *
 * Returns { ok:true, json, model } or { ok:false, error, ... }. `bad_json` is a real,
 * nameable failure — a caller must be able to tell "the model said nothing usable" apart
 * from "the model said no", because those mean opposite things to a silent classifier. */
export function parseLooseJSON(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return null;
  const slice = t.slice(first, last + 1);
  try { return JSON.parse(slice); } catch { /* fall through to the repair attempt */ }
  // A raw newline (or tab) inside a string literal is the common malformation; escape the
  // ones that sit inside quotes and leave structural whitespace alone.
  let out = ""; let inStr = false; let esc = false;
  for (const ch of slice) {
    if (esc) { out += ch; esc = false; continue; }
    if (ch === "\\") { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && (ch === "\n" || ch === "\r" || ch === "\t")) { out += ch === "\t" ? "\\t" : "\\n"; continue; }
    out += ch;
  }
  try { return JSON.parse(out); } catch { return null; }
}

/** providerChat, plus the parse. Same failure shapes, with `bad_json` added. */
export async function providerChatJSON(id, { messages = [], model } = {}) {
  const out = await providerChat(id, { messages, model });
  if (!out.ok) return out;
  const json = parseLooseJSON(out.text);
  if (json === null) return { ok: false, error: "bad_json", message: "The model's reply wasn't usable JSON.", model: out.model, raw: String(out.text ?? "").slice(0, 400) };
  return { ok: true, json, model: out.model };
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
      const system = contentText(messages.find((m) => m.role === "system")?.content);
      const conv = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: toAnthropicContent(m.content) }));
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
        { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model: useModel, messages, stream: true }) },
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
