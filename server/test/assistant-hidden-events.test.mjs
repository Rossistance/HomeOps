/* HIDDEN EVENTS THROUGH THE ASSISTANT (ADR-005): who is asking, who is listening, what the
 * assistant may read, and what it may remember.
 *
 * event-privacy.test.mjs pins the decisions themselves. This file pins that every door the
 * assistant has onto the calendar goes through them — the Ask routes, the group thread, the
 * 1:1 text — with the audience the SERVER decided for the turn:
 *
 *  - the owner of a hidden Work event hears it in full anywhere, a group thread included;
 *  - anyone else — the household Owner included — gets "<Name> working", nothing more;
 *  - an owner's SURPRISE is spoken only where they are alone with the assistant (their own
 *    Personal Ask chat, a 1:1 text from a number only they have) and withheld everywhere else;
 *  - the briefing loaded before a turn never carries a surprise;
 *  - a turn that handed a surprise over records nothing: write_memory refuses, the exchange is
 *    not captured, its runs are secret (their requester's alone) and the run judge skips them;
 *  - someone else's hidden event cannot be changed or cancelled, the owner's own can;
 *  - the raw provider calendar readers are not offered where others are listening.
 *
 * Driven end to end through the real server with a scripted model (fake-model.mjs), and the
 * assertions are made on what the MODEL was actually handed — the briefing and every tool
 * result — because that is what could be repeated to the room.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-hidden-assist-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession, writeStoreRecord, readStoreRecord } = await import("./harness.mjs");
const { useFakeModel } = await import("./fake-model.mjs");

const MORGAN_NUM = "+15550107501";   // Morgan's alone
const SHARED_NUM = "+15550107502";   // Morgan's AND Alex's (a shared phone)
const ALEX_NUM = "+15550107503";
const GROUP_GUID = "iMessage;+;chat-hidden-events";

const WORK_TITLE = "Quarterly review with Pat";
const SURPRISE_TITLE = "Surprise party for Alex";
const SURPRISE_NOTES = "at Rosa's, cake from Lulu";
const HAIRCUT_TITLE = "Haircut downtown";
const MEMORY_SECRET = "Morgan is planning a surprise party for Alex at Rosa's";
const MEMORY_NORMAL = "Morgan takes oat milk in her coffee";

let ctx, alex, morgan, fake, hh;
let workId, surpriseId, haircutId;
let n = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* The fake model answers from ONE shared script. A background call left over from the previous
 * test (memory capture, a run judge, a chat title) can take the next scripted answer under
 * full-suite load — so wait until the model has been quiet for a moment before scripting. */
async function settle(quietMs = 400, maxMs = 8000) {
  const end = Date.now() + maxMs;
  let n = fake.state.requests.length;
  while (Date.now() < end) { await sleep(quietMs); if (fake.state.requests.length === n) return; n = fake.state.requests.length; }
}

async function text(from, body, guid) {
  const r = await ctx.fetch("/api/webhooks/bluebubbles", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "new-message",
      data: { guid: `p:0/hidden-${++n}`, text: body, isFromMe: false, dateCreated: Date.now(), handle: { address: from, service: "iMessage" }, chats: [{ guid: guid ?? `iMessage;-;${from}` }] },
    }),
  });
  return { status: r.status, data: await r.json() };
}
async function waitForRequests(atLeast, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fake.state.requests.length >= atLeast) return true;
    await sleep(50);
  }
  return false;
}
/** What the model was handed by tools since request `from`. */
const toolResults = (from) => JSON.stringify(fake.state.requests.slice(from).flatMap((q) => (q.messages ?? []).filter((m) => m.role === "tool" || m.tool_call_id)));
/** The briefing (the last user message) of the FIRST request of a turn — before any tool ran. */
const briefing = (i) => { const msgs = fake.state.requests[i]?.messages ?? []; return JSON.stringify(msgs[msgs.length - 1] ?? {}); };
/** A key/value in tool results, which arrive as JSON inside JSON (quotes escaped). */
const hasField = (s, key, val) => s.includes(`"${key}":${val}`) || s.includes(`\\"${key}\\":${val}`);
const toolNames = (i) => JSON.stringify((fake.state.requests[i]?.tools ?? []).map((t) => t.function?.name ?? t.name));

