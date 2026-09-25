// The household calendar refresh engine: ONE way to bring every calendar a family has
// connected up to date, shared by every door that wants fresh calendars.
//
// Before this, a refresh was whatever the caller happened to be: POST /api/calendar/sync-all
// synced every subscription AS THE CALLER (their session, their Google fallback, their name
// on each new event), an old iOS build called it every 60 s per open app, and the 15-minute
// sweep had its own copy of the loop acting as each subscription's creator. So the rules
// here are the product's, not a route's:
//
//   - A household's calendars are refreshed as THEIR OWNERS. Each subscription syncs with a
//     session for the member it belongs to (assigned member → the member who connected its
//     Google account → whoever added it), so a child opening the app can set a refresh off
//     without any of that refresh being "theirs".
//   - Anyone signed in may ask. The server makes asking cheap: SINGLE-FLIGHT per household
//     (callers arriving while a refresh runs share its promise instead of starting a
//     second), and a ONE-MINUTE FLOOR (a refresh finished less than REFRESH_MIN_MS ago
//     answers { skipped:"recent" } without touching Google). `force` skips the floor only.
//   - It always runs in the household's own tenant (runWithTenant): the store resolves
//     which household's database to use from the async context, and a refresh kicked from
//     a request, a sweep or an assistant run must never read or write the wrong one.
//   - Quiet when nothing happened. It is audited only when something changed or failed —
//     a household refreshing every minute must not bury its audit log in no-ops.
import { listSubscriptions, getSubscription, patchSubscription, getMember, getAccountRaw, appendAudit, runWithTenant, currentTenant } from "./store.mjs";
import { syncSubscription, pullGoogleEdits } from "./calendar.mjs";

export const REFRESH_MIN_MS = 60_000;

/* The floor, with one test-only escape hatch: the HTTP suites boot a real server in a child
 * process and observe refreshes through the store, where a one-minute floor would hide every
 * trigger after the first. Honoured only outside production; production is always 60 s. */
function floorMs() {
  if (process.env.HOMEOPS_ENV === "production" || process.env.NODE_ENV === "production") return REFRESH_MIN_MS;
  const v = Number(process.env.HOMEOPS_CAL_REFRESH_MIN_MS);
  return process.env.HOMEOPS_CAL_REFRESH_MIN_MS != null && Number.isFinite(v) && v >= 0 ? v : REFRESH_MIN_MS;
}

const inflight = new Map(); // householdId → the running refresh's promise (single-flight)
const lastDone = new Map(); // householdId → ms the last refresh finished (the floor)

/* ---- Test seam: swap the network-touching halves, and watch the kicks ---- */
let syncImpl = syncSubscription;
let pullImpl = pullGoogleEdits;
let onKick = null;
/** Tests only: replace the per-subscription sync and/or the merge-back pull, and/or observe
 * every kickCalendarRefresh call (householdId, reason) — so a suite never reaches Google. */
export function _setRefreshSyncForTests({ sync, pull, kick } = {}) {
  if (sync) syncImpl = sync;
  if (pull) pullImpl = pull;
  if (kick !== undefined) onKick = kick;
}
/** Tests only: forget every floor and in-flight run, and restore the real implementations. */
export function _resetRefreshForTests() {
  inflight.clear(); lastDone.clear();
  syncImpl = syncSubscription; pullImpl = pullGoogleEdits; onKick = null;
}

/** Who a subscription belongs to — the member it syncs as and whose name new events carry. */
function subscriptionOwner(sub) {
  if (sub.ownerActorId) return sub.ownerActorId;
  if (sub.accountId) {
    const a = getAccountRaw(sub.accountId);
    if (a?.connectedByActorId) return a.connectedByActorId;
  }
  return sub.createdBy ?? null;
}

// Reasons arrive from clients (POST /api/calendar/refresh) and land in lastResult and the
// audit log — keep them to a short token.
const cleanReason = (r) => (String(r ?? "").trim().replace(/[^\w.:-]/g, "").slice(0, 40) || "manual");

