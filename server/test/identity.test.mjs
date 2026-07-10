// C1.4 self-serve identity: stranger households sign up, live in physically
// separate tenant databases, and can never see each other — proven through the
// real HTTP surface (the C1 exit invariant). Plus login hygiene, verification
// and reset token flows, and Apple 5.1.1(v) account deletion.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { startServer, stopServer, readStoreDoc, ORIGIN } from "./harness.mjs";

let ctx;
before(async () => { ctx = await startServer(); });
after(async () => { await stopServer(ctx); });

// Sign up a fresh household and return an authed client (cookie + CSRF).
async function signup(email, ownerName, householdName) {
  const res = await ctx.fetch("/api/signup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery", ownerName, householdName }),
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  const data = await res.json();
  return {
    status: res.status, data, cookie, csrf: data.session?.csrf, householdId: data.session?.householdId,
    async req(path, init = {}) {
      const headers = { Cookie: cookie, ...(init.headers || {}) };
      if (init.method && init.method !== "GET") { headers["x-homeops-csrf"] = data.session.csrf; headers["content-type"] ??= "application/json"; }
      const r = await ctx.fetch(path, { ...init, headers });
      let out = null; try { out = await r.json(); } catch { /* non-JSON */ }
      return { status: r.status, data: out };
    },
  };
}

let hixon, garcia; // two stranger households

test("signup creates a working, isolated household", async () => {
  hixon = await signup("ross@example.com", "Ross", "Test Hixons");
  assert.equal(hixon.status, 200, JSON.stringify(hixon.data));
  assert.equal(hixon.data.session.role, "Owner");
  assert.match(hixon.data.session.householdId, /^hh_/);
  const hh = await hixon.req("/api/household");
  assert.equal(hh.data.household.name, "Test Hixons");
  const members = await hixon.req("/api/members");
  assert.equal(members.data.members.filter((m) => !m.archived).length, 1, "a fresh household has exactly its owner");
});

test("duplicate email is refused; weak password is refused", async () => {
  const dup = await ctx.fetch("/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ross@example.com", password: "correct horse battery", ownerName: "Impostor" }) });
  assert.equal(dup.status, 409);
  const weak = await ctx.fetch("/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "weak@example.com", password: "short", ownerName: "W" }) });
  assert.equal(weak.status, 400);
});

test("THE isolation invariant: two stranger households can't see each other's data", async () => {
  garcia = await signup("maria@example.com", "Maria", "Los Garcia");
  assert.notEqual(garcia.householdId, hixon.householdId);

  const made = await hixon.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Hixon secret task", type: "task" }) });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const taskId = made.data.task.id;

  const garciaTasks = await garcia.req("/api/tasks");
  assert.equal((garciaTasks.data.tasks ?? []).length, 0, "Garcia sees NO Hixon tasks");
  const direct = await garcia.req(`/api/tasks/${taskId}`);
  assert.equal(direct.status, 404, "even a known id resolves against Garcia's own (empty) household");
  const garciaMembers = await garcia.req("/api/members");
  assert.ok(!garciaMembers.data.members.some((m) => m.displayName === "Ross"), "rosters don't leak");
  const garciaHH = await garcia.req("/api/household");
  assert.equal(garciaHH.data.household.name, "Los Garcia");

  // Settings isolation end-to-end: Garcia flips her kill switch; Hixon unaffected.
  await garcia.req("/api/settings", { method: "POST", body: JSON.stringify({ externalActionsEnabled: false }) });
  const hixonSettings = await hixon.req("/api/settings");
  assert.equal(hixonSettings.data.settings.externalActionsEnabled, true);

  // Physical separation on disk.
  assert.ok(fs.existsSync(join(ctx.dataDir, "tenants", hixon.householdId, "household.db")));
  assert.ok(fs.existsSync(join(ctx.dataDir, "tenants", garcia.householdId, "household.db")));
});

