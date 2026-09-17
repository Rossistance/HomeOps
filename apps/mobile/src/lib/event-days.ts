// WP-003 (ISS-004/005): shared day-span + time-label helpers for event renderers
// (calendar, today/grandparent/kid/sitter homes). Pure — no RN imports.
import type { EventRec } from "@/lib/api";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local (device) YYYY-MM-DD. */
export const localDayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * The calendar date of an ALL-DAY event, independent of the phone's time zone.
 *
 * The server stores an all-day start as midnight in the HOUSEHOLD's zone (Oct 4 in
 * New York is 2026-10-04T04:00Z). Read through `new Date(...)` on a device in another zone
 * that instant is still Oct 3 — so on the cloud simulator (Pacific) every Sunday "Repatha
 * Injection" sat under Saturday, and a parent travelling west would see the same day-shift.
 * With the household zone known, the date is read in that zone. Without it, the date is
 * taken twelve hours after the stored instant in UTC — for every zone from UTC-12 to
 * UTC+12 that lands inside the intended day, which is the honest fallback, not a guess.
 */
export function allDayDateKey(iso: string, householdTz?: string | null): string | null {
  const d = new Date(iso);
  if (isNaN(+d)) return null;
  if (householdTz) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: householdTz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
      const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
      const k = `${get("year")}-${get("month")}-${get("day")}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return k;
    } catch { /* unknown zone id → fall through */ }
  }
  const noon = new Date(+d + 12 * 3600 * 1000);
  return `${noon.getUTCFullYear()}-${pad2(noon.getUTCMonth() + 1)}-${pad2(noon.getUTCDate())}`;
}

/** The day an event starts on, as YYYY-MM-DD: household date for all-day, device-local otherwise. */
export function eventDayKey(e: Pick<EventRec, "startAt" | "allDay">, householdTz?: string | null): string | null {
  if (!e.startAt) return null;
  if (e.allDay) return allDayDateKey(e.startAt, householdTz);
  const d = new Date(e.startAt);
  return isNaN(+d) ? null : localDayKey(d);
}

/** True when the event covers the given calendar day (multi-day span inclusive). */
export function coversDay(e: Pick<EventRec, "startAt" | "endAt" | "allDay">, day: Date, householdTz?: string | null): boolean {
  if (!e.startAt) return false;
  const s = new Date(e.startAt);
  if (isNaN(+s)) return false;
  if (e.allDay) {
    // Compare calendar DATES, not instants — see allDayDateKey.
    const k0 = localDayKey(day);
    const ks = allDayDateKey(e.startAt, householdTz);
    const ke = e.endAt ? allDayDateKey(e.endAt, householdTz) : null;
    if (!ks) return false;
    return k0 >= ks && k0 <= (ke && ke > ks ? ke : ks);
  }
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
