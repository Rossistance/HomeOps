/* WHAT A SURPRISE LEAVES BEHIND (ADR-005 privacy review, second pass).
 *
 * assistant-hidden-events.test.mjs pins that the turn which hands an owner's surprise over
 * records nothing through write_memory and the exchange capture. This pins the doors that
 * pass left open, and one shared-thread context:
 *
 *  - in that turn, homeops.create_artifact and homeops.send_notification_draft refuse too —
 *    a chat turn's artifact has no run, so the Library lists it to the whole household;
 *  - the release outlives the turn: the surprise is still in the conversation's history, so
 *    every LATER turn in that conversation records nothing either (conv.secretReleasedAt);
 *  - a surprise the assistant itself writes with create_event_draft counts as released;
 *  - a family thread's suggestion chips are written from a context in which the poster's own
 *    hidden events are blocks, because the model's chip is read by everyone in the thread.
 *
 * Driven through the real server with a scripted model (fake-model.mjs).
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-surprise-records-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession, writeStoreRecord, readStoreRecord } = await import("./harness.mjs");
const { useFakeModel } = await import("./fake-model.mjs");

const SURPRISE_TITLE = "Surprise party for Alex";
const SURPRISE_NOTES = "at Rosa's, cake from Lulu";
const INTERVIEW_TITLE = "Interview at Globex";
const INTERVIEW_PLACE = "Globex HQ";
const MEMORY_SECRET = "Morgan is planning a surprise party for Alex at Rosa's";

let ctx, alex, morgan, fake;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toolResults = (from) => JSON.stringify(fake.state.requests.slice(from).flatMap((q) => (q.messages ?? []).filter((m) => m.role === "tool" || m.tool_call_id)));
const memoryOf = async (who) => (await who.req("/api/memory")).data.memory ?? [];
const artifactsOf = async (who) => (await who.req("/api/artifacts")).data.artifacts ?? [];

async function ask(client, message, conversationId) {
  const r = await client.req("/api/assistant", { method: "POST", body: JSON.stringify({ message, conversationId }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function personalChat(client) {
  const r = await client.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "t", visibility: "personal" }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.conversation.id;
}

before(async () => {
  ctx = await startServer();
  alex = await makeSession(ctx, "m-alex");     // Owner — the surprise is for him
  morgan = await makeSession(ctx, "m-morgan"); // Adult Admin — the hidden events are hers
  fake = await useFakeModel(alex);
  const day = (d, h) => { const t = new Date(Date.now() + d * 86400000); t.setUTCHours(h, 0, 0, 0); return t.toISOString(); };
  const make = async (title, startAt, extra) => {
    const r = await morgan.req("/api/events", { method: "POST", body: JSON.stringify({ title, startAt, visibility: "household" }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const ev = readStoreRecord(ctx, "events", r.data.event.id);
    writeStoreRecord(ctx, "events", ev.id, { ...ev, ownerId: "m-morgan", shareState: "hidden", ...extra });
  };
  await make(SURPRISE_TITLE, day(3, 23), { notes: SURPRISE_NOTES });
  await make(INTERVIEW_TITLE, day(2, 15), { location: INTERVIEW_PLACE });
});
after(async () => { await stopServer(ctx); try { fake.server.close(); } catch { /* best effort */ } });

test("in the turn that released a surprise, create_artifact and send_notification_draft save nothing", async () => {
  const conv = await personalChat(morgan);
  const from = fake.state.requests.length;
  fake.state.script.push(
    { toolCalls: [{ name: "famili__list_events", args: {} }] },
    { toolCalls: [{ name: "homeops__create_artifact", args: { title: "Checklist: Surprise party for Alex at Rosa's", body: "cake, balloons" } }] },
    { toolCalls: [{ name: "homeops__send_notification_draft", args: { to: "Lulu", body: "Cake for Alex's surprise party at Rosa's" } }] },
    { text: "Here's the checklist: cake, balloons." },
  );
  await ask(morgan, "make me a checklist for the surprise party", conv);
  const seen = toolResults(from);
  assert.ok(seen.includes(SURPRISE_TITLE), "the surprise was handed over (her own Personal chat)");
  // Each later request repeats the earlier tool results, so count distinct tool calls.
  const results = new Map(fake.state.requests.slice(from).flatMap((q) => (q.messages ?? []).filter((x) => x.tool_call_id)).map((x) => [x.tool_call_id, String(x.content)]));
  assert.equal([...results.values()].filter((c) => c.includes("private_turn")).length, 2, `both artifact tools refused: ${seen.slice(-600)}`);
  for (const who of [alex, morgan]) {
    const arts = await artifactsOf(who);
    assert.equal(arts.some((a) => /Surprise|Rosa|Lulu/.test(`${a.title} ${a.body}`)), false, `${who.actorId}: no artifact of it in the Library`);
  }
  assert.ok(readStoreRecord(ctx, "conversations", conv).secretReleasedAt, "the release is stamped on the conversation");
});

