// Hidden events and Work calendars (ADR-005) — the ONE place that decides what a viewer is
// shown of an event its owner has hidden.
//
// The household asked for two things that look alike and are not. A WORK calendar is about
// calm: the family wants the big picture ("Beannie's working 1–5") without twelve meeting
// titles they don't care about. A HIDDEN event is the same treatment chosen per event —
// and some hidden events are SURPRISES (a birthday, an anniversary, a gift, a vacation),
// where the person they are hidden from may be the person asking.
//
// So every surface that shows an event to someone — the calendar screens, the assistant's
// tools and briefing, previews, reminders, exports — asks this module, and nothing else,
// what that someone may read. Four answers:
//
//   full      the viewer owns the event (or it is not hidden) — the record as stored
//   block     anyone else, INCLUDING the household Owner — "<Name> working", the owner's
//             time, nothing more; back-to-back pieces of one person merge into one block
//   withheld  the owner asking the ASSISTANT about a SURPRISE where others may be listening
//             (a group thread, a Family chat) — the owner learns it exists, not what it is
//   (absent)  the viewer could not see the event at all (canSeeEntityInChannel), or a
//             Limited Member's Owner-set calendar scope leaves it out
//
// Only an adult (Owner, Adult Admin, Adult Member) can hide. A Work calendar's events are
// hidden until their owner shares one; any adult's own event can be hidden by hand.
// `shareState` on the event records the owner's choice and wins over the calendar default.
import crypto from "node:crypto";
import { listMembers, listSubscriptions, getSubscription, canSeeEntityInChannel, isAdultRole } from "./store.mjs";
import { newEventRecord } from "./actions/schemas/event.mjs";

export const SHARE_STATES = Object.freeze(["hidden", "shared"]);
/** Two hidden pieces of one person merge when the next starts within this of the last end. */
export const MERGE_GAP_MS = 15 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/* ───────────────────────────── surprise detection ─────────────────────────────
 *
 * Birthday, anniversary, gift, vacation, surprise — the owner's list. Word-boundary matches
 * so "presentation" and "gifted" are not presents. The owner's own "Keep it a surprise"
 * switch (event.secret) always wins: true covers "Dad's party", false un-flags a false hit. */
const SECRET_WORDS = /\b(?:birthdays?|b-?days?|anniversar(?:y|ies)|gifts?|vacations?|surprises?)\b/i;
const SECRET_EMOJI = /[\u{1F381}\u{1F382}]/u; // 🎁 🎂

/** Does the event's own text say it is a surprise-type event? (Ignores the owner's switch.) */
export function secretCategory(e) {
  if (!e) return false;
  if (e.provenance?.googleEventType === "birthday") return true;
  const text = [e.title, e.notes, e.location].filter((s) => typeof s === "string").join("\n");
  return SECRET_WORDS.test(text) || SECRET_EMOJI.test(text);
}
/** The effective surprise flag: the owner's switch when set, else the text. */
export function isSecret(e) {
  if (e?.secret === true) return true;
  if (e?.secret === false) return false;
  return secretCategory(e);
}

/* ───────────────────────────── ownership ───────────────────────────── */

/** Everything the decisions below need about a household, read once per request. */
export function privacyContext(householdId) {
  const subsById = new Map(listSubscriptions((s) => s.householdId === householdId).map((s) => [s.id, s]));
  const membersById = new Map(listMembers({ householdId }).map((m) => [m.actorId, m]));
  return { householdId, subsById, membersById };
}

function subscriptionOf(e, pc) {
  const id = e?.provenance?.subscriptionId;
  if (!id) return null;
  return pc?.subsById?.get(id) ?? getSubscription(id) ?? null;
}

/** Whose event this is: a synced event belongs to its calendar's owner; anything else to
 * ownerId, then createdBy. The ONE answer used for "only the owner sees through a hide". */
export function eventOwnerOf(e, pc) {
  if (!e) return null;
  if (e.layer === "linked") {
    const sub = subscriptionOf(e, pc);
    if (sub?.ownerActorId) return sub.ownerActorId;
  }
  return e.ownerId ?? e.createdBy ?? null;
}

/**
 * Is this event hidden, and how?
 * @returns {{ ownerId, owner, workCalendar, canHide, obscured, kind?, secret? }}
 *   kind: "work" for a Work calendar's events, "busy" for an event hidden by hand.
 */
