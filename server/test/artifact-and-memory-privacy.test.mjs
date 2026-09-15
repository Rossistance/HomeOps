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
import { useFakeModel } from "./fake-model.mjs";

let ctx, owner, adult, fake, hh;

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
  adult = await makeSession(ctx, "m-morgan");
  hh = owner.raw?.session?.householdId; // the seeded household's real id — never guess it
  fake = await useFakeModel(owner);
});
after(async () => { await stopServer(ctx); await new Promise((r) => fake.server.close(r)); });

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
  fake.state.script = [{ text: "Noted — decaf after 3pm." }];
  fake.state.memoryJudge = { remember: true, type: "preference", text: "Morgan prefers decaf after 3pm." };
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
  fake.state.script = [{ text: "Got it — evenings only." }];
  fake.state.memoryJudge = { remember: true, type: "fact", text: "The door code routine is evenings only." };
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
  // The judge returns the SAME sentence as the first test: the capture path is what has
  // to notice that, not the model.
  fake.state.script = [{ text: "Still noted." }];
  fake.state.memoryJudge = { remember: true, type: "preference", text: "Morgan prefers decaf after 3pm." };
  await adult.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "Reminder again, I only drink decaf after 3pm.", conversationId: convId }) });
  await new Promise((res) => setTimeout(res, 1200));
  const mem = (await adult.req("/api/memory")).data.memory.filter((m) => m.text.includes("decaf"));
  assert.equal(mem.length, 1, "an identical memory is noise, not reinforcement");
});
