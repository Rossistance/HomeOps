// A GROUP CHAT CONTAINS PEOPLE WHO NEVER AGREED TO ANY OF THIS.
//
// Famili sits in a family's own iMessage thread, and the family does not own that thread.
// The neighbour running the carpool, the coach, the friend added for one weekend: none of
// them installed anything, none of them read a disclosure, and none of them can be asked.
// What the household's own members write is theirs to keep. Everyone else's words are not,
// and the rule pinned here is that the database never learns them.
//
// The split is structural rather than a filter someone remembers to apply later. A
// non-member's message reaches the in-memory classifier window, because without it "yes,
// 4pm works" reads as a member agreeing with nobody, and it stops there: no row, no
// survival across a restart, no export. What persists about a stranger is a salted
// per-chat hash of their handle and a count, which is how a chat can say "two people we
// don't know" without holding who they are. Pseudonymous, not anonymous, and the word is
// deliberate: a ten-digit space is small, and the salt sits in the same database.
//
// The second half of the file is the other side of that bargain, and it is deliberately
// asymmetric. Binding takes an authenticated adult whose household has already granted
// Famili the right to speak. Revoking takes nothing at all: anyone in the thread, member
// or not, verified or not, ends it with one word, and the transcript goes immediately
// rather than ageing out of a retention window. A stop that only stops eventually is not
// a stop, and a stranger should not have to prove who they are to be left alone.
//
// nonMemberMessageCount on every decision row is what keeps the first rule auditable.
// Precision has to be measurable on a surface that speaks unprompted; the text is gone by
// design, so the count is the only thing left that can say what the classifier was reading
// when it decided.
//
// ONE TEST HERE IS RED ON PURPOSE. See "the announcement has to go out" below: the bind
// route cannot currently succeed under any grant, so it is asserted as it is supposed to
// behave rather than as it behaves. Every other test seeds the bound state directly so the
// third-party rules are genuinely pinned instead of blocked behind that defect.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Chosen before anything that touches the store is imported: the last test drives
// triageChat in this process, and ../store.mjs resolves its data dir at import time.
process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-group3p-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession, readStoreDoc, readStoreRecord, writeStoreRecord } = await import("./harness.mjs");
const { runWithTenant, listChatDecisions } = await import("../store.mjs");
const { isStopRequest, pushWindow } = await import("../group-chat.mjs");
const { triageChat } = await import("../group-triage.mjs");

const MEMBER_NUM = "+15550107001";      // m-alex, verified and opted in below
const OUTSIDER = "+15550109042";        // in the thread, in nobody's household
const OUTSIDER_DIGITS = OUTSIDER.replace(/\D/g, "");
const CHAT_GUID = "iMessage;+;chat-third-parties";

let ctx, alex, chatId;
let n = 0;

