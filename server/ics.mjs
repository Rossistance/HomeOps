// Minimal, dependency-free iCalendar (RFC 5545) parser — just enough to import events
// from a school / sports / holiday .ics feed into FamiliOS' read-only "linked" calendar
// layer. Not a full implementation: we read VEVENT SUMMARY / DTSTART / DTEND / LOCATION /
// UID / RRULE / EXDATE and normalize dates to ISO. Recurrence covers the common shapes
// (FREQ daily/weekly/monthly/yearly, INTERVAL, COUNT, UNTIL, weekly BYDAY, monthly
// BYMONTHDAY / nth-weekday BYDAY, EXDATE); anything more exotic falls back to the first
// occurrence rather than guessing.

import { wallClockToUtc } from "./time-math.mjs";

// Unfold RFC 5545 folded lines: a CRLF followed by a space/tab continues the previous line.
function unfold(text) {
  return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
}

function unescapeText(v) {
  return String(v).replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

// Convert an iCal date/date-time value to an ISO string. Returns { iso, allDay }.
//   20260115T090000Z      → 2026-01-15T09:00:00.000Z (UTC)
//   20260115T090000       → 2026-01-15T09:00:00      (floating/local — no offset)
//   20260115 (VALUE=DATE) → 2026-01-15               (all-day)
//   20260115T090000 + TZID=America/New_York → 2026-01-15T14:00:00.000Z (a real instant)
// A TZID used to be discarded, so a school feed's 9:00 AM became 9:00 in whatever zone
// happened to read it — the server's for reminders and sorting, the phone's on screen.
function toISO(raw, isDateOnly, tzid) {
  const v = String(raw).trim();
  const dOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (isDateOnly || dOnly) {
    const m = dOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return { iso: null, allDay: true };
    return { iso: `${m[1]}-${m[2]}-${m[3]}`, allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return { iso: null, allDay: false };
  const base = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (m[7]) return { iso: `${base}.000Z`, allDay: false };
  if (tzid) {
    const ms = wallClockToUtc({ year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: +m[6] }, tzid);
    if (ms != null) return { iso: new Date(ms).toISOString(), allDay: false };
  }
  return { iso: base, allDay: false };
}

// RFC 5545 DURATION ("P1D", "PT1H30M", "P2DT3H") → milliseconds, or null.
function parseDuration(raw) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(raw).trim());
  if (!m) return null;
  const ms = ((+(m[2] ?? 0)) * 7 * 864e5) + ((+(m[3] ?? 0)) * 864e5) + ((+(m[4] ?? 0)) * 3600e3) + ((+(m[5] ?? 0)) * 60e3) + ((+(m[6] ?? 0)) * 1e3);
  return m[1] === "-" ? -ms : ms;
}
// An ISO in any of our three forms plus a duration → the end in the SAME form.
function addDuration(iso, ms) {
  const c = parseNaive(iso);
  if (!c) return null;
  if (c.form === "utc" || c.form === "floating") return fromNaiveMs(naiveMs(c) + ms, c.form);
  // Date-only start: a whole-day duration keeps the date form (inclusive end handled downstream).
  return fromNaiveMs(naiveMs(c) + ms - 864e5, "date");
}

// Split "NAME;PARAM=x;PARAM2=y:VALUE" into { name, params, value }.
function parseLine(line) {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = left.split(";");
  const params = {};
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

/**
 * Parse an .ics document into a flat list of events.
 * @returns {{uid,title,startAt,endAt,location,allDay}[]}
 */
export function parseICS(text) {
  const lines = unfold(text).split("\n");
  const events = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur && (cur.startAt || cur.title)) {
        if (!cur.endAt && cur.startAt && cur.durationMs != null) cur.endAt = addDuration(cur.startAt, cur.durationMs);
        events.push({
          uid: cur.uid ?? null,
          title: cur.title ?? "(untitled)",
          startAt: cur.startAt ?? null,
          endAt: cur.endAt ?? null,
          location: cur.location ?? "",
          allDay: !!cur.allDay,
          ...(cur.rrule ? { rrule: cur.rrule } : {}),
          ...(cur.exdates ? { exdates: cur.exdates } : {}),
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case "SUMMARY": cur.title = unescapeText(p.value); break;
      case "LOCATION": cur.location = unescapeText(p.value); break;
      case "UID": cur.uid = p.value.trim(); break;
      case "DTSTART": { const r = toISO(p.value, (p.params.VALUE ?? "").toUpperCase() === "DATE", p.params.TZID); cur.startAt = r.iso; cur.allDay = r.allDay; break; }
      case "DTEND": { const r = toISO(p.value, (p.params.VALUE ?? "").toUpperCase() === "DATE", p.params.TZID); cur.endAt = r.iso; break; }
      case "DURATION": { const ms = parseDuration(p.value); if (ms != null && ms >= 0) cur.durationMs = ms; break; }
      case "RRULE": cur.rrule = p.value.trim(); break;
      case "EXDATE": {
        // EXDATE may carry a comma-separated list and appear multiple times.
        const isDate = (p.params.VALUE ?? "").toUpperCase() === "DATE";
        cur.exdates = cur.exdates ?? [];
        for (const v of p.value.split(",")) { const r = toISO(v, isDate); if (r.iso) cur.exdates.push(r.iso); }
        break;
      }
      default: break;
    }
  }
  return events;
}

/* ---------------- Recurrence (RRULE) expansion ----------------
 * All date math is done on NAIVE components (year/month/day/h/m/s stepped via Date.UTC
 * regardless of the value's original form) and re-emitted in the SAME form the event
 * came in with (date-only / floating / UTC "Z"). That keeps a floating 09:00 school
 * practice at 09:00 through the whole series instead of drifting with server timezone. */

// ISO (any of our three forms) → naive components + which form it was.
function parseNaive(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z)?)?$/.exec(String(iso));
  if (!m) return null;
  return {
    y: +m[1], mo: +m[2], d: +m[3], hh: +(m[4] ?? 0), mi: +(m[5] ?? 0), ss: +(m[6] ?? 0),
    form: m[4] == null ? "date" : m[7] ? "utc" : "floating",
  };
}
const naiveMs = (c) => Date.UTC(c.y, c.mo - 1, c.d, c.hh, c.mi, c.ss);
function fromNaiveMs(ms, form) {
  const d = new Date(ms);
  const p2 = (n) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  if (form === "date") return date;
  const time = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
  return form === "utc" ? `${date}T${time}.000Z` : `${date}T${time}`;
}

