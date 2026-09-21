/* storeAllChatParticipants: one household deciding to keep the whole conversation.
 *
 * The default is unchanged and stays unchanged for everyone else, and that is the point.
 * This deployment is ONE Apple ID for every household, so a grandparent or a neighbour in a
 * family's thread has no relationship with FamiliOS at all — they never signed up, cannot
 * check what is kept, and did not choose any of it. Keeping their words is a decision made
 * on their behalf, so it is not made globally. A family whose thread is only ever family can
 * turn it on for their own chats; nobody's default moves.
 *
 * THE PROMISE IS THE HARD PART. Famili says out loud, at bind time, which policy it runs
 * under. Flipping the setting underneath that sentence turns it into a lie told to the
 * people least able to detect it. So the chats are told FIRST and the change only lands if
 * they all heard it — and turning it back off deletes what was kept, because the chat is
 * being told it is gone.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-storagepolicy-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession, readStoreDoc } = await import("./harness.mjs");
const { announcementText } = await import("../group-chat.mjs");

const MEMBER_NUM = "+15550107501";
const OUTSIDER = "+15550109501";
const OUTSIDER_DIGITS = OUTSIDER.replace(/\D/g, "");
const CHAT_GUID = "iMessage;+;chat-storage-policy";

let ctx, alex, chatId;
let n = 0;

async function post(address, text) {
  const r = await ctx.fetch("/api/webhooks/bluebubbles", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "new-message",
      data: {
        guid: `p:0/sp-${++n}`, text, isFromMe: false, dateCreated: Date.now(),
        handle: { address, service: "iMessage" },
        chats: [{ guid: CHAT_GUID }],
      },
    }),
  });
  return { status: r.status, data: await r.json() };
}

const rows = () => Object.values(readStoreDoc(ctx, "imessage_messages.json", {})).filter((m) => m.chatGuid === CHAT_GUID);
const nonMemberRows = () => rows().filter((m) => !m.fromMemberId && m.direction !== "out");
const setStoreAll = (v) => alex.req("/api/settings", { method: "POST", body: JSON.stringify({ storeAllChatParticipants: v }) });
/** Every message the sandbox recorded Famili sending, newest last. */
const spoken = () => Object.values(readStoreDoc(ctx, "sandbox_effects.json", {}))
  .flatMap((e) => (Array.isArray(e) ? e : [e]))
  .filter((e) => JSON.stringify(e).includes("Famili here"));

before(async () => {
  ctx = await startServer({ env: { HOMEOPS_CONNECTOR_SANDBOX: "1" } });
  alex = await makeSession(ctx, "m-alex");
  await alex.req("/api/contact-methods", {
    method: "POST",
    body: JSON.stringify({ memberId: "m-alex", label: "Mobile", type: "Phone/Text", value: MEMBER_NUM, verified: true, optInStatus: "Opted In" }),
  });
  await alex.req("/api/settings", { method: "POST", body: JSON.stringify({ autonomy: "Trusted" }) });
  await post(MEMBER_NUM, "starting a thread");
  const list = await alex.req("/api/group-chats");
  chatId = list.data.chats.find((c) => c.chatGuid === CHAT_GUID).id;
  const bound = await alex.req("/api/group-chats", { method: "POST", body: JSON.stringify({ chatId }) });
  assert.equal(bound.status, 200, JSON.stringify(bound.data));
});
after(async () => { await stopServer(ctx); });

test("DEFAULT OFF: a non-member's words are still not written down", async () => {
  const s = await alex.req("/api/settings");
  assert.equal(s.data.settings.storeAllChatParticipants, false,
    "off is the default, and it is the default for every household that is not this one");

  const before = rows().length;
  await post(OUTSIDER, "I can bring the dessert");
  assert.equal(rows().length, before, `no durable row: ${JSON.stringify(rows().map((r) => r.text))}`);
  assert.equal(JSON.stringify(rows()).includes("dessert"), false, "and nothing of theirs anywhere in the transcript");
});

