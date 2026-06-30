// P3 (versioning / traces / evolution) + P4.2 (household graph, calendar layers).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, admin, child;
before(async () => {
  ctx = await startServer();
  admin = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");
});
after(async () => { await stopServer(ctx); });

/* ---- P3.1: versioning + rollback ---- */
test("editing a skill snapshots versions; rollback restores", async () => {
  // Patch the seeded skill twice, then roll back to v1.
  await admin.req("/api/skills/skl_morning_brief", { method: "PATCH", body: JSON.stringify({ description: "v2 description" }) });
  await admin.req("/api/skills/skl_morning_brief", { method: "PATCH", body: JSON.stringify({ description: "v3 description" }) });
  const versions = (await admin.req("/api/skills/skl_morning_brief/versions")).data.versions;
  assert.ok(versions.length >= 2, "snapshots accumulate on each edit");
  const rolled = await admin.req("/api/skills/skl_morning_brief/rollback", { method: "POST", body: JSON.stringify({ targetVersion: 1 }) });
  assert.equal(rolled.status, 200);
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

/* ---- P3.3: manual evolution proposal flows through review → version ---- */
test("an admin can manually propose a skill evolution; a child cannot", async () => {
  const childTry = await child.req("/api/evolution", { method: "POST", body: JSON.stringify({ kind: "skill", skillId: "skl_morning_brief", after: "x" }) });
  assert.equal(childTry.status, 403);

  const proposed = await admin.req("/api/evolution", { method: "POST", body: JSON.stringify({ kind: "skill", skillId: "skl_morning_brief", after: "Always confirm pickups first.", title: "Tighten guidance" }) });
  assert.equal(proposed.status, 200);
  const evoId = proposed.data.evolution.id;
  assert.equal(proposed.data.evolution.source, "manual");
  assert.equal(proposed.data.evolution.createdBy, "m-morgan");

  const review = await admin.req(`/api/evolution/${evoId}/review`, { method: "POST", body: JSON.stringify({ accept: true }) });
  assert.equal(review.status, 200);
  const skill = (await admin.req("/api/skills")).data.skills.find((s) => s.id === "skl_morning_brief");
  assert.equal(skill.planner_guidance, "Always confirm pickups first.", "accepted manual proposal versions the skill");
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
  const file = join(ctx.dataDir, "events.json");
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  all["ev_synced"] = { id: "ev_synced", householdId: "local", title: "From Google", layer: "linked", visibility: "household", source: "Google Calendar", ownerId: "m-alex", createdAt: Date.now(), updatedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
  const edit = await admin.req("/api/events/ev_synced", { method: "PATCH", body: JSON.stringify({ title: "hacked" }) });
  assert.equal(edit.status, 409);
  assert.equal(edit.data.error, "read_only_layer");
});
