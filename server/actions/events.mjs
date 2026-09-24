// Calendar events, declared once. The first surface on the action registry (ADR-003).
//
// ONE run for two doors. The HTTP route and the agent tool used to be separate copies with
// different checks: the route stored a participant who did not exist and an end before its
// start without a word, while the tool never resolved a nest or accepted reminders. Now the
// door decides only two things — `ctx.via` is "user" (the app) or "agent" (chat, helpers,
// runs) — and everything else is the same code. From an agent the event lands as a DRAFT the
// family reviews (review-first is a fact about agent writes, so it belongs here, not in a
// route); from a person it is confirmed.
//
// The id `homeops.create_event_draft` is kept on purpose: it is in stored per-agent
// allow-lists, in the prompt, and in run-engine tests. The name says what it now does.
import { putEvent, patchEvent, normalizeVisibility, getEvent, getMember, isAdultRole, canSeeEntity } from "../store.mjs";
import { privacyContext, eventOwnerOf, presentEvent } from "../event-privacy.mjs";
import { resolveVisibility } from "../nests.mjs";
import { householdTimeZone, localMidnightISO } from "../household-time.mjs";
import { isValidReminderList } from "../reminders.mjs";
import { roleAtLeast } from "../auth.mjs";
import { defineAction } from "./define-action.mjs";
import { badStamp, DATE_ONLY_RE, unknownMember, ghostMessage } from "./shared.mjs";
import { EVENT_RECORD, newEventRecord } from "./schemas/event.mjs";
import { kickCalendarRefresh } from "../calendar-refresh.mjs";

const err = (error, message) => ({ ok: false, error, message });
const str = { type: "string" };
const strOrNull = { type: ["string", "null"] };

