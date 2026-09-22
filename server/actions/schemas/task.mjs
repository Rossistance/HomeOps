// The task RECORD — what the store holds and what GET /api/tasks returns.
//
// Tasks, chores, bills, errands AND list items (groceries, packing: type "list" with a
// listName) are one collection. Six writers put them there — POST /api/tasks, the create
// tool, the list-item tool, plan_meal's groceries, the meals add-groceries route, a message
// suggestion — and the route and the tools never wrote the same keys: a list item has no
// dueAt, no assignee, no amount. So most of this record is OPTIONAL, and that is the truth
// about the data, not a hedge: records written before this file exist too and are read by
// the same clients. The required set is exactly what every writer has always set.
import { eid, nowISO } from "../shared.mjs";
import { validateInput } from "../define-action.mjs";

const str = { type: "string" };
const strOrNull = { type: ["string", "null"] };
const numOrNull = { type: ["number", "null"] };

export const TASK_RECORD = {
  type: "object",
  properties: {
    id: { ...str, description: "Starts with tk_ (task) or li_ (list item)." },
    householdId: str,
    title: str,
    type: { ...str, description: "task, chore, bill, errand… or list for a list item." },
    status: { ...str, description: "todo, done, archived…" },
    dueAt: strOrNull,
    startAt: strOrNull,
    endAt: strOrNull,
    assignedMemberId: strOrNull,
    spaceId: str,
    priority: { type: "string", enum: ["low", "medium", "high"] },
    amount: { ...numOrNull, description: "For bills." },
    visibility: str,
    nestId: strOrNull,
    listName: { ...str, description: "Which list, for type list (Groceries, Shopping, Packing…)." },
    notes: str,
    remindMinutesBefore: { ...numOrNull, description: "The first reminder lead; remindOffsets is the whole plan." },
    remindOffsets: { type: "array", items: { type: "number" }, description: "Reminder leads in minutes before the time; the sweep reads this." },
    remindersSent: { type: "array", items: { type: "number" } },
    reminderSentAt: strOrNull,
    completedAt: strOrNull,
    eventId: { ...strOrNull, description: "Set once the task has been put on the calendar." },
    mealId: { ...strOrNull, description: "For a grocery item, the meal it is for." },
    source: str,
    createdBy: str,
    createdByAgentId: strOrNull,
    createdAt: { ...str, description: "ISO 8601." },
    updatedAt: { ...str, description: "ISO 8601." },
  },
  required: ["id", "householdId", "title", "type", "status", "spaceId", "priority", "visibility", "source", "createdBy", "createdAt", "updatedAt"],
  additionalProperties: false,
};

/* ───────────────────────── one writer of the defaults ─────────────────────────
 *
 * The task-side twin of newEventRecord (schemas/event.mjs). Five writers built task records
 * by hand — the action, the list-item tool, plan_meal's groceries, the meals route's
 * groceries, a message suggestion — and a list item had no dueAt, no assignee, no reminder
 * plan, while a typed task had all three as nulls and empties. The schema above stays
 * mostly optional because rows written BEFORE this exist and the same clients read them;
 * but every row written from now on has the same structural keys, because there is one
 * place that decides them.
 *
 * `source` is required — it is the task's "how it got here" (user, agent, assistant, meal,
 * message_suggestion). The id says what it is: li_ for a list item, tk_ for anything else;
 * the HTTP route used to hand list items tk_ ids and the tool li_ ids, and nothing keys on
 * the prefix, so the honest one wins. */
const HELPER_OWNED = Object.freeze(["id", "householdId", "createdBy", "createdAt", "updatedAt", "remindersSent", "reminderSentAt", "completedAt"]);
const KNOWN = new Set(Object.keys(TASK_RECORD.properties));

/**
 * @param fields  what the writer knows; `title` and `source` are required
 * @param ctx     { householdId, actorId } — a session or a tool ctx both satisfy it
 */
export function newTaskRecord(fields, ctx) {
  if (!ctx?.householdId || !ctx?.actorId) throw new Error("newTaskRecord: ctx needs householdId and actorId");
  if (!fields || typeof fields !== "object") throw new Error("newTaskRecord: fields must be an object");
  for (const k of Object.keys(fields)) {
    if (fields[k] === undefined) continue;
    if (HELPER_OWNED.includes(k)) throw new Error(`newTaskRecord: "${k}" is decided here, not by the writer`);
    if (!KNOWN.has(k)) throw new Error(`newTaskRecord: "${k}" is not a field of TASK_RECORD — declare it in schemas/task.mjs or do not write it`);
  }
  if (typeof fields.source !== "string" || !fields.source) throw new Error("newTaskRecord: source is required — a task says how it got here");
  const type = fields.type ?? "task";
  const now = nowISO();
  const rec = {
    id: eid(type === "list" ? "li" : "tk"), householdId: ctx.householdId,
    title: String(fields.title ?? ""), type, status: fields.status ?? "todo",
    dueAt: fields.dueAt ?? null, startAt: fields.startAt ?? null, endAt: fields.endAt ?? null,
    assignedMemberId: fields.assignedMemberId ?? null, spaceId: fields.spaceId ?? "sp-family",
    priority: fields.priority ?? "medium", amount: fields.amount ?? null,
    visibility: fields.visibility ?? "household", nestId: fields.nestId ?? null,
    ...(fields.listName ? { listName: fields.listName } : {}),
    notes: typeof fields.notes === "string" ? fields.notes : "",
    remindMinutesBefore: fields.remindMinutesBefore ?? null, remindOffsets: fields.remindOffsets ?? [],
    remindersSent: [], reminderSentAt: null,
    ...(fields.eventId ? { eventId: fields.eventId } : {}), ...(fields.mealId ? { mealId: fields.mealId } : {}),
    source: fields.source, createdBy: ctx.actorId,
    ...(fields.createdByAgentId !== undefined ? { createdByAgentId: fields.createdByAgentId } : {}),
    createdAt: now, updatedAt: now,
  };
  const v = validateInput(TASK_RECORD, rec, { unknown: "reject" });
  if (!v.ok) throw new Error(`newTaskRecord: ${v.field} — ${v.message}`);
  return v.value;
}