export function obscureStateOf(e, pc) {
  const ownerId = eventOwnerOf(e, pc);
  const owner = ownerId ? (pc?.membersById?.get(ownerId) ?? null) : null;
  const sub = e?.layer === "linked" ? subscriptionOf(e, pc) : null;
  const workCalendar = sub?.isWork === true;
  // Hiding is an adult's choice. An owner who is not (or no longer) an adult cannot hide —
  // and a stored choice is not honoured for them either, so a demotion reveals rather than
  // leaving events hidden that nobody can un-hide.
  const canHide = !!owner && isAdultRole(owner.role);
  const base = { ownerId, owner, workCalendar, canHide };
  if (!canHide) return { ...base, obscured: false };
  const obscured = e?.shareState === "hidden" ? true : e?.shareState === "shared" ? false : workCalendar;
  if (!obscured) return { ...base, obscured: false };
  return { ...base, obscured: true, kind: workCalendar ? "work" : "busy", secret: isSecret(e) };
}

export function obscuredLabel(kind, owner) {
  const name = String(owner?.displayName ?? "").trim() || "Someone";
  return `${name} ${kind === "work" ? "working" : "busy"}`;
}

/* ───────────────────────────── Limited Member scope ─────────────────────────────
 *
 * The Owner may narrow what a Limited Member's calendar shows: per other member, "all",
 * "none", or { calendars: [subscriptionId | "app"] } ("app" = events made in FamiliOS).
 * member.calendarScope = null means everything they could see anyway (today's behaviour);
 * a member the scope does not mention is "all". Their own events and events they take part
 * in (participant, attendee, driver) are always shown — a scope must never hide the
 * appointment the teenager is driving to. */
export function calendarScopeAllows(e, viewer, pc) {
  if (viewer?.role !== "Limited Member") return true;
  const scope = pc?.membersById?.get(viewer.actorId)?.calendarScope;
  if (!scope || typeof scope !== "object" || !scope.members || typeof scope.members !== "object") return true;
  const ownerId = eventOwnerOf(e, pc);
  if (!ownerId || ownerId === viewer.actorId) return true;
  if ((e.participantIds ?? []).includes(viewer.actorId) || e.driverId === viewer.actorId
    || (e.attendees ?? []).some((a) => a?.memberId === viewer.actorId)) return true;
  const rule = Object.hasOwn(scope.members, ownerId) ? scope.members[ownerId] : "all";
  if (rule === "none") return false;
  if (rule && typeof rule === "object" && Array.isArray(rule.calendars)) {
    if (e.layer !== "linked") return rule.calendars.includes("app");
    const ids = [e.provenance?.subscriptionId, ...(e.provenance?.alsoSubscriptionIds ?? [])].filter(Boolean);
    return ids.some((id) => rule.calendars.includes(id));
  }
  return true; // "all", or anything unrecognised — never hide on a malformed rule
}

/**
 * Validate an Owner-submitted scope for `lm` (a Limited Member record).
 * Accepts null (clear) or { members: { [actorId]: "all" | "none" | { calendars: string[] } } }.
 * @returns {{ ok: true, value } | { ok: false, error, message }}
 */
export function normalizeCalendarScope(raw, lm, pc) {
  if (raw === null) return { ok: true, value: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !raw.members || typeof raw.members !== "object" || Array.isArray(raw.members)) {
    return { ok: false, error: "bad_scope", message: "Send { members: { <memberId>: \"all\" | \"none\" | { calendars: [...] } } } or null." };
  }
  const members = {};
  for (const [actorId, rule] of Object.entries(raw.members)) {
    const m = pc.membersById.get(actorId);
    if (!m || actorId === lm.actorId) return { ok: false, error: "bad_member", message: `No other household member ${actorId}.` };
    if (rule === "all" || rule === "none") { members[actorId] = rule; continue; }
    if (rule && typeof rule === "object" && Array.isArray(rule.calendars)) {
      const calendars = [];
      for (const id of rule.calendars) {
        if (id === "app") { calendars.push("app"); continue; }
        const sub = pc.subsById.get(String(id));
        if (!sub || sub.ownerActorId !== actorId) return { ok: false, error: "bad_calendar", message: `${String(id)} is not one of ${m.displayName}'s calendars.` };
        calendars.push(sub.id);
      }
      members[actorId] = { calendars: [...new Set(calendars)] };
      continue;
    }
    return { ok: false, error: "bad_scope", message: `The rule for ${m.displayName} must be "all", "none" or { calendars: [...] }.` };
  }
  return { ok: true, value: { members } };
}

