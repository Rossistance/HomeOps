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

test("AN EMPTY TRIAGE MODEL FALLS BACK TO THE PROVIDER'S TRIAGE DEFAULT — never the flagship", async () => {
  /* THIS TEST USED TO ASSERT THE OPPOSITE, and it was pinning a bug.
   *
   * It read `assert.equal(t.model, aiProviderById("groq").defaultModel)` — the DENSE
   * flagship. So an unset triage model quietly ran the household's largest model a few
   * hundred times a day on work that is thrown away, which is the exact silent fallback
   * this module's own header says it refuses. On Together's published prices that is
   * roughly ten times the flash tier.
   *
   * The root cause was one field being asked to mean two things. Providers now declare
   * both, and the flagship is not in this resolution chain at all. */
  await runWithTenant(HH, () => {
    setSettings({ aiTriageProvider: "groq", aiTriageModel: "" }, HH);
    const t = triageTier(HH);
    assert.equal(t.ok, true, JSON.stringify(t));
    assert.equal(t.model, aiProviderById("groq").defaultTriageModel, "the small model, declared for this purpose");
    assert.notEqual(t.model, aiProviderById("groq").defaultModel, "and NOT the tier a person waits on");
  });
});

test("A PROVIDER WITH NO TRIAGE DEFAULT GOES INERT AND SAYS SO, rather than guessing expensively", async () => {
  /* The other half of the rule. openai has a flagship and no declared small model, so
   * there is nothing honest to fall back to — and reaching for its flagship is precisely
   * what was wrong before. Inert is recoverable and visible; a surprise invoice is
   * neither. */
  const openai = aiProviderById("openai");
  assert.ok(openai.defaultModel, "precondition: it does have a dense default to be tempted by");
  assert.equal(openai.defaultTriageModel ?? null, null, "precondition: and no small one declared");

  await runWithTenant(HH, () => {
    setConnectorConfig("ai.openai", {}, { apiKey: "test-key" });
    setSettings({ aiTriageProvider: "openai", aiTriageModel: "" }, HH);
    const t = triageTier(HH);
    assert.equal(t.ok, false, `it refuses rather than reaching for the flagship: ${JSON.stringify(t)}`);
    assert.equal(t.error, "triage_not_configured", JSON.stringify(t));
    assert.match(t.message, /not listening/i, "and says what it means for the family");
    assert.match(t.message, /HOMEOPS_AI_TRIAGE_MODEL/, "and how to fix it, now that there is no screen for it");
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
    /* Both open-weights providers declare a small model too, or the listener they exist to
     * power cannot run on them without a deployment setting it by hand. */
    assert.ok(p.defaultTriageModel, `${id} declares a model sized for the listener`);
    assert.notEqual(p.defaultTriageModel, p.defaultModel, `${id}'s two tiers are two models`);
  }
});
