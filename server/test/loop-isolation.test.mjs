// C1.3 background-loop isolation: AI usage metering is per household, an
// optional daily budget degrades honestly (and only for the household that
// spent it), and the trigger tick is fair — one household's pile of due
// automations can neither starve another household nor fire unbounded.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

let store, triggers;
const DIR = fs.mkdtempSync(join(os.tmpdir(), "familios-loop-test-"));

before(async () => {
  process.env.HOMEOPS_DATA_DIR = DIR;
  store = await import("../store.mjs");
  triggers = await import("../triggers.mjs");
});

test("AI usage is metered per household — one family's spend is invisible to another", () => {
  store.recordAiUsage("hh-spend", "assistant");
  store.recordAiUsage("hh-spend", "run");
  store.recordAiUsage("hh-spend", "run");
  assert.equal(store.getAiUsage("hh-spend").total, 3);
  assert.equal(store.getAiUsage("hh-spend").run, 2);
  assert.equal(store.getAiUsage("hh-frugal").total, 0);
});

test("daily budget: exhausted for the household that spent it, never for its neighbor", () => {
  store.setSettings({ aiDailyCallBudget: 2 }, "hh-capped");
  assert.equal(store.aiBudgetExhausted("hh-capped"), false);
  store.recordAiUsage("hh-capped", "assistant");
  store.recordAiUsage("hh-capped", "assistant");
  assert.equal(store.aiBudgetExhausted("hh-capped"), true);
  // The neighbor has no budget set (unmetered) — and even with a budget, its
  // own counter is untouched by hh-capped's spending.
  assert.equal(store.aiBudgetExhausted("hh-neighbor"), false);
  store.setSettings({ aiDailyCallBudget: 2 }, "hh-neighbor");
  assert.equal(store.aiBudgetExhausted("hh-neighbor"), false);
  // Raising the budget un-exhausts immediately (settings are live).
  store.setSettings({ aiDailyCallBudget: 50 }, "hh-capped");
  assert.equal(store.aiBudgetExhausted("hh-capped"), false);
});

test("trigger tick fairness: per-household cap defers (never drops), and the next tick catches up", async () => {
  const now = Date.now();
  const mk = (id, hh) => store.putTrigger({
    id, householdId: hh, name: id, type: "recurring", enabled: true,
    intervalMs: 3600_000, nextRunAt: now - 1000,
    target: { kind: "nothing" }, // invalid target: fires harmlessly, no engine run
    createdAt: now, updatedAt: new Date().toISOString(),
  });
  for (let i = 0; i < 5; i++) mk(`trg_busy_${i}`, "hh-busy");
  for (let i = 0; i < 2; i++) mk(`trg_calm_${i}`, "hh-calm");

  const fired = await triggers.tick(now);
  // hh-busy is capped at 3; hh-calm's 2 fire untouched by the busy neighbor.
  assert.equal(fired, 5, "3 (capped) + 2 = 5 fires this tick");
  const stillDue = store.listTriggers((t) => t.id.startsWith("trg_busy_") && t.nextRunAt && t.nextRunAt <= now);
  assert.equal(stillDue.length, 2, "the two capped triggers stay due — deferred, not dropped");
  const calmDue = store.listTriggers((t) => t.id.startsWith("trg_calm_") && t.nextRunAt && t.nextRunAt <= now);
  assert.equal(calmDue.length, 0, "the calm household was fully served");

  // Next tick drains the deferred remainder.
  const fired2 = await triggers.tick(now + 1);
  assert.equal(fired2, 2);
  assert.equal(store.listTriggers((t) => t.nextRunAt && t.nextRunAt <= now + 1).length, 0);
});

test("trigger tick global cap bounds a single tick's fan-out", async () => {
  const now = Date.now() + 10_000; // beyond the recurring triggers rescheduled above
  for (let i = 0; i < 6; i++) {
    store.putTrigger({
      id: `trg_flood_a_${i}`, householdId: `hh-flood-${i % 3}a`, name: `f${i}`, type: "recurring", enabled: true,
      intervalMs: 3600_000, nextRunAt: now - 500, target: { kind: "nothing" }, createdAt: now, updatedAt: new Date().toISOString(),
    });
    store.putTrigger({
      id: `trg_flood_b_${i}`, householdId: `hh-flood-${i % 3}b`, name: `g${i}`, type: "recurring", enabled: true,
      intervalMs: 3600_000, nextRunAt: now - 500, target: { kind: "nothing" }, createdAt: now, updatedAt: new Date().toISOString(),
    });
  }
  const fired = await triggers.tick(now);
  assert.ok(fired <= 10, `a single tick never fires more than 10 (${fired})`);
  assert.ok(fired >= 10, "with 12 due across 6 households, the global cap is what binds");
});
