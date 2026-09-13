// ASSISTANT PERSISTENCE — a real chat turn through /api/assistant/stream (the route the
// actual chat UI uses) must durably persist BOTH messages to the server-owned conversation.
// Regression test for a real bug found 2026-07-03: the streaming route computed a real
// answer but never called appendConversationMessage, so every conversation created through
// the live chat stayed { messages: [] } forever — history silently never survived a refresh.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult, fakeProvider;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin

  // A tiny fake Ollama-compatible endpoint — no external network, no API key, real
  // HTTP round-trip through the actual providerChat() code path.
  // Ollama's real streaming format is newline-delimited JSON chunks — the client reads
  // line-by-line and treats a line with no trailing "\n" yet as an incomplete buffer, so
  // a single JSON blob with no trailing newline is silently swallowed. Match the real shape.
  fakeProvider = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const answer = "Here's your household summary: all quiet today.";
      // The default Ask Famili engine (server/assistant-agent.mjs) talks to Ollama through its
      // OpenAI-compatible /v1 surface; the legacy engine used /api/chat. Answer both so this
      // suite pins PERSISTENCE, not a particular engine.
      if (req.url.includes("/v1/")) {
        let stream = false;
        try { stream = !!JSON.parse(body).stream; } catch { /* ignore */ }
        if (stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write("data: " + JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "test-model", choices: [{ index: 0, delta: { role: "assistant", content: answer }, finish_reason: null }] }) + "\n\n");
          res.write("data: " + JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + "\n\n");
          res.end("data: [DONE]\n\n");
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 0, model: "test-model", choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }] }));
        return;
      }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { content: answer } }) + "\n");
    });
  });
  await new Promise((resolve) => fakeProvider.listen(0, resolve));
  const port = fakeProvider.address().port;

  const cfg = await adult.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "test-model" }) });
  assert.equal(cfg.status, 200);
  const active = await adult.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });
  assert.equal(active.status, 200);
});
after(async () => { await stopServer(ctx); await new Promise((r) => fakeProvider.close(r)); });

test("a streamed assistant turn persists both messages to the server-owned conversation", async () => {
  const conv = await adult.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Test chat" }) });
  assert.equal(conv.status, 200);
  const convId = conv.data.conversation.id;

  // Confirm the bug's starting condition: freshly created, genuinely empty.
  const before1 = await adult.req(`/api/conversations/${convId}`);
  assert.deepEqual(before1.data.conversation.messages, []);

  // SSE response — the harness's req() always tries r.json() (fails on an event
  // stream), so hit ctx.fetch directly with the same session auth to read raw text.
  const streamRes = await ctx.fetch("/api/assistant/stream", {
    method: "POST",
    headers: { Cookie: adult.cookie, "x-homeops-csrf": adult.csrf, "content-type": "application/json" },
    body: JSON.stringify({ message: "What's my day look like?", conversationId: convId }),
  });
  assert.equal(streamRes.status, 200);
  const text = await streamRes.text();
  const doneLine = text.split("\n").reverse().find((l) => l.startsWith("data: ") && l.includes('"type":"done"'));
  assert.ok(doneLine, "stream produced a done event");
  const result = JSON.parse(doneLine.slice(6)).result;
  assert.equal(result.ok, true);

  const after1 = await adult.req(`/api/conversations/${convId}`);
  const msgs = after1.data.conversation.messages;
  assert.equal(msgs.length, 2, "both the user turn and the assistant reply were persisted");
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[0].text, "What's my day look like?");
  assert.equal(msgs[1].role, "assistant");
  assert.ok(msgs[1].text.includes("household summary"));
});

test("a FAILED assistant turn still persists the exchange (user turn + honest error)", async () => {
  // Regression test for a real bug found 2026-07-04: persistence was gated on out.ok,
  // so when the assistant failed (e.g. no provider) neither the user's question nor the
  // honest error reply was written — the thread looked fine until refresh, then emptied.
  const conv = await adult.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Failing chat" }) });
  assert.equal(conv.status, 200);
  const convId = conv.data.conversation.id;

  // "anthropic" has no key configured in this test env → assistantRespond fails honestly.
  const res = await adult.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "Will this survive a refresh?", conversationId: convId, providerId: "anthropic" }) });
  assert.equal(res.status, 422);
  assert.equal(res.data.ok, false);

  const after1 = await adult.req(`/api/conversations/${convId}`);
  const msgs = after1.data.conversation.messages;
  assert.equal(msgs.length, 2, "failed turn persisted both the question and the error reply");
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[0].text, "Will this survive a refresh?");
  assert.equal(msgs[1].role, "assistant");
  assert.equal(msgs[1].kind, "error");
  assert.ok(msgs[1].text.length > 0, "error reply has honest, human-readable text");
});

test("a message is never attributed to a conversation owned by someone else", async () => {
  const child = await makeSession(ctx, "m-noah");
  const conv = await adult.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Adult's private chat" }) });
  const convId = conv.data.conversation.id;
  // The child streams a message claiming the adult's conversation id — the route only
  // appends when conv.actorId matches the AUTHENTICATED session, so this must no-op
  // (not silently write into someone else's thread).
  await child.req("/api/assistant/stream", { method: "POST", body: JSON.stringify({ message: "hi", conversationId: convId }) });
  const after1 = await adult.req(`/api/conversations/${convId}`);
  assert.deepEqual(after1.data.conversation.messages, [], "a non-owner's message was not appended to another actor's conversation");
});
