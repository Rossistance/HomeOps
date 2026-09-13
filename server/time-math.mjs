// FamiliOS — pure wall-clock ⇄ instant arithmetic for a named IANA zone. No store, no I/O:
// safe to import from the dependency-free ICS parser and from unit tests that never boot a
// server. household-time.mjs re-exports everything here and adds the store-reading
// conveniences (which zone a household lives on).
const pad2 = (n) => String(n).padStart(2, "0");

/** The server's own zone — the honest fallback, never a silent one. */
export function serverTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/** Is this a zone the runtime can actually resolve? */
export function isKnownTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

// Offset (ms) that must be SUBTRACTED from a UTC-interpreted wall clock to get the real
// instant in `tz` — derived from the platform tz database, so DST is the runtime's problem.
export function tzOffsetAt(utcMs, tz) {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
    // `hour` can format as 24 for midnight under hour12:false on some ICU builds.
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return asUTC - utcMs;
  } catch { return null; }
}

/** Wall clock {year, month(1-12), day, hour, minute, second} in `tz` → UTC ms. Resolved
 *  twice so a time on a DST shift settles on the correct side of the boundary. */
export function wallClockToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, tz) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  let off = tzOffsetAt(naive, tz);
  if (off == null) return null;
  let ms = naive - off;
  const off2 = tzOffsetAt(ms, tz);
  if (off2 != null && off2 !== off) ms = naive - off2;
  return ms;
}

/** The wall-clock parts of an instant in `tz`. */
export function localParts(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
  return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute, second: p.second };
}

/** YYYY-MM-DD of an instant, in `tz`. */
export function localDateKey(utcMs, tz) {
  const p = localParts(utcMs, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// A timestamp with NO zone information: "2026-07-23T18:00:00" (optionally with millis).
const ZONELESS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

/** Local midnight of a YYYY-MM-DD in `tz`, as an ISO instant. */
export function localMidnightISO(dateStr, tz) {
  const m = DATE_ONLY_RE.exec(String(dateStr ?? ""));
  if (!m) return null;
  const ms = wallClockToUtc({ year: +m[1], month: +m[2], day: +m[3] }, tz);
  return ms == null ? null : new Date(ms).toISOString();
}

/** A wall-clock date + HH:MM in `tz` → ISO instant. */
export function wallClockISO(dateStr, hhmm, tz) {
  const m = DATE_ONLY_RE.exec(String(dateStr ?? ""));
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ""));
  if (!m || !t) return null;
  const ms = wallClockToUtc({ year: +m[1], month: +m[2], day: +m[3], hour: +t[1], minute: +t[2] }, tz);
  return ms == null ? null : new Date(ms).toISOString();
}

/**
 * Make a stored timestamp a real instant. A zoneless stamp ("2026-07-23T18:00:00") is read
 * as the household's wall clock; anything with a zone (or a date-only value, which means
 * "that whole day") is returned untouched. Never throws; unknown input passes through.
 */
export function toInstantISO(stamp, tz) {
  const s = String(stamp ?? "");
  const m = ZONELESS_RE.exec(s);
  if (!m) return stamp;
  const ms = wallClockToUtc({ year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: +(m[6] ?? 0) }, tz);
  return ms == null ? stamp : new Date(ms).toISOString();
}

/** Epoch ms of a stored stamp, zoneless stamps resolved in `tz`. NaN when unparseable. */
export function stampToMs(stamp, tz) {
  const s = String(stamp ?? "");
  if (DATE_ONLY_RE.test(s)) { const iso = localMidnightISO(s, tz); return iso ? Date.parse(iso) : NaN; }
  return Date.parse(toInstantISO(s, tz));
}

/** Start / end of the local day containing `nowMs` in `tz`, as instants. */
export function localDayBounds(nowMs, tz) {
  const p = localParts(nowMs, tz);
  const start = wallClockToUtc({ year: p.year, month: p.month, day: p.day }, tz);
  const end = wallClockToUtc({ year: p.year, month: p.month, day: p.day, hour: 23, minute: 59, second: 59 }, tz) + 999;
  return { start, end };
}

/** Format an instant for a person in `tz`. Unparseable input comes back as given. */
export function formatInZone(stamp, tz, opts = {}) {
  const ms = stampToMs(stamp, tz);
  if (Number.isNaN(ms)) return String(stamp ?? "");
  try {
    return new Date(ms).toLocaleString("en-US", { timeZone: tz, ...opts });
  } catch {
    return new Date(ms).toLocaleString("en-US", opts);
  }
}
