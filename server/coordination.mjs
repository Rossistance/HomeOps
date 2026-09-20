// FamiliOS — the ask that did not get answered, and what to do about it without nagging.
//
// The scenario this exists for: someone raises in the family chat that another member
// should book a medical visit. Famili offers to help. The person it concerns says no.
//
// Both obvious behaviours are wrong. Keep asking in the group and you have built a machine
// that embarrasses people in front of their family. Forget it entirely and a health task
// that the family surfaced on purpose quietly disappears. So the ask leaves the thread,
// waits, checks quietly, and if it still matters comes back ONCE, in private.
//
// ── Three rules the state machine exists to enforce ─────────────────────────────────────
//
// 1. TRANSCRIPT EVIDENCE MAY CLOSE A LOOP; IT MAY NEVER BE REPORTED AS COMPLETION.
//    Someone saying "all set, I called them" is reason enough to stop asking, and is not
//    reason to tell anyone it is done. Only a CALENDAR record, a fact the system owns, is
//    ever reported back to another person. This is the whole epistemics of the feature and
//    it is an invariant, not a preference.
//
// 2. THE AUDIT IS ASYMMETRIC, ON PURPOSE. Event search here is a substring over title and
//    location only; there is no full-text index. A permissive match silently drops a health
//    task, which is the exact failure this feature exists to prevent. A strict one produces
//    a redundant private nudge, which costs nothing. So closing quietly demands a STRONG
//    match and everything weaker leaves the loop open.
//
// 3. NOTHING GOES BACK TO THE GROUP WITHOUT THE TARGET SAYING SO. Not the nudge, not the
//    acceptance, not the confirmation. The person the task concerns decides whether the
//    person who raised it gets told.
import crypto from "node:crypto";
import {
  forEachTenant, appendAudit, getSettings, getMember, listEvents, canSeeEntity,
  listCoordinationLoops, getCoordinationLoop, putCoordinationLoop, patchCoordinationLoop,
  listContactMethods, getImessageChat,
} from "./store.mjs";
import { deliverNotification } from "./notify.mjs";
import { pushToMember } from "./notify.mjs";
import { householdTimeZone, localParts, wallClockToUtc } from "./household-time.mjs";
import { messagesBetween, speakToChat, chatByGuid } from "./group-chat.mjs";

const loopId = () => "cl_" + crypto.randomBytes(8).toString("hex");
const nowISO = () => new Date().toISOString();

/** How long before we look again, and how long before we give up entirely. */
export const FIRST_CHECK_MS = 24 * 3600_000;
export const HARD_EXPIRY_MS = 14 * 86400_000;
export const MAX_NUDGES = 1;           // once. A second private nudge is nagging in a smaller room.
export const DISMISS_COOLING_MS = 90 * 86400_000;
const WAKING_START_HOUR = 9;
const WAKING_END_HOUR = 20;

export const LOOP_STATUSES = Object.freeze([
  "watching", "nudged", "awaiting_relay_consent",
  "closed_resolved", "closed_dismissed", "closed_completed", "closed_expired",
]);

/**
 * Due time, on the HOUSEHOLD's clock and inside waking hours.
 *
 * A loop created at 11pm Friday and woken "in 24 hours" lands at 11pm Saturday, which is
 * nobody's idea of a helpful nudge. Computed through wallClockToUtc rather than by adding
 * milliseconds so a DST boundary does not shift it by an hour.
 */
export function nextCheckAt(householdId, fromMs, addMs = FIRST_CHECK_MS) {
  const tz = householdTimeZone(householdId);
  const target = fromMs + addMs;
  const p = localParts(target, tz);
  let { year, month, day, hour } = p;
  if (hour < WAKING_START_HOUR) hour = WAKING_START_HOUR;
  else if (hour >= WAKING_END_HOUR) {
    // Past bedtime: the next morning, which is the first moment it is welcome.
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
    year = nextDay.getUTCFullYear(); month = nextDay.getUTCMonth() + 1; day = nextDay.getUTCDate();
    hour = WAKING_START_HOUR;
  }
  return wallClockToUtc({ year, month, day, hour, minute: 0, second: 0 }, tz);
}

