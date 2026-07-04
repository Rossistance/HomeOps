// Minimal, dependency-free iCalendar (RFC 5545) parser — just enough to import events
// from a school / sports / holiday .ics feed into HomeOps' read-only "linked" calendar
// layer. Not a full implementation: we read VEVENT SUMMARY / DTSTART / DTEND / LOCATION /
// UID and normalize dates to ISO. Recurrence (RRULE) is out of scope for now.

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
function toISO(raw, isDateOnly) {
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
  return { iso: m[7] ? `${base}.000Z` : base, allDay: false };
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
        events.push({
          uid: cur.uid ?? null,
          title: cur.title ?? "(untitled)",
          startAt: cur.startAt ?? null,
          endAt: cur.endAt ?? null,
          location: cur.location ?? "",
          allDay: !!cur.allDay,
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
      case "DTSTART": { const r = toISO(p.value, (p.params.VALUE ?? "").toUpperCase() === "DATE"); cur.startAt = r.iso; cur.allDay = r.allDay; break; }
      case "DTEND": { const r = toISO(p.value, (p.params.VALUE ?? "").toUpperCase() === "DATE"); cur.endAt = r.iso; break; }
      default: break;
    }
  }
  return events;
}
