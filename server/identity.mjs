// FamiliOS identity registry (C1.4) — email + password accounts that map a
// person to (householdId, actorId). Lives in the _system tenant: at login time
// the household isn't known yet. Passwords are scrypt-hashed with a per-account
// salt and compared timing-safely; verification and reset tokens are one-shot
// and expiring. The resident family household keeps its profile-picker + PIN
// flow untouched — identities are how STRANGER households sign in.
import crypto from "node:crypto";
import { sysDoc, putSysDoc, appendAudit } from "./store.mjs";

const IDENTITIES = "identities.json"; // { [email]: identity }

const normEmail = (e) => String(e ?? "").trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(e));
export const validPassword = (p) => typeof p === "string" && p.length >= 8 && p.length <= 200;

function scryptHash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
}
const token = () => crypto.randomBytes(24).toString("hex");

export function getIdentity(email) {
  return sysDoc(IDENTITIES, {})[normEmail(email)] ?? null;
}
export function listIdentitiesForHousehold(householdId) {
  return Object.values(sysDoc(IDENTITIES, {})).filter((i) => i.householdId === householdId);
}

export function createIdentity({ email, password, householdId, actorId, displayName }) {
  const key = normEmail(email);
  const all = sysDoc(IDENTITIES, {});
  if (all[key]) return { error: "email_taken" };
  const salt = crypto.randomBytes(16).toString("hex");
  all[key] = {
    id: "idn_" + crypto.randomBytes(8).toString("hex"),
    email: key, salt, passHash: scryptHash(password, salt),
    householdId, actorId, displayName: displayName ?? key,
    emailVerified: false, verifyToken: token(),
    resetToken: null, resetExpiresAt: null,
    createdAt: Date.now(),
  };
  putSysDoc(IDENTITIES, all);
  appendAudit({ type: "identity.created", email: key, householdId, actorId });
  return { identity: all[key] };
}

/** Timing-safe credential check. Unknown email and wrong password are the same
 * failure — no account enumeration. */
export function verifyCredentials(email, password) {
  const idn = getIdentity(email);
  // Always burn a hash computation so unknown-email and wrong-password take the same time.
  const salt = idn?.salt ?? "0".repeat(32);
  const computed = Buffer.from(scryptHash(password ?? "", salt), "hex");
  const stored = Buffer.from(idn?.passHash ?? "0".repeat(128), "hex");
  const ok = computed.length === stored.length && crypto.timingSafeEqual(computed, stored);
  return ok && idn ? idn : null;
}

export function consumeVerifyToken(t) {
  if (!t) return null;
  const all = sysDoc(IDENTITIES, {});
  const key = Object.keys(all).find((k) => all[k].verifyToken === t);
  if (!key) return null;
  all[key] = { ...all[key], emailVerified: true, verifyToken: null };
  putSysDoc(IDENTITIES, all);
  appendAudit({ type: "identity.email_verified", email: key });
  return all[key];
}

const RESET_TTL_MS = 30 * 60 * 1000;
export function beginPasswordReset(email) {
  const key = normEmail(email);
  const all = sysDoc(IDENTITIES, {});
  if (!all[key]) return null; // caller answers 200 regardless — no enumeration
  all[key] = { ...all[key], resetToken: token(), resetExpiresAt: Date.now() + RESET_TTL_MS };
  putSysDoc(IDENTITIES, all);
  appendAudit({ type: "identity.reset_requested", email: key });
  return all[key];
}
export function completePasswordReset(t, newPassword) {
  if (!t) return null;
  const all = sysDoc(IDENTITIES, {});
  const key = Object.keys(all).find((k) => all[k].resetToken === t);
  if (!key) return null;
  if ((all[key].resetExpiresAt ?? 0) < Date.now()) return null;
  const salt = crypto.randomBytes(16).toString("hex");
  all[key] = { ...all[key], salt, passHash: scryptHash(newPassword, salt), resetToken: null, resetExpiresAt: null };
  putSysDoc(IDENTITIES, all);
  appendAudit({ type: "identity.reset_completed", email: key });
  return all[key];
}

export function deleteIdentity(email) {
  const key = normEmail(email);
  const all = sysDoc(IDENTITIES, {});
  const had = !!all[key];
  if (had) { delete all[key]; putSysDoc(IDENTITIES, all); appendAudit({ type: "identity.deleted", email: key }); }
  return had;
}
export function deleteIdentitiesForHousehold(householdId) {
  const all = sysDoc(IDENTITIES, {});
  let removed = 0;
  for (const k of Object.keys(all)) {
    if (all[k].householdId === householdId) { delete all[k]; removed++; }
  }
  if (removed) putSysDoc(IDENTITIES, all);
  return removed;
}
