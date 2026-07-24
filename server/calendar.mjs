// Calendar subscription sync: turn a calendar source — a Google Calendar (OAuth), an .ics
// feed URL, or pasted .ics — into FamiliOS' read-only "linked" calendar-layer events. The
// source is the source of truth: re-syncing updates matched events (by UID) and drops ones
// that left it. ICS-fed events are layer:"linked" read-only mirrors (copy-to-edit);
// google-sourced linked events are editable two-way (the PATCH route writes to Google
// first via editLinkedGoogleEvent). Pushing canonical FamiliOS events into Google is the
// separate, approval-gated pushEventToGoogle path.
import crypto from "node:crypto";
import { safeFetch } from "./net.mjs";
import { parseICS, expandRecurring } from "./ics.mjs";
import { listEvents, putEvent, patchEvent, deleteEventRec, getAccountRaw, getSubscription } from "./store.mjs";
import { listAccountsFor } from "./accounts.mjs";
import { apiForAccount } from "./oauth.mjs";

// Normalize Google Calendar API items into the same intermediate shape parseICS produces,
// so the upsert path is shared. Pure + unit-testable (no network).
export function mapGoogleEvents(items) {
  return (items ?? [])
    .filter((e) => e && e.status !== "cancelled")
    .map((e) => ({
      uid: e.id ?? null,
      title: e.summary ?? "(untitled)",
      startAt: e.start?.dateTime ?? e.start?.date ?? null,
      endAt: e.end?.dateTime ?? e.end?.date ?? null,
      location: e.location ?? "",
      allDay: !!(e.start?.date && !e.start?.dateTime),
    }));
}

// FamiliOS stores an all-day span with `endAt` INCLUSIVE and local-midnight ISO stamps —
// see `coversDay` on both clients (it renders start..end inclusive) and `mergeGoogleEdit`
// below, which already normalizes on the single-event edit path.
//
// BOTH upstream formats disagree: Google's `end.date` and iCalendar's `DTEND;VALUE=DATE`
// (RFC 5545 §3.6.1) are EXCLUSIVE. Storing either verbatim made every all-day event render
// one day too long (ISS-104) — a one-day anniversary showed on two days. A date-only
// `startAt` was wrong in the other direction: `new Date("2026-07-31")` is UTC midnight,
// which is the previous evening in any negative-offset zone, so US households saw all-day
// events begin a day EARLY.
//
// Normalizing here — once, where the Google and .ics paths converge — fixes both at the
// boundary and keeps every downstream renderer on one convention. Idempotent by
// construction: only date-only (`YYYY-MM-DD`) stamps are rewritten and the result is
// always full ISO, so re-syncing can never shift the same span twice.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const parseLocalDate = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
export function normalizeAllDaySpan(ev) {
  if (!ev?.allDay || !ev.startAt) return ev;
  const startAt = DATE_ONLY_RE.test(String(ev.startAt)) ? parseLocalDate(ev.startAt).toISOString() : ev.startAt;
  let endAt = ev.endAt ?? null;
  if (endAt && DATE_ONLY_RE.test(String(endAt))) {
    const inc = parseLocalDate(endAt);
    inc.setDate(inc.getDate() - 1);                                // exclusive → inclusive
    endAt = +inc > +new Date(startAt) ? inc.toISOString() : null;  // single-day ⇒ no end at all
  }
  return { ...ev, startAt, endAt };
}

/** Idempotent repair of all-day events stored BEFORE the ingest fix above (ISS-104): any
 * all-day event still holding date-only stamps carries an exclusive end and a UTC-parsed
 * start. Re-running is a no-op, since normalizeAllDaySpan only rewrites date-only stamps
 * and always writes full ISO. Scoped to one household; returns the number repaired. */
export function backfillAllDaySpans(householdId) {
  let repaired = 0;
  for (const ev of listEvents((e) => e.householdId === householdId && e.allDay === true && e.startAt)) {
    if (!DATE_ONLY_RE.test(String(ev.startAt ?? "")) && !DATE_ONLY_RE.test(String(ev.endAt ?? ""))) continue;
    const fixed = normalizeAllDaySpan(ev);
    patchEvent(ev.id, { startAt: fixed.startAt, endAt: fixed.endAt });
    repaired++;
  }
  return repaired;
}

