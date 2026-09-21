/* Lane 2 routing: when Famili is being SPOKEN TO, and when it is only being talked about.
 *
 * The group path used to have one decision in it — is this a group? — and everything after
 * that was the passive classifier. There are now three lanes, and the one that decides
 * between them is a regex rather than a model, because that decision is what determines
 * whether a model runs at all. A regex is also the only part of this feature that can be
 * pinned exhaustively, so it is.
 *
 * THE ASSERTION THAT MATTERS MOST IS THE STOP ONE. "Famili stop" is the one message anybody
 * in the thread may send, member or not, and it has to revoke — never start a dense turn
 * with the prompt "stop". Ordering the stop check first is not sufficient on its own: the
 * stop matcher also has to RECOGNISE every way of addressing Famili that the wake matcher
 * taught the feature, or a sentence falls through one and into the other. That gap existed
 * and is pinned here.
 *
 * The strictness is deliberate and costs recall: "Famili what's on Saturday?" does not
 * match. That is not an oversight, it is a measurement — wakeNearMiss writes those down so
 * the rule can be widened later against a number instead of an argument.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-wake-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession, readStoreDoc, readStoreRecord, writeStoreRecord } = await import("./harness.mjs");
const { detectWake, wakeNearMiss, isStopRequest, takeTurnLease, releaseTurnLease, turnInFlight } = await import("../group-chat.mjs");

const MEMBER_NUM = "+15550107301";
const OUTSIDER = "+15550109301";
const CHAT_GUID = "iMessage;+;chat-wake-routing";

let ctx, alex, chatId;
let n = 0;

async function post(address, text, { bare = false } = {}) {
  const data = {
    guid: `p:0/wake-${++n}`, text, isFromMe: false, dateCreated: Date.now(),
    handle: { address, service: "iMessage" },
    ...(bare ? {} : { chats: [{ guid: CHAT_GUID }] }),
  };
  const r = await ctx.fetch("/api/webhooks/bluebubbles", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "new-message", data }),
  });
  return { status: r.status, data: await r.json() };
}

const chatRecord = () => readStoreRecord(ctx, "imessage_chats", chatId);
const decisions = () => Object.values(readStoreDoc(ctx, "chat_decisions.json", {})).filter((d) => d.chatId === chatId || d.chatGuid === CHAT_GUID);

/** The audit is append-only JSONL, not a doc, so it is read off the spawned server's disk. */
function auditText() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === "audit.jsonl") out.push(fs.readFileSync(full, "utf8"));
    }
  };
  walk(ctx.dataDir);
  return out.join(String.fromCharCode(10));
}

before(async () => {
  ctx = await startServer({ env: { HOMEOPS_CONNECTOR_SANDBOX: "1" } });
  alex = await makeSession(ctx, "m-alex");
  const cm = await alex.req("/api/contact-methods", {
    method: "POST",
    body: JSON.stringify({ memberId: "m-alex", label: "Mobile", type: "Phone/Text", value: MEMBER_NUM, verified: true, optInStatus: "Opted In" }),
  });
  assert.equal(cm.status, 200, JSON.stringify(cm.data));
  const s = await alex.req("/api/settings", { method: "POST", body: JSON.stringify({ autonomy: "Trusted" }) });
  assert.equal(s.status, 200, JSON.stringify(s.data));

  // Discover the chat, then bind it.
  await post(MEMBER_NUM, "starting a thread");
  const list = await alex.req("/api/group-chats");
  chatId = list.data.chats.find((c) => c.chatGuid === CHAT_GUID).id;
  const bound = await alex.req("/api/group-chats", { method: "POST", body: JSON.stringify({ chatId }) });
  assert.equal(bound.status, 200, `the chat has to be bound for any of this to be reachable: ${JSON.stringify(bound.data)}`);
});
after(async () => { await stopServer(ctx); });

/* ───────────────── 1. the matcher, exhaustively ───────────────── */

test("detectWake requires an EXPLICIT address, and strips it", () => {
  const yes = [
    ["@famili what is on saturday", "what is on saturday"],
    ["@familios add milk", "add milk"],
    ["hey famili, add milk to the list", "add milk to the list"],
    ["Hi Famili - move dinner", "move dinner"],
    ["ok famili: what is for dinner", "what is for dinner"],
    ["Famili: move dinner", "move dinner"],
    ["Famili, what is on saturday?", "what is on saturday?"],
    ["Famili?", ""],
    ["@famili", ""],
  ];
  for (const [text, prompt] of yes) {
    const got = detectWake(text);
    assert.ok(got, `"${text}" addresses Famili`);
    assert.equal(got.prompt, prompt, `the address is stripped from "${text}": ${JSON.stringify(got)}`);
  }
});

