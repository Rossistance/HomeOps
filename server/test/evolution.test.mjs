// P0.5 — accepting a skill evolution must actually mutate planner_guidance (snake_case).
// Previously the route passed camelCase plannerGuidance, which the skill schema ignored,
// so the guidance silently never changed. Also proves children/guests can't promote.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { startServer, stopServer, makeSession, readStoreDoc, writeStoreDoc } from "./harness.mjs";

let ctx, adultAdmin, child;
const SKILL_ID = "skl_morning_brief"; // seeded by seed.mjs
const NEW_GUIDANCE = "Lead with school pickups and prescription refills. Always confirm before sharing.";

// Seed a pending skill evolution straight into the server's isolated store.
function seedEvolution(id, patch = {}) {
  const all = readStoreDoc(ctx, "evolution.json", {});
  all[id] = {
    id, householdId: "local", kind: "skill", skillId: SKILL_ID,
    title: "Improve morning briefing", reason: "A step failed", after: NEW_GUIDANCE,
    status: "pending", createdAt: Date.now(), ...patch,
  };
  writeStoreDoc(ctx, "evolution.json", all);
}

before(async () => {
  ctx = await startServer();
  adultAdmin = await makeSession(ctx, "m-morgan");
  child = await makeSession(ctx, "m-noah");
});
after(async () => { await stopServer(ctx); });

test("accepting a skill evolution updates planner_guidance", async () => {
  seedEvolution("evo_guidance");
  const review = await adultAdmin.req("/api/evolution/evo_guidance/review", { method: "POST", body: JSON.stringify({ accept: true }) });
  assert.equal(review.status, 200);
  const skills = await adultAdmin.req("/api/skills");
  const skill = skills.data.skills.find((s) => s.id === SKILL_ID);
  assert.ok(skill, "seeded skill should exist");
  assert.equal(skill.planner_guidance, NEW_GUIDANCE, "guidance must actually change (snake_case key)");
  assert.equal(skill.plannerGuidance, undefined, "no stray camelCase field should be written");
});

test("a child cannot accept an evolution (cannot promote a skill)", async () => {
  seedEvolution("evo_child_block");
  const review = await child.req("/api/evolution/evo_child_block/review", { method: "POST", body: JSON.stringify({ accept: true }) });
  assert.equal(review.status, 403);
});
