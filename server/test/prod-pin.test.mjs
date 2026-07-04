// PRODUCTION PIN GATE — on a public deployment the seed actor ids are public
// knowledge, so elevated sign-in must FAIL CLOSED until a PIN exists.
// HOMEOPS_BOOTSTRAP_PIN seeds the gate from the environment before first login.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer } from "./harness.mjs";

test("production with no PIN configured refuses Owner sign-in (fail closed)", async () => {
  const ctx = await startServer({ prod: true });
  try {
    const owner = await ctx.fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actorId: "m-alex" }) });
    assert.equal(owner.status, 403);
    assert.equal((await owner.json()).error, "pin_not_configured");
    // Non-elevated roles still sign in — the household isn't bricked, only authority is.
    const child = await ctx.fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actorId: "m-noah" }) });
    assert.equal(child.status, 200);
  } finally { await stopServer(ctx); }
});

test("HOMEOPS_BOOTSTRAP_PIN unlocks elevated sign-in in production (wrong PIN still refused)", async () => {
  const ctx = await startServer({ prod: true, env: { HOMEOPS_BOOTSTRAP_PIN: "4217" } });
  try {
    const wrong = await ctx.fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actorId: "m-alex", pin: "0000" }) });
    assert.equal(wrong.status, 403);
    assert.equal((await wrong.json()).error, "pin_required");
    const right = await ctx.fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actorId: "m-alex", pin: "4217" }) });
    assert.equal(right.status, 200);
    assert.equal((await right.json()).session.role, "Owner");
  } finally { await stopServer(ctx); }
});

test("development stays PIN-optional (unchanged local workflow)", async () => {
  const ctx = await startServer();
  try {
    const owner = await ctx.fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actorId: "m-alex" }) });
    assert.equal(owner.status, 200);
  } finally { await stopServer(ctx); }
});