/** Normalized dedupe fingerprint for an event: lowercased/trimmed title + the DATE
 * portion for all-day events (Google sends "2026-07-31", ICS feeds often send
 * "2026-07-31T00:00:00.000Z" for the same day — they must collide), else the full
 * instant. Exported for unit tests. */
const MIDNIGHT_RE = /T00:00(:00)?(\.000)?(Z|[+-]00:?00)?$/;
export function eventFingerprint(title, startAt, allDay) {
  const s = String(startAt ?? "");
  const timeKey = allDay || MIDNIGHT_RE.test(s) ? s.slice(0, 10) : s;
  return `${String(title).trim().toLowerCase()}|${timeKey}`;
}

// Resolve the connected Google account this subscription reads from. The
// subscription is pinned to the account that created it (sub.accountId) — any
// household adult can hit Sync on it without being logged into that Google
// account, since the tokens live server-side. Falls back to the actor's own
// account only for legacy subs that never stored an accountId.
function resolveGoogleAccount(sub, session) {
  if (sub?.accountId) {
    const pinned = getAccountRaw(sub.accountId);
    if (pinned && pinned.provider === "google" && pinned.householdId === session.householdId) return pinned;
    return null; // pinned account was revoked — surface no_account rather than silently reading someone else's
  }
  return listAccountsFor(session.householdId, session.actorId).find((a) => a.provider === "google") ?? null;
}

/**
 * Sync a subscription's events from its source (google | url | pasted ics).
 * Returns { ok, imported, updated, removed, total } | { ok:false, error }.
 */
