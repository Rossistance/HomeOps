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
import { listTasks, patchTask, getMember, listEvents, patchEvent } from "./store.mjs";
import { pushToMember } from "./notify.mjs";
import { householdTimeZone, formatInZone, stampToMs } from "./household-time.mjs";

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

/* Cluster N — "What if I want to be notified the day before AND one hour before? I can't
 * select both of them. I need to be able to select both — all of them if need be." An array
 * of offsets, each individually valid, deduped, capped at the menu's own size. */
export function isValidReminderList(v) {
  return Array.isArray(v) && v.length <= REMINDER_CHOICES.length && v.every((m) => REMINDER_CHOICES.some((c) => c.minutes === m));
}

/** Every offset a task wants, oldest schema included: a legacy single value is a one-item
 *  list, and a legacy reminderSentAt means that one offset already fired. */
export function taskReminderPlan(task) {
  const offsets = isValidReminderList(task?.remindOffsets) && task.remindOffsets.length > 0
    ? [...new Set(task.remindOffsets)]
    : task?.remindMinutesBefore != null ? [task.remindMinutesBefore] : [];
  const sent = new Set(Array.isArray(task?.remindersSent) ? task.remindersSent : []);
  if (task?.reminderSentAt && !Array.isArray(task?.remindersSent)) for (const m of offsets) sent.add(m);
  return { offsets, sent };
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

function reminderTextFor(task, mins) {
  const anchor = task.startAt || task.dueAt;
  const lead = mins === 0 ? "now"
    : mins === 24 * 60 ? "tomorrow"
    : mins >= 60 ? `in ${Math.round(mins / 60)} hour${mins >= 120 ? "s" : ""}`
    : `in ${mins} minutes`;
  // The time a person reads is on THEIR clock, not the server's ("10:00 PM" for a 6 PM
  // pickup was the server formatting in UTC).
  const tz = householdTimeZone(task.householdId);
  const ms = anchor ? stampToMs(anchor, tz) : NaN;
  const at = Number.isNaN(ms) ? null : formatInZone(new Date(ms).toISOString(), tz, { hour: "numeric", minute: "2-digit" });
  return `${lead}${at ? ` — ${at}` : ""}`;
}

/**
 * Send every reminder that has come due in the CURRENT tenant. Call inside forEachTenant.
 * Returns what it did so the caller can audit it; never throws — one household's bad record
 * must not stop the sweep for anyone else.
 */
export async function sweepTaskReminders(now = Date.now()) {
  const out = { checked: 0, sent: 0, skipped: 0 };
  let candidates;
  try {
    candidates = listTasks((t) => t.status !== "done" && t.status !== "archived" && (t.remindMinutesBefore != null || (Array.isArray(t.remindOffsets) && t.remindOffsets.length > 0)));
  } catch { return out; }
  for (const task of candidates) {
    const { offsets, sent } = taskReminderPlan(task);
    const anchor = task.startAt || task.dueAt;
    const anchorMs = anchor ? Date.parse(anchor) : NaN;
    if (Number.isNaN(anchorMs)) continue;
    for (const mins of offsets) {
      if (sent.has(mins)) continue;
      const at = anchorMs - mins * 60_000;
      if (at > now) continue;
      out.checked++;
      // More than a day late means the app (or the server) was down through the window.
      // Firing it now would be noise about something already past — retired quietly.
      const stale = now - at > 24 * 60 * 60 * 1000;
      try {
        sent.add(mins);
        // Stamp FIRST — a slow push or a restart mid-sweep must not nudge twice. The legacy
        // stamp rides along so an old reader still sees "this task reminded".
        patchTask(task.id, { remindersSent: [...sent], reminderSentAt: new Date().toISOString() });
        if (stale) { out.skipped++; continue; }
        const actorId = task.assignedMemberId || task.createdBy;
        if (!actorId) { out.skipped++; continue; }
        const r = await pushToMember({
          householdId: task.householdId,
          actorId,
          title: task.title,
          body: `Due ${reminderTextFor(task, mins)}`,
          data: { type: "task", id: task.id },
          // "The priority to get this notification needs to be on high." Reminders only.
          timeSensitive: true,
        });
        if (r?.ok) out.sent++; else out.skipped++;
      } catch { out.skipped++; }
    }
  }
  return out;
}

/* Cluster M — "after three days after being completed, they should drop into another
 * category down here called archived. That way the completed section will eventually
 * entirely empty." Done is a moment; archived is where done goes to rest. Tasks completed
 * before completedAt existed use their last update as the completion moment, so his 26-item
 * backlog drains on the same schedule instead of sitting exempt forever. */
export const ARCHIVE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
export function sweepTaskArchive(now = Date.now()) {
  const out = { archived: 0 };
  let doneTasks;
  try { doneTasks = listTasks((t) => t.status === "done"); } catch { return out; }
  for (const t of doneTasks) {
    const completedAt = Date.parse(t.completedAt ?? t.updatedAt ?? "");
    if (Number.isNaN(completedAt) || now - completedAt < ARCHIVE_AFTER_MS) continue;
    try { patchTask(t.id, { status: "archived" }); out.archived++; } catch { /* next task */ }
  }
  return out;
}

/* ---- Calendar EVENT reminders (Cluster N, the half that was never built) ----
 * Tasks could nudge a phone; the calendar — the surface a family actually plans on — could
 * not. Same shape as tasks: `remindOffsets` (minutes before the start), fired once per
 * offset per event, stamped BEFORE the push, retired quietly when more than a day late.
 * Recipients are the people on the event: its participants, else its owner (else whoever
 * created it). Archived members never get one (pushToMember refuses). */
export function eventReminderPlan(ev) {
  const offsets = isValidReminderList(ev?.remindOffsets) && ev.remindOffsets.length > 0 ? [...new Set(ev.remindOffsets)] : [];
  const sent = new Set(Array.isArray(ev?.remindersSent) ? ev.remindersSent : []);
  return { offsets, sent };
}
export async function sweepEventReminders(now = Date.now()) {
  const out = { checked: 0, sent: 0, skipped: 0 };
  let candidates;
  try {
    candidates = listEvents((e) => e.startAt && e.status !== "cancelled" && Array.isArray(e.remindOffsets) && e.remindOffsets.length > 0);
  } catch { return out; }
  for (const ev of candidates) {
    const { offsets, sent } = eventReminderPlan(ev);
    const tz = householdTimeZone(ev.householdId);
    const anchorMs = stampToMs(ev.startAt, tz);
    if (Number.isNaN(anchorMs)) continue;
    for (const mins of offsets) {
      if (sent.has(mins)) continue;
      const at = anchorMs - mins * 60_000;
      if (at > now) continue;
      out.checked++;
      const stale = now - at > 24 * 60 * 60 * 1000;
      try {
        sent.add(mins);
        patchEvent(ev.id, { remindersSent: [...sent] });
        if (stale) { out.skipped++; continue; }
        const people = new Set([...(ev.participantIds ?? []), ...(ev.attendees ?? []).map((a) => a?.memberId).filter(Boolean)]);
        if (people.size === 0 && (ev.ownerId || ev.createdBy)) people.add(ev.ownerId || ev.createdBy);
        const when = ev.allDay
          ? formatInZone(new Date(anchorMs).toISOString(), tz, { weekday: "short", month: "short", day: "numeric" })
          : formatInZone(new Date(anchorMs).toISOString(), tz, { hour: "numeric", minute: "2-digit" });
        const lead = mins === 0 ? "Starting now" : mins === 24 * 60 ? "Tomorrow" : mins >= 60 ? `In ${Math.round(mins / 60)} hour${mins >= 120 ? "s" : ""}` : `In ${mins} minutes`;
        let delivered = 0;
        for (const actorId of people) {
          const r = await pushToMember({
            householdId: ev.householdId, actorId,
            title: ev.title,
            body: `${lead} — ${when}${ev.location ? ` · ${ev.location}` : ""}`,
            data: { type: "event", id: ev.id },
            timeSensitive: true,
          });
          if (r?.ok) delivered++;
        }
        if (delivered) out.sent++; else out.skipped++;
      } catch { out.skipped++; }
    }
  }
  return out;
}
