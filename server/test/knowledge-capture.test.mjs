// Item 15 — knowledge capture: a completed run whose reasoning produced a real written
// result is saved as a durable `run_summary` artifact (findable in Files & Knowledge),
// unless the plan already wrote its own artifact (no duplicates). Uses the same fake
// Ollama NDJSON server as assistant-persistence.test.mjs so reasoning steps get real text.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult, fakeProvider;
const LONG_TEXT = "Family briefing: the week ahead has three school events, two bills due Friday, and a dentist appointment for Noah on Thursday at 3pm. Grocery run needed before Wednesday taco night. All caught up on approvals.";

before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan");
  fakeProvider = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      // Reasoning steps parse {text, data} JSON loosely — return the shape they expect.
      res.end(JSON.stringify({ message: { content: JSON.stringify({ text: LONG_TEXT, data: null }) } }) + "\n");
    });
  });
  await new Promise((resolve) => fakeProvider.listen(0, resolve));
  const port = fakeProvider.address().port;
  await adult.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "test-model" }) });
  await adult.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });
});
after(async () => { await stopServer(ctx); await new Promise((r) => fakeProvider.close(r)); });

// Runs drive asynchronously after /api/runs/start returns — poll until terminal.
async function waitForRun(id, timeoutMs = 8000) {
  const t0 = Date.now();
  for (;;) {
    const run = (await adult.req(`/api/runs/${id}`)).data.run;
    if (["completed", "failed", "cancelled", "expired"].includes(run.status)) return run;
    if (Date.now() - t0 > timeoutMs) return run;
    await new Promise((r) => setTimeout(r, 150));
  }
}

test("a completed run with substantive reasoning output is captured as a run_summary artifact", async () => {
  const r = await adult.req("/api/runs/start", {
    method: "POST",
    body: JSON.stringify({ source: "manual", plan: { title: "Weekly family briefing", steps: [{ toolId: null, title: "Draft the briefing", detail: "Summarize the week", input: {} }] } }),
  });
  assert.equal(r.status, 200);
  const run = await waitForRun(r.data.run.id);
  assert.equal(run.status, "completed");
  const arts = (await adult.req(`/api/artifacts?runId=${run.id}`)).data.artifacts;
  const captured = arts.find((a) => a.kind === "run_summary");
  assert.ok(captured, "run_summary artifact captured on completion");
  assert.equal(captured.title, "Weekly family briefing");
  assert.ok(captured.body.includes("dentist appointment"), "artifact carries the real reasoning text");
});

test("a run that wrote its OWN artifact is not double-captured", async () => {
  const r = await adult.req("/api/runs/start", {
    method: "POST",
    body: JSON.stringify({ source: "manual", plan: { title: "Self-writing run", steps: [
      { toolId: null, title: "Reason", detail: "Think about it", input: {} },
      { toolId: "homeops.create_artifact", title: "Write it", input: { title: "My own report", body: "Explicitly written by the plan.", kind: "report" } },
    ] } }),
  });
  const run = await waitForRun(r.data.run.id);
  assert.equal(run.status, "completed");
  const arts = (await adult.req(`/api/artifacts?runId=${run.id}`)).data.artifacts;
  assert.equal(arts.filter((a) => a.kind === "run_summary").length, 0, "no auto-capture when the plan wrote its own");
  assert.equal(arts.filter((a) => a.kind === "report").length, 1, "the plan's own artifact stands alone");
});

test("trivial reasoning output (short text) is NOT captured — no noise", async () => {
  // Point the model at a short reply for this test by using a run whose single step is
  // a TOOL step (no reasoning text at all) — completion must not create an artifact.
  const r = await adult.req("/api/runs/start", {
    method: "POST",
    body: JSON.stringify({ source: "manual", plan: { title: "Tool-only run", steps: [{ toolId: "homeops.write_memory", title: "Note", input: { text: "short note", scope: "household" } }] } }),
  });
  const run = await waitForRun(r.data.run.id);
  assert.equal(run.status, "completed");
  const arts = (await adult.req(`/api/artifacts?runId=${run.id}`)).data.artifacts;
  assert.equal(arts.length, 0, "no artifact for a run with no substantive reasoning text");
});
