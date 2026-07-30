// Contact methods — the server-owned delivery registry (previously client-only
// IndexedDB). Invariants under test:
//   • reads need a session; the registry is household-scoped
//   • writes are role-gated: adults manage anyone's methods, others only their own
//   • honest states: external methods are born unverified/Pending; changing an
//     address resets verification; in-app/dashboard methods are born verified
//   • notify resolves methodId from the registry fail-closed (unverified and
//     not-opted-in never send; a supplied agentId must be on the allowlist)
//   • a registry-resolved in-app notification lands in the method OWNER's feed
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, guest, child;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");   // Owner
  guest = await makeSession(ctx, "m-sam");    // Guest/Helper (non-adult)
  child = await makeSession(ctx, "m-noah");   // Child View (non-adult)
});
after(async () => { await stopServer(ctx); });

test("listing requires a session; the seeded registry is present", async () => {
  const anon = await ctx.fetch("/api/contact-methods");
  assert.equal(anon.status, 401);
  const r = await owner.req("/api/contact-methods");
  assert.equal(r.status, 200);
  const seeded = r.data.contactMethods.find((c) => c.id === "ct-alex-email");
  assert.ok(seeded, "seeded demo methods exist server-side");
  assert.equal(seeded.memberId, "m-alex");
  // CONSENT IS NEVER SEEDED (2026-07-30). These shipped `verified: true, optInStatus:
  // "Opted In"`, which satisfied every fail-closed gate in notify.mjs and resolveSmsSender —
  // so a seeded install with Google connected would attempt a REAL send to a reserved-TLD
  // address nobody owns, and a seeded phone counted as a consenting A2P recipient.
  assert.equal(seeded.verified, false, "demo data populates a roster; it does not manufacture permission");
  assert.notEqual(seeded.optInStatus, "Opted In");
});

test("an adult may create a method for another member; it starts unverified", async () => {
  const r = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ memberId: "m-elaine", label: "Backup email", type: "Email", value: "gran@example.com" }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.contactMethod.memberId, "m-elaine");
  assert.equal(r.data.contactMethod.verified, false);
  assert.equal(r.data.contactMethod.optInStatus, "Pending");
});

test("a non-adult may create their own method but not someone else's", async () => {
  const own = await guest.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "Personal email", type: "Email", value: "sam@example.com" }) });
  assert.equal(own.status, 200);
  assert.equal(own.data.contactMethod.memberId, "m-sam");
  const other = await guest.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ memberId: "m-alex", label: "Sneaky", type: "Email", value: "x@example.com" }) });
  assert.equal(other.status, 403);
});

test("validation: unknown type, bad email, bad phone, missing label, unknown member", async () => {
  const badType = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "X", type: "Carrier Pigeon", value: "coo" }) });
  assert.equal(badType.status, 400);
  assert.equal(badType.data.error, "bad_type");
  const badEmail = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "X", type: "Email", value: "not-an-email" }) });
  assert.equal(badEmail.status, 400);
  const badPhone = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "X", type: "Phone/Text", value: "123" }) });
  assert.equal(badPhone.status, 400);
  const noLabel = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ type: "Email", value: "a@b.co" }) });
  assert.equal(noLabel.status, 400);
  const ghost = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ memberId: "m-nobody", label: "X", type: "Email", value: "a@b.co" }) });
  assert.equal(ghost.status, 404);
});

test("in-app methods are born verified (nothing external to confirm)", async () => {
  const r = await guest.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "My phone app", type: "In-App" }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.contactMethod.verified, true);
  assert.equal(r.data.contactMethod.optInStatus, "Opted In");
  assert.equal(r.data.contactMethod.value, "in-app");
});

test("id-preserving create is idempotent (client migration contract)", async () => {
  const first = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ id: "ct-mig-1", label: "Migrated", type: "Email", value: "mig@example.com", verified: true, optInStatus: "Opted In" }) });
  assert.equal(first.status, 200);
  assert.equal(first.data.contactMethod.verified, true, "migration preserves verified state");
  const again = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ id: "ct-mig-1", label: "Renamed?", type: "Email", value: "other@example.com" }) });
  assert.equal(again.status, 200);
  assert.equal(again.data.contactMethod.label, "Migrated", "existing id returned unchanged");
});

test("a member manages their own method; others' methods are role-gated", async () => {
  const mine = await guest.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "Managed", type: "Email", value: "manage@example.com" }) });
  const id = mine.data.contactMethod.id;
  // A member manages their own label and opt-in preference…
  const own = await guest.req(`/api/contact-methods/${id}`, { method: "PATCH", body: JSON.stringify({ label: "Managed (mine)", optInStatus: "Opted In" }) });
  assert.equal(own.status, 200);
  assert.equal(own.data.contactMethod.label, "Managed (mine)");
  // …but cannot self-attest verified — that takes the code loop or an adult
  // (covered in contact-verification.test.mjs).
  const attest = await guest.req(`/api/contact-methods/${id}`, { method: "PATCH", body: JSON.stringify({ verified: true }) });
  assert.equal(attest.status, 403);
  // Another non-adult cannot touch it…
  const foreign = await child.req(`/api/contact-methods/${id}`, { method: "PATCH", body: JSON.stringify({ label: "Sneaky" }) });
  assert.equal(foreign.status, 403);
  // …but an adult can, including a manual verified override.
  const adult = await owner.req(`/api/contact-methods/${id}`, { method: "PATCH", body: JSON.stringify({ label: "Managed (renamed)", verified: true }) });
  assert.equal(adult.status, 200);
  assert.equal(adult.data.contactMethod.label, "Managed (renamed)");
  assert.equal(adult.data.contactMethod.verified, true);
  assert.equal(adult.data.contactMethod.verifiedVia, "manual");
});

