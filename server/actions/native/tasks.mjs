// The native task WRITES (ADR-004 Stage 1): famili.update_task and famili.delete_task.
//
// Same visibility and ownership rules as the HTTP routes in index.mjs, mirrored here so chat
// can never do more than the app. The bodies are the ones that lived inline in
// assistant-agent.mjs nativeTools(), moved unchanged.
import { getTask, patchTask, deleteTaskRec, getMember, isAdultRole, appendAudit } from "../../store.mjs";
import { isValidReminder, isValidReminderList } from "../../reminders.mjs";
import { defineAction } from "../define-action.mjs";
import { badStamp } from "../shared.mjs";
import { KEY_HINTS, publicTask, readOnly, nativeScope, always, PROJECTION } from "./shared.mjs";

const NATIVE = { requiresApproval: false, delivers: false, lane: "native", timeoutMs: 60_000, available: always };

export const familiUpdateTask = defineAction({
  id: "famili.update_task",
  name: "Change or complete a task",
  description: "Update a task or list item: mark done (status \"done\") or reopen (\"todo\"), rename, change due date, assignee, priority, notes, or list. Look the task up first.",
  action: "Write", risk: "Low", ...NATIVE,
  input: { type: "object", properties: { taskId: KEY_HINTS.taskId, title: KEY_HINTS.title, status: { type: "string", enum: ["todo", "in_progress", "done"] }, dueAt: KEY_HINTS.dueAt, assignedMemberId: KEY_HINTS.assignedMemberId, priority: KEY_HINTS.priority, notes: KEY_HINTS.notes, listName: KEY_HINTS.listName, remindMinutesBefore: KEY_HINTS.remindMinutesBefore }, required: ["taskId"], additionalProperties: false },
  output: { type: "object", properties: { task: PROJECTION }, required: ["task"], additionalProperties: false },
  errorCodes: ["invalid_input", "read_only_profile", "task_not_found", "forbidden", "bad_timestamp", "bad_priority", "unknown_member", "bad_reminder"],
  async run(ctx, input) {
    const { session, hh, seeable, canWrite } = nativeScope(ctx);
    if (!canWrite) return readOnly();
    const tk = getTask(String(input?.taskId ?? ""));
    if (!tk || tk.householdId !== hh) return { ok: false, error: "task_not_found", message: "No such task — list tasks to find the right id." };
    if (!seeable(tk)) return { ok: false, error: "forbidden", message: "That task isn't visible to this person." };
    const { taskId, ...patch } = input ?? {};
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
    const onlyStatus = Object.keys(patch).every((k) => k === "status");
    const mayEdit = isAdultRole(session.role) || tk.createdBy === session.actorId || (onlyStatus && tk.assignedMemberId === session.actorId);
    if (!mayEdit) return { ok: false, error: "forbidden", message: "Only an adult, the person who created it, or (to complete it) the person it's assigned to can change this task." };
    if (badStamp(patch.dueAt)) return { ok: false, error: "bad_timestamp", message: "dueAt isn't a valid date and time." };
    // The schema's enum is only as good as the provider's schema support; the handler checks too.
    if ("priority" in patch && !["low", "medium", "high"].includes(patch.priority)) return { ok: false, error: "bad_priority", message: "priority must be low, medium or high." };
    if ("assignedMemberId" in patch && patch.assignedMemberId != null && patch.assignedMemberId !== "") {
      const m = getMember(String(patch.assignedMemberId));
      if (!m || m.archived) return { ok: false, error: "unknown_member", message: `No household member has the id "${patch.assignedMemberId}" — list members to find the right one.` };
    }
    if ("remindMinutesBefore" in patch && !isValidReminder(patch.remindMinutesBefore)) return { ok: false, error: "bad_reminder", message: "Pick a reminder lead the app offers (e.g. 15, 30, 60, 1440 minutes)." };
    if ("remindMinutesBefore" in patch && !isValidReminderList([patch.remindMinutesBefore])) return { ok: false, error: "bad_reminder", message: "That reminder lead isn't supported." };
    const timingChanged = ["dueAt", "remindMinutesBefore"].some((k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(tk[k]));
    if (timingChanged) { patch.reminderSentAt = null; patch.remindersSent = []; }
    if (patch.status === "done" && tk.status !== "done") patch.completedAt = new Date().toISOString();
    if (patch.status && patch.status !== "done" && (tk.status === "done" || tk.status === "archived")) patch.completedAt = null;
    patch.updatedAt = new Date().toISOString();
    const updated = patchTask(tk.id, patch);
    appendAudit({ type: "task.update", taskId: tk.id, fields: Object.keys(patch), via: "assistant", householdId: hh, actorId: session.actorId });
    return { ok: true, result: { task: publicTask(hh, updated) } };
  },
});

export const familiDeleteTask = defineAction({
  id: "famili.delete_task",
  name: "Delete a task or list item",
  description: "Remove a task or list item for good. Prefer marking it done unless the family asked to delete it.",
  action: "Write", risk: "Medium", ...NATIVE,
  input: { type: "object", properties: { taskId: KEY_HINTS.taskId }, required: ["taskId"], additionalProperties: false },
  output: {
    type: "object",
    properties: { deleted: { type: "boolean" }, title: { type: "string" } },
    required: ["deleted", "title"], additionalProperties: false,
  },
  errorCodes: ["invalid_input", "read_only_profile", "task_not_found", "forbidden"],
  async run(ctx, input) {
    const { session, hh, channel, seeable, canWrite } = nativeScope(ctx);
    if (!canWrite) return readOnly();
    const tk = getTask(String(input?.taskId ?? ""));
    // In the group thread a task the channel may not show is a missing one, word for word
    // (see famili.delete_event). Elsewhere unchanged. (ADR-004 decision C.)
    if (!tk || tk.householdId !== hh || (channel === "group" && !seeable(tk))) return { ok: false, error: "task_not_found", message: "No such task." };
    if (!isAdultRole(session.role) && tk.createdBy !== session.actorId) return { ok: false, error: "forbidden", message: "Only an adult or the person who created it can delete this." };
    deleteTaskRec(tk.id);
    appendAudit({ type: "task.delete", taskId: tk.id, via: "assistant", householdId: hh, actorId: session.actorId });
    return { ok: true, result: { deleted: true, title: tk.title } };
  },
});
