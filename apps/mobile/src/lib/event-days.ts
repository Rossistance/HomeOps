// WP-003 (ISS-004/005): shared day-span + time-label helpers for event renderers
// (calendar, today/grandparent/kid/sitter homes). Pure — no RN imports.
import type { EventRec } from "@/lib/api";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** True when the event covers the given calendar day (multi-day span inclusive). */
export function coversDay(e: Pick<EventRec, "startAt" | "endAt">, day: Date): boolean {
  if (!e.startAt) return false;
  const s = new Date(e.startAt);
  if (isNaN(+s)) return false;
  const d0 = +startOfDay(day);
  const s0 = +startOfDay(s);
  const en = e.endAt ? new Date(e.endAt) : null;
  const e0 = en && !isNaN(+en) ? +startOfDay(en) : s0;
  return d0 >= s0 && d0 <= Math.max(s0, e0);
}

/** When the event stops being "live", as epoch ms — or null when it has no usable start.
 * All-day events run to the END of their last day: the server stores endAt:null for a
 * single-day all-day event, so reading endAt alone made today's all-day event vanish at
 * noon. Timed events end at endAt (or their start when they have none). */
export function effectiveEndMs(e: Pick<EventRec, "startAt" | "endAt" | "allDay">): number | null {
  if (!e.startAt) return null;
  const s = new Date(e.startAt);
  if (isNaN(+s)) return null;
  const en = e.endAt ? new Date(e.endAt) : null;
  const last = en && !isNaN(+en) ? en : s;
  if (e.allDay) {
    // Calendar arithmetic, not +86400000: a DST day is 23 or 25 hours long.
    return +new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) - 1;
  }
  return Math.max(+s, +last);
}

/** Local Monday (00:00) of the ISO week containing `d` — for week separators in agendas. */
export function weekStart(d: Date): Date {
  const day = startOfDay(d);
  const back = (day.getDay() + 6) % 7; // Sun=0 → 6 back; Mon=1 → 0 back
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - back);
}

/** Honest time label: all-day (or unscheduled) events say "All day" — never a
 * faked midnight time (the audited ISS-005 lie). */
export function eventTimeLabel(e: Pick<EventRec, "startAt" | "allDay">): string {
  if (!e.startAt || e.allDay) return "All day";
  const d = new Date(e.startAt);
  return isNaN(+d) ? "All day" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
