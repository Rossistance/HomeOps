// FamiliOS — Ask Famili on the AI SDK ToolLoopAgent (server/assistant-agent.mjs).
//
// The previous brain made one model call that emitted a JSON envelope (answer | lookup |
// plan | build) and a "plan" was a static step list the engine executed later without the
// model ever seeing a result. The agent engine is a real tool loop: the model calls a tool,
// the REAL result goes back to it, and it decides what to do next. These tests drive that
// loop through the real HTTP server against a scripted OpenAI-compatible model server (the
// LM Studio provider shape) that speaks the chat-completions tool-calling protocol, so the
// wire between the SDK, the app's tools and the durable run engine is what is under test.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession, readStoreDoc, writeStoreDoc } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- a scripted OpenAI-compatible model server --------------------------------------
 * `script` is a queue of turns; each request pops one: { toolCalls: [{ name, args }] } or
 * { text }. Streaming and non-streaming bodies are both honoured, because the agent streams
 * on /api/assistant/stream and generates on /api/assistant. Every request body is recorded
 * so a test can assert what the model was actually shown (tool results, history). */
function fakeModelServer() {
  const state = { script: [], requests: [] };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "fake-model" }] }));
        return;
      }
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* ignore */ }
      // Side calls the server makes AROUND a turn — the memory judge and the thread namer —
      // arrive asynchronously and must never eat a scripted turn: answer them canned.
      const sys = String(parsed?.messages?.[0]?.content ?? "");
      if (/DURABLE about the household/.test(sys) || /Name this conversation/.test(sys)) {
        const text = /DURABLE/.test(sys) ? JSON.stringify({ remember: false }) : JSON.stringify({ title: "Chores" });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "side", object: "chat.completion", created: 0, model: "fake-model", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] }));
        return;
      }
      state.requests.push(parsed);
      const turn = state.script.shift() ?? { text: "ok" };
      const toolCalls = (turn.toolCalls ?? []).map((tc, i) => ({ index: i, id: `call_${state.requests.length}_${i}`, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) } }));
      const finish = toolCalls.length ? "tool_calls" : "stop";
      if (parsed.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "fake-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
        if (toolCalls.length) chunk({ role: "assistant", content: null, tool_calls: toolCalls });
        else for (const piece of String(turn.text ?? "").match(/.{1,12}/g) ?? [""]) chunk({ role: "assistant", content: piece });
        chunk({}, finish);
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 0, model: "fake-model", choices: [{ index: 0, message: { role: "assistant", content: toolCalls.length ? null : String(turn.text ?? ""), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      }
    });
  });
  return { server, state };
}

/** The tool-role messages the model was shown on a given request. */
function toolMessagesOf(request) {
  return (request?.messages ?? []).filter((m) => m.role === "tool");
}

async function frames(client, message, extra = {}) {
  const res = await client.text("/api/assistant/stream", { method: "POST", headers: { accept: "text/event-stream" }, body: JSON.stringify({ message, ...extra }) });
  const events = [];
  for (const line of res.text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* partial */ }
  }
  return events;
}

async function waitRunStatus(client, runId, statuses, timeoutMs = 15000) {
  const t0 = Date.now();
  let run = null;
  while (Date.now() - t0 < timeoutMs) {
    const r = await client.req(`/api/runs/${runId}`);
    run = r.data?.run ?? null;
    if (run && statuses.includes(run.status)) return run;
    await sleep(150);
  }
  return run;
}

