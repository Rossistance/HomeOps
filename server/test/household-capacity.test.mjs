// One household could exhaust the capacity every other household is sharing.
//
// Rate limiting was per-IP (auth) and per-ACTOR (assistant). Neither bounds a FAMILY: six
// members is six times the ceiling, and on a shared deployment every one of those calls spends
// the same pooled AI capacity everybody else is waiting on. There was no limit at that level at
// all — so one busy household could degrade the product for every other one, with nothing in
// the logs naming a cause, because nobody had exceeded anything.
//
// And the household's own cost control was worse than missing: `aiDailyCallBudget` has been
// METERED and ENFORCED since C1.3 (store.mjs recordAiUsage / aiBudgetExhausted), and nothing
// anywhere ever wrote it. A live, functional cap that was permanently unset.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, adult;
const settings = async (as) => (await as.req("/api/settings")).data.settings;

before(async () => {
  // 10 is the floor the server enforces on this knob, so it is the lowest value that actually
  // takes effect — anything smaller would be silently raised and the test would prove nothing.
  ctx = await startServer({ env: { HOMEOPS_HOUSEHOLD_RATE_LIMIT: "10" } });
  owner = await makeSession(ctx, "m-alex");
  adult = await makeSession(ctx, "m-morgan");
});
after(async () => { await stopServer(ctx); });

/* ---- the dial that was enforced and could not be turned ---- */

test("a household starts unmetered, and says so", async () => {
  const s = await settings(owner);
  assert.equal(s.aiDailyCallBudget, null, "no budget set = unlimited, the documented default");
  assert.equal(typeof s.aiCallsToday, "number", "…and the count you'd measure against it is visible");
});

test("THE DIAL: a daily AI call budget can now be set", async () => {
  const r = await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ aiDailyCallBudget: 250 }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await settings(owner)).aiDailyCallBudget, 250);
});

test("…and turned back off with 0, which is how the default is spelled", async () => {
  await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ aiDailyCallBudget: 0 }) });
  assert.equal((await settings(owner)).aiDailyCallBudget, null);
});

test("a nonsense budget is refused rather than stored", async () => {
  await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ aiDailyCallBudget: 500 }) });
  for (const bad of [-5, "lots", 999999999]) {
    const r = await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ aiDailyCallBudget: bad }) });
    assert.equal(r.status, 400, `${JSON.stringify(bad)} should be refused`);
    assert.equal(r.data.error, "invalid_budget");
  }
  assert.equal((await settings(owner)).aiDailyCallBudget, 500, "and the real one is untouched");
});

test("a fractional budget is floored, not rejected — it's a count of calls", async () => {
  await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ aiDailyCallBudget: 12.7 }) });
  assert.equal((await settings(owner)).aiDailyCallBudget, 12);
});

test("setting it is NOT PIN-gated — this cannot send anything outward", async () => {
  // Unlike the autonomy switches, the worst a budget does is make the assistant stop early,
  // which is the careful direction. Gating it would teach people to type the PIN without
  // reading, which is what makes the gates that matter stop working.
  const set = await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ ownerPin: "4417" }) });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  const r = await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ aiDailyCallBudget: 300 }) });
  assert.equal(r.status, 200, "a PIN'd household can still set a budget without producing one");
  assert.equal((await settings(owner)).aiDailyCallBudget, 300);
});

/* ---- the household ceiling ---- */

test("THE CEILING: a household is limited even when its members are not", async () => {
  // Two DIFFERENT members, so the per-actor cap (30/min) is nowhere near being hit. Only a
  // household-level bucket can catch this, and there wasn't one.
  const limit = 10;   // HOMEOPS_HOUSEHOLD_RATE_LIMIT, set on this server
  const codes = [];
  for (let i = 0; i < limit + 3; i++) {
    const as = i % 2 === 0 ? owner : adult;
    const r = await as.req("/api/assistant/health");
    codes.push(r.status);
  }
  assert.ok(codes.includes(429), `expected the household to be throttled, got ${codes.join(",")}`);
  const throttled = codes.filter((c) => c === 429).length;
  assert.ok(throttled >= 1 && codes[0] !== 429, "the first calls go through — this is a ceiling, not a wall");
});

test("the refusal names the household, so it isn't mistaken for a personal limit", async () => {
  let body = null;
  for (let i = 0; i < 8; i++) {
    const r = await owner.req("/api/assistant/health");
    if (r.status === 429) { body = r.data; break; }
  }
  assert.ok(body, "expected a 429 while the window is still hot");
  assert.equal(body.error, "rate_limited");
  assert.match(body.message, /household/i, "\"you personally sent too much\" would be the wrong thing to tell someone");
});
