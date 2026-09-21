/* "0 models" is not the same answer as "no models", and the UI cannot tell them apart.
 *
 * providerModels' openai-style branch read `json.data` and nothing else, on the reasonable
 * assumption that anything calling itself OpenAI-compatible answers the way OpenAI does.
 * Together AI answers `GET /v1/models` with a BARE ARRAY.
 *
 * So a correct key, a reachable host and an HTTP 200 produced `{ ok: true, models: [] }` —
 * which in AI Providers renders as an empty picker, indistinguishable from a provider that
 * is down or unconfigured. The failure was silent in the worst direction: everything
 * reported success and the feature that depends on it could not be set up.
 *
 * Both shapes are pinned here, along with the two failure modes that must NOT be mistaken
 * for an empty catalog, because the whole point is that those three outcomes look different.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-modelshapes-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { providerModels, setProviderConfig } = await import("../ai.mjs");
const { runWithTenant } = await import("../store.mjs");

/** Whatever the next request should get back. */
let reply = { status: 200, body: {} };
let server, port;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});
after(() => { try { server.close(); } catch { /* best effort */ } });

/* Driven through LM STUDIO rather than Together, and the reason is itself worth knowing:
 * getJSON refuses a loopback URL for a non-local provider (loopback_blocked, the SSRF guard
 * that protects cloud provider configs). That guard is correct and is not weakened for a
 * test. Both providers share the one openai-style branch in providerModels — the same lines
 * that parsed Together's answer — so pointing the local one at a stub exercises exactly the
 * code under test. */
async function modelsFrom(body, status = 200) {
  reply = { status, body };
  return await runWithTenant("local", async () => {
    setProviderConfig("lmstudio", { baseUrl: `http://127.0.0.1:${port}/v1` });
    return await providerModels("lmstudio");
  });
}

test("OPENAI'S SHAPE: { data: [...] } still works", async () => {
  const r = await modelsFrom({ data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.models, ["gpt-4o-mini", "gpt-4o"], JSON.stringify(r));
});

test("TOGETHER'S SHAPE: a bare array is a catalog, not an empty one", async () => {
  /* The regression. Before the fix this returned ok:true with zero models, and the only
   * way to tell it from a dead provider was to read the code. */
  const r = await modelsFrom([
    { id: "meta-llama/Llama-3.1-8B-Instruct-Turbo" },
    { id: "zai-org/GLM-5.3-Flash" },
  ]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.models.length, 2, `a bare array is parsed, not silently dropped: ${JSON.stringify(r)}`);
  assert.deepEqual(r.models, ["meta-llama/Llama-3.1-8B-Instruct-Turbo", "zai-org/GLM-5.3-Flash"], JSON.stringify(r));
});

test("compatibles that label it `name`, and plain strings, both survive", async () => {
  assert.deepEqual((await modelsFrom([{ name: "some-model" }])).models, ["some-model"]);
  assert.deepEqual((await modelsFrom(["bare-string-model"])).models, ["bare-string-model"]);
  // A row with neither is dropped rather than turned into undefined entries in a <select>.
  assert.deepEqual((await modelsFrom([{ id: "keep" }, { nothing: true }])).models, ["keep"]);
});

test("AN EMPTY CATALOG AND A FAILURE MUST NOT LOOK ALIKE", async () => {
  /* The three outcomes the UI has to distinguish. This is the assertion that would have
     caught the original bug: "ok with zero" has to mean the provider really said zero. */
  const empty = await modelsFrom({ data: [] });
  assert.equal(empty.ok, true, "a genuinely empty catalog is a success with nothing in it");
  assert.deepEqual(empty.models, []);

  const refused = await modelsFrom({ error: { message: "Invalid API key" } }, 401);
  assert.equal(refused.ok, false, `a bad key is an ERROR, never an empty list: ${JSON.stringify(refused)}`);
  assert.equal(refused.status, 401, JSON.stringify(refused));
  assert.match(refused.message ?? "", /Invalid API key/, "and it says what the provider said");
});