async function runRefresh(householdId, reason) {
  const at = Date.now();
  let synced = 0, imported = 0, updated = 0, removed = 0;
  const errors = [];
  // Pasted imports are static text — nothing upstream can have changed.
  const subs = listSubscriptions((s) => s.householdId === householdId && s.source !== "import");
  for (const listed of subs) {
    // Re-read: an earlier calendar's sync can take seconds, and this one may have been
    // removed or reassigned by then.
    const sub = getSubscription(listed.id);
    if (!sub || sub.householdId !== householdId) continue;
    try {
      const owner = subscriptionOwner(sub);
      if (!owner) { errors.push({ id: sub.id, error: "no_owner" }); continue; }
      const session = { householdId, actorId: owner, role: getMember(owner)?.role ?? null };
      const r = await syncImpl({ sub, session });
      // Exactly what the per-subscription routes record, plus how this sync came about.
      patchSubscription(sub.id, {
        lastSyncAt: Date.now(),
        lastResult: r?.ok ? { imported: r.imported, updated: r.updated, removed: r.removed, via: reason } : { error: r?.error ?? "sync_failed", via: reason },
        eventCount: r?.ok ? r.total : (sub.eventCount ?? 0),
      });
      if (r?.ok) { synced++; imported += r.imported ?? 0; updated += r.updated ?? 0; removed += r.removed ?? 0; }
      else errors.push({ id: sub.id, error: r?.error ?? "sync_failed" });
    } catch (e) {
      // One bad calendar never stops the rest.
      errors.push({ id: sub.id, error: String(e?.message ?? e) });
    }
  }
  // Merge-back half: Google-side edits to events the family pushed. Best-effort — each event
  // is checked with the account it lives in (pullGoogleEdits), and a failure here is not a
  // failure of the calendars above.
  const pulled = { checked: 0, merged: 0, conflicts: 0, unlinked: 0 };
  try {
    const p = await pullImpl({ householdId });
    if (p?.ok) Object.assign(pulled, { checked: p.checked ?? 0, merged: p.merged ?? 0, conflicts: p.conflicts ?? 0, unlinked: p.unlinked ?? 0 });
  } catch { /* best effort */ }
  const changed = imported + updated + removed + pulled.merged + pulled.conflicts + pulled.unlinked > 0;
  if (changed || errors.length > 0) {
    try {
      appendAudit({ type: "calendar.refresh", householdId, reason, ok: errors.length === 0, synced, imported, updated, removed, pulled, failed: errors.length, ...(errors.length ? { errors: errors.slice(0, 10) } : {}) });
    } catch { /* the audit must never fail the refresh */ }
  }
  return { ok: true, at, synced, imported, updated, removed, pulled, errors };
}

/**
 * Refresh every calendar of one household (see the header for the rules).
 * Returns { ok:true, at, synced, imported, updated, removed, pulled, errors:[{id,error}] },
 * or { ok:true, skipped:"recent", at } inside the one-minute floor.
 */
export async function refreshHouseholdCalendars(householdId, { reason = "manual", force = false } = {}) {
  const hh = householdId ?? currentTenant();
  // Everything up to the inflight.set below runs synchronously on the call, so two callers
  // in the same tick cannot both miss the map.
  const running = inflight.get(hh);
  if (running) return running;
  const last = lastDone.get(hh);
  if (!force && last != null && Date.now() - last < floorMs()) return { ok: true, skipped: "recent", at: last };
  const p = runWithTenant(hh, () => runRefresh(hh, cleanReason(reason)))
    .catch((e) => ({ ok: false, error: String(e?.message ?? e) }))
    .finally(() => { lastDone.set(hh, Date.now()); inflight.delete(hh); });
  inflight.set(hh, p);
  return p;
}

/** Fire-and-forget refresh after a write. Never throws, never delays the caller's response
 * (the work starts on the next turn of the event loop), and runs in the household's tenant
 * whatever context it was called from. */
export function kickCalendarRefresh(householdId, reason = "write") {
  try {
    const hh = householdId ?? currentTenant();
    if (onKick) { try { onKick(hh, reason); } catch { /* a spy must not break the caller */ } }
    setImmediate(() => { refreshHouseholdCalendars(hh, { reason }).catch(() => {}); });
  } catch { /* a refresh is never worth failing a write over */ }
}

/** Start (or join) a refresh and wait up to waitMs for it. Returns its summary, or
 * { ok:true, pending:true } when it is still running — it carries on in the background. */
export async function awaitCalendarRefresh(householdId, { reason = "manual", waitMs = 8000 } = {}) {
  const p = refreshHouseholdCalendars(householdId, { reason }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: true, pending: true }), waitMs); });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(timer); }
}
