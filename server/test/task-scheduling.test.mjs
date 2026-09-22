// H2–H7 — a task is a scheduled item, not a sticky note.
//
// From the 2026-07-25 walkthrough, at the Tasks screen:
//   [21:49] "It should have a start date and time and an end date and time, like a calendar
//           item — not just today, tomorrow, next week."
//   [22:09] "There's no notes or description field. You can't type all that into the title."
//   [22:19] "Reminders — 15 minutes before, 30 minutes before — producing a real notification."
//   [23:18] "When a task has a date it should append to the calendar, and push to that
//           person's Google account."
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner;
before(async () => { ctx = await startServer(); owner = await makeSession(ctx, "m-alex"); });
after(async () => { await stopServer(ctx); });

const mkTask = (body) => owner.req("/api/tasks", { method: "POST", body: JSON.stringify(body) });

test("a task carries a real start, end, notes and reminder — H2, H4, H5", async () => {
  const r = await mkTask({
    title: "Rake the leaves",
    startAt: "2026-08-01T15:00:00.000Z", endAt: "2026-08-01T16:30:00.000Z",
    notes: "Bags are in the garage. Do the front first.",
    remindMinutesBefore: 30,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.task.startAt, "2026-08-01T15:00:00.000Z");
  assert.equal(r.data.task.endAt, "2026-08-01T16:30:00.000Z");
  assert.match(r.data.task.notes, /Bags are in the garage/);
  assert.equal(r.data.task.remindMinutesBefore, 30);
  assert.equal(r.data.task.reminderSentAt, null, "a fresh task's reminder is armed, not spent");
});

test("an unparseable date is refused, not stored to render as \"Invalid Date\"", async () => {
  const r = await mkTask({ title: "Bad", startAt: "next tuesday-ish" });
  assert.equal(r.status, 400);
  // Named per field now (invalid_startAt / invalid_endAt / invalid_dueAt), the way events
  // always were — one vocabulary for both surfaces, from the declared action.
  assert.equal(r.data.error, "invalid_startAt");
});

test("only the reminder offsets a screen can explain are storable", async () => {
  assert.equal((await mkTask({ title: "Odd", remindMinutesBefore: 7 })).status, 400);
  assert.equal((await mkTask({ title: "Fine", remindMinutesBefore: 15 })).status, 200);
  assert.equal((await mkTask({ title: "None", remindMinutesBefore: null })).status, 200);
});

test("MOVING a task re-arms its reminder — otherwise it silently never nudges again", async () => {
  const c = await mkTask({ title: "Dentist", startAt: "2026-08-01T15:00:00.000Z", remindMinutesBefore: 15 });
  const id = c.data.task.id;
  await owner.req(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ reminderSentAt: new Date().toISOString() }) });
  const moved = await owner.req(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ startAt: "2026-08-05T15:00:00.000Z" }) });
  assert.equal(moved.data.task.reminderSentAt, null, "a task pushed to a new day must nudge again");
});

test("changing only the title leaves a spent reminder spent — no duplicate nudge", async () => {
  const c = await mkTask({ title: "Vet", startAt: "2026-08-01T15:00:00.000Z", remindMinutesBefore: 15 });
  const id = c.data.task.id;
  const sent = new Date().toISOString();
  await owner.req(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ reminderSentAt: sent }) });
  const r = await owner.req(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ title: "Vet appointment" }) });
  assert.equal(r.data.task.reminderSentAt, sent);
});

/* ---- H7: onto the calendar, owned by the person it's assigned to ---- */

test("a dated task lands on the calendar, owned by its ASSIGNEE", async () => {
  const c = await mkTask({ title: "Take out bins", startAt: "2026-08-02T18:00:00.000Z", assignedMemberId: "m-noah", notes: "Blue bin week" });
  const id = c.data.task.id;
  const r = await owner.req(`/api/tasks/${id}/to-calendar`, { method: "POST", body: "{}" });
  assert.equal(r.status, 200);
  assert.equal(r.data.action, "created");
  assert.equal(r.data.event.title, "Take out bins");
  assert.equal(r.data.event.startAt, "2026-08-02T18:00:00.000Z");
  assert.equal(r.data.event.notes, "Blue bin week");
  // "push to THAT PERSON'S Google account" — the owner is who the task belongs to, not who
  // happened to press the button.
  assert.equal(r.data.event.ownerId, "m-noah");
  assert.deepEqual(r.data.event.participantIds, ["m-noah"]);
  assert.equal(r.data.event.taskId, id);
});

test("adding it twice UPDATES the same event instead of duplicating it", async () => {
  const c = await mkTask({ title: "Water plants", startAt: "2026-08-03T09:00:00.000Z" });
  const id = c.data.task.id;
  const first = await owner.req(`/api/tasks/${id}/to-calendar`, { method: "POST", body: "{}" });
  await owner.req(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ startAt: "2026-08-03T10:00:00.000Z" }) });
  const second = await owner.req(`/api/tasks/${id}/to-calendar`, { method: "POST", body: "{}" });
  assert.equal(second.data.action, "updated");
  assert.equal(second.data.event.id, first.data.event.id);
  assert.equal(second.data.event.startAt, "2026-08-03T10:00:00.000Z");
  const evs = await owner.req("/api/events");
  assert.equal(evs.data.events.filter((e) => e.taskId === id).length, 1, "one task, one event");
});

test("an undated task is refused with the reason, not silently ignored", async () => {
  const c = await mkTask({ title: "Someday" });
  const r = await owner.req(`/api/tasks/${c.data.task.id}/to-calendar`, { method: "POST", body: "{}" });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "date_required");
  assert.match(r.data.message, /date/i);
});

test("the task remembers it's on the calendar", async () => {
  const c = await mkTask({ title: "Oil change", dueAt: "2026-08-04T12:00:00.000Z" });
  const id = c.data.task.id;
  const r = await owner.req(`/api/tasks/${id}/to-calendar`, { method: "POST", body: "{}" });
  const all = await owner.req("/api/tasks");
  assert.equal(all.data.tasks.find((t) => t.id === id).eventId, r.data.event.id);
});

test("dueAt alone is enough — not every task has a start time", async () => {
  const c = await mkTask({ title: "Return library books", dueAt: "2026-08-06T17:00:00.000Z" });
  const r = await owner.req(`/api/tasks/${c.data.task.id}/to-calendar`, { method: "POST", body: "{}" });
  assert.equal(r.status, 200);
  assert.equal(r.data.event.startAt, "2026-08-06T17:00:00.000Z");
});