test("every later turn in that conversation records nothing either — write_memory refuses, the exchange is not captured", async () => {
  const conv = await personalChat(morgan);
  fake.state.script.push({ toolCalls: [{ name: "famili__list_events", args: {} }] }, { text: "Saturday, at Rosa's." });
  await ask(morgan, "when is the surprise party?", conv);
  assert.ok(readStoreRecord(ctx, "conversations", conv).secretReleasedAt);

  // The next turn never touches the calendar — its ledger alone would say nothing happened.
  fake.state.memoryJudge = { remember: true, type: "fact", text: MEMORY_SECRET, about: "personal" };
  const from = fake.state.requests.length;
  fake.state.script.push(
    { toolCalls: [{ name: "homeops__write_memory", args: { text: MEMORY_SECRET, scope: "personal" } }] },
    { text: "Noted — candles too." },
  );
  await ask(morgan, "and remind me to buy candles for it", conv);
  assert.match(toolResults(from), /private_turn/, "write_memory refused in a later turn");
  await sleep(1500); // the exchange capture would have run by now
  for (const who of [morgan, alex]) {
    assert.equal((await memoryOf(who)).some((m) => m.text === MEMORY_SECRET), false, `${who.actorId}: nothing remembered from the later turn`);
  }
  fake.state.memoryJudge = { remember: false };
});

test("a surprise the assistant itself writes down (create_event_draft) makes the turn record nothing", async () => {
  const conv = await personalChat(morgan);
  const from = fake.state.requests.length;
  const day = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
  fake.state.script.push(
    { toolCalls: [{ name: "homeops__create_event_draft", args: { title: "Surprise birthday dinner for Alex", startAt: day, notes: "at Rosa's" } }] },
    { toolCalls: [{ name: "homeops__write_memory", args: { text: MEMORY_SECRET, scope: "personal" } }] },
    { text: "Added." },
  );
  await ask(morgan, "put Alex's surprise birthday dinner on my calendar", conv);
  const seen = toolResults(from);
  assert.ok(seen.includes("Surprise birthday dinner for Alex"), "the event was written");
  assert.match(seen, /private_turn/, "write_memory refused after the assistant wrote a surprise");
  assert.ok(readStoreRecord(ctx, "conversations", conv).secretReleasedAt, "and the conversation carries it forward");
});

test("a family thread's suggestion context shows the poster's own hidden events as blocks, never their titles", async () => {
  const t = await morgan.req("/api/threads", { method: "POST", body: JSON.stringify({ participantIds: ["m-alex"], title: "Logistics" }) });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const from = fake.state.requests.length;
  const m = await morgan.req(`/api/threads/${t.data.thread.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Can we move my thing on Thursday to 3pm?" }) });
  assert.equal(m.status, 200, JSON.stringify(m.data));
  let req = null;
  for (let i = 0; i < 60 && !req; i++) {
    req = fake.state.requests.slice(from).find((q) => /You read one message from a family group chat/.test(String(q.messages?.[0]?.content ?? "")));
    if (!req) await sleep(100);
  }
  assert.ok(req, "the suggestion model was asked");
  const shown = String(req.messages?.[1]?.content ?? "");
  const existing = shown.slice(shown.indexOf("EXISTING:"), shown.indexOf("RECENT"));
  for (const secret of [INTERVIEW_TITLE, INTERVIEW_PLACE, SURPRISE_TITLE, "Rosa"]) {
    assert.equal(existing.includes(secret), false, `the chip's model never sees "${secret}"`);
  }
  assert.ok(existing.includes("Morgan Harper busy"), `her hidden time is there as a block: ${existing.slice(0, 400)}`);
});

test("a chat that handled a surprise cannot be moved to Family — that would publish it", async () => {
  const conv = await personalChat(morgan);
  const day = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  fake.state.script.push(
    { toolCalls: [{ name: "homeops__create_event_draft", args: { title: "Surprise anniversary trip", startAt: day } }] },
    { text: "Added." },
  );
  await ask(morgan, "put the surprise anniversary trip on my calendar", conv);
  assert.ok(readStoreRecord(ctx, "conversations", conv).secretReleasedAt);
  const move = await morgan.req(`/api/conversations/${conv}`, { method: "PATCH", body: JSON.stringify({ visibility: "household" }) });
  assert.equal(move.status, 403, JSON.stringify(move.data));
  assert.equal(move.data.error, "holds_a_surprise");
  assert.equal(readStoreRecord(ctx, "conversations", conv).visibility, "personal", "it stays personal");
  const plain = await personalChat(morgan);
  assert.equal((await morgan.req(`/api/conversations/${plain}`, { method: "PATCH", body: JSON.stringify({ visibility: "household" }) })).status, 200, "a chat without a surprise still moves");
});
