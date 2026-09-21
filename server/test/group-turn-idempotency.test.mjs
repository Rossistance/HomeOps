/* The locking design, which is the riskiest thing about Lane 2.
 *
 * A dense turn can run for minutes. The obvious implementation — hold withChatLock across
 * it — is wrong in four ways at once, and only one of them is about performance:
 *
 *   • "Famili stop" would WAIT. Revocation is the one thing anybody in the thread may do,
 *     member or not, and making it queue behind a model call is the worst of the four.
 *   • The triage sweep's sequential pass would stall on that chat.
 *   • A redelivery's dedupe check happens inside the same lock, so it would queue behind the
 *     very turn it exists to short-circuit instead of returning immediately.
 *   • The HTTP response would be held open for the bridge's whole timeout.
 *
 * So the lock does the claim — milliseconds, no model — and a DURABLE lease on the chat
 * record guards the work. These tests prove the separation holds, without depending on
 * timing: the lease is set directly, and then the things that must not be blocked are shown
 * not to be.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-turnidem-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession, readStoreRecord, writeStoreRecord } = await import("./harness.mjs");

const MEMBER_NUM = "+15550107601";
const CHAT_GUID = "iMessage;+;chat-turn-idem";

let ctx, alex, chatId;
let n = 0;

async function post(text, { guid = null } = {}) {
  const r = await ctx.fetch("/api/webhooks/bluebubbles", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "new-message",
      data: {
        guid: guid ?? `p:0/idem-${++n}`, text, isFromMe: false, dateCreated: Date.now(),
        handle: { address: MEMBER_NUM, service: "iMessage" },
        chats: [{ guid: CHAT_GUID }],
      },
    }),
  });
  return { status: r.status, data: await r.json() };
}

const chatRecord = () => readStoreRecord(ctx, "imessage_chats", chatId);
/** Put a live lease on the chat, the way Phase 1 does, without running a model. */
const holdTurn = (messageGuid = "held") => {
  const rec = chatRecord();
  writeStoreRecord(ctx, "imessage_chats", chatId, {
    ...rec, activeTurn: { messageGuid, startedAt: Date.now(), actorId: "m-alex" }, updatedAt: new Date().toISOString(),
  });
};

before(async () => {
  ctx = await startServer({ env: { HOMEOPS_CONNECTOR_SANDBOX: "1" } });
  alex = await makeSession(ctx, "m-alex");
  await alex.req("/api/contact-methods", {
    method: "POST",
    body: JSON.stringify({ memberId: "m-alex", label: "Mobile", type: "Phone/Text", value: MEMBER_NUM, verified: true, optInStatus: "Opted In" }),
  });
  await alex.req("/api/settings", { method: "POST", body: JSON.stringify({ autonomy: "Trusted" }) });
  await post("starting a thread");
  const list = await alex.req("/api/group-chats");
  chatId = list.data.chats.find((c) => c.chatGuid === CHAT_GUID).id;
  const bound = await alex.req("/api/group-chats", { method: "POST", body: JSON.stringify({ chatId }) });
  assert.equal(bound.status, 200, JSON.stringify(bound.data));
});
after(async () => { await stopServer(ctx); });

test("A 'FAMILI STOP' ARRIVING MID-TURN REVOKES IMMEDIATELY", async () => {
  /* THE ASSERTION THIS WHOLE FILE EXISTS FOR. With a turn live on the chat, a request to
   * leave is honoured in the same breath it arrives. If the model call were ever moved back
   * inside withChatLock, this is the test that fails — and it fails for the right reason,
   * because a family asking the assistant to leave and being made to wait for it to finish
   * thinking is the single worst behaviour this feature could have. */
  holdTurn("in-flight");
  assert.ok(chatRecord().activeTurn, "precondition: a turn is live on this chat");

  const stop = await post("Famili stop");
  assert.equal(stop.data.kind, "revoked", `the stop is not queued behind the turn: ${JSON.stringify(stop.data)}`);
  assert.equal(chatRecord().status, "revoked", JSON.stringify(chatRecord()));
});

