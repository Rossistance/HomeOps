// FamiliOS — WP-006 slice 2: PLANNER CATALOG COMPACTION for local models.
//
// pruneCatalogForPrompt() shrinks the tool menu the AI model sees, in two independent
// steps, without ever touching the catalog used to RESOLVE the model's answer (that stays
// full) or the engine's own per-step re-validation:
//   (a) restrict to the acting agent's PERMITTED tools (allow/deny), always keeping the
//       always-available internal homeops.* tools — for EVERY provider.
//   (b) for a LOCAL provider only (Ollama / LM Studio), additionally rank by relevance to
//       the goal text and cap the serialized catalog under a char budget. Cloud providers
//       keep the full permitted catalog unchanged.
// These are pure, store-free assertions over a synthetic catalog fixture + provider ids,
// so the whole suite is deterministic and needs no network, no LLM, and no live provider
// (HYP-005: LM Studio is down on this host — the budget is configurable, not measured here).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

// planner.mjs transitively imports store.mjs, which refuses the live server/.data from a
// test process unless HOMEOPS_DATA_DIR already points at an isolated temp dir.
if (!process.env.HOMEOPS_DATA_DIR) {
  process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-test-proc-"));
}
const { pruneCatalogForPrompt, isLocalProvider, plannerCatalogBudget } = await import("../planner.mjs");

// A synthetic full catalog: three always-available internal homeops.* tools, plus a spread
// of external provider/connector tools with distinctive names for relevance scoring.
function fixtureCatalog() {
  return [
    { toolId: "homeops.create_task", name: "Create a task", action: "Write", risk: "Low", requiresApproval: false, connectorId: "homeops", connectorName: "FamiliOS", source: "internal", connected: true, inputs: [{ key: "title" }] },
    { toolId: "homeops.write_memory", name: "Remember a fact", action: "Write", risk: "Low", requiresApproval: false, connectorId: "homeops", connectorName: "FamiliOS", source: "internal", connected: true, inputs: [{ key: "text" }] },
    { toolId: "homeops.plan_meal", name: "Plan a meal", action: "Write", risk: "Low", requiresApproval: false, connectorId: "homeops", connectorName: "FamiliOS", source: "internal", connected: true, inputs: [{ key: "title" }] },
    { toolId: "gmail.send", name: "Send an email", action: "Write", risk: "Medium", requiresApproval: true, connectorId: "gmail", connectorName: "Gmail", source: "provider", connected: true, inputs: [{ key: "to" }, { key: "subject" }, { key: "body" }] },
    { toolId: "gmail.search", name: "Search email", action: "Read", risk: "Low", requiresApproval: false, connectorId: "gmail", connectorName: "Gmail", source: "provider", connected: true, inputs: [{ key: "query" }] },
    { toolId: "calendar.list", name: "List calendar events", action: "Read", risk: "Low", requiresApproval: false, connectorId: "calendar", connectorName: "Google Calendar", source: "provider", connected: true, inputs: [] },
    { toolId: "calendar.create", name: "Create calendar event", action: "Write", risk: "Medium", requiresApproval: true, connectorId: "calendar", connectorName: "Google Calendar", source: "provider", connected: true, inputs: [{ key: "title" }, { key: "startAt" }] },
    { toolId: "weather.current", name: "Current weather", action: "Read", risk: "Low", requiresApproval: false, connectorId: "weather", connectorName: "Weather", source: "provider", connected: true, inputs: [{ key: "location" }] },
    { toolId: "sms.send", name: "Send a text message", action: "Write", risk: "Medium", requiresApproval: true, connectorId: "sms", connectorName: "SMS", source: "provider", connected: true, inputs: [{ key: "to" }, { key: "body" }] },
    { toolId: "web.search", name: "Search the web", action: "Read", risk: "Low", requiresApproval: false, connectorId: "web", connectorName: "Web", source: "connector", connected: true, inputs: [{ key: "query" }] },
  ];
}
const idsOf = (compact) => compact.map((t) => t.id);
const homeopsIds = ["homeops.create_task", "homeops.write_memory", "homeops.plan_meal"];

/* ------------------------- provider metadata (pure) ------------------------- */
test("isLocalProvider: ollama and lmstudio are local; cloud/unknown are not", () => {
  assert.equal(isLocalProvider("ollama"), true);
  assert.equal(isLocalProvider("lmstudio"), true);
  assert.equal(isLocalProvider("openai"), false);
  assert.equal(isLocalProvider("anthropic"), false);
  assert.equal(isLocalProvider("gemini"), false);
  assert.equal(isLocalProvider("compatible"), false);
  assert.equal(isLocalProvider(null), false);
  assert.equal(isLocalProvider("nope"), false);
});

test("plannerCatalogBudget: sane default, env override respected", () => {
  const prev = process.env.HOMEOPS_PLANNER_CATALOG_BUDGET;
  delete process.env.HOMEOPS_PLANNER_CATALOG_BUDGET;
  assert.equal(plannerCatalogBudget(), 8000);
  process.env.HOMEOPS_PLANNER_CATALOG_BUDGET = "2500";
  assert.equal(plannerCatalogBudget(), 2500);
  process.env.HOMEOPS_PLANNER_CATALOG_BUDGET = "0"; // invalid → default
  assert.equal(plannerCatalogBudget(), 8000);
  if (prev === undefined) delete process.env.HOMEOPS_PLANNER_CATALOG_BUDGET;
  else process.env.HOMEOPS_PLANNER_CATALOG_BUDGET = prev;
});

