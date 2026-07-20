// Store reconciliation helpers for the local-first web store.
//
// The web app keeps a persisted IndexedDB copy of household data and re-merges
// the server's view into it on every `hydrateFromServer`. How the merge treats
// records the server DIDN'T return this time is the whole ballgame:
//
//   • Server-authoritative records (events, contact methods, members): the
//     server owns them completely, including deletions AND re-keys. If a record
//     that once had a server id is no longer in the server's current set, it was
//     deleted or re-keyed upstream and MUST be dropped — otherwise stale copies
//     pile up. Google Calendar re-syncs are the pathological case: they re-key
//     the same event, so a title/time can accumulate many ids over days. Only
//     records that never came from the server (no `serverId` — created offline
//     or not yet pushed) are preserved.
//
//   • Merge-by-id records (purely local drafts, etc.): preserve any local record
//     whose id the server hasn't claimed. Use `mergeById` for those.

export interface Reconcilable {
  id: string;
  serverId?: string;
}

/**
 * Server-authoritative merge. Returns the server's current set plus ONLY the
 * local records that never synced (no `serverId`). A record whose server id
 * changed upstream cannot linger as a duplicate.
 */
export function mergeServerAuthoritative<T extends Reconcilable>(serverMapped: T[], local: T[]): T[] {
  return [...serverMapped, ...local.filter((r) => !r.serverId)];
}

/**
 * Merge-by-id. Returns the server's current set plus local records the server
 * hasn't claimed by id. Correct only when server ids are STABLE (native records
 * that are never re-keyed) — for churn-prone synced records use
 * `mergeServerAuthoritative` instead.
 */
export function mergeById<T extends Reconcilable>(serverMapped: T[], local: T[]): T[] {
  const serverIds = new Set(serverMapped.map((r) => r.id));
  return [...serverMapped, ...local.filter((r) => !serverIds.has(r.serverId ?? r.id))];
}
