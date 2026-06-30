// P2.1 — connected accounts are scoped to the actor who connected them. Actor B can
// neither see nor (therefore) execute with Actor A's account/token.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, alex, morgan;
before(async () => {
  ctx = await startServer();
  // Seed an account owned by m-alex directly into the server's data dir.
  fs.writeFileSync(join(ctx.dataDir, "accounts.json"), JSON.stringify([
    {
      id: "acct_alex_google", provider: "google", displayName: "alex@harper.example",
      scopes: ["gmail.send", "calendar"], status: "connected", connectedByActorId: "m-alex",
      householdId: "local", lastHealthAt: null, lastHealthOk: null,
      createdAt: Date.now(), updatedAt: new Date().toISOString(),
    },
  ], null, 2));
  alex = await makeSession(ctx, "m-alex");
  morgan = await makeSession(ctx, "m-morgan");
});
after(async () => { await stopServer(ctx); });

test("an actor sees only their own connected accounts", async () => {
  const mine = (await alex.req("/api/accounts")).data.accounts;
  assert.ok(mine.some((a) => a.id === "acct_alex_google"), "owner sees their account");
});

test("another adult cannot see Actor A's account", async () => {
  const theirs = (await morgan.req("/api/accounts")).data.accounts;
  assert.ok(!theirs.some((a) => a.id === "acct_alex_google"), "account is actor-scoped, not household-wide");
});

test("a provider tool fails 'not_connected' for an actor with no account", async () => {
  // Morgan has no Google account → gmail.send (gated) can't even resolve an account.
  // (Create the approval as Morgan first so we reach the account-resolution step.)
  const created = await morgan.req("/api/approvals", { method: "POST", body: JSON.stringify({ toolId: "gmail.send", input: { to: "x@y.com", subject: "Hi", body: "Hi" } }) });
  const id = created.data.approval.id;
  await morgan.req(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
  // Owner (alex) must approve? No — morgan is Adult Admin, allowed approver for High risk.
  const exec = await morgan.req("/api/tools/gmail.send/execute", { method: "POST", body: JSON.stringify({ input: { to: "x@y.com", subject: "Hi", body: "Hi" }, approvalId: id }) });
  assert.equal(exec.data.error, "not_connected", "no account for this actor → not_connected, never another actor's token");
});
