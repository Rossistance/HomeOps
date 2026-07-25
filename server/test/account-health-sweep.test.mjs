// The reconnect that wouldn't clear — part two.
//
// Part one made a successful call clear an unhealthy status. Reported again after shipping
// it: "the reconnect button is still there."
//
// The hole was reachability, not logic. checkAccountHealth ran only from
// POST /api/accounts/:id/health, restricted to the member who connected THAT account, and
// nothing called it on a schedule — so an account nothing happened to exercise kept whatever
// status it was last given, forever. Status stopped describing the account and started
// describing history.
//
// What's under test: the status corrects itself in BOTH directions, for accounts nobody is
// touching, including other members'.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-health-"));
const { sweepAccountHealth } = await import("../accounts.mjs");
const { putAccount, getAccountRaw, listAccountsRaw, runWithTenant } = await import("../store.mjs");

const HH = "local";
const T = (fn) => runWithTenant(HH, fn);

// The health probe ends in a real provider request; answer it here instead of the network.
const realFetch = globalThis.fetch;
let providerOk = true;
before(() => {
  globalThis.fetch = async () => ({
    ok: providerOk, status: providerOk ? 200 : 401,
    headers: { get: () => null }, body: null,
    text: async () => (providerOk ? '{"emailAddress":"someone@example.com"}' : '{"error":"invalid_grant"}'),
  });
});
after(() => {
  globalThis.fetch = realFetch;
  try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {}
});
beforeEach(async () => {
  providerOk = true;
  await T(async () => { for (const a of listAccountsRaw()) putAccount({ ...a, householdId: "_gone" }); });
});

let seq = 0;
const account = (over) => {
  const id = `acct_${++seq}`;
  return T(async () => {
    putAccount({
      id, householdId: HH, provider: "google", displayName: "someone@example.com",
      connectedByActorId: "m-melissa", scopes: ["https://www.googleapis.com/auth/calendar"],
      status: "connected", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      lastHealthAt: null, lastHealthOk: null, ...over,
    });
    return id;
  });
};

/* ---- the reported bug ---- */

test("THE BUG: a stale needs_reconnect clears itself, with nobody using the account", async () => {
  // Nothing in the household calls through this account — it belongs to another member and
  // has no subscription behind it. That is exactly the case part one couldn't reach.
  const id = await account({ status: "needs_reconnect" });
  const out = await T(() => sweepAccountHealth({ householdId: HH }));
  assert.equal(out.healed, 1);
  assert.equal((await T(() => getAccountRaw(id))).status, "connected");
});

test("it corrects in the OTHER direction too — a dead credential gets marked", async () => {
  providerOk = false;
  const id = await account({ status: "connected" });
  await T(() => sweepAccountHealth({ householdId: HH }));
  // A 401 whose refresh also fails is specifically "reconnect me" — apiForAccount says so,
  // and that is a more useful verdict than the generic "degraded".
  assert.equal((await T(() => getAccountRaw(id))).status, "needs_reconnect",
    "a family shouldn't have to trip over a broken account to find out it's broken");
});

test("expired and degraded clear as well — not just needs_reconnect", async () => {
  const ids = [await account({ status: "expired" }), await account({ status: "degraded" })];
  await T(() => sweepAccountHealth({ householdId: HH }));
  for (const id of ids) assert.equal((await T(() => getAccountRaw(id))).status, "connected");
});

/* ---- what it must NOT do ---- */

test("REVOKED is left alone — the family disconnected it on purpose", async () => {
  const id = await account({ status: "revoked" });
  const out = await T(() => sweepAccountHealth({ householdId: HH }));
  assert.equal(out.checked, 0);
  assert.equal((await T(() => getAccountRaw(id))).status, "revoked",
    "clearing this would undo a deliberate choice");
});

test("another household's accounts are never probed", async () => {
  const mine = await account({ status: "needs_reconnect" });
  const theirs = await T(async () => {
    putAccount({
      id: "acct_other", householdId: "hh_stranger", provider: "google", status: "needs_reconnect",
      connectedByActorId: "m-x", scopes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    return "acct_other";
  });
  await T(() => sweepAccountHealth({ householdId: HH }));
  assert.equal((await T(() => getAccountRaw(mine))).status, "connected");
  assert.equal((await T(() => getAccountRaw(theirs))).status, "needs_reconnect");
});

test("a probe is throttled — the sweep runs often, real provider calls don't", async () => {
  const id = await account({ status: "connected", lastHealthAt: new Date().toISOString() });
  const out = await T(() => sweepAccountHealth({ householdId: HH }));
  assert.equal(out.checked, 0);
  assert.equal(out.skipped, 1);
  // …unless a person explicitly asks, which is what the manual check-now does.
  const forced = await T(() => sweepAccountHealth({ householdId: HH, force: true }));
  assert.equal(forced.checked, 1);
});

test("a healthy account stays healthy and reports no change", async () => {
  const id = await account({ status: "connected" });
  const out = await T(() => sweepAccountHealth({ householdId: HH }));
  assert.equal(out.checked, 1);
  assert.equal(out.healed, 0);
  assert.equal(out.marked, 0);
  assert.equal((await T(() => getAccountRaw(id))).status, "connected");
});

test("one unreachable provider doesn't stop the rest of the sweep", async () => {
  const good = await account({ status: "needs_reconnect" });
  await T(async () => putAccount({
    ...(await getAccountRaw(good)), id: "acct_bogus", provider: "not-a-real-provider", status: "needs_reconnect",
  }));
  const out = await T(() => sweepAccountHealth({ householdId: HH }));
  assert.equal((await T(() => getAccountRaw(good))).status, "connected", "the good one still heals");
});