export async function syncSubscription({ sub, icsText, session }) {
  let parsed;
  let googleAccountId = null; // set for google-sourced subs so linked events can be edited two-way
  let ownerActorId = null;    // the member who connected the account — synced events belong to them (colors, free/busy)
  if (sub?.source === "google") {
    // Pull upcoming events from the actor's connected Google Calendar (next ~90 days).
    const account = resolveGoogleAccount(sub, session);
    if (!account) return { ok: false, error: "no_account" };
    googleAccountId = account.id;
    ownerActorId = account.connectedByActorId ?? null;
    const api = apiForAccount(account);
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + 90 * 864e5).toISOString();
    const r = await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=250&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`);
    if (!r.ok) return { ok: false, error: r.status === 401 ? "needs_reconnect" : "google_error", status: r.status };
    parsed = mapGoogleEvents(r.json?.items);
  } else {
    // .ics: pasted feeds keep their raw text on the sub (re-parsed on re-sync); URL feeds
    // are re-fetched (SSRF-guarded). One source must be available.
    let text = icsText;
    if (!text) text = sub?.icsText;
    if (!text) {
      if (!sub?.url) return { ok: false, error: "no_source" };
      const r = await safeFetch(sub.url, { headers: { accept: "text/calendar" } }, { allowLoopback: false, timeoutMs: 15_000, maxBytes: 4_000_000 });
      if (!r.ok) return { ok: false, error: r.policyBlocked ? "egress_blocked" : "fetch_failed", message: r.error };
      if (!r.httpOk) return { ok: false, error: "http_error", status: r.status };
      text = r.text;
    }
    if (!/BEGIN:VCALENDAR|BEGIN:VEVENT/i.test(String(text))) return { ok: false, error: "not_ics" };
    // Recurring VEVENTs expand into concrete instances (30 days back / 90 days ahead —
    // matching the Google pull window). Google's own path is already expanded
    // (singleEvents=true), so only the ICS path needs this.
    parsed = expandRecurring(parseICS(text), { horizonStart: Date.now() - 30 * 864e5, horizonEnd: Date.now() + 90 * 864e5 });
  }
  // ISS-104: normalize all-day spans ONCE, right where the Google and .ics branches
  // converge, so every downstream consumer sees the inclusive/local-midnight convention.
  parsed = (parsed ?? []).map(normalizeAllDaySpan);
  const hh = session.householdId;
  // Repair anything stored by the pre-fix ingest before comparing against this pull —
  // otherwise a stale exclusive end reads as a "change" on every single sync.
  backfillAllDaySpans(hh);
  const subId = sub?.id ?? null;
  const fpOf = eventFingerprint;
  // A feed sometimes carries literal twins — the same title on the same (all-day) date
  // under different UIDs (recurring promos that re-id each publish were the
  // "3× Skip fabletics" bug). Collapse them by normalized fingerprint BEFORE upserting
  // so one card lands, not three.
  {
    const seenFp = new Set();
    parsed = parsed.filter((ev) => {
      if (!ev.startAt) return true;
      const k = fpOf(ev.title, ev.startAt, ev.allDay);
      if (seenFp.has(k)) return false;
      seenFp.add(k);
      return true;
    });
  }
  // Existing linked events for this subscription, keyed by their source UID — and by
  // normalized fingerprint, so a feed that re-ids an unchanged event updates the stored
  // card instead of importing a twin beside it.
  const existing = new Map(
    listEvents((e) => e.householdId === hh && e.layer === "linked" && e.provenance?.subscriptionId === subId && e.provenance?.uid)
      .map((e) => [e.provenance.uid, e]),
  );
  const sameSubByFp = new Map();
  for (const e of existing.values()) if (e.startAt) sameSubByFp.set(fpOf(e.title, e.startAt, e.allDay), e);
  // Shared-event dedupe: the same real-world event often arrives through TWO
  // household subscriptions (spouses on a shared Google calendar, or a mutual
  // invite) — or already exists as the family's own CANONICAL event (pushed to
  // Google, then seen again by the sync; that was the duplicate plain-white card).
  // Instead of two cards, the existing event absorbs the incoming copy and wears the
  // source calendar's color via provenance.alsoSubscriptionIds. Matched by source UID
  // first (Google keeps event ids stable across attendee copies), then by the
  // normalized title+start fingerprint for calendars that re-id. A canonical match
  // always outranks another sub's linked copy.
  const othersByUid = new Map(); const othersByFp = new Map();
  for (const e of listEvents((e) => e.householdId === hh && e.layer === "linked" && e.provenance?.subscriptionId && e.provenance.subscriptionId !== subId)) {
    if (e.provenance.uid) othersByUid.set(e.provenance.uid, e);
    if (e.startAt) othersByFp.set(fpOf(e.title, e.startAt, e.allDay), e);
  }
  for (const e of listEvents((e) => e.householdId === hh && (e.layer ?? "canonical") === "canonical" && e.startAt)) {
    const gid = e.provenance?.googleEventId ?? e.provenance?.uid;
    if (gid) othersByUid.set(gid, e);
    othersByFp.set(fpOf(e.title, e.startAt, e.allDay), e);
  }
  // Absorb an incoming copy into an existing card: linked cards convert as before;
  // a canonical card just records the source (stays canonical, stays the family's).
  const attachTo = (other) => {
    const also = [...new Set([...(other.provenance?.alsoSubscriptionIds ?? []), subId])];
    patchEvent(other.id, { provenance: { ...(other.provenance ?? {}), alsoSubscriptionIds: also } });
  };
  let imported = 0, updated = 0, merged = 0;
  const seenAlso = new Set(); // uids this sub attached to (owned by another sub or canonical)
  for (const ev of parsed) {
    if (!ev.startAt) continue;
    const uid = ev.uid || crypto.createHash("sha1").update(`${ev.title}|${ev.startAt}`).digest("hex");
    const fields = { title: ev.title, startAt: ev.startAt, endAt: ev.endAt, location: ev.location, allDay: ev.allDay, ...(ownerActorId ? { ownerId: ownerActorId } : {}) };
    // Google-sourced linked events carry the Google event id + account so in-app edits
    // can write back to Google (two-way). ICS feeds stay read-only mirrors.
    const gprov = googleAccountId ? { via: "google", googleEventId: uid, googleAccountId } : null;
    let prior = existing.get(uid);
    if (!prior) {
      // Same-sub twin under a new uid (feed re-id): fold onto the stored card and
      // adopt the new uid so the next sync matches directly.
      const twin = sameSubByFp.get(fpOf(ev.title, ev.startAt, ev.allDay));
      if (twin && existing.has(twin.provenance?.uid)) prior = twin;
    }
    if (prior) {
      // Backfill google provenance onto pre-existing linked events (created before two-way
      // edits); a re-id'd twin also gets its provenance.uid refreshed to the feed's new uid.
      const needsProv = (gprov && !prior.provenance?.googleEventId) || prior.provenance?.uid !== uid;
      patchEvent(prior.id, needsProv ? { ...fields, provenance: { ...(prior.provenance ?? {}), uid, ...(gprov ?? {}) } } : fields);
      existing.delete(prior.provenance?.uid); updated++;
      continue;
    }
    const other = othersByUid.get(uid) ?? othersByFp.get(fpOf(ev.title, ev.startAt, ev.allDay));
    if (other) { attachTo(other); seenAlso.add(other.id); merged++; continue; }
    putEvent({
      id: "ev_" + crypto.randomBytes(8).toString("hex"), householdId: hh,
      ...fields, endAt: ev.endAt ?? null, spaceId: "sp-family", participantIds: [], driverId: null,
      ownerId: ownerActorId, backupOwnerId: null, whatToBring: [], checklist: [], travel: null, reminders: [],
      attachments: [], comments: [], mealImpact: null, visibility: "household", category: "Calendar",
      layer: "linked", status: "confirmed", source: sub?.name ?? "Subscribed calendar",
      provenance: { via: gprov ? "google" : "ics", subscriptionId: subId, uid, ...(gprov ?? {}) },
      createdBy: session.actorId, createdAt: Date.now(), updatedAt: new Date().toISOString(),
    });
    imported++;
  }
  // This sub no longer sees events it previously attached to (invite withdrawn) —
  // detach our color from those shared cards (linked AND canonical absorbers).
  for (const e of listEvents((e) => e.householdId === hh && (e.provenance?.alsoSubscriptionIds ?? []).includes(subId))) {
    if (!seenAlso.has(e.id)) {
      patchEvent(e.id, { provenance: { ...(e.provenance ?? {}), alsoSubscriptionIds: (e.provenance.alsoSubscriptionIds ?? []).filter((x) => x !== subId) } });
    }
  }
  // Anything that disappeared from the feed is removed (feed = source of truth) —
  // unless another subscription still shows it, in which case ownership transfers.
  let removed = 0;
  for (const stale of existing.values()) {
    const also = (stale.provenance?.alsoSubscriptionIds ?? []).filter((x) => x !== subId);
    if (also.length > 0) {
      patchEvent(stale.id, { provenance: { ...(stale.provenance ?? {}), subscriptionId: also[0], alsoSubscriptionIds: also.slice(1) } });
    } else { deleteEventRec(stale.id); removed++; }
  }
  // One-time cleanup for duplicates that landed before dedupe existed: same
  // household, same normalized fingerprint → one card wins, linked copies fold
  // into its alsoSubscriptionIds. A canonical event always wins (the family's own
  // card is never deleted); otherwise the oldest linked card keeps ownership.
  // Same-sub twins fold too (the "3× Skip fabletics" leftovers).
  const groups = new Map();
  for (const e of listEvents((e) => e.householdId === hh && (e.layer === "linked" || (e.layer ?? "canonical") === "canonical") && e.startAt)) {
    const k = fpOf(e.title, e.startAt, e.allDay);
    (groups.get(k) ?? groups.set(k, []).get(k)).push(e);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const keeper = g.find((e) => (e.layer ?? "canonical") === "canonical") ?? g[0];
    const subsSet = new Set([...(keeper.provenance?.alsoSubscriptionIds ?? [])]);
    let changed = false;
    for (const dupe of g) {
      if (dupe.id === keeper.id) continue;
      // Only fold linked copies — never delete a canonical (user-owned) event.
      if (dupe.layer !== "linked" || !dupe.provenance?.subscriptionId) continue;
      if (dupe.provenance.subscriptionId !== keeper.provenance?.subscriptionId) subsSet.add(dupe.provenance.subscriptionId);
      for (const x of dupe.provenance?.alsoSubscriptionIds ?? []) if (x !== keeper.provenance?.subscriptionId) subsSet.add(x);
      deleteEventRec(dupe.id); removed++; changed = true;
    }
    if (changed) patchEvent(keeper.id, { provenance: { ...(keeper.provenance ?? {}), alsoSubscriptionIds: [...subsSet] } });
  }
  return { ok: true, imported, updated, removed, merged, total: parsed.length };
}

/* ---- Two-way sync, merge-back half (Phase 9): Google edits → pushed FamiliOS events ----
 * For canonical events previously pushed to Google (provenance.googleEventId), detect edits
 * made on the Google side and merge them back. Conflict policy (decided at design time):
 * if BOTH sides changed since the last push/merge, we FLAG the event for review
 * (provenance.conflict) instead of silently overwriting — FamiliOS never clobbers a family's
 * canonical event without a human seeing it. A Google-side delete/cancel UNLINKS the event
 * (FamiliOS stays canonical; the next push would re-create it) rather than deleting it. */

// Pure decision function — unit-testable with fixtures, no network.
// ev: FamiliOS canonical event; gev: raw Google event resource (null if 404/cancelled).
export function mergeGoogleEdit({ ev, gev }) {
  const prov = ev.provenance ?? {};
  if (!gev || gev.status === "cancelled") return { action: "unlinked" };
  // All-day normalization (WP-003/ISS-005): Google's `date` form maps back to the
  // FamiliOS convention — allDay:true + local-midnight ISO stamps, end INCLUSIVE
  // (Google's end.date is exclusive; a single-day all-day event gets endAt:null).
  const gAllDay = !!gev.start?.date && !gev.start?.dateTime;
  const parseGDate = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const startAt = gev.start?.dateTime ?? (gev.start?.date ? parseGDate(gev.start.date).toISOString() : null);
  let endAt = gev.end?.dateTime ?? null;
  if (!endAt && gev.end?.date) {
    const inc = parseGDate(gev.end.date); inc.setDate(inc.getDate() - 1);
    endAt = startAt && +inc > +new Date(startAt) ? inc.toISOString() : null;
  }
  const fields = {
    title: gev.summary ?? "(untitled)",
    startAt,
    endAt,
    allDay: gAllDay,
    location: gev.location ?? "",
    // Event body: Google `description` ↔ FamiliOS `notes` — with the composed
    // FamiliOS block (Bring: …) stripped so the round-trip is lossless and the
    // Bring list is never re-imported into notes (WP-004/DEC-04).
    notes: stripFamiliosBlock(gev.description),
  };
  const differs = fields.title !== ev.title
    || String(fields.startAt ?? "") !== String(ev.startAt ?? "")
    || String(fields.endAt ?? "") !== String(ev.endAt ?? "")
    || fields.allDay !== (ev.allDay === true)
    || (fields.location ?? "") !== (ev.location ?? "")
    || (fields.notes ?? "") !== (ev.notes ?? "");
  if (!differs) return { action: "none" };
  // Baseline = the last moment we know both sides agreed (push or previous merge).
  const baseline = Math.max(prov.pushedAt ?? 0, prov.lastMergeAt ?? 0);
  // Google's `updated` within ~5s of our own write is just our push echoing back.
  const googleChanged = gev.updated ? Date.parse(gev.updated) > baseline + 5000 : true;
  if (!googleChanged) return { action: "none" }; // difference is a local FamiliOS edit awaiting push — never pull over it
  const localChanged = Date.parse(ev.updatedAt ?? 0) > baseline + 2000;
  if (localChanged) return { action: "conflict", fields, googleUpdated: gev.updated ?? null };
  return { action: "merge", fields, googleUpdated: gev.updated ?? null };
}

/**
 * Pull Google-side edits back into this household's pushed canonical events.
 * Returns { ok, checked, merged, conflicts, unlinked, errors } | { ok:false, error }.
 */
export async function pullGoogleEdits({ session }) {
  const mine = listAccountsFor(session.householdId, session.actorId).filter((a) => a.provider === "google");
  if (mine.length === 0) return { ok: false, error: "no_account" };
  const pushed = listEvents((e) => e.householdId === session.householdId
    && (e.layer ?? "canonical") === "canonical" && e.provenance?.googleEventId);
  let checked = 0, merged = 0, conflicts = 0, unlinked = 0, errors = 0;
  for (const ev of pushed) {
    const account = mine.find((a) => a.id === ev.provenance?.googleAccountId) ?? mine[0];
    const api = apiForAccount(account);
    const r = await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(ev.provenance.googleEventId)}`);
    checked++;
    let gev = null;
    if (r.ok) gev = r.json;
    else if (r.status === 404 || r.status === 410) gev = null; // deleted on Google
    else { errors++; continue; } // auth/transient — skip, don't guess
    const d = mergeGoogleEdit({ ev, gev });
    if (d.action === "merge") {
      patchEvent(ev.id, { ...d.fields, provenance: { ...(ev.provenance ?? {}), lastGoogleUpdated: d.googleUpdated, lastMergeAt: Date.now(), conflict: null } });
      merged++;
    } else if (d.action === "conflict") {
      patchEvent(ev.id, { provenance: { ...(ev.provenance ?? {}), conflict: { at: Date.now(), googleUpdated: d.googleUpdated, google: d.fields } } });
      conflicts++;
    } else if (d.action === "unlinked") {
      patchEvent(ev.id, { provenance: { ...(ev.provenance ?? {}), googleEventId: null, unlinkedAt: Date.now() } });
      unlinked++;
    }
  }
  return { ok: true, checked, merged, conflicts, unlinked, errors };
}

