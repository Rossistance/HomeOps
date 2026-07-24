// WP-003 (ISS-004/005): allDay model concept — server passthrough + Google
// `date`-vs-`dateTime` payload forms + pull-merge normalization.
// Pure fixtures + isolated harness server; NEVER a live Google call (DEC-08).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { googleEventTimes, mergeGoogleEdit, mapGoogleEvents, normalizeAllDaySpan } from "../calendar.mjs";

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

/* ---- ISS-104: subscription-sync ingest normalizes EXCLUSIVE all-day ends ----
 * mergeGoogleEdit (above) always normalized, but the SUBSCRIPTION sync path stored
 * Google's exclusive `end.date` verbatim — so every all-day event rendered one day too
 * long. The .ics path had the identical defect (RFC 5545 DTEND;VALUE=DATE is exclusive
 * too). Both now converge on normalizeAllDaySpan at the ingest boundary. */

// Mirrors the clients' coversDay (apps/mobile/src/lib/event-days.ts): a day is covered
// when it falls between the start day and the INCLUSIVE end day.
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
function coveredDays(ev) {
  const s = startOfDay(new Date(ev.startAt));
  const e = ev.endAt ? startOfDay(new Date(ev.endAt)) : s;
  let n = 0;
  for (const d = new Date(s); +d <= Math.max(+s, +e); d.setDate(d.getDate() + 1)) n++;
  return n;
}

test("ISS-104: a 1-day Google all-day event covers exactly 1 day", () => {
  // Google sends a single-day all-day event as start 07-25 / end 07-26 (end EXCLUSIVE).
  const [ev] = mapGoogleEvents([{ id: "g1", summary: "Anniversary", start: { date: "2026-07-25" }, end: { date: "2026-07-26" } }]).map(normalizeAllDaySpan);
  assert.equal(ev.allDay, true);
  assert.equal(ev.startAt, new Date(2026, 6, 25).toISOString(), "local midnight, not UTC (UTC renders a day early in the US)");
  assert.equal(ev.endAt, null, "single-day ⇒ no end at all");
  assert.equal(coveredDays(ev), 1, "the audited bug: this used to cover 2 days");
});

test("ISS-104: a 3-day Google all-day event covers exactly 3 days", () => {
  const [ev] = mapGoogleEvents([{ id: "g2", summary: "Camp", start: { date: "2026-07-25" }, end: { date: "2026-07-28" } }]).map(normalizeAllDaySpan);
  assert.equal(ev.endAt, new Date(2026, 6, 27).toISOString(), "exclusive 07-28 → inclusive 07-27");
  assert.equal(coveredDays(ev), 3);
});

test("ISS-104: the same normalization fixes .ics DTEND;VALUE=DATE (exclusive per RFC 5545)", () => {
  // parseICS yields the same intermediate shape — date-only stamps for VALUE=DATE.
  const ev = normalizeAllDaySpan({ uid: "i1", title: "Break", startAt: "2026-07-25", endAt: "2026-07-28", allDay: true });
  assert.equal(ev.endAt, new Date(2026, 6, 27).toISOString());
  assert.equal(coveredDays(ev), 3);
});

test("ISS-104: normalization is idempotent — re-syncing never shifts a span twice", () => {
  const once = normalizeAllDaySpan({ startAt: "2026-07-25", endAt: "2026-07-28", allDay: true });
  const twice = normalizeAllDaySpan(once);
  assert.deepEqual(twice, once, "second pass is a no-op (only date-only stamps are rewritten)");
  assert.equal(coveredDays(twice), 3);
});

test("ISS-104: timed events pass through untouched", () => {
  const src = { startAt: "2026-07-25T14:00:00.000Z", endAt: "2026-07-25T15:00:00.000Z", allDay: false };
  assert.deepEqual(normalizeAllDaySpan(src), src);
});

test("ISS-104 round-trip (both directions): Google → FamiliOS → Google is lossless", () => {
  for (const g of [
    { start: { date: "2026-07-25" }, end: { date: "2026-07-26" } }, // 1 day
    { start: { date: "2026-07-25" }, end: { date: "2026-07-28" } }, // 3 days
  ]) {
    const [ev] = mapGoogleEvents([{ id: "g", summary: "x", ...g }]).map(normalizeAllDaySpan);
    assert.deepEqual(googleEventTimes(ev), g, "ingest then push must return the original payload");
  }
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
