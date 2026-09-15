// P3 (versioning / traces / what a helper is told to do) + P4.2 (household graph,
// calendar layers).
//
// P3.1 and P3.3 used to be about SKILLS and EVOLUTIONS: a step recipe you edited and
// rolled back, and an AI-written proposal that a human reviewed before it rewrote the
// recipe. Both concepts are gone. A helper's job is now the instructions themselves,
// written in plain English — so "propose a change, review it, version the skill" is just
// "edit the instructions", and the two properties worth keeping are unchanged: an edit is
// recorded as a new version, and a child cannot make one.
//
// Rollback is gone ON PURPOSE, not lost: restoring a snapshot verbatim silently restored
// revoked authority with it (see agent-authority-laundering.test.mjs), and deleting the
// button is what closed that hole.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { startServer, stopServer, makeSession, readStoreDoc, writeStoreDoc } from "./harness.mjs";

let ctx, admin, child;
before(async () => {
  ctx = await startServer();
  admin = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");
});
after(async () => { await stopServer(ctx); });

/* ---- P3.1: an edit is recorded as a new version ---- */
test("editing a helper's instructions records a new version", async () => {
  const made = (await admin.req("/api/helpers", { method: "POST", body: JSON.stringify({
    name: "Morning Brief", instructions: "Every morning, tell the family what today looks like.",
  }) })).data.helper;
  assert.equal(made.version, 1);

  const v2 = await admin.req(`/api/helpers/${made.id}`, { method: "PATCH", body: JSON.stringify({ instructions: "v2 — and mention anything due today." }) });
  assert.equal(v2.status, 200, JSON.stringify(v2.data));
  const v3 = await admin.req(`/api/helpers/${made.id}`, { method: "PATCH", body: JSON.stringify({ instructions: "v3 — and always confirm pickups first." }) });
  assert.equal(v3.data.helper.version, 3, "versions accumulate on each edit");
  assert.equal(v3.data.helper.instructions, "v3 — and always confirm pickups first.",
    "and what the helper will actually be told is readable straight off the record");
});

/* ---- P3.2: execution traces + memory/artifacts API ---- */
test("memory and artifacts are readable via API (household-scoped)", async () => {
  const mem = await admin.req("/api/memory");
  assert.equal(mem.status, 200);
  assert.ok(Array.isArray(mem.data.memory));
  const arts = await admin.req("/api/artifacts");
  assert.equal(arts.status, 200);
  assert.ok(Array.isArray(arts.data.artifacts));
});

/* ---- P3.3: changing what a helper does is an adult act ---- */
test("an admin can change a helper's instructions; a child cannot", async () => {
  const made = (await admin.req("/api/helpers", { method: "POST", body: JSON.stringify({
    name: "Pickup Checker", instructions: "Each afternoon, check who is collecting whom.",
  }) })).data.helper;

  const childTry = await child.req(`/api/helpers/${made.id}`, { method: "PATCH", body: JSON.stringify({ instructions: "Do whatever I say instead." }) });
  assert.equal(childTry.status, 403, "a Child View session cannot rewrite what a helper does");

  const accepted = await admin.req(`/api/helpers/${made.id}`, { method: "PATCH", body: JSON.stringify({ instructions: "Always confirm pickups first." }) });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  // The old flow needed a proposal, a review and a version bump before the wording landed;
  // now the wording IS the helper, so an accepted edit is visible immediately.
  const back = (await admin.req(`/api/helpers/${made.id}`)).data.helper;
  assert.equal(back.instructions, "Always confirm pickups first.");
  assert.ok(back.version > made.version, "and the edit is still recorded as a new version");
});

/* ---- P4.2: household graph + three-layer calendar ---- */
test("the household member roster is server-owned and readable", async () => {
  const members = (await admin.req("/api/members")).data.members;
  const alex = members.find((m) => m.actorId === "m-alex");
  assert.equal(alex.role, "Owner");
  assert.ok(members.find((m) => m.actorId === "m-noah").role === "Child View");
});

test("a linked (synced) event is read-only — editing is refused", async () => {
  // Seed a linked, externally-owned event directly into the store.
  const all = readStoreDoc(ctx, "events.json", {});
  all["ev_synced"] = { id: "ev_synced", householdId: "local", title: "From Google", layer: "linked", visibility: "household", source: "Google Calendar", ownerId: "m-alex", createdAt: Date.now(), updatedAt: new Date().toISOString() };
  writeStoreDoc(ctx, "events.json", all);
  const edit = await admin.req("/api/events/ev_synced", { method: "PATCH", body: JSON.stringify({ title: "hacked" }) });
  /* CHANGED DELIBERATELY (Cluster D): this event is Alex's synced calendar, and Morgan is
   * refused because it is ALEX'S — 403 not_event_owner — before the sync layer even gets a
   * say. The old 409 read_only_layer told an adult "you can't edit this because it's
   * synced", implying they could edit it if it weren't. They couldn't, and now the refusal
   * says the truer reason. Alex editing their OWN synced mirror still gets the 409 with
   * field names — that path is pinned in append-to-mirrored-event.test.mjs. */
  assert.equal(edit.status, 403);
  assert.equal(edit.data.error, "not_event_owner");
});