/* ───────────────────────────── records ───────────────────────────── */

const BLOCK_FIELDS_STRIPPED = "title, notes, location, participants, attendees, driver, checklist, what to bring, requests, attachments";

/** Stable id for a block: the same hidden stretch keeps its id across fetches. */
function blockId(ownerId, kind, allDay, startAt, endAt) {
  return "blk_" + crypto.createHash("sha256").update([ownerId, kind, allDay ? 1 : 0, startAt ?? "", endAt ?? ""].join("|")).digest("hex").slice(0, 16);
}

/**
 * A record in the event contract (EVENT_RECORD) that says "<Name> working" over the given
 * span and nothing else. Built through newEventRecord so it fits the contract every client
 * is generated from — which is also why an older app build renders it as an ordinary,
 * read-only event with that title. createdBy is the OWNER (never the viewer), so no client
 * rule that treats createdBy as ownership can make a block editable.
 */
function blockRecord({ householdId, ownerId, owner, kind, allDay, startAt, endAt, count, updatedAt }) {
  const rec = newEventRecord({
    title: obscuredLabel(kind, owner), startAt, endAt: endAt ?? null, allDay,
    ownerId, participantIds: [], visibility: "household",
    category: kind === "work" ? "Work" : "Busy", layer: "canonical", status: "confirmed", source: "FamiliOS",
    provenance: { via: "privacy" },
  }, { householdId, actorId: ownerId ?? "unknown" });
  return {
    ...rec,
    id: blockId(ownerId, kind, allDay, startAt, endAt),
    createdAt: Date.parse(startAt ?? "") || 0,
    updatedAt: updatedAt ?? rec.updatedAt,
    editable: false, appendable: false, myNotes: null,
    block: { kind, count },
  };
}

/** The owner asking about their own surprise where others may be listening: it exists, at
 * this time, and that is all. Keeps its real id — it IS their event, and they may act on it. */
function withheldRecord(e, st) {
  return {
    ...e,
    title: "Private event", notes: "", location: "", participantIds: [], driverId: null,
    attendees: [], whatToBring: [], checklist: [], attachments: [], comments: [], requests: undefined,
    localNotes: undefined, travel: null, mealImpact: null,
    privacy: { obscured: true, kind: st.kind, secret: true, withheld: true, canToggle: false },
  };
}

/** Timed pieces: [start, end]; all-day pieces: whole household days, endAt = LAST day. */
function spanOf(p) {
  const s = Date.parse(p.startAt ?? "");
  if (Number.isNaN(s)) return null;
  const eRaw = p.endAt ? Date.parse(p.endAt) : NaN;
  const e = Number.isNaN(eRaw) ? s : Math.max(s, eRaw);
  return { s, e };
}

/**
 * Merge one person's hidden pieces into blocks. Timed and all-day never mix; kinds never
 * mix ("working" and "busy" say different things). Timed: next starts within MERGE_GAP_MS of
 * the current end. All-day: next starts on or before the day after the current last day
 * (25h tolerates a DST day).
 */
