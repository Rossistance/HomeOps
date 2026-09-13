// Streaming client for POST /api/assistant/stream (SSE over a POST response).
//
// Exact protocol (server/index.mjs ~line 2112 + planner.mjs assistantStream):
//   → POST ${API_URL}/api/assistant/stream
//     body: { message, context?, conversationId?, providerId? }
//     auth: `Authorization: Bearer <token>` — the route gates with
//     { requireSession: true }, so an unauthenticated call gets a JSON 401/403
//     (NOT an event stream).
//   ← 200 `text/event-stream`; each frame is a single `data: <json>` line
//     terminated by a blank line. Five event shapes:
//       { "type": "progress", "tokens": n }
//         — liveness ping emitted every 4th provider token.
//       { "type": "delta", "text": string }
//         — a piece of the REPLY TEXT as it streams (the replaced engine writes prose
//           first and tool calls as structure, so text is meaningful mid-stream now).
//           Concatenate deltas in order; "done" still carries the authoritative text.
//       { "type": "tool", "tool": string, "label"?: string, "status": "running" | "called" | "error" }
//         — a tool the engine is calling right now, by name, with a human label when
//           the server has one. "running" opens it, "called"/"error" closes it.
//       { "type": "phase", "phase": "searching" | "creating" }
//         — what the server has decided to DO, sent when it decides it. Distinct
//           from the token ping on purpose: a lookup goes out to the live web and
//           emits no tokens while it does, so inferring the phase from token flow
//           reported "writing" throughout the slowest part of the request.
//       { "type": "done", "result": { ok, kind, answer, build?, run?, toolCalls?, runId?, runIds?, model } }
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

/** What the server can announce it is DOING. Deliberately narrower than what the UI can
 *  show: these two are facts from the server, the other two are inferred from token flow. */
export type ServerPhase = "searching" | "creating";

/** The full vocabulary of the working bubble. */
export type AssistantPhase = "thinking" | "writing" | ServerPhase;

/** A tool the server is calling mid-turn. `label` is the human name when it has one. */
export interface StreamToolEvent { tool: string; label?: string; status: "running" | "called" | "error" }

interface StreamEvent { type?: string; tokens?: number; text?: string; tool?: string; label?: string; status?: string; phase?: string; result?: AssistantResult }

export interface StreamAssistantOpts {
  conversationId?: string;
  context?: Record<string, unknown>;
  /** Fires with the running token count each time the server pings progress. */
  onProgress?: (tokens: number) => void;
  /** Fires with each piece of reply text as it streams, in order. */
  onDelta?: (text: string) => void;
  /** Fires when the server starts/finishes calling a tool. */
  onTool?: (ev: StreamToolEvent) => void;
  /** Fires when the server says what it has decided to do. */
  onPhase?: (phase: ServerPhase) => void;
  signal?: AbortSignal;
}

const PHASES: readonly string[] = ["searching", "creating"];
const TOOL_STATUSES: readonly string[] = ["running", "called", "error"];

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
      else if (ev.type === "delta" && typeof ev.text === "string" && ev.text) opts?.onDelta?.(ev.text);
      else if (ev.type === "tool" && typeof ev.tool === "string" && ev.tool && ev.status && TOOL_STATUSES.includes(ev.status)) {
        opts?.onTool?.({ tool: ev.tool, label: typeof ev.label === "string" && ev.label ? ev.label : undefined, status: ev.status as StreamToolEvent["status"] });
      }
      // Unknown phase names are ignored rather than displayed: a future server adding one
      // shouldn't put a raw identifier in front of a person.
      else if (ev.type === "phase" && ev.phase && PHASES.includes(ev.phase)) opts?.onPhase?.(ev.phase as ServerPhase);
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
