// Item 11 (second half) — automatic memory-writing: after a run completes, the engine
// itself judges (one AI pass) whether the outcome contains a durable household fact and
// writes it to memory WITHOUT the plan having scripted a homeops.write_memory step.
// Deduped, fire-and-forget, audited.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult, fakeProvider;
const MEMORY_TEXT = "The family does taco night on Wednesdays";

before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan");
  // The judge parses {"remember", "text", "type"}; a reasoning step parses {"text"} —
  // this single response satisfies both call sites deterministically.
  fakeProvider = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { content: JSON.stringify({ remember: true, text: MEMORY_TEXT, type: "routine" }) } }) + "\n");
    });
  });
  await new Promise((resolve) => fakeProvider.listen(0, resolve));
  const port = fakeProvider.address().port;
  await adult.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "test-model" }) });
  await adult.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });
});
after(async () => { await stopServer(ctx); await new Promise((r) => fakeProvider.close(r)); });

async function runAndWait(plan) {
  const r = await adult.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "manual", plan }) });
  const id = r.data.run.id;
  const t0 = Date.now();
  for (;;) {
    const run = (await adult.req(`/api/runs/${id}`)).data.run;
    if (["completed", "failed", "cancelled", "expired"].includes(run.status) || Date.now() - t0 > 8000) return run;
    await new Promise((res) => setTimeout(res, 150));
  }
}
async function waitForMemory(text, timeoutMs = 6000) {
  const t0 = Date.now();
  for (;;) {
    const mem = (await adult.req("/api/memory")).data.memory;
    const hit = mem.filter((m) => m.text === text);
    if (hit.length || Date.now() - t0 > timeoutMs) return { all: mem, hits: hit };
    await new Promise((res) => setTimeout(res, 200));
  }
}

const PLAN = { title: "Plan the week's meals", steps: [{ toolId: null, title: "Look at meal history", detail: "Notice recurring patterns", input: {} }] };

test("a completed run auto-writes a durable memory the plan never scripted", async () => {
  const run = await runAndWait(PLAN);
  assert.equal(run.status, "completed");
  assert.ok(!run.steps.some((s) => s.toolId === "homeops.write_memory"), "the plan has NO write_memory step");
  const { hits } = await waitForMemory(MEMORY_TEXT);
  assert.equal(hits.length, 1, "the auto-captured memory exists");
  assert.equal(hits[0].type, "routine");
  assert.equal(hits[0].scope, "household");
  assert.equal(hits[0].source?.via, "auto", "provenance marks it as auto-captured");
  assert.equal(hits[0].source?.runId, run.id, "linked back to the originating run");
});

test("re-running the same conclusion does not duplicate the memory (dedupe)", async () => {
  const run = await runAndWait(PLAN);
  assert.equal(run.status, "completed");
  await new Promise((r) => setTimeout(r, 1200)); // give the fire-and-forget pass time
  const mem = (await adult.req("/api/memory")).data.memory.filter((m) => m.text === MEMORY_TEXT);
  assert.equal(mem.length, 1, "identical memory text is never written twice");
});
