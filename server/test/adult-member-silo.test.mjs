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
//
// "Their own assistant" is a HELPER now — the single concept that replaced Agent, Skill,
// Function, Playbook, Automation, Trigger and Evolution — so the helper half of this file
// speaks to /api/helpers. The rule it holds is the same rule the chat half below holds, and
// the two halves are deliberately kept side by side: an Adult Member's things are theirs,
// and the family's are not theirs to change.
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
  const r = await adult.req("/api/helpers", {
    method: "POST",
    body: JSON.stringify({ name: "My reading list", instructions: "Keep track of what I am reading and nudge me to pick it back up." }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // They did not have to ASK for personal. An Adult Member's helper is put in their own silo
  // for them, so a mis-set toggle can never publish one into the family space.
  assert.equal(r.data.helper.visibility, "personal");
  assert.equal(r.data.helper.createdBy, "m-morgan");
});

test("they can edit, run and delete the helper they made", async () => {
  const made = await adult.req("/api/helpers", {
    method: "POST",
    body: JSON.stringify({ name: "Mine", instructions: "Summarise my own week for me, quietly, and tell nobody else about it." }),
  });
  const id = made.data.helper.id;
  const edited = await adult.req("/api/helpers/" + id, { method: "PATCH", body: JSON.stringify({ purpose: "Track what I'm reading" }) });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.helper.purpose, "Track what I'm reading");
  // No AI provider is configured in this harness, so the run honestly fails (422) — which is
  // itself the proof that it got PAST the permission check. 403 is the one answer ruled out.
  const ran = await adult.req("/api/helpers/" + id + "/run", { method: "POST", body: "{}" });
  assert.notEqual(ran.status, 403, "a helper you own is one you can run: " + JSON.stringify(ran.data));
  const gone = await adult.req("/api/helpers/" + id, { method: "DELETE" });
  assert.equal(gone.status, 200);
});

/* ---- what stays out of reach ---- */

test("NEGATIVE: they cannot create a HOUSEHOLD helper", async () => {
  /* CHANGED DELIBERATELY: this used to be a 403 `personal_only`. Asking for "household" is
   * now answered by making them a PERSONAL helper instead — exactly the shape their chats
   * have always had (see "their chats are forced PERSONAL" below), and it fails in the safe
   * direction: what is lost is a refusal dialog, not a boundary. So the property is asserted
   * on the RESULT rather than on a status code — no request an Adult Member can make puts a
   * helper into the family space. */
  const r = await adult.req("/api/helpers", {
    method: "POST",
    body: JSON.stringify({ name: "Runs for everyone", visibility: "household", instructions: "Do the whole family's evening round-up every night." }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.helper.visibility, "personal", "asking for the family space must not reach it");

  // And nobody else in the household can see what they made.
  const ownerSees = (await owner.req("/api/helpers")).data.helpers;
  assert.ok(!ownerSees.some((h) => h.id === r.data.helper.id),
    "not even the Owner — a silo that leaks upward is not a silo");
});

test("NEGATIVE: they cannot promote their own helper into a household one", async () => {
  const made = await adult.req("/api/helpers", {
    method: "POST",
    body: JSON.stringify({ name: "Sneaky", instructions: "Something small and personal, which should stay that way." }),
  });
  assert.equal(made.data.helper.visibility, "personal");
  const r = await adult.req("/api/helpers/" + made.data.helper.id, { method: "PATCH", body: JSON.stringify({ visibility: "household" }) });

  /* The load-bearing one, and the reason it is asserted on the STORED visibility rather than
   * on a status code: whether the promote is refused outright or quietly ignored is a product
   * choice, but a helper arriving in the family space at the request of someone who may not
   * put one there is not. It is a privilege change and not only a visibility one — a
   * household helper's scheduled runs act as the scheduler, with Owner standing, while a
   * personal helper's act as the member who made it (see sessionForHelper in helpers.mjs). */
  const after = (await adult.req("/api/helpers/" + made.data.helper.id)).data.helper;
  assert.equal(after.visibility, "personal",
    "an Adult Member must not be able to publish a helper into the family space (PATCH answered " + r.status + ")");
});

test("NEGATIVE: they cannot touch the HOUSEHOLD's helpers — read, but not edit", async () => {
  const hh = await owner.req("/api/helpers", {
    method: "POST",
    body: JSON.stringify({ name: "Family briefing", visibility: "household", instructions: "Brief the whole family each morning on the day ahead." }),
  });
  const id = hh.data.helper.id;
  // They can READ it — the silo is about authorship, not ignorance.
  assert.ok((await adult.req("/api/helpers")).data.helpers.some((h) => h.id === id), "a family helper is still theirs to see");
  for (const attempt of [
    adult.req("/api/helpers/" + id, { method: "PATCH", body: JSON.stringify({ name: "Renamed by me" }) }),
    adult.req("/api/helpers/" + id, { method: "DELETE" }),
    adult.req("/api/helpers/" + id + "/run", { method: "POST", body: "{}" }),
  ]) {
    const r = await attempt;
    assert.equal(r.status, 403, "a household helper is not theirs to change");
    assert.equal(r.data.error, "household_helper");
    assert.ok(r.data.message, "and the refusal is a sentence, not a code");
  }
});

test("NEGATIVE: they cannot edit ANOTHER member's personal helper", async () => {
  const theirs = await owner.req("/api/helpers", {
    method: "POST",
    body: JSON.stringify({ name: "Alex's own", visibility: "personal", instructions: "Alex's private reading notes, kept for Alex alone." }),
  });
  const r = await adult.req("/api/helpers/" + theirs.data.helper.id, { method: "PATCH", body: JSON.stringify({ name: "Mine now" }) });
  /* 404, not the old 403: someone else's personal helper is not visible to them at all, so
   * the refusal cannot even confirm that it exists. That is the stronger answer — and the
   * claim under test is unchanged, so it is checked where it counts, on the record. */
  assert.equal(r.status, 404);
  assert.equal((await owner.req("/api/helpers/" + theirs.data.helper.id)).data.helper.name, "Alex's own",
    "and the helper they tried to rename is untouched");
});

test("a Guest/Helper gains none of this — the silo is an ADULT-member thing", async () => {
  const r = await other.req("/api/helpers", {
    method: "POST",
    body: JSON.stringify({ name: "Nope", instructions: "Anything at all, which a guest has no standing to set running." }),
  });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "insufficient_role");
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
