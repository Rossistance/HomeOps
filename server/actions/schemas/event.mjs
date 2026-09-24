// The calendar event RECORD — what the store holds and what GET /api/events returns.
//
// Declared once, here, because it was declared nowhere: seven putEvent sites each wrote
// their own ~20 fields, and the two clients each guessed at the result (web lacked
// appendable/myNotes/remindOffsets, which GET really returns; mobile lacked spaceId and
// cast around it). This is the union of every writer's fields, every patchEvent addition,
// and the per-viewer decorations GET adds. The contract test in server/test asserts every
// stored event fits it, so a new field written anywhere has to be declared here or CI says
// so. Both clients' event types are generated from it — see scripts/generate-action-types.mjs.
import { eid, nowISO } from "../shared.mjs";
import { validateInput } from "../define-action.mjs";

const str = { type: "string" };
const strOrNull = { type: ["string", "null"] };
const num = { type: "number" };
const bool = { type: "boolean" };
const anyList = { type: "array", items: {} };

/** A person's private margin on an event they can see — theirs alone (getViewerNote). */
const VIEWER_NOTE = {
  type: ["object", "null"],
  properties: { note: str, bring: { type: "array", items: { type: "object", properties: { item: str }, required: ["item"], additionalProperties: true } } },
  additionalProperties: true,
};

