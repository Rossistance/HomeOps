// Item 13 — function auto-drafting. POST /api/functions/draft returns a candidate
// function definition (shape only — nothing is created, no secrets) for the human to
// review in the Function Builder. With no AI provider it still returns a usable skeleton
// so the builder opens pre-filled rather than blank. With a provider, it fills the shape.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, admin, child;
before(async () => {
  ctx = await startServer();
  admin = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");   // Child View
});
after(async () => { await stopServer(ctx); });

test("a child cannot draft a function (Adult Admin only)", async () => {
  const r = await child.req("/api/functions/draft", { method: "POST", body: JSON.stringify({ description: "look up a package tracking number" }) });
  assert.equal(r.status, 403);
});

test("an empty description is rejected", async () => {
  const r = await admin.req("/api/functions/draft", { method: "POST", body: JSON.stringify({ description: "  " }) });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "description_required");
});

test("with no AI provider, draft returns a usable skeleton (never blank), and creates nothing", async () => {
  const before = (await admin.req("/api/functions")).data.functions.length;
  const r = await admin.req("/api/functions/draft", { method: "POST", body: JSON.stringify({ description: "Fetch the current price of a stock ticker" }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.fallback, true, "no provider → skeleton fallback");
  assert.ok(r.data.draft.name, "skeleton has a name");
  assert.ok(Array.isArray(r.data.draft.input_schema), "skeleton has an input schema");
  assert.ok(["connector_api", "internal", "custom_http", "ai_local", "browser", "sandbox_script", "workflow_composed"].includes(r.data.draft.type));
  const after = (await admin.req("/api/functions")).data.functions.length;
  assert.equal(after, before, "drafting created nothing — it's a shape only");
});

test("with a provider, draft fills the shape from the model (clamped to valid enums)", async () => {
  const fake = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { content: JSON.stringify({
        name: "Track a package", description: "Look up carrier tracking status",
        type: "custom_http", action: "Read", risk: "Low", approval_required: false,
        input_schema: [{ key: "trackingNumber", label: "Tracking #", type: "text", required: true }],
        output_schema: [{ key: "status", label: "Status", type: "text" }],
      }) } }) + "\n");
    });
  });
  await new Promise((r) => fake.listen(0, r));
  const port = fake.address().port;
  await admin.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "m" }) });
  await admin.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });

  const r = await admin.req("/api/functions/draft", { method: "POST", body: JSON.stringify({ description: "track a package" }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.fallback ?? false, false, "a provider filled the draft");
  assert.equal(r.data.draft.name, "Track a package");
  assert.equal(r.data.draft.action, "Read");
  assert.equal(r.data.draft.input_schema[0].key, "trackingNumber");
  await new Promise((r2) => fake.close(r2));
});
