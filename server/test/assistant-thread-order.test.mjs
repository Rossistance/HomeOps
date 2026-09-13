// LEGACY ENGINE: this suite pins the previous single-shot assistant brain (JSON envelope
// answer|lookup|plan|build). The default Ask Famili engine is now the AI SDK agent loop
// (server/assistant-agent.mjs, server/test/assistant-agent.test.mjs); every server here is
// spawned with HOMEOPS_ASSISTANT_ENGINE=legacy so the rollback path stays proven.
// WP-003 slice 4 (ISS-005/009/011/016 — "one run world") — THREAD ORDER.
//
// Bug: POST /api/assistant/stream started the plan's run (runAssistantPlan → engine
// startRun) and only THEN persisted the user's own turn + the assistant's "plan" reply
// (see server/index.mjs, the streaming route). startRun's execution is NOT awaited —
// driveRun runs in the background (server/engine.mjs) — and a fast, real, no-approval
// step (e.g. homeops.write_memory) can finish and fire onRunFinished (server/
// assistant-runs.mjs), which appends a run_result message to the SAME conversation,
// before this request handler ever got around to recording what the user asked. A
// refresh (or a second device) then read the durable array in that wrong order: the
// run's own reaction appearing ABOVE the question that caused it.
//
// Fix (chosen over sorting messages by `at` at render time — see rationale in the
// index.mjs comment at the turn-persistence region): persist the user's turn FIRST,
// before the run is ever started, so its position in the durable array is never at the
// mercy of how fast the background run happens to resolve. Sorting by `at` was rejected
// because the racing message's timestamp is genuinely captured EARLIER in wall-clock
// terms than the user turn's (which used to be stamped only after the run had already
// returned) — no client-side sort can un-invert a timestamp that was recorded too late.
//
// No AI provider is real: a local scripted HTTP server stands in for Ollama (same
// pattern as chat-agent-attribution.test.mjs), so the "assistant" deterministically
// returns a plan with one fast, real, non-approval step — no network, no LLM.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, fakeProvider;

function fastPlan(suffix) {
  return {
    title: `TG-thread-order ${suffix}`, summary: "one fast, real, no-approval step",
    icon: "Bot", spaceType: "Personal", instructions: "", trigger: { type: "Manual", detail: "" },
    steps: [
      { toolId: "homeops.write_memory", title: "Remember", detail: "", input: { text: `TG thread-order fact ${suffix}`, scope: "household" }, requiresApproval: false },
    ],
    approvalGates: [], risk: "Low",
  };
}

before(async () => {
  ctx = await startServer({ env: { HOMEOPS_ASSISTANT_ENGINE: "legacy" } });
  owner = await makeSession(ctx, "m-alex");
  fakeProvider = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/api/tags") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ models: [{ name: "tg-fake" }] })); return; }
      let messages = [];
      try { messages = JSON.parse(body).messages ?? []; } catch { /* ignore */ }
      const sys = String(messages?.[0]?.content ?? "");
      const reply = sys.includes("You are FamiliOS, a warm, capable assistant")
        ? JSON.stringify({ kind: "plan", answer: "On it — doing it now.", plan: fastPlan(Date.now()) })
        : JSON.stringify({ kind: "answer", answer: "ok" });
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { content: reply } }) + "\n");
    });
  });
  await new Promise((resolve) => fakeProvider.listen(0, resolve));
  const port = fakeProvider.address().port;
  await owner.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "tg-fake" }) });
  await owner.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });
});
after(async () => { await stopServer(ctx); await new Promise((r) => fakeProvider.close(r)); });

async function newConversation(title) {
  const r = await owner.req("/api/conversations", { method: "POST", body: JSON.stringify({ title }) });
  return r.data.conversation;
}
async function messagesOf(id) {
  const r = await owner.req(`/api/conversations/${id}`);
  return r.data.conversation?.messages ?? [];
}
const waitFor = async (fn, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 100));
  }
};

test("the user's own turn is always FIRST in a run-triggering chat thread, no matter how fast the run resolves", async () => {
  const conv = await newConversation("thread order");
  const message = "TG: remember this quickly";

  const streamRes = await ctx.fetch("/api/assistant/stream", {
    method: "POST",
    headers: { Cookie: owner.cookie, "x-homeops-csrf": owner.csrf, "content-type": "application/json" },
    body: JSON.stringify({ message, conversationId: conv.id }),
  });
  assert.equal(streamRes.status, 200);
  const text = await streamRes.text();
  const doneLine = text.split("\n").reverse().find((l) => l.startsWith("data: ") && l.includes('"type":"done"'));
  assert.ok(doneLine, "stream produced a done event");
  const result = JSON.parse(doneLine.slice(6)).result;
  assert.equal(result.ok, true);
  assert.ok(result.run?.id, "the plan auto-started a run");

  // Immediately after the request completes — the tightest possible window for the
  // background run to have raced ahead of this handler's own persistence — the user's
  // question must already be msgs[0]. This is the exact invariant the fix guarantees.
  const right_after = await messagesOf(conv.id);
  assert.ok(right_after.length >= 1, "at least the user turn landed");
  assert.equal(right_after[0].role, "user");
  assert.equal(right_after[0].text, message);

  // Once the run finishes and its result lands (server/assistant-runs.mjs onRunFinished),
  // the run_result must appear AFTER the user's turn — never displace it from the top.
  const withResult = await waitFor(async () => {
    const msgs = await messagesOf(conv.id);
    return msgs.some((m) => m.kind === "run_result") ? msgs : null;
  });
  assert.equal(withResult[0].role, "user", "the user turn stays first even after the run's own reaction lands");
  const userIdx = withResult.findIndex((m) => m.role === "user");
  const resultIdx = withResult.findIndex((m) => m.kind === "run_result");
  assert.ok(userIdx < resultIdx, "the run_result must land after the question that caused it, never before");
});
