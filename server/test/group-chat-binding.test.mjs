// A group chat is the one surface where Famili speaks to people who never signed up for it.
//
// Everything in the binding lifecycle is arranged so that Famili being in a thread is a
// thing the people in that thread can SEE. Four rules carry that weight, and each one is a
// place the feature could quietly turn into the opposite of itself:
//
// 1. SILENT UNTIL AN ADULT SAYS OTHERWISE. An unbound group chat gets no word back, ever.
//    The most a verified member's message can do is leave a `pending` row an adult finds in
//    the app; nothing goes into the thread, because nobody in it agreed to anything yet.
//
// 2. A STRANGER'S MESSAGE LEAVES NOTHING AT ALL. Writing a pending row for a handle that
//    belongs to no household would turn this endpoint into an oracle: post a guid, list the
//    chats, learn whether that number is in somebody's family. The refusal has to be total
//    rather than merely quiet, so this file asserts on the absence of the row and not just
//    on the absence of a reply.
//
// 3. THE SPEAK GRANT COMES BEFORE THE JOIN. The first thing a bind does is introduce Famili
//    in the thread, and that introduction is an sms.send: high-risk, and without the grant
//    it parks for approval, which would leave the bind neither done nor failed. So the bind
//    refuses up front, and the refusal names the screen that grants it rather than leaving
//    an adult to guess which of four dials it meant.
//
// 4. A FAILED ANNOUNCEMENT IS A FAILED BIND. This is the one this file exists for. The
//    tempting bug is the forgiving one: the announcement did not go out, but the record is
//    already written, so mark it bound and introduce ourselves later. That produces exactly
//    the thing the announcement exists to prevent, which is Famili reading a group thread
//    that was never told it is there. A silent join is not on the menu.
//
// The transport is the lever the last two are pinned with. A test server has no Mac behind
// the sms bridge, so the announcement genuinely fails and rule 4 is exercised for real
// rather than mocked; HOMEOPS_CONNECTOR_SANDBOX=1 is how the success path then gets its
// turn, with every consent gate still running ahead of the swap (README-sandbox.md).
//
// ── ONE TEST IN THIS FILE IS RED ON PURPOSE ────────────────────────────────────────────
// The success path (test 5) does not work, for a reason that has nothing to do with the
// transport and everything to do with two layers disagreeing about who grants an approval.
// The defect is described in full above that test. It is left failing rather than rewritten
// to match, because what it asserts is the feature: with the grant an Owner deliberately
// gave, Famili must be able to say hello, and today it cannot, in any household, by any
// grant route. A test bent to agree with that would retire the only signal there is.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Chosen BEFORE ../group-chat.mjs is pulled in, so the in-process import of announcementText
// below can never resolve the live server/.data. startServer still gives each spawned server
// its own separate dir.
process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-groupbind-"));
const { startServer, stopServer, makeSession, readStoreDoc, readStoreRecord } = await import("./harness.mjs");
const { announcementText } = await import("../group-chat.mjs");

process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const ALEX_NUM = "(555) 010-7711";
const ALEX_E164 = "+15550107711";
const ALEX_NAME = "Alex Harper";          // seed.mjs
const STRANGER = "+15553330000";
const HOUSEHOLD_NAME = "Maple Street";    // shares no substring with any member's name

const BOUND_GUID = "iMessage;+;chat-bind-plain";
const STRANGER_GUID = "iMessage;+;chat-bind-stranger";
const SANDBOX_GUID = "iMessage;+;chat-bind-sandbox";

let n = 0;
/** What BlueBubbles Server posts for a message in a GROUP thread: the ";+;" is the tell. */
const groupEvent = (chatGuid, address, text) => ({
  type: "new-message",
  data: {
    guid: `p:0/gb-${++n}`, text, isFromMe: false, dateCreated: Date.now(),
    handle: { address, service: "iMessage" }, chats: [{ guid: chatGuid }],
  },
});