test("the bind-time announcement states the policy ACTUALLY in force", () => {
  /* Byte for byte the original sentence when off — the promise made to every chat bound
   * before this setting existed does not get reworded underneath them. */
  const off = announcementText("Alex");
  assert.ok(off.includes("everyone else's stay unsaved"), off);
  const on = announcementText("Alex", { storeAll: true });
  assert.equal(on.includes("stay unsaved"), false, `the on-branch cannot repeat a promise it is not keeping: ${on}`);
  assert.ok(on.includes("I keep this chat's messages"), on);
  // Neither names the household: telling a non-member which family this is remains the
  // disclosure the whole design avoids.
  for (const text of [off, on]) assert.equal(/household of|the .* family/i.test(text), false, text);
});

test("TURNING IT ON TELLS THE CHAT FIRST, then keeps everyone's words", async () => {
  const saidBefore = spoken().length;
  const on = await setStoreAll(true);
  assert.equal(on.status, 200, JSON.stringify(on.data));
  assert.equal(on.data.settings.storeAllChatParticipants, true, JSON.stringify(on.data.settings));
  assert.ok(spoken().length > saidBefore, "the bound chat was told, because the sentence it heard at bind time just stopped being true");

  const before = nonMemberRows().length;
  // A member message in the same window, so the OFF test can prove the deletion is targeted
  // rather than a transcript wipe.
  await post(MEMBER_NUM, "sunday works for us");
  await post(OUTSIDER, "I will bring the pie on sunday");
  const after = nonMemberRows();
  assert.equal(after.length, before + 1, `now it is kept: ${JSON.stringify(after.map((r) => r.text))}`);

  const row = after.at(-1);
  assert.equal(row.fromMemberId, null, "attributed to no member, because they are not one");
  assert.ok(/^[0-9a-f]{32}$/.test(row.fromHandleHash ?? ""), `and to a hash instead: ${JSON.stringify(row)}`);

  /* THE RAW NUMBER IS STILL NOT STORED. Keeping the message is what the family chose.
   * Keeping a stranger's phone number is a second, larger decision, and nobody asked for
   * it — so the setting does not quietly grant it. */
  assert.equal(JSON.stringify(row).includes(OUTSIDER_DIGITS), false, `no raw handle on the row: ${JSON.stringify(row)}`);
  assert.equal(JSON.stringify(rows()).includes(OUTSIDER_DIGITS), false, "nor anywhere else in the transcript");
});

test("a non-member's words still cannot SETTLE anything, stored or not", async () => {
  /* Whether their words are KEPT and whether their words can put something on the family's
   * calendar are different questions. verifySpan answers the second one and the setting does
   * not reach it: a neighbour saying "let's do 4pm" is not this family deciding. */
  const { spanExists, verifySpan } = await import("../group-triage.mjs");
  const window = [{ text: "let's do 4pm", isMember: false, memberId: null }];
  assert.equal(spanExists("let's do 4pm", window).ok, true, "the quote is real — not a hallucination");
  const v = verifySpan("let's do 4pm", window);
  assert.equal(v.ok, false, "…and still cannot settle anything");
  assert.equal(v.error, "span_from_non_member",
    "recorded as a POLICY refusal, distinct from a model inventing its evidence");
});

test("TURNING IT OFF DELETES WHAT WAS KEPT", async () => {
  assert.ok(nonMemberRows().length > 0, "precondition: there is something to delete");
  const saidBefore = spoken().length;

  const off = await setStoreAll(false);
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(off.data.settings.storeAllChatParticipants, false, JSON.stringify(off.data.settings));

  assert.ok(spoken().length > saidBefore, "the chat is told the policy changed back");
  assert.equal(nonMemberRows().length, 0,
    `holding their words under a policy the household withdrew is the one outcome this must never produce: ${JSON.stringify(nonMemberRows())}`);
  assert.equal(JSON.stringify(rows()).includes("pie on sunday"), false, "gone from the indexes too, not just orphaned");

  /* TARGETED, NOT A WIPE. The household's own history is untouched, and so is Famili's —
   * outbound rows also carry no member id, and deleting those would tear holes in the
   * thread Famili reads back. */
  assert.ok(rows().some((m) => m.fromMemberId), `the household's own messages survive: ${JSON.stringify(rows().map((r) => ({ from: r.fromMemberId, dir: r.direction })))}`);
  assert.ok(JSON.stringify(rows()).includes("sunday works for us"), "the member's words are still there");
  assert.ok(rows().some((m) => m.direction === "out"), "and so is what Famili itself said");
});
