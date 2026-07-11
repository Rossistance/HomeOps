// MEMBER COLOR — optional per-member accent (an app accent name or a hex string).
// Optional + back-compat: members without a color keep working and read back null.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, admin;
before(async () => {
  ctx = await startServer();
  admin = await makeSession(ctx, "m-morgan"); // Adult Admin — manages the roster
});
after(async () => { await stopServer(ctx); });

test("color round-trips on create, on PATCH (hex), on the roster read, and clears on null", async () => {
  const created = await admin.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Robin", role: "Adult Member", color: "sage" }) });
  assert.equal(created.status, 200);
  assert.equal(created.data.member.color, "sage");
  const actorId = created.data.member.actorId;

  // Appears on the roster read.
  const roster = (await admin.req("/api/members")).data.members;
  assert.equal(roster.find((m) => m.actorId === actorId).color, "sage");

  // PATCH to a hex value.
  const hex = await admin.req(`/api/members/${actorId}`, { method: "PATCH", body: JSON.stringify({ color: "#ff8800" }) });
  assert.equal(hex.status, 200);
  assert.equal(hex.data.member.color, "#ff8800");

  // An unrecognized color is ignored (keeps the prior value), never stored.
  const bad = await admin.req(`/api/members/${actorId}`, { method: "PATCH", body: JSON.stringify({ color: "chartreuse-ish" }) });
  assert.equal(bad.status, 200);
  assert.equal(bad.data.member.color, "#ff8800", "invalid color ignored, previous kept");

  // Explicit null clears it.
  const cleared = await admin.req(`/api/members/${actorId}`, { method: "PATCH", body: JSON.stringify({ color: null }) });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.member.color, null);
});

test("a member created without a color still works and reads back null (back-compat)", async () => {
  const created = await admin.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Jesse", role: "Child View" }) });
  assert.equal(created.status, 200);
  assert.equal(created.data.member.color, null);
  const roster = (await admin.req("/api/members")).data.members;
  assert.equal(roster.find((m) => m.actorId === created.data.member.actorId).color, null);
});
