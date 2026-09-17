// TWO-WAY TEXTING — a family member texts the household's iMessage number and the real
// assistant answers in the same thread. Invariants: only VERIFIED + OPTED-IN phone contact
// methods get any answer (a stranger gets nothing — never a probe signal); the exchange
// persists to the member's durable text conversation; the thread the person used is
// remembered for later replies and notifications; and the webhook is refused without the
// shared secret whenever one is configured.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

const SECRET = "hook-secret-123";
let n = 0;
/** What BlueBubbles Server posts for a new message. */
const event = (address, text, extra = {}) => ({
  type: "new-message",
  data: { guid: `p:0/${++n}`, text, isFromMe: false, dateCreated: Date.now(), handle: { address, service: "iMessage" }, chats: [{ guid: `iMessage;-;${address}` }], ...extra },
});
const post = (ctx, payload, headers = {}) => ctx.fetch("/api/webhooks/bluebubbles", {
  method: "POST",
  headers: { "content-type": "application/json", "x-familios-webhook-secret": SECRET, ...headers },
  body: JSON.stringify(payload),
});
const body = async (r) => { try { return await r.json(); } catch { return null; } };

let ctx, adult;
before(async () => {
  ctx = await startServer({ env: { BLUEBUBBLES_WEBHOOK_SECRET: SECRET } });
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
  // Morgan's real phone method — adult create may carry over verified/opt-in (migration path).
  const r = await adult.req("/api/contact-methods", { method: "POST", body: JSON.stringify({
    memberId: "m-morgan", label: "Mobile", type: "Phone/Text", value: "(555) 010-8899",
    verified: true, optInStatus: "Opted In",
  }) });
  assert.equal(r.status, 200);
});
after(async () => { await stopServer(ctx); });

test("unknown or unverified sender gets nothing back (no reply, no probe signal)", async () => {
  const r = await post(ctx, event("+15559990000", "hi familios"));
  assert.equal(r.status, 200, "the bridge is always acknowledged");
  const d = await body(r);
  assert.equal(d.ignored, "unknown_sender");
  assert.equal(d.reply, undefined, "nothing is composed for a stranger");
});

test("verified + opted-in family number gets an honest assistant reply, in-thread, and the thread is remembered", async () => {
  // The Mac reports E.164 (+1...) while the method was saved formatted — matching is digit-based.
  const r = await post(ctx, event("+15550108899", "What is on the calendar today?"));
  assert.equal(r.status, 200);
  const d = await body(r);
  assert.equal(d.handled, true);
  assert.match(d.reply, /AI provider/, "no provider connected → the reply says so honestly");
  // No BlueBubbles server in the harness: the reply was composed, and the failure to hand it
  // to the Mac is reported rather than hidden.
  assert.equal(d.replied, false);
  assert.equal(d.replyError, "not_configured");

  // The exchange is durable in the member's server-owned text conversation.
  const convs = await adult.req("/api/conversations");
  const thread = (convs.data.conversations ?? []).find((c) => c.title === "Text messages");
  assert.ok(thread, "text thread exists for the member");
  const one = await adult.req(`/api/conversations/${thread.id}`);
  const msgs = one.data.conversation.messages;
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[0].text, "What is on the calendar today?");
  assert.equal(msgs[0].channel, "sms");
  assert.equal(msgs[1].role, "assistant");

  // The chat the person used is on their contact method now, for every later send.
  const methods = await adult.req("/api/contact-methods");
  const m = (methods.data.methods ?? methods.data.contactMethods ?? []).find((x) => x.value === "(555) 010-8899");
  assert.equal(m.imessageChatGuid, "iMessage;-;+15550108899");
});

test("a second text reuses the same thread (same-thread continuity)", async () => {
  await post(ctx, event("+1 555 010 8899", "and tomorrow?"));
  const convs = await adult.req("/api/conversations");
  const threads = (convs.data.conversations ?? []).filter((c) => c.title === "Text messages");
  assert.equal(threads.length, 1, "one durable text thread per member, not one per text");
  const one = await adult.req(`/api/conversations/${threads[0].id}`);
  assert.equal(one.data.conversation.messages.length, 4);
});

test("NEGATIVE: echoes of our own sends, group chats and non-message events are acknowledged and ignored", async () => {
  const before = (await adult.req("/api/conversations")).data.conversations.find((c) => c.title === "Text messages");
  const turns = (await adult.req(`/api/conversations/${before.id}`)).data.conversation.messages.length;

  assert.equal((await body(await post(ctx, event("+15550108899", "I replied", { isFromMe: true })))).ignored, "from_me");
  assert.equal((await body(await post(ctx, event("+15550108899", "hey all", { chats: [{ guid: "iMessage;+;chat123" }] })))).ignored, "group_chat");
  assert.equal((await body(await post(ctx, { type: "typing-indicator", data: { guid: "x" } }))).ignored, "typing-indicator");
  assert.equal((await body(await post(ctx, event("+15550108899", "   ")))).ignored, "empty");
  const broken = await ctx.fetch("/api/webhooks/bluebubbles", { method: "POST", headers: { "content-type": "application/json", "x-familios-webhook-secret": SECRET }, body: "{not json" });
  assert.equal(broken.status, 400);

  const after = (await adult.req(`/api/conversations/${before.id}`)).data.conversation.messages.length;
  assert.equal(after, turns, "none of those became a conversation turn");
});

test("with a webhook secret configured, deliveries without it are refused; header, bearer and URL forms all pass", async () => {
  const payload = event("+15550108899", "hello");
  const none = await ctx.fetch("/api/webhooks/bluebubbles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(none.status, 403);
  const wrong = await post(ctx, payload, { "x-familios-webhook-secret": "nope" });
  assert.equal(wrong.status, 403, "a forged secret is refused");

  const viaBearer = await ctx.fetch("/api/webhooks/bluebubbles", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` }, body: JSON.stringify(event("+15550108899", "hello")) });
  assert.equal(viaBearer.status, 200);
  const viaQuery = await ctx.fetch(`/api/webhooks/bluebubbles?secret=${SECRET}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event("+15550108899", "hello")) });
  assert.equal(viaQuery.status, 200, "the form BlueBubbles Server registers: the secret in the URL");
});

test("PRODUCTION without a webhook secret fails closed", async () => {
  const ctx2 = await startServer({ prod: true });
  try {
    const r = await ctx2.fetch("/api/webhooks/bluebubbles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event("+15550108899", "hello")) });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error, "imessage_not_configured");
  } finally { await stopServer(ctx2); }
});
