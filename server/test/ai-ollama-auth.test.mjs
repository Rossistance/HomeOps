// Follow-up to ISS-006 / WP-007 — Ollama bearer support. Ollama's cloud API
// (ollama.com/api, keys at ollama.com/settings/keys) and auth-protected remote/proxied
// Ollama deployments authenticate with `Authorization: Bearer <key>`; a bare local
// Ollama has no auth and ignores the header. Before this change the ollama-style
// branches in ../ai.mjs never attached the header, so a stored key would have been
// silently ignored — the dishonest-UI failure mode keyOptional exists to prevent.
// This file pins the header-injection contract on all three ollama paths (model
// discovery, chat, streaming chat) plus the 401 → ollama.com-specific hint. Upstream
// fetch is stubbed for determinism — no real network calls.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

// Isolated store BEFORE the first ../store.mjs import — same pattern as
// server/test/ai-lmstudio-auth.test.mjs.
const DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-ai-ollama-"));
process.env.HOMEOPS_DATA_DIR = DATA_DIR;
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";

const ai = await import("../ai.mjs");

after(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

// ---- Hermetic fetch stub ----
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
// Ollama's chat endpoints answer NDJSON when streaming — one JSON object per line.
function ndjsonResponse(lines, status = 200) {
  return new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", { status, headers: { "content-type": "application/x-ndjson" } });
}

// ---- needsKey:false must still mean "works unauthenticated" ----

test("ollama metadata: needsKey stays false, keyOptional is true", () => {
  const p = ai.aiProviderById("ollama");
  assert.equal(p.needsKey, false);
  assert.equal(p.keyOptional, true);
  const pub = ai.publicProvider(p);
  assert.equal(pub.needsKey, false);
  assert.equal(pub.keyOptional, true);
});

test("no key stored: model discovery (/api/tags) sends NO Authorization header", async () => {
  assert.equal(ai.publicProvider(ai.aiProviderById("ollama")).keySet, false, "precondition: no key stored yet");
  stubFetch((url) => (url.endsWith("/api/tags") ? jsonResponse({ models: [{ name: "llama3" }] }) : jsonResponse({}, 404)));
  const r = await ai.providerHealth("ollama");
  assert.equal(r.ok, true, JSON.stringify(r));
  const req = lastRequestTo("/api/tags");
  assert.ok(req, "expected an /api/tags request");
  assert.equal(req.headers.authorization, undefined, "no key stored → no Authorization header");
});

test("no key stored: providerChat (/api/chat) sends NO Authorization header", async () => {
  stubFetch((url) => (url.endsWith("/api/chat")
    ? jsonResponse({ message: { content: "hi" }, done: true })
    : jsonResponse({ models: [{ name: "llama3" }] })));
  const r = await ai.providerChat("ollama", { messages: [{ role: "user", content: "hello" }], model: "llama3" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const req = lastRequestTo("/api/chat");
  assert.ok(req, "expected an /api/chat request");
  assert.equal(req.headers.authorization, undefined, "no key stored → no Authorization header on chat either");
});

test("no key stored: providerChatStream (/api/chat) sends NO Authorization header", async () => {
  stubFetch((url) => (url.endsWith("/api/chat")
    ? ndjsonResponse([{ message: { content: "hi" }, done: false }, { message: { content: "!" }, done: true }])
    : jsonResponse({ models: [{ name: "llama3" }] })));
  const r = await ai.providerChatStream("ollama", { messages: [{ role: "user", content: "hello" }], model: "llama3" }, () => {});
  assert.equal(r.ok, true, JSON.stringify(r));
  const req = lastRequestTo("/api/chat");
  assert.ok(req, "expected a streaming /api/chat request");
  assert.equal(req.headers.authorization, undefined, "no key stored → no Authorization header on the stream call");
});

// ---- Once a key is stored (Settings → keyOptional field → config POST), it must ride along ----

test("storing a key via setProviderConfig lands in the vault (same path the config POST route uses)", () => {
  const saved = ai.setProviderConfig("ollama", { apiKey: "ok-test-ollama-key" });
  assert.equal(saved.keySet, true);
});

test("key stored: model discovery (/api/tags) sends Authorization: Bearer <key>", async () => {
  stubFetch((url) => (url.endsWith("/api/tags") ? jsonResponse({ models: [{ name: "llama3" }] }) : jsonResponse({}, 404)));
  const r = await ai.providerHealth("ollama");
  assert.equal(r.ok, true, JSON.stringify(r));
  const req = lastRequestTo("/api/tags");
  assert.ok(req);
  assert.equal(req.headers.authorization, "Bearer ok-test-ollama-key");
});

test("key stored: providerChat (/api/chat) sends Authorization: Bearer <key>", async () => {
  stubFetch((url) => (url.endsWith("/api/chat")
    ? jsonResponse({ message: { content: "hi" }, done: true })
    : jsonResponse({ models: [{ name: "llama3" }] })));
  const r = await ai.providerChat("ollama", { messages: [{ role: "user", content: "hello" }], model: "llama3" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const req = lastRequestTo("/api/chat");
  assert.ok(req);
  assert.equal(req.headers.authorization, "Bearer ok-test-ollama-key");
});

test("key stored: providerChatStream (/api/chat) sends Authorization: Bearer <key>", async () => {
  stubFetch((url) => (url.endsWith("/api/chat")
    ? ndjsonResponse([{ message: { content: "hi" }, done: true }])
    : jsonResponse({ models: [{ name: "llama3" }] })));
  const r = await ai.providerChatStream("ollama", { messages: [{ role: "user", content: "hello" }], model: "llama3" }, () => {});
  assert.equal(r.ok, true, JSON.stringify(r));
  const req = lastRequestTo("/api/chat");
  assert.ok(req);
  assert.equal(req.headers.authorization, "Bearer ok-test-ollama-key");
});

// ---- 401 must surface Ollama's own hint (keys come from ollama.com, not a local menu) ----

test("a 401 response surfaces the ollama.com-specific key hint, not the LM-Studio wording", async () => {
  stubFetch((url) => (url.endsWith("/api/tags")
    ? jsonResponse({ error: "unauthorized" }, 401)
    : jsonResponse({}, 404)));
  const r = await ai.providerHealth("ollama");
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.ok(r.hint, "expected an actionable hint on a 401 response");
  assert.match(r.hint, /ollama\.com\/settings\/keys/);
  assert.doesNotMatch(r.hint, /Developer → API token/, "the generated LM-Studio-style wording must not leak onto Ollama");
});