async function ask(client, message, conversationId = null) {
  const r = await client.req("/api/assistant", { method: "POST", body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function newChat(client, visibility) {
  const r = await client.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "t", visibility }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.conversation.visibility, visibility);
  return r.data.conversation.id;
}
async function memoryOf(client) { return (await client.req("/api/memory")).data.memory ?? []; }
async function waitRun(client, id, statuses, ms = 12000) {
  const t0 = Date.now();
  let run = null;
  while (Date.now() - t0 < ms) {
    run = (await client.req(`/api/runs/${id}`)).data?.run ?? null;
    if (run && statuses.includes(run.status)) return run;
    await sleep(150);
  }
  return run;
}
async function approveRun(client, runId) {
  const run = await waitRun(client, runId, ["waiting_for_approval"]);
  assert.equal(run?.status, "waiting_for_approval", JSON.stringify(run));
  const approvalId = run.steps.find((s) => s.approvalId)?.approvalId;
  assert.ok(approvalId, "the parked step names its approval");
  const d = await client.req(`/api/approvals/${approvalId}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  return waitRun(client, runId, ["completed", "partially_failed", "failed"]);
}

before(async () => {
  ctx = await startServer({ env: { HOMEOPS_CONNECTOR_SANDBOX: "1" } });
  alex = await makeSession(ctx, "m-alex");     // Owner
  morgan = await makeSession(ctx, "m-morgan"); // Adult Admin — the hidden events are hers
  fake = await useFakeModel(alex);

  for (const [memberId, value, verified] of [["m-morgan", MORGAN_NUM, true], ["m-morgan", SHARED_NUM, true], ["m-alex", SHARED_NUM, false], ["m-alex", ALEX_NUM, true]]) {
    const cm = await alex.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ memberId, label: "Mobile", type: "Phone/Text", value, verified, optInStatus: verified ? "Opted In" : "Pending" }) });
    assert.equal(cm.status, 200, JSON.stringify(cm.data));
  }

  const day = (d, h) => { const t = new Date(Date.now() + d * 86400000); t.setUTCHours(h, 0, 0, 0); return t.toISOString(); };
  const make = async (title, startAt, endAt) => {
    const r = await morgan.req("/api/events", { method: "POST", body: JSON.stringify({ title, startAt, endAt, visibility: "household" }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return readStoreRecord(ctx, "events", r.data.event.id);
  };
  const work = await make(WORK_TITLE, day(2, 14), day(2, 15));
  hh = work.householdId;
  // Morgan's Work calendar. A Google source pinned to an account that does not exist, so the
  // household refresh a write kicks answers no_account and never prunes the seeded events.
  writeStoreRecord(ctx, "calendar_subscriptions", "sub_morgan_work", {
    id: "sub_morgan_work", householdId: hh, source: "google", accountId: "acct_missing", name: "Morgan — Work",
    ownerActorId: "m-morgan", isWork: true, createdBy: "m-morgan", createdAt: new Date().toISOString(),
  });
  writeStoreRecord(ctx, "events", work.id, { ...work, layer: "linked", ownerId: "m-morgan", provenance: { via: "google", subscriptionId: "sub_morgan_work", uid: "u-work-1" } });
  workId = work.id;
  const party = await make(SURPRISE_TITLE, day(3, 23), day(4, 2));
  writeStoreRecord(ctx, "events", party.id, { ...party, ownerId: "m-morgan", notes: SURPRISE_NOTES, shareState: "hidden" });
  surpriseId = party.id;
  const haircut = await make(HAIRCUT_TITLE, day(1, 18), day(1, 19));
  writeStoreRecord(ctx, "events", haircut.id, { ...haircut, ownerId: "m-morgan", shareState: "hidden" });
  haircutId = haircut.id;

  // The family group thread, bound by an adult (binding asks for the Trusted stance; the
  // household then goes back to Balanced, so a High-risk step still parks for approval).
  const s = await alex.req("/api/settings", { method: "POST", body: JSON.stringify({ autonomy: "Trusted" }) });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  await text(ALEX_NUM, "starting a thread", GROUP_GUID);
  const list = await alex.req("/api/group-chats");
  const chatId = list.data.chats.find((c) => c.chatGuid === GROUP_GUID).id;
  const bound = await alex.req("/api/group-chats", { method: "POST", body: JSON.stringify({ chatId }) });
  assert.equal(bound.status, 200, JSON.stringify(bound.data));
  const b = await alex.req("/api/settings", { method: "POST", body: JSON.stringify({ autonomy: "Balanced" }) });
  assert.equal(b.status, 200, JSON.stringify(b.data));
});
after(async () => { await stopServer(ctx); try { fake.server.close(); } catch { /* best effort */ } });

test("the owner hears her hidden Work event in full on a Personal Ask turn; the briefing never carries her surprise", async () => {
  const from = fake.state.requests.length;
  fake.state.script.push({ toolCalls: [{ name: "famili__list_events", args: {} }] }, { text: "Here's your week." });
  await ask(morgan, "what is on my calendar this week?", await newChat(morgan, "personal"));
  const seen = toolResults(from);
  assert.ok(seen.includes(WORK_TITLE), "her own Work event, in full");
  assert.ok(seen.includes(SURPRISE_TITLE) && seen.includes("Rosa"), "alone with the assistant, her surprise is hers to hear");
  const brief = briefing(from);
  assert.ok(brief.includes(WORK_TITLE), "the briefing shows the owner her own Work event");
  assert.equal(brief.includes(SURPRISE_TITLE), false, "…but never a surprise, even in her own Personal chat");
  assert.ok(brief.includes("Private event"), "it is there as a private event at its time");
});

test("the household Owner — and anyone else — gets only the block, however private his chat", async () => {
  const from = fake.state.requests.length;
  fake.state.script.push({ toolCalls: [{ name: "famili__list_events", args: {} }] }, { text: "Morgan's working Thursday." });
  await ask(alex, "what's morgan doing this week?", await newChat(alex, "personal"));
  const seen = toolResults(from) + briefing(from);
  for (const secret of [WORK_TITLE, SURPRISE_TITLE, "Rosa", HAIRCUT_TITLE]) assert.equal(seen.includes(secret), false, `the Owner never sees "${secret}"`);
  assert.ok(seen.includes("Morgan Harper working"), "her Work time is a block");
  assert.ok(seen.includes("Morgan Harper busy"), "her hand-hidden time is a block");
  assert.ok(hasField(toolResults(from), "hidden", "true"), "the block tells the model it is hidden time");
});

test("a search cannot find a hidden event by its title", async () => {
  const from = fake.state.requests.length;
  fake.state.script.push({ toolCalls: [{ name: "famili__list_events", args: { query: "haircut" } }] }, { text: "Nothing like that." });
  await ask(alex, "is anyone getting a haircut?");
  const seen = toolResults(from);
  assert.ok(hasField(seen, "count", "0"), `the query ran on what Alex may read: ${seen.slice(0, 300)}`);
});

test("the owner's surprise is WITHHELD in a Family Ask chat and a nest chat — her Work event is still hers", async () => {
  const family = await newChat(morgan, "household");
  writeStoreRecord(ctx, "conversations", "conv_morgan_nest", { id: "conv_morgan_nest", householdId: hh, actorId: "m-morgan", title: "Nest", visibility: "nest", nestId: "nest_morgan_x", messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  for (const conv of [family, "conv_morgan_nest"]) {
    const from = fake.state.requests.length;
    fake.state.script.push({ toolCalls: [{ name: "famili__list_events", args: {} }] }, { text: "Here's the week." });
    await ask(morgan, "what's on my calendar this week?", conv);
    const seen = toolResults(from);
    assert.ok(seen.includes(WORK_TITLE), `${conv}: asking counts as consent for her Work event`);
    assert.equal(seen.includes(SURPRISE_TITLE) || seen.includes("Rosa"), false, `${conv}: the surprise is withheld where others can read`);
    assert.ok(seen.includes("Private event") && /Personal chat/.test(seen), `${conv}: she learns it exists, and where to ask`);
    assert.equal(toolNames(from).includes("calendar__list") || toolNames(from).includes("mscal__list"), false, `${conv}: no raw calendar reader on a shared turn`);
  }
});

test("the raw provider calendar readers ARE offered where the asker is alone (so their absence above means something)", async () => {
  const from = fake.state.requests.length;
  fake.state.script.push({ text: "ok" });
  await ask(alex, "list my google calendar events this week");
  assert.ok(toolNames(from).includes("calendar__list"), `calendar.list is on a self turn: ${toolNames(from).slice(0, 400)}`);
  const from2 = fake.state.requests.length;
  fake.state.script.push({ text: "ok" });
  await ask(alex, "list my google calendar events this week", await newChat(alex, "household"));
  assert.equal(toolNames(from2).includes("calendar__list"), false, "…and not on a shared one");
  assert.equal(toolNames(from2).includes("mscal__list"), false);
});

test("in the group thread the owner hears her Work event, never her surprise", async () => {
  const from = fake.state.requests.length;
  fake.state.script.push({ toolCalls: [{ name: "famili__list_events", args: {} }] }, { text: "You've got your review Thursday." });
  const r = await text(MORGAN_NUM, "@famili what's on my calendar this week?", GROUP_GUID);
  assert.equal(r.data.kind, "wake_accepted", JSON.stringify(r.data));
  assert.ok(await waitForRequests(from + 2), "the group turn ran and called a tool");
  const seen = toolResults(from);
  assert.ok(seen.includes(WORK_TITLE), "the owner asking in the group is consent for her Work event");
  assert.equal(seen.includes(SURPRISE_TITLE) || seen.includes("Rosa"), false, "a surprise is never spoken in the group thread");
  assert.ok(seen.includes("Private event"));
  assert.equal(briefing(from).includes(SURPRISE_TITLE), false);
});

test("a 1:1 text: full from a number only she has, withheld from a number two members share", async () => {
  let from = fake.state.requests.length;
  fake.state.script.push({ toolCalls: [{ name: "famili__list_events", args: {} }] }, { text: "Your party is Saturday." });
  let r = await text(MORGAN_NUM, "what's on my calendar this week?");
  assert.equal(r.data.handled, true, JSON.stringify(r.data));
  assert.ok(await waitForRequests(from + 2));
  assert.ok(toolResults(from).includes(SURPRISE_TITLE), "her own number: she is alone with the assistant");

  from = fake.state.requests.length;
  fake.state.script.push({ toolCalls: [{ name: "famili__list_events", args: {} }] }, { text: "There's a private event Saturday." });
  r = await text(SHARED_NUM, "what's on my calendar this week?");
  assert.equal(r.data.handled, true, JSON.stringify(r.data));
  assert.ok(await waitForRequests(from + 2));
  const seen = toolResults(from);
  assert.ok(seen.includes(WORK_TITLE), "the shared number still resolves to Morgan");
  assert.equal(seen.includes(SURPRISE_TITLE), false, "a phone two members share is not a place she is alone");
  assert.ok(seen.includes("Private event"));
});

test("a turn that released a surprise records NOTHING: no write_memory, no exchange capture, a secret run the run judge skips", async () => {
  fake.state.memoryJudge = { remember: true, type: "fact", text: MEMORY_SECRET, about: "household" };
  const conv = await newChat(morgan, "personal");
  const from = fake.state.requests.length;
  fake.state.script.push(
    // A run created BEFORE the surprise comes up in the turn — stamped secret when it ends.
    { toolCalls: [{ name: "homeops__create_approval", args: { subject: "Party budget", detail: "Sign off on $200" } }] },
    { toolCalls: [{ name: "famili__list_events", args: {} }] },
    { toolCalls: [{ name: "homeops__write_memory", args: { text: MEMORY_SECRET, scope: "personal" } }] },
    { text: "Your surprise party is Saturday at Rosa's. I didn't save anything." },
  );
  const out = await ask(morgan, "remind me what I planned for the surprise party", conv);
  const seen = toolResults(from);
  assert.ok(seen.includes(SURPRISE_TITLE), "the surprise was handed over (self audience)");
  assert.match(seen, /private_turn/, "write_memory refused for the rest of the turn");
  const call = (out.toolCalls ?? []).find((c) => c.tool === "homeops.create_approval");
  assert.ok(call?.runId, JSON.stringify(out.toolCalls));

  await sleep(1500); // the exchange capture would have run by now
  for (const who of [morgan, alex]) {
    assert.equal((await memoryOf(who)).some((m) => m.text === MEMORY_SECRET), false, `${who.actorId}: nothing remembered from the turn`);
  }

  const stored = readStoreRecord(ctx, "runs", call.runId);
  assert.equal(stored.sourceRef?.secret, true, "a run created in the turn is secret");
  assert.equal((await alex.req(`/api/runs/${call.runId}`)).status, 404, "another adult — the Owner — cannot fetch it");
  assert.equal(((await alex.req("/api/runs")).data.runs ?? []).some((r) => r.id === call.runId), false, "…or list it");
  assert.equal((await morgan.req(`/api/runs/${call.runId}`)).status, 200, "its requester can");

  const done = await approveRun(morgan, call.runId);
  assert.equal(done?.status, "completed", JSON.stringify(done));
  await sleep(1500); // the run judge would have written by now
  for (const who of [morgan, alex]) {
    assert.equal((await memoryOf(who)).some((m) => m.text === MEMORY_SECRET), false, `${who.actorId}: the run judge skipped the secret run`);
  }
});

test("a sourceRef.secret or audience in a request body is dropped — only the server stamps them", async () => {
  const r = await morgan.req("/api/runs/start", { method: "POST", body: JSON.stringify({ plan: { title: "x", steps: [{ toolId: null, title: "think", detail: "", input: {} }] }, sourceRef: { secret: true, audience: "self" } }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const stored = readStoreRecord(ctx, "runs", r.data.run.id);
  assert.equal(stored.sourceRef?.secret, undefined);
  assert.equal(stored.sourceRef?.audience, undefined);
});

test("a normal Personal-chat run remembers in PERSONAL scope, authored by the asker — not the household", async () => {
  fake.state.memoryJudge = { remember: false };
  await settle();
  const conv = await newChat(morgan, "personal");
  fake.state.script.push({ toolCalls: [{ name: "homeops__create_approval", args: { subject: "Coffee order", detail: "Oat milk" } }] }, { text: "Queued." });
  const out = await ask(morgan, "ask for sign-off on the coffee order with oat milk", conv);
  const call = (out.toolCalls ?? []).find((c) => c.tool === "homeops.create_approval");
  assert.ok(call?.runId, JSON.stringify(out.toolCalls));
  assert.equal(readStoreRecord(ctx, "runs", call.runId).sourceRef?.secret, undefined, "no surprise in this turn");
  await sleep(1500); // let the exchange judge (remember:false) pass first
  fake.state.memoryJudge = { remember: true, type: "preference", text: MEMORY_NORMAL };
  const done = await approveRun(morgan, call.runId);
  assert.equal(done?.status, "completed", JSON.stringify(done));
  let mine = [];
  for (let i = 0; i < 30 && !mine.length; i++) { mine = (await memoryOf(morgan)).filter((m) => m.text === MEMORY_NORMAL); if (!mine.length) await sleep(200); }
  assert.equal(mine.length, 1, "the run judge wrote it");
  assert.equal(mine[0].scope, "personal", "a Personal chat's run remembers as personal");
  assert.equal(mine[0].source?.actorId, "m-morgan");
  assert.equal((await memoryOf(alex)).some((m) => m.text === MEMORY_NORMAL), false, "the Owner does not see it");
  fake.state.memoryJudge = { remember: false };
});

test("someone else's hidden event cannot be changed or cancelled — event_hidden; the owner cancels her own", async () => {
  let from = fake.state.requests.length;
  fake.state.script.push(
    { toolCalls: [{ name: "famili__update_event", args: { eventId: haircutId, title: "Moved" } }] },
    { toolCalls: [{ name: "famili__delete_event", args: { eventId: haircutId } }] },
    { text: "That's Morgan's and hidden." },
  );
  await ask(alex, "cancel the thing morgan has tomorrow");
  const refused = toolResults(from);
  assert.equal((refused.match(/event_hidden/g) ?? []).length >= 2, true, `both refused: ${refused.slice(0, 400)}`);
  assert.equal(refused.includes(HAIRCUT_TITLE), false, "the refusal never names what it is");
  assert.ok(readStoreRecord(ctx, "events", haircutId), "still there");

  from = fake.state.requests.length;
  fake.state.script.push({ toolCalls: [{ name: "famili__delete_event", args: { eventId: haircutId } }] }, { text: "Cancelled your haircut." });
  await ask(morgan, "cancel the haircut I have tomorrow");
  assert.ok(hasField(toolResults(from), "deleted", "true"), "the owner cancels her own hidden event");
  assert.ok(!readStoreRecord(ctx, "events", haircutId), "gone");
});
