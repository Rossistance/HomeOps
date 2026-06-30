// Smoke test — proves the harness boots the real server in isolation and can drive it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx;
before(async () => { ctx = await startServer(); });
after(async () => { await stopServer(ctx); });

test("health endpoint responds", async () => {
  const r = await ctx.fetch("/api/health");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.authRequired, true);
});

test("a session can be created for a seeded member", async () => {
  const owner = await makeSession(ctx, "m-alex");
  assert.equal(owner.status, 200);
  assert.ok(owner.csrf, "session should issue a CSRF token");
});
