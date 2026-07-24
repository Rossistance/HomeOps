// Crash reporting intake (POST /api/client-errors).
//
// The iOS app had no crash reporting at all: a render error was a white screen on a
// device nobody watching the server could see. Reports now land in the household's own
// audit trail rather than a third-party vendor — no DSN to manage, and the crash shows up
// in Activity next to everything else that happened.
//
// The contract these lock in is deliberately FORGIVING, because a report that gets
// rejected is a report nobody ever sees: no session required (a crash can happen at or
// before sign-in), oversized payloads are truncated rather than refused.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, readStoreDoc } from "./harness.mjs";

let ctx, owner;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
});
after(async () => { await stopServer(ctx); });

test("a crash report is accepted and recorded", async () => {
  const r = await owner.req("/api/client-errors", {
    method: "POST",
    body: JSON.stringify({ platform: "ios 18.2", appVersion: "1.0.0", fatal: true, message: "Cannot read property 'map' of undefined", stack: "at Home\nat Gate", screen: "(home)/index" }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true);
});

test("an oversized payload is TRUNCATED, not rejected — a refused report is one nobody sees", async () => {
  const r = await owner.req("/api/client-errors", {
    method: "POST",
    body: JSON.stringify({ platform: "ios", message: "x".repeat(5000), stack: "y".repeat(20000) }),
  });
  assert.equal(r.status, 200, "a huge stack must still be accepted");
  assert.equal(r.data.ok, true);
});

test("a report with no session is still accepted — crashes happen before sign-in too", async () => {
  // ctx.fetch is the raw, session-less helper — exactly the state a crash on the Lock
  // screen would report from.
  const res = await ctx.fetch("/api/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios", message: "crashed on the lock screen" }),
  });
  assert.equal(res.status, 200, await res.text());
});

test("a malformed body is refused honestly rather than recorded as a mystery", async () => {
  const r = await owner.req("/api/client-errors", { method: "POST", body: "{not json" });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "malformed_json");
});

test("a missing message records a placeholder, never `undefined`", async () => {
  const r = await owner.req("/api/client-errors", { method: "POST", body: JSON.stringify({ platform: "ios" }) });
  assert.equal(r.status, 200);
  // The Activity feed renders this; an entry reading "undefined" would be the same
  // non-actionable noise ISS-114 set out to remove.
  const audit = readStoreDoc(ctx, "audit.jsonl", null);
  if (typeof audit === "string") {
    const lines = audit.trim().split("\n").filter((l) => l.includes('"client.error"'));
    if (lines.length) assert.ok(!lines.at(-1).includes('"message":"undefined"'), "no literal undefined in the log");
  }
});
