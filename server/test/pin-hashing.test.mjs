// The PIN, stored properly — and every household migrated without being asked to.
//
// What was wrong: a bare unsalted sha256. Identical PINs across households produced identical
// digests, and the whole 4-digit space hashes in under a millisecond, so a leak of the store
// was a leak of the PINs. scrypt replaces it: salted per PIN, memory-hard, deliberately slow.
//
// The test that matters most is the MIGRATION one. A security fix that logs everyone out is a
// security fix nobody deploys, so a legacy hash must still sign in — once — and be upgraded on
// the way through. If that breaks, the fix is worse than the flaw.
//
// Stated in the module too, and worth repeating: this does not make a 4-digit PIN a good
// secret. It closes the offline shortcut. What bounds online guessing is the rate limit on
// /api/session and the audit trail, both of which predate this.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer, stopServer, makeSession, writeStoreDoc, readStoreDoc, ORIGIN } from "./harness.mjs";
import { hashPin, verifyPin, needsRehash, isLegacyHash, matchesPlainSecret } from "../pin.mjs";

const legacy = (pin) => crypto.createHash("sha256").update(pin).digest("hex");

/* ------------------------- the primitive ------------------------- */

test("a PIN verifies against its own hash and nothing else", async () => {
  const stored = await hashPin("481902");
  assert.equal(await verifyPin("481902", stored), true);
  assert.equal(await verifyPin("481903", stored), false);
  assert.equal(await verifyPin("", stored), false);
  assert.equal(await verifyPin(null, stored), false);
});

test("SALTED: the same PIN in two households does not produce the same stored value", async () => {
  const a = await hashPin("1234");
  const b = await hashPin("1234");
  assert.notEqual(a, b, "identical digests would leak which households share a PIN");
  assert.equal(await verifyPin("1234", a), true);
  assert.equal(await verifyPin("1234", b), true);
});

test("the stored value carries its own cost parameters", async () => {
  const stored = await hashPin("1234");
  const [scheme, n, r, p] = stored.split("$");
  assert.equal(scheme, "scrypt");
  assert.ok(Number(n) >= 16384, "cheap enough to brute-force would defeat the point");
  assert.ok(Number(r) >= 8 && Number(p) >= 1);
  // Read from the RECORD, not from today's constants — otherwise raising the cost later would
  // silently invalidate every PIN stored before the change.
  assert.equal(await verifyPin("1234", `scrypt$16384$8$1$${stored.split("$")[4]}$${stored.split("$")[5]}`), true);
});

test("a corrupt or unknown stored value fails closed", async () => {
  for (const bad of ["", null, undefined, "nonsense", "scrypt$$$$", "scrypt$16384$8$1$notbase64"]) {
    assert.equal(await verifyPin("1234", bad), false);
  }
});

/* ------------------------- the migration ------------------------- */

test("a legacy sha256 hash still verifies — nobody is locked out by the fix", async () => {
  assert.equal(isLegacyHash(legacy("6024")), true);
  assert.equal(await verifyPin("6024", legacy("6024")), true);
  assert.equal(await verifyPin("6025", legacy("6024")), false);
});

test("…and is flagged for upgrade, while a current one isn't", async () => {
  assert.equal(needsRehash(legacy("6024")), true);
  assert.equal(needsRehash(await hashPin("6024")), false);
  assert.equal(needsRehash("garbage"), true, "anything unrecognised gets rewritten on next use");
});

test("a record cheaper than today's parameters is flagged, so cost can rise without a reset", () => {
  const salt = Buffer.from("0123456789abcdef").toString("base64");
  assert.equal(needsRehash(`scrypt$1024$8$1$${salt}$${salt}`), true);
});

/* ---------------- the break-glass env var (no stored digest) ---------------- */

test("the environment PIN compares in constant time and fails closed when unset", () => {
  assert.equal(matchesPlainSecret("6024", "6024"), true);
  assert.equal(matchesPlainSecret("6025", "6024"), false);
  assert.equal(matchesPlainSecret("6024", null), false);
  assert.equal(matchesPlainSecret("", "6024"), false);
});

/* ---------------- end to end, against a real sign-in ---------------- */

let ctx;
before(async () => { ctx = await startServer(); });
after(async () => { await stopServer(ctx); });

const signIn = async (actorId, pin) => {
  const r = await fetch(`${ctx.base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-homeops-bearer": "1" },
    body: JSON.stringify({ actorId, pin }),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const storedPin = () => readStoreDoc(ctx, "settings.json", {})?.ownerPinHash ?? null;

test("MIGRATION: a household on the old format signs in, and is upgraded on the way through", async () => {
  // Exactly the state every existing household is in right now.
  const before = readStoreDoc(ctx, "settings.json", {});
  writeStoreDoc(ctx, "settings.json", { ...before, ownerPinHash: legacy("246810") });
  assert.ok(isLegacyHash(storedPin()), "starts legacy");

  const ok = await signIn("m-alex", "246810");
  assert.equal(ok.status, 200, "the old PIN still works — this is the part that must not break");

  const after = storedPin();
  assert.ok(!isLegacyHash(after), "and it was rewritten");
  assert.match(after, /^scrypt\$/);
  assert.equal(await verifyPin("246810", after), true, "to the SAME pin, not a new one");
});

test("…and the upgraded hash is what the next sign-in uses", async () => {
  assert.equal((await signIn("m-alex", "246810")).status, 200);
  assert.equal((await signIn("m-alex", "000000")).status, 403, "and a wrong PIN is still wrong");
});

test("a PIN set through Settings is stored in the new format from the start", async () => {
  const admin = await makeSession(ctx, "m-alex", { pin: "246810" });
  const r = await admin.req("/api/settings", { method: "POST", body: JSON.stringify({ ownerPin: "135791" }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(storedPin(), /^scrypt\$/, "never written as a bare digest again");
  assert.equal((await signIn("m-alex", "135791")).status, 200);
});

test("the stored PIN is never returned to any client", async () => {
  const admin = await makeSession(ctx, "m-alex", { pin: "135791" });
  const body = JSON.stringify((await admin.req("/api/settings")).data);
  assert.ok(!body.includes("scrypt$"), "not the hash");
  assert.ok(!body.includes("135791"), "and obviously not the PIN");
});