/** One inbound GROUP delivery, in the layout BlueBubbles Server posts. */
async function post(address, text) {
  const payload = {
    type: "new-message",
    data: {
      guid: `p:0/3p-${++n}`, text, isFromMe: false, dateCreated: Date.now(),
      handle: { address, service: "iMessage" },
      chats: [{ guid: CHAT_GUID }],
    },
  };
  const r = await ctx.fetch("/api/webhooks/bluebubbles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: r.status, data: await r.json() };
}

/** Every durable message row this chat owns, read out of the spawned server's own db. */
const messageRows = () =>
  Object.values(readStoreDoc(ctx, "imessage_messages.json", {})).filter((m) => m.chatGuid === CHAT_GUID);
const chatRecord = () => readStoreRecord(ctx, "imessage_chats", chatId);

/**
 * Put the chat into the state a successful bind leaves behind.
 *
 * The bind route cannot reach that state today (see the failing test below), and the rules
 * this file exists to pin are all rules about a BOUND chat: what gets written, what never
 * does, and what a stranger can end. So the record is moved with exactly the patch bindChat
 * writes, and the inbound path is then exercised for real. Idempotent, and it stops doing
 * anything the day the announcement can go out.
 */
function ensureBound() {
  const rec = chatRecord();
  if (rec.status === "bound") return;
  const now = new Date().toISOString();
  writeStoreRecord(ctx, "imessage_chats", chatId, {
    ...rec, status: "bound", boundBy: "m-alex", boundAt: now, announcedAt: now,
    speakGrant: "household_trusted", updatedAt: now,
  });
}

before(async () => {
  // The connector sandbox is a transport twin, not a consent bypass (server/test/
  // README-sandbox.md): every gate still runs, so a send here is a real decision that
  // simply never opens a socket.
  ctx = await startServer({ env: { HOMEOPS_CONNECTOR_SANDBOX: "1" } });
  alex = await makeSession(ctx, "m-alex"); // Owner
  const cm = await alex.req("/api/contact-methods", {
    method: "POST",
    body: JSON.stringify({ memberId: "m-alex", label: "Mobile", type: "Phone/Text", value: MEMBER_NUM, verified: true, optInStatus: "Opted In" }),
  });
  assert.equal(cm.status, 200, JSON.stringify(cm.data));
  // The speak grant has to exist BEFORE a bind, because the first thing a bind does is
  // introduce Famili in the thread. Trusted is the household-level form of that grant
  // (policy.mjs rule 7), honoured only because an Owner is the one asking.
  const s = await alex.req("/api/settings", { method: "POST", body: JSON.stringify({ autonomy: "Trusted" }) });
  assert.equal(s.status, 200, JSON.stringify(s.data));
});
after(async () => { await stopServer(ctx); });

test("the chat becomes visible only once a VERIFIED MEMBER has spoken in it", async () => {
  const seen = await post(MEMBER_NUM, "starting a thread about Saturday");
  assert.equal(seen.status, 200, "the bridge is always acknowledged");
  assert.equal(seen.data.ignored, "chat_not_bound", `nothing is said back into an unbound thread: ${JSON.stringify(seen.data)}`);

  const list = await alex.req("/api/group-chats");
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.canSpeak, true, `an Owner set the household to Trusted, so the grant exists: ${JSON.stringify(list.data)}`);
  assert.equal(list.data.speakGrant, "household_trusted", JSON.stringify(list.data));
  const pending = list.data.chats.find((c) => c.chatGuid === CHAT_GUID);
  assert.ok(pending, `an adult can find the chat in the app: ${JSON.stringify(list.data.chats)}`);
  assert.equal(pending.status, "pending", JSON.stringify(pending));
  assert.equal(pending.unknownParticipantCount, 0, JSON.stringify(pending));
  chatId = pending.id;
});

test("KNOWN DEFECT: binding is an adult's act and the announcement has to go out for it to count", async () => {
  // Asserted as designed, not as built. bindChat refuses to half-join and that part is
  // right; what is wrong is one layer down. speakToChat asks the policy engine, gets
  // ALLOWED (household Trusted, a risk override, the helper's unattended grant; all three
  // were tried), and then calls executeToolForChat, which hands execResolved an
  // `approvalId` of literally `undefined`. executeTool then re-checks the CONNECTOR
  // definition's static `tool.requiresApproval` and refuses with approval_required,
  // because nothing told it the approval question had already been answered. sms.send is
  // therefore unreachable from the chat path under every grant this feature documents, so
  // no chat can ever be bound and the group surface can never say a word.
  const bound = await alex.req("/api/group-chats", { method: "POST", body: JSON.stringify({ chatId }) });
  assert.equal(bound.status, 200, `the announcement must be sendable once the grant exists: ${JSON.stringify(bound.data)}`);
  assert.equal(bound.data.chat.status, "bound", JSON.stringify(bound.data));
  assert.equal(bound.data.chat.speakGrant, "household_trusted", JSON.stringify(bound.data));
});

test("a VERIFIED MEMBER's words are written down: one durable row, attributed, indexed", async () => {
  ensureBound();
  const before = messageRows().length;

  const r = await post(MEMBER_NUM, "swim practice moved to 4pm on Saturday");
  assert.equal(r.data.handled, true, JSON.stringify(r.data));
  assert.equal(r.data.kind, "recorded", JSON.stringify(r.data));

  const rows = messageRows();
  assert.equal(rows.length, before + 1, `exactly one new row: ${JSON.stringify(rows)}`);
  const row = rows.find((m) => m.text === "swim practice moved to 4pm on Saturday");
  assert.ok(row, `the member's message is in imessage_messages: ${JSON.stringify(rows)}`);
  assert.equal(row.fromMemberId, "m-alex", JSON.stringify(row));
  assert.equal(row.direction, "in", JSON.stringify(row));
  assert.equal(row.householdId, "local", JSON.stringify(row));

  const chat = chatRecord();
  assert.ok(chat.recentMessageIds.includes(row.id), `and on the ring the classifier reads: ${JSON.stringify(chat.recentMessageIds)}`);
  assert.ok(Object.values(chat.messageIdsByDay).flat().includes(row.id), `and in the day bucket retention drops: ${JSON.stringify(chat.messageIdsByDay)}`);
});

