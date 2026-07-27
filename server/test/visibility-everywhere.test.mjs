// Just me / My Nest / Everyone — one meaning, everywhere it's offered.
//
// "The privacy option needs to extend to tasks and lists for new or pre-existing tasks, it needs
//  to read just me, my nest, then everyone. The actual logic of who sees what needs to extend
//  throughout the app."
//
// It didn't extend anywhere. There were three vocabularies:
//
//   Tasks and files went through canSeeEntity and understood private / nest / household.
//   Knowledge had its OWN inline filter where `personal` meant "the creator OR ANY ADULT" —
//     behind a chip labelled "Just me" and a badge with a padlock on it.
//   And `personal` isn't a word canSeeEntity knows, so every OTHER reader of a knowledge item
//     fell through to the household default and showed it to everyone.
//
// So a note marked "Just me" was readable by every adult in the house through one path and by
// literally everyone through another. That is the worst kind of bug this app can have: not a
// feature that fails, but a promise about privacy that isn't kept, made in writing, with a
// padlock icon next to it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, adult, other;

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");     // Owner
  adult = await makeSession(ctx, "m-morgan");   // Adult Member
  // A second adult, so "any adult can see it" is distinguishable from "the author can see it".
  const created = await owner.req("/api/members", {
    method: "POST",
    body: JSON.stringify({ displayName: "Sam", role: "Adult Member", relationship: "parent" }),
  });
  other = await makeSession(ctx, created.data?.member?.actorId ?? "m-morgan");
});
after(async () => { await stopServer(ctx); });

const addNote = (client, body) =>
  client.req("/api/knowledge", { method: "POST", body: JSON.stringify({ title: "Note", type: "Family Fact", content: "x", ...body }) });
const notesVisibleTo = async (client) => (await client.req("/api/knowledge")).data.items.map((k) => k.title);

test("THE PRIVACY BUG: a knowledge item marked Just me is not readable by another adult", async () => {
  await addNote(adult, { title: "Adult's private note", visibility: "personal" });
  assert.ok((await notesVisibleTo(adult)).includes("Adult's private note"), "the author still sees their own note");
  assert.ok(!(await notesVisibleTo(other)).includes("Adult's private note"),
    "'personal' used to mean 'creator OR any adult' — under a padlock that said Just me");
});

test("…and not by the Owner either, because Just me means just me", async () => {
  // Role is not a way in. An Owner who wants a note they can read can ask for it.
  assert.ok(!(await notesVisibleTo(owner)).includes("Adult's private note"));
});

test("`personal` is stored as `private`, so every reader agrees about it", async () => {
  // The old word wasn't in canSeeEntity's vocabulary, so anything reading a knowledge item
  // through the shared gate fell through to "household" and showed it to everyone. Two
  // readers disagreeing about who can see something is how a leak survives a code review.
  const r = await addNote(adult, { title: "Normalised", visibility: "personal" });
  assert.equal(r.data.item.visibility, "private");
});

test("Everyone still means everyone", async () => {
  await addNote(adult, { title: "Shared note", visibility: "household" });
  assert.ok((await notesVisibleTo(other)).includes("Shared note"));
  assert.ok((await notesVisibleTo(owner)).includes("Shared note"));
});

test("an unrecognised or missing scope is the household default, not an accidental secret", async () => {
  // Failing closed here would silently hide family notes; the default has always been shared
  // and a typo must not change that.
  const r = await addNote(adult, { title: "No scope given" });
  assert.equal(r.data.item.visibility, "household");
  assert.ok((await notesVisibleTo(other)).includes("No scope given"));
});

/* ------------------------------ My Nest ------------------------------ */

test("a knowledge item can be nest-scoped at all, which it could not before", async () => {
  const made = await adult.req("/api/nests", { method: "POST", body: JSON.stringify({ name: "Mum & Dad", inviteActorIds: [owner.actorId] }) });
  const nestId = made.data?.nest?.id;
  assert.ok(nestId, JSON.stringify(made.data));
  const r = await addNote(adult, { title: "Nest note", visibility: "nest", nestId });
  assert.equal(r.data.item.visibility, "nest");
  assert.equal(r.data.item.nestId, nestId);
  assert.ok((await notesVisibleTo(adult)).includes("Nest note"));
  assert.ok(!(await notesVisibleTo(owner)).includes("Nest note"), "a nest excludes the Owner — that is the point of it");
});

test("naming a nest you are not in is REFUSED, not quietly downgraded", async () => {
  // Silently filing it somewhere else is worse than refusing: you'd believe it was shared
  // with someone it never reached, or private when it wasn't.
  const made = await adult.req("/api/nests", { method: "POST", body: JSON.stringify({ name: "Just adults", inviteActorIds: [owner.actorId] }) });
  const nestId = made.data.nest.id;
  const r = await addNote(other, { title: "Gatecrash", visibility: "nest", nestId });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "not_in_nest");
});

/* ----------------------------- Tasks ------------------------------- */

test("a task gets the same three scopes and the same refusal", async () => {
  const made = await adult.req("/api/nests", { method: "POST", body: JSON.stringify({ name: "Chores nest", inviteActorIds: [owner.actorId] }) });
  const nestId = made.data.nest.id;

  const priv = await adult.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Mine only", visibility: "personal" }) });
  assert.equal(priv.data.task.visibility, "private", "the Library's old spelling means the same thing on a task");

  const nested = await adult.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Ours", visibility: "nest", nestId }) });
  assert.equal(nested.data.task.visibility, "nest");

  const refused = await other.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Sneak", visibility: "nest", nestId }) });
  assert.equal(refused.status, 403, "a nest you're not in used to become 'private' — the task existed, just not where you put it");
});

test("PRE-EXISTING tasks can change scope, which is half of what he asked for", async () => {
  // "for new or pre-existing tasks". A privacy control that only works at creation is a
  // privacy control you can't correct.
  const made = await adult.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Started shared" }) });
  assert.equal(made.data.task.visibility, "household");

  const shut = await adult.req(`/api/tasks/${made.data.task.id}`, { method: "PATCH", body: JSON.stringify({ visibility: "private" }) });
  assert.equal(shut.data.task.visibility, "private");

  const seenByOther = (await other.req("/api/tasks")).data.tasks.map((t) => t.title);
  assert.ok(!seenByOther.includes("Started shared"), "closing a task's scope has to actually close it");
});

test("a pre-existing knowledge item can change scope too", async () => {
  const made = await addNote(adult, { title: "Was shared", visibility: "household" });
  assert.ok((await notesVisibleTo(other)).includes("Was shared"));
  const r = await adult.req(`/api/knowledge/${made.data.item.id}`, { method: "PATCH", body: JSON.stringify({ visibility: "personal" }) });
  assert.equal(r.data.item.visibility, "private");
  assert.ok(!(await notesVisibleTo(other)).includes("Was shared"));
});

test("leaving a nest scope clears the nest pointer instead of leaving a stale one behind", async () => {
  const made = await adult.req("/api/nests", { method: "POST", body: JSON.stringify({ name: "Temp nest", inviteActorIds: [owner.actorId] }) });
  const nestId = made.data.nest.id;
  const note = await addNote(adult, { title: "Moves out", visibility: "nest", nestId });
  const r = await adult.req(`/api/knowledge/${note.data.item.id}`, { method: "PATCH", body: JSON.stringify({ visibility: "household" }) });
  assert.equal(r.data.item.visibility, "household");
  assert.equal(r.data.item.nestId, null, "a leftover nestId is a landmine for the next reader");
});