/* --------------------- (a) permitted-tools restriction ---------------------- */
test("CLOUD, no agent: full catalog passes through unchanged (order + count)", () => {
  const full = fixtureCatalog();
  const compact = pruneCatalogForPrompt(full, { agent: null, goal: "anything", providerId: "openai" });
  assert.equal(compact.length, full.length, "cloud + no agent must not prune");
  assert.deepEqual(idsOf(compact), full.map((t) => t.toolId), "order preserved");
  // projection shape matches the legacy compact used by the planner prompt.
  assert.deepEqual(compact[3], { id: "gmail.send", name: "Send an email", action: "Write", risk: "Medium", approval: true, connector: "gmail", connected: true, inputs: ["to", "subject", "body"] });
});

test("permitted restriction: allow-list keeps listed tools + ALL homeops.* internal, drops the rest (cloud)", () => {
  const agent = { id: "agt_x", allowedToolIds: ["gmail.send"], allowedFunctionIds: [], deniedToolIds: [], deniedFunctionIds: [] };
  const compact = pruneCatalogForPrompt(fixtureCatalog(), { agent, goal: "email grandma", providerId: "openai" });
  const ids = idsOf(compact);
  for (const h of homeopsIds) assert.ok(ids.includes(h), `always-available ${h} must remain`);
  assert.ok(ids.includes("gmail.send"), "an allow-listed tool must remain");
  assert.ok(!ids.includes("calendar.list"), "a non-permitted external tool must be pruned");
  assert.ok(!ids.includes("sms.send"), "a non-permitted external tool must be pruned");
  assert.ok(!ids.includes("weather.current"), "a non-permitted external tool must be pruned");
});

test("permitted restriction: a DENY drops the tool even with an empty (permissive) allow-list", () => {
  const agent = { id: "agt_x", allowedToolIds: [], allowedFunctionIds: [], deniedToolIds: ["gmail.send"], deniedFunctionIds: [] };
  const compact = pruneCatalogForPrompt(fixtureCatalog(), { agent, goal: "email", providerId: "openai" });
  const ids = idsOf(compact);
  assert.ok(!ids.includes("gmail.send"), "a denied tool must never reach the model's menu");
  assert.ok(ids.includes("gmail.search"), "a non-denied sibling stays");
  assert.ok(ids.includes("calendar.list"), "empty allow-list is permissive: everything else stays");
});

/* ------------------- (b) local provider: budget + relevance ----------------- */
test("LOCAL provider: caps the catalog under the char budget and shrinks vs. the full menu", () => {
  const full = fixtureCatalog();
  const compact = pruneCatalogForPrompt(full, { agent: null, goal: "send an email", providerId: "ollama", budget: 500 });
  assert.ok(compact.length < full.length, "a tight budget on a local provider must prune");
  assert.ok(JSON.stringify(compact).length <= 500 + 200, "serialized catalog stays near the budget");
});

test("LOCAL provider: keeps the MOST-RELEVANT tools for the goal (deterministic scorer)", () => {
  // Goal tokens strongly overlap gmail.send ("send"/"email"). With a budget that only fits
  // the homeops essentials + a couple of optional tools, the email tool must survive while
  // an irrelevant one (weather) is dropped.
  const compact = pruneCatalogForPrompt(fixtureCatalog(), { agent: null, goal: "send an email to grandma about dinner", providerId: "ollama", budget: 700 });
  const ids = idsOf(compact);
  assert.ok(ids.includes("gmail.send"), "the goal-relevant email tool must be kept");
  assert.ok(!ids.includes("weather.current"), "an irrelevant tool must be dropped under budget pressure");
  // Relevance order: gmail.send outranks the unrelated optional tools that survive.
  const optional = ids.filter((id) => !homeopsIds.includes(id));
  assert.equal(optional[0], "gmail.send", "most-relevant optional tool ranks first");
});

test("LOCAL provider: always-available homeops.* are NEVER dropped, even at an impossibly small budget", () => {
  const compact = pruneCatalogForPrompt(fixtureCatalog(), { agent: null, goal: "x", providerId: "ollama", budget: 1 });
  const ids = idsOf(compact);
  for (const h of homeopsIds) assert.ok(ids.includes(h), `${h} must survive any budget (family-data spine)`);
  // Every optional external tool is squeezed out by the budget-1.
  assert.ok(ids.every((id) => homeopsIds.includes(id)), "only the essential internal tools remain");
});

test("LOCAL provider: permitted restriction AND budget compose (denied tool never reappears via ranking)", () => {
  const agent = { id: "agt_x", allowedToolIds: [], allowedFunctionIds: [], deniedToolIds: ["gmail.send"], deniedFunctionIds: [] };
  const compact = pruneCatalogForPrompt(fixtureCatalog(), { agent, goal: "send an email", providerId: "lmstudio", budget: 5000 });
  assert.ok(!idsOf(compact).includes("gmail.send"), "a denied tool stays denied even when it is the most relevant");
});
