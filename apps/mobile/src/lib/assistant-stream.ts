// Streaming client for POST /api/assistant/stream (SSE over a POST response).
//
// Exact protocol (server/index.mjs ~line 2112 + planner.mjs assistantStream):
//   → POST ${API_URL}/api/assistant/stream
//     body: { message, context?, conversationId?, providerId? }
//     auth: `Authorization: Bearer <token>` — the route gates with
//     { requireSession: true }, so an unauthenticated call gets a JSON 401/403
//     (NOT an event stream).
//   ← 200 `text/event-stream`; each frame is a single `data: <json>` line
//     terminated by a blank line. Two event shapes only:
//       { "type": "progress", "tokens": n }
//         — liveness ping emitted every 4th provider token. The raw token TEXT
//           is never streamed: the model responds with JSON that is meaningless
//           mid-stream, so the server only signals that generation is alive.
//       { "type": "done", "result": { ok, kind, answer, plan?, build?, model } }
//         — the fully parsed AssistantResult, identical in shape to the
//           non-streaming POST /api/assistant response ({ ok:false, error,
//           message } on failure, e.g. "no_provider" / "stream_error").
//     When a conversationId is sent, the server persists BOTH turns durably
//     (same as POST /api/assistant), then emits "done" and closes.
//
// Any transport problem (non-200, wrong content-type, no "done" frame) throws;
// callers fall back silently to api.assistant() so behavior never regresses.
// Uses expo/fetch because React Native's built-in fetch cannot stream bodies.
import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import { API_URL, type AssistantResult } from "@/lib/api";

// Same secure-store key api.ts writes on login. The token stays module-private
// in api.ts, so we read the store directly instead of widening its surface.
const TOKEN_KEY = "homeops_token";

async function bearerToken(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(TOKEN_KEY); } catch { return null; }
}

interface StreamEvent { type?: string; tokens?: number; result?: AssistantResult }

export interface StreamAssistantOpts {
  conversationId?: string;
  context?: Record<string, unknown>;
  /** Fires with the running token count each time the server pings progress. */
  onProgress?: (tokens: number) => void;
  signal?: AbortSignal;
}

export async function streamAssistant(message: string, opts?: StreamAssistantOpts): Promise<AssistantResult> {
  const token = await bearerToken();
  const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream" };
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await expoFetch(`${API_URL}/api/assistant/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, context: opts?.context, conversationId: opts?.conversationId }),
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(`assistant_stream_http_${res.status}`);
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) throw new Error("assistant_stream_not_sse");
  if (!res.body) throw new Error("assistant_stream_no_body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: AssistantResult | null = null;

  const consume = (frame: string) => {
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      let ev: StreamEvent;
      try { ev = JSON.parse(line.slice(5).trim()) as StreamEvent; } catch { continue; }
      if (ev.type === "progress" && typeof ev.tokens === "number") opts?.onProgress?.(ev.tokens);
      else if (ev.type === "done" && ev.result) result = ev.result;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        consume(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
      }
    }
    if (done) break;
  }
  if (buffer.trim()) consume(buffer); // tolerate a final frame missing its trailing blank line

  if (!result) throw new Error("assistant_stream_incomplete");
  return result;
}
