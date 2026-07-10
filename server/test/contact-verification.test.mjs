// The true contact-method verification loop. Invariants under test:
//   • a code send through an unconfigured external channel honestly fails
//     (needs_setup) and leaves NO pending challenge behind
//   • entering the delivered code — and nothing else — flips the method to
//     verified + opted-in (recorded with verifiedVia/verifiedBy/verifiedAt)
//   • wrong codes burn limited attempts; expired codes and exhausted challenges
//     are refused; codes are single-use
//   • self-attestation is closed: a non-adult can no longer PATCH verified:true
//     (adult manual override stays, recorded as verifiedVia:"manual")
//   • changing the address kills any pending code for the old address
//
// External delivery (Gmail/Twilio) cannot succeed in this environment, so the
// code-entry mechanics are exercised white-box: the test seeds a challenge record
// in the server's durable store (the same file the send route writes on a
// successful delivery) and drives the REAL /verify endpoint against it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import fs from "node:fs";
import { startServer, stopServer, makeSession, readStoreDoc, writeStoreDoc } from "./harness.mjs";

let ctx, owner, guest, child;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");   // Owner
  guest = await makeSession(ctx, "m-sam");    // Guest/Helper (non-adult)
  child = await makeSession(ctx, "m-noah");   // Child View (non-adult)
});
after(async () => { await stopServer(ctx); });

function seedChallenge(methodId, overrides = {}) {
  const all = readStoreDoc(ctx, "contact_verifications.json", {});
  all[methodId] = {
    id: methodId, householdId: "local", code: "123456", channel: "email", delivered: true,
    attempts: 0, maxAttempts: 5, expiresAt: Date.now() + 10 * 60 * 1000, nextSendAt: Date.now() + 60 * 1000,
    requestedBy: "m-sam", createdAt: new Date().toISOString(), ...overrides,
  };
  writeStoreDoc(ctx, "contact_verifications.json", all);
}
function readChallenges() {
  return readStoreDoc(ctx, "contact_verifications.json", {});
}
async function makeEmailMethod(session, label) {
  const r = await session.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label, type: "Email", value: `${label.replace(/\W/g, "").toLowerCase()}@example.com` }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.contactMethod.verified, false);
  return r.data.contactMethod;
}

test("send-verification through an unconfigured channel is honest and leaves no challenge", async () => {
  const cm = await makeEmailMethod(guest, "Loop hon");
  const r = await guest.req(`/api/contact-methods/${cm.id}/send-verification`, { method: "POST", body: "{}" });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, false);
  assert.equal(r.data.needsSetup, "google");
  assert.ok(!readChallenges()[cm.id], "no pending challenge after a failed send");
});

test("send-verification is manage-gated and rejects verified / in-app methods", async () => {
  const cm = await makeEmailMethod(guest, "Loop gate");
  const foreign = await child.req(`/api/contact-methods/${cm.id}/send-verification`, { method: "POST", body: "{}" });
  assert.equal(foreign.status, 403);
  // In-app methods are born verified — nothing external to prove.
  const inApp = await guest.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "Loop in-app", type: "In-App" }) });
  const already = await guest.req(`/api/contact-methods/${inApp.data.contactMethod.id}/send-verification`, { method: "POST", body: "{}" });
  assert.equal(already.status, 400);
  assert.equal(already.data.error, "already_verified");
});

test("entering the delivered code verifies the method (opted-in, provenance recorded)", async () => {
  const cm = await makeEmailMethod(guest, "Loop happy");
  seedChallenge(cm.id);
  const wrong = await guest.req(`/api/contact-methods/${cm.id}/verify`, { method: "POST", body: JSON.stringify({ code: "654321" }) });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.error, "code_incorrect");
  assert.equal(wrong.data.attemptsLeft, 4);
  const right = await guest.req(`/api/contact-methods/${cm.id}/verify`, { method: "POST", body: JSON.stringify({ code: "123456" }) });
  assert.equal(right.status, 200);
  assert.equal(right.data.ok, true);
  assert.equal(right.data.contactMethod.verified, true);
  assert.equal(right.data.contactMethod.optInStatus, "Opted In");
  assert.equal(right.data.contactMethod.verifiedVia, "email");
  assert.equal(right.data.contactMethod.verifiedBy, "m-sam");
  // Single-use: the challenge is gone; re-verifying reports already-verified.
  assert.ok(!readChallenges()[cm.id], "challenge consumed");
  const again = await guest.req(`/api/contact-methods/${cm.id}/verify`, { method: "POST", body: JSON.stringify({ code: "123456" }) });
  assert.equal(again.data.alreadyVerified, true);
  // The verified gate in notify now passes for this method (email then honestly
  // reports the missing Google setup — the point is it got PAST verification).
  const send = await guest.req("/api/notify", { method: "POST", body: JSON.stringify({ methodId: cm.id, title: "Hi", body: "x" }) });
  assert.notEqual(send.data.error, "method_not_verified");
  assert.equal(send.data.needsSetup, "google");
});

