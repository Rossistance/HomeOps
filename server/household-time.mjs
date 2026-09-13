// FamiliOS — household time. One place that knows which clock a family lives on.
//
// Every household can declare an IANA timezone (settings.timezone, validated by the
// settings route). Until this module existed, only the trigger scheduler read it; every
// other day boundary and every date a person actually READS ("Due in 15 minutes — 10:00
// PM", the assistant's idea of "today", an all-day event's midnight, a meal's 6 PM) was
// computed on the SERVER's clock — UTC on the hosted deployment — so a family in Denver
// was shown, filtered by, and pushed dates from London. These helpers resolve wall clocks
// in the household's zone; callers that have no zone fall back to the server's and can
// say so.
//
// The arithmetic itself lives in time-math.mjs (pure, store-free, importable from the ICS
// parser and unit tests); this module re-exports it and adds the store-reading entry points.
import { getSettings } from "./store.mjs";
import { serverTimeZone, isKnownTimeZone, formatInZone } from "./time-math.mjs";

export {
  serverTimeZone, isKnownTimeZone, tzOffsetAt, wallClockToUtc, localParts, localDateKey,
  localMidnightISO, wallClockISO, toInstantISO, stampToMs, localDayBounds, formatInZone,
} from "./time-math.mjs";

/** The zone a household lives on: its declared timezone, else the server's. */
export function householdTimeZone(householdId) {
  let tz = null;
  try { tz = getSettings(householdId)?.timezone || null; } catch { tz = null; }
  return isKnownTimeZone(tz) ? tz : serverTimeZone();
}

/** Whether the zone in use is the household's own or a server fallback (for disclosure). */
export function householdTimeZoneSource(householdId) {
  let tz = null;
  try { tz = getSettings(householdId)?.timezone || null; } catch { tz = null; }
  return isKnownTimeZone(tz) ? "household" : "server";
}

/** Human date-time for this household ("Thu, Jul 23, 6:00 PM"). */
export function formatForHousehold(stamp, householdId, opts = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) {
  return formatInZone(stamp, householdTimeZone(householdId), opts);
}

/** Human time of day for this household ("6:00 PM"). */
export function formatTimeForHousehold(stamp, householdId) {
  return formatInZone(stamp, householdTimeZone(householdId), { hour: "numeric", minute: "2-digit" });
}
