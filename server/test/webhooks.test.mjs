// P2.2 — webhook signing fails CLOSED in production when no signing secret is set;
// in development an unsigned event is accepted but explicitly marked unverified.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer } from "./harness.mjs";

test("production rejects an unsigned webhook (no secret configured)", async () => {
  const ctx = await startServer({ prod: true });
  try {
    const r = await ctx.fetch("/api/webhooks/wh_none", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hello: "world" }) });
    assert.equal(r.status, 401);
    const body = await r.json();
    assert.equal(body.error, "signing_secret_required");
  } finally { await stopServer(ctx); }
});

test("development accepts an unsigned webhook but marks it unverified", async () => {
  const ctx = await startServer();
  try {
    const r = await ctx.fetch("/api/webhooks/wh_none", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hello: "world" }) });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.verified, false);
  } finally { await stopServer(ctx); }
});
