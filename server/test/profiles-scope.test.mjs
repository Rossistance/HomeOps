// WP-010 — session-scoped profile picker, per-profile entry rules, and the
// pre-auth privacy flag (ISS-012 / ISS-015). These lock in that:
//   * a `?household=hh_…` hint returns THAT signed-up household's roster only,
//   * no hint returns the resident household (unchanged fresh-browser behavior),
//   * a credentialed member cannot be entered passwordlessly via the picker,
//   * a non-credentialed child CAN enter via the picker into their household,
//   * the resident PIN rules (dev straight-in, prod fail-closed) are UNCHANGED,
//   * `hideProfilesPreAuth` (setting or env) hides a roster until a session exists.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, newId } from "./harness.mjs";

let ctx;
before(async () => { ctx = await startServer(); });
after(async () => { await stopServer(ctx); });

async function raw(path, init = {}) {
  const r = await ctx.fetch(path, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers };
}

// Sign up a disposable hh_* household and add a Child View member (no identity),
// returning the household id + the owner's session cookie/csrf.
async function makeDisposableHousehold() {
  const email = `wp010-${newId()}@example.invalid`;
  const suRes = await ctx.fetch("/api/signup", {
    method: "POST", headers: { "content-type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ email, password: "wp010-strong-pass", ownerName: "WP Owner", householdName: "WP House" }),
  });
  const cookie = (suRes.headers.get("set-cookie") || "").split(";")[0];
  const su = await suRes.json();
  assert.equal(suRes.status, 200, "signup must succeed");
  const hh = su.household.id;
  const csrf = su.session.csrf;
  const add = await ctx.fetch("/api/members", {
    method: "POST", headers: { "content-type": "application/json", Origin: "http://localhost:5173", Cookie: cookie, "x-homeops-csrf": csrf },
    body: JSON.stringify({ displayName: "WP Kid", role: "Child View", actorId: "m-kid", relationship: "Child" }),
  });
  assert.equal(add.status, 200, "owner can add a child member");
  return { hh, cookie, csrf, email };
}

test("no hint → resident roster only (unchanged fresh-browser behavior)", async () => {
  const { hh } = await makeDisposableHousehold();
  const r = await raw("/api/profiles");
  assert.equal(r.status, 200);
  assert.ok(r.data.profiles.some((p) => p.actorId === "m-alex"), "resident seed owner is present");
  assert.ok(!r.data.profiles.some((p) => p.actorId === "m-kid"), "the signed-up household's members must NOT leak into the resident roster");
  assert.ok(!r.data.hidden, "resident picker is visible by default");
  assert.ok(hh.startsWith("hh_"));
});

test("hint returns ONLY that household's roster (owner + child), never the resident's", async () => {
  const { hh } = await makeDisposableHousehold();
  const r = await raw(`/api/profiles?household=${encodeURIComponent(hh)}`);
  assert.equal(r.status, 200);
  const ids = r.data.profiles.map((p) => p.actorId).sort();
  assert.deepEqual(ids, ["m-kid", "m-owner"], "exactly the signed-up household's two members");
  assert.ok(!r.data.profiles.some((p) => p.actorId === "m-alex"), "resident members must not appear");
  assert.equal(r.data.householdName, "WP House");
});

test("a bogus / non-existent hint falls back to the resident roster", async () => {
  const r = await raw("/api/profiles?household=hh_deadbeefcafe");
  assert.equal(r.status, 200);
  assert.ok(r.data.profiles.some((p) => p.actorId === "m-alex"), "unknown hint → resident roster");
});

test("picker entry: a credentialed member (identity) is refused passwordless — no escalation", async () => {
  const { hh } = await makeDisposableHousehold();
  const r = await raw("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-owner", household: hh }) });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "password_required", "the owner has an email+password identity and must use /api/login");
});

test("picker entry: a non-credentialed child enters their household with a Child View session", async () => {
  const { hh } = await makeDisposableHousehold();
  const r = await raw("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-kid", household: hh }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.session.role, "Child View");
  assert.equal(r.data.session.householdId, hh, "the session is scoped to the child's own household");
});

test("picker entry: an unknown actor for the hinted household is rejected", async () => {
  const { hh } = await makeDisposableHousehold();
  const r = await raw("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-nobody", household: hh }) });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "unknown_actor");
});

// ---- Regression: resident household PIN/session rules are UNCHANGED ----
test("regression: resident dev owner signs in straight (no PIN) — no hint", async () => {
  const r = await raw("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-alex" }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.session.role, "Owner");
  assert.equal(r.data.session.householdId, "local");
});

test("privacy flag ON → hinted roster hidden pre-auth, but a session for it unlocks", async () => {
  const { hh, cookie, csrf } = await makeDisposableHousehold();
  const set = await ctx.fetch("/api/settings", {
    method: "POST", headers: { "content-type": "application/json", Origin: "http://localhost:5173", Cookie: cookie, "x-homeops-csrf": csrf },
    body: JSON.stringify({ hideProfilesPreAuth: true }),
  });
  assert.equal(set.status, 200);
  assert.equal((await set.json()).settings.hideProfilesPreAuth, true);
  // No session → hidden, no names.
  const hidden = await raw(`/api/profiles?household=${encodeURIComponent(hh)}`);
  assert.equal(hidden.status, 200);
  assert.equal(hidden.data.hidden, true);
  assert.equal(hidden.data.profiles.length, 0, "no names exposed when the flag is on and no session is presented");
  // A valid session for that household unlocks it.
  const vis = await ctx.fetch(`/api/profiles?household=${encodeURIComponent(hh)}`, { headers: { Origin: "http://localhost:5173", Cookie: cookie } });
  const visData = await vis.json();
  assert.ok(visData.profiles.length >= 2, "a session for the household still sees its roster");
});

test("deployment env HOMEOPS_HIDE_PROFILES_PREAUTH hides the RESIDENT roster pre-auth", async () => {
  const envCtx = await startServer({ env: { HOMEOPS_HIDE_PROFILES_PREAUTH: "1" } });
  try {
    const r = await envCtx.fetch("/api/profiles", { headers: { Origin: "http://localhost:5173" } });
    const data = await r.json();
    assert.equal(r.status, 200);
    assert.equal(data.hidden, true);
    assert.equal(data.profiles.length, 0, "resident names hidden pre-auth under the deployment flag (ISS-015)");
  } finally {
    await stopServer(envCtx);
  }
});

test("regression: PROD resident elevated sign-in stays fail-closed without a PIN", async () => {
  const prodCtx = await startServer({ prod: true });
  try {
    const r = await prodCtx.fetch("/api/session", {
      method: "POST", headers: { "content-type": "application/json", Origin: "http://localhost:5173" },
      body: JSON.stringify({ actorId: "m-alex" }),
    });
    const data = await r.json();
    assert.equal(r.status, 403);
    assert.equal(data.error, "pin_not_configured", "elevated resident login without a PIN is refused in prod — unchanged");
  } finally {
    await stopServer(prodCtx);
  }
});
