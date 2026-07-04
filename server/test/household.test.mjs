// HOUSEHOLD — profile picker, one-time claim (demo → your family), member management.
// This locks in the fix for the real-world break: a client-side "blank household"
// owner (m-owner) could never open a server session (unknown_actor) because no path
// existed to register members server-side.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx;
before(async () => { ctx = await startServer(); });
after(async () => { await stopServer(ctx); });

// Raw request helper (no session) — ctx.fetch sets the allowed test Origin.
async function raw(path, init = {}) {
  const r = await ctx.fetch(path, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers };
}

test("profiles are listable pre-auth and show the demo roster unclaimed", async () => {
  const r = await raw("/api/profiles");
  assert.equal(r.status, 200);
  assert.ok(r.data.profiles.some((p) => p.actorId === "m-alex"));
  assert.equal(r.data.claimed, false, "seed-only roster reports unclaimed");
});

test("an unregistered actor still cannot log in (the original bug's guard)", async () => {
  const r = await raw("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-owner", actorName: "Ross", role: "Owner" }) });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "unknown_actor");
});

test("claiming the household archives the demo roster, registers the owner, and signs them in", async () => {
  const r = await raw("/api/household/claim", { method: "POST", headers: { "x-homeops-bearer": "1" }, body: JSON.stringify({ ownerName: "Ross", actorId: "m-owner" }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.member.actorId, "m-owner");
  assert.equal(r.data.session.role, "Owner", "role is server-resolved Owner");
  assert.ok(r.data.token, "bearer token issued when requested");
  // The demo family is gone from the picker; Ross is there; household is claimed.
  const profiles = (await raw("/api/profiles")).data;
  assert.ok(!profiles.profiles.some((p) => p.actorId === "m-alex"), "demo members archived");
  assert.ok(profiles.profiles.some((p) => p.actorId === "m-owner"));
  assert.equal(profiles.claimed, true);
  // Ross can now log in normally (the exact call that used to 403).
  const login = await raw("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-owner" }) });
  assert.equal(login.status, 200);
  assert.equal(login.data.session.role, "Owner");
  // Archived demo member can no longer log in.
  const alex = await raw("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-alex" }) });
  assert.equal(alex.status, 403);
  assert.equal(alex.data.error, "member_archived");
});

test("a second claim is refused once the household is owned", async () => {
  const r = await raw("/api/household/claim", { method: "POST", body: JSON.stringify({ ownerName: "Mallory" }) });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, "already_claimed");
});

test("the owner manages the roster: create, role-change guard, archive guards", async () => {
  const owner = await makeSession(ctx, "m-owner");
  // Create a partner (Adult Admin) and a kid.
  const partner = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Jamie", role: "Adult Admin" }) });
  assert.equal(partner.status, 200);
  const kid = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Sasha", role: "Child View", relationship: "Child (age 7)" }) });
  assert.equal(kid.status, 200);
  // Bad role rejected.
  const bad = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "X", role: "Supreme Leader" }) });
  assert.equal(bad.status, 400);
  // The new kid appears in the authenticated roster and can log in with the server-resolved role.
  const roster = (await owner.req("/api/members")).data.members;
  assert.ok(roster.some((m) => m.displayName === "Sasha" && m.role === "Child View"));
  const kidLogin = await raw("/api/session", { method: "POST", body: JSON.stringify({ actorId: kid.data.member.actorId, role: "Owner" }) });
  assert.equal(kidLogin.data.session.role, "Child View", "client-claimed Owner ignored; registry wins");
  // Last-Owner protection: demoting or archiving the only Owner is refused.
  const demote = await owner.req("/api/members/m-owner", { method: "PATCH", body: JSON.stringify({ role: "Adult Member" }) });
  assert.equal(demote.status, 409);
  assert.equal(demote.data.error, "last_owner");
  const selfArchive = await owner.req("/api/members/m-owner", { method: "DELETE" });
  assert.equal(selfArchive.status, 409, "cannot archive yourself (also the last owner)");
  // Archive the kid; they vanish from the roster and can't log in.
  const del = await owner.req(`/api/members/${kid.data.member.actorId}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  const after1 = (await owner.req("/api/members")).data.members;
  assert.ok(!after1.some((m) => m.actorId === kid.data.member.actorId));
  const kidLogin2 = await raw("/api/session", { method: "POST", body: JSON.stringify({ actorId: kid.data.member.actorId }) });
  assert.equal(kidLogin2.status, 403);
});

test("a child cannot manage the roster", async () => {
  const owner = await makeSession(ctx, "m-owner");
  const kid = (await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Kim", role: "Child View" }) })).data.member;
  const kidSession = await makeSession(ctx, kid.actorId);
  const r = await kidSession.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Friend", role: "Owner" }) });
  assert.equal(r.status, 403);
});
