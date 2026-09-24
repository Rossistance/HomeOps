/* A SESSION IN USE DOES NOT EXPIRE UNDER THE PERSON USING IT.
 *
 * 2026-09-24: a family member's phone signed in at 13:54:32 UTC, used Ask all day, and from
 * 01:54:51 the next morning — nineteen seconds past the 12-hour mark — every request came
 * back 401 authentication_required. The app only checks its session on a cold start, so a
 * phone left running just kept failing, and Ask said "I couldn't reach the AI provider",
 * which the family read as an API-key problem. The 12 hours were measured from SIGN-IN, not
 * from last use.
 *
 * Now 12 hours is an IDLE limit: a session a request actually USES — one that passes every
 * check in gate() — is renewed (touchSession, at most once an hour, so a busy phone is not a
 * write per request), up to an absolute end of a week, after which the person picks their
 * profile — and enters a PIN, if theirs has one — again. getSession itself is a pure read.
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-session-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const store = await import("../store.mjs");
const { gate, sessionCookie } = await import("../auth.mjs");
const {
  createSession, getSession, touchSession, deleteElevatedSessions, sysDoc, putSysDoc,
  SESSION_TTL_MS, SESSION_MAX_LIFETIME_MS, BREAK_GLASS_LIFETIME_MS,
} = store;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function at(ms, fn) {
  const m = mock.method(Date, "now", () => ms);
  try { return fn(); } finally { m.mock.restore(); }
}
const T0 = Date.UTC(2026, 8, 23, 13, 54, 32);
const fresh = (extra = {}) => at(T0, () => createSession({ actorId: "m-sam", actorName: "Sam", role: "Limited Member", householdId: "local", ...extra }));
/** A phone's request: a bearer token, which gate() authenticates without origin/CSRF. */
const use = (s, t) => at(t, () => gate({ method: "GET", headers: { authorization: `Bearer ${s.token}` } }, { requireSession: true }));
const row = (s) => sysDoc("sessions.json", {})[s.token];

test("the idle limit is 12 hours and the absolute end is a week", () => {
  assert.equal(SESSION_TTL_MS, 12 * HOUR);
  assert.equal(SESSION_MAX_LIFETIME_MS, 7 * DAY);
  assert.equal(BREAK_GLASS_LIFETIME_MS, 12 * HOUR);
});

test("THE INCIDENT: a phone using its session at 11h59m is still signed in at 12h00m19s", () => {
  const s = fresh();
  assert.equal(use(s, T0 + 12 * HOUR - 31_000).ok, true, "used just before the old deadline");
  assert.equal(use(s, T0 + 12 * HOUR + 19_000).ok, true, "…and still valid nineteen seconds after it — the request that failed on 2026-09-24");
});

test("a session in steady use survives a whole day and more", () => {
  const s = fresh();
  for (let h = 1; h <= 30; h++) assert.equal(use(s, T0 + h * HOUR).ok, true, `used hourly, alive at hour ${h}`);
});

test("an idle session still ends 12 hours after its last use, and the row is deleted", () => {
  const s = fresh();
  assert.equal(use(s, T0 + 5 * HOUR).ok, true, "used at hour 5");
  assert.equal(use(s, T0 + 16 * HOUR).ok, true, "within 12h of that use (renewed at hour 5)");
  assert.equal(at(T0 + 28 * HOUR + 1000, () => getSession(s.token)), null, "12h after the last use it is gone");
  assert.equal(row(s), undefined, "and the ended row was deleted, so it cannot come back");
  at(T0 + 28 * HOUR + 2000, () => touchSession(s.token));
  assert.equal(row(s), undefined, "touching a deleted session does not resurrect it");
});

test("renewal happens at most once an hour — and only through a request that passed gate()", () => {
  const s = fresh();
  use(s, T0 + 10 * 60 * 1000);
  assert.equal(row(s).expiresAt, T0 + SESSION_TTL_MS, "ten minutes in: not renewed yet");
  use(s, T0 + 2 * HOUR);
  assert.equal(row(s).expiresAt, T0 + 2 * HOUR + SESSION_TTL_MS, "two hours in: renewed to 12h from now");
  at(T0 + 5 * HOUR, () => getSession(s.token));
  assert.equal(row(s).expiresAt, T0 + 2 * HOUR + SESSION_TTL_MS, "getSession is a pure read — it renews nothing");
});

