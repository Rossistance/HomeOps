// THEME D — getting in, and getting back in.
//
//   [01:32] "There's no forgot password. It should send an email with a recovery code."
//   [01:46] "And a forgot email, or forgot username."
//   [02:12] "The household name should be required." (it was optional)
//   [02:21] "The invite code stays optional."
//   [02:25] "I am the inventor and owner. I need an interface to generate invite codes for
//            any household. New households do not get this."
//
// The security shape carries most of these. A recovery flow that reveals whether an email is
// registered is an account-enumeration oracle. And a cross-household capability that lives in
// `session.role` is one bad check away from a household Owner reaching another family — which
// is why D5 is a deployment env, not a role.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, ORIGIN } from "./harness.mjs";

let ctx;
before(async () => {
  ctx = await startServer({ env: {
    HOMEOPS_OPERATOR_EMAILS: "operator@familios.app",
    // This file legitimately signs up a dozen households and burns five reset attempts on
    // purpose; the production 20/minute auth cap would throttle the suite, not a threat.
    HOMEOPS_AUTH_RATE_LIMIT: "500",
  } });
});
after(async () => { await stopServer(ctx); });

const PW = "hunter2hunter2";
const post = (path, body, extra = {}) => ctx.fetch(path, {
  method: "POST",
  headers: { "content-type": "application/json", Origin: ORIGIN, ...extra },
  body: JSON.stringify(body),
});
const jpost = async (path, body, extra) => {
  const r = await post(path, body, extra);
  return { status: r.status, data: await r.json().catch(() => null) };
};
/** Sign up (or log in) and return an authed { cookie, csrf, session }. */
async function authed(path, body) {
  const r = await post(path, body);
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const data = await r.json().catch(() => null);
  return { cookie, csrf: data?.session?.csrf, session: data?.session, status: r.status, data };
}
const authedFetch = (path, { cookie, csrf }, init = {}) => ctx.fetch(path, {
  ...init,
  headers: {
    Origin: ORIGIN, Cookie: cookie,
    ...(init.body ? { "content-type": "application/json" } : {}),
    ...(init.method && init.method !== "GET" ? { "x-homeops-csrf": csrf } : {}),
  },
});

/* ---- D3 / D4: what signup requires ---- */

test("D3: creating a household REQUIRES a name — no silent fallback name", async () => {
  const r = await jpost("/api/signup", { email: "noname@example.com", password: PW, ownerName: "Ross" });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "household_name_required");
  assert.match(r.data.message, /name/i);
});

test("D3: with a name it goes through", async () => {
  const r = await jpost("/api/signup", { email: "named@example.com", password: PW, ownerName: "Ross", householdName: "The Hixons" });
  assert.equal(r.status, 200);
  assert.match(r.data.session.householdId, /^hh_/);
});

test("D4: the code stays OPTIONAL — and a JOINER is never asked to name a household", async () => {
  const owner = await authed("/api/signup", { email: "owner4@example.com", password: PW, ownerName: "Owner", householdName: "Fourth" });
  const inv = await authedFetch("/api/invites", owner, {
    method: "POST", body: JSON.stringify({ displayName: "Melissa", role: "Adult Member" }),
  });
  const token = (await inv.json()).invite.token;
  // No householdName supplied — must still succeed, because joining is not naming.
  const joined = await jpost("/api/signup", { email: "joiner@example.com", password: PW, ownerName: "Melissa", inviteToken: token });
  assert.equal(joined.status, 200);
  assert.equal(joined.data.session.role, "Adult Member");
});

/* ---- D1: forgot password ---- */

test("D1: the response is IDENTICAL for a real and an unknown email — no enumeration", async () => {
  await jpost("/api/signup", { email: "real@example.com", password: PW, ownerName: "Real", householdName: "Real House" });
  const a = await jpost("/api/password-reset/request", { email: "real@example.com" });
  const b = await jpost("/api/password-reset/request", { email: "nobody-at-all@example.com" });
  assert.equal(a.status, b.status);
  assert.deepEqual(a.data, b.data, "a different answer would tell an attacker which emails exist");
  assert.match(a.data.message, /recovery code/i);
});