async function postHook(ctx, payload) {
  const r = await ctx.fetch("/api/webhooks/bluebubbles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = null;
  try { data = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, data };
}

const listChats = async (client) => (await client.req("/api/group-chats")).data;
const rowFor = (listing, guid) => (listing.chats ?? []).find((c) => c.chatGuid === guid) ?? null;

/** A fresh server where Alex's mobile is verified and opted in, and the family has a name. */
async function bootHousehold(opts = {}) {
  const ctx = await startServer(opts);
  const owner = await makeSession(ctx, "m-alex");          // Owner
  const adult = await makeSession(ctx, "m-morgan");        // Adult Admin
  const named = await owner.req("/api/household", { method: "PATCH", body: JSON.stringify({ name: HOUSEHOLD_NAME }) });
  assert.equal(named.status, 200, JSON.stringify(named.data));
  const method = await owner.req("/api/contact-methods", {
    method: "POST",
    body: JSON.stringify({ memberId: "m-alex", label: "Mobile", type: "Phone/Text", value: ALEX_NUM, verified: true, optInStatus: "Opted In" }),
  });
  assert.equal(method.status, 200, JSON.stringify(method.data));
  return { ctx, owner, adult };
}

/** Grant agt_chat the right to speak: the top autonomy tier, set by an Owner. No household
 *  PIN is set on a fresh household, so requireHouseholdPin has nothing to check against. */
async function grantSpeak(owner) {
  const r = await owner.req("/api/helpers/agt_chat", { method: "PATCH", body: JSON.stringify({ autonomy: "full" }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.helper.autonomy, "full", JSON.stringify(r.data.helper));
  return r.data.helper;
}

let plain, sandbox;
before(async () => {
  plain = await bootHousehold();
  sandbox = await bootHousehold({ env: { HOMEOPS_CONNECTOR_SANDBOX: "1" } });
});
after(async () => {
  await stopServer(plain?.ctx);
  await stopServer(sandbox?.ctx);
});

/* ─────────────────── 1. an unbound chat is silent ─────────────────── */

test("an unbound group chat gets nothing back, and leaves only a pending row an adult can find", async () => {
  const r = await postHook(plain.ctx, groupEvent(BOUND_GUID, ALEX_E164, "who is picking up Noah on Thursday?"));
  assert.equal(r.status, 200, "the bridge is acknowledged either way; the answer is never in the status code");
  assert.equal(r.data.ignored, "chat_not_bound", JSON.stringify(r.data));
  assert.equal(r.data.handled ?? false, false, JSON.stringify(r.data));
  assert.equal(r.data.reply ?? null, null, "not a word goes back into a thread nobody bound");

  const listing = await listChats(plain.adult);
  const row = rowFor(listing, BOUND_GUID);
  assert.ok(row, `the chat is visible to an adult in the app: ${JSON.stringify(listing.chats)}`);
  assert.equal(row.status, "pending", JSON.stringify(row));
  assert.equal(row.boundBy, null, "pending means nobody has joined it yet");
  assert.equal(row.speakGrant, null, JSON.stringify(row));
  assert.deepEqual(row.knownParticipants.map((p) => p.memberId), ["m-alex"], "the member who spoke is on the record");
  assert.equal(row.messageCount, 0, "a pending chat keeps no transcript: nothing was bound when it arrived");
});

/* ───────── 2. a handle belonging to no household writes nothing at all ───────── */

test("a group message from a handle that matches NO household writes nothing and says nothing", async () => {
  const before = await listChats(plain.adult);
  const r = await postHook(plain.ctx, groupEvent(STRANGER_GUID, STRANGER, "is this the family thread?"));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ignored, "unknown_sender", JSON.stringify(r.data));
  assert.equal(r.data.reply ?? null, null, "a stranger gets no reply");

  const after = await listChats(plain.adult);
  assert.equal(rowFor(after, STRANGER_GUID), null, `no row for a stranger's thread: ${JSON.stringify(after.chats)}`);
  assert.equal(after.chats.length, before.chats.length, "and nothing else moved either");
  // The point of the absent row: listing chats must not be a way to learn that a number
  // belongs to some household on this deployment. Nothing written means nothing to read.
});

/* ───────── 3. binding requires the speak grant to ALREADY exist ───────── */

test("binding without the speak grant is refused, names where to grant it, and leaves the chat pending", async () => {
  const listing = await listChats(plain.adult);
  assert.equal(listing.canSpeak, false, "agt_chat ships with unattended disabled, so Famili cannot speak yet");
  assert.match(listing.speakBlockedReason ?? "", /Helpers/, listing.speakBlockedReason ?? "(no reason given)");

  const id = rowFor(listing, BOUND_GUID).id;
  const r = await plain.adult.req("/api/group-chats", { method: "POST", body: JSON.stringify({ chatId: id }) });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error, "speak_not_authorized", JSON.stringify(r.data));
  // Named, not implied: an adult told only "not authorized" has four dials to guess between.
  assert.match(r.data.message, /Owner/, r.data.message);
  assert.match(r.data.message, /Helpers/, r.data.message);
  assert.match(r.data.message, /Famili in chat/, r.data.message);

  const after = rowFor(await listChats(plain.adult), BOUND_GUID);
  assert.equal(after.status, "pending", JSON.stringify(after));
  assert.equal(after.boundBy, null, "a refused bind records nobody");
});

/* ───────── 4. the grant is there, the announcement is not: a FAILED BIND ───────── */

test("with the grant but no bridge, the announcement fails and so does the bind: a silent join is not on the menu", async () => {
  await grantSpeak(plain.owner);

  const listing = await listChats(plain.adult);
  assert.equal(listing.canSpeak, true, JSON.stringify(listing));
  assert.equal(listing.speakGrant, "helper_unattended", "the answer names WHICH grant applied, for the audit and the bind screen");

  const id = rowFor(listing, BOUND_GUID).id;
  const r = await plain.adult.req("/api/group-chats", { method: "POST", body: JSON.stringify({ chatId: id }) });
  // THE ASSERTION THIS FILE EXISTS FOR. No Mac behind the sms bridge in a test server, so the
  // introduction genuinely does not go out; the bind must fail with it rather than join
  // quietly and promise to say hello later.
  assert.equal(r.status, 502, JSON.stringify(r.data));
  assert.equal(r.data.error, "announcement_failed", JSON.stringify(r.data));
  assert.match(r.data.message, /haven't joined/, r.data.message);

  const after = rowFor(await listChats(plain.adult), BOUND_GUID);
  assert.equal(after.status, "pending", "the record stays PENDING: a half-bound chat is the state this refuses to create");
  assert.equal(after.boundBy, null, JSON.stringify(after));
  assert.equal(after.boundAt, null, JSON.stringify(after));
  assert.equal(after.speakGrant, null, "no grant is stamped on a chat that was never joined");

  const raw = readStoreRecord(plain.ctx, "imessage_chats", id);
  assert.equal(raw.announcedAt, null, "and nothing recorded an introduction that never happened");
});

/* ───────── 5. the success path, with the connector sandbox standing in for the Mac ───────── */

/* ╔══════════════════════════════════════════════════════════════════════════════════════╗
 * ║ THIS TEST IS RED, AND IT IS RED ABOUT THE IMPLEMENTATION, NOT ABOUT ITSELF.          ║
 * ╚══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * SYMPTOM: with the speak grant in place and the transport mocked, the bind still comes
 * back 502 announcement_failed. The audit line underneath it reads:
 *
 *   {"type":"tool.execute","toolId":"sms.send","connectorId":"sms","ok":false,
 *    "error":"approval_required"}
 *
 * CAUSE: two layers disagree about who cleared the gate. resolveEffectivePolicy says
 * ALLOWED (rule 6b, agent.unattended_high_risk) and executeToolForChat therefore executes
 * WITHOUT creating an approval; that is the whole meaning of the grant. It then calls
 * execResolved, which hands the connector layer `approvalConsumed: !!approvalId`
 * (server/engine.mjs:337), and approvalId is undefined precisely because the policy said no
 * approval was needed. server/connectors.mjs:447 re-reads the STATIC registry flag,
 * `tool.requiresApproval && !ctx.approvalConsumed`, and refuses. The policy decision never
 * reaches the layer that acts on it, so the grant can never be honoured for a connector
 * tool. Provider tools are unaffected: execResolved runs those itself and never re-asks.
 *
 * BLAST RADIUS, verified against a running server rather than reasoned about:
 *   • every grant route dies identically: helper autonomy "full" (helper_unattended) AND
 *     a household risk override with skipApproval (risk_override) both reach
 *     approval_required, so this is not about which dial was turned;
 *   • therefore NO group chat can ever be bound, in any household, sandbox or real Mac:
 *     the refusal happens before the transport is consulted at all;
 *   • and everything downstream of speakToChat is dead with it: the revoke
 *     acknowledgement, and every proposal the triage sweep might ever decide to speak.
 *
 * WHY IT IS MISLEADING AS WELL AS BROKEN: bindChat maps any send failure to
 * "I couldn't introduce myself in that chat", which reads as a bridge problem. An Owner
 * who has already granted the thing will go looking at their Mac.
 *
 * WHY THIS TEST IS NOT REWRITTEN TO MATCH: asserting 502 here would pin the dead feature as
 * correct. Rule 4 above (a failed announcement is a failed bind) is the behaviour this file
 * defends, and test 4 already pins it against a genuinely absent bridge; this test is the
 * other half, that the bind SUCCEEDS when the send does. The fix belongs in the engine or
 * the connector layer, not here, and this test goes green the moment it lands.
 */
test("with the sandbox transport and the grant in place, the bind succeeds and records how it was allowed", async () => {
  const seen = await postHook(sandbox.ctx, groupEvent(SANDBOX_GUID, ALEX_E164, "swim practice moved to Friday"));
  assert.equal(seen.data.ignored, "chat_not_bound", JSON.stringify(seen.data));
  await grantSpeak(sandbox.owner);

  const listing = await listChats(sandbox.owner);
  assert.equal(listing.canSpeak, true, JSON.stringify(listing));
  const id = rowFor(listing, SANDBOX_GUID).id;

  const r = await sandbox.owner.req("/api/group-chats", { method: "POST", body: JSON.stringify({ chatId: id, displayName: "Harper family" }) });
  assert.equal(r.status, 200, `KNOWN DEFECT: the grant is allowed by policy and then re-refused at connectors.mjs:447 as approval_required. See the block comment above. ${JSON.stringify(r.data)}`);
  assert.equal(r.data.chat.status, "bound", JSON.stringify(r.data));
  assert.equal(r.data.chat.speakGrant, "helper_unattended", JSON.stringify(r.data));

  const row = rowFor(await listChats(sandbox.owner), SANDBOX_GUID);
  assert.equal(row.status, "bound", JSON.stringify(row));
  assert.equal(row.boundBy, "m-alex", JSON.stringify(row));
  assert.ok(row.boundAt, "boundAt is stamped: a bind is an event with a time and a person on it");

  const raw = readStoreRecord(sandbox.ctx, "imessage_chats", id);
  assert.ok(raw.announcedAt, "announcedAt is set, and only ever by an announcement that actually went out");
  assert.equal(raw.speakGrant, "helper_unattended", JSON.stringify(raw));

  // What actually went over the bridge, so the stored record and the spoken words cannot
  // drift apart. The sandbox writes the would-be send verbatim, addressed by chat GUID,
  // which is also the proof that the GUID came from the STORED record and not from a body.
  const effects = readStoreDoc(sandbox.ctx, "sandbox_effects.json", []);
  const mine = effects.filter((e) => e.recipient === SANDBOX_GUID);
  assert.equal(mine.length, 1, `exactly one thing was said into that thread: ${JSON.stringify(effects)}`);
  assert.equal(mine[0].channel, "sms", JSON.stringify(mine[0]));
  assert.equal(mine[0].content, announcementText(ALEX_NAME), "the announcement sent is the announcement the next test reads");
  assert.equal(mine[0].content.includes(HOUSEHOLD_NAME), false, `and it still does not name the household: ${JSON.stringify(mine[0])}`);
});

/* ───────── 6. the announcement names a person, never the household ───────── */

test("the announcement names the member who connected it and nothing else identifying", async () => {
  // Asserted on the function itself. A group thread holds people who never chose FamiliOS,
  // and the announcement is the one thing they are told; a household name would hand every
  // one of them a fact about a family they are not in. A first name is already visible to
  // everyone in the thread, so naming the person who connected it costs nothing new.
  const text = announcementText(ALEX_NAME);
  assert.match(text, new RegExp(ALEX_NAME), text);
  assert.equal(text.includes(HOUSEHOLD_NAME), false, `the household's name is not a non-member's business: ${text}`);
  assert.equal(/Morgan|Noah/.test(text), false, `only the person who connected it is named: ${text}`);
  assert.equal(/household's own members/.test(text), true, `what is kept is stated, not implied: ${text}`);
  assert.match(text, /Famili stop/, "and the way out is in the same breath as the hello");
});

/* ───────── 7. revoking, and staying gone ───────── */

test("DELETE revokes the chat, and a re-bind is refused because Famili was asked to leave", async () => {
  // Deliberately not conditional on the bind above having worked. Binding takes an
  // authenticated adult; revoking takes nothing, and it is answered from whatever state the
  // chat is in; the asymmetry is the point, so this reads the same either way.
  const id = rowFor(await listChats(sandbox.owner), SANDBOX_GUID).id;
  const del = await sandbox.owner.req(`/api/group-chats/${id}`, { method: "DELETE" });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(del.data.ok, true, JSON.stringify(del.data));

  const raw = readStoreRecord(sandbox.ctx, "imessage_chats", id);
  assert.equal(raw.status, "revoked", JSON.stringify(raw));
  assert.equal(rowFor(await listChats(sandbox.owner), SANDBOX_GUID), null, "a revoked chat stops being offered in the app");

  const again = await sandbox.owner.req("/api/group-chats", { method: "POST", body: JSON.stringify({ chatId: id }) });
  assert.equal(again.status, 409, JSON.stringify(again.data));
  assert.equal(again.data.error, "chat_revoked", JSON.stringify(again.data));
  assert.match(again.data.message, /stays gone/, again.data.message);
});