test("a NON-MEMBER's words are NOT: no row at all, and what persists is a hash and a count", async () => {
  ensureBound();
  const before = messageRows().length;
  const hashesBefore = chatRecord().unknownParticipantHashes.length;

  const r = await post(OUTSIDER, "I can drive the girls if that helps");
  // The webhook answers the same way whatever it decided about the sender; the difference
  // is only ever visible in the database, which is where it is checked.
  assert.equal(r.data.handled, true, `the message is processed, not dropped: ${JSON.stringify(r.data)}`);

  const rows = messageRows();
  assert.equal(rows.length, before, `a stranger's message writes NO row: ${JSON.stringify(rows)}`);
  assert.equal(rows.some((m) => m.text.includes("drive the girls")), false, `their words are nowhere in the transcript: ${JSON.stringify(rows)}`);

  const chat = chatRecord();
  assert.equal(chat.unknownParticipantHashes.length, hashesBefore + 1, `one stranger, one entry: ${JSON.stringify(chat.unknownParticipantHashes)}`);
  const entry = chat.unknownParticipantHashes[hashesBefore];
  assert.notEqual(entry.h, OUTSIDER, "what is stored is not the handle itself");
  assert.equal(entry.h.includes(OUTSIDER_DIGITS), false, `nor does it carry the number's digits: ${entry.h}`);
  assert.match(entry.h, /^[0-9a-f]{32}$/, `it is a scrypt digest, not a formatting of the handle: ${entry.h}`);
  // The same question in its strongest form: nothing that persists about this chat spells
  // the stranger's number, in any field, under any name.
  assert.equal(JSON.stringify(chat).includes(OUTSIDER_DIGITS), false, `the handle is absent from the whole chat record: ${JSON.stringify(chat)}`);
  assert.equal(chat.knownParticipants.some((p) => p.handle === OUTSIDER), false, `and a stranger never joins knownParticipants: ${JSON.stringify(chat.knownParticipants)}`);
});

test("the same stranger again adds no second entry: dedupe works THROUGH the hash", async () => {
  ensureBound();
  const before = messageRows().length;
  const hashesBefore = chatRecord().unknownParticipantHashes.map((x) => x.h);

  const r = await post(OUTSIDER, "what time did you land on?");
  assert.equal(r.data.handled, true, JSON.stringify(r.data));

  const chat = chatRecord();
  assert.deepEqual(chat.unknownParticipantHashes.map((x) => x.h), hashesBefore, `one person stays one entry however much they say: ${JSON.stringify(chat.unknownParticipantHashes)}`);
  assert.equal(messageRows().length, before, "and still nothing of theirs is written down");
});

test("isStopRequest is deliberately narrow: a whole message, never a word inside a sentence", () => {
  for (const yes of ["stop", "Famili stop", "leave", "STOP", "  famili stop  ", "unsubscribe", "opt out"]) {
    assert.equal(isStopRequest(yes), true, `should end it: ${JSON.stringify(yes)}`);
  }
  for (const no of [
    "we should stop by the store on the way",
    "don't stop believing",
    "can you stop the reminder for Tuesday",
    "leave the key under the mat",
    "please leave a note for the sitter",
    "",
    "   ",
  ]) {
    // A sentence containing the word is a sentence. Treating it as a request to leave
    // would make the feature impossible to talk about in the chat it lives in.
    assert.equal(isStopRequest(no), false, `is talk, not a request to leave: ${JSON.stringify(no)}`);
  }
});