test("TALKING ABOUT Famili is not talking TO it", () => {
  /* The whole reason the matcher is strict. Each of these is a family having a conversation
   * in which the assistant is the subject, and answering any of them is exactly the
   * interrupting houseguest the passive lane exists to avoid. */
  for (const text of [
    "famili what is on saturday",        // bare name + space: the deliberate miss
    "we should ask Famili about it",
    "Famili is being weird lately",
    "did famili add that already",
    "that looks familiar to me",          // \b
    "la familia is coming over",          // \b
    "the family is coming over",          // not the name at all
  ]) {
    assert.equal(detectWake(text), null, `"${text}" is not an address: ${JSON.stringify(detectWake(text))}`);
  }
});

test("A NEAR MISS IS MEASURED, NOT GUESSED AT", () => {
  // The most natural phrasing there is, and it does not fire. Rather than widen the rule on
  // instinct, every one of these is recorded so the trade can be priced later.
  assert.equal(wakeNearMiss("Famili what is on saturday"), true);
  assert.equal(wakeNearMiss("famili add milk"), true);
  // Not a near miss: it already matched, so there is nothing to learn from it.
  assert.equal(wakeNearMiss("@famili add milk"), false);
  assert.equal(wakeNearMiss("Famili, add milk"), false);
  // Not a near miss: it is a stop, which is its own path entirely.
  assert.equal(wakeNearMiss("Famili stop"), false);
  // Not about Famili at all.
  assert.equal(wakeNearMiss("we should ask Famili about it"), false);
});

test("STOP OUTRANKS WAKE IN EVERY ADDRESS FORM — the gap that existed", () => {
  /* isStopRequest only knew the bare and comma forms. detectWake then taught the feature
   * three more ways to say the name, and "Famili: stop" / "@famili stop" / "hey famili
   * stop" fell straight through the stop check and matched the WAKE rule instead — which
   * would have answered a request to leave by starting a dense model turn with the prompt
   * "stop". Checking stop first does not help when the stop check cannot read the sentence. */
  for (const text of [
    "stop", "unsubscribe", "Famili stop", "Famili, stop", "Famili: stop",
    "@famili stop", "hey famili stop", "Famili; leave", "famili - stop", "@famili opt out",
  ]) {
    assert.equal(isStopRequest(text), true, `"${text}" is a request to leave`);
  }
  // …and the boundary holds in the other direction: a sentence containing the word is not.
  for (const text of ["Famili: add milk", "hey famili what is on saturday", "stop by the store on your way home"]) {
    assert.equal(isStopRequest(text), false, `"${text}" is not a request to leave`);
  }
});

/* ───────────────── 2. routing, through the real webhook ───────────────── */

test("no wake word is LANE 1: recorded, and nothing is said", async () => {
  const r = await post(MEMBER_NUM, "we should do pizza on friday i think");
  assert.equal(r.status, 200);
  assert.equal(r.data.kind, "recorded", `an ordinary message is overheard, not answered: ${JSON.stringify(r.data)}`);
});

test("a MEMBER's wake word is accepted for a Lane 2 turn", async () => {
  const r = await post(MEMBER_NUM, "@famili what is on the calendar this week?");
  assert.equal(r.status, 200);
  assert.equal(r.data.kind, "wake_accepted", `the turn is accepted and answered out of band: ${JSON.stringify(r.data)}`);
  /* The response is deliberately NOT the delivery channel: the answer arrives in the thread
   * as its own message, so the bridge's timeout and retry policy cannot decide whether the
   * family gets one. Nothing here asserts the answer's content — that is group-agent-turn. */
  assert.equal(r.data.reply, undefined, "the webhook response never carries the answer");
});

test("A NON-MEMBER'S WAKE WORD RUNS NOTHING, AND IS NOT TOLD WHY", async () => {
  const before = decisions().length;
  const r = await post(OUTSIDER, "@famili what is on the calendar this week?");
  assert.equal(r.status, 200, "the bridge is always acknowledged");
  assert.equal(r.data.kind, "recorded", `no turn is started: ${JSON.stringify(r.data)}`);

  /* The refusal reason is NOT in the response. A stranger learning their wake word was
   * refused for want of verification is a stranger learning this thread belongs to a
   * FamiliOS household — the one disclosure this whole design spends its time avoiding.
   * Same rule as the unverified "yes". */
  assert.equal(r.data.ignoredWake, undefined, `the response discloses nothing: ${JSON.stringify(r.data)}`);
  assert.equal(JSON.stringify(r.data).includes("verified"), false, JSON.stringify(r.data));

  assert.ok(auditText().includes("imessage.wake_unverified"),
    "it is written down internally, because a refusal nobody can see is a refusal nobody can debug");
  assert.equal(decisions().length, before, "and a non-member's near-miss is not logged either");
});