/* ---- Conflict resolution (the human half of merge-back) ----
 * A flagged event (provenance.conflict) holds Google's version alongside the local one.
 * Resolving is a pure decision → patch:
 *   choice:"google" → adopt Google's fields; baseline resets so the next pull is clean.
 *   choice:"local"  → keep FamiliOS' fields; baseline resets so the pull stops re-flagging
 *                     (Google still differs until the user re-pushes — that's explicit). */
export function resolveConflictPatch(ev, choice) {
  const conflict = ev?.provenance?.conflict;
  if (!conflict) return null;
  if (choice !== "google" && choice !== "local") return null;
  const provenance = {
    ...(ev.provenance ?? {}),
    conflict: null,
    lastMergeAt: Date.now(),
    lastGoogleUpdated: conflict.googleUpdated ?? ev.provenance?.lastGoogleUpdated ?? null,
  };
  return choice === "google" ? { ...(conflict.google ?? {}), provenance } : { provenance };
}

/* ---- Meal → calendar event body ----
 * Composes the event `notes` (and therefore the Google Calendar description) from
 * a meal: source recipe URL, full ingredient list, step-by-step instructions, and
 * a pointer to the linked FamiliOS mini apps. Pure + unit-testable. */
export function mealEventNotes(meal) {
  const lines = [];
  if (meal.recipeUrl) lines.push(`Recipe: ${meal.recipeUrl}`);
  if (meal.servings) lines.push(`Servings: ${meal.servings}`);
  const ingredients = (meal.ingredients ?? []).map((i) => (typeof i === "string" ? i : i.item)).filter(Boolean);
  if (ingredients.length) lines.push("", "Ingredients:", ...ingredients.map((i) => `• ${i}`));
  const steps = (meal.instructions ?? []).filter(Boolean);
  if (steps.length) lines.push("", "Instructions:", ...steps.map((s, i) => `${i + 1}. ${s}`));
  lines.push("", "Linked in FamiliOS: Meal planner + Groceries list (ingredients synced).");
  return lines.join("\n").trim();
}

