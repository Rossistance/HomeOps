// The group guard failed OPEN, and the bare payload layout is how you get through it.
//
// parseInboundWebhook accepts three payload shapes; one of them — the "bare" layout the
// parser test at bluebubbles.test.mjs pins — carries no `chats` array and no `chatGuid`.
// isGroup was `chats.some(isGroupChatGuid(...)) || isGroupChatGuid(chatGuid)`, so with no
// chat context at all it evaluated to FALSE. Not "unknown". False. A group message
// delivered in that layout sailed past `if (msg.isGroup) return ignored:"group_chat"` at
// index.mjs and was handled as a one-to-one: the household assistant read the group's
// words, wrote them into the family's "Text messages" conversation, and replied to the
// sender privately about something said in a group thread.
//
// The fix is a tri-state. `null` means the delivery did not say, and a guard that cannot
// tell must not guess. What it must ALSO not do is stop honouring STOP/START/HELP — those
// are compliance obligations that have to work from any delivery shape, they are
// whole-message string matches, and no model and no household data is involved. So the
// unclassified path is narrowed to keywords rather than closed outright.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner;
const NUM = "+15557654399";

/** Post an inbound delivery in the BARE layout: no `chats`, no `chatGuid`. */
async function bare(guid, text, from = NUM) {
  const payload = { type: "new-message", data: { guid, text, isFromMe: false, handle: { address: from, service: "iMessage" } } };
  const r = await ctx.fetch("/api/webhooks/bluebubbles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: r.status, data: await r.json() };
}

/** The same delivery WITH one-to-one chat context, for contrast. */
async function direct(guid, text, from = NUM) {
  const payload = { type: "new-message", data: { guid, text, isFromMe: false, handle: { address: from, service: "iMessage" }, chats: [{ guid: `iMessage;-;${from}` }] } };
  const r = await ctx.fetch("/api/webhooks/bluebubbles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: r.status, data: await r.json() };
}

async function textThreadTurns() {
  const convs = (await owner.req("/api/conversations")).data?.conversations ?? [];
  const t = convs.find((c) => c.title === "Text messages");
  if (!t) return 0;
  return (await owner.req(`/api/conversations/${t.id}`)).data?.conversation?.messages?.length ?? 0;
}

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
  const r = await owner.req("/api/contact-methods", {
    method: "POST",
    body: JSON.stringify({ memberId: "m-alex", label: "Mobile", type: "Phone/Text", value: NUM, verified: true, optInStatus: "Opted In" }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});
after(async () => { await stopServer(ctx); });

test("free text with no chat context does not reach the assistant", async () => {
  const before = await textThreadTurns();
  const r = await bare("p:0/failopen-1", "can you add swim practice on Tuesday at 4");
  assert.equal(r.status, 200, "the endpoint still acknowledges — it never signals what it knows");
  assert.equal(r.data.ignored, "unclassified_thread", JSON.stringify(r.data));
  assert.equal(r.data.reply ?? null, null, "nothing goes back over the bridge");
  assert.equal(await textThreadTurns(), before, "and nothing becomes a conversation turn");
});

test("STOP and HELP are still honoured from a delivery with no chat context", async () => {
  const help = await bare("p:0/failopen-2", "HELP");
  assert.equal(help.status, 200);
  assert.equal(help.data.handled, true, "a compliance keyword works from any delivery shape");
  assert.ok(help.data.reply, "HELP answers");

  const stop = await bare("p:0/failopen-3", "STOP");
  assert.equal(stop.data.handled, true, "STOP is never something we decline to hear");
  assert.ok(stop.data.reply);

  // Put the number back so the contrast case below still resolves.
  const start = await bare("p:0/failopen-4", "START");
  assert.equal(start.data.handled, true);
});

test("the same free text WITH one-to-one chat context is handled normally", async () => {
  // Proves the drop is about the missing classification, not about the text.
  const r = await direct("p:0/failopen-5", "what is on the calendar today");
  assert.equal(r.status, 200);
  assert.equal(r.data.ignored ?? null, null, `a classified 1:1 thread is not dropped: ${JSON.stringify(r.data)}`);
  assert.equal(r.data.handled, true, JSON.stringify(r.data));
});

test("an explicit group delivery is still ignored outright", async () => {
  const payload = { type: "new-message", data: { guid: "p:0/failopen-6", text: "hey all", isFromMe: false, handle: { address: NUM }, chats: [{ guid: "iMessage;+;chat777" }] } };
  const r = await ctx.fetch("/api/webhooks/bluebubbles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const d = await r.json();
  assert.equal(d.ignored, "group_chat", "an UNBOUND group chat stays silent, tri-state or not");
});
