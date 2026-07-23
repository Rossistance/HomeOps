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

// UPDATED 2026-07-23: a credentialed OWNER is no longer walled out of their own household's
// picker. The old assertion (owner → password_required) encoded an inconsistency: the
// resident sign-in path always admitted a credentialed Owner on the household PIN alone,
// while this hint path hard-refused them before the PIN was even checked — locking out an
// Owner who forgot their signup password even though they held the PIN. The two paths now
// agree: an elevated role falls through to the Owner-PIN gate; the email/password stays an
// ALTERNATIVE (via /api/login), not a wall. Non-elevated credentialed members are still
// password-gated (the isElevated guard in server/index.mjs).
test("picker entry: a credentialed OWNER is no longer walled — the household PIN admits them", async () => {
  const { hh, cookie, csrf } = await makeDisposableHousehold();
  // Owner sets a household PIN (the family-device authenticator).
  const setPin = await ctx.fetch("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "http://localhost:5173", Cookie: cookie, "x-homeops-csrf": csrf },
    body: JSON.stringify({ ownerPin: "2468" }),
  });
  assert.equal(setPin.status, 200, "owner can set a household PIN");

  // Wrong/absent PIN → PIN gate refuses, but NOT with the old password_required wall.
  const noPin = await raw("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-owner", household: hh }) });
  assert.notEqual(noPin.data.error, "password_required", "the email+password wall is gone for the owner");
  assert.equal(noPin.status, 403);
  assert.equal(noPin.data.error, "pin_required", "the owner is gated by their PIN, not a forgotten password");

  // Correct PIN → in, as an elevated session scoped to their own household. This is the
  // exact scenario the owner asked for: sign in with the PIN, no email/password.
  const ok = await raw("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-owner", household: hh, pin: "2468" }) });
  assert.equal(ok.status, 200, "correct PIN admits the credentialed owner");
  assert.equal(ok.data.session.role, "Owner");
  assert.equal(ok.data.session.householdId, hh, "session scoped to the owner's own household");
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

// Break-glass recovery: while HOMEOPS_BOOTSTRAP_PIN is set, it is accepted as an ALTERNATIVE
// Owner PIN — both when no PIN exists AND when one does (recovering a forgotten PIN). The
// household's own PIN keeps working alongside it. When the env is UNSET, only the real PIN
// works — the override is standing only while the operator has the env present. Prod mode
// (the prod fail-closed gate is what the bootstrap unlocks).
test("break-glass: HOMEOPS_BOOTSTRAP_PIN is an alternative Owner PIN while set, and stops when unset", async () => {
  const p = await startServer({ prod: true, env: { HOMEOPS_BOOTSTRAP_PIN: "9137" } });
  const pf = async (path, init = {}) => {
    const r = await p.fetch(path, { ...init, headers: { "content-type": "application/json", Origin: "http://localhost:5173", ...(init.headers ?? {}) } });
    return { status: r.status, data: await r.json().catch(() => ({})), setCookie: r.headers.get("set-cookie") };
  };
  try {
    const su = await pf("/api/signup", { method: "POST", body: JSON.stringify({ email: `boot-${newId()}@example.invalid`, password: "boot-strong-pass", ownerName: "Boot Owner", householdName: "Boot House" }) });
    assert.equal(su.status, 200, "signup on prod instance");
    const hh = su.data.household.id;
    const cookie = (su.setCookie || "").split(";")[0];
    const csrf = su.data.session.csrf;

    // No PIN yet: bootstrap admits (would be pin_not_configured without it).
    let r = await pf("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-owner", household: hh, pin: "9137" }) });
    assert.equal(r.status, 200, "bootstrap admits a PIN-less owner");
    // Wrong PIN refused.
    r = await pf("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-owner", household: hh, pin: "0000" }) });
    assert.equal(r.status, 403, "wrong PIN refused");

    // Owner sets a REAL PIN. The bootstrap STILL works (break-glass override) AND so does the real PIN.
    const setPin = await pf("/api/settings", { method: "POST", headers: { Cookie: cookie, "x-homeops-csrf": csrf }, body: JSON.stringify({ ownerPin: "2468" }) });
    assert.equal(setPin.status, 200, "owner sets a real PIN");
    r = await pf("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-owner", household: hh, pin: "2468" }) });
    assert.equal(r.status, 200, "the household's own PIN works");
    r = await pf("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-owner", household: hh, pin: "9137" }) });
    assert.equal(r.status, 200, "break-glass bootstrap PIN ALSO works while the env is set (recovers a forgotten PIN)");
  } finally {
    await stopServer(p);
  }

  // With the env UNSET, the bootstrap PIN no longer works — only the real PIN.
  const p2 = await startServer({ prod: true });
  const pf2 = async (path, init = {}) => {
    const r = await p2.fetch(path, { ...init, headers: { "content-type": "application/json", Origin: "http://localhost:5173", ...(init.headers ?? {}) } });
    return { status: r.status, data: await r.json().catch(() => ({})), setCookie: r.headers.get("set-cookie") };
  };
  try {
    const su = await pf2("/api/signup", { method: "POST", body: JSON.stringify({ email: `noboot-${newId()}@example.invalid`, password: "noboot-strong-pass", ownerName: "NB Owner", householdName: "NB House" }) });
    const hh = su.data.household.id;
    const cookie = (su.setCookie || "").split(";")[0];
    const csrf = su.data.session.csrf;
    await pf2("/api/settings", { method: "POST", headers: { Cookie: cookie, "x-homeops-csrf": csrf }, body: JSON.stringify({ ownerPin: "2468" }) });
    let r = await pf2("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-owner", household: hh, pin: "9137" }) });
    assert.equal(r.status, 403, "no env → the old bootstrap PIN does NOT work");
    r = await pf2("/api/session", { method: "POST", body: JSON.stringify({ actorId: "m-owner", household: hh, pin: "2468" }) });
    assert.equal(r.status, 200, "the real PIN still works");
  } finally {
    await stopServer(p2);
  }
});