/* ---- Google description composition (WP-004 / ISS-003, DEC-04) ----
 * The description pushed to Google = the event's notes PLUS a clearly delimited
 * FamiliOS block carrying "Bring: …" (the app's logistics data — previously
 * dropped entirely). The delimiter line makes the round-trip LOSSLESS: the pull
 * half strips the composed block before comparing/merging into `notes`, so the
 * Bring list is never re-imported as note text and re-push stays idempotent.
 * Content INSIDE the block is FamiliOS-owned; Google-side edits to it are
 * intentionally not merged back (whatToBring stays structured in FamiliOS). */
export const FAMILIOS_BLOCK_DELIM = "— FamiliOS —";

export function composeGoogleDescription(ev) {
  const notes = String(ev.notes ?? "").trim();
  const bring = (ev.whatToBring ?? [])
    .map((w) => (typeof w === "string" ? w : w?.item))
    .filter(Boolean);
  const parts = [];
  if (notes) parts.push(notes);
  if (bring.length) parts.push(`${FAMILIOS_BLOCK_DELIM}\nBring: ${bring.join(", ")}`);
  return parts.join("\n\n");
}

/** Remove the composed FamiliOS block from a Google description, leaving the
 * user's own notes text. Pure inverse of composeGoogleDescription's framing. */
