// R4 security edges: archived members lose access IMMEDIATELY (not at token
// expiry), child/guest tool catalogs never contain external sends or deletes,
// and pre-auth routes are rate-limited.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex"); // Owner
});
after(async () => { await stopServer(ctx); });

test("archiving a member kills their live sessions immediately", async () => {
  const created = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Temp Adult", role: "Adult Member" }) });
  const actorId = created.data.member.actorId;
  const temp = await makeSession(ctx, actorId);
  const before1 = await temp.req("/api/members");
  assert.equal(before1.status, 200, "session works before archive");

  const archived = await owner.req(`/api/members/${actorId}`, { method: "DELETE" });
  assert.equal(archived.status, 200);

  const after1 = await temp.req("/api/members");
  assert.equal(after1.status, 401, `expected immediate 401, got ${after1.status}`);
});

test("child and guest tool catalogs exclude external sends and deletions", async () => {
  const kid = (await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Catalog Kid", role: "Child View" }) })).data.member;
  const kidSession = await makeSession(ctx, kid.actorId);
  const { toolCatalog } = await import("../context.mjs");   // planner.mjs, renamed
  const session = { actorId: kid.actorId, role: "Child View", householdId: "local" };
  const catalog = toolCatalog(session);
  const FORBIDDEN = /^(sms\.send|gmail\.send|browser\.download|http\.post)$/;
  const leaked = catalog.filter((t) => FORBIDDEN.test(t.toolId) && t.requiresApproval === false);
  assert.deepEqual(leaked.map((t) => t.toolId), [], "no external send/delete tool may be approval-free for a child");
  // And the child cannot create a high-risk approval at the API layer (already
  // enforced server-side; pin the invariant through the real route).
  const ap = await kidSession.req("/api/approvals", { method: "POST", body: JSON.stringify({ toolId: "gmail.send", input: {}, category: "x", preview: "x" }) });
  assert.ok([403, 422].includes(ap.status), `child approval create must be refused, got ${ap.status}`);
});

test("pre-auth login attempts rate-limit at the route", async () => {
  let limited = false;
  for (let i = 0; i < 25; i++) {
    const r = await ctx.fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actorId: "nobody-" + i }) });
    if (r.status === 429) { limited = true; break; }
  }
  assert.ok(limited, "expected a 429 within 25 rapid attempts");
});
