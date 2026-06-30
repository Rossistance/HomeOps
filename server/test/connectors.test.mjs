// P1.4 — browser-dependent tools fail CLOSED before execution when the runtime is
// unavailable (no real browser runtime is wired in tests).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

const DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-conn-"));
process.env.HOMEOPS_DATA_DIR = DATA_DIR;
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
delete process.env.BROWSER_RUNTIME_URL; // ensure no runtime is configured

const conn = await import("../connectors.mjs");
after(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

test("browser connector reports runtime_unavailable with no runtime URL", () => {
  const browser = conn.listConnectors().find((c) => c.id === "browser");
  assert.ok(browser, "browser connector exists");
  assert.equal(conn.readinessOf(browser), "runtime_unavailable");
});

test("executeTool('browser.open') fails closed (no network call) when runtime is down", async () => {
  const out = await conn.executeTool("browser.open", { url: "http://example.com" }, { actorId: "m-alex", householdId: "local" });
  assert.equal(out.ok, false);
  assert.equal(out.error, "not_configured");
  assert.equal(out.readiness, "runtime_unavailable");
});