/** Keywords worth matching a calendar entry against, minus the words every sentence has. */
const STOP_WORDS = new Set(["the", "a", "an", "and", "or", "to", "for", "of", "in", "on", "at", "with", "my", "our", "your", "their", "his", "her", "book", "booked", "booking", "make", "get", "got", "need", "needs", "appointment", "appt"]);
export function keywordsFrom(text) {
  return [...new Set(String(text ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w)))].slice(0, 8);
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Did the calendar answer the question? Deliberately hard to satisfy.
 *
 * Requires an explicitly FINITE startAt — never withinRange, which returns true for both a
 * null stamp and an unparseable one, so an undated event would match every window ever
 * asked about. Requires the target to actually be on the event. And requires either an
 * exact normalised title match or two overlapping keywords: one shared word is a
 * coincidence, and a coincidence here silently drops a health task.
 */
export function calendarResolution(loop, nowMs) {
  const from = Date.parse(loop.createdAt ?? "");
  if (!Number.isFinite(from)) return null;
  const horizon = nowMs + 120 * 86400_000; // a booking can be months out and still be the answer
  const wanted = new Set(loop.intent?.keywords ?? []);
  const wantedTitle = norm(loop.intent?.text ?? "");
  const view = { role: "Owner", actorId: loop.targetActorId };

  const rows = listEvents((e) => e.householdId === loop.householdId && !e.deletedAt && e.status !== "cancelled");
  for (const e of rows) {
    const startMs = Date.parse(e.startAt ?? "");
    if (!Number.isFinite(startMs)) continue;               // undated cannot answer anything
    if (startMs < from || startMs > horizon) continue;
    const created = Date.parse(e.createdAt ?? "") || (typeof e.createdAt === "number" ? e.createdAt : NaN);
    if (Number.isFinite(created) && created < from) continue; // it was already there; it is not news
    const onIt = e.ownerId === loop.targetActorId
      || e.createdBy === loop.targetActorId
      || (Array.isArray(e.participantIds) && e.participantIds.includes(loop.targetActorId));
    if (!onIt) continue;
    if (!canSeeEntity(e, view)) continue;

    const hay = `${norm(e.title)} ${norm(e.location)}`;
    if (wantedTitle && norm(e.title) === wantedTitle) return e;
    let hits = 0;
    for (const w of wanted) if (hay.includes(w)) hits++;
    if (hits >= 2) return e;
  }
  return null;
}

/**
 * Did the conversation answer it? Cheap, textual, and it may ONLY close the loop.
 *
 * No model call: a later message from the TARGET containing a plain past-tense marker is
 * enough to stop asking, and is never enough to tell anyone it is done. Keeping this
 * deterministic also keeps it honest, because the thing it produces is silence.
 */
