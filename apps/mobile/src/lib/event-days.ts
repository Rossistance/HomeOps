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

/** Honest time label: all-day (or unscheduled) events say "All day" — never a
 * faked midnight time (the audited ISS-005 lie). */
export function eventTimeLabel(e: Pick<EventRec, "startAt" | "allDay">): string {
  if (!e.startAt || e.allDay) return "All day";
  const d = new Date(e.startAt);
  return isNaN(+d) ? "All day" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
