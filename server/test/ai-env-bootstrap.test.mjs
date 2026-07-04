// AI ENV BOOTSTRAP — a hosted deployment hands keys via env vars; the server
// configures + activates the provider at startup WITHOUT overwriting anything a
// person set up in Settings. Model comes from HOMEOPS_AI_MODEL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

test("OPENAI_API_KEY + HOMEOPS_AI_MODEL bootstrap the provider as active with the model set", async () => {
  const ctx = await startServer({ env: { OPENAI_API_KEY: "sk-test-not-a-real-key", HOMEOPS_AI_MODEL: "gpt-5.5" } });
  try {
    const adult = await makeSession(ctx, "m-morgan");
    const r = await adult.req("/api/ai/providers");
    assert.equal(r.status, 200);
    const openai = (r.data.providers ?? []).find((p) => p.id === "openai");
    assert.ok(openai, "openai provider listed");
    assert.equal(openai.keySet, true, "key landed in the vault from env");
    assert.equal(openai.model, "gpt-5.5", "model honored from HOMEOPS_AI_MODEL");
    assert.equal(openai.active, true, "bootstrapped provider becomes the active one");
  } finally { await stopServer(ctx); }
});

test("no env keys → nothing bootstrapped (dev default unchanged)", async () => {
  const ctx = await startServer();
  try {
    const adult = await makeSession(ctx, "m-morgan");
    const r = await adult.req("/api/ai/providers");
    const openai = (r.data.providers ?? []).find((p) => p.id === "openai");
    assert.equal(openai.keySet, false);
  } finally { await stopServer(ctx); }
});