test("a refused request renews nothing", () => {
  const s = fresh();
  // Cookie auth from a foreign origin is refused before any session use.
  const refused = at(T0 + 3 * HOUR, () => gate({ method: "GET", headers: { cookie: `homeops_session=${s.token}`, origin: "https://evil.example" } }, { requireSession: true }));
  assert.equal(refused.ok, false);
  assert.equal(row(s).expiresAt, T0 + SESSION_TTL_MS, "the idle clock did not move");
  // A role floor the session fails is refused too.
  const floor = at(T0 + 3 * HOUR, () => gate({ method: "GET", headers: { authorization: `Bearer ${s.token}` } }, { minRole: "Owner" }));
  assert.equal(floor.ok, false);
  assert.equal(row(s).expiresAt, T0 + SESSION_TTL_MS);
});

test("no session outlives a week, however busy", () => {
  const s = fresh();
  for (let t = T0 + 6 * HOUR; t < T0 + SESSION_MAX_LIFETIME_MS; t += 6 * HOUR) assert.equal(use(s, t).ok, true);
  assert.ok(row(s).expiresAt <= T0 + SESSION_MAX_LIFETIME_MS, "renewal never pushes past the end");
  assert.equal(use(s, T0 + SESSION_MAX_LIFETIME_MS + 1000).ok, false, "gone once the week has passed");
});

test("a break-glass session keeps the old 12 hours as its absolute end", () => {
  const s = fresh({ role: "Owner", lifetimeMs: BREAK_GLASS_LIFETIME_MS });
  assert.equal(use(s, T0 + 6 * HOUR).ok, true);
  assert.equal(use(s, T0 + 11 * HOUR).ok, true);
  assert.equal(use(s, T0 + 12 * HOUR + 1000).ok, false, "used all along, and still ended at 12 hours");
});

test("a row written before 1.4.1 (no endsAt, no createdAt) cannot live forever", () => {
  const token = "legacy-" + "a".repeat(40);
  const all = sysDoc("sessions.json", {});
  all[token] = { token, csrf: "c", actorId: "m-sam", actorName: "Sam", role: "Limited Member", householdId: "local", expiresAt: T0 + SESSION_TTL_MS };
  putSysDoc("sessions.json", all);
  const s = { token };
  for (let t = T0 + 6 * HOUR; t < T0 + SESSION_MAX_LIFETIME_MS; t += 6 * HOUR) use(s, t);
  assert.equal(use(s, T0 + SESSION_MAX_LIFETIME_MS + HOUR).ok, false, "dated from its original expiry, it ends a week after it was opened");
});

test("a new household PIN ends every OTHER Owner / Adult Admin session in that household", () => {
  const mine = at(T0, () => createSession({ actorId: "m-own", actorName: "Own", role: "Owner", householdId: "hh_pin" }));
  const admin = at(T0, () => createSession({ actorId: "m-adm", actorName: "Adm", role: "Adult Admin", householdId: "hh_pin" }));
  const kid = at(T0, () => createSession({ actorId: "m-kid", actorName: "Kid", role: "Limited Member", householdId: "hh_pin" }));
  const elsewhere = at(T0, () => createSession({ actorId: "m-x", actorName: "X", role: "Owner", householdId: "hh_other" }));
  assert.equal(deleteElevatedSessions("hh_pin", mine.token), 1);
  assert.ok(row(mine), "the person who changed it stays signed in");
  assert.equal(row(admin), undefined, "another elevated session in the household ends");
  assert.ok(row(kid), "a low-trust session is untouched");
  assert.ok(row(elsewhere), "another household is untouched");
});

test("the web cookie lives as long as a session can, so the server's idle limit governs", () => {
  const maxAge = Number(/Max-Age=(\d+)/.exec(sessionCookie("tok"))?.[1]);
  assert.equal(maxAge, SESSION_MAX_LIFETIME_MS / 1000);
});
