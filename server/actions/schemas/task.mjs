// The task RECORD — what the store holds and what GET /api/tasks returns.
//
// Tasks, chores, bills, errands AND list items (groceries, packing: type "list" with a
// listName) are one collection. Six writers put them there — POST /api/tasks, the create
// tool, the list-item tool, plan_meal's groceries, the meals add-groceries route, a message
// suggestion — and the route and the tools never wrote the same keys: a list item has no
// dueAt, no assignee, no amount. So most of this record is OPTIONAL, and that is the truth
// about the data, not a hedge: records written before this file exist too and are read by
// the same clients. The required set is exactly what every writer has always set.
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
