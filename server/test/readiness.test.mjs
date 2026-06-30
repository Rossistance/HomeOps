// P1.3 — provider readiness is truthful: a default localhost URL or an API key is not
// proof of reachability. Local providers stay needs_health_check until a probe succeeds.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

const DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-ai-"));
process.env.HOMEOPS_DATA_DIR = DATA_DIR;
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";

const ai = await import("../ai.mjs");
const store = await import("../store.mjs");
after(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const readiness = (id) => ai.providerReadiness(ai.aiProviderById(id));

test("a cloud provider with no key is not_configured", () => {
  assert.equal(readiness("openai"), "not_configured");
});

test("a local provider with only a default URL is needs_health_check, NOT configured", () => {
  assert.equal(readiness("ollama"), "needs_health_check");
  assert.equal(readiness("lmstudio"), "needs_health_check");
});

test("readiness reflects a verified health probe", () => {
  store.setHealth("ai.ollama", { ok: false, status: "unreachable" });
  assert.equal(readiness("ollama"), "unreachable");
  store.setHealth("ai.ollama", { ok: true, status: "reachable" });
  assert.equal(readiness("ollama"), "healthy");
});

test("publicProvider surfaces health distinctly from readiness", () => {
  store.setHealth("ai.lmstudio", { ok: false, status: "unreachable" });
  const p = ai.listProviders().find((x) => x.id === "lmstudio");
  assert.equal(p.readiness, "unreachable");
  assert.equal(p.health.ok, false);
});
