// FAMILY SAFETY — the 2026-07 hardening pass: honest gmail.send validation, per-person
// push audiences, help requests (any role may ASK for help), the child AI gate, and the
// normalized calendar dedupe fingerprint (the "3× Skip fabletics" bug).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

// In-process unit imports (notify/calendar/store) get their OWN isolated data dir —
// set BEFORE store.mjs loads, so nothing touches server/.data or the HTTP server's dir.
const unitDataDir = fs.mkdtempSync(join(os.tmpdir(), "homeops-unit-"));
process.env.HOMEOPS_DATA_DIR = unitDataDir;
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
const { eventFingerprint } = await import("../calendar.mjs");
const { approvalAudience, approvalPushTokens } = await import("../notify.mjs");
const { putMember, addPushToken } = await import("../store.mjs");

import { startServer, stopServer, makeSession, writeStoreDoc } from "./harness.mjs";

let ctx, alex, morgan, child;
before(async () => {
  ctx = await startServer();
  // A connected Google account for Alex so gmail.send reaches its validation path.
  writeStoreDoc(ctx, "accounts.json", [
    {
      id: "acct_alex_google", provider: "google", displayName: "alex@harper.example",
      scopes: ["gmail.send", "calendar"], status: "connected", connectedByActorId: "m-alex",
      householdId: "local", lastHealthAt: null, lastHealthOk: null,
      createdAt: Date.now(), updatedAt: new Date().toISOString(),
    },
  ]);
  alex = await makeSession(ctx, "m-alex");     // Owner
  morgan = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");    // Child View
});
after(async () => {
  await stopServer(ctx);
  try { fs.rmSync(unitDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

/* ---- gmail.send: validation fires before any Google call ---- */
test("gmail.send with an empty body returns invalid_input (never reaches Google)", async () => {
  const input = { to: "x@y.com", subject: "Hi", body: "   " };
  const created = await alex.req("/api/approvals", { method: "POST", body: JSON.stringify({ toolId: "gmail.send", input }) });
  const id = created.data.approval.id;
  await alex.req(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
  const exec = await alex.req("/api/tools/gmail.send/execute", { method: "POST", body: JSON.stringify({ input, approvalId: id }) });
  assert.equal(exec.status, 422);
  assert.equal(exec.data.error, "invalid_input", JSON.stringify(exec.data));
  assert.match(String(exec.data.message), /empty body/i);
});

/* ---- Push audience: a personal approval never fans out ---- */
test("approvalAudience/approvalPushTokens select only the requester for personal approvals", () => {
  putMember({ actorId: "u-owner", displayName: "Owner", role: "Owner", householdId: "local" });
  putMember({ actorId: "u-kid", displayName: "Kid", role: "Child View", householdId: "local" });
  addPushToken("tok-owner", { householdId: "local", actorId: "u-owner" });
  addPushToken("tok-kid", { householdId: "local", actorId: "u-kid" });

  const personal = { householdId: "local", requestedBy: "u-owner", visibility: "personal", allowedApproverRoles: ["Owner", "Adult Admin"] };
  const a = approvalAudience(personal);
  assert.deepEqual([...a.ids], ["u-owner"], "personal approval reaches only the requester");
  assert.equal(a.broad, false);
  assert.deepEqual(approvalPushTokens(personal), ["tok-owner"], "only the requester's token is selected");

  // A child's household-visible request they can't approve themselves DOES broadcast to approvers.
  const broad = { householdId: "local", requestedBy: "u-kid", visibility: "household", allowedApproverRoles: ["Owner", "Adult Admin"] };
  const tokens = approvalPushTokens(broad);
  assert.ok(tokens.includes("tok-owner"), "approver notified for a child's request");
  assert.ok(tokens.includes("tok-kid"), "requester still notified about their own ask");
});

/* ---- Help requests ---- */
test("help request: a child can ask, only the recipient can answer", async () => {
  // A Child View session CAN create one (asking for help needs no role floor).
  const created = await child.req("/api/help-requests", {
    method: "POST",
    body: JSON.stringify({ toActorId: "m-alex", message: "Can you drive me to practice?" }),
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const hr = created.data.helpRequest;
  assert.equal(hr.status, "pending");
  assert.equal(hr.fromActorId, "m-noah");
  assert.equal(hr.toActorId, "m-alex");

  // The recipient got a durable in-app notification.
  const notifs = (await alex.req("/api/notifications")).data.notifications;
  assert.ok(notifs.some((n) => n.title === "Can you help?" && n.body.includes("drive me to practice")));

  // A NON-recipient (even an adult) cannot answer.
  const denied = await morgan.req(`/api/help-requests/${hr.id}/respond`, { method: "POST", body: JSON.stringify({ response: "accept" }) });
  assert.equal(denied.status, 403);

  // The recipient accepts (happy path) — status flips, note + timestamp stored.
  const ok = await alex.req(`/api/help-requests/${hr.id}/respond`, { method: "POST", body: JSON.stringify({ response: "accept", note: "On it!" }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.helpRequest.status, "accepted");
  assert.equal(ok.data.helpRequest.responseNote, "On it!");
  assert.ok(ok.data.helpRequest.respondedAt);

  // Answering twice is refused.
  const again = await alex.req(`/api/help-requests/${hr.id}/respond`, { method: "POST", body: JSON.stringify({ response: "decline" }) });
  assert.equal(again.status, 409);

  // Visible to requester and recipient via GET.
  const kidList = (await child.req("/api/help-requests")).data.helpRequests;
  assert.ok(kidList.some((h) => h.id === hr.id));
});

test("help request validation: empty message and unknown recipient are rejected", async () => {
  const noMsg = await child.req("/api/help-requests", { method: "POST", body: JSON.stringify({ toActorId: "m-alex", message: "   " }) });
  assert.equal(noMsg.status, 400);
  assert.equal(noMsg.data.error, "message_required");
  const badTo = await child.req("/api/help-requests", { method: "POST", body: JSON.stringify({ toActorId: "m-nobody", message: "help" }) });
  assert.equal(badTo.status, 400);
  assert.equal(badTo.data.error, "bad_recipient");
});

/* ---- Child AI gate ---- */
test("a Child View session without aiEnabled gets 403 ai_disabled on POST /api/assistant", async () => {
  const r = await child.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "hi" }) });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "ai_disabled");

  // An adult flips the toggle → the gate opens (any non-403 outcome is fine; without
  // an AI provider the assistant honestly fails 422, which proves the gate passed).
  const patched = await morgan.req("/api/members/m-noah", { method: "PATCH", body: JSON.stringify({ aiEnabled: true }) });
  assert.equal(patched.status, 200);
  const r2 = await child.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "hi" }) });
  assert.notEqual(r2.status, 403, JSON.stringify(r2.data));
  assert.notEqual(r2.data.error, "ai_disabled");
});