function mergeBlocks(pieces, pc) {
  const groups = new Map();
  for (const p of pieces) {
    const key = `${p.ownerId}|${p.kind}|${p.allDay ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const out = [];
  for (const list of groups.values()) {
    const timed = list.filter((p) => spanOf(p)).sort((a, b) => spanOf(a).s - spanOf(b).s);
    let cur = null;
    const flush = () => {
      if (!cur) return;
      const single = cur.count === 1;
      out.push(blockRecord({
        householdId: pc.householdId, ownerId: cur.ownerId, owner: pc.membersById.get(cur.ownerId), kind: cur.kind,
        allDay: cur.allDay, startAt: cur.startAt,
        endAt: single ? cur.endAt : (cur.e > cur.s ? new Date(cur.e).toISOString() : null),
        count: cur.count, updatedAt: cur.updatedAt,
      }));
      cur = null;
    };
    for (const p of timed) {
      const sp = spanOf(p);
      const tolerance = p.allDay ? DAY_MS + 60 * 60_000 : MERGE_GAP_MS;
      if (cur && sp.s <= cur.e + tolerance) {
        cur.e = Math.max(cur.e, sp.e); cur.count++;
        if ((p.updatedAt ?? "") > (cur.updatedAt ?? "")) cur.updatedAt = p.updatedAt;
        continue;
      }
      flush();
      cur = { ownerId: p.ownerId, kind: p.kind, allDay: p.allDay, startAt: p.startAt, endAt: p.endAt ?? null, s: sp.s, e: sp.e, count: 1, updatedAt: p.updatedAt };
    }
    flush();
    // A hidden piece with no usable start still says someone is busy — alone, undated.
    for (const p of list.filter((q) => !spanOf(q))) {
      out.push(blockRecord({ householdId: pc.householdId, ownerId: p.ownerId, owner: pc.membersById.get(p.ownerId), kind: p.kind, allDay: p.allDay, startAt: p.startAt ?? null, endAt: null, count: 1, updatedAt: p.updatedAt }));
    }
  }
  return out;
}

/* ───────────────────────────── the chokepoint ───────────────────────────── */

/**
 * What `viewer` may be shown of `events`.
 *
 * @param events  candidate events of ONE household (callers pass listEvents for it)
 * @param viewer  { actorId, role } — a session works
 * @param opts
 *   channel   "personal" | "group" — the existing channel gate (canSeeEntityInChannel)
 *   purpose   "app"       the viewer's own screen: owners see their hidden events in full
 *             "assistant" a tool the assistant called for this asker
 *             "snapshot"  the briefing put in the assistant's prompt before it asks anything
 *   audience  "self" | "shared" — for purpose "assistant": may a surprise be spoken here?
 *             "self" only when the conversation is the owner's alone (see ADR-005).
 *   ledger    optional object; set ledger.secretReleased = true when a surprise was handed
 *             over in full, so the turn records nothing to memory
 *   pc        optional privacyContext (built when absent)
 * @returns an array: full records (the owner's carry `privacy`), withheld records, and blocks.
 */
export function presentEvents(events, viewer, opts = {}) {
  const { channel = "personal", purpose = "app", audience = "shared", ledger = null } = opts;
  const list = (events ?? []).filter(Boolean);
  if (!list.length) return [];
  const pc = opts.pc ?? privacyContext(list[0].householdId);
  const out = [];
  const pieces = [];
  for (const e of list) {
    if (!canSeeEntityInChannel(e, viewer, channel)) continue;
    if (!calendarScopeAllows(e, viewer, pc)) continue;
    const st = obscureStateOf(e, pc);
    const mine = !!viewer?.actorId && st.ownerId === viewer.actorId;
    if (!st.obscured) {
      out.push(mine && st.canHide ? { ...e, privacy: { obscured: false, secret: isSecret(e), canToggle: true } } : e);
      continue;
    }
    if (!mine) {
      pieces.push({ ownerId: st.ownerId, kind: st.kind, allDay: e.allDay === true, startAt: e.startAt ?? null, endAt: e.endAt ?? null, updatedAt: e.updatedAt });
      continue;
    }
    const privacy = { obscured: true, kind: st.kind, secret: st.secret, canToggle: true };
    if (purpose === "app") { out.push({ ...e, privacy }); continue; }
    if (st.secret && (purpose === "snapshot" || audience !== "self")) { out.push(withheldRecord(e, st)); continue; }
    if (st.secret && ledger) ledger.secretReleased = true;
    out.push({ ...e, privacy });
  }
  return out.concat(mergeBlocks(pieces, pc));
}

/**
 * One event, one viewer (previews, cards, single lookups): the full event, a single-piece
 * block, or null when they may not see it. Surprise rules as presentEvents.
 */
export function presentEvent(e, viewer, opts = {}) {
  if (!e) return null;
  const r = presentEvents([e], viewer, opts);
  return r[0] ?? null;
}

/**
 * May `viewer` act on (edit, delete, RSVP to, request to join, add a checklist item to…)
 * this event? A hidden event is its owner's alone; everyone else is told whose it is and
 * that it is hidden — never what it is.
 * @returns null when allowed, else { status: 403, error: "event_hidden", message }
 */
export function hiddenEventRefusal(e, viewer, pc) {
  if (!e) return null;
  const ctx = pc ?? privacyContext(e.householdId);
  const st = obscureStateOf(e, ctx);
  if (!st.obscured || st.ownerId === viewer?.actorId) return null;
  const name = String(st.owner?.displayName ?? "").trim() || "its owner";
  return { status: 403, error: "event_hidden", message: `That's on ${name}'s calendar and hidden — only ${name} can change it.` };
}

export const _internals = { mergeBlocks, blockRecord, withheldRecord, SECRET_WORDS, BLOCK_FIELDS_STRIPPED };
