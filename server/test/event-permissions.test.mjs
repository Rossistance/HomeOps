// Whose event is it, anyway.
//
// "Upon clicking into one of these, I notice I seem to be able to edit this — the time, the
//  start date, and the entire schedule. This is his item and I should not be able to edit any
//  of the information… The only part that I should be able to add is this section, which
//  needs to be relabeled 'just for me'. I shouldn't be able to change who's coming. I
//  shouldn't be able to select who's driving. That would be handled by the event creator."
//
// The narrator demonstrating all of this was signed in as the HOUSEHOLD OWNER — the most
// privileged account there is — editing his father-in-law's event. So the old gate
// (isAdultRole || event owner) was not just loose, it was wrong in kind: editing an event is
// a property of whose event it is, not of what role you hold. These tests pin the whole
// model: owner-only core fields, per-viewer private margins, and the three polite doors in
// (request to attend, offer to drive, suggest what to bring).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, readStoreDoc } from "./harness.mjs";

let ctx, owner, adult;   // owner = household Owner (m-alex); adult = Adult Member (m-morgan)
let ev;                  // Morgan's event — the thing Alex must not be able to edit

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
  adult = await makeSession(ctx, "m-morgan");
  const r = await adult.req("/api/events", {
    method: "POST",
    body: JSON.stringify({ title: "Gym bike ride", startAt: new Date(Date.now() + 86400000).toISOString(), visibility: "household" }),
  });
  ev = r.data.event;
  assert.equal(ev.ownerId, adult.actorId, "the creator owns their event");
});
after(async () => { await stopServer(ctx); });

// notifications.json is a keyed collection ({id: rec}), not an array.
const notificationsFor = (actorId) =>
  Object.values(readStoreDoc(ctx, "notifications.json", {})).filter((n) => n.actorId === actorId);

test("THE REPORTED CASE: the household Owner cannot edit someone else's schedule", async () => {
  const r = await owner.req(`/api/events/${ev.id}`, { method: "PATCH", body: JSON.stringify({ title: "Hijacked", startAt: new Date().toISOString() }) });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "not_event_owner", "role is not a seat at someone else's event — that is the entire finding");
  assert.equal((await adult.req("/api/events")).data.events.find((e) => e.id === ev.id).title, "Gym bike ride", "nothing moved");
});

test("…and cannot rewrite who's coming or who's driving through any door", async () => {
  const att = await owner.req(`/api/events/${ev.id}/attendees`, { method: "POST", body: JSON.stringify({ memberIds: [owner.actorId] }) });
  assert.equal(att.status, 403);
  const drv = await owner.req(`/api/events/${ev.id}`, { method: "PATCH", body: JSON.stringify({ driverId: owner.actorId }) });
  assert.equal(drv.status, 403);
});

