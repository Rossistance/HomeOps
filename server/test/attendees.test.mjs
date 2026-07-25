// E5/E6/E7 — who's coming, told, and answering.
//
//   [12:26] "Replace or augment 'note for driver' with WHO'S ATTENDING — let me pick GPop,
//            Beannie, Melissa."
//   [12:56] "Selecting them should notify them, or at least inform them they're on it."
//   [13:07] "And they should be able to accept or decline, like a meeting invite."
//
// Two behaviours carry most of the weight: an existing answer survives an edit to the list
// (or declining is pointless — the next save resets it), and nobody can answer for anybody
// else (or an RSVP means nothing).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, alex, noah;
before(async () => {
  ctx = await startServer();
  alex = await makeSession(ctx, "m-alex");   // Owner
  noah = await makeSession(ctx, "m-noah");   // Child View
});
after(async () => { await stopServer(ctx); });

async function newEvent(over = {}) {
  const r = await alex.req("/api/events", {
    method: "POST",
    body: JSON.stringify({ title: "Movie night", startAt: "2026-08-10T23:00:00.000Z", location: "St. Jude", ...over }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.event;
}
const setAttendees = (id, memberIds, as = alex) =>
  as.req(`/api/events/${id}/attendees`, { method: "POST", body: JSON.stringify({ memberIds }) });
const rsvp = (id, body, as = alex) =>
  as.req(`/api/events/${id}/rsvp`, { method: "POST", body: JSON.stringify(body) });

test("E5: picking who's attending records them as invited", async () => {
  const ev = await newEvent();
  const r = await setAttendees(ev.id, ["m-alex", "m-noah"]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.event.attendees.map((a) => a.memberId).sort(), ["m-alex", "m-noah"]);
  for (const a of r.data.event.attendees) {
    assert.equal(a.status, "invited", "nobody is assumed to have accepted");
    assert.equal(a.respondedAt, null);
  }
});

test("E5: participantIds stays in step, so nothing downstream has to learn a new field", async () => {
  const ev = await newEvent();
  const r = await setAttendees(ev.id, ["m-noah"]);
  assert.deepEqual(r.data.event.participantIds, ["m-noah"]);
});

test("E5: an id nobody in the household holds is dropped, not stored", async () => {
  const ev = await newEvent();
  const r = await setAttendees(ev.id, ["m-noah", "m-ghost-of-nobody"]);
  assert.deepEqual(r.data.event.attendees.map((a) => a.memberId), ["m-noah"]);
});

test("E6: newly added attendees are actually notified — and only the new ones", async () => {
  const ev = await newEvent();
  const first = await setAttendees(ev.id, ["m-noah"]);
  assert.equal(first.data.notified, 1, "Beannie is told she's on it");
  // Adding a second person must not re-ping the first.
  const second = await setAttendees(ev.id, ["m-noah", "m-lily"]);
  assert.equal(second.data.notified, 1, "only the person who wasn't already on it");
  // And the notification is durable, not just a push that a dead phone would miss.
  const inbox = await noah.req("/api/notifications");
  assert.ok(
    (inbox.data.notifications ?? []).some((n) => /Movie night/.test(n.title ?? "") || /Movie night/.test(n.body ?? "")),
    "an in-app record survives a phone that was off",
  );
});

test("E6: adding YOURSELF doesn't send you a notification", async () => {
  const ev = await newEvent();
  const r = await setAttendees(ev.id, ["m-alex"]);
  assert.equal(r.data.notified, 0);
});

test("E7: an attendee accepts, and it's stamped", async () => {
  const ev = await newEvent();
  await setAttendees(ev.id, ["m-noah"]);
  const r = await rsvp(ev.id, { status: "accepted" }, noah);
  assert.equal(r.status, 200);
  const mine = r.data.event.attendees.find((a) => a.memberId === "m-noah");
  assert.equal(mine.status, "accepted");
  assert.ok(mine.respondedAt, "when they answered is recorded");
});

test("E7: THE ONE THAT MATTERS — an answer survives a later edit to the list", async () => {
  const ev = await newEvent();
  await setAttendees(ev.id, ["m-noah"]);
  await rsvp(ev.id, { status: "declined" }, noah);
  // The organizer adds someone else. Beannie's "no" must still be a no.
  const after = await setAttendees(ev.id, ["m-noah", "m-lily"]);
  const noahRow = after.data.event.attendees.find((a) => a.memberId === "m-noah");
  assert.equal(noahRow.status, "declined", "re-saving the list must not reset a real answer");
  assert.ok(noahRow.respondedAt);
});

test("E7: NEGATIVE: you cannot answer for someone else", async () => {
  const ev = await newEvent();
  await setAttendees(ev.id, ["m-alex", "m-noah"]);
  // A Child View member trying to answer for the Owner.
  const r = await rsvp(ev.id, { status: "declined", memberId: "m-alex" }, noah);
  assert.equal(r.status, 403);
  assert.match(r.data.message, /only answer for yourself/i);
});

test("E7: an adult MAY answer for a child they already act for", async () => {
  const ev = await newEvent();
  await setAttendees(ev.id, ["m-noah"]);
  const r = await rsvp(ev.id, { status: "accepted", memberId: "m-noah" }, alex);
  assert.equal(r.status, 200);
  assert.equal(r.data.event.attendees[0].status, "accepted");
});

test("E7: someone who isn't on the event can't RSVP to it", async () => {
  const ev = await newEvent();
  await setAttendees(ev.id, ["m-alex"]);
  const r = await rsvp(ev.id, { status: "accepted" }, noah);
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "not_an_attendee");
});

test("E7: a nonsense status is refused with the options spelled out", async () => {
  const ev = await newEvent();
  await setAttendees(ev.id, ["m-alex"]);
  const r = await rsvp(ev.id, { status: "maybe-ish" });
  assert.equal(r.status, 400);
  assert.match(r.data.message, /accepted, declined, or invited/);
});

test("E7: an OLD event with participants but no RSVP list reads as invited, not accepted", async () => {
  // Events created before this feature carry participantIds only. Treating that as consent
  // would show a card claiming three people said yes when nobody was ever asked.
  const ev = await newEvent({ participantIds: ["m-noah"] });
  assert.equal(ev.attendees, undefined);
  const r = await rsvp(ev.id, { status: "accepted" }, noah);
  assert.equal(r.status, 200, "the legacy participant can still answer");
  assert.equal(r.data.event.attendees.find((a) => a.memberId === "m-noah").status, "accepted");
});
