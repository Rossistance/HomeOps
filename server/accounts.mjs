// FamiliOS connector platform — connected accounts, scoped PER HOUSEHOLD USER.
// Each household member signs in to their OWN provider accounts; tokens are
// isolated per account in the vault and an account is only usable by the actor
// who connected it (or surfaced to that actor). Health is a real provider call.
import crypto from "node:crypto";
import { listAccountsRaw, putAccount, getAccountRaw, deleteAccountRaw, setAccountTokens, clearAccountTokens, setHealth, getHealth } from "./store.mjs";
import { providerById } from "./providers.mjs";
import { apiForAccount } from "./oauth.mjs";

const now = () => new Date().toISOString();

export function publicAccount(a) {
  return {
    id: a.id, provider: a.provider, displayName: a.displayName, scopes: a.scopes ?? [],
    status: a.status, connectedByActorId: a.connectedByActorId, householdId: a.householdId,
    lastHealthAt: a.lastHealthAt ?? null, lastHealthOk: a.lastHealthOk ?? null,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}

// Accounts visible to a given actor in a household (their own connections only).
export function listAccountsFor(householdId, actorId) {
  return listAccountsRaw()
    .filter((a) => a.householdId === (householdId ?? "local") && a.connectedByActorId === actorId)
    .map(publicAccount);
}
export function accountsByProviderFor(householdId, actorId) {
  const out = {};
  for (const a of listAccountsFor(householdId, actorId)) (out[a.provider] ||= []).push(a);
  return out;
}

// Ownership-checked fetch: only the connecting actor may use/manage the account.
export function getOwnedAccount(id, session) {
  const a = getAccountRaw(id);
  if (!a) return { error: "not_found" };
  if (a.householdId !== (session.householdId ?? "local") || a.connectedByActorId !== session.actorId) return { error: "forbidden" };
  return { account: a };
}

export async function resolveIdentity(provider, tokens, api) {
  try {
    if (provider.identityFromToken) return provider.identityFromToken(tokens.raw ?? {});
    if (provider.identity) return await provider.identity(api);
  } catch { /* fall through */ }
  return { externalAccountId: crypto.randomBytes(6).toString("hex"), displayName: `${provider.name} account` };
}

// Create or update the account for (household, actor, provider, externalAccountId).
// Tokens go straight to the vault; `connected` is written ONLY here (post-callback).
export async function upsertAccount({ provider, householdId, actorId, tokens }) {
  const def = providerById(provider);
  // Stash tokens under a temp id so identity calls (which need the token) work.
  const tempId = "acct_" + crypto.randomBytes(10).toString("hex");
  setAccountTokens(tempId, tokens);
  const ident = await resolveIdentity(def, tokens, apiForAccount({ id: tempId, provider }));

  const existing = listAccountsRaw().find((a) => a.householdId === (householdId ?? "local") && a.connectedByActorId === actorId && a.provider === provider && a.externalAccountId === ident.externalAccountId);
  const id = existing?.id ?? tempId;
  if (existing && id !== tempId) { setAccountTokens(id, tokens); clearAccountTokens(tempId); } // move tokens to the canonical id

  const acct = {
    id,
    householdId: householdId ?? "local",
    connectedByActorId: actorId,
    provider,
    externalAccountId: ident.externalAccountId,
    displayName: ident.displayName,
    scopes: def.scopes.map((s) => s.key),
    status: "connected",
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
    lastHealthAt: null, lastHealthOk: null,
  };
  putAccount(acct);
  return publicAccount(acct);
}

export function revokeAccount(id) {
  clearAccountTokens(id);
  deleteAccountRaw(id);
  setHealth(`acct:${id}`, { ok: false, status: "revoked" });
}

export async function checkAccountHealth(account) {
  const def = providerById(account.provider);
  const t0 = Date.now();
  let h;
  try { h = await def.health(apiForAccount(account)); } catch (e) { h = { ok: false, status: "error", detail: String(e?.message ?? e) }; }
  const a = getAccountRaw(account.id);
  if (a) { a.lastHealthAt = now(); a.lastHealthOk = h.ok; if (!h.ok && a.status === "connected") a.status = "degraded"; if (h.ok && a.status === "degraded") a.status = "connected"; a.updatedAt = now(); putAccount(a); }
  setHealth(`acct:${account.id}`, { ok: h.ok, status: h.status, latencyMs: Date.now() - t0 });
  return { ok: h.ok, status: h.status, detail: h.detail, latencyMs: Date.now() - t0 };
}

export { getHealth };
