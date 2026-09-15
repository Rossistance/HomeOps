// A scripted OpenAI-compatible model server, shared by every suite that drives the Ask
// Famili agent loop through the real HTTP server.
//
// `state.script` is a queue of turns; each request pops one:
//   { toolCalls: [{ name, args }] }   — the model calls tools
//   { text: "…" }                     — the model answers
// Both the streaming and non-streaming bodies are implemented, because the agent streams
// its turn while other callers generate. Every request body is recorded so a test can
// assert what the model was actually shown (tool results, history, its system prompt).
//
// The memory judge and the conversation namer are side calls the server makes AROUND a
// turn. They arrive asynchronously and must never eat a scripted turn, so they are answered
// canned — unless a test opts in with `state.memoryJudge`, which is how the memory-capture
// suites decide what gets remembered.
import http from "node:http";

export function fakeModelServer() {
  const state = {
    script: [],
    requests: [],
    systemPrompts: [],
    /** Set to { remember: true, text, scope } to make the judge say "yes, remember this". */
    memoryJudge: { remember: false },
    /** Optional per-request hook: (parsed) => turn | null, checked before the script. */
    answer: null,
  };

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url.endsWith("/models") || req.url.endsWith("/api/tags")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "fake-model" }], models: [{ name: "fake-model" }] }));
        return;
      }
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* ignore */ }
      const sys = String(parsed?.messages?.[0]?.content ?? "");

      if (/DURABLE about the household/.test(sys)) {
        return json(res, { content: JSON.stringify(state.memoryJudge) });
      }
      if (/Name this conversation/.test(sys)) {
        return json(res, { content: "Thread" });
      }

      state.requests.push(parsed);
      state.systemPrompts.push(sys);
      const turn = state.answer?.(parsed) ?? state.script.shift() ?? { text: "ok" };
      const toolCalls = (turn.toolCalls ?? []).map((tc, i) => ({
        index: i,
        id: `call_${state.requests.length}_${i}`,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
      }));
      const finish = toolCalls.length ? "tool_calls" : "stop";

      if (parsed.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
          id: "c1", object: "chat.completion.chunk", created: 0, model: "fake-model",
          choices: [{ index: 0, delta, finish_reason }],
        })}\n\n`);
        if (toolCalls.length) chunk({ role: "assistant", content: null, tool_calls: toolCalls });
        else for (const piece of String(turn.text ?? "").match(/.{1,12}/g) ?? [""]) chunk({ role: "assistant", content: piece });
        chunk({}, finish);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      json(res, {
        content: toolCalls.length ? null : String(turn.text ?? ""),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      }, finish);
    });
  });

  return { server, state };
}

function json(res, message, finish_reason = "stop") {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    id: "c1", object: "chat.completion", created: 0, model: "fake-model",
    choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }));
}

/** Start the fake and point the household's AI provider at it. Returns the fake's state. */
export async function useFakeModel(client) {
  const fake = fakeModelServer();
  await new Promise((r) => fake.server.listen(0, r));
  const port = fake.server.address().port;
  // LM Studio speaks the OpenAI chat API — the shape this server implements.
  await client.req("/api/ai/providers/lmstudio/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "fake-model" }) });
  await client.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "lmstudio" }) });
  return fake;
}

/** Collect every SSE frame from a streamed assistant turn, in order. */
export async function streamFrames(client, message, extra = {}) {
  const res = await client.text("/api/assistant/stream", {
    method: "POST",
    headers: { accept: "text/event-stream" },
    body: JSON.stringify({ message, ...extra }),
  });
  const events = [];
  for (const line of res.text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* partial frame */ }
  }
  return events;
}
