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
import { putEvent, normalizeVisibility } from "../store.mjs";
import { resolveVisibility } from "../nests.mjs";
import { householdTimeZone, localMidnightISO } from "../household-time.mjs";
import { isValidReminderList } from "../reminders.mjs";
import { roleAtLeast } from "../auth.mjs";
import { defineAction } from "./define-action.mjs";
import { badStamp, DATE_ONLY_RE, unknownMember, ghostMessage } from "./shared.mjs";
import { EVENT_RECORD, newEventRecord } from "./schemas/event.mjs";

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
    }, ctx));
    return { ok: true, result: { event: rec } };
  },
});
