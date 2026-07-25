// C1.5 plan & billing: 21-day trial from household creation, RevenueCat
// webhook as the only writer of plan state (fail-closed auth), a 402 gate on
// AI-spend routes when expired, and the resident household always exempt.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, readStoreDoc, writeStoreDoc } from "./harness.mjs";

const RC_SECRET = "test-rc-webhook-secret";
let ctx;
before(async () => { ctx = await startServer({ env: { HOMEOPS_RC_WEBHOOK_SECRET: RC_SECRET } }); });
after(async () => { await stopServer(ctx); });

async function signup(email, ownerName) {
  const res = await ctx.fetch("/api/signup", {
    method: "POST", headers: { "content-type": "application/json" },
    // A household name is required at signup now (D3) — creating one without a name was the
    // path to the "Ross's household" fallback the owner asked us to remove.
    body: JSON.stringify({ email, password: "plan test passphrase", ownerName, householdName: `${ownerName} household` }),
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  const data = await res.json();
  return {
    data, cookie, householdId: data.session?.householdId,
    async req(path, init = {}) {
      const headers = { Cookie: cookie, ...(init.headers || {}) };
      if (init.method && init.method !== "GET") { headers["x-homeops-csrf"] = data.session.csrf; headers["content-type"] ??= "application/json"; }
      const r = await ctx.fetch(path, { ...init, headers });
      let out = null; try { out = await r.json(); } catch { /* SSE / non-JSON */ }
      return { status: r.status, data: out };
    },
  };
}
const rcEvent = (event, auth = RC_SECRET) => ctx.fetch("/api/webhooks/revenuecat", {
  method: "POST", headers: { "content-type": "application/json", authorization: auth },
  body: JSON.stringify({ api_version: "1.0", event }),
});

let fam;
test("a fresh household is on an active 21-day trial", async () => {
  fam = await signup("plan-family@example.com", "Pat");
  const plan = (await fam.req("/api/plan")).data.plan;
  assert.equal(plan.tier, "trial");
  assert.equal(plan.active, true);
  const daysLeft = (plan.trialEndsAt - Date.now()) / 86400000;
  assert.ok(daysLeft > 20 && daysLeft <= 21, `trial is ~21 days (${daysLeft.toFixed(1)})`);
});

test("an expired trial gets an honest 402 on AI routes — data routes stay open", async () => {
  // Age the household 22 days by editing its settings directly.
  const settings = readStoreDoc(ctx, "settings.json", {}, fam.householdId);
  writeStoreDoc(ctx, "settings.json", { ...settings, householdCreatedAt: Date.now() - 22 * 86400000 }, fam.householdId);
  const plan = (await fam.req("/api/plan")).data.plan;
  assert.equal(plan.tier, "expired");
  const ai = await fam.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "hello" }) });
  assert.equal(ai.status, 402);
  assert.equal(ai.data.error, "plan_required");
  const tasks = await fam.req("/api/tasks");
  assert.equal(tasks.status, 200, "family data is never held hostage");
  const create = await fam.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "still mine", type: "task" }) });
  assert.equal(create.status, 200, "data writes stay open too");
});

test("webhook auth: wrong secret 401, missing secret config would 503 (fail closed)", async () => {
  const bad = await rcEvent({ type: "INITIAL_PURCHASE", app_user_id: fam.householdId, entitlement_ids: ["familios_plus"] }, "wrong-secret");
  assert.equal(bad.status, 401);
});

test("INITIAL_PURCHASE with familios_plus activates the household; EXPIRATION deactivates", async () => {
  const expires = Date.now() + 30 * 86400000;
  const buy = await rcEvent({ type: "INITIAL_PURCHASE", app_user_id: fam.householdId, entitlement_ids: ["familios_plus"], expiration_at_ms: expires });
  assert.equal(buy.status, 200);
  assert.equal((await buy.json()).applied, "plus");
  let plan = (await fam.req("/api/plan")).data.plan;
  assert.equal(plan.tier, "plus");
  assert.equal(plan.active, true);
  const ai = await fam.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "hello" }) });
  assert.notEqual(ai.status, 402, "subscribed household passes the gate");

  const bye = await rcEvent({ type: "EXPIRATION", app_user_id: fam.householdId, entitlement_ids: ["familios_plus"], expiration_at_ms: Date.now() - 1000 });
  assert.equal((await bye.json()).applied, "none");
  plan = (await fam.req("/api/plan")).data.plan;
  assert.equal(plan.active, false, "expired subscription falls back to (long-expired) trial state");
});

test("BILLING_ISSUE keeps access through the grace period", async () => {
  const graceUntil = Date.now() + 3 * 86400000;
  // A lapsed subscription (expiry already past) with an open grace window.
  await rcEvent({ type: "BILLING_ISSUE", app_user_id: fam.householdId, entitlement_ids: ["familios_plus"], expiration_at_ms: Date.now() - 100, grace_period_expiration_at_ms: graceUntil });
  const plan = (await fam.req("/api/plan")).data.plan;
  assert.equal(plan.active, true);
  assert.equal(plan.grace, true, "billing hiccups degrade gracefully, not instantly");
});

test("unknown or malformed app_user_id is acknowledged and ignored", async () => {
  const r = await rcEvent({ type: "INITIAL_PURCHASE", app_user_id: "hh_does_not_exist", entitlement_ids: ["familios_plus"] });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ignored, "unknown_household");
  const evil = await rcEvent({ type: "INITIAL_PURCHASE", app_user_id: "../../../etc", entitlement_ids: ["familios_plus"] });
  assert.equal((await evil.json()).ignored, "unknown_household");
});

test("the resident family household is never gated", async () => {
  const owner = await makeSession(ctx, "m-alex");
  const plan = (await owner.req("/api/plan")).data.plan;
  assert.equal(plan.tier, "resident");
  assert.equal(plan.active, true);
  const ai = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "hello" }) });
  assert.notEqual(ai.status, 402);
});
