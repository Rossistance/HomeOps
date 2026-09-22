/* THE HTTP DOOR FOR A DECLARED ACTION, AND THE WIRE IT KEEPS.
 *
 * POST /api/events used to be a hand-written block in index.mjs; it is now answered by the
 * same `run` the agent tool uses, with via:"user". Everything this file pins in the first
 * half is what the hand-written route already did — the exact mobile payload, the role
 * floor, the refusals and their codes — so the move is provably not a change. The second
 * half is the behaviour the route GAINED by sharing the tool's checks (ADR-003's ledger):
 * a participant who does not exist, an end before its start, a date-only start.
 *
 * The last test reads index.mjs as text. A declared route dispatches first, so a stale
 * hand-written copy would never run — but it would still be read, and believed.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult, child;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-lily");   // Child View — below the Limited Member floor
});
after(async () => { await stopServer(ctx); });

/** The exact body apps/mobile event-form.tsx save() sends on create — INCLUDING localNotes,
 *  which no route ever read. */
const mobileCreateBody = (over = {}) => ({
  title: "Dentist", startAt: new Date(2026, 7, 12, 9, 0).toISOString(), endAt: null,
  allDay: false, notes: "", location: "", localNotes: "bring the insurance card", driverId: null, whatToBring: [], remindOffsets: [],
  visibility: "household", ...over,
});
const post = (who, body) => who.req("/api/events", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

/* ───────────────── what the hand-written route did, kept ───────────────── */

test("THE MOBILE FORM'S EXACT PAYLOAD STILL CREATES A CONFIRMED EVENT", async () => {
  const r = await post(adult, mobileCreateBody());
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ev = r.data.event;
  assert.ok(ev?.id?.startsWith("ev_"));
  assert.equal(ev.status, "confirmed", "a person's event is not a draft");
  assert.equal(ev.provenance.via, "user");
  assert.equal("runId" in ev.provenance, false, "no run is acting");
  assert.equal(ev.layer, "canonical");
  assert.equal(ev.source, "FamiliOS");
  assert.deepEqual(ev.remindersSent, []);
  assert.equal(ev.ownerId, "m-morgan");
  assert.equal("localNotes" in ev, false, "an undeclared key is stripped, not stored — exactly what the old route did with it");
  const listed = await adult.req("/api/events");
  assert.ok(listed.data.events.some((e) => e.id === ev.id), "and it is in GET /api/events");
});

test("the role floor, the JSON gate and the reminder list refuse with the same codes", async () => {
  const c = await post(child, mobileCreateBody());
  assert.equal(c.status, 403); assert.equal(c.data.error, "insufficient_role");
  const m = await post(adult, "{not json");
  assert.equal(m.status, 400); assert.equal(m.data.error, "malformed_json");
  const rem = await post(adult, mobileCreateBody({ remindOffsets: [7] }));
  assert.equal(rem.status, 400); assert.equal(rem.data.error, "bad_reminder");
  const nest = await post(adult, mobileCreateBody({ visibility: "nest", nestId: "nest_nope" }));
  assert.equal(nest.status, 403); assert.equal(nest.data.error, "not_in_nest");
  const blank = await post(adult, mobileCreateBody({ title: "   " }));
  assert.equal(blank.status, 400); assert.equal(blank.data.error, "empty_title");
  const bad = await post(adult, mobileCreateBody({ startAt: "not-a-date" }));
  assert.equal(bad.status, 400); assert.equal(bad.data.error, "invalid_startAt");
});

test("the create is audited under the same type", async () => {
  const r = await post(adult, mobileCreateBody({ title: "Audited" }));
  const rows = (await adult.req("/api/audit?limit=50")).data.events;
  const row = rows.find((a) => a.type === "event.create" && a.eventId === r.data.event.id);
  assert.ok(row, `event.create names the event: ${JSON.stringify(rows.map((a) => a.type))}`);
  assert.equal(row.actorId, "m-morgan");
});

/* ───────────────── what the route GAINED by sharing the tool's run ───────────────── */

test("A PARTICIPANT WHO DOES NOT EXIST IS REFUSED, NAMED — the route used to store the ghost", async () => {
  const r = await post(adult, mobileCreateBody({ participantIds: ["m-lily", "m-ghost"] }));
  assert.equal(r.status, 400); assert.equal(r.data.error, "unknown_member");
  assert.match(r.data.message, /m-ghost/);
  const d = await post(adult, mobileCreateBody({ driverId: "m-nobody" }));
  assert.equal(d.data.error, "unknown_member");
});

test("an end before its start is refused — the route used to drop it to null silently", async () => {
  const r = await post(adult, mobileCreateBody({ startAt: "2031-05-01T15:00:00Z", endAt: "2031-05-01T14:00:00Z" }));
  assert.equal(r.status, 400); assert.equal(r.data.error, "end_before_start");
  const same = await post(adult, mobileCreateBody({ startAt: "2031-05-01T15:00:00Z", endAt: "2031-05-01T15:00:00Z" }));
  assert.equal(same.status, 200); assert.equal(same.data.event.endAt, null, "equal is still 'no end'");
});

test("a date-only start is an all-day event on the household's midnight — the route used to store the bare date", async () => {
  const r = await post(adult, mobileCreateBody({ startAt: "2030-05-05", allDay: false }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.event.allDay, true);
  assert.match(r.data.event.startAt, /^2030-05-05T\d\d:00:00\.000Z$/, "anchored to a real midnight, like the tool");
});

test("a wrong TYPE is refused with the field named — the route used to coerce or drop it", async () => {
  const r = await post(adult, mobileCreateBody({ allDay: "yes" }));
  assert.equal(r.status, 400); assert.equal(r.data.error, "invalid_input"); assert.equal(r.data.field, "allDay");
});

/* ───────────────── the route cannot be re-declared by hand ───────────────── */

test("INDEX.MJS NO LONGER HAND-WRITES A ROUTE A DECLARED ACTION OWNS, and dispatches actions first", async () => {
  const src = await fs.promises.readFile(new URL("../index.mjs", import.meta.url), "utf8");
  assert.equal(src.includes('path === "/api/events" && method === "POST"'), false,
    "a hand-written POST /api/events would be dead code that is still read and believed");
  assert.equal(src.includes('path === "/api/events" && method === "GET"'), false, "…and the same for the declared read");
  const seam = src.indexOf("handleActionRoutes({");
  const health = src.indexOf('path === "/api/health"');
  const limits = src.indexOf("routing order is the firewall order");
  assert.ok(seam > 0 && health > 0 && limits > 0);
  assert.ok(limits < seam && seam < health, "after the rate limits, before every other route");
});
