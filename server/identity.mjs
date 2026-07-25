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
/* D1 [01:32] — "Forgot password: it should send an email with a recovery code."
 *
 * A CODE, not only a link. On a phone, a link means leaving the app for a browser and coming
 * back; a six-digit code is typed where you already are. Both work: the long token is still
 * minted for the web's link flow, and the short code is what mobile asks for.
 *
 * Attempt-limited, because a 6-digit code is guessable in a million tries and a determined
 * script does that in minutes. Five attempts, then the code is dead and a new one is needed —
 * the same shape as the contact-verification challenge already in the app. */
const RESET_MAX_ATTEMPTS = 5;
const RESET_CODE_TTL_MS = 15 * 60 * 1000;

export function beginPasswordReset(email) {
  const key = normEmail(email);
  const all = sysDoc(IDENTITIES, {});
  if (!all[key]) return null; // caller answers 200 regardless — no enumeration
  const code = String(crypto.randomInt(100000, 1000000));
  all[key] = {
    ...all[key],
    resetToken: token(), resetExpiresAt: Date.now() + RESET_TTL_MS,
    resetCode: code, resetCodeExpiresAt: Date.now() + RESET_CODE_TTL_MS, resetCodeAttempts: 0,
  };
  putSysDoc(IDENTITIES, all);
  appendAudit({ type: "identity.reset_requested", email: key });
  return all[key];
}

/** Look up an identity by the code someone typed, honouring expiry and the attempt cap.
 *  Returns { email, identity } or a reason — never a partial success. */
export function findByResetCode(email, code) {
  const key = normEmail(email);
  const all = sysDoc(IDENTITIES, {});
  const idn = all[key];
  // Same answer for "no such account" and "wrong code": a different one would tell an
  // attacker which emails are registered.
  if (!idn || !idn.resetCode) return { error: "invalid_or_expired_code" };
  if ((idn.resetCodeExpiresAt ?? 0) < Date.now()) return { error: "invalid_or_expired_code" };
  if ((idn.resetCodeAttempts ?? 0) >= RESET_MAX_ATTEMPTS) return { error: "too_many_attempts" };
  if (String(code).trim() !== idn.resetCode) {
    all[key] = { ...idn, resetCodeAttempts: (idn.resetCodeAttempts ?? 0) + 1 };
    putSysDoc(IDENTITIES, all);
    appendAudit({ type: "identity.reset_code_wrong", email: key, attempts: all[key].resetCodeAttempts });
    return { error: "invalid_or_expired_code", attemptsLeft: Math.max(0, RESET_MAX_ATTEMPTS - all[key].resetCodeAttempts) };
  }
  return { email: key, identity: idn };
}

export function completePasswordReset(t, newPassword) {
  if (!t) return null;
  const all = sysDoc(IDENTITIES, {});
  const key = Object.keys(all).find((k) => all[k].resetToken === t);
  if (!key) return null;
  if ((all[key].resetExpiresAt ?? 0) < Date.now()) return null;
  const salt = crypto.randomBytes(16).toString("hex");
  // Both the link token and the code are cleared: a reset that succeeded must not leave a
  // second working key to the same door.
  all[key] = {
    ...all[key], salt, passHash: scryptHash(newPassword, salt),
    resetToken: null, resetExpiresAt: null,
    resetCode: null, resetCodeExpiresAt: null, resetCodeAttempts: 0,
  };
  putSysDoc(IDENTITIES, all);
  appendAudit({ type: "identity.reset_completed", email: key });
  return all[key];
}

/* D2 [01:46] — "forgot email, or forgot username."
 *
 * The only thing that can be done here honestly: given a household's JOIN CODE (which the
 * family has, on paper or from another member) plus a display name, tell them which email
 * that member signed up with — by emailing it TO that address. Nothing is revealed to
 * whoever asked; the answer goes to the account's own inbox. A caller who already controls
 * that inbox learns their own address, which is the whole point, and a caller who doesn't
 * learns nothing at all.
 */
export function findIdentityForRecovery({ householdId, displayName }) {
  const all = sysDoc(IDENTITIES, {});
  const wanted = String(displayName ?? "").trim().toLowerCase();
  if (!householdId || !wanted) return null;
  for (const [email, idn] of Object.entries(all)) {
    if (idn.householdId !== householdId) continue;
    if (String(idn.displayName ?? "").trim().toLowerCase() !== wanted) continue;
    return { ...idn, email };
  }
  return null;
}

/* ---- Household invites (join an EXISTING household by code) ----
 * An Adult Admin mints a short-lived invite naming the person and their role;
 * whoever redeems it at signup lands in THAT household instead of creating a
 * new one. Owner can never be granted by invite. */
const INVITES = "invites.json"; // { [token]: invite } in _system
const INVITE_TTL_MS = 7 * 24 * 3600000;
export const INVITABLE_ROLES = ["Adult Admin", "Adult Member", "Limited Member", "Child View", "Guest/Helper"];

export function createInvite({ householdId, householdName, displayName, role, invitedBy }) {
  if (!INVITABLE_ROLES.includes(role)) return { error: "invalid_role" };
  const name = String(displayName ?? "").trim();
  if (!name) return { error: "display_name_required" };
  const all = sysDoc(INVITES, {});
  const t = crypto.randomBytes(6).toString("hex");
  all[t] = { token: t, householdId, householdName: householdName ?? null, displayName: name, role, invitedBy, createdAt: Date.now(), expiresAt: Date.now() + INVITE_TTL_MS, usedAt: null };
  putSysDoc(INVITES, all);
  appendAudit({ type: "invite.created", role, invitedBy });
  return { invite: all[t] };
}
export function getInvite(t) {
  const inv = sysDoc(INVITES, {})[String(t ?? "").trim().toLowerCase()] ?? null;
  if (!inv || inv.usedAt || inv.expiresAt < Date.now()) return null;
  return inv;
}
export function listInvites(householdId) {
  return Object.values(sysDoc(INVITES, {})).filter((i) => i.householdId === householdId && !i.usedAt && i.expiresAt > Date.now());
}
export function revokeInvite(t, householdId) {
  const all = sysDoc(INVITES, {});
  const key = String(t ?? "").trim().toLowerCase();
  if (!all[key] || all[key].householdId !== householdId) return false;
  delete all[key];
  putSysDoc(INVITES, all);
  return true;
}
export function consumeInvite(t) {
  const all = sysDoc(INVITES, {});
  const key = String(t ?? "").trim().toLowerCase();
  const inv = all[key];
  if (!inv || inv.usedAt || inv.expiresAt < Date.now()) return null;
  all[key] = { ...inv, usedAt: Date.now() };
  putSysDoc(INVITES, all);
  return inv;
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
