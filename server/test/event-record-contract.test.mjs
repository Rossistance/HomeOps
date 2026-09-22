/* EVERY STORED EVENT FITS THE ONE DECLARED RECORD — and GET /api/events returns nothing else.
 *
 * EVENT_RECORD (server/actions/schemas/event.mjs) is what both clients' event types are
 * generated from. It was declared by reading seven writers; this is where reading is
 * replaced by running them. Each setup step below is a different writer or a different
 * patch path — the declared action, the attendees route, a request, a private note, task
 * → calendar, meal → calendar, an ICS import — and then every event the API returns is
 * validated with unknown keys REJECTED, so a field written anywhere but declared nowhere
 * fails here with its name.
 *
 * GET /api/events itself is not rewritten as an action in this slice. Its shape is
 * enforced anyway: that is the point of this file.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { validateInput } from "../actions/define-action.mjs";
import { EVENT_RECORD } from "../actions/schemas/event.mjs";
import { createEvent } from "../actions/events.mjs";

let ctx, adult, owner;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin — creates, so owns
  owner = await makeSession(ctx, "m-alex");   // Owner — a different person, to ask things of it
});
after(async () => { await stopServer(ctx); });

const ok200 = (r, what) => { assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.data)}`); return r.data; };
const fits = (ev, what) => {
  const v = validateInput(EVENT_RECORD, ev, { unknown: "reject" });
  assert.ok(v.ok, `${what} (${ev.id}, layer ${ev.layer}, via ${ev.provenance?.via}) does not fit EVENT_RECORD: ${v.field} — ${v.message}`);
};

const ICS = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//contract//test//EN",
  "BEGIN:VEVENT", "UID:contract-linked-1", "DTSTART:20310701T100000Z", "DTEND:20310701T110000Z", "SUMMARY:Linked from a feed", "LOCATION:The rink", "END:VEVENT",
  "END:VCALENDAR", "",
].join("\r\n");

let created;

test("SETUP: seven different writers put events on the calendar", async () => {
  // 1. The declared action, through HTTP, with everything the form can send.
  created = ok200(await adult.req("/api/events", { method: "POST", body: JSON.stringify({
    title: "Recital", startAt: "2031-06-01T18:00:00Z", endAt: "2031-06-01T19:30:00Z", location: "School hall",
    notes: "Bring flowers", participantIds: ["m-lily"], driverId: "m-morgan", whatToBring: ["Camera", { item: "Water", memberId: "m-lily" }],
    checklist: [{ text: "Tune violin" }], remindOffsets: [30, 1440], visibility: "household",
  }) }), "POST /api/events").event;
  // 2. Who's coming — the attendees route writes attendees[] and keeps participantIds in step.
  ok200(await adult.req(`/api/events/${created.id}/attendees`, { method: "POST", body: JSON.stringify({ memberIds: ["m-lily", "m-noah"] }) }), "attendees");
  // 3. A polite door — someone else asks to come.
  ok200(await owner.req(`/api/events/${created.id}/request-attend`, { method: "POST", body: "{}" }), "request-attend");
  // 4. A private margin.
  ok200(await owner.req(`/api/events/${created.id}`, { method: "PATCH", body: JSON.stringify({ localNotes: "park on the north side" }) }), "PATCH localNotes");
  // 5. A task put on the calendar.
  const task = ok200(await adult.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Fix the gate", startAt: "2031-06-02T10:00:00Z", endAt: "2031-06-02T11:00:00Z" }) }), "POST /api/tasks").task;
  ok200(await adult.req(`/api/tasks/${task.id}/to-calendar`, { method: "POST", body: "{}" }), "task → calendar");
  // 6. A meal put on the calendar.
  const meal = ok200(await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Chili", date: "2031-06-03", slot: "dinner" }) }), "POST /api/meals").meal;
  ok200(await adult.req(`/api/meals/${meal.id}/to-calendar`, { method: "POST", body: "{}" }), "meal → calendar");
  // 7. A linked event, mirrored from a pasted feed.
  ok200(await adult.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "Rink", ics: ICS }) }), "import-ics");
});

test("EVERY EVENT GET /api/events RETURNS FITS EVENT_RECORD, WITH NO UNDECLARED KEY", async () => {
  const events = ok200(await adult.req("/api/events"), "GET /api/events").events;
  const layers = new Set(events.map((e) => e.layer));
  const vias = new Set(events.map((e) => e.provenance?.via));
  assert.ok(events.length >= 4, `the setup produced the writers' events: ${events.length}`);
  assert.ok(layers.has("canonical") && layers.has("linked"), `both stored layers are exercised: ${[...layers]}`);
  for (const via of ["user", "task", "meal", "ics"]) assert.ok(vias.has(via), `writer "${via}" is exercised: ${[...vias]}`);
  for (const ev of events) fits(ev, "a listed event");

  const mine = events.find((e) => e.id === created.id);
  assert.ok(mine);
  // The per-viewer decorations GET adds are declared too — and were never in the web type.
  assert.equal(mine.appendable, true);
  assert.equal(typeof mine.editable, "boolean");
  assert.equal(mine.myNotes, null, "the adult wrote no private note; the owner did");
  const theirs = ok200(await owner.req("/api/events"), "GET as the requester").events.find((e) => e.id === created.id);
  assert.equal(theirs.myNotes?.note, "park on the north side", "a private note is the viewer's, merged per request");
  fits(theirs, "the same event seen by another viewer");
  // What the setup wrote is what the record declares.
  assert.deepEqual(mine.attendees.map((a) => [a.memberId, a.status, a.respondedAt]), [["m-lily", "invited", null], ["m-noah", "invited", null]]);
  assert.equal(mine.requests.attend[0].actorId, "m-alex");
  assert.deepEqual(mine.whatToBring, [{ item: "Camera", memberId: null }, { item: "Water", memberId: "m-lily" }]);
  assert.deepEqual(mine.checklist, [{ text: "Tune violin", done: false }]);
  assert.deepEqual(mine.remindOffsets, [30, 1440]);
});

test("the action's own output schema holds for what it returned", () => {
  const v = validateInput(createEvent.output, { event: created }, { unknown: "reject", defs: createEvent.$defs });
  assert.ok(v.ok, `${v.field} — ${v.message}`);
});

test("a stored event is refused by the same validator when a writer invents a field", () => {
  const v = validateInput(EVENT_RECORD, { ...created, colour: "teal" }, { unknown: "reject" });
  assert.equal(v.ok, false); assert.equal(v.field, "colour");
});

test("EVERY WRITER NOW SHARES ONE SET OF DEFAULTS — a synced event has the same keys as a typed one", async () => {
  /* Before newEventRecord, an ICS mirror had no `notes`, no `nestId`, no `remindersSent`,
   * and a task → calendar event had no `allDay`; each writer spelled out its own idea of
   * the record. Now the structural keys are present on every event regardless of door. */
  const events = ok200(await adult.req("/api/events"), "GET /api/events").events;
  const structural = ["startAt", "endAt", "allDay", "notes", "location", "spaceId", "participantIds", "driverId", "ownerId", "backupOwnerId",
    "whatToBring", "checklist", "travel", "reminders", "attachments", "comments", "mealImpact", "remindersSent", "visibility", "nestId",
    "category", "layer", "status", "source", "provenance", "createdBy", "createdAt", "updatedAt"];
  for (const ev of events) {
    const missing = structural.filter((k) => !(k in ev));
    assert.deepEqual(missing, [], `${ev.provenance?.via} (${ev.layer}) lacks ${missing.join(", ")}`);
    assert.equal(typeof ev.createdAt, "number");
  }
  const linked = events.find((e) => e.layer === "linked");
  assert.ok(linked && linked.notes === "" && linked.nestId === null && Array.isArray(linked.remindersSent), "the ICS mirror got the same defaults");
});
