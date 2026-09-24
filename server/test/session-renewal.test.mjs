/* A SESSION IN USE DOES NOT EXPIRE UNDER THE PERSON USING IT.
 *
 * 2026-09-24: a family member's phone signed in at 13:54:32 UTC, used Ask all day, and from
 * 01:54:51 the next morning — nineteen seconds past the 12-hour mark — every request came
 * back 401 authentication_required. The app only checks its session on a cold start, so a
 * phone left running just kept failing, and Ask said "I couldn't reach the AI provider",
 * which the family read as an API-key problem. The 12 hours were measured from SIGN-IN, not
 * from last use.
 *
 * Now 12 hours is an IDLE limit: a session that is used is renewed (at most once an hour,
 * so a busy phone is not a write per request), up to an absolute lifetime after which the
 * person picks their profile — and enters a PIN, if theirs has one — again.
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
const { sessionCookie } = await import("../auth.mjs");
const { createSession, getSession, SESSION_TTL_MS, SESSION_MAX_LIFETIME_MS } = store;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function at(ms, fn) {
  const m = mock.method(Date, "now", () => ms);
  try { return fn(); } finally { m.mock.restore(); }
}
const T0 = Date.UTC(2026, 8, 23, 13, 54, 32);
const fresh = () => at(T0, () => createSession({ actorId: "m-sam", actorName: "Sam", role: "Limited Member", householdId: "local" }));

test("the idle limit is 12 hours and the absolute lifetime is longer than a day", () => {
  assert.equal(SESSION_TTL_MS, 12 * HOUR);
  assert.ok(SESSION_MAX_LIFETIME_MS > DAY, "a lifetime shorter than a day would bring the bug back for a family using the app all day");
});

test("THE INCIDENT: a session used at 11h59m is still good at 12h00m19s", () => {
  const s = fresh();
  assert.ok(at(T0 + 12 * HOUR - 31_000, () => getSession(s.token)), "used just before the old deadline");
  assert.ok(at(T0 + 12 * HOUR + 19_000, () => getSession(s.token)), "…and still valid nineteen seconds after it — the request that failed on 2026-09-24");
});

test("a session in steady use survives a whole day", () => {
  const s = fresh();
  for (let h = 1; h <= 30; h++) assert.ok(at(T0 + h * HOUR, () => getSession(s.token)), `used hourly, alive at hour ${h}`);
});

test("an idle session still expires 12 hours after its last use", () => {
  const s = fresh();
  assert.ok(at(T0 + 5 * HOUR, () => getSession(s.token)), "used at hour 5");
  assert.ok(at(T0 + 16 * HOUR, () => getSession(s.token)), "within 12h of that use (renewed at hour 5)");
  assert.equal(at(T0 + 16 * HOUR + 12 * HOUR + 1000, () => getSession(s.token)), null, "12h after the last use it is gone");
  assert.equal(at(T0 + 16 * HOUR, () => getSession(s.token)), null, "and it stays gone — the expired row was deleted");
});

test("renewal writes at most once an hour, not on every request", () => {
  const s = fresh();
  const before = at(T0 + 10 * 60 * 1000, () => getSession(s.token)).expiresAt;
  assert.equal(before, T0 + SESSION_TTL_MS, "ten minutes in: not renewed yet");
  const renewed = at(T0 + 2 * HOUR, () => getSession(s.token)).expiresAt;
  assert.equal(renewed, T0 + 2 * HOUR + SESSION_TTL_MS, "two hours in: renewed to 12h from now");
});

test("no session outlives its absolute lifetime, however busy", () => {
  const s = fresh();
  let t = T0;
  while (t < T0 + SESSION_MAX_LIFETIME_MS - HOUR) { t += 6 * HOUR; if (t < T0 + SESSION_MAX_LIFETIME_MS) at(t, () => getSession(s.token)); }
  const last = at(T0 + SESSION_MAX_LIFETIME_MS - 1000, () => getSession(s.token));
  assert.ok(last, "alive one second before the lifetime ends");
  assert.ok(last.expiresAt <= T0 + SESSION_MAX_LIFETIME_MS, "renewal never pushes past the lifetime");
  assert.equal(at(T0 + SESSION_MAX_LIFETIME_MS + 1000, () => getSession(s.token)), null, "gone once the lifetime has passed");
});

test("the web cookie lives as long as the session can, so the server's idle limit governs", () => {
  const maxAge = Number(/Max-Age=(\d+)/.exec(sessionCookie("tok"))?.[1]);
  assert.equal(maxAge, SESSION_MAX_LIFETIME_MS / 1000);
});