/* ---- Calendar fingerprint normalization ---- */
test("all-day date and midnight-UTC instant produce the SAME fingerprint; real times differ", () => {
  const a = eventFingerprint("Speech Therapy ", "2026-07-31", true);
  const b = eventFingerprint("speech therapy", "2026-07-31T00:00:00.000Z", false);
  assert.equal(a, b, "all-day '2026-07-31' must collide with '2026-07-31T00:00:00.000Z'");
  assert.equal(eventFingerprint("X", "2026-07-31T00:00Z", false), eventFingerprint("X", "2026-07-31", true));
  // Timed events keep the full instant — 9am and 10am must NOT collapse.
  assert.notEqual(
    eventFingerprint("Dentist", "2026-07-31T09:00:00Z", false),
    eventFingerprint("Dentist", "2026-07-31T10:00:00Z", false),
  );
});

/* ---- One-call calendar sync ---- */
test("POST /api/calendar/sync-all returns the aggregate shape and respects the role floor", async () => {
  const denied = await child.req("/api/calendar/sync-all", { method: "POST", body: "{}" });
  assert.equal(denied.status, 403);
  const r = await alex.req("/api/calendar/sync-all", { method: "POST", body: "{}" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true);
  for (const k of ["synced", "imported", "updated", "removed"]) assert.equal(typeof r.data[k], "number", k);
  assert.deepEqual(Object.keys(r.data.pulled).sort(), ["checked", "conflicts", "merged", "unlinked"]);
  assert.ok(Array.isArray(r.data.errors));
});