test("D1: a wrong code is refused, and the refusal doesn't confirm the account exists", async () => {
  await jpost("/api/password-reset/request", { email: "real@example.com" });
  const wrong = await jpost("/api/password-reset/verify-code", { email: "real@example.com", code: "000000" });
  const nobody = await jpost("/api/password-reset/verify-code", { email: "nobody-at-all@example.com", code: "000000" });
  assert.equal(wrong.status, 400);
  assert.equal(nobody.status, 400);
  assert.equal(wrong.data.error, nobody.data.error, "same error either way");
});

test("D1: the code is attempt-limited — a million-guess space needs a cap", async () => {
  await jpost("/api/password-reset/request", { email: "real@example.com" });
  for (let i = 0; i < 5; i++) await jpost("/api/password-reset/verify-code", { email: "real@example.com", code: "111111" });
  const sixth = await jpost("/api/password-reset/verify-code", { email: "real@example.com", code: "111111" });
  assert.equal(sixth.data.error, "too_many_attempts");
  assert.match(sixth.data.message, /new one/i);
});

test("D1: completing needs a real token, and a weak password is refused", async () => {
  assert.equal((await jpost("/api/password-reset/complete", { token: "made-up", password: PW })).data.error, "invalid_or_expired_token");
  assert.equal((await jpost("/api/password-reset/complete", { token: "made-up", password: "short" })).data.error, "weak_password");
});

/* ---- D2: forgot which email ---- */

test("D2: the answer is emailed to the account, never returned in the response", async () => {
  const r = await jpost("/api/email-recovery/request", { inviteCode: "whatever", displayName: "Ross" });
  assert.equal(r.status, 200);
  assert.equal(r.data.email, undefined, "returning the address here would leak it to whoever asked");
  assert.match(r.data.message, /emailed the address to itself/i);
});

/* ---- D5: the operator surface ---- */

test("D5: a household Owner is NOT an operator — the capability is in no role", async () => {
  const owner = await authed("/api/signup", { email: "plainowner@example.com", password: PW, ownerName: "Plain", householdName: "Plain House" });
  assert.equal(owner.session.role, "Owner");
  // 404, not 403: a surface that's off must not announce that it exists.
  const r = await authedFetch("/api/admin/households", owner);
  assert.equal(r.status, 404);
  const sess = await authedFetch("/api/session", owner).then((x) => x.json());
  assert.equal(sess.session.isOperator, false);
});

test("D5: the configured operator lists households and mints a code into one", async () => {
  const target = await jpost("/api/signup", { email: "target@example.com", password: PW, ownerName: "Target", householdName: "Target House" });
  const targetHh = target.data.session.householdId;

  const op = await authed("/api/signup", { email: "operator@familios.app", password: PW, ownerName: "Operator", householdName: "Ops" });
  const sess = await authedFetch("/api/session", op).then((x) => x.json());
  assert.equal(sess.session.isOperator, true, "recognised by their own registered email");

  const list = await authedFetch("/api/admin/households", op);
  assert.equal(list.status, 200);
  const rows = (await list.json()).households;
  assert.ok(rows.some((h) => h.id === targetHh && h.name === "Target House"), "listed by their real names");

  const made = await authedFetch("/api/admin/invites", op, {
    method: "POST", body: JSON.stringify({ householdId: targetHh, displayName: "GPop", role: "Adult Member" }),
  });
  assert.equal(made.status, 200);
  const invite = (await made.json()).invite;
  assert.equal(invite.householdId, targetHh);

  // And the code actually works — somebody redeems it into THAT household.
  const joined = await jpost("/api/signup", { email: "gpop@example.com", password: PW, ownerName: "GPop", inviteToken: invite.token });
  assert.equal(joined.data.session.householdId, targetHh);
});

test("D5: the operator cannot hand out OWNERSHIP of a household", async () => {
  const target = await jpost("/api/signup", { email: "target2@example.com", password: PW, ownerName: "T2", householdName: "T2 House" });
  const op = await authed("/api/login", { email: "operator@familios.app", password: PW });
  const made = await authedFetch("/api/admin/invites", op, {
    method: "POST", body: JSON.stringify({ householdId: target.data.session.householdId, displayName: "Usurper", role: "Owner" }),
  });
  assert.equal((await made.json()).invite.role, "Adult Member", "Owner is never grantable by invite");
});

test("D5: an unknown household id is refused", async () => {
  const op = await authed("/api/login", { email: "operator@familios.app", password: PW });
  const r = await authedFetch("/api/admin/invites", op, {
    method: "POST", body: JSON.stringify({ householdId: "hh_deadbeef", displayName: "Ghost" }),
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "unknown_household");
});
