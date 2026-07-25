// Task reminders that actually arrive on a phone.
//
// H5, from the 2026-07-25 walkthrough at [22:19]: "I need reminders — 15 minutes before,
// 30 minutes before — and it should actually produce a notification."
//
// The distinction that matters: this is a SERVER-side reminder, not a locally-scheduled one.
// A task you assign to someone else has to reach THEIR phone, and a reminder scheduled on
// your device can only ever reach yours. So the sweep runs per household on the same tick as
// the other sweeps, resolves the assignee (falling back to whoever created it — an unassigned
// task is still somebody's), and pushes to that member's registered devices.
//
// Fired exactly once per task: `reminderSentAt` is stamped BEFORE the send, so a slow push or
// a restart mid-sweep can't produce the same nudge twice. A reminder that failed to send is a
// smaller harm than one that arrives four times.
import { listTasks, patchTask, getMember } from "./store.mjs";
import { pushToMember } from "./notify.mjs";

/** The minute-offsets a family can choose. "None" is null, not 0 — 0 means "at the time". */
export const REMINDER_CHOICES = [
  { minutes: 0, label: "At the time" },
  { minutes: 15, label: "15 minutes before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 24 * 60, label: "1 day before" },
];

export function isValidReminder(v) {
  return v === null || REMINDER_CHOICES.some((c) => c.minutes === v);
}

/** The moment a task's reminder should fire, or null when it can't have one. */
export function reminderAt(task) {
  const mins = task?.remindMinutesBefore;
  if (mins == null || !Number.isFinite(mins)) return null;
  // A task's time is its start when it has one, otherwise when it's due. Reminding someone
  // 15 minutes before a deadline they were meant to have already met is the wrong end.
  const anchor = task.startAt || task.dueAt;
  if (!anchor) return null;
  const t = Date.parse(anchor);
  if (Number.isNaN(t)) return null;
  return t - mins * 60_000;
}

function reminderText(task) {
  const anchor = task.startAt || task.dueAt;
  const when = anchor ? new Date(anchor) : null;
  const mins = task.remindMinutesBefore;
  const lead = mins === 0 ? "now"
    : mins === 24 * 60 ? "tomorrow"
    : mins >= 60 ? `in ${Math.round(mins / 60)} hour${mins >= 120 ? "s" : ""}`
    : `in ${mins} minutes`;
  const at = when && !Number.isNaN(+when)
    ? when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : null;
  return `${lead}${at ? ` — ${at}` : ""}`;
}

/**
 * Send every reminder that has come due in the CURRENT tenant. Call inside forEachTenant.
 * Returns what it did so the caller can audit it; never throws — one household's bad record
 * must not stop the sweep for anyone else.
 */
export async function sweepTaskReminders(now = Date.now()) {
  const out = { checked: 0, sent: 0, skipped: 0 };
  let due;
  try {
    due = listTasks((t) => t.status !== "done" && t.remindMinutesBefore != null && !t.reminderSentAt);
  } catch { return out; }
  for (const task of due) {
    out.checked++;
    const at = reminderAt(task);
    if (at == null) continue;
    if (at > now) continue;
    // More than a day late means the app (or the server) was down through the window. Firing
    // it now would be noise about something already past, so it's retired quietly instead.
    const stale = now - at > 24 * 60 * 60 * 1000;
    try {
      patchTask(task.id, { reminderSentAt: new Date().toISOString() });   // stamp FIRST — see above
      if (stale) { out.skipped++; continue; }
      const actorId = task.assignedMemberId || task.createdBy;
      if (!actorId) { out.skipped++; continue; }
      const who = getMember(actorId);
      const r = await pushToMember({
        householdId: task.householdId,
        actorId,
        title: task.title,
        body: `Due ${reminderText(task)}${who && task.assignedMemberId ? "" : ""}`,
        data: { type: "task", id: task.id },
      });
      if (r?.ok) out.sent++; else out.skipped++;
    } catch { out.skipped++; }
  }
  return out;
}
