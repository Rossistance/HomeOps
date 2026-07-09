// Calendar subscription sync: turn a calendar source — a Google Calendar (OAuth), an .ics
// feed URL, or pasted .ics — into FamiliOS' read-only "linked" calendar-layer events. The
// source is the source of truth: re-syncing updates matched events (by UID) and drops ones
// that left it. These events are layer:"linked", so the events PATCH route refuses edits
// (copy-to-edit). Only the READ direction is implemented (Google → FamiliOS); pushing FamiliOS
// events into Google is a separate, approval-gated build.
import crypto from "node:crypto";
import { safeFetch } from "./net.mjs";
import { parseICS, expandRecurring } from "./ics.mjs";
import { listEvents, putEvent, patchEvent, deleteEventRec, getAccountRaw } from "./store.mjs";
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

// Resolve the connected Google account this subscription reads from (the actor's own).
function resolveGoogleAccount(sub, session) {
  const mine = listAccountsFor(session.householdId, session.actorId).filter((a) => a.provider === "google");
  return (sub?.accountId ? mine.find((a) => a.id === sub.accountId) : mine[0]) ?? null;
}

/**
 * Sync a subscription's events from its source (google | url | pasted ics).
 * Returns { ok, imported, updated, removed, total } | { ok:false, error }.
 */
export async function syncSubscription({ sub, icsText, session }) {
  let parsed;
  if (sub?.source === "google") {
    // Pull upcoming events from the actor's connected Google Calendar (next ~90 days).
    const account = resolveGoogleAccount(sub, session);
    if (!account) return { ok: false, error: "no_account" };
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
  const hh = session.householdId;
  const subId = sub?.id ?? null;
  // Existing linked events for this subscription, keyed by their source UID.
  const existing = new Map(
    listEvents((e) => e.householdId === hh && e.layer === "linked" && e.provenance?.subscriptionId === subId && e.provenance?.uid)
      .map((e) => [e.provenance.uid, e]),
  );
  let imported = 0, updated = 0;
  for (const ev of parsed) {
    if (!ev.startAt) continue;
    const uid = ev.uid || crypto.createHash("sha1").update(`${ev.title}|${ev.startAt}`).digest("hex");
    const fields = { title: ev.title, startAt: ev.startAt, endAt: ev.endAt, location: ev.location, allDay: ev.allDay };
    const prior = existing.get(uid);
    if (prior) { patchEvent(prior.id, fields); existing.delete(uid); updated++; }
    else {
      putEvent({
        id: "ev_" + crypto.randomBytes(8).toString("hex"), householdId: hh,
        ...fields, endAt: ev.endAt ?? null, spaceId: "sp-family", participantIds: [], driverId: null,
        ownerId: null, backupOwnerId: null, whatToBring: [], checklist: [], travel: null, reminders: [],
        attachments: [], comments: [], mealImpact: null, visibility: "household", category: "Calendar",
        layer: "linked", status: "confirmed", source: sub?.name ?? "Subscribed calendar",
        provenance: { via: "ics", subscriptionId: subId, uid },
        createdBy: session.actorId, createdAt: Date.now(), updatedAt: new Date().toISOString(),
      });
      imported++;
    }
  }
  // Anything that disappeared from the feed is removed (feed = source of truth).
  let removed = 0;
  for (const stale of existing.values()) { deleteEventRec(stale.id); removed++; }
  return { ok: true, imported, updated, removed, total: parsed.length };
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
  const fields = {
    title: gev.summary ?? "(untitled)",
    startAt: gev.start?.dateTime ?? gev.start?.date ?? null,
    endAt: gev.end?.dateTime ?? gev.end?.date ?? null,
    location: gev.location ?? "",
    // Event body: Google `description` ↔ FamiliOS `notes`. Both directions carry the
    // full context text (recipe links, ingredient lists, mini-app references).
    notes: gev.description ?? "",
  };
  const differs = fields.title !== ev.title
    || String(fields.startAt ?? "") !== String(ev.startAt ?? "")
    || String(fields.endAt ?? "") !== String(ev.endAt ?? "")
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
  const end = ev.endAt ?? new Date(new Date(ev.startAt).getTime() + 3_600_000).toISOString();
  const url = gid
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(gid)}`
    : "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const r = await api(url, {
    method: gid ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ summary: ev.title, description: ev.notes ?? "", start: { dateTime: ev.startAt }, end: { dateTime: end }, location: ev.location ?? "" }),
  });
  if (!r.ok) return { ok: false, error: r.status === 401 ? "needs_reconnect" : "google_error", status: r.status, message: r.json?.error?.message ?? "Google rejected the write." };
  patchEvent(ev.id, { provenance: { ...(ev.provenance ?? {}), via: ev.provenance?.via ?? "user", googleEventId: r.json.id, googleAccountId: account.id, pushedAt: Date.now() } });
  return { ok: true, googleEventId: r.json.id, action: gid ? "updated" : "created" };
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
    deleteEventRec(e.id); removed++;
  }
  return removed;
}
