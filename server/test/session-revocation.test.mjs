/* WHAT A SESSION WAS OPENED WITH MUST NOT OUTLIVE A CHANGE TO IT.
 *
 * Since 1.4.1 a session that is used renews (session-renewal.test.mjs), so a phone that keeps
 * polling keeps its session for up to a week. A session carries the ROLE it was opened with
 * and gate() trusts it; before, a demoted member's old session kept the old role for at most
 * 12 hours after sign-in, and now it would keep it for a week. And an elevated session opened
 * with a household PIN — possibly the very PIN being replaced because it leaked — would
 * outlive the replacement. Both now end at the change. (Found by review of the renewal fix,
 * 2026-09-24.)
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx;
before(async () => { ctx = await startServer(); });
after(async () => { await stopServer(ctx); });

const whoAmI = async (client) => (await client.req("/api/session")).data?.session ?? null;

test("a ROLE CHANGE ends the member's sessions; their next sign-in carries the new role", async () => {
  const owner = await makeSession(ctx, "m-alex");
  const morgan = await makeSession(ctx, "m-morgan");
  assert.equal(morgan.role, "Adult Admin");
  assert.equal((await whoAmI(morgan))?.role, "Adult Admin", "signed in as an admin");

  const demote = await owner.req("/api/members/m-morgan", { method: "PATCH", body: JSON.stringify({ role: "Limited Member" }) });
  assert.equal(demote.status, 200, JSON.stringify(demote.data));

  assert.equal(await whoAmI(morgan), null, "the session opened as an admin is gone");
  const adminOnly = await morgan.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Should not exist", role: "Limited Member" }) });
  assert.equal(adminOnly.status, 401, "an admin-only write on the old session is refused as signed out — not run as an admin");

  const again = await makeSession(ctx, "m-morgan");
  assert.equal(again.role, "Limited Member", "a new sign-in reads the new role");
  assert.ok(await whoAmI(owner), "the Owner who made the change is still signed in");
});

test("an edit that does not change the role ends nothing", async () => {
  const owner = await makeSession(ctx, "m-alex");
  const noah = await makeSession(ctx, "m-noah");
  const r = await owner.req("/api/members/m-noah", { method: "PATCH", body: JSON.stringify({ aiEnabled: true }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(await whoAmI(noah), "a toggle is not a role change");
});

test("REPLACING the household PIN ends every other elevated session; a first PIN ends nothing", async () => {
  const owner = await makeSession(ctx, "m-alex");
  const first = await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ ownerPin: "4821" }) });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.ok(await whoAmI(owner), "setting a first PIN signs nobody out");

  const admin = await makeSession(ctx, "m-alex", { pin: "4821" });
  const kid = await makeSession(ctx, "m-noah");
  assert.ok(await whoAmI(admin), "a second elevated session, opened with the first PIN");
  assert.ok(await whoAmI(kid));

  const replace = await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ ownerPin: "9357" }) });
  assert.equal(replace.status, 200, JSON.stringify(replace.data));

  assert.ok(await whoAmI(owner), "the person who replaced the PIN stays signed in");
  assert.equal(await whoAmI(admin), null, "the session opened with the old PIN is gone");
  assert.ok(await whoAmI(kid), "a low-trust session is untouched");
  const back = await makeSession(ctx, "m-alex", { pin: "9357" });
  assert.ok(await whoAmI(back), "the new PIN signs in");
});
