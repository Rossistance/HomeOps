/** Date helpers. The sample seed anchors all dates relative to "now" at seed
 *  time so the household always looks current, no matter when the app loads. */

export function nowISO(): string {
  return new Date().toISOString();
}

export function iso(d: Date): string {
  return d.toISOString();
}

export function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

export function addHours(base: Date, hours: number): Date {
  const d = new Date(base);
  d.setHours(d.getHours() + hours);
  return d;
}

/** Set a specific hour:minute on a date (local time). */
export function atTime(base: Date, hour: number, minute = 0): Date {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** Next occurrence of a weekday (0=Sun..6=Sat), at given time. */
export function nextWeekday(base: Date, weekday: number, hour = 9, minute = 0): Date {
  const d = new Date(base);
  const diff = (weekday - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(hour, minute, 0, 0);
  return d;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function fmtDate(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function fmtDateFull(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (isNaN(d.getTime())) return "—";
  return `${DAY_NAMES[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function fmtTime(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (isNaN(d.getTime())) return "—";
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export function fmtDateTime(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (isNaN(d.getTime())) return "—";
  return `${fmtDate(d)}, ${fmtTime(d)}`;
}

export function dayName(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return DAY_NAMES[d.getDay()];
}

export function relativeTime(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (isNaN(d.getTime())) return "—";
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const future = diff > 0;
  let label: string;
  if (mins < 1) return "just now";
  if (mins < 60) label = `${mins}m`;
  else if (hours < 24) label = `${hours}h`;
  else if (days < 30) label = `${days}d`;
  else label = fmtDate(d);
  if (days >= 30) return label;
  return future ? `in ${label}` : `${label} ago`;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isToday(input?: string): boolean {
  if (!input) return false;
  const d = new Date(input);
  const t = new Date();
  return d.toDateString() === t.toDateString();
}

export function isOverdue(input?: string): boolean {
  if (!input) return false;
  return new Date(input).getTime() < Date.now();
}

export function isThisWeek(input?: string): boolean {
  if (!input) return false;
  const d = new Date(input).getTime();
  const start = startOfToday().getTime();
  const end = start + 7 * 86400000;
  return d >= start && d <= end;
}

/* ---------------- Local-day bucketing + event windows ----------------
 * Every surface that answers "is this today?" / "is this still going on?" reads these,
 * so the Dashboard, Calendar, scoped views, the briefing and the assistant context can't
 * each pick a different window (they used to: now−1h, now−12h, ±1 day, "always"). */

/** A date-only ISO string ("2026-09-12") is a LOCAL calendar day, not UTC midnight —
 *  `new Date("2026-09-12")` lands on the previous evening anywhere west of Greenwich. */
export function parseLocalDate(input: string | Date): Date {
  if (input instanceof Date) return input;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(input);
}

/** Local calendar-day key (YYYY-MM-DD). `toISOString().slice(0, 10)` is UTC and files an
 *  evening event under tomorrow (or a morning one under yesterday) depending on the zone. */
export function dayKey(input: string | Date): string {
  const d = parseLocalDate(input);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function todayKey(now: Date = new Date()): string {
  return dayKey(now);
}

export interface EventWindow { startAt?: string | null; endAt?: string | null; allDay?: boolean }

const HOUR_MS = 3600000;
function endOfLocalDay(d: Date): Date { const e = new Date(d); e.setHours(23, 59, 59, 999); return e; }
function startOfLocalDay(d: Date): Date { const s = new Date(d); s.setHours(0, 0, 0, 0); return s; }

/** When an event stops being "live" (ms). An all-day event lasts through the end of its
 *  inclusive end day; a timed one ends at endAt. A timed event with NO end is assumed to
 *  last an hour (the same guess HelpComposer's free/busy check makes) so it doesn't vanish
 *  from "Today" the second it starts. NaN when the start can't be parsed. */
export function effectiveEnd(e: EventWindow): number {
  const start = e.startAt ? parseLocalDate(e.startAt) : new Date(NaN);
  if (isNaN(start.getTime())) return NaN;
  const end = e.endAt ? parseLocalDate(e.endAt) : null;
  const last = end && !isNaN(end.getTime()) && end.getTime() >= start.getTime() ? end : null;
  if (e.allDay) return endOfLocalDay(last ?? start).getTime();
  return last ? last.getTime() : start.getTime() + HOUR_MS;
}
/** Still going on (or not started yet) as of `now`. */
export function isLive(e: EventWindow, now: number = Date.now()): boolean {
  const end = effectiveEnd(e);
  return !isNaN(end) && end >= now;
}
/** Overlaps today's LOCAL day — starts before midnight tonight and hasn't ended before
 *  midnight this morning. A multi-day or all-day event stays "today" all day long. */
export function isTodayEvent(e: EventWindow, now: number = Date.now()): boolean {
  const start = e.startAt ? parseLocalDate(e.startAt).getTime() : NaN;
  if (isNaN(start)) return false;
  const today = new Date(now);
  return start <= endOfLocalDay(today).getTime() && effectiveEnd(e) >= startOfLocalDay(today).getTime();
}
/** Every local day an event spans, start day → inclusive end day, so a multi-day event
 *  lands on each of its days instead of only its first. Capped defensively. A timed event
 *  ending exactly at midnight belongs to the day it ended on, not the next one. */
export function spanDayKeys(e: EventWindow, cap = 60): string[] {
  if (!e.startAt) return [];
  const start = parseLocalDate(e.startAt);
  if (isNaN(start.getTime())) return [];
  const keys = [dayKey(start)];
  let end = e.endAt ? parseLocalDate(e.endAt) : null;
  if (!end || isNaN(end.getTime())) return keys;
  if (!e.allDay && end.getTime() > start.getTime() && end.getTime() === startOfLocalDay(end).getTime()) end = new Date(end.getTime() - 1);
  const endKey = dayKey(end);
  const cur = startOfLocalDay(start);
  for (let i = 0; i < cap; i++) {
    cur.setDate(cur.getDate() + 1);
    const k = dayKey(cur);
    if (k > endKey) break;
    keys.push(k);
  }
  return keys;
}
/** The time column for an event row: "All day" for all-day events, else the start time. */
export function eventTimeLabel(e: EventWindow): string {
  if (e.allDay || !e.startAt) return "All day";
  const d = parseLocalDate(e.startAt);
  return isNaN(d.getTime()) ? "All day" : fmtTime(d);
}
/** A task is "today's" when it's due today or already overdue (local days). */
export function isDueTodayOrOverdue(dueAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!dueAt) return false;
  const k = dayKey(dueAt);
  return !!k && k <= todayKey(now);
}
