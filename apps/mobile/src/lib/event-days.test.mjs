// An all-day event is today's news until midnight — not until noon.
//
// The agenda's "upcoming" filter read `endAt` to decide whether an event was still live, and
// the server stores endAt: null for a single-day all-day event. So at 12:01pm today's all-day
// event failed the 12-hour grace test on its (midnight) start, and vanished — from the
// agenda, from the strip dot, and from the Today card. `effectiveEndMs` pins the rule once so
// the three renderers can never drift apart again.
import test from "node:test";
import assert from "node:assert/strict";
import { coversDay, effectiveEndMs, weekStart } from "./event-days.ts";

// Local-time ISO, so the tests hold in every timezone the CI box happens to be in.
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).toISOString();

test("a single-day all-day event (endAt: null) is live until the end of its day", () => {
  const e = { startAt: local(2026, 9, 12), endAt: null, allDay: true };
  const end = effectiveEndMs(e);
  assert.equal(end, +new Date(2026, 8, 12, 23, 59, 59, 999));
  // THE BUG: at 2pm the old filter had already dropped it.
  assert.ok(end >= +new Date(2026, 8, 12, 14, 0), "still live at 2pm");
  assert.ok(end < +new Date(2026, 8, 13, 0, 0), "gone once the day is over");
});

test("a multi-day all-day event runs to the end of its LAST day, inclusive", () => {
  const e = { startAt: local(2026, 9, 10), endAt: local(2026, 9, 12), allDay: true };
  assert.equal(effectiveEndMs(e), +new Date(2026, 8, 12, 23, 59, 59, 999));
  // And agrees with coversDay, which already treated the end day as inclusive.
  assert.equal(coversDay(e, new Date(2026, 8, 12, 15)), true);
});

test("a timed event ends at endAt, or at its start when it has no end", () => {
  assert.equal(
    effectiveEndMs({ startAt: local(2026, 9, 12, 9), endAt: local(2026, 9, 12, 10, 30), allDay: false }),
    +new Date(2026, 8, 12, 10, 30),
  );
  assert.equal(
    effectiveEndMs({ startAt: local(2026, 9, 12, 9), endAt: null }),
    +new Date(2026, 8, 12, 9, 0),
  );
});

test("an end before the start never shortens the event below its start", () => {
  assert.equal(
    effectiveEndMs({ startAt: local(2026, 9, 12, 9), endAt: local(2026, 9, 12, 8) }),
    +new Date(2026, 8, 12, 9, 0),
  );
});

test("unscheduled or unparseable starts have no end", () => {
  assert.equal(effectiveEndMs({ startAt: null, endAt: null }), null);
  assert.equal(effectiveEndMs({ startAt: "not a date", endAt: null }), null);
});

test("weekStart lands on the Monday of the ISO week, at local midnight", () => {
  // 2026-09-12 is a Saturday; its week began Monday the 7th.
  const mon = weekStart(new Date(2026, 8, 12, 15, 30));
  assert.deepEqual([mon.getFullYear(), mon.getMonth(), mon.getDate(), mon.getHours()], [2026, 8, 7, 0]);
  // Sunday belongs to the week that STARTED six days earlier, not the one starting tomorrow.
  const sun = weekStart(new Date(2026, 8, 13));
  assert.equal(sun.getDate(), 7);
  // A Monday is its own week start.
  assert.equal(weekStart(new Date(2026, 8, 14)).getDate(), 14);
});
