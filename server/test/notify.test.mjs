// Item 16b — notification delivery. Real per-channel routing with honest availability:
// in-app/dashboard always work (durable record); email/text report needs-setup when the
// caller has no connected Google account / no configured SMS connector (the case in this
// env, since a live Google/Twilio account isn't available). Actor-scoped reads.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult, other;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan");
  other = await makeSession(ctx, "m-alex");
});
after(async () => { await stopServer(ctx); });

test("in-app notification is delivered and durably stored", async () => {
  const r = await adult.req("/api/notify", { method: "POST", body: JSON.stringify({ methodType: "In-App", title: "School pickup", body: "Noah needs pickup at 3pm." }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.channel, "in_app");
  assert.equal(r.data.delivered, true);
  const list = await adult.req("/api/notifications");
  const found = list.data.notifications.find((n) => n.id === r.data.notificationId);
  assert.ok(found, "notification persisted");
  assert.equal(found.title, "School pickup");
  assert.equal(found.read, false);
});

test("Family Dashboard routes to the dashboard channel and stores a record", async () => {
  const r = await adult.req("/api/notify", { method: "POST", body: JSON.stringify({ methodType: "Family Dashboard", title: "Movie night", body: "7pm Friday" }) });
  assert.equal(r.data.channel, "dashboard");
  assert.equal(r.data.delivered, true);
});

test("email delivery honestly reports needs-setup when no Google account is connected", async () => {
  const r = await adult.req("/api/notify", { method: "POST", body: JSON.stringify({ methodType: "Email", to: "gran@example.com", title: "Hi", body: "test" }) });
  assert.equal(r.data.ok, false);
  assert.equal(r.data.channel, "email");
  assert.equal(r.data.delivered, false);
  assert.equal(r.data.needsSetup, "google");
});

test("text delivery honestly reports needs-setup when the SMS connector isn't configured", async () => {
  const r = await adult.req("/api/notify", { method: "POST", body: JSON.stringify({ methodType: "Phone/Text", to: "+15551234567", title: "Hi", body: "test" }) });
  assert.equal(r.data.ok, false);
  assert.equal(r.data.channel, "sms");
  assert.equal(r.data.delivered, false);
  assert.equal(r.data.needsSetup, "sms");
});

test("a notification is only visible to the actor it was sent to", async () => {
  const r = await adult.req("/api/notify", { method: "POST", body: JSON.stringify({ methodType: "In-App", title: "Private", body: "for morgan only" }) });
  const otherList = await other.req("/api/notifications");
  assert.ok(!otherList.data.notifications.some((n) => n.id === r.data.notificationId), "another actor cannot see it");
  // ...and can't mark it read.
  const readAttempt = await other.req(`/api/notifications/${r.data.notificationId}/read`, { method: "POST" });
  assert.equal(readAttempt.status, 404);
});

test("marking a notification read flips its flag", async () => {
  const r = await adult.req("/api/notify", { method: "POST", body: JSON.stringify({ methodType: "In-App", title: "Read me", body: "x" }) });
  const read = await adult.req(`/api/notifications/${r.data.notificationId}/read`, { method: "POST" });
  assert.equal(read.status, 200);
  const list = await adult.req("/api/notifications");
  assert.equal(list.data.notifications.find((n) => n.id === r.data.notificationId).read, true);
});
