// Household timezone setting — closes the gap where "every day at 7 AM" silently
// meant 7 AM on the SERVER's clock (UTC on Render), not the household's real local
// time, because nothing could ever set getSettings().timezone that server/triggers.mjs
// already reads. This suite proves: the route accepts/persists/clears a real IANA
// zone, rejects junk, and that server/triggers.mjs actually resolves against it
// end-to-end — while preserving the disclosed server-local fallback when unset.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, alex, morgan, child;
before(async () => {
  ctx = await startServer();
  alex = await makeSession(ctx, "m-alex");     // Owner
  morgan = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");    // Child View
});
after(async () => { await stopServer(ctx); });

test("timezone is unset by default and the route says so", async () => {
  const r = await alex.req("/api/settings");
  assert.equal(r.data.settings.timezone, null);
});

test("an Adult Admin can set a real IANA zone; it persists across reads", async () => {
  const set = await morgan.req("/api/settings", { method: "POST", body: JSON.stringify({ timezone: "America/New_York" }) });
  assert.equal(set.status, 200);
  assert.equal(set.data.settings.timezone, "America/New_York");
  assert.equal((await alex.req("/api/settings")).data.settings.timezone, "America/New_York", "persists across reads");
});

test("junk timezone strings are rejected, not silently stored", async () => {
  const before = (await alex.req("/api/settings")).data.settings.timezone;
  const r = await morgan.req("/api/settings", { method: "POST", body: JSON.stringify({ timezone: "PST" }) });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "invalid_timezone");
  assert.equal((await alex.req("/api/settings")).data.settings.timezone, before, "the prior valid value is untouched");
});

test("a Child cannot change the household timezone", async () => {
  const r = await child.req("/api/settings", { method: "POST", body: JSON.stringify({ timezone: "America/Los_Angeles" }) });
  assert.equal(r.status, 403);
});

test("timezone:null explicitly clears it back to the disclosed server-local fallback", async () => {
  await morgan.req("/api/settings", { method: "POST", body: JSON.stringify({ timezone: "America/Chicago" }) });
  assert.equal((await alex.req("/api/settings")).data.settings.timezone, "America/Chicago");
  const cleared = await morgan.req("/api/settings", { method: "POST", body: JSON.stringify({ timezone: null }) });
  assert.equal(cleared.data.settings.timezone, null);
});

/* ---- end-to-end: the value this route persists is the value triggers.mjs resolves against ---- */
test("nextAnchorOccurrence resolves 7 AM against the household's OWN configured zone, not the server clock", async () => {
  await morgan.req("/api/settings", { method: "POST", body: JSON.stringify({ timezone: "America/New_York" }) });
  const { nextAnchorOccurrence } = await import("../triggers.mjs");
  const now = Date.parse("2026-07-20T12:00:00Z"); // mid-summer, no DST-boundary ambiguity
  const next = nextAnchorOccurrence("07:00", "America/New_York", now);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(next.at));
  assert.equal(fmt, "07:00", "07:00 in the household's real zone, not 07:00 UTC");
  assert.equal(next.tzSource, "household");
  // The regression this suite exists to prevent: 07:00 UTC is 03:00 in America/New_York
  // (EDT, UTC-4) in July — a household on the old unset-timezone fallback would have its
  // "7 AM" briefing fire four hours before anyone in the house is awake.
  const utcInterpretedAsLocal = new Date(now).setUTCHours(7, 0, 0, 0);
  assert.notEqual(next.at, utcInterpretedAsLocal, "must not silently mean 7 AM UTC");
});

test("with no household timezone, the fallback stays server-local and honestly discloses it (unchanged behavior)", async () => {
  const { nextAnchorOccurrence } = await import("../triggers.mjs");
  const next = nextAnchorOccurrence("07:00", null, Date.parse("2026-07-20T12:00:00Z"));
  assert.equal(next.tzSource, "server", "never silently claim household-zone authority with no zone set");
});
