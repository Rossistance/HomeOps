// The Adult Member silo.
//
// Asked for directly: an adult who is NOT an administrator of the household needs their own
// connected accounts, their own calendars, their own tasks, and their own assistant — "a
// standalone silo for each individual adult member" — while still being able to "pick up on
// context on things that are happening in the entire household, and the family chats", and
// "not be able to edit those capabilities".
//
// The asymmetry IS the design, and it's what these tests pin down: full read of the
// household, writes confined to their own things.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, adult, other;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");      // Owner
  adult = await makeSession(ctx, "m-morgan");    // Adult Admin by seed — re-roled below
  other = await makeSession(ctx, "m-elaine");    // Guest/Helper
  // Seat Morgan as a plain Adult Member: that's the role under test.
  await owner.req("/api/members/m-morgan", { method: "PATCH", body: JSON.stringify({ role: "Adult Member" }) });
  adult = await makeSession(ctx, "m-morgan");
  assert.equal(adult.role, "Adult Member", "the test needs a genuine Adult Member session");
});
after(async () => { await stopServer(ctx); });

/* ---- what they gain ---- */

test("they can add their own calendar subscription", async () => {
  const r = await adult.req("/api/calendar/subscriptions", {
    method: "POST", body: JSON.stringify({ url: "https://example.com/theirs.ics" }),
  });
  assert.notEqual(r.status, 403, "adding your own calendar is not an admin act");
});

test("they can add tasks", async () => {
  const r = await adult.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Book the dentist" }) });
  assert.equal(r.status, 200);
});

test("THE NEW PART: they can create a helper of their own", async () => {
  const r = await adult.req("/api/agents", {
    method: "POST", body: JSON.stringify({ name: "My reading list", visibility: "personal" }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.agent.visibility, "personal");
  assert.equal(r.data.agent.createdBy, "m-morgan");
});

test("they can edit, run and delete the helper they made", async () => {
  const made = await adult.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "Mine", visibility: "personal" }) });
  const id = made.data.agent.id;
  const edited = await adult.req(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify({ purpose: "Track what I'm reading" }) });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.agent.purpose, "Track what I'm reading");
  const ran = await adult.req(`/api/agents/${id}/run`, { method: "POST", body: "{}" });
  assert.notEqual(ran.status, 403, "a helper you own is one you can run");
  const gone = await adult.req(`/api/agents/${id}`, { method: "DELETE" });
  assert.equal(gone.status, 200);
});

/* ---- what stays out of reach ---- */

test("NEGATIVE: they cannot create a HOUSEHOLD helper", async () => {
  const r = await adult.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "Runs for everyone", visibility: "household" }) });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "personal_only");
  assert.match(r.data.message, /Owner or Adult Admin/);
});

test("NEGATIVE: they cannot promote their own helper into a household one", async () => {
  const made = await adult.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "Sneaky", visibility: "personal" }) });
  const r = await adult.req(`/api/agents/${made.data.agent.id}`, { method: "PATCH", body: JSON.stringify({ visibility: "household" }) });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "personal_only");
});

test("NEGATIVE: they cannot touch the HOUSEHOLD's helpers — read, but not edit", async () => {
  const hh = await owner.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "Family briefing", visibility: "household" }) });
  const id = hh.data.agent.id;
  for (const attempt of [
    adult.req(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify({ name: "Renamed by me" }) }),
    adult.req(`/api/agents/${id}`, { method: "DELETE" }),
    adult.req(`/api/agents/${id}/run`, { method: "POST", body: "{}" }),
  ]) {
    const r = await attempt;
    assert.equal(r.status, 403, "a household helper is not theirs to change");
  }
});

test("NEGATIVE: they cannot edit ANOTHER member's personal helper", async () => {
  const theirs = await owner.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "Alex's own", visibility: "personal" }) });
  const r = await adult.req(`/api/agents/${theirs.data.agent.id}`, { method: "PATCH", body: JSON.stringify({ name: "Mine now" }) });
  assert.equal(r.status, 403);
});

test("a Guest/Helper gains none of this — the silo is an ADULT-member thing", async () => {
  const r = await other.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "Nope", visibility: "personal" }) });
  assert.equal(r.status, 403);
});

/* ---- the chat silo ---- */

test("their chats are forced PERSONAL, even asking for household", async () => {
  const r = await adult.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Private thought", visibility: "household" }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.conversation.visibility, "personal",
    "a mis-set toggle must not be able to publish a private thread");
});

test("and they cannot move one into the family space afterwards", async () => {
  const c = await adult.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Still private" }) });
  const r = await adult.req(`/api/conversations/${c.data.conversation.id}`, { method: "PATCH", body: JSON.stringify({ visibility: "household" }) });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "personal_only");
});

test("their chat is invisible to the rest of the household — including the Owner", async () => {
  const c = await adult.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Just for me" }) });
  const seen = await owner.req("/api/conversations");
  assert.ok(!seen.data.conversations.some((x) => x.id === c.data.conversation.id),
    "the silo is only a silo if it holds against the Owner too");
});

test("an OWNER is unaffected — household chats still work for them", async () => {
  const r = await owner.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Family plan", visibility: "household" }) });
  assert.equal(r.data.conversation.visibility, "household");
});
