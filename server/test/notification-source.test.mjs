// UPDATES KNOW WHERE THEY CAME FROM — every in-app notification records its source so the
// Inbox can group deliveries by helper and jump to that helper's thread. Invariants: a
// helper's delivery carries { kind:"helper", id, name } and the helper's conversationId; a
// person's ad-hoc send carries { kind:"member" }; the record still reads back through
// GET /api/notifications with those fields intact.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner;
before(async () => { ctx = await startServer(); owner = await makeSession(ctx, "m-alex"); });
after(async () => { await stopServer(ctx); });

test("an ad-hoc in-app send is stamped as a member source", async () => {
  const r = await owner.req("/api/notify", { method: "POST", body: JSON.stringify({ methodType: "In-App", title: "Hello", body: "From a person" }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.delivered, true);
  const list = await owner.req("/api/notifications");
  const rec = list.data.notifications.find((n) => n.id === r.data.notificationId);
  assert.ok(rec, "the record is listed");
  assert.deepEqual(rec.source, { kind: "member", id: "m-alex", name: "Alex Harper" });
  assert.equal(rec.conversationId, null);
});

test("a helper's delivery is stamped as a helper source with its conversation", async () => {
  const h = await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({ name: "Morning Briefing", instructions: "Say good morning." }) });
  assert.equal(h.status, 200, JSON.stringify(h.data));
  const helper = h.data.helper ?? h.data.agent;
  // A verified, opted-in In-App method for the owner that allows this helper.
  const m = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "In-App", type: "In-App", value: "in-app", verified: true, optInStatus: "Opted In", allowedAgentIds: [helper.id] }) });
  assert.equal(m.status, 200, JSON.stringify(m.data));
  // The registry path with an acting helper: the same call homeops.notify_contact makes.
  const r = await owner.req("/api/notify", { method: "POST", body: JSON.stringify({ methodId: m.data.contactMethod.id, title: "Today's plan", body: "One event.", agentId: helper.id }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const list = await owner.req("/api/notifications");
  const rec = list.data.notifications.find((n) => n.id === r.data.notificationId);
  assert.ok(rec);
  assert.equal(rec.source.kind, "helper");
  assert.equal(rec.source.id, helper.id);
  assert.equal(rec.source.name, "Morning Briefing");
});
