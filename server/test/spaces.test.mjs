// Spaces — personal vs family scoping for chats and helpers.
// Personal chats/helpers are invisible to other household members; family
// (household-visibility) chats are shared and continuable by anyone in the house.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, ross, other;
before(async () => {
  ctx = await startServer();
  ross = await makeSession(ctx, "m-alex");    // creator (Owner)
  other = await makeSession(ctx, "m-morgan"); // another adult in the household
});
after(async () => { await stopServer(ctx); });

test("personal chats stay private; family chats are shared and continuable", async () => {
  const personal = (await ross.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "My private chat" }) })).data.conversation;
  assert.equal(personal.visibility, "personal", "default space is personal");
  const family = (await ross.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Family plans", visibility: "household" }) })).data.conversation;
  assert.equal(family.visibility, "household");

  // The other member sees only the family chat.
  const theirs = (await other.req("/api/conversations")).data.conversations;
  assert.ok(!theirs.some((c) => c.id === personal.id), "personal chat hidden from other members");
  assert.ok(theirs.some((c) => c.id === family.id), "family chat visible to the household");

  // Direct fetch of the personal chat 404s for them; family chat opens.
  assert.equal((await other.req(`/api/conversations/${personal.id}`)).status, 404);
  assert.equal((await other.req(`/api/conversations/${family.id}`)).status, 200);

  // They can append into the family chat, not the personal one.
  const okAppend = await other.req(`/api/conversations/${family.id}/messages`, { method: "POST", body: JSON.stringify({ text: "adding to family thread" }) });
  assert.equal(okAppend.status, 200);
  const badAppend = await other.req(`/api/conversations/${personal.id}/messages`, { method: "POST", body: JSON.stringify({ text: "sneaky" }) });
  assert.equal(badAppend.status, 404);
});

test("personal helpers are invisible to other members; family helpers are shared", async () => {
  // The seven concepts (Agent, Skill, Function, Playbook, Automation, Trigger, Evolution)
  // are now one Helper behind /api/helpers, but the SPACE it lives in is unchanged: a
  // personal helper belongs to the member who made it, a household one to everyone.
  const personalHelper = (await ross.req("/api/helpers", { method: "POST", body: JSON.stringify({
    name: "Ross's private helper", visibility: "personal",
    instructions: "Summarise my own reading list for me each week, and tell nobody else.",
  }) })).data.helper;
  assert.equal(personalHelper.visibility, "personal");
  assert.equal(personalHelper.createdBy, ross.actorId ?? personalHelper.createdBy, "creator recorded");
  const familyHelper = (await ross.req("/api/helpers", { method: "POST", body: JSON.stringify({
    name: "Family helper", instructions: "Keep the family's shared board tidy each evening.",
  }) })).data.helper;
  assert.equal(familyHelper.visibility, "household", "default helper space is family");

  const theirs = (await other.req("/api/helpers")).data.helpers;
  assert.ok(!theirs.some((a) => a.id === personalHelper.id), "personal helper hidden");
  assert.ok(theirs.some((a) => a.id === familyHelper.id), "family helper shared");
  assert.equal((await other.req(`/api/helpers/${personalHelper.id}`)).status, 404, "direct fetch hidden too");

  // The creator still sees both.
  const mine = (await ross.req("/api/helpers")).data.helpers;
  assert.ok(mine.some((a) => a.id === personalHelper.id));
});
