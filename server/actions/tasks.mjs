// Tasks, declared once. The second surface on the action registry (ADR-003).
//
// Same shape as events.mjs: one run behind POST /api/tasks and homeops.create_task, and
// the door decides only `ctx.via`. The two copies had drifted the usual way — the tool
// refused a bad priority, an unknown assignee and a reminder with nothing to count back
// from, while the route accepted all three; the route resolved a nest and took a start/end
// and several reminder leads, while the tool knew none of that. Now both do all of it.
//
// A list item (type "list") is a task too, and homeops.create_list_item still writes one
// by hand — it is next on the ladder, not in this slice.
import { putTask, normalizeVisibility } from "../store.mjs";
import { resolveVisibility } from "../nests.mjs";
import { isValidReminder, isValidReminderList } from "../reminders.mjs";
import { roleAtLeast } from "../auth.mjs";
import { defineAction } from "./define-action.mjs";
import { badStamp, unknownMember, ghostMessage } from "./shared.mjs";
import { TASK_RECORD, newTaskRecord } from "./schemas/task.mjs";
import { kickCalendarRefresh } from "../calendar-refresh.mjs";

const err = (error, message) => ({ ok: false, error, message });
const str = { type: "string" };
const strOrNull = { type: ["string", "null"] };

export const createTask = defineAction({
  id: "homeops.create_task",
  name: "Create a task",
  description: "Create a household task, chore, bill or errand. dueAt (or a startAt/endAt window) is ISO 8601 or YYYY-MM-DD. assignedMemberId must be a member id from the roster (famili__list_members). A reminder only fires once the task has a dueAt or startAt to count back from, so set one when you set a reminder.",
  action: "Write",
  risk: "Low",
  requiresApproval: false,
  delivers: false,
  input: {
    type: "object",
    properties: {
      title: { ...str, description: "Short human title." },
      type: { ...str, description: "Kind of task: task, chore, bill, errand… Default task." },
      status: { ...str, description: "Default todo." },
      dueAt: { ...strOrNull, description: "Due date-time, ISO 8601 with the household's UTC offset (or YYYY-MM-DD)." },
      startAt: { ...strOrNull, description: "Start of a scheduled window, ISO 8601." },
      endAt: { ...strOrNull, description: "End of a scheduled window, ISO 8601." },
      assignedMemberId: { ...strOrNull, description: "A member id from the household roster (famili__list_members)." },
      priority: { type: "string", enum: ["low", "medium", "high"], description: "Default medium." },
      amount: { type: ["number", "null"], description: "For bills." },
      visibility: { type: "string", enum: ["household", "private", "personal", "adults", "nest", "childVisible"], description: "Who can see it. Default household. nest needs nestId." },
      nestId: { ...strOrNull, description: "The nest, when visibility is nest." },
      listName: { ...str, description: "For a list item: which list (Groceries, Shopping, Packing…)." },
      notes: { ...str, description: "Free-form notes." },
      remindMinutesBefore: { type: ["number", "null"], description: "Reminder lead in minutes before the task's time: 0 (at the time), 5, 10, 15, 30, 60 or 1440 (the day before). Fires once the task has a dueAt or startAt to count back from. This is what actually sends a push — priority alone does not." },
      remindOffsets: { type: "array", items: { type: "number" }, description: "Several reminder leads at once, from the same offered list." },
      spaceId: str,
      agentId: { ...strOrNull, description: "The helper creating it, when one is." },
    },
    required: ["title"],
    additionalProperties: false,
  },
  output: { type: "object", properties: { task: { $ref: "#/$defs/TaskRecord" } }, required: ["task"], additionalProperties: false },
  $defs: { TaskRecord: TASK_RECORD },
  errorCodes: ["invalid_input", "empty_title", "invalid_dueAt", "invalid_startAt", "invalid_endAt", "unknown_member", "not_in_nest", "bad_reminder"],
  errors: { not_in_nest: 403 },
  http: {
    method: "POST", path: "/api/tasks",
    audit: (result) => ({ type: "task.create", taskId: result.task.id, ok: true }),
  },
  authorize: (session) => (roleAtLeast(session?.role, "Limited Member") ? null : { status: 403, error: "insufficient_role" }),

  async run(ctx, input) {
    const via = ctx?.via === "user" ? "user" : "agent";
    const title = String(input.title ?? "").trim();
    if (!title) return err("empty_title", "A task needs a title.");
    // H2: a task has a start and an end like a calendar item. An unparseable stamp is
    // refused here rather than stored and rendered as "Invalid Date".
    for (const k of ["dueAt", "startAt", "endAt"]) {
      if (badStamp(input[k])) return err(`invalid_${k}`, `${k} isn't a valid date/time — use ISO 8601 or YYYY-MM-DD.`);
    }
    { const ghost = unknownMember(input.assignedMemberId); if (ghost) return err("unknown_member", ghostMessage(ghost)); }
    // Was: a nest you're not in silently became "private", so the task existed but not
    // where you put it. Refusing says so.
    const vis = resolveVisibility(input.visibility, input.nestId, ctx);
    if (!vis) return err("not_in_nest", "You can only put this in a nest you're part of.");

    /* Reminders. The sweep (reminders.mjs) reads remindOffsets; remindMinutesBefore stays
     * for older readers as the first lead. A lead the app does not offer is refused rather
     * than stored as a nudge that never fires.
     *
     * A reminder WITHOUT a date is allowed, on purpose. The tool used to refuse it
     * ("reminder_needs_time") while the route accepted it — and the route was right: the
     * task sheet lets a person pick the nudge before the day, the sweep only counts back
     * once there is a time to count from, and re-dating re-arms it. One rule for both
     * doors, and it is the one the family already lives with. */
    const single = input.remindMinutesBefore == null ? null : Number(input.remindMinutesBefore);
    if (single !== null && !isValidReminder(single)) return err("bad_reminder", "Pick a reminder lead the app offers: 0 (at the time), 5, 10, 15, 30, 60 or 1440 minutes.");
    if (input.remindOffsets !== undefined && !isValidReminderList(input.remindOffsets)) return err("bad_reminder", "Pick reminder times from the offered list.");
    const remindOffsets = input.remindOffsets !== undefined ? [...new Set(input.remindOffsets)] : single === null ? [] : [single];
    const remindMinutesBefore = single ?? remindOffsets[0] ?? null;

    // Only what this door KNOWS; newTaskRecord fills every structural default for every
    // writer, so the record has one author of its shape.
    const rec = putTask(newTaskRecord({
      title, type: input.type ?? "task", status: input.status ?? "todo",
      dueAt: input.dueAt ?? null, startAt: input.startAt ?? null, endAt: input.endAt ?? null,
      assignedMemberId: input.assignedMemberId ?? null, spaceId: input.spaceId ?? "sp-family",
      priority: input.priority ?? "medium", amount: input.amount ?? null,
      visibility: normalizeVisibility(vis.visibility), nestId: vis.nestId,
      ...(input.listName ? { listName: input.listName } : {}),
      notes: typeof input.notes === "string" ? input.notes : "",
      remindMinutesBefore, remindOffsets,
      source: via === "agent" ? "agent" : "user",
      ...(via === "agent" ? { createdByAgentId: input.agentId ?? ctx.agentId ?? null } : {}),
    }, ctx));
    // In the one run (POST /api/tasks and homeops.create_task alike; a list item comes through
    // here too): refresh the household's calendars after the write succeeded.
    kickCalendarRefresh(ctx.householdId, "task.create");
    return { ok: true, result: { task: rec } };
  },
});

