// WP-003 (ISS-004/005): allDay model concept — server passthrough + Google
// `date`-vs-`dateTime` payload forms + pull-merge normalization.
// Pure fixtures + isolated harness server; NEVER a live Google call (DEC-08).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { googleEventTimes, mergeGoogleEdit } from "../calendar.mjs";

let ctx, adult;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
});
after(async () => { await stopServer(ctx); });

/* ---- pure: payload time forms ---- */

test("timed events push dateTime; missing end defaults to +1h", () => {
  const t = googleEventTimes({ startAt: "2026-07-25T14:00:00.000Z", endAt: null });
  assert.deepEqual(t.start, { dateTime: "2026-07-25T14:00:00.000Z" });
  assert.deepEqual(t.end, { dateTime: "2026-07-25T15:00:00.000Z" });
  assert.equal(t.start.date, undefined, "no date form for timed events");
});

test("single-day all-day pushes date form with EXCLUSIVE end (start day + 1)", () => {
  const start = new Date(2026, 6, 25); // local Jul 25 midnight
  const t = googleEventTimes({ allDay: true, startAt: start.toISOString(), endAt: null });
  assert.deepEqual(t.start, { date: "2026-07-25" });
  assert.deepEqual(t.end, { date: "2026-07-26" });
  assert.equal(t.start.dateTime, undefined, "no dateTime mixing in all-day form");
});

test("multi-day all-day pushes inclusive endAt as exclusive end.date", () => {
  const t = googleEventTimes({
    allDay: true,
    startAt: new Date(2026, 6, 25).toISOString(),
    endAt: new Date(2026, 6, 27).toISOString(), // inclusive Jul 27
  });
  assert.deepEqual(t.start, { date: "2026-07-25" });
  assert.deepEqual(t.end, { date: "2026-07-28" }); // exclusive
});

/* ---- pure: pull-merge normalization ---- */

const pushedEv = (over = {}) => ({
  id: "ev_x", title: "Camp", startAt: new Date(2026, 6, 25).toISOString(), endAt: null,
  allDay: true, location: "", notes: "",
  updatedAt: new Date(2026, 6, 1).toISOString(),
  provenance: { googleEventId: "g1", pushedAt: Date.parse("2026-07-10T00:00:00Z"), lastMergeAt: 0 },
  ...over,
});

test("pull normalizes Google date form back to allDay + local-midnight stamps (round-trip: no false diff)", () => {
  const ev = pushedEv();
  const gev = { summary: "Camp", start: { date: "2026-07-25" }, end: { date: "2026-07-26" }, location: "", description: "", updated: "2026-07-09T00:00:00Z" };
  // Same content in Google form → no merge, no conflict.
  assert.equal(mergeGoogleEdit({ ev, gev }).action, "none");
});

test("Google-side all-day extension merges as inclusive endAt + allDay:true", () => {
  const ev = pushedEv();
  const gev = { summary: "Camp", start: { date: "2026-07-25" }, end: { date: "2026-07-28" }, location: "", description: "", updated: "2026-07-12T00:00:00Z" };
  const d = mergeGoogleEdit({ ev, gev });
  assert.equal(d.action, "merge");
  assert.equal(d.fields.allDay, true);
  assert.equal(d.fields.startAt, new Date(2026, 6, 25).toISOString());
  assert.equal(d.fields.endAt, new Date(2026, 6, 27).toISOString(), "exclusive end.date → inclusive endAt");
});

/* ---- server passthrough (isolated harness — real request path) ---- */

test("POST /events stores allDay:true and PATCH can flip it off", async () => {
  const start = new Date(2026, 6, 25);
  const created = await adult.req("/api/events", {
    method: "POST",
    body: JSON.stringify({ title: "TG allday", startAt: start.toISOString(), allDay: true }),
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.event.allDay, true, "allDay persisted on create");

  const listed = await adult.req("/api/events");
  assert.equal(listed.data.events.find((e) => e.id === created.data.event.id)?.allDay, true);

  const patched = await adult.req(`/api/events/${created.data.event.id}`, {
    method: "PATCH", body: JSON.stringify({ allDay: false, startAt: "2026-07-25T09:00:00.000Z" }),
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.event.allDay, false, "PATCH passthrough");
});

test("POST /events without allDay stays a plain timed/unflagged event", async () => {
  const created = await adult.req("/api/events", {
    method: "POST", body: JSON.stringify({ title: "TG timed", startAt: "2026-07-25T09:00:00.000Z" }),
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.event.allDay, false);
});
