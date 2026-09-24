// The side doors onto an event (ADR-005 privacy review, second pass), through the real server.
//
// event-obscuring.test.mjs pins the event routes themselves. This pins the doors that reach an
// event WITHOUT being an event route, and the by-id event routes against a Limited Member's
// calendar scope:
//
//  - a task or a meal linked to an event its owner has since hidden is no way to write on it:
//    the task/meal change goes through, the hidden event stays exactly as its owner left it,
//    a re-push to the calendar is refused with event_hidden, and no reply carries the record;
//  - an event outside a Limited Member's Owner-set calendar scope is "not found" at every
//    by-id event door — the 409 body and the viewer-note reply included — never the record.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, readStoreRecord } from "./harness.mjs";

const SECRET_PLACE = "Globex HQ";
const OWNER_DINNER = "Owner private dinner plans";
const OWNER_NOTES = "secret notes about the dinner";

let ctx, owner, casey, riley;
const share = (who, id, hidden) => who.req("/api/events/sharing", { method: "POST", body: JSON.stringify({ id, hidden }) });
const leaks = (r, ...secrets) => secrets.filter((s) => JSON.stringify(r.data ?? {}).includes(s));

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex"); // household Owner
  const am = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Casey Quinn", role: "Adult Member" }) });
  const lm = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Riley Quinn", role: "Limited Member" }) });
  casey = await makeSession(ctx, am.data.member.actorId);
  riley = await makeSession(ctx, lm.data.member.actorId);
});
after(async () => { await stopServer(ctx); });

/** Casey's task, pushed to the calendar (so the event is hers), given a place, then hidden. */
async function caseyHiddenTaskEvent(title) {
  const t = await casey.req("/api/tasks", { method: "POST", body: JSON.stringify({ title, dueAt: "2031-03-04T15:00:00Z", assignedMemberId: casey.actorId }) });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const taskId = t.data.task.id;
  const c = await casey.req(`/api/tasks/${taskId}/to-calendar`, { method: "POST", body: "{}" });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const eventId = c.data.event.id;
  assert.equal(readStoreRecord(ctx, "events", eventId).ownerId, casey.actorId, "the assignee owns the event");
  const p = await casey.req(`/api/events/${eventId}`, { method: "PATCH", body: JSON.stringify({ location: SECRET_PLACE }) });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const h = await share(casey, eventId, true);
  assert.equal(h.status, 200, JSON.stringify(h.data));
  return { taskId, eventId, before: readStoreRecord(ctx, "events", eventId) };
}

