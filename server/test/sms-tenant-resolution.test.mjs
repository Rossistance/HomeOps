// Whose text is this?
//
// Every store call in the inbound path — listContactMethods, getMember, the conversation
// writers — follows the ambient tenant context. A Twilio webhook has none, so they all read the
// RESIDENT household. A member of any signed-up family who texted the number resolved to
// nobody and got silence; their STOP was recorded against a household they aren't in. SMS was
// broken for every paying customer before it shipped, and it failed the quiet way: no error, no
// log, just an assistant that never answers.
//
// Resolution is by SENDER, not by the `To` number: a deployment shares one Twilio number across
// households, so `To` cannot tell two families apart.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-sms-tenant-"));
const { putContactMethod, putMember, runWithTenant, listContactMethods } = await import("../store.mjs");
const { handleInboundSms, householdsForNumber } = await import("../sms.mjs");

const A = "hh_aaaa1111";      // a signed-up family
const B = "hh_bbbb2222";      // another one
const NUM = "+15551234567";   // one person's phone
const SOLO = "+15559876543";  // someone who belongs to A only

async function seedHousehold(hh, actorId, name, phone) {
  await runWithTenant(hh, () => {
    putMember({ actorId, displayName: name, role: "Owner", householdId: hh });
    putContactMethod({
      id: `cm-${hh}-${actorId}`, memberId: actorId, householdId: hh,
      type: "Phone/Text", value: phone, verified: true, optInStatus: "Opted In",
    });
  });
}

before(async () => {
  await seedHousehold(A, "m-jordan", "Jordan", SOLO);
  await seedHousehold(A, "m-shared", "Shared", NUM);
  await seedHousehold(B, "m-shared-b", "Shared", NUM);
});
after(() => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {} });

test("a number is found in the household that actually has it, not just the resident one", async () => {
  const hits = await householdsForNumber(SOLO);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].householdId, A, "the resident household knows nothing about this number");
});

test("a number registered to two households reports both", async () => {
  const hits = await householdsForNumber(NUM);
  assert.deepEqual(hits.map((h) => h.householdId).sort(), [A, B].sort());
});

test("an unknown number matches nothing and is answered with silence", async () => {
  assert.equal((await householdsForNumber("+15550000000")).length, 0);
  const r = await handleInboundSms({ from: "+15550000000", body: "hello?" });
  assert.equal(r.unknownSender, true);
  assert.equal(r.replyText, null, "answering would confirm whether a number is registered");
});

test("STOP from a signed-up family's member is honoured IN THAT FAMILY", async () => {
  const r = await handleInboundSms({ from: SOLO, body: "STOP" });
  assert.equal(r.kind, "keyword");
  assert.match(r.replyText, /opt(ed)? out|won't|stopped|unsubscrib/i);

  const inA = await runWithTenant(A, () => listContactMethods((m) => m.value === SOLO)[0]);
  assert.equal(inA.optInStatus, "Opted Out", "the household that has this number records it");
});

test("THE FAN-OUT: STOP applies to EVERY household that knows the number", async () => {
  // Someone texting STOP is asking to be left alone — not to be left alone by one of the two
  // families that have their number. Honouring it in a single household would leave the others
  // texting them: the wrong answer to a plain request, and a compliance failure.
  const r = await handleInboundSms({ from: NUM, body: "STOP" });
  assert.equal(r.kind, "keyword");
  assert.equal(r.households, 2, "both were told");
  for (const hh of [A, B]) {
    const m = await runWithTenant(hh, () => listContactMethods((x) => x.value === NUM)[0]);
    assert.equal(m.optInStatus, "Opted Out", `${hh} honoured it`);
  }
});

test("…and only ONE reply goes back, because it was one text", async () => {
  const r = await handleInboundSms({ from: NUM, body: "STOP" });
  assert.equal(typeof r.replyText, "string");
  assert.ok(!/opted out.*opted out/i.test(r.replyText), "\"you're opted out (×2)\" is not a better message");
});

test("START fans out the same way, for the same reason", async () => {
  const r = await handleInboundSms({ from: NUM, body: "START" });
  assert.equal(r.households, 2);
  for (const hh of [A, B]) {
    const m = await runWithTenant(hh, () => listContactMethods((x) => x.value === NUM)[0]);
    assert.equal(m.optInStatus, "Opted In", `${hh} restored it`);
  }
});

test("AMBIGUITY: a conversation from a number in two households is not guessed at", async () => {
  // Guessing means answering with another family's calendar. That is the one outcome this
  // product must never produce, so it says it can't tell instead.
  const r = await handleInboundSms({ from: NUM, body: "what's on today?" });
  assert.equal(r.kind, "ambiguous");
  assert.match(r.replyText, /more than one|which one/i);
  assert.equal(r.actorId, null, "and it does not act as either of them");
});

test("a number in exactly one household still gets a normal conversation", async () => {
  await handleInboundSms({ from: SOLO, body: "START" });   // undo the STOP above
  const r = await handleInboundSms({ from: SOLO, body: "what's on today?" });
  assert.notEqual(r.kind, "ambiguous");
  assert.notEqual(r.unknownSender, true, "this one is perfectly resolvable");
  assert.equal(r.actorId, "m-jordan", "and it acts as the right person, in the right household");
});
