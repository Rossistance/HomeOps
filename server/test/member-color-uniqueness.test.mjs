// One person, one colour — enforced where it can't be dodged.
//
// BUG-02: "In the settings page you do have the ability to select a color that someone else
// is already on… boots them off… the colors have to be strict."
//
// The picker now refuses client-side, but the Settings editor proved the hard way that a
// rule living only in one client is a rule the next screen un-invents. So the API is the
// law: exact takes and too-close takes both 409, naming the holder, and the six newer hues
// actually SAVE — the old six-name allowlist silently dropped them, which made the picker's
// confirmation a false success about a colour that never persisted.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, adult;

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
  adult = await makeSession(ctx, "m-morgan");
  const r = await adult.req(`/api/members/${adult.actorId}`, { method: "PATCH", body: JSON.stringify({ color: "amber" }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.member.color, "amber");
});
after(async () => { await stopServer(ctx); });

test("THE REPORTED CASE: taking a colour someone already holds is refused, with their name", async () => {
  const r = await owner.req(`/api/members/${owner.actorId}`, { method: "PATCH", body: JSON.stringify({ color: "amber" }) });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, "color_taken");
  assert.ok(String(r.data.message).includes("Morgan"), "the refusal says WHO, so it reads as a rule, not a glitch");
});

test("…and 'within two deviations' is taken too — near-identical is indistinguishable", async () => {
  // amber's canonical hex is #B4791E; two clicks away on the spectrum must still be his.
  const r = await owner.req(`/api/members/${owner.actorId}`, { method: "PATCH", body: JSON.stringify({ color: "#B07A20" }) });
  assert.equal(r.status, 409, "a colour you can't tell apart IS the same colour for identity purposes");
});

test("a genuinely different colour is granted", async () => {
  const r = await owner.req(`/api/members/${owner.actorId}`, { method: "PATCH", body: JSON.stringify({ color: "teal" }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.member.color, "teal", "the six newer hues persist now — they used to be silently dropped");
});

test("re-saving your OWN colour is not a collision with yourself", async () => {
  const r = await adult.req(`/api/members/${adult.actorId}`, { method: "PATCH", body: JSON.stringify({ color: "amber" }) });
  assert.equal(r.status, 200);
});

test("an unknown colour string is refused out loud, never silently skipped", async () => {
  // The old behaviour: normalize → undefined → field quietly dropped → picker claims success.
  const r = await adult.req(`/api/members/${adult.actorId}`, { method: "PATCH", body: JSON.stringify({ color: "chartreuse-dream" }) });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "bad_color");
});

test("clearing a colour frees it for someone else", async () => {
  await adult.req(`/api/members/${adult.actorId}`, { method: "PATCH", body: JSON.stringify({ color: null }) });
  const r = await owner.req(`/api/members/${owner.actorId}`, { method: "PATCH", body: JSON.stringify({ color: "amber" }) });
  assert.equal(r.status, 200, "a released colour is a free colour");
});