test("changing an external address resets verification", async () => {
  const r = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "Resettable", type: "Email", value: "one@example.com", verified: true, optInStatus: "Opted In" }) });
  const id = r.data.contactMethod.id;
  const patched = await owner.req(`/api/contact-methods/${id}`, { method: "PATCH", body: JSON.stringify({ value: "two@example.com" }) });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.contactMethod.value, "two@example.com");
  assert.equal(patched.data.contactMethod.verified, false);
  assert.equal(patched.data.contactMethod.optInStatus, "Pending");
});

test("delete is role-gated the same way", async () => {
  const mine = await guest.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "Doomed", type: "Email", value: "doomed@example.com" }) });
  const id = mine.data.contactMethod.id;
  const foreign = await child.req(`/api/contact-methods/${id}`, { method: "DELETE" });
  assert.equal(foreign.status, 403);
  const del = await guest.req(`/api/contact-methods/${id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  const list = await guest.req("/api/contact-methods");
  assert.ok(!list.data.contactMethods.some((c) => c.id === id), "removed from the registry");
});

/* ---- notify × registry resolution ---- */

test("notify refuses an unverified method (fail-closed, honest error)", async () => {
  const r = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "Unverified", type: "Email", value: "cold@example.com" }) });
  const send = await owner.req("/api/notify", { method: "POST", body: JSON.stringify({ methodId: r.data.contactMethod.id, title: "Hi", body: "x" }) });
  assert.equal(send.status, 200);
  assert.equal(send.data.ok, false);
  assert.equal(send.data.delivered, false);
  assert.equal(send.data.error, "method_not_verified");
});

test("notify refuses a verified-but-not-opted-in method", async () => {
  const r = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "No opt-in", type: "Email", value: "nope@example.com", verified: true, optInStatus: "Not Set" }) });
  const send = await owner.req("/api/notify", { method: "POST", body: JSON.stringify({ methodId: r.data.contactMethod.id, title: "Hi", body: "x" }) });
  assert.equal(send.data.ok, false);
  assert.equal(send.data.error, "method_not_opted_in");
});

test("a verified email method resolves its address from the registry and honestly reports needs-setup", async () => {
  // No Google account is connected in this environment, so the send can't succeed —
  // but reaching needs_setup:google proves the registry resolved type+address.
  // Created here rather than taken from the seed: seeded methods are deliberately
  // unverified (see the listing test), and this assertion is about ADDRESS RESOLUTION,
  // not about consent — it must not depend on demo data being pre-consented.
  const made = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ memberId: "m-alex", label: "Resolvable", type: "Email", value: "resolve@example.com", verified: true, optInStatus: "Opted In" }) });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const send = await owner.req("/api/notify", { method: "POST", body: JSON.stringify({ methodId: made.data.contactMethod.id, title: "Hi", body: "test" }) });
  assert.equal(send.data.ok, false);
  assert.equal(send.data.channel, "email");
  assert.equal(send.data.needsSetup, "google");
});

test("unknown methodId is refused without leaking anything", async () => {
  const send = await owner.req("/api/notify", { method: "POST", body: JSON.stringify({ methodId: "cm_does_not_exist", title: "Hi", body: "x" }) });
  assert.equal(send.data.ok, false);
  assert.equal(send.data.error, "method_not_found");
});

test("a registry-resolved in-app notification lands in the method OWNER's feed", async () => {
  const made = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ memberId: "m-noah", label: "Noah's app", type: "In-App" }) });
  const methodId = made.data.contactMethod.id;
  const send = await owner.req("/api/notify", { method: "POST", body: JSON.stringify({ methodId, title: "Pickup", body: "3pm today" }) });
  assert.equal(send.data.ok, true);
  assert.equal(send.data.delivered, true);
  // The recipient (Noah) sees it…
  const noahList = await child.req("/api/notifications");
  assert.ok(noahList.data.notifications.some((n) => n.id === send.data.notificationId), "delivered to the method owner");
  // …the sender does not get a copy in their own feed.
  const alexList = await owner.req("/api/notifications");
  assert.ok(!alexList.data.notifications.some((n) => n.id === send.data.notificationId), "not delivered to the sender");
});

test("the per-agent allowlist is enforced when an agentId is supplied", async () => {
  const made = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "Agent target", type: "In-App" }) });
  const methodId = made.data.contactMethod.id;
  const blocked = await owner.req("/api/notify", { method: "POST", body: JSON.stringify({ methodId, agentId: "agt_household", title: "Hi", body: "x" }) });
  assert.equal(blocked.data.ok, false);
  assert.equal(blocked.data.error, "agent_not_allowed");
  const allow = await owner.req(`/api/contact-methods/${methodId}`, { method: "PATCH", body: JSON.stringify({ allowedAgentIds: ["agt_household"] }) });
  assert.equal(allow.status, 200);
  const sent = await owner.req("/api/notify", { method: "POST", body: JSON.stringify({ methodId, agentId: "agt_household", title: "Hi", body: "x" }) });
  assert.equal(sent.data.ok, true);
  assert.equal(sent.data.delivered, true);
});

test("ad-hoc methodType/to sends still work (back-compat)", async () => {
  const r = await owner.req("/api/notify", { method: "POST", body: JSON.stringify({ methodType: "In-App", title: "Ad hoc", body: "no registry involved" }) });
  assert.equal(r.data.ok, true);
  assert.equal(r.data.channel, "in_app");
});