test("a task's to-calendar on someone else's hidden event is refused with event_hidden and carries nothing of it", async () => {
  const { taskId, eventId, before } = await caseyHiddenTaskEvent("Interview prep");
  for (const who of [riley, owner]) {
    const r = await who.req(`/api/tasks/${taskId}/to-calendar`, { method: "POST", body: "{}" });
    assert.equal(r.status, 403, `${who.actorId}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.error, "event_hidden");
    assert.deepEqual(leaks(r, SECRET_PLACE, eventId), [], `${who.actorId}: nothing of the event in the reply`);
  }
  assert.deepEqual(readStoreRecord(ctx, "events", eventId), before, "the hidden event was not touched");
  // Its owner still can — and gets it back as her own screen shows it, not the raw record.
  const mine = await casey.req(`/api/tasks/${taskId}/to-calendar`, { method: "POST", body: "{}" });
  assert.equal(mine.status, 200, JSON.stringify(mine.data));
  assert.equal(mine.data.event.id, eventId);
  assert.equal(mine.data.event.privacy?.obscured, true, "presented through event-privacy (the owner's decoration)");
});

test("editing or deleting the task — even as the household Owner — leaves the hidden event as its owner left it", async () => {
  const { taskId, eventId, before } = await caseyHiddenTaskEvent("Dentist for Casey");
  const e = await owner.req(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ title: "Owner renamed", dueAt: "2031-03-05T15:00:00Z" }) });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal(e.data.task.title, "Owner renamed", "the task change itself goes through");
  const ev = readStoreRecord(ctx, "events", eventId);
  assert.equal(ev.title, before.title, "the hidden event keeps its owner's title");
  assert.equal(ev.startAt, before.startAt, "…and its time");
  const d = await owner.req(`/api/tasks/${taskId}`, { method: "DELETE" });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.equal(d.data.removedEvents, 0, "the hidden event is not counted as removed");
  assert.ok(readStoreRecord(ctx, "events", eventId), "the hidden event still exists — it is its owner's to delete");
});

test("a meal's to-calendar, edit and delete leave its creator's hidden event alone", async () => {
  const m = await casey.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Anniversary dinner", date: "2031-04-10", slot: "dinner" }) });
  assert.equal(m.status, 200, JSON.stringify(m.data));
  const mealId = m.data.meal.id;
  const c = await casey.req(`/api/meals/${mealId}/to-calendar`, { method: "POST", body: "{}" });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const eventId = c.data.event.id;
  await casey.req(`/api/events/${eventId}`, { method: "PATCH", body: JSON.stringify({ location: SECRET_PLACE }) });
  assert.equal((await share(casey, eventId, true)).status, 200);
  const before = readStoreRecord(ctx, "events", eventId);

  const r = await riley.req(`/api/meals/${mealId}/to-calendar`, { method: "POST", body: "{}" });
  assert.equal(r.status, 403, JSON.stringify(r.data));
  assert.equal(r.data.error, "event_hidden");
  assert.deepEqual(leaks(r, SECRET_PLACE), []);

  const e = await owner.req(`/api/meals/${mealId}`, { method: "PATCH", body: JSON.stringify({ title: "Taco night", date: "2031-04-11" }) });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal(e.data.eventSynced, false, "the reply says the event did not move");
  assert.deepEqual(readStoreRecord(ctx, "events", eventId), before, "the hidden event was not rewritten");

  const d = await owner.req(`/api/meals/${mealId}`, { method: "DELETE" });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.equal(d.data.removedEvents, 0);
  assert.ok(readStoreRecord(ctx, "events", eventId), "retiring the meal does not reach through the hide");
});

test("an event outside a Limited Member's calendar scope is not found at every by-id door — never the record", async () => {
  const mk = await owner.req("/api/events", { method: "POST", body: JSON.stringify({ title: OWNER_DINNER, notes: OWNER_NOTES, startAt: "2031-05-02T23:00:00Z" }) });
  assert.equal(mk.status, 200, JSON.stringify(mk.data));
  const id = mk.data.event.id;
  const sc = await owner.req(`/api/members/${riley.actorId}/calendar-scope`, { method: "PUT", body: JSON.stringify({ scope: { members: { "m-alex": "none" } } }) });
  assert.equal(sc.status, 200, JSON.stringify(sc.data));
  const list = await riley.req("/api/events");
  assert.equal(list.data.events.some((e) => e.id === id), false, "the calendar already leaves it out");

  const doors = [
    ["PATCH", `/api/events/${id}`, { ifUpdatedAt: "x" }],
    ["PATCH", `/api/events/${id}`, { localNotes: "hi" }],
    ["POST", `/api/events/${id}`, { localNotes: "hi" }],
    ["POST", `/api/events/${id}/rsvp`, { status: "accepted" }],
    ["POST", `/api/events/${id}/attendees`, { memberIds: [riley.actorId] }],
    ["POST", `/api/events/${id}/request-attend`, {}],
    ["POST", `/api/events/${id}/offer-drive`, {}],
    ["POST", `/api/events/${id}/suggest-bring`, { item: "chips" }],
    ["POST", `/api/events/${id}/requests/respond`, { kind: "attend", actorId: riley.actorId, accept: true }],
    ["DELETE", `/api/events/${id}`, null],
    ["POST", "/api/events/sharing", { id, hidden: false }],
  ];
  for (const [method, url, body] of doors) {
    const r = await riley.req(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(r.status, 404, `${method} ${url} ${JSON.stringify(body)} → ${r.status} ${JSON.stringify(r.data)}`);
    assert.equal(r.data.error, "not_found");
    assert.deepEqual(leaks(r, OWNER_DINNER, OWNER_NOTES), [], `${method} ${url}: nothing of the event`);
  }
  const stored = readStoreRecord(ctx, "events", id);
  assert.equal(stored.title, OWNER_DINNER);
  assert.equal((stored.requests?.attend ?? []).length, 0, "no request was filed on it");
  // An in-scope event is untouched by the rule: the owner's own 409 still carries it,
  // presented (the owner's decoration), not raw.
  const own = await owner.req(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify({ ifUpdatedAt: "x" }) });
  assert.equal(own.status, 409, JSON.stringify(own.data));
  assert.equal(own.data.current.title, OWNER_DINNER);
  assert.ok(own.data.current.privacy, "the 409 body is presented through event-privacy");
});
