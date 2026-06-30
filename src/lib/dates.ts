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