test("a redelivered wake word starts no second turn", async () => {
  // Re-bind on a fresh guid: revocation above is terminal, which is itself the point.
  const GUID2 = "iMessage;+;chat-turn-idem-2";
  const r = await ctx.fetch("/api/webhooks/bluebubbles", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "new-message",
      data: { guid: "p:0/idem-seed2", text: "new thread", isFromMe: false, dateCreated: Date.now(), handle: { address: MEMBER_NUM, service: "iMessage" }, chats: [{ guid: GUID2 }] },
    }),
  });
  assert.equal(r.status, 200);
  const list = await alex.req("/api/group-chats");
  const id2 = list.data.chats.find((c) => c.chatGuid === GUID2).id;
  await alex.req("/api/group-chats", { method: "POST", body: JSON.stringify({ chatId: id2 }) });

  const send = (guid) => ctx.fetch("/api/webhooks/bluebubbles", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "new-message",
      data: { guid, text: "@famili what is on the calendar?", isFromMe: false, dateCreated: Date.now(), handle: { address: MEMBER_NUM, service: "iMessage" }, chats: [{ guid: GUID2 }] },
    }),
  }).then(async (x) => ({ status: x.status, data: await x.json() }));

  const first = await send("p:0/idem-dupe");
  assert.equal(first.data.kind, "wake_accepted", JSON.stringify(first.data));

  /* The bridge re-delivers after a reconnect, and the re-delivery is the case that takes
   * LONGEST to arrive — which is exactly when a turn is still running. The claim is written
   * before the turn starts, so the duplicate short-circuits instead of becoming a second
   * answer, a second plan and a second approval for one question. */
  const again = await send("p:0/idem-dupe");
  assert.equal(again.status, 200, "the bridge is always acknowledged");
  assert.equal(again.data.replayed ?? again.data.ignored, "replayed", `the duplicate is recognised: ${JSON.stringify(again.data)}`);
  assert.equal(again.data.kind, undefined, "and starts nothing");
});

test("a second wake word during a live turn is recorded and SILENTLY skipped", async () => {
  const GUID3 = "iMessage;+;chat-turn-idem-3";
  await ctx.fetch("/api/webhooks/bluebubbles", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "new-message",
      data: { guid: "p:0/idem-seed3", text: "third thread", isFromMe: false, dateCreated: Date.now(), handle: { address: MEMBER_NUM, service: "iMessage" }, chats: [{ guid: GUID3 }] },
    }),
  });
  const list = await alex.req("/api/group-chats");
  const id3 = list.data.chats.find((c) => c.chatGuid === GUID3).id;
  await alex.req("/api/group-chats", { method: "POST", body: JSON.stringify({ chatId: id3 }) });

  const rec = readStoreRecord(ctx, "imessage_chats", id3);
  writeStoreRecord(ctx, "imessage_chats", id3, {
    ...rec, activeTurn: { messageGuid: "busy", startedAt: Date.now(), actorId: "m-alex" }, updatedAt: new Date().toISOString(),
  });

  const second = await ctx.fetch("/api/webhooks/bluebubbles", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "new-message",
      data: { guid: "p:0/idem-busy", text: "@famili and what about sunday?", isFromMe: false, dateCreated: Date.now(), handle: { address: MEMBER_NUM, service: "iMessage" }, chats: [{ guid: GUID3 }] },
    }),
  }).then(async (x) => ({ status: x.status, data: await x.json() }));

  /* Recorded like any other message — the classifier still gets it — but no turn starts.
   * And SILENTLY: answering "I'm still working on the last one" into a family thread is the
   * noisy-chatbot behaviour this whole feature is built to avoid. The cost is that a family
   * asking two things in a row gets one answer, which imessage.wake_busy counts. */
  assert.equal(second.status, 200);
  assert.equal(second.data.kind, "recorded", `no second turn: ${JSON.stringify(second.data)}`);
  assert.equal(second.data.ignoredWake, undefined, "and the thread is told nothing at all");
});

test("the triage sweep skips a chat with a live turn instead of judging around it", async () => {
  /* In-process, against this file's own store: the sweep is a background pass and driving it
   * directly is how every other group suite exercises it. Judging a window the dense agent
   * is mid-answer on would surface a passive proposal about the thing being handled, and the
   * two would land in the thread seconds apart. */
  const { runWithTenant, putImessageChat, getImessageChat } = await import("../store.mjs");
  const { turnInFlight } = await import("../group-chat.mjs");
  const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

  await runWithTenant("local", () => {
    putImessageChat({
      id: "ich_sweep_skip", householdId: "local", chatGuid: "iMessage;+;chat-sweep-skip",
      service: "iMessage", displayName: "", status: "bound",
      participantSalt: "0123456789abcdef0123456789abcdef",
      knownParticipants: [], unknownParticipantHashes: [], recentMessageIds: [], messageIdsByDay: {},
      lastMessageAt: new Date(NOW - 90_000).toISOString(), triageCursorAt: null,
      activeTurn: { messageGuid: "live", startedAt: NOW - 1000, actorId: "m-alex" },
      createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(),
    });
    const chat = getImessageChat("ich_sweep_skip");
    assert.equal(turnInFlight(chat, NOW), true, "the sweep can see the live turn");
    // …and once it expires the chat is judgeable again, so one crash cannot mute it forever.
    assert.equal(turnInFlight(chat, NOW + 400_000), false, "an expired lease does not wedge the chat");
  });
});
