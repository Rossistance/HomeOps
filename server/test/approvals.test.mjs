// P0.3 — approval authority invariants.
// The audit's most severe finding: a Child View could approve a high-risk SMS send and
// reach execution. These tests prove that bypass is closed, while the working
// input-hash + consume-once guards are preserved.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, adultAdmin, child, guest;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");       // Owner
  adultAdmin = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");        // Child View
  guest = await makeSession(ctx, "m-elaine");      // Guest/Helper
});
after(async () => { await stopServer(ctx); });

const SMS = { toolId: "sms.send", input: { to: "+15551234567", body: "hi" }, category: "Message", preview: "Send a text" };

async function createSms(client) {
  return client.req("/api/approvals", { method: "POST", body: JSON.stringify(SMS) });
}

test("a child CANNOT create (initiate) a high-risk approval", async () => {
  const r = await createSms(child);
  assert.equal(r.status, 403);
  assert.equal(r.data?.error, "insufficient_role");
});

test("a guest/helper CANNOT create a high-risk approval either", async () => {
  const r = await createSms(guest);
  assert.equal(r.status, 403);
});

test("an Owner can create a high-risk approval; its policy excludes children", async () => {
  const r = await createSms(owner);
  assert.equal(r.status, 200);
  const a = r.data.approval;
  assert.equal(a.status, "pending");
  assert.ok(a.allowedApproverRoles.includes("Owner"));
  assert.ok(a.allowedApproverRoles.includes("Adult Admin"));
  assert.ok(!a.allowedApproverRoles.includes("Child View"), "children must not be allowed approvers");
  assert.ok(!a.allowedApproverRoles.includes("Guest/Helper"));
});

test("a child CANNOT decide a high-risk approval (the core bypass — now 403)", async () => {
  const created = await createSms(owner);
  const id = created.data.approval.id;
  // The child can't even see it in their list...
  const childList = await child.req("/api/approvals");
  assert.ok(!childList.data.approvals.some((a) => a.id === id), "child must not see adult approvals");
  // ...and a direct decide attempt is rejected.
  const decide = await child.req(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
  assert.equal(decide.status, 403);
  assert.equal(decide.data?.error, "approver_not_allowed");
  // The approval is still pending — the child's attempt changed nothing.
  const after = await owner.req("/api/approvals");
  assert.equal(after.data.approvals.find((a) => a.id === id)?.status, "pending");
});

test("a guest/helper also cannot decide a high-risk approval", async () => {
  const created = await createSms(owner);
  const id = created.data.approval.id;
  const decide = await guest.req(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
  assert.equal(decide.status, 403);
});

test("an Adult Admin CAN approve a high-risk approval", async () => {
  const created = await createSms(owner);
  const id = created.data.approval.id;
  const decide = await adultAdmin.req(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
  assert.equal(decide.status, 200);
  assert.equal(decide.data.approval.status, "approved");
  assert.equal(decide.data.approval.decidedBy, "m-morgan");
});

test("cross-household / unknown approval id is a 404", async () => {
  const decide = await owner.req(`/api/approvals/apr_does_not_exist/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
  assert.equal(decide.status, 404);
});
