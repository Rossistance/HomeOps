// Offline write queue: quick family mutations (check a chore, add a grocery
// item) made without a connection are stored durably and replayed in order the
// moment the server is reachable again — instead of silently failing.
// Only idempotent-safe calls are queued (status toggles, list adds).
import * as SecureStore from "expo-secure-store";
import { API_URL, loadToken } from "@/lib/api";

const KEY = "familios_offline_queue";
const MAX_QUEUE = 50;

export interface QueuedWrite { path: string; method: string; body?: unknown; at: number }

async function read(): Promise<QueuedWrite[]> {
  try { return JSON.parse((await SecureStore.getItemAsync(KEY)) ?? "[]"); } catch { return []; }
}
async function write(q: QueuedWrite[]): Promise<void> {
  try { await SecureStore.setItemAsync(KEY, JSON.stringify(q.slice(-MAX_QUEUE))); } catch { /* best effort */ }
}

export async function enqueue(item: Omit<QueuedWrite, "at">): Promise<number> {
  const q = await read();
  q.push({ ...item, at: Date.now() });
  await write(q);
  return q.length;
}

export async function queuedCount(): Promise<number> {
  return (await read()).length;
}

/** Replay FIFO. Stops at the first network failure (still offline); drops
 * entries the server rejects outright (4xx) — they'd never succeed. */
export async function replayQueue(): Promise<{ sent: number; remaining: number }> {
  let q = await read();
  if (q.length === 0) return { sent: 0, remaining: 0 };
  const token = await loadToken();
  let sent = 0;
  while (q.length > 0) {
    const item = q[0];
    try {
      const r = await fetch(`${API_URL}/api${item.path}`, {
        method: item.method,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: item.body != null ? JSON.stringify(item.body) : undefined,
      });
      if (r.status >= 500) break; // server hiccup — retry later, keep order
      q.shift(); // 2xx applied; 4xx would never succeed — drop either way
      sent++;
    } catch {
      break; // still offline
    }
  }
  await write(q);
  return { sent, remaining: q.length };
}
