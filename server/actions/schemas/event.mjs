// The calendar event RECORD — what the store holds and what GET /api/events returns.
//
// Declared once, here, because it was declared nowhere: seven putEvent sites each wrote
// their own ~20 fields, and the two clients each guessed at the result (web lacked
// appendable/myNotes/remindOffsets, which GET really returns; mobile lacked spaceId and
// cast around it). This is the union of every writer's fields, every patchEvent addition,
// and the per-viewer decorations GET adds. The contract test in server/test asserts every
// stored event fits it, so a new field written anywhere has to be declared here or CI says
// so. Both clients' event types are generated from it — see scripts/generate-action-types.mjs.
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
    whatToBring: { type: "array", items: { type: "object", properties: { item: str, memberId: strOrNull }, required: ["item"], additionalProperties: true } },
    checklist: { type: "array", items: { type: "object", properties: { text: str, done: bool }, required: ["text"], additionalProperties: true } },
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
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    remindOffsets: { type: "array", items: num, description: "Reminder leads in minutes before the start." },
    remindersSent: anyList,
    attendees: { type: "array", items: { type: "object", properties: { memberId: str, status: { type: "string", enum: ["invited", "accepted", "declined"] }, respondedAt: strOrNull }, required: ["memberId", "status"], additionalProperties: true } },
    requests: {
      type: "object",
      properties: {
        attend: { type: "array", items: { type: "object", properties: { actorId: str, at: str }, required: ["actorId"], additionalProperties: true } },
        drive: { type: "array", items: { type: "object", properties: { actorId: str, at: str }, required: ["actorId"], additionalProperties: true } },
        bring: { type: "array", items: { type: "object", properties: { actorId: str, item: str, at: str }, required: ["actorId"], additionalProperties: true } },
      },
      additionalProperties: false,
    },
    localNotes: str,
    mealId: str,
    taskId: str,
    createdBy: str,
    createdAt: { ...num, description: "Epoch milliseconds." },
    updatedAt: { ...str, description: "ISO 8601." },
    /* Per-viewer, added by GET /api/events — never stored. */
    editable: { ...bool, description: "May the CURRENT viewer edit this event?" },
    appendable: { ...bool, description: "May the viewer keep a private note on it? (Anyone who can see it.)" },
    myNotes: { ...VIEWER_NOTE, description: "The viewer's own private margin, or null." },
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