/* A list item IS a task — type "list", on a named list, low priority, no date — and for a
 * long time it was written by a second hand-rolled tool that spelled out its own idea of
 * the record. Declared now, on the same run as create_task: the model keeps the contract
 * it knows ("put milk on the grocery list" → text + listName), and the record comes from
 * the one place that decides what a task looks like. No HTTP door of its own: a list item
 * over HTTP is POST /api/tasks with type "list", which is the same run. */
export const createListItem = defineAction({
  id: "homeops.create_list_item",
  name: "Add a list item",
  description: "Add one item to a household list — Groceries, Shopping, Packing… A list item is a lightweight task of type list, so it shows up wherever tasks do. Check the list first (famili__list_tasks) so the same item is not added twice.",
  action: "Write",
  risk: "Low",
  requiresApproval: false,
  delivers: false,
  input: {
    type: "object",
    properties: {
      text: { ...str, description: "The item, as the family would write it on the list: Milk, AA batteries, sunscreen." },
      listName: { ...str, description: "Which list (Groceries, Shopping, Packing…). Default Shopping." },
      visibility: { type: "string", enum: ["household", "private", "personal", "adults", "nest", "childVisible"], description: "Who can see it. Default household. nest needs nestId." },
      nestId: { ...strOrNull, description: "The nest, when visibility is nest." },
      spaceId: str,
    },
    required: ["text"],
    additionalProperties: false,
  },
  output: { type: "object", properties: { task: { $ref: "#/$defs/TaskRecord" } }, required: ["task"], additionalProperties: false },
  $defs: { TaskRecord: TASK_RECORD },
  errorCodes: [...createTask.errorCodes],

  async run(ctx, input) {
    return createTask.run(ctx, {
      title: input.text, type: "list", listName: input.listName ?? "Shopping", priority: "low",
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.nestId !== undefined ? { nestId: input.nestId } : {}),
      ...(input.spaceId !== undefined ? { spaceId: input.spaceId } : {}),
    });
  },
});
