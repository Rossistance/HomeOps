// TWO-WAY SMS GATEWAY — texting HomeOps runs the real assistant and replies in the
// same thread. Invariants: only VERIFIED + OPTED-IN phone contact methods get any
// response (unknown senders get empty TwiML — silence, never a probe signal); the
// exchange persists to the member's durable SMS conversation; Twilio's webhook
// signature is enforced whenever an auth token is configured.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { twilioSignature } from "../sms.mjs";

const form = (params) => new URLSearchParams(params).toString();
const post = (ctx, params, headers = {}) => ctx.fetch("/api/webhooks/sms", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
  body: form(params),
});

let ctx, adult;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
  // Morgan's real phone method — adult create may carry over verified/opt-in (migration path).
  const r = await adult.req("/api/contact-methods", { method: "POST", body: JSON.stringify({
    memberId: "m-morgan", label: "Mobile", type: "Phone/Text", value: "(555) 010-8899",
    verified: true, optInStatus: "Opted In",
  }) });
  assert.equal(r.status, 200);
});
after(async () => { await stopServer(ctx); });

test("unknown or unverified sender gets silence (empty TwiML, no probe signal)", async () => {
  const r = await post(ctx, { From: "+15559990000", Body: "hi homeops" });
  assert.equal(r.status, 200);
  const xml = await r.text();
  assert.ok(!xml.includes("<Message>"), "no reply body for a stranger");
});

test("verified + opted-in family number gets an honest assistant reply in-thread", async () => {
  // Twilio sends E.164 (+1...) while the method was saved formatted — matching is digit-based.
  const r = await post(ctx, { From: "+15550108899", Body: "What is on the calendar today?" });
  assert.equal(r.status, 200);
  const xml = await r.text();
  assert.ok(xml.includes("<Message>"), "the sender gets a reply");
  assert.ok(/AI provider/.test(xml), "no provider connected → the reply says so honestly");

  // The exchange is durable in the member's server-owned SMS conversation.
  const convs = await adult.req("/api/conversations");
  const sms = (convs.data.conversations ?? []).find((c) => c.title === "Text messages");
  assert.ok(sms, "SMS thread exists for the member");
  const one = await adult.req(`/api/conversations/${sms.id}`);
  const msgs = one.data.conversation.messages;
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[0].text, "What is on the calendar today?");
  assert.equal(msgs[0].channel, "sms");
  assert.equal(msgs[1].role, "assistant");
});

test("a second text reuses the same thread (same-thread continuity)", async () => {
  await post(ctx, { From: "+1 555 010 8899", Body: "and tomorrow?" });
  const convs = await adult.req("/api/conversations");
  const smsThreads = (convs.data.conversations ?? []).filter((c) => c.title === "Text messages");
  assert.equal(smsThreads.length, 1, "one durable SMS thread per member, not one per text");
  const one = await adult.req(`/api/conversations/${smsThreads[0].id}`);
  assert.equal(one.data.conversation.messages.length, 4);
});

test("with a Twilio auth token configured, unsigned webhooks are refused and signed ones accepted", async () => {
  const ctx2 = await startServer({ env: { TWILIO_AUTH_TOKEN: "test_token_123", HOMEOPS_PUBLIC_URL: "http://sig.test" } });
  try {
    const unsigned = await post(ctx2, { From: "+15550108899", Body: "hello" });
    assert.equal(unsigned.status, 403);

    const params = { From: "+15550108899", Body: "hello" };
    const sig = twilioSignature("http://sig.test/api/webhooks/sms", params, "test_token_123");
    const signed = await post(ctx2, params, { "x-twilio-signature": sig });
    assert.equal(signed.status, 200, "a correctly signed webhook passes");

    const badSig = twilioSignature("http://sig.test/api/webhooks/sms", params, "wrong_token");
    const forged = await post(ctx2, params, { "x-twilio-signature": badSig });
    assert.equal(forged.status, 403, "a forged signature is refused");
  } finally { await stopServer(ctx2); }
});
