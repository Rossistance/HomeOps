// The sign-in PIN, and saying out loud when a second one is also being accepted.
//
// Reported plainly: "im using that as my pin" — of HOMEOPS_BOOTSTRAP_PIN, the deployment's
// break-glass override. That is not one person's PIN. While the env var is set it is an
// alternative to the household's own PIN for EVERY Owner and Adult Admin account, it lives in
// plaintext in a dashboard, and every sign-in through it is filed as emergency access.
//
// Two things follow, and both are tested here:
//   the app must SAY that a second PIN is in play, rather than the household having to be
//   told by whoever set it up;
//   and the household must be able to set its own — which on a phone-first app means from
//   the phone, where until now it could only be done on the web.
//
// The overlap is the point: while the env var is set, BOTH work. So there is no moment where
// setting your own PIN locks you out, and no moment where removing the env var later is a
// leap of faith — you sign in with your own first, then it goes.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, ORIGIN } from "./harness.mjs";

let ctx, admin, member;
const BOOT = "6024";

before(async () => {
  process.env.HOMEOPS_BOOTSTRAP_PIN = BOOT;
  ctx = await startServer();
  // With the env PIN set, elevated sign-in needs one — so the harness supplies it, which is
  // itself the situation under test.
  admin = await makeSession(ctx, "m-alex", { pin: BOOT });
  member = await makeSession(ctx, "m-lily");   // Child View
});
after(async () => { delete process.env.HOMEOPS_BOOTSTRAP_PIN; await stopServer(ctx); });

const getSettings = (as) => as.req("/api/settings");
const setPin = (as, ownerPin) => as.req("/api/settings", { method: "POST", body: JSON.stringify({ ownerPin }) });

/* ---- disclosure ---- */

test("the app says when a PIN set in the ENVIRONMENT is also being accepted", async () => {
  const r = await getSettings(admin);
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.breakGlassActive, true,
    "a shared secret that opens every elevated account must not be invisible from inside the app");
});

/* ---- setting your own ---- */

test("an Owner can set the household's own PIN", async () => {
  const r = await setPin(admin, "481902");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.settings.ownerPinSet, true);
});

test("the PIN is never readable back — only replaceable", async () => {
  const r = await getSettings(admin);
  const s = JSON.stringify(r.data.settings);
  assert.ok(!s.includes("481902"), "not in the clear");
  assert.ok(!/ownerPinHash/.test(s), "and not as a hash either — a 4-digit sha256 is a lookup away");
  assert.equal(r.data.settings.ownerPinSet, true, "only whether one exists");
});

test("NEGATIVE: a too-short PIN is refused by the SERVER, not just the form", async () => {
  const r = await setPin(admin, "12");
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "bad_pin");
  // …and the previous PIN is untouched, rather than cleared by a rejected write.
  assert.equal((await getSettings(admin)).data.settings.ownerPinSet, true);
});

test("NEGATIVE: letters aren't a PIN — the lock screen is a number pad", async () => {
  assert.equal((await setPin(admin, "letmein")).status, 400);
});

test("NEGATIVE: a child cannot set the PIN that guards the adults' accounts", async () => {
  const r = await setPin(member, "999999");
  assert.equal(r.status, 403);
});

/* ---- the overlap that makes the migration safe ---- */

const signIn = async (actorId, pin) => {
  const r = await fetch(`${ctx.base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-homeops-bearer": "1" },
    body: JSON.stringify({ actorId, pin }),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

test("BOTH PINs work while the env var is set — so setting your own never locks you out", async () => {
  await setPin(admin, "481902");
  assert.equal((await signIn("m-alex", "481902")).status, 200, "the household's own");
  assert.equal((await signIn("m-alex", BOOT)).status, 200, "and the recovery one, still");
});

test("…and anything else is still refused", async () => {
  const r = await signIn("m-alex", "000000");
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "pin_required");
});

test("a break-glass sign-in is filed as one, so it can be told apart afterwards", async () => {
  await setPin(admin, "481902");
  await signIn("m-alex", BOOT);
  const audit = await admin.req("/api/audit?limit=50");
  const rows = audit.data.events ?? [];
  assert.ok(rows.some((e) => e.type === "session.login.breakglass"),
    "using the shared secret must leave a different trace from a normal sign-in");
});
