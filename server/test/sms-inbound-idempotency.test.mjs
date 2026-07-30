// Twilio retries. This handler didn't expect it to.
//
// Twilio re-delivers a webhook it doesn't get a timely 200 from — and the inbound handler runs
// the assistant, an LLM call, BEFORE it can answer. A slow model is enough to produce a retry,
// and a retry ran the whole message again: a second conversation turn, a second plan, a second
// approval sitting in the family's queue for something they asked for once.
//
// Every mutating path in this product is idempotent except the one an external service is
// explicitly documented to repeat.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner;
const NUM = "+15557654321";

/** Post an inbound SMS the way Twilio does: form-encoded, with a MessageSid. */
async function inbound(sid, body, from = NUM) {
  const params = new URLSearchParams({ From: from, Body: body, To: "+15550001111", MessageSid: sid });
  const r = await ctx.fetch("/api/webhooks/sms", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  return { status: r.status, xml: await r.text() };
}

/** Conversations come back whole from the list route; the messages live on the record. */
async function turnsFor(convId) {
  const convs = (await owner.req("/api/conversations")).data?.conversations ?? [];
  return (convs.find((c) => c.id === convId)?.messages ?? []).length;
}

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
  // A verified, opted-in number in the resident household, so the message actually resolves.
  const r = await owner.req("/api/contact-methods", {
    method: "POST",
    body: JSON.stringify({ memberId: "m-alex", label: "Mobile", type: "Phone/Text", value: NUM, verified: true, optInStatus: "Opted In" }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});
after(async () => { await stopServer(ctx); });

test("a first delivery is handled and answered", async () => {
  const r = await inbound("SM-first", "HELP");
  assert.equal(r.status, 200);
  assert.match(r.xml, /<Message>/, "a known, opted-in number gets a reply");
  assert.match(r.xml, /FamiliOS/i);
});

test("THE RETRY: the same MessageSid replays the same answer instead of re-running", async () => {
  const first = await inbound("SM-retry", "HELP");
  const again = await inbound("SM-retry", "HELP");
  assert.equal(again.status, 200);
  assert.equal(again.xml, first.xml,
    "the retry exists because Twilio didn't hear the answer, so the answer is what it should get");
});

test("…and a retry does NOT add another turn to the family's conversation", async () => {
  // The observable that matters. A duplicated turn is a duplicated plan and, for anything
  // gated, a duplicated approval for something asked once.
  const sid = "SM-thread";
  await inbound(sid, "STOP");
  const convs = (await owner.req("/api/conversations")).data.conversations ?? [];
  const sms = convs.find((c) => /sms/i.test(c.id) || /text/i.test(c.title ?? ""));
  assert.ok(sms, `expected an SMS conversation to exist — otherwise this test proves nothing (saw ${convs.map((c) => c.id).join(", ")})`);
  const before = await turnsFor(sms.id);
  assert.ok(before > 0, "…and to have the first delivery's turns in it");

  await inbound(sid, "STOP");
  assert.equal(await turnsFor(sms.id), before, "the second delivery wrote nothing");
});

test("a DIFFERENT MessageSid is a different message and is handled normally", async () => {
  // The guard must not swallow a genuine second text — someone really can send HELP twice.
  const a = await inbound("SM-alpha", "START");
  const b = await inbound("SM-beta", "START");
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.match(b.xml, /<Message>/, "the second one still gets its own answer");
});

test("a delivery with no MessageSid is still handled — the guard is not a gate", async () => {
  const params = new URLSearchParams({ From: NUM, Body: "HELP", To: "+15550001111" });
  const r = await ctx.fetch("/api/webhooks/sms", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params.toString(),
  });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<Message>/, "no sid means no dedupe, not no service");
});

test("an unknown sender still gets silence, retry or not", async () => {
  const a = await inbound("SM-stranger", "hello?", "+15550009999");
  const b = await inbound("SM-stranger", "hello?", "+15550009999");
  for (const r of [a, b]) {
    assert.equal(r.status, 200);
    assert.ok(!/<Message>/.test(r.xml), "answering would confirm a number is registered");
  }
});
