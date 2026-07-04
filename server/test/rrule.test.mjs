// RECURRENCE (RRULE) — pure expansion fixtures for the dependency-free ICS parser.
// Covers the common shapes a school/sports/holiday feed actually uses; anything
// exotic must return null (caller falls back to the single base event — honest).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseICS, expandRRule, expandRecurring } from "../ics.mjs";

const H = { horizonStart: Date.UTC(2026, 0, 1), horizonEnd: Date.UTC(2026, 11, 31) };

test("weekly BYDAY expands on the right weekdays, preserving the floating time", () => {
  // Thursdays 17:30 floating (school practice) — 2026-01-08 is a Thursday.
  const out = expandRRule({ startAt: "2026-01-08T17:30:00", endAt: "2026-01-08T18:30:00", rrule: "FREQ=WEEKLY;BYDAY=TH;COUNT=4" }, H);
  assert.deepEqual(out.map((i) => i.startAt), [
    "2026-01-08T17:30:00", "2026-01-15T17:30:00", "2026-01-22T17:30:00", "2026-01-29T17:30:00",
  ]);
  assert.equal(out[0].endAt, "2026-01-08T18:30:00", "duration carried to each instance");
});

test("weekly multi-BYDAY (MO,WE,FR) with INTERVAL=2 skips alternate weeks", () => {
  // 2026-01-05 is a Monday.
  const out = expandRRule({ startAt: "2026-01-05T09:00:00.000Z", endAt: null, rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=5" }, H);
  assert.deepEqual(out.map((i) => i.startAt), [
    "2026-01-05T09:00:00.000Z", "2026-01-07T09:00:00.000Z", "2026-01-09T09:00:00.000Z",
    "2026-01-19T09:00:00.000Z", "2026-01-21T09:00:00.000Z",
  ]);
});

test("UNTIL stops the series; EXDATE knocks out one occurrence without ending it", () => {
  const out = expandRRule({
    startAt: "2026-02-02T08:00:00", endAt: null,
    rrule: "FREQ=DAILY;UNTIL=20260206T080000Z",
    exdates: ["2026-02-04T08:00:00"],
  }, H);
  assert.deepEqual(out.map((i) => i.startAt), [
    "2026-02-02T08:00:00", "2026-02-03T08:00:00", "2026-02-05T08:00:00", "2026-02-06T08:00:00",
  ]);
});

test("monthly nth-weekday (2nd Tuesday) and all-day date-only form", () => {
  // 2026-01-13 is the 2nd Tuesday of January 2026.
  const out = expandRRule({ startAt: "2026-01-13", endAt: null, rrule: "FREQ=MONTHLY;BYDAY=2TU;COUNT=3" }, H);
  assert.deepEqual(out.map((i) => i.startAt), ["2026-01-13", "2026-02-10", "2026-03-10"]);
});

test("monthly BYMONTHDAY=31 skips short months instead of drifting", () => {
  const out = expandRRule({ startAt: "2026-01-31T12:00:00", endAt: null, rrule: "FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3" }, H);
  assert.deepEqual(out.map((i) => i.startAt), ["2026-01-31T12:00:00", "2026-03-31T12:00:00", "2026-05-31T12:00:00"]);
});

test("yearly recurrence, horizon-bounded", () => {
  const out = expandRRule({ startAt: "2020-07-04", endAt: null, rrule: "FREQ=YEARLY" }, H);
  assert.deepEqual(out.map((i) => i.startAt), ["2026-07-04"], "only the occurrence inside the horizon window");
});

test("unsupported rules return null (caller falls back to the single event)", () => {
  assert.equal(expandRRule({ startAt: "2026-01-05T09:00:00", rrule: "FREQ=HOURLY" }, H), null);
  assert.equal(expandRRule({ startAt: "2026-01-05T09:00:00", rrule: "FREQ=MONTHLY;BYDAY=MO,TU" }, H), null);
  assert.equal(expandRRule({ startAt: "2026-01-05T09:00:00", rrule: "FREQ=MONTHLY;BYMONTHDAY=-1" }, H), null);
});

test("end-to-end: parseICS + expandRecurring gives per-instance uids the upsert can dedupe", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:practice@example.com",
    "SUMMARY:Soccer practice",
    "DTSTART:20260108T173000",
    "DTEND:20260108T183000",
    "RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=3",
    "EXDATE:20260115T173000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:oneoff@example.com",
    "SUMMARY:Picture day",
    "DTSTART;VALUE=DATE:20260210",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const out = expandRecurring(parseICS(ics), H);
  const practices = out.filter((e) => e.title === "Soccer practice");
  assert.equal(practices.length, 2, "COUNT=3 minus one EXDATE");
  assert.ok(practices.every((e) => e.uid.startsWith("practice@example.com#")), "per-instance uid");
  assert.notEqual(practices[0].uid, practices[1].uid);
  const oneoff = out.find((e) => e.title === "Picture day");
  assert.equal(oneoff.uid, "oneoff@example.com", "non-recurring events pass through untouched");
});
