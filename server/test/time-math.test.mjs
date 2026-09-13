// HOUSEHOLD TIME — pure wall-clock ⇄ instant arithmetic for a named zone (server/time-math.mjs).
// Every day boundary and every date a person reads used to be computed on the SERVER's clock
// (UTC on the hosted deployment); these pin the household-zone versions, DST included.
import { test } from "node:test";
import assert from "node:assert/strict";
import { localMidnightISO, wallClockISO, toInstantISO, stampToMs, localDayBounds, localDateKey, tzOffsetAt, isKnownTimeZone } from "../time-math.mjs";
import { parseICS } from "../ics.mjs";

const NY = "America/New_York";

test("local midnight of a calendar date is the household's midnight, not UTC's", () => {
  assert.equal(localMidnightISO("2026-07-25", NY), "2026-07-25T04:00:00.000Z"); // EDT
  assert.equal(localMidnightISO("2026-01-25", NY), "2026-01-25T05:00:00.000Z"); // EST
  assert.equal(localMidnightISO("2026-07-25", "UTC"), "2026-07-25T00:00:00.000Z");
  assert.equal(localMidnightISO("not-a-date", NY), null);
});

test("a wall-clock date + HH:MM becomes a real instant, DST-aware", () => {
  assert.equal(wallClockISO("2026-07-23", "18:00", NY), "2026-07-23T22:00:00.000Z");
  assert.equal(wallClockISO("2026-12-23", "18:00", NY), "2026-12-23T23:00:00.000Z");
  // The spring-forward day: 02:30 does not exist; the resolver lands on a consistent side.
  const springMs = Date.parse(wallClockISO("2026-03-08", "03:00", NY));
  assert.equal(new Date(springMs).toISOString(), "2026-03-08T07:00:00.000Z");
});

test("a zoneless stamp is read on the household's clock; zoned and date-only stamps pass through", () => {
  assert.equal(toInstantISO("2026-07-23T18:00:00", NY), "2026-07-23T22:00:00.000Z");
  assert.equal(toInstantISO("2026-07-23T18:00:00.000Z", NY), "2026-07-23T18:00:00.000Z");
  assert.equal(toInstantISO("2026-07-23T18:00:00-04:00", NY), "2026-07-23T18:00:00-04:00");
  assert.equal(toInstantISO("2026-07-23", NY), "2026-07-23");
  assert.equal(stampToMs("2026-07-23", NY), Date.parse("2026-07-23T04:00:00.000Z"));
  assert.ok(Number.isNaN(stampToMs("tomorrow", NY)));
});

test("the day containing an instant is the household's day (the 8 PM-the-evening-before bug)", () => {
  const nowUtc = Date.parse("2026-07-24T01:00:00Z"); // 9 PM Jul 23 in New York
  assert.equal(localDateKey(nowUtc, NY), "2026-07-23");
  assert.equal(localDateKey(nowUtc, "UTC"), "2026-07-24");
  const b = localDayBounds(nowUtc, NY);
  assert.equal(new Date(b.start).toISOString(), "2026-07-23T04:00:00.000Z");
  assert.equal(new Date(b.end).toISOString(), "2026-07-24T03:59:59.999Z");
});

test("zone validation and offsets", () => {
  assert.equal(isKnownTimeZone(NY), true);
  assert.equal(isKnownTimeZone("Mars/Olympus"), false);
  assert.equal(isKnownTimeZone(0), false);
  assert.equal(tzOffsetAt(Date.parse("2026-07-25T04:00:00Z"), NY), -4 * 3600_000);
});

test("ICS: a TZID is honoured and a DURATION becomes an end", () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a
SUMMARY:Practice
DTSTART;TZID=America/New_York:20260115T090000
DURATION:PT1H30M
END:VEVENT
BEGIN:VEVENT
UID:b
SUMMARY:Floating
DTSTART:20260115T090000
DTEND:20260115T100000
END:VEVENT
END:VCALENDAR`;
  const [a, b] = parseICS(ics);
  assert.equal(a.startAt, "2026-01-15T14:00:00.000Z", "9 AM New York in January is 14:00Z");
  assert.equal(a.endAt, "2026-01-15T15:30:00.000Z", "DURATION applied in the same frame");
  assert.equal(b.startAt, "2026-01-15T09:00:00", "no TZID stays floating (unchanged behaviour)");
  assert.equal(b.endAt, "2026-01-15T10:00:00");
});
