// The assistant could not see today's calendar (Jam 21375fff / 9eb8935b).
//
// Recorded verbatim from the family: "no, I definitely see it. It says all school movie and
// it's on my calendar for today at 5 PM" — and the assistant answered that it had no event
// this evening, then conceded it "cannot read the live calendar directly from the provided
// context". It wasn't a model failure. buildServerContext filtered events with
// `startAt >= now` (the current INSTANT), so today's events were dropped before the model
// ever saw them, and the system prompt correctly binds it to the context it was handed.
//
// The family's own words for the right boundary: "today's event which until 12 PM tonight
// will still be upcoming."
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// planner.mjs transitively imports store.mjs, which (correctly) refuses to open the live
// server/.data from a test process. These tests only exercise a PURE predicate, but the
// import graph still has to be satisfied — so point it at a throwaway dir first.
process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-ctx-test-"));
const { isUpcomingForContext, startOfLocalDay } = await import("../planner.mjs");

/** An ISO stamp for a local time today, so tests read in the timezone they run in. */
const todayAt = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const daysFromNow = (n, h = 9) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d.toISOString(); };

test("THE REPORTED BUG: a 5 PM event today is still visible at 6 PM", () => {
  const movieNight = { title: "All-school movie night", startAt: todayAt(17) };
  assert.equal(isUpcomingForContext(movieNight, todayAt(18)), true,
    "asked at 6 PM about a 5 PM event today, the assistant must still be able to see it");
});

test("THE REPORTED BUG: an ALL-DAY event today is visible all day", () => {
  // All-day events anchor at local midnight (WP-103), so `startAt >= now` excluded them
  // from 00:01 onward — for the whole day they were actually happening.
  const allDay = { title: "All-school movie night", startAt: todayAt(0), allDay: true };
  for (const hour of [1, 9, 13, 17, 23]) {
    assert.equal(isUpcomingForContext(allDay, todayAt(hour)), true, `still visible at ${hour}:00`);
  }
});

test("an event earlier today stays visible even once it has finished", () => {
  // A family asking "what did today look like" at 8 PM should not be told the 9 AM
  // dentist appointment doesn't exist.
  assert.equal(isUpcomingForContext({ startAt: todayAt(9) }, todayAt(20)), true);
});

test("a multi-day event that began before today is visible while it is still running", () => {
  const camp = { startAt: daysFromNow(-2), endAt: daysFromNow(2) };
  assert.equal(isUpcomingForContext(camp, todayAt(12)), true, "camp is happening right now");
});

test("a multi-day event that already ENDED is not carried forward", () => {
  const finished = { startAt: daysFromNow(-5), endAt: daysFromNow(-2) };
  assert.equal(isUpcomingForContext(finished, todayAt(12)), false);
});

test("yesterday's one-off event is not resurrected", () => {
  // The window opens at the start of TODAY — it does not become an unbounded history feed.
  assert.equal(isUpcomingForContext({ startAt: daysFromNow(-1) }, todayAt(12)), false);
});

test("future events are visible, as they always were", () => {
  assert.equal(isUpcomingForContext({ startAt: daysFromNow(1) }, todayAt(12)), true);
  assert.equal(isUpcomingForContext({ startAt: daysFromNow(30) }, todayAt(12)), true);
});

test("an undated event is always relevant", () => {
  assert.equal(isUpcomingForContext({ title: "Someday" }, todayAt(12)), true);
  assert.equal(isUpcomingForContext({ startAt: null }, todayAt(12)), true);
});

test("startOfLocalDay is local midnight, not UTC midnight", () => {
  // Using UTC midnight would re-introduce the same off-by-a-timezone hiding that WP-103
  // fixed for rendering: in a negative-offset zone it lands on the previous evening.
  const d = new Date(startOfLocalDay(todayAt(15)));
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getDate(), new Date().getDate(), "same calendar day, locally");
});