export const EVENT_RECORD = {
  type: "object",
  properties: {
    id: { ...str, description: "Starts with ev_." },
    householdId: str,
    title: str,
    startAt: { ...strOrNull, description: "ISO 8601, or null when the event has no date yet." },
    endAt: strOrNull,
    allDay: bool,
    location: str,
    notes: str,
    spaceId: str,
    participantIds: { type: "array", items: str, description: "Member ids on the household roster." },
    driverId: strOrNull,
    ownerId: strOrNull,
    backupOwnerId: strOrNull,
    /* Every writer sets memberId (null when unassigned) and done (false when new): the
     * clients rely on that, so the schema says so. Optional here would be the drift. */
    whatToBring: { type: "array", items: { type: "object", properties: { item: str, memberId: strOrNull }, required: ["item", "memberId"], additionalProperties: false } },
    checklist: { type: "array", items: { type: "object", properties: { text: str, done: bool }, required: ["text", "done"], additionalProperties: false } },
    travel: {},
    reminders: anyList,
    attachments: anyList,
    comments: anyList,
    mealImpact: {},
    visibility: str,
    nestId: strOrNull,
    category: str,
    layer: { type: "string", enum: ["canonical", "linked", "public"] },
    status: str,
    source: str,
    provenance: {
      type: "object",
      properties: {
        via: str, actorId: str, runId: strOrNull,
        googleEventId: strOrNull, googleAccountId: strOrNull, subscriptionId: strOrNull,
        alsoSubscriptionIds: { type: "array", items: str }, uid: str,
        pushedAt: strOrNull, lastMergeAt: strOrNull, lastGoogleUpdated: strOrNull, unlinkedAt: strOrNull,
        conflict: {
          type: ["object", "null"],
          properties: {
            at: num, googleUpdated: strOrNull,
            google: { type: "object", properties: { title: str, startAt: strOrNull, endAt: strOrNull, location: str }, additionalProperties: true },
          },
          required: ["at", "googleUpdated", "google"],
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    remindOffsets: { type: "array", items: num, description: "Reminder leads in minutes before the start." },
    remindersSent: anyList,
    attendees: { type: "array", items: { type: "object", properties: { memberId: str, status: { type: "string", enum: ["invited", "accepted", "declined"] }, respondedAt: strOrNull }, required: ["memberId", "status", "respondedAt"], additionalProperties: false } },
    requests: {
      type: "object",
      properties: {
        attend: { type: "array", items: { type: "object", properties: { actorId: str, at: str }, required: ["actorId", "at"], additionalProperties: false } },
        drive: { type: "array", items: { type: "object", properties: { actorId: str, at: str }, required: ["actorId", "at"], additionalProperties: false } },
        bring: { type: "array", items: { type: "object", properties: { actorId: str, item: str, at: str }, required: ["actorId", "at"], additionalProperties: false } },
      },
      additionalProperties: false,
    },
    localNotes: str,
    mealId: str,
    taskId: str,
    /* Hidden events (ADR-005). shareState is the OWNER's choice for this one event and wins
     * over the calendar default (a Work calendar hides; any other shows). secret is their
     * "Keep it a surprise" switch; absent means "judge by the words" (event-privacy.mjs). */
    shareState: { type: "string", enum: ["hidden", "shared"], description: "The owner hid or shared this event; absent = the calendar default." },
    secret: { ...bool, description: "The owner's Keep-it-a-surprise switch; absent = decided from the text." },
    createdBy: str,
    createdAt: { ...num, description: "Epoch milliseconds." },
    updatedAt: { ...str, description: "ISO 8601." },
    /* Per-viewer, added by GET /api/events — never stored. */
    editable: { ...bool, description: "May the CURRENT viewer edit this event?" },
    appendable: { ...bool, description: "May the viewer keep a private note on it? (Anyone who can see it.)" },
    myNotes: { ...VIEWER_NOTE, description: "The viewer's own private margin, or null." },
    privacy: {
      type: "object",
      properties: { obscured: bool, kind: { type: "string", enum: ["work", "busy"] }, secret: bool, canToggle: bool, withheld: bool },
      required: ["obscured"],
      additionalProperties: false,
      description: "Only on the OWNER's own events: is it hidden, why, and may they toggle it.",
    },
    block: {
      type: "object",
      properties: { kind: { type: "string", enum: ["work", "busy"] } },
      required: ["kind"],
      additionalProperties: false,
      description: "Present on a stand-in for someone else's hidden time: <Name> working, merged back-to-back.",
    },
    staleSource: {
      type: "object",
      properties: { accountId: str, status: str, provider: str, connectedByActorId: strOrNull },
      required: ["accountId", "status", "provider"],
      additionalProperties: false,
      description: "Present when the synced calendar this came from can no longer refresh.",
    },
  },
  required: [
    "id", "householdId", "title", "startAt", "endAt", "location", "spaceId", "participantIds", "driverId",
    "ownerId", "backupOwnerId", "whatToBring", "checklist", "travel", "reminders", "attachments", "comments",
    "mealImpact", "visibility", "category", "layer", "status", "source", "provenance", "createdBy", "createdAt", "updatedAt",
  ],
  additionalProperties: false,
};

/* ───────────────────────── one writer of the defaults ─────────────────────────
 *
 * Seven places used to build an event record by hand, each repeating ~20 fields, because
 * putEvent is a blind upsert: whatever object it is handed is what the store holds. That
 * is how a synced event came to lack `notes` while a typed one had it, and how the record
 * could be declared above and still have no single place that promised to honour it.
 *
 * Every writer now passes only what it KNOWS — a title, a time, who owns it, why it
 * exists — and this fills the rest, then checks the result against EVENT_RECORD with
 * unknown keys rejected and THROWS if it does not fit. A writer that invents a field, or
 * passes a number where the record says string, fails here, loudly, at the write — not in
 * a client's type months later. `putEvent` itself stays dumb on purpose. */
const HELPER_OWNED = Object.freeze(["id", "householdId", "createdBy", "createdAt", "updatedAt", "reminders", "attachments", "comments", "remindersSent"]);
const KNOWN = new Set(Object.keys(EVENT_RECORD.properties));

/**
 * @param fields  what the writer knows; `provenance.via` is required — a record says how it got here
 * @param ctx     { householdId, actorId } — a session or a tool ctx both satisfy it
 */
export function newEventRecord(fields, ctx) {
  if (!ctx?.householdId || !ctx?.actorId) throw new Error("newEventRecord: ctx needs householdId and actorId");
  if (!fields || typeof fields !== "object") throw new Error("newEventRecord: fields must be an object");
  for (const k of Object.keys(fields)) {
    if (fields[k] === undefined) continue;
    if (HELPER_OWNED.includes(k)) throw new Error(`newEventRecord: "${k}" is decided here, not by the writer`);
    if (!KNOWN.has(k)) throw new Error(`newEventRecord: "${k}" is not a field of EVENT_RECORD — declare it in schemas/event.mjs or do not write it`);
  }
  if (!fields.provenance?.via) throw new Error("newEventRecord: provenance.via is required — a record says how it got here");

  const rec = {
    id: eid("ev"), householdId: ctx.householdId,
    title: String(fields.title ?? ""),
    startAt: fields.startAt ?? null, endAt: fields.endAt ?? null, allDay: fields.allDay === true,
    notes: typeof fields.notes === "string" ? fields.notes : "",
    location: typeof fields.location === "string" ? fields.location : "",
    spaceId: fields.spaceId ?? "sp-family",
    participantIds: Array.isArray(fields.participantIds) ? fields.participantIds.map(String) : [],
    driverId: fields.driverId ?? null, ownerId: fields.ownerId ?? null, backupOwnerId: fields.backupOwnerId ?? null,
    whatToBring: fields.whatToBring ?? [], checklist: fields.checklist ?? [], travel: fields.travel ?? null,
    reminders: [], attachments: [], comments: [], mealImpact: fields.mealImpact ?? null,
    ...(fields.remindOffsets !== undefined ? { remindOffsets: fields.remindOffsets } : {}), remindersSent: [],
    visibility: fields.visibility ?? "household", nestId: fields.nestId ?? null,
    category: fields.category ?? "Family", layer: fields.layer ?? "canonical", status: fields.status ?? "confirmed",
    source: fields.source ?? "FamiliOS",
    ...(fields.mealId ? { mealId: fields.mealId } : {}), ...(fields.taskId ? { taskId: fields.taskId } : {}),
    // The owner's hide/surprise choice (ADR-005) — only when a writer states one; absent
    // means "the calendar default" and "judge by the words", so no default is written.
    ...(fields.shareState !== undefined ? { shareState: fields.shareState } : {}),
    ...(fields.secret !== undefined ? { secret: fields.secret } : {}),
    provenance: fields.provenance,
    createdBy: ctx.actorId, createdAt: Date.now(), updatedAt: nowISO(),
  };
  const v = validateInput(EVENT_RECORD, rec, { unknown: "reject" });
  if (!v.ok) throw new Error(`newEventRecord: ${v.field} — ${v.message}`);
  return v.value;
}
