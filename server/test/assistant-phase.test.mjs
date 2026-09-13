// LEGACY ENGINE: this suite pins the previous single-shot assistant brain (JSON envelope
// answer|lookup|plan|build). The default Ask Famili engine is now the AI SDK agent loop
// (server/assistant-agent.mjs, server/test/assistant-agent.test.mjs); every server here is
// spawned with HOMEOPS_ASSISTANT_ENGINE=legacy so the rollback path stays proven.
// Saying what it's actually doing.
//
// The working bubble had two states and inferred both from token flow: tokens arriving meant
// "Writing…". For a plain answer that's true. For a LOOKUP it was false during the slowest
// part of the whole interaction — performLookup goes out to the live web and emits no tokens
// while it does, so the app claimed to be writing for as long as the fetch took. Watching
// "Writing…" for eight seconds with nothing appearing is how a working app looks broken.
//
// The old code announced the lookup by calling onToken("") — a FAKE token whose only purpose
// was to trip the client's inference. That is the same defect this codebase keeps producing:
// a progress signal that doesn't come from the thing it claims to describe.
//
// These tests pin the phase to the decision that causes it, through the real HTTP stream,
// because that is the only place a broken wire would show.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult, provider;
/* What the fake provider will answer with next — set per test. */
let nextReply = "";

before(async () => {
  ctx = await startServer({ env: { HOMEOPS_ASSISTANT_ENGINE: "legacy" } });
  adult = await makeSession(ctx, "m-morgan");
  provider = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { content: nextReply } }) + "\n");
    });
  });
  await new Promise((r) => provider.listen(0, r));
  const port = provider.address().port;
  await adult.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "t" }) });
  await adult.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });
});
after(async () => { await stopServer(ctx); await new Promise((r) => provider.close(r)); });

/** Send a message and collect every SSE frame the server emits, in order. */
async function streamFrames(message) {
  const res = await adult.text("/api/assistant/stream", {
    method: "POST",
    headers: { accept: "text/event-stream" },
    body: JSON.stringify({ message }),
  });
  const text = res.text;
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* partial frame */ }
  }
  return events;
}

test("THE REPORTED CASE: a web lookup announces that it is searching", async () => {
  nextReply = JSON.stringify({ kind: "lookup", query: "hardware stores near me" });
  const events = await streamFrames("what hardware stores are near us?");
  const phases = events.filter((e) => e.type === "phase").map((e) => e.phase);
  assert.ok(phases.includes("searching"),
    `the client cannot show "Searching the web" if the server never says it — got ${JSON.stringify(events.map((e) => e.type))}`);
});

test("…and it says so BEFORE the fetch, not after", async () => {
  // Announced afterwards it would be useless: the whole point is to cover the wait.
  nextReply = JSON.stringify({ kind: "lookup", query: "anything" });
  const events = await streamFrames("look something up");
  const phaseAt = events.findIndex((e) => e.type === "phase" && e.phase === "searching");
  const doneAt = events.findIndex((e) => e.type === "done");
  assert.ok(phaseAt !== -1 && doneAt !== -1 && phaseAt < doneAt,
    "the phase has to arrive while the user is still waiting");
});

test("a plan says it is creating, not searching", async () => {
  nextReply = JSON.stringify({
    kind: "plan", answer: "On it.",
    plan: { summary: "Add soccer to the calendar", steps: [{ toolId: "calendar.create_event", input: { title: "Soccer" } }] },
  });
  const events = await streamFrames("put soccer on the calendar at 4");
  const phases = events.filter((e) => e.type === "phase").map((e) => e.phase);
  assert.ok(phases.includes("creating"), "a plan is being set up, not looked up");
  assert.ok(!phases.includes("searching"), "nothing was searched");
});

test("a plain answer announces no phase at all — it is just written", async () => {
  // Silence is correct here. An answer streams tokens, the client infers "Writing…", and a
  // phase event would be a claim about work that isn't happening.
  nextReply = JSON.stringify({ kind: "answer", answer: "Soccer is at 4:15 on Tuesday." });
  const events = await streamFrames("when is soccer?");
  // The one exception is the honest pre-model "thinking" frame, emitted before the first
  // round-trip so the client has something truthful for the slowest seconds of the turn.
  const phases = events.filter((e) => e.type === "phase").map((e) => e.phase);
  assert.deepEqual(phases.filter((p) => p !== "thinking"), []);
  assert.ok(events.some((e) => e.type === "done"), "…but it still completes normally");
});

test("the phase never replaces the done event", async () => {
  // A client that only understands "done" must be unaffected by any of this.
  nextReply = JSON.stringify({ kind: "lookup", query: "x" });
  const events = await streamFrames("look up x");
  const done = events.find((e) => e.type === "done");
  assert.ok(done?.result, "the parsed result still arrives, in the same shape as before");
});

test("a broken phase reporter cannot take the answer down with it", async () => {
  // onPhase is wrapped in try/catch in planner.mjs on purpose: progress reporting is a
  // courtesy and must never be able to fail a real request. Asserted on the source because
  // provoking a write failure mid-stream is not reproducible from out here.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../planner.mjs", import.meta.url), "utf8");
  assert.match(src, /const phase = \(p\) => \{ try \{ onPhase\?\.\(p\); \} catch/,
    "phase reporting must be swallowed, never thrown");
});
