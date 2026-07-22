// WP-009 (ISS-010 / HYP-006 / EV-030) — data-rev is per-household, and /api/changes
// (SSE) pushes a bump immediately, without leaking across households. Proven through
// the real HTTP surface (child server process, isolated temp data dir — see harness.mjs)
// so this exercises the actual gate()/session/tenant-context wiring, not a mock.
//
// Root cause this WP fixed (see server/store.mjs's _dataRevByTenant comment and
// src/store/useStore.ts's sendToAssistant comment for the full story):
//   1. rev used to be ONE process-global counter — any household's write bumped
//      it for every other household's client too.
//   2. the client had a second, ungated hydrate loop (fixed in useStore.ts, not
//      reachable from a server-only test) that ignored rev entirely.
// This file proves fix #1 end-to-end: rev (and its SSE push) is now genuinely
// scoped per household.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer } from "./harness.mjs";

let ctx;
before(async () => { ctx = await startServer(); });
after(async () => { await stopServer(ctx); });

async function signup(email, ownerName, householdName) {
  const res = await ctx.fetch("/api/signup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery", ownerName, householdName }),
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  const data = await res.json();
  return {
    status: res.status, data, cookie, csrf: data.session?.csrf, householdId: data.session?.householdId,
    async req(path, init = {}) {
      const headers = { Cookie: cookie, ...(init.headers || {}) };
      if (init.method && init.method !== "GET") { headers["x-homeops-csrf"] = data.session.csrf; headers["content-type"] ??= "application/json"; }
      const r = await ctx.fetch(path, { ...init, headers });
      let out = null; try { out = await r.json(); } catch { /* non-JSON */ }
      return { status: r.status, data: out };
    },
  };
}

/** Open /api/changes as a raw streaming request and collect parsed `data:` payloads. */
function openChanges(client) {
  const events = [];
  const ac = new AbortController();
  const donePromise = (async () => {
    const res = await fetch(ctx.base + "/api/changes", {
      headers: { Origin: "http://localhost:5173", Cookie: client.cookie },
      signal: ac.signal,
    });
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (line) { try { events.push(JSON.parse(line.slice(6))); } catch { /* not JSON */ } }
        }
      }
    } catch { /* aborted */ }
  })();
  return { events, close: () => ac.abort(), done: donePromise };
}

let hixon, garcia;

test("setup: two stranger households", async () => {
  hixon = await signup("wp009-hixon@example.com", "Ross", "WP009 Hixons");
  garcia = await signup("wp009-garcia@example.com", "Maria", "WP009 Garcia");
  assert.equal(hixon.status, 200);
  assert.equal(garcia.status, 200);
  assert.notEqual(hixon.householdId, garcia.householdId);
});

test("rev is per-household: one household's write never bumps another's rev", async () => {
  const before1 = await hixon.req("/api/rev");
  const beforeG = await garcia.req("/api/rev");
  assert.equal(before1.status, 200);
  assert.equal(beforeG.status, 200);

  const created = await garcia.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Garcia task", type: "task" }) });
  assert.equal(created.status, 200, JSON.stringify(created.data));

  const afterG = await garcia.req("/api/rev");
  assert.notEqual(afterG.data.rev, beforeG.data.rev, "the writing household's OWN rev must advance");

  const after1 = await hixon.req("/api/rev");
  assert.equal(after1.data.rev, before1.data.rev, "an unrelated household's rev must NOT move just because another household wrote something");
});

test("rev advances on this household's own write", async () => {
  const b = await hixon.req("/api/rev");
  const created = await hixon.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Hixon task", type: "task" }) });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const a = await hixon.req("/api/rev");
  assert.notEqual(a.data.rev, b.data.rev);
});

test("/api/changes (SSE) pushes the new rev promptly after this household's write, and never leaks another household's write", async () => {
  const hixonStream = openChanges(hixon);
  // Let the initial snapshot land before triggering a write.
  await new Promise((r) => setTimeout(r, 300));
  const initialCount = hixonStream.events.length;
  assert.ok(initialCount >= 1, "SSE must push an initial rev snapshot on connect");

  // Garcia writes — must NOT show up on Hixon's stream.
  await garcia.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Garcia task 2", type: "task" }) });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(hixonStream.events.length, initialCount, "another household's write must not push a bump onto this household's SSE stream");

  // Hixon writes — must show up within a few seconds, well inside the PRD's 5s bar.
  const hixonRevBefore = (await hixon.req("/api/rev")).data.rev;
  await hixon.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Hixon task 2", type: "task" }) });
  const deadline = Date.now() + 5_000;
  while (hixonStream.events.length === initialCount && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(hixonStream.events.length > initialCount, "this household's own write must push a new event onto its SSE stream within 5s");
  const latest = hixonStream.events[hixonStream.events.length - 1];
  assert.notEqual(latest.rev, hixonRevBefore, "the pushed rev must be the NEW value, not the stale one");

  hixonStream.close();
  await hixonStream.done;
});
