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
/** ISS-121: connection status by account id for a WHOLE household — deliberately not
 * scoped to one actor, unlike listAccountsFor above. The calendar needs to know whether a
 * synced event's source can still refresh, and the reported case is exactly cross-member:
 * Melissa's Google account sat in `needs_reconnect` while Ross's kept syncing, and her
 * stale events went on rendering for everyone. Status/labels only — never tokens. */
export function accountStatusById(householdId) {
  const out = new Map();
  for (const a of listAccountsRaw()) {
    if (a.householdId !== (householdId ?? "local")) continue;
    out.set(a.id, {
      status: a.status, provider: a.provider,
      displayName: a.displayName ?? null, connectedByActorId: a.connectedByActorId ?? null,
    });
  }
  return out;
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
  if (a) {
    a.lastHealthAt = now();
    a.lastHealthOk = h.ok;
    if (!h.ok && a.status === "connected") a.status = "degraded";
    // A SUCCESSFUL probe clears any unhealthy status, not just "degraded".
    //
    // This recovery used to read `a.status === "degraded"`, which made
    // needs_reconnect a one-way door: once set, a working credential could never clear
    // it. Reported verbatim: "even though I synced the accounts you can see here that
    // they are still showing reconnect… I could log out, close the app, doesn't matter,
    // it'll still be there." The status outlived the problem it described, and the
    // calendar's stale-source banner (ISS-121) faithfully repeated it forever.
    // A probe that just succeeded IS the evidence the account works.
    if (h.ok && a.status !== "connected") a.status = "connected";
    a.updatedAt = now();
    putAccount(a);
  }
  setHealth(`acct:${account.id}`, { ok: h.ok, status: h.status, latencyMs: Date.now() - t0 });
  return { ok: h.ok, status: h.status, detail: h.detail, latencyMs: Date.now() - t0 };
}

/* ---- The reconnect that wouldn't clear, part two --------------------------------------
 *
 * Part one made a SUCCESSFUL call clear an unhealthy status (checkAccountHealth above, and
 * the same rule in oauth.mjs apiForAccount). That was necessary and not sufficient, because
 * both only fire for an account something happens to USE. Reported again after shipping it:
 * "the reconnect button is still there."
 *
 * The hole: checkAccountHealth was reachable only from POST /api/accounts/:id/health, which
 * is restricted to the member who connected that account, and nothing called it on a
 * schedule. So an account that nothing exercises — Melissa's while Ross is the one syncing,
 * or any connected account with no subscription behind it — kept whatever status it was last
 * given, forever. The status stopped describing the account and started describing history.
 *
 * This sweep is the fix: probe every account in the household on a timer, so status reflects
 * what the credential can do NOW rather than what last happened to touch it. It corrects in
 * both directions — a working account clears, and a genuinely dead one gets marked without
 * waiting for a family member to trip over it.
 *
 * Throttled per account (a probe is a real provider request), and never runs two probes for
 * the same account concurrently.
 */
const HEALTH_MIN_INTERVAL_MS = 15 * 60 * 1000;
const inFlight = new Set();

export async function sweepAccountHealth({ householdId, now: t = Date.now(), force = false } = {}) {
  const out = { checked: 0, healed: 0, marked: 0, skipped: 0 };
  let accounts;
  try {
    accounts = listAccountsRaw().filter((a) => a.householdId === (householdId ?? "local"));
  } catch { return out; }
  for (const a of accounts) {
    // A revoked account is a deliberate, explicit state — the family disconnected it. Probing
    // it would be pointless and clearing it would undo something they chose.
    if (a.status === "revoked") { out.skipped++; continue; }
    if (inFlight.has(a.id)) { out.skipped++; continue; }
    const last = a.lastHealthAt ? Date.parse(a.lastHealthAt) : 0;
    if (!force && Number.isFinite(last) && t - last < HEALTH_MIN_INTERVAL_MS) { out.skipped++; continue; }
    const before = a.status;
    inFlight.add(a.id);
    try {
      const h = await checkAccountHealth(a);
      out.checked++;
      const after = getAccountRaw(a.id)?.status;
      if (after === "connected" && before !== "connected") out.healed++;
      else if (!h.ok && after !== before) out.marked++;
    } catch {
      // One unreachable provider must not stop the rest of the household's sweep.
      out.skipped++;
    } finally {
      inFlight.delete(a.id);
    }
  }
  return out;
}

export { getHealth };