describe("Ask Famili — the AI SDK agent engine", () => {
  let ctx, owner, fake;
  before(async () => {
    ctx = await startServer();
    owner = await makeSession(ctx, "m-alex");
    fake = fakeModelServer();
    await new Promise((r) => fake.server.listen(0, r));
    const port = fake.server.address().port;
    // LM Studio speaks the OpenAI chat API — the shape the scripted server implements.
    await owner.req("/api/ai/providers/lmstudio/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "fake-model" }) });
    await owner.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "lmstudio" }) });
  });
  after(async () => { await stopServer(ctx); await new Promise((r) => fake.server.close(r)); });

  test("a read tool runs and its REAL result reaches the model before it answers", async () => {
    const tk = await owner.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Return the library books", dueAt: new Date(Date.now() + 86400e3).toISOString() }) });
    assert.equal(tk.status, 200);
    fake.state.requests = [];
    fake.state.script = [
      { toolCalls: [{ name: "famili__list_tasks", args: { status: "open" } }] },
      { text: "You have one open task: Return the library books, due tomorrow." },
    ];
    const r = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "what's on my to-do list?" }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.ok, true);
    assert.equal(r.data.kind, "answer");
    assert.match(r.data.answer, /library books/);
    // The second model call carried the tool's output — the loop observed something real.
    assert.equal(fake.state.requests.length, 2, "one call to decide, one to answer");
    const toolMsgs = toolMessagesOf(fake.state.requests[1]);
    assert.equal(toolMsgs.length, 1);
    assert.match(JSON.stringify(toolMsgs[0].content), /Return the library books/);
    // And the turn reports what it did, for the thread and the clients.
    assert.equal(r.data.toolCalls?.[0]?.tool, "famili.list_tasks");
    assert.equal(r.data.toolCalls?.[0]?.status, "done");
    assert.match(r.data.model, /^lmstudio\//);
  });

  test("a write the policy allows executes immediately, and the answer can only claim what happened", async () => {
    fake.state.script = [
      { toolCalls: [{ name: "homeops__create_task", args: { title: "Fix backyard fence", priority: "high" } }] },
      { text: "Done — I added “Fix backyard fence” as a high-priority task." },
    ];
    const r = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "add a task to fix the backyard fence, high priority" }) });
    assert.equal(r.data.ok, true, JSON.stringify(r.data));
    const tasks = await owner.req("/api/tasks");
    const made = (tasks.data.tasks ?? []).find((t) => t.title === "Fix backyard fence");
    assert.ok(made, "the task really exists");
    assert.equal(made.priority, "high");
    assert.equal(r.data.toolCalls?.[0]?.status, "done");
    assert.equal(r.data.toolCalls?.[0]?.ok, true);
  });

  test("an approval-gated tool is NOT executed in the turn — it becomes a parked durable run the model is told is waiting", async () => {
    fake.state.requests = [];
    fake.state.script = [
      { toolCalls: [{ name: "homeops__create_approval", args: { subject: "Sign off on the meal plan", detail: "Tacos Tue, Chili Wed" } }] },
      { text: "I've queued the sign-off request — it's waiting for your approval, nothing has been sent yet." },
    ];
    const r = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "ask everyone to sign off on the meal plan" }) });
    assert.equal(r.data.ok, true, JSON.stringify(r.data));
    const call = r.data.toolCalls?.[0];
    assert.equal(call?.status, "awaiting_approval");
    assert.ok(call?.runId, "the step lives in a durable run");
    assert.ok(r.data.run?.id, "the run rides on the result so clients can attach to it");
    const run = await waitRunStatus(owner, call.runId, ["waiting_for_approval"]);
    assert.equal(run?.status, "waiting_for_approval");
    assert.equal(run.sourceRef?.via, "chat");
    assert.equal(run.sourceRef?.agentId, "agt_household", "chat runs stay attributed to the household helper");
    // The model was told the truth, in words it can't misread as success.
    const toolMsgs = toolMessagesOf(fake.state.requests[1]);
    assert.match(JSON.stringify(toolMsgs[0].content), /awaiting_approval/);
    // And the approval is a real, pending one the family can decide.
    const approvals = await owner.req("/api/approvals");
    assert.ok((approvals.data.approvals ?? []).some((a) => a.status === "pending" && a.toolId === "homeops.create_approval"));
  });

  test("a tool the household has denied on its helper is refused with a visible reason — never run", async () => {
    const agents = readStoreDoc(ctx, "agents.json", {});
    const before = agents["agt_household"];
    writeStoreDoc(ctx, "agents.json", { ...agents, agt_household: { ...before, deniedToolIds: ["homeops.create_list_item"] } });
    try {
      fake.state.requests = [];
      fake.state.script = [
        { toolCalls: [{ name: "homeops__create_list_item", args: { text: "milk", listName: "Groceries" } }] },
        { text: "I can't add to lists — that's switched off for your helper." },
      ];
      const r = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "add milk to groceries" }) });
      assert.equal(r.data.ok, true);
      assert.equal(r.data.toolCalls?.[0]?.status, "blocked");
      const toolMsgs = toolMessagesOf(fake.state.requests[1]);
      assert.match(JSON.stringify(toolMsgs[0].content), /denied|not permitted|permitted/i);
      const tasks = await owner.req("/api/tasks");
      assert.ok(!(tasks.data.tasks ?? []).some((t) => t.title === "milk"), "nothing was written");
    } finally {
      const restore = readStoreDoc(ctx, "agents.json", {});
      writeStoreDoc(ctx, "agents.json", { ...restore, agt_household: { ...restore["agt_household"], deniedToolIds: [] } });
    }
  });

  test("the stream says what it is doing: phase for a write, tool events, then one done frame with the parsed result", async () => {
    fake.state.script = [
      { toolCalls: [{ name: "homeops__create_task", args: { title: "Buy wood screws" } }] },
      { text: "Added “Buy wood screws” to your tasks." },
    ];
    const events = await frames(owner, "add buy wood screws to my tasks");
    const types = events.map((e) => e.type);
    assert.ok(types.includes("phase") && events.some((e) => e.type === "phase" && e.phase === "creating"), `a write announces creating — got ${JSON.stringify(types)}`);
    assert.ok(events.some((e) => e.type === "tool" && e.tool === "homeops.create_task"), "tool activity is announced");
    assert.ok(events.some((e) => e.type === "delta" && typeof e.text === "string"), "the reply text streams");
    const done = events.filter((e) => e.type === "done");
    assert.equal(done.length, 1);
    assert.equal(done[0].result.ok, true);
    assert.match(done[0].result.answer, /wood screws/);
    assert.ok(types.indexOf("done") === types.length - 1, "done is last");
  });

  test("a durable ask becomes a BUILD proposal the family confirms — nothing is created by the turn", async () => {
    const agentsBefore = (await owner.req("/api/agents")).data.agents?.length ?? 0;
    fake.state.script = [
      { toolCalls: [{ name: "famili__propose_build", args: {
        summary: "Email a morning briefing every day at 7 AM",
        skill: { name: "Morning briefing", description: "Compose and send the day's briefing", domain: "Family", risk_level: "Low", steps: [{ name: "Compose briefing", tool_id: null, approval_required: false }, { name: "Send it", tool_id: "homeops.notify_contact", approval_required: false }] },
        agent: { name: "Morning briefer", purpose: "Sends the daily briefing", instructions: "Every morning compose and send the household briefing." },
        automation: { name: "Daily 7 AM briefing", type: "recurring", intervalMs: 86400000, anchor: "07:00" },
      } }] },
      { text: "Here's what I'd set up — confirm and I'll create it." },
    ];
    const r = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "every morning at 7 email me a briefing" }) });
    assert.equal(r.data.ok, true, JSON.stringify(r.data));
    assert.equal(r.data.kind, "build");
    assert.equal(r.data.build?.automation?.anchor, "07:00");
    assert.equal(r.data.build?.skill?.steps?.length, 2);
    const agentsAfter = (await owner.req("/api/agents")).data.agents?.length ?? 0;
    assert.equal(agentsAfter, agentsBefore, "proposing creates nothing");
  });

  test("the durable thread keeps the turn's tool activity, and the next turn sees it as history", async () => {
    const conv = await owner.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Chores" }) });
    const convId = conv.data.conversation?.id;
    assert.ok(convId);
    fake.state.script = [
      { toolCalls: [{ name: "homeops__create_task", args: { title: "Rake the leaves" } }] },
      { text: "Added “Rake the leaves”." },
    ];
    const first = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "add rake the leaves", conversationId: convId }) });
    assert.equal(first.data.ok, true);
    const stored = (await owner.req(`/api/conversations/${convId}`)).data.conversation;
    const last = stored.messages[stored.messages.length - 1];
    assert.equal(last.role, "assistant");
    assert.equal(last.toolCalls?.[0]?.tool, "homeops.create_task");
    assert.equal(last.toolCalls?.[0]?.status, "done");
    // Second turn: the model's first request carries the prior exchange, actions included.
    fake.state.requests = [];
    fake.state.script = [{ text: "Yes — I added Rake the leaves a moment ago." }];
    const second = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "did you add it?", conversationId: convId }) });
    assert.equal(second.data.ok, true);
    const shown = JSON.stringify(fake.state.requests[0].messages);
    assert.match(shown, /Rake the leaves/);
    assert.match(shown, /Actions I took/);
  });

  test("a model that acts but never writes a reply still gets an honest answer built from the tool results", async () => {
    fake.state.script = [
      { toolCalls: [{ name: "homeops__create_task", args: { title: "Call the dentist" } }] },
      { text: "" },
    ];
    const r = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "remind me to call the dentist" }) });
    assert.equal(r.data.ok, true);
    assert.match(r.data.answer, /Done: Create a task/);
  });

  test("the model can look up, change and complete what the family already has", async () => {
    const ev = await owner.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Soccer practice", startAt: "2030-05-05T16:00:00.000Z" }) });
    const evId = ev.data.event?.id;
    assert.ok(evId);
    fake.state.script = [
      { toolCalls: [{ name: "famili__list_events", args: { from: "2030-05-01", to: "2030-05-31", query: "soccer" } }] },
      { toolCalls: [{ name: "famili__update_event", args: { eventId: evId, startAt: "2030-05-05T17:00:00.000Z" } }] },
      { text: "Moved soccer practice to 5 PM." },
    ];
    const r = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "move soccer practice to 5pm" }) });
    assert.equal(r.data.ok, true, JSON.stringify(r.data));
    assert.deepEqual(r.data.toolCalls.map((c) => c.status), ["done", "done"]);
    const after = (await owner.req("/api/events")).data.events.find((e) => e.id === evId);
    assert.equal(after.startAt, "2030-05-05T17:00:00.000Z");
  });

  test("a child profile can read but not write", async () => {
    const kid = await makeSession(ctx, "m-lily");
    // Kids need AI enabled by a parent; the owner switches it on for this test.
    await owner.req("/api/members/m-lily", { method: "PATCH", body: JSON.stringify({ aiEnabled: true }) });
    fake.state.script = [
      { toolCalls: [{ name: "famili__update_task", args: { taskId: "nope", status: "done" } }] },
      { text: "I can't change tasks from your profile — ask a parent." },
    ];
    const r = await kid.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "mark it done" }) });
    if (r.status === 200) {
      assert.equal(r.data.ok, true);
      assert.equal(r.data.toolCalls?.[0]?.status, "failed");
      assert.match(String(r.data.toolCalls?.[0]?.summary), /profile|parent/i);
    } else {
      // A child whose AI access is off is refused at the gate, which is also correct.
      assert.ok([403, 422].includes(r.status), `unexpected ${r.status}`);
    }
  });
});

describe("HOMEOPS_ASSISTANT_ENGINE=legacy restores the single-shot planner", () => {
  let ctx, adult, provider;
  before(async () => {
    ctx = await startServer({ env: { HOMEOPS_ASSISTANT_ENGINE: "legacy" } });
    adult = await makeSession(ctx, "m-morgan");
    provider = http.createServer((req, res) => {
      let b = ""; req.on("data", (c) => (b += c));
      req.on("end", () => {
        if (req.url === "/api/tags") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ models: [{ name: "t" }] })); return; }
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.end(JSON.stringify({ message: { content: JSON.stringify({ kind: "answer", answer: "legacy says hi" }) } }) + "\n");
      });
    });
    await new Promise((r) => provider.listen(0, r));
    const port = provider.address().port;
    await adult.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "t" }) });
    await adult.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });
  });
  after(async () => { await stopServer(ctx); await new Promise((r) => provider.close(r)); });

  test("the legacy JSON envelope is honoured under the flag", async () => {
    const r = await adult.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "hello" }) });
    assert.equal(r.data.ok, true);
    assert.equal(r.data.kind, "answer");
    assert.equal(r.data.answer, "legacy says hi");
    assert.equal(r.data.toolCalls, undefined);
  });
});
