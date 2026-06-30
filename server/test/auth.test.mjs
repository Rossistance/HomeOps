// P0.2 — server-owned authorization invariants.
// Authority is resolved from the household member registry, never from the client.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx;
before(async () => { ctx = await startServer(); });
after(async () => { await stopServer(ctx); });

test("a child CANNOT self-elevate to Owner by posting role:Owner", async () => {
  // The probe scenario from the audit: m-noah (Child View) requests Owner.
  const noah = await makeSession(ctx, "m-noah", { role: "Owner" });
  assert.equal(noah.status, 200, "session is created (for the real role)");
  assert.equal(noah.role, "Child View", "role must resolve to the registry role, NOT the requested Owner");
});

test("a child CANNOT become Adult Member either (PIN-free elevated role)", async () => {
  const lily = await makeSession(ctx, "m-lily", { role: "Adult Member" });
  assert.equal(lily.role, "Child View");
});

test("the Owner resolves to Owner", async () => {
  const alex = await makeSession(ctx, "m-alex");
  assert.equal(alex.role, "Owner");
});

test("a guest/helper resolves to Guest/Helper", async () => {
  const elaine = await makeSession(ctx, "m-elaine", { role: "Owner" });
  assert.equal(elaine.role, "Guest/Helper");
});

test("an unknown actor is rejected (no implicit account creation)", async () => {
  const ghost = await makeSession(ctx, "m-attacker", { role: "Owner" });
  assert.equal(ghost.status, 403);
  assert.equal(ghost.raw?.error, "unknown_actor");
});

test("a session with no actorId is a 400", async () => {
  const r = await ctx.fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "Owner" }),
  });
  assert.equal(r.status, 400);
});