test("expired codes are refused and cleaned up", async () => {
  const cm = await makeEmailMethod(guest, "Loop expired");
  seedChallenge(cm.id, { expiresAt: Date.now() - 1000 });
  const r = await guest.req(`/api/contact-methods/${cm.id}/verify`, { method: "POST", body: JSON.stringify({ code: "123456" }) });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "code_expired");
  assert.ok(!readChallenges()[cm.id]);
});

test("attempts are limited; an exhausted challenge demands a fresh code", async () => {
  const cm = await makeEmailMethod(guest, "Loop burned");
  seedChallenge(cm.id, { attempts: 5 });
  const r = await guest.req(`/api/contact-methods/${cm.id}/verify`, { method: "POST", body: JSON.stringify({ code: "123456" }) });
  assert.equal(r.status, 429);
  assert.equal(r.data.error, "too_many_attempts");
  assert.ok(!readChallenges()[cm.id]);
});

test("verify without a pending code, or with a malformed code, is refused", async () => {
  const cm = await makeEmailMethod(guest, "Loop none");
  const none = await guest.req(`/api/contact-methods/${cm.id}/verify`, { method: "POST", body: JSON.stringify({ code: "123456" }) });
  assert.equal(none.status, 400);
  assert.equal(none.data.error, "no_pending_verification");
  seedChallenge(cm.id);
  const malformed = await guest.req(`/api/contact-methods/${cm.id}/verify`, { method: "POST", body: JSON.stringify({ code: "not-a-code-at-all" }) });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.data.error, "code_incorrect");
});

test("changing the address kills the pending code for the old address", async () => {
  const cm = await makeEmailMethod(guest, "Loop moved");
  seedChallenge(cm.id);
  const patched = await guest.req(`/api/contact-methods/${cm.id}`, { method: "PATCH", body: JSON.stringify({ value: "newaddress@example.com" }) });
  assert.equal(patched.status, 200);
  assert.ok(!readChallenges()[cm.id], "stale challenge removed on address change");
  const r = await guest.req(`/api/contact-methods/${cm.id}/verify`, { method: "POST", body: JSON.stringify({ code: "123456" }) });
  assert.equal(r.data.error, "no_pending_verification");
});

test("self-attestation is closed: non-adults cannot PATCH verified:true; adults can (recorded as manual)", async () => {
  const cm = await makeEmailMethod(guest, "Loop attest");
  const self = await guest.req(`/api/contact-methods/${cm.id}`, { method: "PATCH", body: JSON.stringify({ verified: true }) });
  assert.equal(self.status, 403);
  const adult = await owner.req(`/api/contact-methods/${cm.id}`, { method: "PATCH", body: JSON.stringify({ verified: true }) });
  assert.equal(adult.status, 200);
  assert.equal(adult.data.contactMethod.verified, true);
  assert.equal(adult.data.contactMethod.verifiedVia, "manual");
  assert.equal(adult.data.contactMethod.verifiedBy, "m-alex");
});

test("a non-adult creating a method cannot smuggle in verified:true", async () => {
  const r = await guest.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "Loop smuggle", type: "Email", value: "smuggle@example.com", verified: true, optInStatus: "Opted In" }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.contactMethod.verified, false);
  assert.equal(r.data.contactMethod.optInStatus, "Pending");
});

test("a fresh send is refused only while a delivered code is cooling down", async () => {
  const cm = await makeEmailMethod(guest, "Loop cool");
  seedChallenge(cm.id, { nextSendAt: Date.now() + 60 * 1000 });
  const tooSoon = await guest.req(`/api/contact-methods/${cm.id}/send-verification`, { method: "POST", body: "{}" });
  assert.equal(tooSoon.status, 429);
  assert.equal(tooSoon.data.error, "resend_too_soon");
  // A prior UNDELIVERED challenge never blocks a retry.
  seedChallenge(cm.id, { delivered: false, nextSendAt: Date.now() + 60 * 1000 });
  const retry = await guest.req(`/api/contact-methods/${cm.id}/send-verification`, { method: "POST", body: "{}" });
  assert.equal(retry.status, 200); // honest needs_setup, but not rate-limited
  assert.equal(retry.data.needsSetup, "google");
});