const RESOLVED_RE = /\b(all set|sorted|booked it|i booked|already booked|i called|called them|did it|done it|taken care of|handled it|i've got it|got it booked)\b/i;
export function transcriptResolution(loop, nowMs) {
  if (!loop.originChatGuid) return null;
  const days = Number(getSettings(loop.householdId).chatTranscriptDays ?? 0);
  if (!(days > 0)) return { unavailable: true }; // ephemeral transcript: say so rather than imply a check
  // A chat we cannot read is not a chat that said nothing. The sweep retires such a loop
  // before it ever gets here (loop_origin_gone), but a direct caller deserves the same
  // distinction the chatTranscriptDays === 0 case gets rather than a null that reads as
  // "checked, and nobody mentioned it".
  const chat = chatByGuid(loop.originChatGuid);
  if (!chat) return { unavailable: true };
  const since = Date.parse(loop.auditCursorAt ?? loop.createdAt ?? "");
  if (!Number.isFinite(since)) return null;
  for (const m of messagesBetween(chat, since, nowMs)) {
    if (m.fromMemberId !== loop.targetActorId) continue;
    if (RESOLVED_RE.test(m.text ?? "")) return m;
  }
  return null;
}

/* ───────────────── creating one ───────────────── */

/**
 * A refusal in the group becomes a quiet record and nothing else. Famili has already said
 * "no problem" and left the thread; this is what remains of the ask.
 */
export function openLoopFromRefusal({ chat, proposal, requestedByActorId, targetActorId, nowMs }) {
  const target = getMember(targetActorId);
  if (!target || target.archived) return { ok: false, error: "loop_target_gone" };
  // A dismissal is remembered by INTENT CLASS, not by instance: someone who said "stop
  // asking me about the dentist" should not be asked again next month by a new loop.
  const kw = keywordsFrom(proposal.title);
  const suppressed = listCoordinationLoops((l) =>
    l.targetActorId === targetActorId && l.status === "closed_dismissed"
    && Date.parse(l.updatedAt ?? "") > nowMs - DISMISS_COOLING_MS
    && (l.intent?.keywords ?? []).some((w) => kw.includes(w)));
  if (suppressed.length) return { ok: false, error: "loop_dismissed" };

  const rec = putCoordinationLoop({
    id: loopId(), householdId: chat.householdId,
    originChatGuid: chat.chatGuid, originProposalId: proposal.id,
    requestedByActorId: requestedByActorId ?? null, targetActorId,
    intent: { kind: proposal.kind === "event" ? "appointment" : "task", text: proposal.title, keywords: kw, personName: target.displayName ?? null },
    status: "watching",
    dueAt: new Date(nextCheckAt(chat.householdId, nowMs)).toISOString(),
    expiresAt: new Date(nowMs + HARD_EXPIRY_MS).toISOString(),
    lastEvaluatedAt: null, nudgeCount: 0, lastNudgeAt: null,
    auditCursorAt: new Date(nowMs).toISOString(),
    resolutionEvidence: null,
    createdAt: nowISO(), updatedAt: nowISO(),
  });
  appendAudit({ type: "coordination.opened", loopId: rec.id, householdId: chat.householdId, targetActorId });
  return { ok: true, loop: rec };
}

/* ───────────────── the sweep ───────────────── */

/**
 * Move every due loop forward, in the current tenant. Returns what it did.
 *
 * NEVER THROWS: one bad record must not stop the sweep for the rest. STAMPS BEFORE THE SIDE
 * EFFECT, so a restart mid-pass cannot nudge the same person twice. And WRITES NOTHING WHEN
 * NOTHING IS DUE, because the CI data-isolation gate boots a real server on server/.data,
 * hashes the directory, runs the suite beside it and requires it byte-identical afterwards.
 */
export async function sweepCoordinationLoops(nowMs = null) {
  const now = nowMs ?? Date.now();
  const out = { checked: 0, closed: 0, nudged: 0, skipped: 0 };
  let due;
  try {
    due = listCoordinationLoops((l) =>
      (l.status === "watching" || l.status === "nudged" || l.status === "awaiting_relay_consent")
      && Date.parse(l.dueAt ?? "") <= now);
  } catch { return out; }
  if (!due.length) return out;

  for (const loop of due) {
    try {
      out.checked++;
      const target = getMember(loop.targetActorId);

      // Retirements first: a loop whose person or whose thread is gone has nothing to ask.
      if (!target || target.archived) { close(loop, "closed_expired", { reason: "loop_target_gone" }, now); out.closed++; continue; }
      if (Date.parse(loop.expiresAt ?? "") <= now) { close(loop, "closed_expired", { reason: "loop_expired" }, now); out.closed++; continue; }
      if (loop.originChatGuid) {
        const chat = chatByGuid(loop.originChatGuid);
        if (!chat || chat.status === "revoked") { close(loop, "closed_expired", { reason: "loop_origin_gone" }, now); out.closed++; continue; }
      }

      if (loop.status === "awaiting_relay_consent") {
        // Asked, not answered. Silence is a no: nothing goes to the group.
        close(loop, "closed_completed", { reason: "relay_not_consented" }, now);
        out.closed++; continue;
      }

      if (loop.status === "nudged") {
        // Nudged once and heard nothing. Once is the limit; a second private nudge is
        // nagging in a smaller room.
        close(loop, "closed_expired", { reason: "no_answer" }, now);
        out.closed++; continue;
      }

      /* THE TWO-PHASE AUDIT. Calendar first because it is the only evidence that may later
       * be reported; transcript second because it may only close. */
      const ev = calendarResolution(loop, now);
      if (ev) {
        close(loop, "closed_resolved", { reason: "calendar", ref: ev.id }, now);
        appendAudit({ type: "coordination.resolved_silently", loopId: loop.id, householdId: loop.householdId, via: "calendar", eventId: ev.id });
        out.closed++; continue;
      }
      const tr = transcriptResolution(loop, now);
      if (tr && !tr.unavailable) {
        close(loop, "closed_resolved", { reason: "transcript", ref: tr.id }, now);
        appendAudit({ type: "coordination.resolved_silently", loopId: loop.id, householdId: loop.householdId, via: "transcript" });
        out.closed++; continue;
      }

      // Unresolved. Stamp BEFORE sending, so a restart mid-send cannot nudge twice.
      patchCoordinationLoop(loop.id, {
        status: "nudged", nudgeCount: (loop.nudgeCount ?? 0) + 1,
        lastNudgeAt: nowISO(), lastEvaluatedAt: nowISO(),
        dueAt: new Date(nextCheckAt(loop.householdId, now, 3 * 86400_000)).toISOString(),
        updatedAt: nowISO(),
        ...(tr?.unavailable ? { transcriptAuditUnavailable: true } : {}),
      });
      const sent = await nudgePrivately(loop, target);
      appendAudit({ type: "coordination.nudged", loopId: loop.id, householdId: loop.householdId, targetActorId: loop.targetActorId, delivered: !!sent.ok, error: sent.ok ? undefined : sent.error });
      if (sent.ok) out.nudged++; else out.skipped++;
    } catch (e) {
      appendAudit({ type: "coordination.sweep_failed", loopId: loop.id, householdId: loop.householdId, error: String(e?.message ?? e).slice(0, 200) });
      out.skipped++;
    }
  }
  return out;
}

function close(loop, status, evidence, nowMs) {
  patchCoordinationLoop(loop.id, {
    status, lastEvaluatedAt: nowISO(),
    resolutionEvidence: evidence?.ref ? { kind: evidence.reason, ref: evidence.ref, at: nowISO() } : null,
    closedReason: evidence?.reason ?? null,
    dueAt: null, updatedAt: nowISO(),
  });
}

/**
 * The private ask. Through deliverNotification, NOT the bridge directly, so the whole
 * consent chain runs first: method_not_found, method_not_verified, method_not_opted_in,
 * agent_not_allowed, member_archived, and then the household kill switch. A message about
 * someone's health, sent because a third party raised it, is precisely the message that
 * must not slip past a consent gate.
 */
async function nudgePrivately(loop, target) {
  const asker = loop.requestedByActorId ? getMember(loop.requestedByActorId)?.displayName : null;
  const body = asker
    ? `Hi — ${asker} mentioned ${loop.intent.text}. It hasn't landed on the calendar yet. Want me to help sort it out? Reply YES or NO.`
    : `Hi — ${loop.intent.text} hasn't landed on the calendar yet. Want me to help sort it out? Reply YES or NO.`;

  const method = listContactMethods((m) => m.memberId === target.actorId && m.type === "Phone/Text" && m.verified === true && m.optInStatus === "Opted In")[0];
  // In-app always; it is durable and needs no consent because it never leaves the house.
  void pushToMember({ householdId: loop.householdId, actorId: target.actorId, title: "A quick one", body, data: { type: "coordination", id: loop.id } });
  if (!method) return { ok: false, error: "no_verified_method" };
  const session = { actorId: target.actorId, householdId: loop.householdId, role: target.role };
  const r = await deliverNotification({ session, methodId: method.id, title: "A quick one", body });
  return r?.ok ? { ok: true } : { ok: false, error: r?.error ?? "send_failed" };
}

/* ───────────────── answering a nudge ───────────────── */

/** The open loop this member is being asked about, if any. */
export function openLoopForMember(actorId) {
  return listCoordinationLoops((l) => l.targetActorId === actorId && (l.status === "nudged" || l.status === "awaiting_relay_consent"))
    .sort((a, b) => String(b.lastNudgeAt ?? "").localeCompare(String(a.lastNudgeAt ?? "")))[0] ?? null;
}

const YES_RE = /^(y|ya|yes|yeah|yep|yup|sure|ok|okay|please|please do|do it|go ahead)[.!]?$/i;
const NO_RE = /^(n|no|nope|nah|no thanks|not now|leave it)[.!]?$/i;
const STOP_RE = /^(stop|stop asking|don'?t ask|drop it|forget it|never mind|nevermind)[.!]?$/i;

/**
 * A member's 1:1 reply, when a loop is waiting on them. Returns a reply to send, or null
 * to let the ordinary assistant path have the message.
 */
export async function answerLoopReply({ actorId, text, nowMs }) {
  const loop = openLoopForMember(actorId);
  if (!loop) return null;
  const t = String(text ?? "").trim();
  if (!t || t.length > 40) return null;

  if (STOP_RE.test(t)) {
    patchCoordinationLoop(loop.id, { status: "closed_dismissed", closedReason: "loop_dismissed", dueAt: null, updatedAt: nowISO() });
    appendAudit({ type: "coordination.dismissed", loopId: loop.id, householdId: loop.householdId });
    return "Understood — I won't bring this up again.";
  }

  if (loop.status === "awaiting_relay_consent") {
    const asker = loop.requestedByActorId ? getMember(loop.requestedByActorId)?.displayName ?? "them" : "them";
    if (YES_RE.test(t)) {
      /* THE RESULT OF THE SEND DECIDES WHAT WE CLAIM. speakToChat refuses BY VALUE, not by
       * throwing: chat_helper_misconfigured, speak_not_authorized, speak_budget_exhausted
       * and send_failed all come back as {ok:false}. Discarding that and closing as
       * "relayed" anyway told this person "Told Alex" when the thread had heard nothing,
       * wrote a coordination.relayed audit row for a message that did not exist, and left
       * nothing downstream able to tell a real relay from a failed one.
       *
       * It is the opposite of the failure the rest of this module guards. Rule 3 is that
       * nothing reaches the group without consent; this was consent given and nothing
       * reaching the group, reported as though it had. The person who said yes is the one
       * who needs to know it did not land, because they are the only one who can tell the
       * other person themselves. */
      const chat = loop.originChatGuid ? chatByGuid(loop.originChatGuid) : null;
      const relayed = chat && chat.status === "bound"
        ? await speakToChat({ chat, householdId: loop.householdId, text: `${getMember(loop.targetActorId)?.displayName ?? "That"} is sorted — ${loop.intent.text} is handled.`, kind: "relay", atMs: nowMs }).catch((e) => ({ ok: false, error: "send_failed", message: String(e?.message ?? e) }))
        : { ok: false, error: "loop_origin_gone", message: "That chat isn't there any more." };

      if (!relayed.ok) {
        patchCoordinationLoop(loop.id, { status: "closed_completed", closedReason: "relay_failed", dueAt: null, updatedAt: nowISO() });
        appendAudit({ type: "coordination.relay_failed", loopId: loop.id, householdId: loop.householdId, error: relayed.error });
        return `I couldn't get a message into the family chat, so ${asker} hasn't been told.`;
      }
      patchCoordinationLoop(loop.id, { status: "closed_completed", closedReason: "relayed", dueAt: null, updatedAt: nowISO() });
      appendAudit({ type: "coordination.relayed", loopId: loop.id, householdId: loop.householdId });
      return `Told ${asker}.`;
    }
    if (NO_RE.test(t)) {
      patchCoordinationLoop(loop.id, { status: "closed_completed", closedReason: "relay_not_consented", dueAt: null, updatedAt: nowISO() });
      return "Kept between us.";
    }
    return null;
  }

  if (NO_RE.test(t)) {
    patchCoordinationLoop(loop.id, { status: "closed_dismissed", closedReason: "declined", dueAt: null, updatedAt: nowISO() });
    return "No problem.";
  }
  if (YES_RE.test(t)) {
    /* Accepted. The doing of it is the ordinary assistant's job from here — this is the
     * hand-off, not a second execution path. What this DOES own is the consent question
     * that comes next, because the group must not learn anything until the person says so. */
    const asker = loop.requestedByActorId ? getMember(loop.requestedByActorId)?.displayName ?? null : null;
    patchCoordinationLoop(loop.id, {
      status: asker ? "awaiting_relay_consent" : "closed_completed",
      closedReason: asker ? null : "completed",
      dueAt: asker ? new Date(nowMs + 3 * 86400_000).toISOString() : null,
      updatedAt: nowISO(),
    });
    appendAudit({ type: "coordination.accepted", loopId: loop.id, householdId: loop.householdId });
    return asker
      ? `Good — tell me what you need and I'll sort it. Want me to let ${asker} know in the family chat when it's done?`
      : "Good — tell me what you need and I'll sort it.";
  }
  return null;
}

/** Per-tenant entry point for the interval ladder. */
export async function sweepCoordinationLoopsAllTenants(nowMs = null) {
  await forEachTenant(async () => { await sweepCoordinationLoops(nowMs); });
}