export function stripFamiliosBlock(description) {
  const s = String(description ?? "");
  const i = s.indexOf(FAMILIOS_BLOCK_DELIM);
  return (i === -1 ? s : s.slice(0, i)).replace(/\s+$/, "");
}

/* ---- Google time forms (WP-003 / ISS-005) ----
 * All-day events (ev.allDay) push in Google's `date` form (end date EXCLUSIVE per
 * the Google Calendar contract); timed events keep `dateTime`. startAt/endAt stay
 * local-midnight ISO timestamps in the FamiliOS store. Pure + unit-testable. */
const pad2 = (n) => String(n).padStart(2, "0");
const localDateOf = (v) => { const d = v instanceof Date ? v : new Date(v); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

export function googleEventTimes(ev) {
  if (ev.allDay && ev.startAt) {
    const endInc = new Date(ev.endAt ?? ev.startAt);
    const endExc = new Date(endInc.getFullYear(), endInc.getMonth(), endInc.getDate() + 1);
    return { start: { date: localDateOf(ev.startAt) }, end: { date: localDateOf(endExc) } };
  }
  const end = ev.endAt ?? new Date(new Date(ev.startAt).getTime() + 3_600_000).toISOString();
  return { start: { dateTime: ev.startAt }, end: { dateTime: end } };
}

/* ---- Push half of two-way sync (shared executor) ----
 * One real Google write used by: the approval-gated push route, the auto-sync
 * PATCH hook (local edit → Google), the server sweep, and meal planning. Sends
 * the FULL event body — title, times, location, and `notes` as the Google
 * `description` (recipe links, ingredients, instructions, mini-app context). */
export async function pushEventToGoogle({ ev, householdId, actorId }) {
  if (!ev || !ev.startAt) return { ok: false, error: "no_start" };
  if (ev.layer && ev.layer !== "canonical") return { ok: false, error: "not_pushable" };
  // Prefer the account this event was originally pushed with (stable pairing even
  // when a different family member edits); fall back to the actor's own account.
  let account = ev.provenance?.googleAccountId ? getAccountRaw(ev.provenance.googleAccountId) : null;
  if (!account || account.provider !== "google" || account.householdId !== householdId) {
    account = listAccountsFor(householdId, actorId).find((a) => a.provider === "google" && (a.scopes ?? []).some((s) => /calendar/i.test(String(s)))) ?? null;
  }
  if (!account) return { ok: false, error: "no_account" };
  const api = apiForAccount(account);
  const gid = ev.provenance?.googleEventId ?? null;
  const url = gid
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(gid)}`
    : "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const r = await api(url, {
    method: gid ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ summary: ev.title, description: composeGoogleDescription(ev), ...googleEventTimes(ev), location: ev.location ?? "" }),
  });
  if (!r.ok) return { ok: false, error: r.status === 401 ? "needs_reconnect" : "google_error", status: r.status, message: r.json?.error?.message ?? "Google rejected the write." };
  patchEvent(ev.id, { provenance: { ...(ev.provenance ?? {}), via: ev.provenance?.via ?? "user", googleEventId: r.json.id, googleAccountId: account.id, pushedAt: Date.now() } });
  return { ok: true, googleEventId: r.json.id, action: gid ? "updated" : "created" };
}

/** Resolve the Google account + event id behind a google-sourced LINKED event.
 * Prefers the provenance stamped at sync time; falls back to the subscription's
 * accountId + provenance.uid for events synced before two-way edits shipped. */
function linkedGoogleTarget(ev, householdId, actorId) {
  const p = ev?.provenance ?? {};
  const gid = p.googleEventId ?? p.uid ?? null;
  let account = p.googleAccountId ? getAccountRaw(p.googleAccountId) : null;
  if (!account && p.subscriptionId) {
    const sub = getSubscription(p.subscriptionId);
    if (sub?.source === "google" && sub.accountId) account = getAccountRaw(sub.accountId);
  }
  if (!gid || !account || account.provider !== "google" || account.householdId !== householdId) return null;
  if (!(account.scopes ?? []).some((s) => /calendar/i.test(String(s)))) return null;
  // Edit-own-only: a member may write back only to the Google account THEY connected —
  // never to another member's synced calendar. When actorId is omitted (internal/system
  // callers) the check is skipped and only household scope applies.
  if (actorId != null && account.connectedByActorId !== actorId) return null;
  return { account, gid };
}

/** True when a linked event originated in a connected Google Calendar and can be edited
 * two-way. With actorId, "editable" additionally means the current member owns that
 * Google account (they connected it). */
export function isEditableLinkedGoogle(ev, householdId, actorId) {
  return ev?.layer === "linked" && !!linkedGoogleTarget(ev, householdId, actorId);
}

/** Edit a google-originated linked event two-way: write to Google FIRST, and only
 * mirror the patch locally once Google accepted it — so the next subscription
 * re-sync (feed = source of truth) agrees instead of clobbering the local edit. */
export async function editLinkedGoogleEvent({ ev, patch, householdId, actorId }) {
  const target = linkedGoogleTarget(ev, householdId, actorId);
  if (!target) return { ok: false, error: "not_linked_google" };
  const merged = { ...ev, ...patch };
  const api = apiForAccount(target.account);
  const r = await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(target.gid)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ summary: merged.title, description: composeGoogleDescription(merged), ...googleEventTimes(merged), location: merged.location ?? "" }),
  });
  if (!r.ok) return { ok: false, error: r.status === 401 ? "needs_reconnect" : "google_error", status: r.status, message: r.json?.error?.message ?? "Google rejected the edit." };
  const updated = patchEvent(ev.id, { ...patch, provenance: { ...(ev.provenance ?? {}), googleEventId: target.gid, googleAccountId: target.account.id } });
  return { ok: true, event: updated };
}

/** Delete a google-originated linked event on Google, then remove the local mirror.
 * A 404/410 from Google (already gone there) still counts as success. */
export async function deleteLinkedGoogleEvent({ ev, householdId, actorId }) {
  const target = linkedGoogleTarget(ev, householdId, actorId);
  if (!target) return { ok: false, error: "not_linked_google" };
  const api = apiForAccount(target.account);
  const r = await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(target.gid)}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404 && r.status !== 410) {
    return { ok: false, error: r.status === 401 ? "needs_reconnect" : "google_error", status: r.status, message: r.json?.error?.message ?? "Google rejected the delete." };
  }
  deleteEventRec(ev.id);
  return { ok: true };
}

/** Best-effort Google-side delete of a CANONICAL event's pushed copy (meal cascade,
 * auto-sync deletes). Never throws; returns false when there's nothing to delete. */
export async function deleteGoogleCopy({ ev, householdId, actorId }) {
  const gid = ev?.provenance?.googleEventId;
  if (!gid) return { ok: false, error: "not_pushed" };
  let account = ev.provenance?.googleAccountId ? getAccountRaw(ev.provenance.googleAccountId) : null;
  if (!account || account.provider !== "google" || account.householdId !== householdId) {
    account = listAccountsFor(householdId, actorId).find((a) => a.provider === "google" && (a.scopes ?? []).some((s) => /calendar/i.test(String(s)))) ?? null;
  }
  if (!account) return { ok: false, error: "no_account" };
  try {
    const api = apiForAccount(account);
    const r = await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(gid)}`, { method: "DELETE" });
    return { ok: r.ok || r.status === 404 || r.status === 410 };
  } catch { return { ok: false, error: "google_error" }; }
}

