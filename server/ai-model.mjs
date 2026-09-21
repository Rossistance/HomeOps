// FamiliOS AI — AI SDK model factory.
//
// The Ask Famili agent (assistant-agent.mjs) runs on the Vercel AI SDK's ToolLoopAgent,
// which needs a LanguageModel object. This module turns the household's configured
// provider (server/ai.mjs — the same registry Settings → AI Providers edits, with the key
// in the vault) into one, for every provider style the app supports:
//
//   openai      → @ai-sdk/openai (Responses API — the only one that takes function tools on current models)
//   anthropic   → @ai-sdk/anthropic
//   gemini      → @ai-sdk/google
//   compatible  → @ai-sdk/openai-compatible (Together, Groq, OpenRouter, vLLM, …)
//   lmstudio    → @ai-sdk/openai-compatible (LM Studio speaks the OpenAI chat API)
//   ollama      → @ai-sdk/openai-compatible against Ollama's /v1 OpenAI-compatible API
//
// Every provider is handed a guarded fetch: the URL is validated by net.mjs's egress
// policy before the request leaves the box (loopback only for local providers), so the
// SSRF guarantee ai.mjs already made still holds on the new path.
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AI_PROVIDERS, providerConnection, providerReadiness, providerModels } from "./ai.mjs";
import { assertSafeUrl } from "./net.mjs";

function guardedFetch(local) {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input?.url ?? input);
    const check = await assertSafeUrl(url, { allowLoopback: !!local });
    if (!check.ok) throw new Error(`egress_blocked:${check.error}`);
    return fetch(input, init);
  };
}

const trimSlash = (u) => String(u ?? "").replace(/\/+$/, "");

/**
 * Build an AI SDK LanguageModel for a configured provider.
 * @returns {Promise<{ok:true, model, providerId, modelId, providerName, local:boolean} | {ok:false, error, message?}>}
 */
export async function languageModelFor(providerId, { model } = {}) {
  const c = providerConnection(providerId);
  if (!c) return { ok: false, error: "unknown_provider", message: "Unknown AI provider." };
  const p = c.provider;
  if (providerReadiness(p) === "not_configured") return { ok: false, error: "not_configured", message: `${p.name} is not configured.` };
  let modelId = model || c.model;
  if (!modelId) {
    // Same auto-pick ai.mjs does: the first discovered model.
    const md = await providerModels(providerId);
    if (md.ok && md.models?.[0]) modelId = md.models[0];
  }
  if (!modelId) return { ok: false, error: "no_model", message: `No model is selected for ${p.name}. Pick one in Settings → AI Providers.` };
  const fetchFn = guardedFetch(p.local);
  const base = trimSlash(c.baseUrl);
  let lm;
  try {
    if (p.style === "anthropic") {
      // ai.mjs stores "https://api.anthropic.com"; the SDK's base includes the /v1.
      lm = createAnthropic({ apiKey: c.apiKey, baseURL: /\/v1$/.test(base) ? base : `${base}/v1`, fetch: fetchFn })(modelId);
    } else if (p.style === "gemini") {
      lm = createGoogleGenerativeAI({ apiKey: c.apiKey, baseURL: base, fetch: fetchFn })(modelId);
    } else if (p.style === "ollama") {
      // Ollama's OpenAI-compatible surface (tool calling included) lives under /v1.
      lm = createOpenAICompatible({ name: "ollama", baseURL: /\/v1$/.test(base) ? base : `${base}/v1`, apiKey: c.apiKey || undefined, fetch: fetchFn })(modelId);
    } else if (p.id === "openai") {
      /* RESPONSES, not Chat Completions. Found on a real phone against the production
       * household: every Ask turn came back with "Function tools with reasoning_effort are
       * not supported for gpt-5.6-sol in /v1/chat/completions". OpenAI's current models only
       * accept function tools on the Responses API, which is also the SDK's own default for
       * this provider. `.chat()` remains the right call only for a third-party endpoint that
       * speaks the legacy shape — and those are configured as "compatible", not "openai". */
      lm = createOpenAI({ apiKey: c.apiKey, baseURL: base, fetch: fetchFn }).responses(modelId);
    } else {
      /* "compatible", "lmstudio", "groq", "together" — any OpenAI-shaped CHAT COMPLETIONS
       * endpoint. Groq and Together land here by design, not by falling off the end of the
       * branch list: they carry style "openai" so ai.mjs builds an OpenAI-shaped body for
       * them, but they do NOT implement the Responses API, so routing them through the
       * `p.id === "openai"` branch above would send `.responses()` calls to a server that
       * only speaks /chat/completions. The branch above is keyed on the provider ID rather
       * than the style precisely so these two can share the style without sharing the API. */
      lm = createOpenAICompatible({ name: p.id, baseURL: base, apiKey: c.apiKey || undefined, fetch: fetchFn })(modelId);
    }
  } catch (e) {
    return { ok: false, error: "model_init_failed", message: String(e?.message ?? e) };
  }
  return { ok: true, model: lm, providerId, modelId, providerName: p.name, local: !!p.local };
}

/** Other providers that could plausibly answer if the primary one fails mid-turn. */
export function fallbackProviderIds(primaryId) {
  return AI_PROVIDERS
    .filter((p) => p.id !== primaryId && ["healthy", "configured", "needs_health_check"].includes(providerReadiness(p)))
    .map((p) => p.id);
}