export const createEvent = defineAction({
  id: "homeops.create_event_draft",
  name: "Create a family event",
  description: "Create a family calendar event. From chat it lands as a draft the family reviews on the calendar; from the app it is confirmed. Give startAt as YYYY-MM-DD for an all-day event. participantIds and driverId must be member ids from the household roster (famili__list_members).",
  action: "Write",
  risk: "Low",
  requiresApproval: false,
  delivers: false,
  input: {
    type: "object",
    properties: {
      title: { ...str, description: "Short human title." },
      startAt: { ...strOrNull, description: "Start date-time, ISO 8601 with the household's UTC offset, e.g. 2026-09-14T17:00:00-04:00. For an all-day item use the date only (YYYY-MM-DD)." },
      endAt: { ...strOrNull, description: "End date-time, same format as startAt. Omit if unknown." },
      allDay: { type: "boolean", description: "true for an all-day event. A date-only startAt implies it." },
      location: str,
      notes: { ...str, description: "Free-form notes." },
      participantIds: { type: "array", items: str, description: "Member ids from the household roster." },
      driverId: { ...strOrNull, description: "A member id from the household roster." },
      ownerId: { ...strOrNull, description: "Whose event it is. Defaults to the person creating it." },
      backupOwnerId: strOrNull,
      visibility: { type: "string", enum: ["household", "private", "personal", "adults", "nest", "childVisible"], description: "Who can see it. Default household. nest needs nestId." },
      nestId: { ...strOrNull, description: "The nest, when visibility is nest." },
      remindOffsets: { type: "array", items: { type: "number" }, description: "Reminder leads in minutes before the start, from the app's offered list (0, 5, 10, 15, 30, 60, 1440)." },
      whatToBring: { type: "array", items: {}, description: "What to bring: plain strings, or { item, memberId }." },
      checklist: { type: "array", items: { type: "object", properties: { text: str, done: { type: "boolean" } }, required: ["text"], additionalProperties: false } },
      spaceId: str,
      category: str,
      travel: {},
      mealImpact: {},
      hidden: { type: "boolean", description: "true hides it from everyone but its owner, who must be the adult creating it (others see \"<Name> busy\"). Ignored otherwise." },
      secret: { type: "boolean", description: "The owner's Keep-it-a-surprise switch. Same rule as hidden." },
    },
    required: ["title"],
    additionalProperties: false,
  },
  output: { type: "object", properties: { event: { $ref: "#/$defs/EventRecord" } }, required: ["event"], additionalProperties: false },
  $defs: { EventRecord: EVENT_RECORD },
  errorCodes: ["invalid_input", "empty_title", "invalid_startAt", "invalid_endAt", "unknown_member", "not_in_nest", "bad_reminder", "end_before_start"],
  errors: { not_in_nest: 403 },
  http: {
    method: "POST", path: "/api/events",
    audit: (result) => ({ type: "event.create", eventId: result.event.id, ok: true }),
  },
  authorize: (session) => (roleAtLeast(session?.role, "Limited Member") ? null : { status: 403, error: "insufficient_role" }),

  async run(ctx, input) {
    const via = ctx?.via === "user" ? "user" : "agent";
    const title = String(input.title ?? "").trim();
    if (!title) return err("empty_title", "An event needs a title.");
    if (badStamp(input.startAt)) return err("invalid_startAt", "startAt isn't a valid date/time — use ISO 8601 (e.g. 2026-09-14T17:00:00-04:00) or YYYY-MM-DD for an all-day event.");
    if (badStamp(input.endAt)) return err("invalid_endAt", "endAt isn't a valid date/time.");
    const participantIds = (input.participantIds ?? []).map(String);
    for (const id of participantIds) { const ghost = unknownMember(id); if (ghost) return err("unknown_member", ghostMessage(ghost)); }
    { const ghost = unknownMember(input.driverId); if (ghost) return err("unknown_member", ghostMessage(ghost)); }
    // Events reach nests the same way tasks and knowledge do. A raw visibility:"nest" with
    // no nestId used to make the event invisible to everyone but its owner.
    const vis = resolveVisibility(input.visibility, input.nestId, ctx);
    if (!vis) return err("not_in_nest", "You can only put this in a nest you're part of.");
    // Calendar reminders (Cluster N): the same offsets tasks offer, validated the same way.
    if (input.remindOffsets !== undefined && !isValidReminderList(input.remindOffsets)) return err("bad_reminder", "Pick reminder times from the offered list.");

    const tz = householdTimeZone(ctx.householdId);
    // A date-only start means "that whole day" — an all-day event anchored to the
    // household's midnight, never the server's (which is how a US family's all-day
    // events began the evening before).
    const dateOnly = DATE_ONLY_RE.test(String(input.startAt ?? ""));
    const allDay = input.allDay === true || dateOnly;
    const startAt = dateOnly ? localMidnightISO(input.startAt, tz) : (input.startAt ?? null);
    const rawEnd = input.endAt ? (DATE_ONLY_RE.test(String(input.endAt)) ? localMidnightISO(input.endAt, tz) : input.endAt) : null;
    // An end BEFORE the start used to be dropped to null without a word; the model then
    // told the family the event ran 3–5 when it had no end at all. (Equal is still
    // treated as "no end" — a same-day all-day event arrives that way.)
    if (rawEnd && startAt && Date.parse(rawEnd) < Date.parse(startAt)) return err("end_before_start", "endAt is before startAt — give the end time after the start, or leave it out.");
    const endAt = rawEnd && startAt && Date.parse(rawEnd) > Date.parse(startAt) ? rawEnd : null;

    const whatToBring = (input.whatToBring ?? [])
      .map((w) => (typeof w === "string" ? { item: w, memberId: null } : w && typeof w === "object" && w.item ? { item: String(w.item), memberId: w.memberId ?? null } : null))
      .filter(Boolean);
    const checklist = (input.checklist ?? []).map((c) => ({ text: String(c.text), done: c.done === true }));

    /* Hiding (ADR-005) is the OWNER's choice, and only an adult's. Here that means: the
     * person creating it is an adult AND the event is theirs. Anything else — a child, a
     * Limited Member, an adult putting an event on someone else's calendar — is ignored,
     * never refused: the choice is not theirs to make, and an old client that never sends
     * the field must go on creating events exactly as before. The role is read from the
     * roster, not ctx, because the agent door's ctx does not always carry one. */
    const ownerId = input.ownerId ?? ctx.actorId;
    const mayHide = ownerId === ctx.actorId && isAdultRole(getMember(ctx.actorId)?.role ?? ctx.role);
    const privacyFields = mayHide
      ? { ...(input.hidden === true ? { shareState: "hidden" } : {}), ...(typeof input.secret === "boolean" ? { secret: input.secret } : {}) }
      : {};

    // Only what this door KNOWS; newEventRecord fills every structural default for every
    // writer, so the record has one author of its shape.
    const rec = putEvent(newEventRecord({
      title, startAt, endAt, allDay,
      notes: typeof input.notes === "string" ? input.notes : "",
      location: input.location ?? "", spaceId: input.spaceId ?? "sp-family",
      participantIds,
      driverId: input.driverId ?? null, ownerId: input.ownerId ?? ctx.actorId, backupOwnerId: input.backupOwnerId ?? null,
      whatToBring, checklist, travel: input.travel ?? null, mealImpact: input.mealImpact ?? null,
      ...(input.remindOffsets !== undefined ? { remindOffsets: [...new Set(input.remindOffsets)] } : {}),
      visibility: normalizeVisibility(vis.visibility), nestId: vis.nestId, category: input.category ?? "Family",
      status: via === "agent" ? "draft" : "confirmed",
      source: via === "agent" ? "FamiliOS Assistant" : "FamiliOS",
      provenance: { via, actorId: ctx.actorId, ...(ctx.runId ? { runId: ctx.runId } : {}) },
      ...privacyFields,
    }, ctx));
    // Here, in the one run, so the app's POST /api/events and the assistant's tool both
    // refresh the household's calendars — after the write, and only once it succeeded.
    kickCalendarRefresh(ctx.householdId, "event.create");
    return { ok: true, result: { event: rec } };
  },
});

