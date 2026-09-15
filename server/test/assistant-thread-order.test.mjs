// THREAD ORDER (ISS-005/009/011/016 — "one run world").
//
// Bug: the streaming assistant route started the turn's durable run and only THEN persisted
// the user's own message. A run's execution is not awaited — it proceeds in the background
// — so a fast step could finish and fire onRunFinished (server/assistant-runs.mjs), which
// appends a run_result to the SAME conversation, before the handler had recorded what the
// user asked. A refresh, or a second device, then read the durable array in that wrong
// order: the run's reaction sitting ABOVE the question that caused it.
//
// Fix (chosen over sorting by `at` at render time): persist the user's turn FIRST, before
// any run is started, so its position is never at the mercy of how fast a background run
// resolves. Sorting was rejected because the racing message's timestamp is genuinely
// captured earlier in wall-clock terms — no client-side sort can un-invert a timestamp
// that was recorded too late.
//
// Under the agent engine a durable run is created for exactly one reason: a tool the policy
// says a person must approve. So that is what this drives — the approval parks the run, the
// test approves it, and the resulting run_result must land after the question.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { useFakeModel } from "./fake-model.mjs";

let ctx, owner, fake;

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
  fake = await useFakeModel(owner);
});
after(async () => { await stopServer(ctx); await new Promise((r) => fake.server.close(r)); });

const messagesOf = async (id) => (await owner.req(`/api/conversations/${id}`)).data.conversation?.messages ?? [];

const waitFor = async (fn, ms = 10000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 100));
  }
};

test("the user's own turn is always FIRST in a run-triggering chat thread, no matter how fast the run resolves", async () => {
  const conv = (await owner.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "thread order" }) })).data.conversation;
  const message = "ask everyone to sign off on the meal plan";
  fake.state.script = [
    { toolCalls: [{ name: "homeops__create_approval", args: { subject: "Sign off on the meal plan", detail: "Tacos Tue, Chili Wed" } }] },
    { text: "Queued for your approval — nothing has gone out yet." },
  ];

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
  const runId = result.run?.id ?? result.runId;
  assert.ok(runId, "the approval-gated step became a durable run");

  // Immediately after the request completes — the tightest possible window for the
  // background run to have raced ahead of this handler's own persistence — the user's
  // question must already be msgs[0]. This is the exact invariant the fix guarantees.
  const rightAfter = await messagesOf(conv.id);
  assert.ok(rightAfter.length >= 1, "at least the user turn landed");
  assert.equal(rightAfter[0].role, "user");
  assert.equal(rightAfter[0].text, message);

  // Approve it, so the run reaches a terminal state and posts its own reaction back.
  const pending = await waitFor(async () => {
    const r = await owner.req("/api/approvals");
    return (r.data.approvals ?? []).find((a) => a.status === "pending" && a.toolId === "homeops.create_approval") ?? null;
  });
  const decided = await owner.req(`/api/approvals/${pending.id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approved" }) });
  assert.equal(decided.status, 200, JSON.stringify(decided.data));

  const withResult = await waitFor(async () => {
    const msgs = await messagesOf(conv.id);
    return msgs.some((m) => m.kind === "run_result") ? msgs : null;
  });
  assert.equal(withResult[0].role, "user", "the user turn stays first even after the run's own reaction lands");
  const userIdx = withResult.findIndex((m) => m.role === "user");
  const resultIdx = withResult.findIndex((m) => m.kind === "run_result");
  assert.ok(userIdx < resultIdx, "the run_result must land after the question that caused it, never before");
});
