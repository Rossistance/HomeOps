// KEYWORDS — STOP / START / HELP over inbound texts.
//
// A person who texts STOP is asking to be left alone, whatever the transport carries it.
// Before this was honoured, handleInboundSms passed the whole body to the assistant, so STOP
// was answered by an LLM and the contact method stayed "Opted In" forever — and a family
// who asked to be left alone kept getting texts.
//
// The invariants that matter here are mostly about what must NOT happen: a keyword must not
// reach the model, an opt-out must not depend on being opted in, and a texted START must
// not manufacture consent for a number nobody proved they own.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { classifySmsKeyword } from "../sms.mjs";

let n = 0;
/** Post an inbound text the way BlueBubbles Server does: JSON, one handle, one chat. */
const post = (ctx, { From, Body }) => ctx.fetch("/api/webhooks/bluebubbles", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "new-message", data: { guid: `p:0/kw-${++n}`, text: Body, isFromMe: false, handle: { address: From, service: "iMessage" }, chats: [{ guid: `iMessage;-;${From}` }] } }),
});
/** The reply the handler composed for the sender, or null when it composed none. */
const reply = async (r) => { const d = await r.json(); return d.reply ?? null; };

const VERIFIED = "(555) 010-7711";
const UNVERIFIED = "(555) 010-7722";

let ctx, adult;
async function methodFor(value) {
  const r = await adult.req("/api/contact-methods");
  return (r.data.methods ?? r.data.contactMethods ?? []).find((m) => m.value === value);
}

before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
  const a = await adult.req("/api/contact-methods", { method: "POST", body: JSON.stringify({
    memberId: "m-morgan", label: "Mobile", type: "Phone/Text", value: VERIFIED,
    verified: true, optInStatus: "Opted In",
  }) });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const b = await adult.req("/api/contact-methods", { method: "POST", body: JSON.stringify({
    memberId: "m-morgan", label: "Spare", type: "Phone/Text", value: UNVERIFIED,
  }) });
  assert.equal(b.status, 200, JSON.stringify(b.data));
});
after(async () => { await stopServer(ctx); });

/* ---- classification: a keyword is the WHOLE message, or it isn't a keyword ---- */

test("keywords are matched case- and punctuation-insensitively, whole-message only", () => {
  assert.equal(classifySmsKeyword("STOP"), "opt_out");
  assert.equal(classifySmsKeyword(" stop. "), "opt_out");
  assert.equal(classifySmsKeyword("Unsubscribe"), "opt_out");
  assert.equal(classifySmsKeyword("QUIT"), "opt_out");
  assert.equal(classifySmsKeyword("start"), "opt_in");
  assert.equal(classifySmsKeyword("UNSTOP"), "opt_in");
  assert.equal(classifySmsKeyword("help"), "help");
  assert.equal(classifySmsKeyword("INFO"), "help");
});

test("NEGATIVE: a sentence containing a keyword is a message, not a command", () => {
  // The whole point of whole-message matching: a family asking for help must get help,
  // and someone complaining must not be silently unsubscribed.
  assert.equal(classifySmsKeyword("help me plan dinner"), null);
  assert.equal(classifySmsKeyword("please stop texting me about the dentist"), null);
  assert.equal(classifySmsKeyword("can you start the laundry reminder"), null);
  assert.equal(classifySmsKeyword(""), null);
  assert.equal(classifySmsKeyword(null), null);
});

/* ---- the opt-out round trip ---- */

test("STOP unsubscribes the number and confirms — without consulting any model", async () => {
  const r = await post(ctx, { From: "+15550107711", Body: "STOP" });
  assert.equal(r.status, 200);
  const text = await reply(r);
  assert.ok(text, "an opt-out is always acknowledged");
  assert.match(text, /unsubscribed/i);
  assert.match(text, /START/, "the way back is named in the confirmation");
  // No AI provider is configured in the harness. An assistant round-trip would have said
  // so ("no AI provider is connected") — proof the keyword never reached the planner.
  assert.doesNotMatch(text, /AI provider/i);

  const m = await methodFor(VERIFIED);
  assert.equal(m.optInStatus, "Opted Out", "the registry records the withdrawal");
});

test("after STOP, an ordinary text gets silence — the request is honoured", async () => {
  const r = await post(ctx, { From: "+15550107711", Body: "what is for dinner?" });
  assert.equal(r.status, 200);
  assert.equal(await reply(r), null, "no reply to someone who asked to be left alone");
});

test("STOP is idempotent — a second one is still acknowledged, nothing breaks", async () => {
  const r = await post(ctx, { From: "+15550107711", Body: "stop" });
  const text = await reply(r);
  assert.match(text, /unsubscribed/i);
  const m = await methodFor(VERIFIED);
  assert.equal(m.optInStatus, "Opted Out");
});

test("START restores a previously VERIFIED number", async () => {
  const r = await post(ctx, { From: "+15550107711", Body: "START" });
  const text = await reply(r);
  assert.match(text, /subscribed/i);
  const m = await methodFor(VERIFIED);
  assert.equal(m.optInStatus, "Opted In", "consent restored");
  assert.equal(m.verified, true, "verification was never in question");
});

test("the assistant works again once the number is back", async () => {
  const r = await post(ctx, { From: "+15550107711", Body: "what is on the calendar?" });
  const text = await reply(r);
  assert.ok(text, "a re-subscribed member is heard again");
  assert.match(text, /AI provider/i, "and this one DID reach the assistant");
});

/* ---- START must not manufacture consent ---- */

test("NEGATIVE: START on an UNVERIFIED number is refused, not granted", async () => {
  // Same rule that stopped seed data shipping pre-verified: consent is a round-trip a
  // person completes, never something a single inbound text can conjure.
  const r = await post(ctx, { From: "+15550107722", Body: "start" });
  const text = await reply(r);
  assert.match(text, /verified yet/i);
  const m = await methodFor(UNVERIFIED);
  assert.notEqual(m.optInStatus, "Opted In", "no consent was created");
  assert.equal(m.verified, false);
});

test("STOP on an unverified-but-known number still records the opt-out", async () => {
  // Withdrawal must not depend on the state it withdraws from.
  const r = await post(ctx, { From: "+15550107722", Body: "STOP" });
  assert.match(await reply(r), /unsubscribed/i);
  const m = await methodFor(UNVERIFIED);
  assert.equal(m.optInStatus, "Opted Out");
});

/* ---- HELP ---- */

test("HELP returns programme name, opt-out instruction, rates notice and a contact", async () => {
  const r = await post(ctx, { From: "+15550107711", Body: "HELP" });
  const text = await reply(r);
  assert.match(text, /FamiliOS/, "who this is");
  assert.match(text, /STOP/, "how to leave");
  assert.match(text, /rates may apply/i, "the CTIA rates notice");
  assert.match(text, /@/, "a human to contact");
});

/* ---- strangers ---- */

test("NEGATIVE: a keyword from an unknown number gets silence, not a probe signal", async () => {
  // Answering would confirm whether a number is registered to some household.
  for (const body of ["STOP", "HELP", "START"]) {
    const r = await post(ctx, { From: "+15559998888", Body: body });
    assert.equal(r.status, 200);
    assert.equal(await reply(r), null, `silence for a stranger's ${body}`);
  }
});
