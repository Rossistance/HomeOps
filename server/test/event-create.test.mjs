// WP-103 slice 2 (ISS-105): "a created event never appears in the calendar".
//
// HYP-101's discriminating check, executed deterministically instead of by hand:
// create with the mobile form's EXACT payload, then GET /api/events. Present ⇒ the
// server write is sound and the cause is downstream; absent ⇒ a silent write failure.
//
// It also pins the silent-accept case that produces the same symptom without any write
// failing: the server used to store whatever `startAt` it was handed, so an unparseable
// stamp returned 200, appeared in the API payload, and still rendered on NO day — both
// clients drop an event whose startAt won't parse (apps/mobile/src/lib/event-days.ts
// coversDay, calendar.tsx dayKeys). "Absent after add, after nav, after sync", with a
// success toast — exactly what was reported.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
});
after(async () => { await stopServer(ctx); });

// Mirrors the clients' day mapping: an event with no parseable startAt covers no days.
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
function coveredDays(ev) {
  if (!ev.startAt || isNaN(+new Date(ev.startAt))) return 0;
  const s = startOfDay(new Date(ev.startAt));
  const e = ev.endAt && !isNaN(+new Date(ev.endAt)) ? startOfDay(new Date(ev.endAt)) : s;
  let n = 0;
  for (const d = new Date(s); +d <= Math.max(+s, +e); d.setDate(d.getDate() + 1)) n++;
  return n;
}

/** The exact body apps/mobile event-form.tsx save() sends on create. */
const mobileCreateBody = (over = {}) => ({
  title: "Dentist", startAt: new Date(2026, 7, 12, 9, 0).toISOString(), endAt: null,
  allDay: false, notes: "", location: "", driverId: null, whatToBring: [],
  visibility: "household", ...over,
});

test("HYP-101: an event created with the mobile form's payload IS present in GET /api/events", async () => {
  const created = await adult.req("/api/events", { method: "POST", body: JSON.stringify(mobileCreateBody()) });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const id = created.data.event?.id;
  assert.ok(id, "create returns the event");

  const listed = await adult.req("/api/events");
  assert.equal(listed.status, 200);
  const found = (listed.data.events ?? []).find((e) => e.id === id);
  assert.ok(found, "PRESENT ⇒ the server write is sound; ISS-105 is not a silent POST failure");
  assert.equal(coveredDays(found), 1, "and it renders on exactly its own day");
});

test("HYP-101: an all-day event from the form renders on exactly one day", async () => {
  const midnight = new Date(2026, 7, 20).toISOString();
  const created = await adult.req("/api/events", {
    method: "POST",
    body: JSON.stringify(mobileCreateBody({ title: "Anniversary", startAt: midnight, endAt: null, allDay: true })),
  });
  assert.equal(created.status, 200);
  const listed = await adult.req("/api/events");
  const found = listed.data.events.find((e) => e.id === created.data.event.id);
  assert.equal(found.allDay, true);
  assert.equal(coveredDays(found), 1);
});

test("ISS-105: an unparseable startAt is REFUSED, never stored as an unrenderable event", async () => {
  const bad = await adult.req("/api/events", {
    method: "POST", body: JSON.stringify(mobileCreateBody({ title: "Broken", startAt: "not-a-date" })),
  });
  assert.equal(bad.status, 400, "a create that could never render must fail loudly, not return 200");
  assert.equal(bad.data.error, "invalid_startAt");

  const listed = await adult.req("/api/events");
  assert.ok(
    !(listed.data.events ?? []).some((e) => e.title === "Broken"),
    "and nothing is stored — otherwise it sits in the payload rendering on no day, forever",
  );
});

test("ISS-105: an unparseable endAt is refused too (it would silently truncate the span)", async () => {
  const bad = await adult.req("/api/events", {
    method: "POST", body: JSON.stringify(mobileCreateBody({ title: "BadEnd", endAt: "whenever" })),
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, "invalid_endAt");
});

test("ISS-105: a deliberately UNSCHEDULED event (startAt:null) is still allowed", async () => {
  // The form's "scheduled" toggle sends startAt:null on purpose, and the agenda list
  // surfaces those. Validation must reject malformed stamps WITHOUT breaking this.
  const created = await adult.req("/api/events", {
    method: "POST", body: JSON.stringify(mobileCreateBody({ title: "Someday", startAt: null })),
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.event.startAt, null);
});

test("ISS-105: PATCH cannot smuggle an unparseable stamp onto an existing event", async () => {
  const created = await adult.req("/api/events", { method: "POST", body: JSON.stringify(mobileCreateBody({ title: "Patchable" })) });
  const id = created.data.event.id;
  const patched = await adult.req(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify({ startAt: "nope" }) });
  assert.equal(patched.status, 400);
  assert.equal(patched.data.error, "invalid_startAt");

  const listed = await adult.req("/api/events");
  const found = listed.data.events.find((e) => e.id === id);
  assert.equal(coveredDays(found), 1, "the original, renderable stamp survives the rejected patch");
});
