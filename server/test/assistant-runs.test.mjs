// C-intel: conversation-born runs report back to their thread, and failures
// enter the one-shot self-repair path. Tested WITHOUT an AI provider: the
// result-append and the save-as-helper offer are deterministic; the repair
// LLM pass degrades honestly (no provider → the failure message still lands).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
});
after(async () => { await stopServer(ctx); });

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
    await new Promise((r) => setTimeout(r, 150));
  }
};

test("a completed conversation run appends its result to the thread — no Activity hunting", async () => {
  const conv = await newConversation("result thread");
  const plan = { title: "Remember a fact", summary: "write one memory", steps: [{ toolId: "homeops.write_memory", title: "Remember", input: { text: "The dog's vet is Dr. Paws", scope: "household" } }] };
  const started = await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "assistant", sourceRef: { conversationId: conv.id, via: "chat" }, plan }) });
  assert.equal(started.status, 200);
  const result = await waitFor(async () => (await messagesOf(conv.id)).find((m) => m.kind === "run_result"));
  assert.equal(result.status, "completed");
  assert.match(result.text, /Done — "Remember a fact"/);
  assert.equal(result.runId, started.data.run.id);
});

test("a failed conversation run reports the failure inline (repair degrades honestly with no AI provider)", async () => {
  const conv = await newConversation("failure thread");
  const plan = { title: "Doomed run", summary: "uses a tool that does not exist", steps: [{ toolId: "nope.not_a_tool", title: "Impossible step", input: {} }] };
  await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "assistant", sourceRef: { conversationId: conv.id, via: "chat" }, plan }) });
  const result = await waitFor(async () => (await messagesOf(conv.id)).find((m) => m.kind === "run_result"));
  assert.equal(result.status, "failed");
  assert.match(result.text, /failed at step 1/);
  // No provider configured → the repair pass exits without promising anything it
  // can't do: no "executing improvements" message, and no phantom second run.
  const msgs = await messagesOf(conv.id);
  assert.ok(!msgs.some((m) => /improved plan/i.test(m.text ?? "")), "no repair promise without a provider to repair with");
});

test("a successful REPAIR run offers to save the working plan as a helper, inline", async () => {
  const conv = await newConversation("repair success thread");
  const plan = { title: "News digest", summary: "verified after repair", steps: [{ toolId: "homeops.write_memory", title: "Note the preference", input: { text: "Family likes morning news digests", scope: "household" } }] };
  await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "assistant", sourceRef: { conversationId: conv.id, isRepair: true, repairedFrom: "run_original" }, plan }) });
  const offer = await waitFor(async () => (await messagesOf(conv.id)).find((m) => m.kind === "build"));
  assert.match(offer.text, /worked/i);
  assert.equal(offer.build.skill.name, "News digest");
  assert.equal(offer.build.skill.steps[0].tool_id, "homeops.write_memory");
  // And the run_result landed too, before the offer.
  const msgs = await messagesOf(conv.id);
  assert.ok(msgs.findIndex((m) => m.kind === "run_result") < msgs.findIndex((m) => m.kind === "build"));
});

test("runs WITHOUT a conversation stay out of chat threads entirely", async () => {
  const conv = await newConversation("unrelated thread");
  const plan = { title: "Background thing", summary: "", steps: [{ toolId: "homeops.write_memory", title: "note", input: { text: "background note", scope: "household" } }] };
  await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "manual", plan }) });
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal((await messagesOf(conv.id)).length, 0, "no cross-talk into unrelated conversations");
});
