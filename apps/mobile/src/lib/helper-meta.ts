// What a helper LOOKS like, and how to say its last run out loud.
//
// This is all that survives of lib/agent-meta.ts. Everything else in that file existed to
// reconstruct facts the client had to guess at — a schedule sentence assembled from
// intervalMs, connection names inferred from tool-id prefixes, an icon picked by regex. The
// server now ships `icon`, `scheduleText` and `autonomyText` already written, so the only
// honest job left here is colour, and one line of English about what happened last time.
import type { HearthColors } from "@/theme";
import { categoryStyle } from "@/theme/categories";
import type { HelperSchedule, PublicHelper } from "@/lib/api";

/** 0 = Sunday … 6 = Saturday, matching the server's weekday numbering exactly. */
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** "7:00" → "7:00 AM". The household clock, written the way a clock reads. */
export function clockLabel(hhmm: string): string {
  const [h, m] = String(hhmm ?? "").split(":");
  const hour = Number(h);
  if (!Number.isFinite(hour)) return hhmm;
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${(m ?? "00").padStart(2, "0")} ${suffix}`;
}

/**
 * The same sentence the server writes, for a schedule that hasn't been saved yet.
 *
 * A saved helper always shows the server's own `scheduleText` — that is the authority, and
 * re-deriving it on the device is how a phone comes to describe a schedule the machine
 * doesn't keep. This exists only for the seconds between picking and saving, where there IS
 * no server text, and a picker that says nothing about what it just set is a picker you have
 * to save to understand.
 */
export function describeSchedule(s: HelperSchedule): string {
  switch (s.kind) {
    case "hourly": return "Every hour";
    case "daily": return `Every day at ${clockLabel(s.time)}`;
    case "weekly": return `Every ${WEEKDAYS[s.weekday] ?? "week"} at ${clockLabel(s.time)}`;
    default: return "Only when you ask";
  }
}

/**
 * A helper's own colour and icon, from what it's FOR.
 *
 * "While one is Household, one is Meals, and another is a Briefing category, they actually
 *  share the same colour, and they shouldn't."
 *
 * Colour comes from the category table, reading name and purpose together — an SF Symbol the
 * server picked is preferred over the table's generic one, because it was chosen for THIS
 * helper. Status has its own home (the badge); identity belongs to the icon.
 */
export function helperLook(c: HearthColors, h: { name?: string; purpose?: string; icon?: string | null }) {
  const look = categoryStyle(c, `${h.name ?? ""} ${h.purpose ?? ""}`.trim());
  return { ...look, icon: h.icon || look.icon };
}

/** Paused reads as paused. There are only two states now, and grey is the honest one. */
export function helperTint(c: HearthColors, status: PublicHelper["status"]): { fg: string; bg: string } {
  return status === "Active" ? { fg: c.sage, bg: c.sageBg } : { fg: c.textMuted, bg: c.surfaceSunken };
}

/** The clock time a run started, in the reader's own locale — "7:02 AM". */
export function runClock(at: number): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/**
 * The last run, in words a person would use.
 *
 * "Ran 7:02 AM · Did 3 things" / "Waiting for approval on 1 thing" / the error itself.
 *
 * A failure says what went wrong rather than "Failed", because "Failed" is the one thing the
 * reader can already see from the colour. `tone` is semantic so the caller picks the palette.
 */
export function lastRunLine(last: PublicHelper["lastRun"]): { text: string; tone: "good" | "warn" | "bad" | "muted" } {
  if (!last) return { text: "Hasn't run yet", tone: "muted" };
  const when = runClock(last.at);
  if (!last.ok) {
    const why = (last.error || last.summary || "something went wrong").trim();
    return { text: when ? `Tried ${when} — ${why}` : why, tone: "bad" };
  }
  /* "Waiting for approval" is not a failure and must never be coloured like one — the run
   * did its job and stopped exactly where the household told it to. */
  if (/approval/i.test(last.reason)) {
    const n = last.runIds.length;
    return { text: `Waiting for approval on ${n || 1} thing${n === 1 || n === 0 ? "" : "s"}`, tone: "warn" };
  }
  const did = last.runIds.length;
  const what = did > 0 ? `Did ${did} thing${did === 1 ? "" : "s"}` : (last.summary || "Nothing needed doing");
  return { text: when ? `Ran ${when} · ${what}` : what, tone: "good" };
}
