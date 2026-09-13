// LEGACY ENGINE: this suite pins the previous single-shot assistant brain (JSON envelope
// answer|lookup|plan|build). The default Ask Famili engine is now the AI SDK agent loop
// (server/assistant-agent.mjs, server/test/assistant-agent.test.mjs); every server here is
// spawned with HOMEOPS_ASSISTANT_ENGINE=legacy so the rollback path stays proven.
// The two ways a private room leaked, and the writer that never wrote.
//
// BUG-05 — "There is no privacy with these artifacts… you can see artifacts that were
//           performed in private chats. It should only be surfaced here. It shouldn't be
//           surfaced on anybody else's account."
// BUG-06 — "There's no memories being generated… it seems to be entirely broken or
//           non-existent throughout the application and every profile."
//
// Artifacts: /api/artifacts was the ONLY collection returned unfiltered — every artifact in
// the household, to everyone. The fix resolves each artifact's run → conversation and applies
// the conversation's own walls, at read time, so pre-existing artifacts are covered too.
//
// Memory: storage, search and screen were all healthy; nothing upstream ever wrote outside a
// completed run. memory-capture.mjs is the missing writer, and its records inherit the room
// they were said in — which these tests check the sharp edge of: personal means the author
// ALONE, not "the author plus every adult", which is the exact bypass the knowledge items
// had.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession, writeStoreRecord, writeStoreDoc, readStoreDoc } from "./harness.mjs";

let ctx, owner, adult, provider, hh;

before(async () => {
  ctx = await startServer({ env: { HOMEOPS_ASSISTANT_ENGINE: "legacy" } });
  owner = await makeSession(ctx, "m-alex");
  adult = await makeSession(ctx, "m-morgan");
  hh = owner.raw?.session?.householdId; // the seeded household's real id — never guess it
  // One fake provider, two personalities: the judge call (its user turn starts "Member
  // said:") gets a remember verdict; the chat call gets a plain answer.
  provider = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      const isJudge = b.includes("Member said:");
      // The judge must not return one fixed sentence: the capture path dedupes identical
      // text, so a constant reply would make the SECOND test's memory silently vanish.
      const content = isJudge
        ? JSON.stringify({ remember: true, type: "preference", text: b.includes("door code") ? "The door code routine is evenings only." : "Morgan prefers decaf after 3pm." })
        : JSON.stringify({ kind: "answer", answer: "Noted." });
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { content } }) + "\n");
    });
  });
  await new Promise((r) => provider.listen(0, r));
  const port = provider.address().port;
  await adult.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "t" }) });
  await adult.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });
});
after(async () => { await stopServer(ctx); await new Promise((r) => provider.close(r)); });

/** Seed an artifact + the run it came from + (optionally) tie the run to a conversation. */
function seedArtifact(ctx, { id, title, conversationId }) {
  const runId = `run_${id}`;
  writeStoreRecord(ctx, "runs", runId, {
    id: runId, householdId: hh, actorId: adult.actorId, title: `Run for ${title}`,
    status: "completed", ...(conversationId ? { sourceRef: { conversationId } } : {}),
  });
  const arts = readStoreDoc(ctx, "artifacts.json", []);
  arts.push({ id: `art_${id}`, householdId: hh, runId, kind: "note", title, body: "…", createdAt: Date.now() });
  writeStoreDoc(ctx, "artifacts.json", arts);
}

test("BUG-05: an artifact from a personal chat is invisible to everyone but its author", async () => {
  // A real personal conversation, made through the same API the app uses.
  const conv = await adult.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Private planning", visibility: "personal" }) });
  const convId = conv.data?.conversation?.id ?? conv.data?.id;
  assert.ok(convId, JSON.stringify(conv.data));
  seedArtifact(ctx, { id: "priv", title: "Dinner plan from a private chat", conversationId: convId });

  const mine = (await adult.req("/api/artifacts")).data.artifacts.map((a) => a.title);
  assert.ok(mine.includes("Dinner plan from a private chat"), "the author still sees their own");

  const theirs = (await owner.req("/api/artifacts")).data.artifacts.map((a) => a.title);
  assert.ok(!theirs.includes("Dinner plan from a private chat"),
    "the household Owner does not see into a personal chat's output — role is not a way in");
});

test("…while a run with no conversation stays household-visible, because that's what it is", async () => {
  seedArtifact(ctx, { id: "sched", title: "Morning briefing" });
  const theirs = (await owner.req("/api/artifacts")).data.artifacts.map((a) => a.title);
  assert.ok(theirs.includes("Morning briefing"), "scheduled household agents didn't become secrets");
});

test("…and an artifact whose run has vanished fails OPEN to household, not closed to nobody", async () => {
  // Deleting a run must not silently orphan its outputs into invisibility.
  const arts = readStoreDoc(ctx, "artifacts.json", []);
  arts.push({ id: "art_orphan", householdId: hh, runId: "run_gone_forever", kind: "note", title: "Orphaned but shared", createdAt: Date.now() });
  writeStoreDoc(ctx, "artifacts.json", arts);
  const theirs = (await owner.req("/api/artifacts")).data.artifacts.map((a) => a.title);
  assert.ok(theirs.includes("Orphaned but shared"));
});

test("BUG-06: an ordinary personal-chat exchange now WRITES a memory", async () => {
  const conv = await adult.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Coffee", visibility: "personal" }) });
  const convId = conv.data?.conversation?.id ?? conv.data?.id;
  const r = await adult.req("/api/assistant", {
    method: "POST",
    body: JSON.stringify({ message: "Remember that I only drink decaf after 3pm.", conversationId: convId }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  // Capture is deliberately fire-and-forget; give it a beat rather than a hook.
  let mem = [];
  for (let i = 0; i < 20 && mem.length === 0; i++) {
    await new Promise((res) => setTimeout(res, 150));
    mem = (await adult.req("/api/memory")).data.memory.filter((m) => m.text.includes("decaf"));
  }
  assert.equal(mem.length, 1, "the exchange produced exactly one memory");
  assert.equal(mem[0].scope, "personal", "said in a personal chat, scoped to the person");
});

test("…and that personal memory is invisible to the household Owner — just me means just me", async () => {
  const theirs = (await owner.req("/api/memory")).data.memory.filter((m) => m.text.includes("decaf"));
  assert.equal(theirs.length, 0,
    "the old filter let any adult read personal memories — the knowledge-items leak in a different collection");
});

test("a family-chat exchange writes a household memory everyone can see", async () => {
  const conv = await adult.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Family", visibility: "household" }) });
  const convId = conv.data?.conversation?.id ?? conv.data?.id;
  await adult.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "For everyone: our door code routine changed to evenings only.", conversationId: convId }) });
  let mem = [];
  for (let i = 0; i < 20 && mem.length === 0; i++) {
    await new Promise((res) => setTimeout(res, 150));
    mem = (await owner.req("/api/memory")).data.memory.filter((m) => m.scope === "household" && m.source?.via === "chat");
  }
  assert.ok(mem.length >= 1, "household scope reaches the household");
});

test("the same fact is not memorised twice", async () => {
  const conv = await adult.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Coffee again", visibility: "personal" }) });
  const convId = conv.data?.conversation?.id ?? conv.data?.id;
  await adult.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "Reminder again, I only drink decaf after 3pm.", conversationId: convId }) });
  await new Promise((res) => setTimeout(res, 1200));
  const mem = (await adult.req("/api/memory")).data.memory.filter((m) => m.text.includes("decaf"));
  assert.equal(mem.length, 1, "an identical memory is noise, not reinforcement");
});
