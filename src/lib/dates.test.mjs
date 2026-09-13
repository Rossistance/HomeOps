// Local-day bucketing + event-window helpers — run with:
//   node --test src/lib/dates.test.mjs
// (node strips types from the imported .ts natively; this module has no browser imports)
//
// The defect: every surface answered "is this today / still going on?" with its own
// window (UTC day keys, now−1h, now−12h, ±1 day, "always"), so an all-day event vanished
// from Home mid-morning while the Calendar still listed it, and an evening event filed
// itself under tomorrow west of Greenwich. These lock ONE set of answers.
import test from "node:test";
import assert from "node:assert/strict";
import {
  dayKey, todayKey, parseLocalDate, effectiveEnd, isLive, isTodayEvent, spanDayKeys, eventTimeLabel, isDueTodayOrOverdue,
} from "./dates.ts";

const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);
const iso = (y, m, d, h = 0, min = 0) => local(y, m, d, h, min).toISOString();

test("dayKey uses LOCAL getters, never the UTC date", () => {
  const lateEvening = local(2026, 9, 12, 23, 30);
  assert.equal(dayKey(lateEvening), "2026-09-12");
  assert.equal(dayKey(lateEvening.toISOString()), "2026-09-12");
  assert.equal(dayKey(local(2026, 9, 12, 0, 5)), "2026-09-12");
  assert.equal(dayKey("not a date"), "");
  assert.equal(todayKey(local(2026, 1, 3, 8)), "2026-01-03");
});

test("a date-only string is a local calendar day, not UTC midnight", () => {
  const d = parseLocalDate("2026-09-12");
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 12);
  assert.equal(d.getHours(), 0);
  assert.equal(dayKey("2026-09-12"), "2026-09-12");
});

test("effectiveEnd: all-day lasts through the end of its inclusive end day", () => {
  const oneDay = { startAt: "2026-09-12", allDay: true };
  assert.equal(effectiveEnd(oneDay), local(2026, 9, 12, 23, 59).getTime() + 59_999);
  const span = { startAt: "2026-09-12", endAt: "2026-09-14", allDay: true };
  assert.equal(dayKey(new Date(effectiveEnd(span))), "2026-09-14");
});

test("effectiveEnd: a timed event ends at endAt; with no end it lasts an hour", () => {
  const timed = { startAt: iso(2026, 9, 12, 9), endAt: iso(2026, 9, 12, 10, 30) };
  assert.equal(effectiveEnd(timed), local(2026, 9, 12, 10, 30).getTime());
  const noEnd = { startAt: iso(2026, 9, 12, 9) };
  assert.equal(effectiveEnd(noEnd), local(2026, 9, 12, 10).getTime());
  // An end before the start is garbage and must not make the event "already over".
  const inverted = { startAt: iso(2026, 9, 12, 9), endAt: iso(2026, 9, 12, 8) };
  assert.equal(effectiveEnd(inverted), local(2026, 9, 12, 10).getTime());
  assert.ok(Number.isNaN(effectiveEnd({ startAt: null })));
});

test("isLive: an all-day event today never disappears during the day", () => {
  const today = { startAt: dayKey(local(2026, 9, 12)), allDay: true };
  for (const h of [0, 9, 13, 17, 23]) assert.ok(isLive(today, local(2026, 9, 12, h, 59).getTime()), `still live at ${h}:59`);
  assert.ok(!isLive(today, local(2026, 9, 13, 0, 1).getTime()), "gone the next morning");
});

test("isLive: a timed event stays until it ENDS, not 12h after it starts", () => {
  const e = { startAt: iso(2026, 9, 12, 9), endAt: iso(2026, 9, 12, 17) };
  assert.ok(isLive(e, local(2026, 9, 12, 16, 59).getTime()));
  assert.ok(!isLive(e, local(2026, 9, 12, 17, 1).getTime()));
  assert.ok(isLive(e, local(2026, 9, 11, 12).getTime()), "future events are live too");
});

test("isTodayEvent covers today's local day, including multi-day events in flight", () => {
  const now = local(2026, 9, 12, 14).getTime();
  assert.ok(isTodayEvent({ startAt: iso(2026, 9, 12, 8), endAt: iso(2026, 9, 12, 9) }, now), "already-finished-today still counts as today");
  assert.ok(isTodayEvent({ startAt: iso(2026, 9, 12, 20) }, now), "later tonight");
  assert.ok(isTodayEvent({ startAt: "2026-09-11", endAt: "2026-09-13", allDay: true }, now), "a span crossing today");
  assert.ok(!isTodayEvent({ startAt: iso(2026, 9, 13, 8) }, now), "tomorrow is not today");
  assert.ok(!isTodayEvent({ startAt: iso(2026, 9, 11, 8), endAt: iso(2026, 9, 11, 9) }, now), "yesterday is not today");
  assert.ok(!isTodayEvent({ startAt: "" }, now));
});

test("spanDayKeys: every day from start to inclusive end, capped", () => {
  assert.deepEqual(spanDayKeys({ startAt: "2026-09-12", endAt: "2026-09-14", allDay: true }), ["2026-09-12", "2026-09-13", "2026-09-14"]);
  assert.deepEqual(spanDayKeys({ startAt: iso(2026, 9, 12, 9) }), ["2026-09-12"]);
  assert.deepEqual(spanDayKeys({ startAt: iso(2026, 9, 12, 22), endAt: iso(2026, 9, 13, 1) }), ["2026-09-12", "2026-09-13"]);
  // Ends exactly at midnight → belongs to the day it ended on, not the next.
  assert.deepEqual(spanDayKeys({ startAt: iso(2026, 9, 12, 22), endAt: iso(2026, 9, 13, 0) }), ["2026-09-12"]);
  assert.equal(spanDayKeys({ startAt: "2026-01-01", endAt: "2027-01-01", allDay: true }, 10).length, 11);
  assert.deepEqual(spanDayKeys({ startAt: null }), []);
});

test("eventTimeLabel: All day for all-day events, else the start time", () => {
  assert.equal(eventTimeLabel({ startAt: "2026-09-12", allDay: true }), "All day");
  assert.equal(eventTimeLabel({ startAt: null }), "All day");
  assert.equal(eventTimeLabel({ startAt: iso(2026, 9, 12, 14, 5) }), "2:05 PM");
});

test("isDueTodayOrOverdue: today and the past, by local day", () => {
  const now = local(2026, 9, 12, 10);
  assert.ok(isDueTodayOrOverdue(iso(2026, 9, 12, 23, 30), now), "later today still counts");
  assert.ok(isDueTodayOrOverdue(iso(2026, 9, 1, 8), now), "overdue");
  assert.ok(!isDueTodayOrOverdue(iso(2026, 9, 13, 8), now), "tomorrow doesn't");
  assert.ok(!isDueTodayOrOverdue(undefined, now));
});