/* The eye toggle (ADR-005): the owner hides or shares ONE event, and says whether it is a
 * surprise. This is the one door to shareState and secret — the generic PATCH strips both —
 * so "only the owner, only an adult" is checked in exactly one place.
 *
 * A body route (POST /api/events/sharing, id in the body) because the declared-action door
 * matches whole paths and has no path parameters. HTTP-only for now: letting the assistant
 * flip it by voice is a later follow-up, and until then the model is not shown it. */
export const setEventSharing = defineAction({
  id: "homeops.set_event_sharing",
  name: "Hide or share an event",
  description: "The event's owner hides one of their events (others see \"<Name> busy\" or \"<Name> working\") or shares it in full, and may mark it a surprise.",
  action: "Write",
  risk: "Low",
  agent: false,
  input: {
    type: "object",
    properties: {
      id: { ...str, description: "The event id (ev_…)." },
      hidden: { type: "boolean", description: "true hides it from everyone but you; false shares it in full." },
      secret: { type: ["boolean", "null"], description: "Keep it a surprise: true or false sets it, null goes back to judging by the event's words." },
    },
    required: ["id", "hidden"],
    additionalProperties: false,
  },
  output: { type: "object", properties: { event: { $ref: "#/$defs/EventRecord" } }, required: ["event"], additionalProperties: false },
  $defs: { EventRecord: EVENT_RECORD },
  errorCodes: ["invalid_input", "not_found", "not_event_owner", "cannot_hide"],
  errors: { not_found: 404, not_event_owner: 403, cannot_hide: 403 },
  http: {
    method: "POST", path: "/api/events/sharing",
    audit: (result) => ({ type: "event.sharing", eventId: result.event.id, shareState: result.event.shareState ?? null, secret: result.event.secret ?? null, ok: true }),
  },

  async run(ctx, input) {
    const ev = getEvent(String(input.id));
    // A block id ("blk_…") is not an event and lands here too. Someone who cannot see the
    // event at all is told it does not exist — the same answer as a wrong id.
    const viewer = { role: ctx.role, actorId: ctx.actorId };
    if (!ev || ev.householdId !== ctx.householdId || !canSeeEntity(ev, viewer)) return err("not_found", "No such event.");
    const pc = privacyContext(ctx.householdId);
    // The event's OWNER (a synced event's calendar owner) — not the household Owner, not a
    // participant. Hiding someone else's time is not a thing anyone may do for them.
    if (eventOwnerOf(ev, pc) !== ctx.actorId) return err("not_event_owner", "Only the person whose event this is can hide or share it.");
    // HIDING needs an adult; SHARING does not — a hide made before a demotion is still honoured
    // (event-privacy.mjs), and its owner must be able to lift it, not be left with it.
    if (input.hidden && !isAdultRole(pc.membersById.get(ctx.actorId)?.role ?? ctx.role)) return err("cannot_hide", "Only adults can hide events.");
    // secret: null REMOVES the switch (an undefined value is not stored), so the event goes
    // back to being judged by its words; absent leaves it as it was.
    patchEvent(ev.id, { shareState: input.hidden ? "hidden" : "shared", ...(input.secret !== undefined ? { secret: input.secret ?? undefined } : {}) });
    const saved = getEvent(ev.id);
    // As the owner sees it: in full, with the privacy decoration that drives the eye.
    return { ok: true, result: { event: presentEvent(saved, viewer, { purpose: "app", pc }) } };
  },
});
