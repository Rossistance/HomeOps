// Who may touch whom — nests, calendars, and the one-nest rule.
//
// GFIS walkthrough, Clusters W/X/Y:
//  "Adult members or even admins should not have the ability to update anybody else's
//   account but themselves, their child or someone else in their nest."
//  "For the child, they should only be able to edit their color, and that's it."
//  "You cannot join another nest until you leave your current nest… too many silos,
//   communication would get garbled."
//  "There should be no availability to sync or remove a calendar that was not added through
//   their login."
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, writeStoreDoc } from "./harness.mjs";

let ctx, owner, adult, adult2, child;

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
  adult = await makeSession(ctx, "m-morgan");
  const made = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Sam", role: "Adult Member", relationship: "grandparent" }) });
  adult2 = await makeSession(ctx, made.data.member.actorId);
  child = await makeSession(ctx, "m-lily");
});
after(async () => { await stopServer(ctx); });

/* ------------------------------ Cluster W ------------------------------ */

test("an adult cannot edit an adult outside their nest — role is not reach", async () => {
  const r = await adult.req(`/api/members/${adult2.actorId}`, { method: "PATCH", body: JSON.stringify({ displayName: "Hijacked" }) });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "outside_your_nest");
});

test("…but CAN edit someone in their own nest", async () => {
  // Morgan nests with Sam (Sam accepts), then Morgan may edit Sam's presentation.
  const made = await adult.req("/api/nests", { method: "POST", body: JSON.stringify({ name: "The pair", inviteActorIds: [adult2.actorId] }) });
  assert.ok(made.data?.nest?.id, JSON.stringify(made.data));
  const acc = await adult2.req(`/api/nests/${made.data.nest.id}/accept`, { method: "POST", body: "{}" });
  assert.ok(acc.data?.nest, JSON.stringify(acc.data));
  const r = await adult.req(`/api/members/${adult2.actorId}`, { method: "PATCH", body: JSON.stringify({ displayName: "Sam R." }) });
  assert.equal(r.status, 200, "a nest is 'their people' — editing inside it is the point");
});

test("the Owner still edits anyone — someone answers for the household", async () => {
  const r = await owner.req(`/api/members/${adult2.actorId}`, { method: "PATCH", body: JSON.stringify({ displayName: "Sam" }) });
  assert.equal(r.status, 200);
});

test("a child edits their own colour and emoji — and NOTHING else", async () => {
  const ok = await child.req(`/api/members/${child.actorId}`, { method: "PATCH", body: JSON.stringify({ color: "plum", photoFileId: "emoji:🦊" }) });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const name = await child.req(`/api/members/${child.actorId}`, { method: "PATCH", body: JSON.stringify({ displayName: "Lily the Great" }) });
  assert.equal(name.status, 403);
  assert.equal(name.data.error, "child_limited");
  const photo = await child.req(`/api/members/${child.actorId}`, { method: "PATCH", body: JSON.stringify({ photoFileId: "file_abc" }) });
  assert.equal(photo.status, 403, "a real photo is a grown-up decision — 'not a photo currently'");
});

/* ------------------------------ Cluster X ------------------------------ */

test("ONE nest at a time: in one, you cannot create another", async () => {
  const r = await adult.req("/api/nests", { method: "POST", body: JSON.stringify({ name: "Second silo", inviteActorIds: [owner.actorId] }) });
  assert.equal(r.data?.error, "already_nested", JSON.stringify(r.data));
});

test("…and cannot ACCEPT a second invitation either — both doors, one rule", async () => {
  // Owner (nest-free) invites Sam, who is already nested with Morgan.
  const made = await owner.req("/api/nests", { method: "POST", body: JSON.stringify({ name: "Owner's nest", inviteActorIds: [adult2.actorId] }) });
  assert.ok(made.data?.nest?.id, JSON.stringify(made.data));
  const r = await adult2.req(`/api/nests/${made.data.nest.id}/accept`, { method: "POST", body: "{}" });
  assert.equal(r.data?.error, "already_nested", "accepting is joining; joining while joined is the garble he ruled out");
});

/* ------------------------------ Cluster Y ------------------------------ */

test("a calendar synced by one member cannot be synced or removed by another adult", async () => {
  writeStoreDoc(ctx, "calendar_subscriptions.json", {
    sub_ross: { id: "sub_ross", householdId: owner.raw?.session?.householdId, source: "ics", name: "WR Hixon calendar", createdBy: owner.actorId },
  });
  const sync = await adult.req("/api/calendar/subscriptions/sub_ross/sync", { method: "POST", body: "{}" });
  assert.equal(sync.status, 403);
  assert.equal(sync.data.error, "not_your_calendar");
  assert.ok(sync.data.message.includes("Alex"), "the refusal names whose calendar it is");
  const del = await adult.req("/api/calendar/subscriptions/sub_ross", { method: "DELETE" });
  assert.equal(del.status, 403, "removing someone's calendar removes THEIR events from the family view");
});

test("…while the Owner keeps household-wide stewardship of connections", async () => {
  const del = await owner.req("/api/calendar/subscriptions/sub_ross", { method: "DELETE" });
  assert.equal(del.status, 200, "the Owner may remove any — someone has to be able to clean up");
});