test("the resident family household is untouched by stranger signups", async () => {
  const profiles = await (await ctx.fetch("/api/profiles")).json();
  assert.ok(profiles.profiles.some((p) => p.actorId === "m-alex"), "seed roster still present");
  assert.ok(!profiles.profiles.some((p) => p.displayName === "Ross" && p.role === "Owner" && p.actorId === "m-owner"), "stranger owners never appear on the resident lock screen");
});

test("login: right password works, wrong password and unknown email fail identically", async () => {
  const good = await ctx.fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ross@example.com", password: "correct horse battery" }) });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).session.householdId, hixon.householdId);
  const bad = await ctx.fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ross@example.com", password: "wrong password!" }) });
  const unknown = await ctx.fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nobody@example.com", password: "whatever password" }) });
  assert.equal(bad.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await bad.json(), await unknown.json(), "no account enumeration");
});

test("email verification token flow", async () => {
  const identities = readStoreDoc(ctx, "identities.json", {}, "_system");
  const idn = identities["ross@example.com"];
  assert.equal(idn.emailVerified, false);
  const r = await ctx.fetch("/api/verify-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: idn.verifyToken }) });
  assert.equal(r.status, 200);
  assert.equal(readStoreDoc(ctx, "identities.json", {}, "_system")["ross@example.com"].emailVerified, true);
  const again = await ctx.fetch("/api/verify-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: idn.verifyToken }) });
  assert.equal(again.status, 400, "tokens are one-shot");
});

test("password reset: request is enumeration-safe, token rotates the password and kills sessions", async () => {
  const r1 = await ctx.fetch("/api/password-reset/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nobody@example.com" }) });
  assert.equal(r1.status, 200, "unknown email still answers 200");
  await ctx.fetch("/api/password-reset/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "maria@example.com" }) });
  const token = readStoreDoc(ctx, "identities.json", {}, "_system")["maria@example.com"].resetToken;
  assert.ok(token);
  const done = await ctx.fetch("/api/password-reset/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password: "brand new passphrase" }) });
  assert.equal(done.status, 200);
  // Old session is dead; old password fails; new password works.
  const oldSession = await garcia.req("/api/settings");
  assert.equal(oldSession.status, 401, "reset revokes every existing session");
  const oldPw = await ctx.fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "maria@example.com", password: "correct horse battery" }) });
  assert.equal(oldPw.status, 401);
  const newPw = await ctx.fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "maria@example.com", password: "brand new passphrase" }) });
  assert.equal(newPw.status, 200);
});

test("Apple 5.1.1(v): owner deletion removes the household's database; neighbors unaffected", async () => {
  const del = await hixon.req("/api/account", { method: "DELETE", body: JSON.stringify({ password: "correct horse battery" }) });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(del.data.deleted, "household");
  assert.ok(!fs.existsSync(join(ctx.dataDir, "tenants", hixon.householdId)), "the household directory is GONE");
  assert.equal((await hixon.req("/api/settings")).status, 401, "sessions dead");
  const relog = await ctx.fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ross@example.com", password: "correct horse battery" }) });
  assert.equal(relog.status, 401, "identity gone with the household");
  // Garcia (new password, fresh login) is untouched.
  const g = await ctx.fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "maria@example.com", password: "brand new passphrase" }) });
  assert.equal(g.status, 200);
  // Tombstone recorded in the system registry.
  const gone = readStoreDoc(ctx, "deleted_households.json", [], "_system");
  assert.ok(gone.some((x) => x.householdId === hixon.householdId));
});

test("deletion requires the correct password", async () => {
  const maria = await ctx.fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "maria@example.com", password: "brand new passphrase" }) });
  const cookie = (maria.headers.get("set-cookie") || "").split(";")[0];
  const mdata = await maria.json();
  const r = await ctx.fetch("/api/account", { method: "DELETE", headers: { Cookie: cookie, "x-homeops-csrf": mdata.session.csrf, "content-type": "application/json" }, body: JSON.stringify({ password: "not her password" }) });
  assert.equal(r.status, 403);
});