test("'Just for me' notes are exactly that: saved for the viewer, invisible to the owner", async () => {
  // This is the leak shown twice in the video — his note rendering on Melissa's card.
  const r = await owner.req(`/api/events/${ev.id}`, {
    method: "PATCH",
    body: JSON.stringify({ localNotes: "should not be seen in Morgan's event", myBring: [{ item: "his lunch" }] }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.viewerOnly, true, "the response says nothing shared moved");
  assert.equal(r.data.event.myNotes.note, "should not be seen in Morgan's event");

  const ownersView = (await adult.req("/api/events")).data.events.find((e) => e.id === ev.id);
  assert.ok(!JSON.stringify({ ...ownersView, myNotes: null }).includes("should not be seen"),
    "the owner's copy of the event must carry no trace of the viewer's margin");
  assert.equal(ownersView.myNotes, null, "and the owner doesn't inherit someone else's notes as their own");

  const viewersView = (await owner.req("/api/events")).data.events.find((e) => e.id === ev.id);
  assert.equal(viewersView.myNotes.note, "should not be seen in Morgan's event", "while the author keeps theirs");
});

test("a non-participant cannot declare themselves attending — they request", async () => {
  const rsvp = await owner.req(`/api/events/${ev.id}/rsvp`, { method: "POST", body: JSON.stringify({ status: "accepted" }) });
  assert.equal(rsvp.status, 400, "not on the event, no RSVP — 'Melissa would have gotten the opportunity to add me'");

  const ask = await owner.req(`/api/events/${ev.id}/request-attend`, { method: "POST", body: JSON.stringify({}) });
  assert.equal(ask.status, 200);
  assert.equal(ask.data.pending, true);
  assert.ok(notificationsFor(adult.actorId).some((n) => n.title.includes("would like to join")),
    "the owner is actually told — a request nobody hears is a request that never happened");
});

test("…and a second tap is impatience, not a second request", async () => {
  await owner.req(`/api/events/${ev.id}/request-attend`, { method: "POST", body: JSON.stringify({}) });
  const stored = readStoreDoc(ctx, "events.json", {});
  const rec = Object.values(stored).find?.((e) => e.id === ev.id) ?? stored[ev.id] ?? (Array.isArray(stored) ? stored.find((e) => e.id === ev.id) : null);
  assert.equal((rec.requests?.attend ?? []).filter((r) => r.actorId === owner.actorId).length, 1);
});

test("the owner accepts, the requester lands on the event as an ACCEPTED attendee", async () => {
  const r = await adult.req(`/api/events/${ev.id}/requests/respond`, {
    method: "POST", body: JSON.stringify({ kind: "attend", actorId: owner.actorId, accept: true }),
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.event.participantIds.includes(owner.actorId));
  const me = r.data.event.attendees.find((a) => a.memberId === owner.actorId);
  assert.equal(me.status, "accepted", "they asked to come — their answer is already known, not 'invited'");
  assert.ok(notificationsFor(owner.actorId).some((n) => n.title.includes("You're on")), "the requester hears the yes");
});

test("now a participant, their RSVP works — and the owner is told with context", async () => {
  const r = await owner.req(`/api/events/${ev.id}/rsvp`, { method: "POST", body: JSON.stringify({ status: "declined" }) });
  assert.equal(r.status, 200);
  const note = notificationsFor(adult.actorId).find((n) => n.title.includes("can't make it"));
  assert.ok(note, "attendance changes notify the owner — 'those should have triggered notifications. They did not.'");
  assert.ok(note.body.includes("Gym bike ride"), "with the event named, not a bare sentence");
  assert.equal(note.data?.id, ev.id, "and tappable through to the event, instead of vanishing");
});

test("offer to drive: pending until the owner says yes, then the driver is set", async () => {
  const offer = await owner.req(`/api/events/${ev.id}/offer-drive`, { method: "POST", body: JSON.stringify({}) });
  assert.equal(offer.status, 200);
  let current = (await adult.req("/api/events")).data.events.find((e) => e.id === ev.id);
  assert.notEqual(current.driverId, owner.actorId, "offering is not taking the wheel");
  const r = await adult.req(`/api/events/${ev.id}/requests/respond`, {
    method: "POST", body: JSON.stringify({ kind: "drive", actorId: owner.actorId, accept: true }),
  });
  assert.equal(r.data.event.driverId, owner.actorId);
});

test("suggest-to-bring reaches the shared list only through the owner's yes", async () => {
  const sug = await owner.req(`/api/events/${ev.id}/suggest-bring`, { method: "POST", body: JSON.stringify({ item: "sunscreen" }) });
  assert.equal(sug.status, 200);
  let current = (await adult.req("/api/events")).data.events.find((e) => e.id === ev.id);
  assert.ok(!(current.whatToBring ?? []).some((b) => b.item === "sunscreen"), "a suggestion is not an edit");
  await adult.req(`/api/events/${ev.id}/requests/respond`, {
    method: "POST", body: JSON.stringify({ kind: "bring", actorId: owner.actorId, item: "sunscreen", accept: true }),
  });
  current = (await adult.req("/api/events")).data.events.find((e) => e.id === ev.id);
  assert.ok((current.whatToBring ?? []).some((b) => b.item === "sunscreen"), "accepted → on the owner's list, attributed");
});

test("declining a request notifies the requester and changes nothing", async () => {
  await owner.req(`/api/events/${ev.id}/suggest-bring`, { method: "POST", body: JSON.stringify({ item: "a tuba" }) });
  const r = await adult.req(`/api/events/${ev.id}/requests/respond`, {
    method: "POST", body: JSON.stringify({ kind: "bring", actorId: owner.actorId, item: "a tuba", accept: false }),
  });
  assert.equal(r.status, 200);
  assert.ok(!(r.data.event.whatToBring ?? []).some((b) => b.item === "a tuba"));
  assert.ok(notificationsFor(owner.actorId).some((n) => n.title.includes("No need for a tuba")));
});

test("only the event's owner can answer requests — the household Owner cannot approve themselves in", async () => {
  const other = await adult.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Second event", visibility: "household" }) });
  await owner.req(`/api/events/${other.data.event.id}/request-attend`, { method: "POST", body: JSON.stringify({}) });
  const self = await owner.req(`/api/events/${other.data.event.id}/requests/respond`, {
    method: "POST", body: JSON.stringify({ kind: "attend", actorId: owner.actorId, accept: true }),
  });
  assert.equal(self.status, 403, "a door you can open yourself is not a door");
});

test("the owner still edits their own event exactly as before", async () => {
  const r = await adult.req(`/api/events/${ev.id}`, { method: "PATCH", body: JSON.stringify({ title: "Gym bike ride (moved)", location: "KOC Hall" }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.event.title, "Gym bike ride (moved)");
});

test("the editable flag the clients trust tells the same story as the gate", async () => {
  const forOwnerOfEvent = (await adult.req("/api/events")).data.events.find((e) => e.id === ev.id);
  const forHouseholdOwner = (await owner.req("/api/events")).data.events.find((e) => e.id === ev.id);
  assert.equal(forOwnerOfEvent.editable, true);
  assert.equal(forHouseholdOwner.editable, false, "a flag that promises an edit the server will refuse is a lie in the UI");
  assert.equal(forHouseholdOwner.appendable, true, "but the private margin is open to anyone who can see the event");
});
