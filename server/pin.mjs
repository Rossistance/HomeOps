// The household sign-in PIN, stored properly.
//
// WHAT WAS WRONG. The PIN was kept as a bare, unsalted sha256. Two consequences, and the
// second is the bad one:
//
//   No salt means identical PINs across households produce identical digests, so a leak of
//   the store tells you which households share a PIN without breaking any of them.
//
//   sha256 is fast on purpose. The entire 4-digit space is ten thousand values; a modern
//   machine hashes that in well under a millisecond, and a precomputed table of every 4-to-8
//   digit PIN is small enough to keep on a laptop. "Hashed" was doing no work at all here.
//
// WHAT REPLACES IT. scrypt — salted per PIN, memory-hard, and deliberately slow. Node ships
// it, so this adds no dependency to a thing that guards every elevated sign-in.
//
// WHAT THIS DOES NOT FIX, said plainly: a 4-digit PIN is a 4-digit PIN. An attacker holding
// the store can still walk all ten thousand of them; scrypt turns that from instant into
// minutes, which is real but is not safety. What actually protects a short PIN is that
// guessing has to go through the front door — /api/session is rate-limited per IP and every
// failure is audited — and that the app now lets you choose up to twelve digits. The KDF
// closes the offline shortcut; it doesn't make 6024 a good secret.
//
// MIGRATION. Stored values are self-describing, so both formats coexist and a third could be
// added later without another migration:
//
//   legacy   64 hex characters, no separator
//   current  scrypt$N$r$p$<salt base64>$<key base64>
//
// Nobody is asked to reset anything. A legacy hash that verifies is silently re-hashed and
// written back on the way through — so households migrate the first time they sign in, and a
// household that never signs in again keeps working exactly as it did.
import crypto from "node:crypto";

// ~64 MB and ~50–100 ms per verification. Chosen to be felt by a machine walking the keyspace
// and not by a person typing four digits. N must be a power of two; maxmem must clear
// 128 * N * r or Node refuses.
const N = 16384, R = 8, P = 1, KEYLEN = 32;
const MAXMEM = 256 * N * R;

const scrypt = (pin, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(String(pin), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
});

/** A stored value from before this change: bare sha256 hex, no separators. */
export function isLegacyHash(stored) {
  return typeof stored === "string" && /^[0-9a-f]{64}$/.test(stored);
}

/** Hash a PIN for storage. Always the current format. */
export async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pin, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/**
 * Does this PIN match what's stored?
 *
 * Constant-time on the compare in both formats. The legacy branch is kept only so existing
 * households can sign in once more and be upgraded — see needsRehash.
 */
export async function verifyPin(given, stored) {
  if (!stored || given == null || given === "") return false;
  const g = String(given);
  if (isLegacyHash(stored)) {
    const digest = crypto.createHash("sha256").update(g).digest();
    return timingSafeEq(digest, Buffer.from(stored, "hex"));
  }
  const parts = String(stored).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  // Read the cost from the RECORD, not from the constants above — otherwise raising the cost
  // later would silently invalidate every PIN stored before the change.
  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(g, salt, expected.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * Number(n) * Number(r) },
      (err, out) => (err ? reject(err) : resolve(out)));
  }).catch(() => null);
  return !!key && timingSafeEq(key, expected);
}

/** True when a verified PIN is stored in an old format and should be written back upgraded. */
export function needsRehash(stored) {
  if (isLegacyHash(stored)) return true;
  const parts = String(stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  // A record cheaper than today's parameters gets upgraded on the next successful sign-in,
  // which is how the cost can be raised over time without a migration or a reset.
  return Number(parts[1]) < N || Number(parts[2]) < R;
}

/**
 * Compare a PIN to a plaintext value from the environment (HOMEOPS_BOOTSTRAP_PIN).
 *
 * There is no stored digest to migrate here — the env var IS the secret — so this is only
 * about not leaking its length or contents through timing.
 */
export function matchesPlainSecret(given, secret) {
  if (!secret || given == null || given === "") return false;
  const a = crypto.createHash("sha256").update(String(given)).digest();
  const b = crypto.createHash("sha256").update(String(secret)).digest();
  return timingSafeEq(a, b);
}

function timingSafeEq(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const PIN_SCRYPT_N = N;
