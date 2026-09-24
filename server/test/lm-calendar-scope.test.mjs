// A Limited Member's calendar scope (ADR-005): the Owner narrows what a Limited Member's
// calendar shows — per other member "all", "none" or chosen calendars ("app" = events made in
// FamiliOS). Their own events and the ones they take part in always show. Set only through
// PUT /api/members/:id/calendar-scope (Owner only), read back only by the Owner.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, readStoreDoc } from "./harness.mjs";

const ics = (tag, day) => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:${tag}@test
SUMMARY:${tag}
DTSTART:202610${day}T160000Z
DTEND:202610${day}T170000Z
END:VEVENT
END:VCALENDAR`;

let ctx, owner, admin, member, limited;
let soccerSub, bookSub;
const put = (who, id, scope) => who.req(`/api/members/${id}/calendar-scope`, { method: "PUT", body: JSON.stringify({ scope }) });
const titles = async (who) => {
  const r = await who.req("/api/events");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return new Set(r.data.events.map((e) => e.title));
};
const CASEY_ALL = ["Casey soccer", "Casey book club", "Casey dinner plan", "Casey drives Riley"];

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
  admin = await makeSession(ctx, "m-morgan");
  const am = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Casey Quinn", role: "Adult Member" }) });
  const lm = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Riley Quinn", role: "Limited Member" }) });
  member = await makeSession(ctx, am.data.member.actorId);
  limited = await makeSession(ctx, lm.data.member.actorId);
  const add = async (name, day) => {
    const r = await member.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name, ics: ics(name, day) }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.subscription.id;
  };
  soccerSub = await add("Casey soccer", "05");
  bookSub = await add("Casey book club", "06");
  const mk = async (who, body) => {
    const r = await who.req("/api/events", { method: "POST", body: JSON.stringify(body) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  };
  await mk(member, { title: "Casey dinner plan", startAt: "2026-10-07T23:00:00Z" });
  await mk(member, { title: "Casey drives Riley", startAt: "2026-10-08T15:00:00Z", participantIds: [limited.actorId] });
  await mk(owner, { title: "Alex dentist", startAt: "2026-10-08T13:00:00Z" });
  await mk(limited, { title: "Riley band practice", startAt: "2026-10-09T20:00:00Z" });
});
after(async () => { await stopServer(ctx); });

test("with no scope a Limited Member sees everything they could see before", async () => {
  const seen = await titles(limited);
  for (const t of [...CASEY_ALL, "Alex dentist", "Riley band practice"]) assert.ok(seen.has(t), t);
});

test("\"none\" for a member hides their calendar — except what the Limited Member takes part in", async () => {
  const r = await put(owner, limited.actorId, { members: { [member.actorId]: "none" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.member.calendarScope, { members: { [member.actorId]: "none" } });
  const seen = await titles(limited);
  for (const t of ["Casey soccer", "Casey book club", "Casey dinner plan"]) assert.ok(!seen.has(t), `${t} is out of scope`);
  assert.ok(seen.has("Casey drives Riley"), "an event they are ON always shows");
  assert.ok(seen.has("Alex dentist"), "a member the scope does not mention is \"all\"");
  assert.ok(seen.has("Riley band practice"), "their own events always show");
  // Only the Limited Member's view narrows; nobody else's.
  const ownerSees = await titles(owner);
  for (const t of CASEY_ALL) assert.ok(ownerSees.has(t), `the Owner still sees ${t}`);
});

test("chosen calendars: one subscription, or \"app\" for events made in FamiliOS", async () => {
  let r = await put(owner, limited.actorId, { members: { [member.actorId]: { calendars: [soccerSub] } } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  let seen = await titles(limited);
  assert.ok(seen.has("Casey soccer"));
  assert.ok(!seen.has("Casey book club"));
  assert.ok(!seen.has("Casey dinner plan"), "an app event is not in a subscription");
  assert.ok(seen.has("Casey drives Riley"));

  r = await put(owner, limited.actorId, { members: { [member.actorId]: { calendars: ["app"] } } });
  assert.equal(r.status, 200);
  seen = await titles(limited);
  assert.ok(!seen.has("Casey soccer") && !seen.has("Casey book club"));
  assert.ok(seen.has("Casey dinner plan") && seen.has("Casey drives Riley"));

  r = await put(owner, limited.actorId, { members: { [member.actorId]: { calendars: [bookSub, "app"] } } });
  seen = await titles(limited);
  assert.ok(!seen.has("Casey soccer") && seen.has("Casey book club") && seen.has("Casey dinner plan"));
});

test("only the Owner sets it, only on a Limited Member, only with calendars that are that member's", async () => {
  const before = readStoreDoc(ctx, "members.json", {})[limited.actorId].calendarScope;
  const byAdmin = await put(admin, limited.actorId, null);
  assert.equal(byAdmin.status, 403);
  assert.equal(byAdmin.data.error, "owner_only");
  const bySelf = await put(limited, limited.actorId, null);
  assert.equal(bySelf.status, 403);
  assert.equal(bySelf.data.error, "owner_only");
  const notLm = await put(owner, member.actorId, { members: {} });
  assert.equal(notLm.status, 400);
  assert.equal(notLm.data.error, "not_limited_member");
  const wrongCal = await put(owner, limited.actorId, { members: { "m-alex": { calendars: [soccerSub] } } });
  assert.equal(wrongCal.status, 400);
  assert.equal(wrongCal.data.error, "bad_calendar");
  const bad = await put(owner, limited.actorId, "everything");
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, "bad_scope");
  assert.equal((await put(owner, "m-nobody", null)).status, 404);
  assert.deepEqual(readStoreDoc(ctx, "members.json", {})[limited.actorId].calendarScope, before, "nothing moved");
});

test("the generic member PATCH cannot write it — not the Owner, not the member themselves", async () => {
  const before = readStoreDoc(ctx, "members.json", {})[limited.actorId].calendarScope;
  for (const who of [owner, limited]) {
    const r = await who.req(`/api/members/${limited.actorId}`, { method: "PATCH", body: JSON.stringify({ displayName: "Riley Quinn", calendarScope: null }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  assert.deepEqual(readStoreDoc(ctx, "members.json", {})[limited.actorId].calendarScope, before);
});

test("GET /api/members shows the scope to the Owner only", async () => {
  const mine = (await owner.req("/api/members")).data.members.find((m) => m.actorId === limited.actorId);
  assert.ok(mine.calendarScope && mine.calendarScope.members[member.actorId]);
  for (const who of [admin, member, limited]) {
    const rows = (await who.req("/api/members")).data.members;
    assert.ok(rows.every((m) => !("calendarScope" in m)), `${who.actorId} does not see anyone's scope`);
  }
  // null clears it: back to everything.
  const r = await put(owner, limited.actorId, null);
  assert.equal(r.status, 200);
  assert.equal(r.data.member.calendarScope, null);
  const seen = await titles(limited);
  for (const t of CASEY_ALL) assert.ok(seen.has(t), t);
});
