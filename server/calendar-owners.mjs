// Calendar ownership on the records: every subscription names its owner, and every event it
// mirrored in says so too.
//
// Why events matter: canSeeEntity (store.mjs) counts BOTH ownerId and createdBy as
// ownership. A linked event is created with createdBy = whoever pressed Sync, so a calendar
// the Owner set up for a Limited Member (or one an Admin happened to refresh) would read as
// the syncer's own thing — the wrong person's colour, the wrong person's private view. Here
// both fields are brought back to the calendar's owner.
import { listSubscriptions, patchSubscription, listEvents, patchEvent, getAccountRaw } from "./store.mjs";
import { subscriptionOwnerId } from "./calendar-permissions.mjs";

/** The linked events a subscription mirrored in (the ones it OWNS — attachments on other
 * cards via alsoSubscriptionIds belong to those cards' own calendars). */
function linkedEventsOf(sub) {
  return listEvents((e) => e.householdId === sub.householdId && e.layer === "linked" && e.provenance?.subscriptionId === sub.id);
}

/**
 * Point a subscription's linked events at `ownerId`.
 * mode "reassign": the owner changed on purpose — ownerId AND createdBy both become the new
 *   owner (an old ownerId must not linger as a second claim).
 * mode "fill" (boot migration, post-sync tidy): createdBy becomes the owner; ownerId is only
 *   filled when empty, so an owner the sync already stamped is never second-guessed.
 * Writes only what changes. Returns the number of events patched.
 */
export function restampSubscriptionEvents(sub, ownerId, mode = "fill") {
  if (!sub || !ownerId) return 0;
  let n = 0;
  for (const ev of linkedEventsOf(sub)) {
    const patch = {};
    if (ev.createdBy !== ownerId) patch.createdBy = ownerId;
    if (mode === "reassign" ? (ev.ownerId ?? null) !== ownerId : (ev.ownerId ?? null) === null) patch.ownerId = ownerId;
    if (Object.keys(patch).length) { patchEvent(ev.id, patch); n++; }
  }
  return n;
}

/**
 * Idempotent per-household backfill, run once per tenant at boot (and callable by tests
 * inside runWithTenant). Before this, an ICS feed could have no owner at all and a Google
 * calendar's owner was inferred on every read; the permission matrix needs a named owner
 * on every calendar, so it is written down once here.
 * @returns {{ subscriptions: number, events: number }} what was changed
 */
export function backfillCalendarOwners(householdId) {
  let subscriptions = 0, events = 0;
  for (const sub of listSubscriptions((s) => !householdId || s.householdId === householdId)) {
    let owner = sub.ownerActorId ?? null;
    if (!owner) {
      const account = sub.accountId ? getAccountRaw(sub.accountId) : null;
      owner = subscriptionOwnerId(sub, account);
      if (!owner) continue; // nothing to name it after — leave it for the Owner to assign
      patchSubscription(sub.id, { ownerActorId: owner });
      subscriptions++;
    }
    events += restampSubscriptionEvents(sub, owner, "fill");
  }
  return { subscriptions, events };
}
