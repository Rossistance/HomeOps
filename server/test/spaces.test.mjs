// Spaces — personal vs family scoping for chats and agents.
// Personal chats/agents are invisible to other household members; family
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

test("personal agents are invisible to other members; family agents are shared", async () => {
  const personalAgent = (await ross.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "Ross's private helper", visibility: "personal" }) })).data.agent;
  assert.equal(personalAgent.visibility, "personal");
  assert.equal(personalAgent.createdBy, ross.actorId ?? personalAgent.createdBy, "creator recorded");
  const familyAgent = (await ross.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "Family helper" }) })).data.agent;
  assert.equal(familyAgent.visibility, "household", "default agent space is family");

  const theirs = (await other.req("/api/agents")).data.agents;
  assert.ok(!theirs.some((a) => a.id === personalAgent.id), "personal agent hidden");
  assert.ok(theirs.some((a) => a.id === familyAgent.id), "family agent shared");
  assert.equal((await other.req(`/api/agents/${personalAgent.id}`)).status, 404, "direct fetch hidden too");

  // The creator still sees both.
  const mine = (await ross.req("/api/agents")).data.agents;
  assert.ok(mine.some((a) => a.id === personalAgent.id));
});