/**
 * Server-triggered two-way sync pass for one household+actor pairing (used by the
 * background sweep when calendar auto-sync is enabled — no session, no approvals):
 *   1. pull Google-side edits into pushed events (conflicts still flag for review),
 *   2. push local edits that happened after the last push/merge back to Google.
 */
export async function autoSyncGoogle({ householdId, actorId }) {
  const pull = await pullGoogleEdits({ session: { householdId, actorId } });
  let pushed = 0, pushErrors = 0;
  const dirty = listEvents((e) => e.householdId === householdId
    && (e.layer ?? "canonical") === "canonical"
    && e.provenance?.googleEventId
    && !e.provenance?.conflict
    && Date.parse(e.updatedAt ?? 0) > Math.max(e.provenance?.pushedAt ?? 0, e.provenance?.lastMergeAt ?? 0) + 2000);
  for (const ev of dirty) {
    const r = await pushEventToGoogle({ ev, householdId, actorId });
    if (r.ok) pushed++; else pushErrors++;
  }
  return { ok: true, pull, pushed, pushErrors };
}

/** Remove every linked event belonging to a subscription (used when it's deleted). */
export function removeSubscriptionEvents(subId, session) {
  const hh = session.householdId;
  let removed = 0;
  for (const e of listEvents((x) => x.householdId === hh && x.layer === "linked" && x.provenance?.subscriptionId === subId)) {
    // Shared card: another subscription still shows this event — transfer
    // ownership to it instead of deleting the household's view of the event.
    const also = (e.provenance?.alsoSubscriptionIds ?? []).filter((x) => x !== subId);
    if (also.length > 0) {
      patchEvent(e.id, { provenance: { ...(e.provenance ?? {}), subscriptionId: also[0], alsoSubscriptionIds: also.slice(1) } });
    } else { deleteEventRec(e.id); removed++; }
  }
  // Detach this subscription's color from cards it was riding along on.
  for (const e of listEvents((x) => x.householdId === hh && x.layer === "linked" && (x.provenance?.alsoSubscriptionIds ?? []).includes(subId))) {
    patchEvent(e.id, { provenance: { ...(e.provenance ?? {}), alsoSubscriptionIds: e.provenance.alsoSubscriptionIds.filter((x) => x !== subId) } });
  }
  return removed;
}