const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRRule(rrule) {
  const out = {};
  for (const part of String(rrule).split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).toUpperCase();
  }
  return out;
}

// UNTIL is an iCal date/datetime; compare naively against instance start.
function untilMs(raw) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(String(raw));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 23), +(m[5] ?? 59), +(m[6] ?? 59));
}

/**
 * Expand one recurring event into concrete instances inside [horizonStart, horizonEnd].
 * Returns a list of { startAt, endAt } naive-ISO pairs (same form as the source event).
 * Unsupported/exotic rules return null so the caller can fall back to the single event.
 */
export function expandRRule({ startAt, endAt, rrule, exdates }, { horizonStart, horizonEnd, maxInstances = 500 } = {}) {
  const start = parseNaive(startAt);
  if (!start) return null;
  const rule = parseRRule(rrule);
  const freq = rule.FREQ;
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq ?? "")) return null;
  const interval = Math.max(1, parseInt(rule.INTERVAL ?? "1", 10) || 1);
  const count = rule.COUNT ? Math.max(1, parseInt(rule.COUNT, 10) || 1) : null;
  const until = rule.UNTIL ? untilMs(rule.UNTIL) : null;

  const hStart = horizonStart instanceof Date ? horizonStart.getTime() : (horizonStart ?? Date.now() - 30 * 864e5);
  const hEnd = horizonEnd instanceof Date ? horizonEnd.getTime() : (horizonEnd ?? Date.now() + 90 * 864e5);
  const startMs = naiveMs(start);
  const end = endAt ? parseNaive(endAt) : null;
  const durMs = end ? Math.max(0, naiveMs(end) - startMs) : 0;
  const excluded = new Set((exdates ?? []).map((x) => { const c = parseNaive(x); return c ? naiveMs(c) : null; }).filter((x) => x != null));

  // Weekly BYDAY → the weekdays this series fires on (default: DTSTART's weekday).
  let weeklyDays = null;
  // Monthly: either BYMONTHDAY=n, or BYDAY=2TU / -1FR (nth weekday of the month).
  let monthDay = null, monthNthDay = null;
  if (freq === "WEEKLY") {
    weeklyDays = rule.BYDAY
      ? rule.BYDAY.split(",").map((d) => WEEKDAYS[d.trim()]).filter((n) => n != null)
      : [new Date(startMs).getUTCDay()];
    if (weeklyDays.length === 0) return null;
  } else if (freq === "MONTHLY") {
    if (rule.BYMONTHDAY) {
      monthDay = parseInt(rule.BYMONTHDAY, 10);
      if (!monthDay || monthDay < 1 || monthDay > 31) return null; // negative BYMONTHDAY unsupported
    } else if (rule.BYDAY) {
      const m = /^(-?\d)([A-Z]{2})$/.exec(rule.BYDAY.trim());
      if (!m || WEEKDAYS[m[2]] == null) return null; // multi-BYDAY monthly unsupported
      monthNthDay = { nth: parseInt(m[1], 10), day: WEEKDAYS[m[2]] };
    } else {
      monthDay = start.d;
    }
  } else if (rule.BYDAY || rule.BYMONTHDAY) {
    return null; // BYDAY/BYMONTHDAY on daily/yearly — out of scope
  }

  // nth weekday of a month (nth: 1..5 or -1 for last) → naive ms, or null if absent.
  const nthWeekdayMs = (y, mo0, nth, day, hh, mi, ss) => {
    if (nth > 0) {
      const first = new Date(Date.UTC(y, mo0, 1)).getUTCDay();
      const d = 1 + ((day - first + 7) % 7) + (nth - 1) * 7;
      const lastDay = new Date(Date.UTC(y, mo0 + 1, 0)).getUTCDate();
      return d <= lastDay ? Date.UTC(y, mo0, d, hh, mi, ss) : null;
    }
    const lastDay = new Date(Date.UTC(y, mo0 + 1, 0)).getUTCDate();
    const lastDow = new Date(Date.UTC(y, mo0, lastDay)).getUTCDay();
    return Date.UTC(y, mo0, lastDay - ((lastDow - day + 7) % 7), hh, mi, ss);
  };

  const instances = [];
  let emitted = 0, occurrences = 0;
  const CAP = 5000; // hard stop for runaway series
  let iter = 0;

  const push = (ms) => {
    occurrences++;
    if (excluded.has(ms)) return true;
    if (until != null && ms > until) return false;
    if (count != null && occurrences > count) return false;
    if (ms >= hStart && ms <= hEnd) {
      instances.push({ startAt: fromNaiveMs(ms, start.form), endAt: endAt ? fromNaiveMs(ms + durMs, start.form) : null });
      emitted++;
    }
    return ms <= hEnd && emitted < maxInstances;
  };

  if (freq === "DAILY") {
    for (let ms = startMs; iter++ < CAP; ms += interval * 864e5) if (!push(ms)) break;
  } else if (freq === "WEEKLY") {
    // Step week-by-week from DTSTART's week; within each active week emit matching weekdays ≥ DTSTART.
    const dow = new Date(startMs).getUTCDay();
    const weekAnchor = startMs - dow * 864e5; // Sunday of DTSTART's week
    outer: for (let w = 0; iter++ < CAP; w += interval) {
      const base = weekAnchor + w * 7 * 864e5;
      if (until != null && base > until + 7 * 864e5) break;
      if (base > hEnd + 7 * 864e5 && count == null) break;
      for (const d of [...weeklyDays].sort((a, b) => a - b)) {
        const ms = base + d * 864e5;
        if (ms < startMs) continue;
        if (!push(ms)) break outer;
      }
    }
  } else if (freq === "MONTHLY") {
    outer: for (let k = 0; iter++ < CAP; k += interval) {
      const y = start.y + Math.floor((start.mo - 1 + k) / 12);
      const mo0 = (start.mo - 1 + k) % 12;
      let ms = null;
      if (monthNthDay) ms = nthWeekdayMs(y, mo0, monthNthDay.nth, monthNthDay.day, start.hh, start.mi, start.ss);
      else {
        const lastDay = new Date(Date.UTC(y, mo0 + 1, 0)).getUTCDate();
        ms = monthDay <= lastDay ? Date.UTC(y, mo0, monthDay, start.hh, start.mi, start.ss) : null; // skip short months
      }
      if (ms == null) continue;
      if (ms < startMs) continue;
      if (ms > hEnd && count == null) break outer;
      if (!push(ms)) break outer;
    }
  } else { // YEARLY
    for (let k = 0; iter++ < CAP; k += interval) {
      const ms = Date.UTC(start.y + k, start.mo - 1, start.d, start.hh, start.mi, start.ss);
      if (ms > hEnd && count == null) break;
      if (!push(ms)) break;
    }
  }
  return instances;
}

/**
 * Flatten parsed ICS events: non-recurring pass through untouched; recurring events
 * become one entry per instance inside the horizon, with a per-instance uid
 * (`<uid>#<compact-start>`) so the shared upsert path dedupes each occurrence.
 * An unsupported RRULE falls back to the single base event (honest, never guessed).
 */
export function expandRecurring(events, { horizonStart, horizonEnd } = {}) {
  const out = [];
  for (const ev of events ?? []) {
    if (!ev.rrule || !ev.startAt) { out.push(ev); continue; }
    const instances = expandRRule(ev, { horizonStart, horizonEnd });
    if (instances == null) { out.push({ ...ev, rrule: undefined }); continue; }
    for (const inst of instances) {
      const compact = String(inst.startAt).replace(/[-:.]/g, "");
      out.push({ ...ev, rrule: undefined, exdates: undefined, startAt: inst.startAt, endAt: inst.endAt ?? ev.endAt ?? null, uid: `${ev.uid ?? "noduid"}#${compact}`, recurring: true });
    }
  }
  return out;
}
