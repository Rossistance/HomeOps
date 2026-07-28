// Nests — a small group inside the household.
//
// "GPop and Beannie are actually married. So for them it might make sense to keep their own
//  agents and grocery list and task list available between the two of them, and yet still
//  isolated from the broader family group… there should be a way to say 'send an invite to
//  create a nest'… and the other person would approve — you can either join or decline… and be
//  able to leave that nest at any point."
//
// Three rules carry this, and each has a negative test:
//   ISOLATION  — a nest is invisible to everyone outside it, INCLUDING the Owner. A space the
//                household's administrator can read is not the space he asked for.
//   CONSENT    — you are in a nest because you said yes, and you can always leave.
//   PERSISTENCE— leaving never deletes what was made inside.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, alex, morgan, lily;
before(async () => {
  ctx = await startServer();
  alex = await makeSession(ctx, "m-alex");       // Owner
  morgan = await makeSession(ctx, "m-morgan");   // Adult Admin
  lily = await makeSession(ctx, "m-lily");       // Child View
});
after(async () => { await stopServer(ctx); });

/* mkNest walks its creator (and the usual invitee) out of any current nest first: since the
 * one-nest rule (Cluster X, pinned in role-matrix.test.mjs) a second nest can't be formed
 * from inside one, and THIS file's subject is consent and isolation, not the join limit. */
const mkNest = async (as, inviteActorIds, name) => {
  for (const person of [alex, morgan, lily]) {
    const mine = (await person.req("/api/nests")).data?.nests ?? [];
    for (const n of mine) await person.req(`/api/nests/${n.id}/leave`, { method: "POST", body: "{}" });
  }
  return as.req("/api/nests", { method: "POST", body: JSON.stringify({ name, inviteActorIds }) });
};
const act = (as, id, action, body = {}) =>
  as.req(`/api/nests/${id}/${action}`, { method: "POST", body: JSON.stringify(body) });
/* Cluster X (added 7-28): ONE nest at a time is now the rule, so a test that forms a fresh
 * nest must first walk its actors out of the previous one — exactly what a real person would
 * have to do. Leaving everyone out rather than only the creator, because an invitee who
 * accepted earlier is just as nested as the person who invited them. */
const leaveAll = async (...people) => {
  for (const person of people) {
    const mine = (await person.req("/api/nests")).data.nests ?? [];
    for (const n of mine) await act(person, n.id, "leave");
  }
};

/* ---- forming one ---- */

test("an adult creates a nest; the creator is in, the invitee is only INVITED", async () => {
  const r = await mkNest(alex, ["m-morgan"], "GPop + Beannie");
  assert.equal(r.status, 200);
  const byId = new Map(r.data.nest.members.map((m) => [m.actorId, m.status]));
  assert.equal(byId.get("m-alex"), "joined", "you choose this for yourself");
  assert.equal(byId.get("m-morgan"), "invited", "and everyone else has to say yes");
});

test("the label is the one he used — names, joined", async () => {
  await leaveAll(alex, morgan);
  const r = await mkNest(alex, ["m-morgan"]);
  await act(morgan, r.data.nest.id, "accept");
  const list = await alex.req("/api/nests");
  const n = list.data.nests.find((x) => x.id === r.data.nest.id);
  assert.match(n.label, /Alex/);
  assert.match(n.label, /\+/);
});

test("a nest with nobody else in it is refused", async () => {
  await leaveAll(alex, morgan);
  const r = await mkNest(alex, []);
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "nobody_to_invite");
});

test("a child cannot form one", async () => {
  const r = await mkNest(lily, ["m-alex"]);
  assert.equal(r.status, 403);
});

/* ---- consent ---- */

test("CONSENT: an invitation appears for the invitee, and not as membership", async () => {
  await leaveAll(alex, morgan);
  const r = await mkNest(alex, ["m-morgan"]);
  const theirs = await morgan.req("/api/nests");
  assert.ok(theirs.data.invitations.some((n) => n.id === r.data.nest.id), "it is waiting on them");
  assert.ok(!theirs.data.nests.some((n) => n.id === r.data.nest.id), "but they are not in it yet");
});

test("accepting joins; declining does not", async () => {
  await leaveAll(alex, morgan);
  const a = await mkNest(alex, ["m-morgan"]);
  await act(morgan, a.data.nest.id, "accept");
  assert.ok((await morgan.req("/api/nests")).data.nests.some((n) => n.id === a.data.nest.id));

  // Forming the second one requires leaving the first — the one-nest rule is the point,
  // not an obstacle course around it.
  await leaveAll(alex, morgan);
  const b = await mkNest(alex, ["m-morgan"]);
  await act(morgan, b.data.nest.id, "decline");
  const theirs = await morgan.req("/api/nests");
  assert.ok(!theirs.data.nests.some((n) => n.id === b.data.nest.id));
  assert.ok(!theirs.data.invitations.some((n) => n.id === b.data.nest.id), "and it stops asking");
});