test("a near miss from a member is RECORDED as a silent decision", async () => {
  const before = decisions().filter((d) => d.reason === "wake_near_miss").length;
  const r = await post(MEMBER_NUM, "Famili what is on saturday");
  assert.equal(r.data.kind, "recorded", `still Lane 1 — it did not match: ${JSON.stringify(r.data)}`);
  const after = decisions().filter((d) => d.reason === "wake_near_miss");
  assert.equal(after.length, before + 1, `the miss is counted: ${JSON.stringify(after)}`);
  assert.equal(after.at(-1).decision, "silent", JSON.stringify(after.at(-1)));
});

test("'Famili stop' REVOKES — it never becomes a Lane 2 prompt", async () => {
  const r = await post(MEMBER_NUM, "Famili: stop");
  assert.equal(r.data.kind, "revoked", `the address form that used to fall through: ${JSON.stringify(r.data)}`);
  assert.equal(chatRecord().status, "revoked", JSON.stringify(chatRecord()));

  // And a wake word into a revoked chat is silence, not a turn.
  const after = await post(MEMBER_NUM, "@famili are you there?");
  assert.equal(after.data.kind, undefined, JSON.stringify(after.data));
  assert.equal(after.data.ignored, "chat_not_bound", `a revoked chat stays revoked: ${JSON.stringify(after.data)}`);
});

test("A WAKE WORD BUYS NO PATH PAST A GUARD THAT COULD NOT CLASSIFY THE THREAD", async () => {
  /* isGroup === null is the parser saying the delivery carried no chat context at all. That
   * used to collapse into `false` and run the one-to-one assistant on a group message. A
   * wake word must not be a way back into that: an unclassifiable delivery is refused for
   * free text whether or not it says the magic word. */
  const r = await post(MEMBER_NUM, "@famili what is on the calendar?", { bare: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.ignored, "unclassified_thread", `fails closed, wake word or not: ${JSON.stringify(r.data)}`);
  assert.equal(r.data.handled, undefined, JSON.stringify(r.data));
});

/* ───────────────── 3. the turn lease ───────────────── */

test("the lease is durable, exclusive, and only its holder may clear it", async () => {
  const { runWithTenant, putImessageChat, getImessageChat } = await import("../store.mjs");
  const HH = "local";
  const ID = "ich_wake_lease";
  const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

  await runWithTenant(HH, () => {
    putImessageChat({
      id: ID, householdId: HH, chatGuid: "iMessage;+;chat-lease", service: "iMessage", displayName: "",
      status: "bound", participantSalt: "0123456789abcdef0123456789abcdef",
      knownParticipants: [], unknownParticipantHashes: [], recentMessageIds: [], messageIdsByDay: {},
      createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(),
    });

    const chat = getImessageChat(ID);
    const first = takeTurnLease({ chat, messageGuid: "g1", actorId: "m-alex", atMs: NOW });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(turnInFlight(getImessageChat(ID), NOW), true, "the sweep can see it and will skip the chat");

    // A second wake word while one is live is refused — silently, by the caller.
    const second = takeTurnLease({ chat: getImessageChat(ID), messageGuid: "g2", actorId: "m-alex", atMs: NOW + 1000 });
    assert.equal(second.ok, false, `one turn at a time per chat: ${JSON.stringify(second)}`);
    assert.equal(second.error, "turn_in_flight", JSON.stringify(second));

    /* A turn that overran and finishes late must not clear the lease a reclaimer already
     * took, or two turns run side by side while the record says one does. */
    const stale = takeTurnLease({ chat: getImessageChat(ID), messageGuid: "g3", actorId: "m-alex", atMs: NOW + 400_000 });
    assert.equal(stale.ok, true, `an expired lease is reclaimable, or one crash wedges the chat forever: ${JSON.stringify(stale)}`);
    assert.equal(stale.reclaimed, true, JSON.stringify(stale));

    const zombie = releaseTurnLease({ chat: getImessageChat(ID), messageGuid: "g1" });
    assert.equal(zombie.ok, false, `the original holder cannot clear the reclaimer's lease: ${JSON.stringify(zombie)}`);
    assert.equal(getImessageChat(ID).activeTurn.messageGuid, "g3", "the reclaimer still holds it");

    const proper = releaseTurnLease({ chat: getImessageChat(ID), messageGuid: "g3" });
    assert.equal(proper.ok, true, JSON.stringify(proper));
    assert.equal(getImessageChat(ID).activeTurn, null, "and the chat is free again");
    assert.equal(turnInFlight(getImessageChat(ID), NOW + 400_000), false, JSON.stringify(getImessageChat(ID)));
  });
});
