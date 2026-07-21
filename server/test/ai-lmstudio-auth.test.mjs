// ISS-006 / WP-007 — LM Studio needsKey:false but keyOptional:true: a local server with
// no auth configured must keep working with NO Authorization header, and a server that
// now requires a token (newer LM Studio builds return 401 invalid_api_key) must get a
// real `Authorization: Bearer <key>` once a token is stored via Settings. This file pins
// down the header-injection contract on both the health/model-discovery path and the
// chat path, plus the 401 → actionable-hint behavior. Upstream fetch is stubbed for
// determinism — no real network calls.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

// Isolated store BEFORE the first ../store.mjs import (ISS-001 guard) — same pattern as
// server/test/readiness.test.mjs.
const DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-ai-lmstudio-"));
process.env.HOMEOPS_DATA_DIR = DATA_DIR;
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";

const ai = await import("../ai.mjs");

after(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

// ---- Hermetic fetch stub (same pattern as server/test/weather-honesty.test.mjs) ----
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

/** @type {{url: string, headers: Record<string, string>}[]} */
let requests = [];
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
/** @param {(url: string) => Response} respond */
function stubFetch(respond) {
  requests = [];
  globalThis.fetch = async (url, init) => {
    const headers = { ...(init?.headers ?? {}) };
    requests.push({ url: String(url), headers });
    return respond(String(url));
  };
}
function lastRequestTo(suffix) {
  return [...requests].reverse().find((r) => r.url.endsWith(suffix));
}

// ---- needsKey:false must still mean "works unauthenticated" ----

test("lmstudio metadata: needsKey stays false, keyOptional is true", () => {
  const p = ai.aiProviderById("lmstudio");
  assert.equal(p.needsKey, false);
  assert.equal(p.keyOptional, true);
  const pub = ai.publicProvider(p);
  assert.equal(pub.needsKey, false);
  assert.equal(pub.keyOptional, true);
});

test("no key stored: providerHealth (model discovery) sends NO Authorization header", async () => {
  assert.equal(ai.publicProvider(ai.aiProviderById("lmstudio")).keySet, false, "precondition: no key stored yet");
  stubFetch((url) => (url.endsWith("/models") ? jsonResponse({ data: [{ id: "local-model" }] }) : jsonResponse({}, 404)));
  const r = await ai.providerHealth("lmstudio");
  assert.equal(r.ok, true, JSON.stringify(r));
  const req = lastRequestTo("/models");
  assert.ok(req, "expected a /models request");
  assert.equal(req.headers.authorization, undefined, "no key stored → no Authorization header");
});

test("no key stored: providerChat sends NO Authorization header", async () => {
  stubFetch((url) => {
    if (url.endsWith("/models")) return jsonResponse({ data: [{ id: "local-model" }] });
    if (url.endsWith("/chat/completions")) return jsonResponse({ choices: [{ message: { content: "hi" } }] });
    return jsonResponse({}, 404);
  });
  const r = await ai.providerChat("lmstudio", { messages: [{ role: "user", content: "hello" }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const req = lastRequestTo("/chat/completions");
  assert.ok(req, "expected a /chat/completions request");
  assert.equal(req.headers.authorization, undefined, "no key stored → no Authorization header on the chat call either");
});

// ---- Once a token is stored (Settings → keyOptional field → config POST), it must ride along ----

test("storing a token via setProviderConfig lands in the vault (same path the config POST route uses)", () => {
  const saved = ai.setProviderConfig("lmstudio", { apiKey: "sk-test-lmstudio-token" });
  assert.equal(saved.keySet, true);
});

test("key stored: providerHealth (model discovery) sends Authorization: Bearer <key>", async () => {
  stubFetch((url) => (url.endsWith("/models") ? jsonResponse({ data: [{ id: "local-model" }] }) : jsonResponse({}, 404)));
  const r = await ai.providerHealth("lmstudio");
  assert.equal(r.ok, true, JSON.stringify(r));
  const req = lastRequestTo("/models");
  assert.ok(req);
  assert.equal(req.headers.authorization, "Bearer sk-test-lmstudio-token");
});

test("key stored: providerChat sends Authorization: Bearer <key>", async () => {
  stubFetch((url) => {
    if (url.endsWith("/models")) return jsonResponse({ data: [{ id: "local-model" }] });
    if (url.endsWith("/chat/completions")) return jsonResponse({ choices: [{ message: { content: "hi" } }] });
    return jsonResponse({}, 404);
  });
  const r = await ai.providerChat("lmstudio", { messages: [{ role: "user", content: "hello" }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const req = lastRequestTo("/chat/completions");
  assert.ok(req);
  assert.equal(req.headers.authorization, "Bearer sk-test-lmstudio-token");
});

// ---- 401 invalid_api_key must surface an actionable hint, not a bare "unreachable" ----

test("a 401 invalid_api_key response surfaces an actionable token hint naming LM Studio", async () => {
  stubFetch((url) => (url.endsWith("/models")
    ? jsonResponse({ error: { message: "Invalid API Key", code: "invalid_api_key" } }, 401)
    : jsonResponse({}, 404)));
  const r = await ai.providerHealth("lmstudio");
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.ok(r.hint, "expected an actionable hint on a 401 invalid_api_key response");
  assert.match(r.hint, /LM Studio/);
  assert.match(r.hint, /API token/i);
});

test("a 401 on a NON-keyOptional provider gets no such hint (openai has its own needsKey affordance)", async () => {
  ai.setProviderConfig("openai", { apiKey: "sk-test-openai-token" });
  stubFetch((url) => (url.endsWith("/models")
    ? jsonResponse({ error: { message: "Invalid API Key", code: "invalid_api_key" } }, 401)
    : jsonResponse({}, 404)));
  const r = await ai.providerHealth("openai");
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.hint, undefined);
});
