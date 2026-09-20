// A silent classifier must not spend the family's assistant budget.
//
// recordAiUsage keeps a per-day call counter with a per-KIND breakdown and a `.total`, and
// aiBudgetExhausted — enforced at eight sites — compares only `.total` against
// settings.aiDailyCallBudget. The passive group-chat listener runs on family chat volume
// and returns an empty answer almost every time. Counted normally, a busy Saturday in one
// group thread exhausts the household's budget and the family finds Ask Famili dead for a
// reason nothing surfaces. So triage records its kind and is kept OFF `.total`, and is
// bounded instead by its own per-kind ceiling.
//
// The other half is the rule ai-tier.mjs exists to hold: THERE IS NO FALLBACK from the
// triage tier to the dense one. An unconfigured triage tier makes the listener inert and
// says so. Falling back would quietly bill the frontier model for every message in a family
// group chat, which is the same fabricated readiness this codebase refuses everywhere else.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-aitier-"));
const store = await import("../store.mjs");
const { runWithTenant, setSettings, recordAiUsage, getAiUsage, aiBudgetExhausted, kindBudgetExhausted, setConnectorConfig } = store;
const { triageTier, denseTier, TRIAGE_USAGE_KIND, DEFAULT_TRIAGE_DAILY_BUDGET } = await import("../ai-tier.mjs");
const { AI_PROVIDERS, aiProviderById } = await import("../ai.mjs");

const HH = "hh_tier00001";

process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {} });

/* ---- metering ---- */

test("triage usage rises on its own counter and NEVER on .total", async () => {
  await runWithTenant(HH, () => {
    setSettings({ aiDailyCallBudget: 5 }, HH);
    for (let i = 0; i < 20; i++) recordAiUsage(HH, TRIAGE_USAGE_KIND, { countsTowardTotal: false });
    const u = getAiUsage(HH);
    assert.equal(u[TRIAGE_USAGE_KIND], 20, "the kind counter is the meter that moved");
    assert.equal(u.total ?? 0, 0, "and .total did not move at all");
    assert.equal(aiBudgetExhausted(HH), false, "so twenty classifications cannot starve a five-call assistant budget");
  });
});

test("ordinary usage still counts toward .total, so the existing budget is untouched", async () => {
  await runWithTenant(HH, () => {
    for (let i = 0; i < 5; i++) recordAiUsage(HH, "assistant");
    assert.equal(getAiUsage(HH).total, 5);
    assert.equal(aiBudgetExhausted(HH), true, "the assistant budget still works exactly as before");
  });
});

test("the triage tier is bounded by its OWN ceiling, not unmetered", async () => {
  await runWithTenant(HH, () => {
    assert.equal(kindBudgetExhausted(HH, TRIAGE_USAGE_KIND, 20), true, "20 recorded, ceiling 20 → exhausted");
    assert.equal(kindBudgetExhausted(HH, TRIAGE_USAGE_KIND, DEFAULT_TRIAGE_DAILY_BUDGET), false, "…and far from the default ceiling");
    assert.equal(kindBudgetExhausted(HH, TRIAGE_USAGE_KIND, 0), false, "no budget set means unmetered, same rule as everywhere else");
    assert.equal(kindBudgetExhausted(HH, TRIAGE_USAGE_KIND, undefined), false);
  });
});

/* ---- the no-fallback rule ---- */

test("an unconfigured triage tier is an honest refusal, never the dense provider", async () => {
  await runWithTenant(HH, () => {
    setSettings({ aiActiveProvider: "openai", aiTriageProvider: null, aiTriageModel: null }, HH);
    setConnectorConfig("ai.openai", {}, { apiKey: "sk-test-dense" });

    const t = triageTier(HH);
    assert.equal(t.ok, false);
    assert.equal(t.error, "triage_not_configured");
    assert.ok(/not listening/i.test(t.message), `a sentence a person can act on: ${t.message}`);
    assert.equal(t.providerId, undefined, "and crucially NO provider — not the dense one, not any one");

    const d = denseTier(HH);
    assert.equal(d.ok, true, "the dense tier is configured and fine — the point is triage did not borrow it");
    assert.equal(d.providerId, "openai");
  });
});

test("a triage provider named but keyless refuses differently from one never chosen", async () => {
  await runWithTenant(HH, () => {
    setSettings({ aiTriageProvider: "groq", aiTriageModel: null }, HH);
    const t = triageTier(HH);
    assert.equal(t.ok, false);
    assert.equal(t.error, "triage_not_configured");
    assert.ok(/Groq/.test(t.message), `names what needs a key: ${t.message}`);
  });
});

test("a configured triage tier resolves to ITS provider and model", async () => {
  await runWithTenant(HH, () => {
    setConnectorConfig("ai.groq", {}, { apiKey: "gsk-test-triage" });
    setSettings({ aiTriageProvider: "groq", aiTriageModel: "llama-3.1-8b-instant" }, HH);
    const t = triageTier(HH);
    assert.equal(t.ok, true, JSON.stringify(t));
    assert.equal(t.providerId, "groq");
    assert.equal(t.model, "llama-3.1-8b-instant");
    assert.notEqual(t.providerId, "openai", "the dense provider is still openai and triage did not become it");
  });
});

test("an empty triage model falls back to the PROVIDER's default, not to the dense model", async () => {
  await runWithTenant(HH, () => {
    setSettings({ aiTriageProvider: "groq", aiTriageModel: "" }, HH);
    const t = triageTier(HH);
    assert.equal(t.ok, true);
    assert.equal(t.model, aiProviderById("groq").defaultModel);
  });
});

/* ---- the provider rows themselves ---- */

test("groq and together are their own rows, so both tiers can be configured at once", () => {
  const ids = AI_PROVIDERS.map((p) => p.id);
  assert.ok(ids.includes("groq") && ids.includes("together"));
  // The single generic `compatible` slot holds ONE endpoint per household, which is exactly
  // what a two-tier split cannot live with.
  for (const id of ["groq", "together"]) {
    const p = aiProviderById(id);
    assert.equal(p.style, "openai", "openai-shaped request body");
    assert.equal(p.needsKey, true);
    assert.ok(p.defaultBaseUrl.startsWith("https://"), "a real default endpoint, not a blank to fill in");
    assert.ok(p.defaultModel, "and a real default model");
  }
});
