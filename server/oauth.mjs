// HomeOps connector platform — generalized OAuth engine.
// Builds consent URLs (PKCE where supported), exchanges codes, refreshes tokens,
// and produces a per-account `api()` that calls real providers with auto-refresh.
// Client secrets are used only here (server-side) and never returned to clients.
import { clientCreds, providerById } from "./providers.mjs";
import { getAccountTokens, setAccountTokens, getAccountRaw, putAccount } from "./store.mjs";

async function rawFetch(url, opts = {}) {
  let res;
  try { res = await fetch(url, opts); } catch (e) { return { ok: false, status: 0, json: null, text: "", error: String(e?.message ?? e) }; }
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { ok: res.ok, status: res.status, json, text };
}

export function buildAuthUrl(provider, redirectUri, state, codeChallenge) {
  const { clientId } = clientCreds(provider);
  const scope = provider.scopes.map((s) => s.oauthScope).filter(Boolean).join(provider.scopeSeparator);
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", state });
  if (scope) params.set("scope", scope);
  for (const [k, v] of Object.entries(provider.extraAuthParams ?? {})) params.set(k, v);
  if (provider.usePKCE && codeChallenge) { params.set("code_challenge", codeChallenge); params.set("code_challenge_method", "S256"); }
  return `${provider.authUrl}?${params.toString()}`;
}

function tokenRequest(provider, fields) {
  const { clientId, clientSecret } = clientCreds(provider);
  const headers = {};
  let body;
  const data = { ...fields };
  if (provider.tokenAuth === "basic") {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    data.client_id = clientId; data.client_secret = clientSecret;
  }
  if (provider.tokenStyle === "json") { headers["content-type"] = "application/json"; body = JSON.stringify(data); }
  else { headers["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(data).toString(); }
  return rawFetch(provider.tokenUrl, { method: "POST", headers, body });
}

function normalizeToken(json) {
  if (!json) return null;
  const access = json.access_token ?? json.authed_user?.access_token; // Slack bot token is top-level
  if (!access) return null;
  return {
    access,
    refresh: json.refresh_token ?? null,
    expiresAt: json.expires_in ? Date.now() + Number(json.expires_in) * 1000 : null,
    raw: json,
  };
}

export async function exchangeCode(provider, { code, codeVerifier, redirectUri }) {
  const fields = { grant_type: "authorization_code", code, redirect_uri: redirectUri };
  if (provider.usePKCE && codeVerifier) fields.code_verifier = codeVerifier;
  if (provider.includeScopeInToken) fields.scope = provider.scopes.map((s) => s.oauthScope).filter(Boolean).join(provider.scopeSeparator);
  const r = await tokenRequest(provider, fields);
  const tok = normalizeToken(r.json);
  if (!tok) return { ok: false, error: r.json?.error_description || r.json?.error || "token_exchange_failed" };
  return { ok: true, tokens: tok };
}

async function refreshAccountTokens(provider, accountId) {
  const cur = getAccountTokens(accountId);
  if (!cur?.refresh || provider.refresh === "none") return null;
  const r = await tokenRequest(provider, { grant_type: "refresh_token", refresh_token: cur.refresh });
  const tok = normalizeToken(r.json);
  if (!tok) return null;
  const next = { access: tok.access, refresh: tok.refresh ?? cur.refresh, expiresAt: tok.expiresAt };
  setAccountTokens(accountId, next);
  return next;
}

/**
 * Build a bound `api(url, opts)` for a connected account. Injects the bearer token
 * and provider headers; on 401 it refreshes once and retries. If refresh fails,
 * the account is flipped to needs_reconnect and the 401 response is returned.
 */
export function apiForAccount(account) {
  const provider = providerById(account.provider);
  return async function api(url, opts = {}) {
    let tokens = getAccountTokens(account.id);
    const call = (t) => rawFetch(url, { ...opts, headers: { ...(provider.extraHeaders ?? {}), ...(opts.headers ?? {}), authorization: `Bearer ${t}` } });
    let r = await call(tokens?.access);
    if (r.status === 401) {
      const next = await refreshAccountTokens(provider, account.id);
      if (!next) { const a = getAccountRaw(account.id); if (a) { a.status = "needs_reconnect"; a.updatedAt = new Date().toISOString(); putAccount(a); } return r; }
      r = await call(next.access);
    }
    return r;
  };
}
