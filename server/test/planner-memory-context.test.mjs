// WP-007 s4 — planner.mjs's buildServerContext() memory read path: profile()+search(goal)
// when the memory-provider is healthy, legacy flat listMemory() with an EXPLICIT
// disclosure marker when it's degraded. Pure store-level test (no HTTP server) — same
// isolation convention as planner-catalog-prune.test.mjs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

const DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-planner-mem-"));
process.env.HOMEOPS_DATA_DIR = DATA_DIR;
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";

const { buildServerContext } = await import("../planner.mjs");
const store = await import("../store.mjs");
const { memoryProvider } = await import("../memory-provider.mjs");

after(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

test("healthy provider: recentMemory comes from profile()+search(goal), no disclosure marker", async () => {
  await memoryProvider.add("The family does taco night on Wednesdays", { containerTag: "local", scope: "household", type: "Routine" });
  await memoryProvider.add("Grandma visits every Sunday afternoon", { containerTag: "local", scope: "household", type: "Routine" });
  // Legacy tenant store deliberately left EMPTY here — proves the healthy path is really
  // reading from the provider, not silently falling back to listMemory().
  const session = { householdId: "local", actorId: "m-alex", role: "Owner" };
  const ctx = await buildServerContext(session, {}, { goal: "what do we usually do on Wednesdays?" });
  assert.equal(ctx.memoryDisclosure, undefined, "no disclosure marker when the provider is healthy");
  assert.ok(Array.isArray(ctx.recentMemory));
  assert.ok(ctx.recentMemory.some((m) => /taco night/.test(m.text)), "goal-relevant memory surfaced via search()");
});

test("healthy provider: personal memory belonging to another actor is never leaked", async () => {
  await memoryProvider.add("Alex's personal note: prefers early meetings", { containerTag: "local", scope: "personal", type: "Preference", sourceActorId: "m-alex" });
  await memoryProvider.add("Morgan's personal note: allergic to shellfish", { containerTag: "local", scope: "personal", type: "Fact", sourceActorId: "m-morgan" });
  const asAlex = await buildServerContext({ householdId: "local", actorId: "m-alex", role: "Owner" }, {}, { goal: "personal note" });
  assert.ok(asAlex.recentMemory.some((m) => /Alex's personal note/.test(m.text)), "own personal memory is visible");
  assert.ok(!asAlex.recentMemory.some((m) => /Morgan's personal note/.test(m.text)), "another actor's personal memory must never leak");
});

test("degraded provider: falls back to the legacy flat list with an explicit disclosure marker", async () => {
  // Seed the LEGACY tenant store for a household the healthy-path tests above never
  // touched, so the fallback has something distinctive to show.
  store.addMemory({ householdId: "local3", scope: "household", type: "Fact", text: "Legacy fallback fact for household local3" });

  // Force the module singleton degraded WITHOUT touching its sqlite file — monkey-patch
  // health() (and profile/search, so nothing accidentally answers) exactly the way
  // memory-provider.test.mjs proves a real "can't open the store" failure behaves: ok:false,
  // degraded:true, never a thrown error. Restored in finally so later tests aren't affected.
  const originals = { health: memoryProvider.health, profile: memoryProvider.profile, search: memoryProvider.search };
  memoryProvider.health = async () => ({ ok: false, degraded: true, backend: "sqlite-fts5", error: "forced_degraded_for_test" });
  memoryProvider.profile = async () => ({ ok: false, degraded: true });
  memoryProvider.search = async () => ({ ok: false, degraded: true, results: [] });
  try {
    const session = { householdId: "local3", actorId: "m-alex", role: "Owner" };
    const ctx = await buildServerContext(session, {}, { goal: "anything" });
    assert.equal(ctx.memoryDisclosure, "memory recall degraded — sidecar offline, showing recent entries only");
    assert.ok(Array.isArray(ctx.recentMemory));
    assert.ok(ctx.recentMemory.some((m) => /Legacy fallback fact/.test(m.text)), "legacy flat list still serves the fallback");
  } finally {
    Object.assign(memoryProvider, originals);
  }
});

test("provider healthy but profile/search themselves error: still falls back honestly", async () => {
  store.addMemory({ householdId: "local4", scope: "household", type: "Fact", text: "Legacy fact for local4 used when profile/search error" });
  const originals = { health: memoryProvider.health, profile: memoryProvider.profile, search: memoryProvider.search };
  memoryProvider.health = async () => ({ ok: true, degraded: false, backend: "sqlite-fts5" });
  memoryProvider.profile = async () => ({ ok: false, degraded: true, error: "boom" });
  memoryProvider.search = async () => ({ ok: false, degraded: true, results: [] });
  try {
    const session = { householdId: "local4", actorId: "m-alex", role: "Owner" };
    const ctx = await buildServerContext(session, {}, { goal: "anything" });
    assert.equal(ctx.memoryDisclosure, "memory recall degraded — provider returned an error, showing recent entries only");
    assert.ok(ctx.recentMemory.some((m) => /Legacy fact for local4/.test(m.text)));
  } finally {
    Object.assign(memoryProvider, originals);
  }
});