test("a NON-MEMBER's 'Famili stop' revokes the chat, and the transcript goes immediately", async () => {
  ensureBound();
  const doomed = messageRows().map((m) => m.id);
  assert.ok(doomed.length > 0, "there is a member transcript to destroy");

  const r = await post(OUTSIDER, "Famili stop");
  assert.equal(r.data.handled, true, JSON.stringify(r.data));
  assert.equal(r.data.kind, "revoked", `binding takes an adult; this takes nothing: ${JSON.stringify(r.data)}`);

  const chat = chatRecord();
  assert.equal(chat.status, "revoked", JSON.stringify(chat));
  assert.equal(chat.revokedBy, "participant", `ended by someone this household has never heard of: ${JSON.stringify(chat)}`);

  // Immediately, not at the next retention sweep: every row that existed is gone now.
  const surviving = messageRows().map((m) => m.id);
  assert.deepEqual(doomed.filter((id) => surviving.includes(id)), [], `no message row outlives the revoke: ${JSON.stringify(messageRows())}`);
  assert.equal(messageRows().some((m) => m.direction === "in"), false, `nothing inbound is left to sweep later: ${JSON.stringify(messageRows())}`);
  assert.deepEqual(chat.messageIdsByDay, {}, `and the indexes that pointed at them are empty: ${JSON.stringify(chat.messageIdsByDay)}`);
  assert.deepEqual(chat.recentMessageIds, [], JSON.stringify(chat.recentMessageIds));

  // It stays gone: not offered in the app, and not re-bindable by an adult either.
  const list = await alex.req("/api/group-chats");
  assert.equal(list.data.chats.some((c) => c.chatGuid === CHAT_GUID), false, JSON.stringify(list.data.chats));
  const rebind = await alex.req("/api/group-chats", { method: "POST", body: JSON.stringify({ chatId }) });
  assert.equal(rebind.status, 409, JSON.stringify(rebind.data));
  assert.equal(rebind.data.error, "chat_revoked", JSON.stringify(rebind.data));

  // And a later message in that thread is not recorded, not answered, not learned from.
  const after = await post(MEMBER_NUM, "are you still there?");
  assert.equal(after.data.ignored, "chat_not_bound", JSON.stringify(after.data));
  assert.equal(messageRows().length, 0, `still nothing: ${JSON.stringify(messageRows())}`);
});

test("the decision log counts what it deliberately did not keep: nonMemberMessageCount", async () => {
  // In-process and in a household of its own: this is the one assertion that has to read a
  // chat_decisions row exactly as triage wrote it, rather than through a route that
  // summarises it. HOMEOPS_GROUP_FAKE is the documented test path: a bracketed directive
  // in the window drives the judgement and anything else is silence, so no provider is
  // needed to exercise the record-keeping.
  process.env.HOMEOPS_GROUP_FAKE = "1";
  const HH = "hh_group3p01";
  const GUID = "iMessage;+;chat-decision-counts";
  const now = Date.now();

  const chat = { id: "ich_counts", householdId: HH, chatGuid: GUID, recentMessageIds: [], messageIdsByDay: {} };
  pushWindow(GUID, { handle: MEMBER_NUM, memberId: "m-alex", text: "I'll bring the lasagna", atMs: now, isMember: true });
  pushWindow(GUID, { handle: OUTSIDER, memberId: null, text: "count me in for dessert", atMs: now, isMember: false });

  const verdict = await runWithTenant(HH, () => triageChat({ chat, nowMs: now }));
  assert.equal(verdict.decision, "silent", `nothing in that window is settled, so the answer is silence: ${JSON.stringify(verdict)}`);

  const rows = runWithTenant(HH, () => listChatDecisions((d) => d.chatGuid === GUID));
  assert.equal(rows.length, 1, `silence is written down too, or a dead listener looks like a quiet one: ${JSON.stringify(rows)}`);
  const row = rows[0];
  assert.equal(row.memberMessageCount, 1, JSON.stringify(row));
  assert.equal(row.nonMemberMessageCount, 1, `the stranger is counted, which is what makes the precision bar auditable: ${JSON.stringify(row)}`);
  assert.equal(JSON.stringify(row).includes("dessert"), false, `counted, never quoted: ${JSON.stringify(row)}`);
  assert.equal(JSON.stringify(row).includes("lasagna"), false, `and the member's text is digested, not copied: ${JSON.stringify(row)}`);
});