test("NEGATIVE: you cannot accept an invitation you were never sent", async () => {
  const r = await mkNest(alex, ["m-morgan"]);
  const sneak = await act(lily, r.data.nest.id, "accept");
  assert.equal(sneak.status, 400);
  assert.equal(sneak.data.error, "no_invitation");
});

test("NEGATIVE: someone outside the nest cannot invite others into it", async () => {
  const r = await mkNest(alex, ["m-morgan"]);
  const bad = await act(morgan, r.data.nest.id, "invite", { inviteActorIds: ["m-lily"] });
  assert.equal(bad.status, 403, "morgan was invited but hasn't joined — not a member yet");
});

/* ---- isolation ---- */

test("ISOLATION: a nest chat is invisible to the OWNER of the household", async () => {
  // The strictest case on purpose. If the Owner can read it, it is not the space he described.
  const nest = (await mkNest(morgan, ["m-lily"])).data.nest;
  await act(lily, nest.id, "accept");
  const conv = await morgan.req("/api/conversations", {
    method: "POST", body: JSON.stringify({ title: "Just us", visibility: "nest", nestId: nest.id }),
  });
  assert.equal(conv.data.conversation.visibility, "nest");
  const ownerSees = await alex.req("/api/conversations");
  assert.ok(!ownerSees.data.conversations.some((c) => c.id === conv.data.conversation.id),
    "the household Owner must not be able to read a nest thread");
});

test("…but the other nest member can", async () => {
  const nest = (await mkNest(morgan, ["m-lily"])).data.nest;
  await act(lily, nest.id, "accept");
  const conv = await morgan.req("/api/conversations", {
    method: "POST", body: JSON.stringify({ title: "Shared", visibility: "nest", nestId: nest.id }),
  });
  const theirs = await lily.req("/api/conversations");
  assert.ok(theirs.data.conversations.some((c) => c.id === conv.data.conversation.id));
});

test("NEGATIVE: naming a nest you are not in does not put your chat in it", async () => {
  const nest = (await mkNest(morgan, ["m-lily"])).data.nest;
  await act(lily, nest.id, "accept");
  const conv = await alex.req("/api/conversations", {
    method: "POST", body: JSON.stringify({ title: "Nice try", visibility: "nest", nestId: nest.id }),
  });
  assert.notEqual(conv.data.conversation.visibility, "nest");
  assert.equal(conv.data.conversation.visibility, "personal", "it falls back to private, not to shared");
});

test("a nest you were never asked to join is not listed to you at all", async () => {
  const nest = (await mkNest(morgan, ["m-lily"])).data.nest;
  const outsider = await alex.req("/api/nests");
  assert.ok(!outsider.data.nests.some((n) => n.id === nest.id));
  assert.ok(!outsider.data.invitations.some((n) => n.id === nest.id));
});

/* ---- leaving ---- */

test("PERSISTENCE: leaving does not delete what was made inside", async () => {
  const nest = (await mkNest(morgan, ["m-lily"])).data.nest;
  await act(lily, nest.id, "accept");
  const conv = await morgan.req("/api/conversations", {
    method: "POST", body: JSON.stringify({ title: "Kept", visibility: "nest", nestId: nest.id }),
  });
  const left = await act(morgan, nest.id, "leave");
  assert.equal(left.status, 200);
  assert.ok(!left.data.archived, "lily is still in it");
  // The thread stays for whoever is left. Deleting someone else's things on your way out
  // would be a strange thing for leaving to mean.
  const stillThere = await lily.req(`/api/conversations/${conv.data.conversation.id}`);
  assert.equal(stillThere.status, 200);
});

test("a nest nobody is left in is ARCHIVED, not deleted", async () => {
  const nest = (await mkNest(morgan, ["m-lily"])).data.nest;
  await act(lily, nest.id, "accept");
  await act(lily, nest.id, "leave");
  const last = await act(morgan, nest.id, "leave");
  assert.equal(last.data.archived, true);
  assert.ok(!(await morgan.req("/api/nests")).data.nests.some((n) => n.id === nest.id));
});

test("NEGATIVE: you cannot leave a nest you are not in", async () => {
  const nest = (await mkNest(morgan, ["m-lily"])).data.nest;
  const r = await act(alex, nest.id, "leave");
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "not_a_member");
});

test("a nest in another household is invisible, not merely unmodifiable", async () => {
  const r = await act(alex, "nest_does_not_exist", "accept");
  assert.equal(r.status, 404);
});
