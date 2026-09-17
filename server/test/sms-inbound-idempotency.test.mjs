// The bridge can deliver twice. This handler must not act twice.
//
// BlueBubbles Server re-posts on reconnects and the inbound handler runs the assistant, an
// LLM call, before it answers — a duplicate delivery ran the whole message again: a second
// conversation turn, a second plan, a second approval sitting in the family's queue for
// something they asked for once. Every mutating path in this product is idempotent, and the
// one an external service can repeat is no exception.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner;
const NUM = "+15557654321";

/** Post an inbound text the way BlueBubbles does: JSON, with the Mac's message GUID. */
async function inbound(guid, text, from = NUM) {
  const payload = { type: "new-message", data: { guid, text, isFromMe: false, handle: { address: from, service: "iMessage" }, chats: [{ guid: `iMessage;-;${from}` }] } };
  const r = await ctx.fetch("/api/webhooks/bluebubbles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: r.status, data: await r.json() };
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
  const r = await inbound("p:0/first", "HELP");
  assert.equal(r.status, 200);
  assert.equal(r.data.handled, true, "a known, opted-in number gets a reply");
  assert.match(r.data.reply, /FamiliOS/i);
});

test("THE DUPLICATE: the same message GUID is acknowledged as a replay instead of re-running", async () => {
  const first = await inbound("p:0/retry", "HELP");
  const again = await inbound("p:0/retry", "HELP");
  assert.equal(again.status, 200);
  assert.equal(again.data.replayed, true, "the second delivery is recognised as the first one again");
  assert.equal(again.data.replied, !!first.data.reply, "…and reports whether an answer existed");
  assert.equal(again.data.reply, undefined, "nothing is composed a second time");
});

test("…and a duplicate does NOT add another turn to the family's conversation", async () => {
  // The observable that matters. A duplicated turn is a duplicated plan and, for anything
  // gated, a duplicated approval for something asked once.
  const guid = "p:0/thread";
  await inbound(guid, "STOP");
  const convs = (await owner.req("/api/conversations")).data.conversations ?? [];
  const thread = convs.find((c) => /sms/i.test(c.id) || /text/i.test(c.title ?? ""));
  assert.ok(thread, `expected a text conversation to exist — otherwise this test proves nothing (saw ${convs.map((c) => c.id).join(", ")})`);
  const before = await turnsFor(thread.id);
  assert.ok(before > 0, "…and to have the first delivery's turns in it");

  await inbound(guid, "STOP");
  assert.equal(await turnsFor(thread.id), before, "the second delivery wrote nothing");
});

test("a DIFFERENT GUID is a different message and is handled normally", async () => {
  // The guard must not swallow a genuine second text — someone really can send HELP twice.
  const a = await inbound("p:0/alpha", "START");
  const b = await inbound("p:0/beta", "START");
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(b.data.handled, true, "the second one still gets its own answer");
  assert.ok(b.data.reply);
});

test("a delivery with no GUID is still handled — the guard is not a gate", async () => {
  const payload = { type: "new-message", data: { text: "HELP", isFromMe: false, handle: { address: NUM } } };
  const r = await ctx.fetch("/api/webhooks/bluebubbles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.handled, true, "no guid means no dedupe, not no service");
  assert.ok(d.reply);
});

test("an unknown sender gets nothing back, duplicate or not", async () => {
  const a = await inbound("p:0/stranger", "hello?", "+15550009999");
  const b = await inbound("p:0/stranger", "hello?", "+15550009999");
  for (const r of [a, b]) {
    assert.equal(r.status, 200);
    assert.equal(r.data.reply, undefined, "answering would confirm a number is registered");
    assert.notEqual(r.data.handled, true);
  }
});
