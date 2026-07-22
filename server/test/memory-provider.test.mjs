// WP-007 s2 — memory-provider.mjs unit tests: the provider interface itself (add/search/
// profile/health), containerTag isolation between two households, and the fail-soft
// contract (degraded paths never throw, and a dead sidecar respects its timeout budget).
// Pure, store-free: each test builds its own isolated provider instance (own temp dataDir),
// no HTTP server, no live sidecar (see memory-provider-sidecar.test.mjs for that).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { createMemoryProvider } from "../memory-provider.mjs";

function tmpDir() {
  return fs.mkdtempSync(join(os.tmpdir(), "homeops-memprov-"));
}

test("add/search/profile/health happy path over the sqlite-FTS5 backend", async () => {
  const mp = createMemoryProvider({ dataDir: tmpDir() });
  assert.equal(mp.backend, "sqlite-fts5");

  const h0 = await mp.health();
  assert.equal(h0.ok, true);
  assert.equal(h0.degraded, false);

  const a = await mp.add("The family does taco night on Wednesdays", { containerTag: "hh1", scope: "household", type: "Routine" });
  assert.equal(a.ok, true);
  assert.ok(a.id);

  const s = await mp.search("taco night", { containerTag: "hh1" });
  assert.equal(s.ok, true);
  assert.equal(s.degraded, false);
  assert.equal(s.results.length, 1);
  assert.match(s.results[0].text, /taco night/);

  const p = await mp.profile({ containerTag: "hh1" });
  assert.equal(p.ok, true);
  assert.equal(p.totalMemories, 1);
  assert.equal(p.byType.Routine, 1);
  assert.equal(p.highlights.length, 1);
});

test("empty text is rejected without throwing or writing a row", async () => {
  const mp = createMemoryProvider({ dataDir: tmpDir() });
  const r = await mp.add("   ", { containerTag: "hh1" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "empty_text");
  const p = await mp.profile({ containerTag: "hh1" });
  assert.equal(p.totalMemories, 0);
});

test("containerTag isolates memory between two households sharing one store", async () => {
  const mp = createMemoryProvider({ dataDir: tmpDir() });
  await mp.add("Household 1 only: allergic to peanuts", { containerTag: "hh1", scope: "household" });
  await mp.add("Household 2 only: allergic to shellfish", { containerTag: "hh2", scope: "household" });

  const s1 = await mp.search("allergic", { containerTag: "hh1" });
  assert.equal(s1.results.length, 1);
  assert.match(s1.results[0].text, /peanuts/);

  const s2 = await mp.search("allergic", { containerTag: "hh2" });
  assert.equal(s2.results.length, 1);
  assert.match(s2.results[0].text, /shellfish/);

  const p1 = await mp.profile({ containerTag: "hh1" });
  const p2 = await mp.profile({ containerTag: "hh2" });
  assert.equal(p1.totalMemories, 1);
  assert.equal(p2.totalMemories, 1);

  // A browse-all (no query) search must never leak the other household's rows either.
  const browse1 = await mp.search("", { containerTag: "hh1" });
  assert.equal(browse1.results.length, 1);
  assert.match(browse1.results[0].text, /peanuts/);
});

test("a query with no lexical hits returns ok:true with zero results (not degraded)", async () => {
  const mp = createMemoryProvider({ dataDir: tmpDir() });
  await mp.add("Grandma visits every Sunday afternoon", { containerTag: "hh1" });
  const s = await mp.search("spaceship", { containerTag: "hh1" });
  assert.equal(s.ok, true);
  assert.equal(s.degraded, false);
  assert.deepEqual(s.results, []);
});

test("fail-soft: an unreachable sidecar degrades within its timeout budget instead of throwing or hanging", async () => {
  const mp = createMemoryProvider({
    dataDir: tmpDir(),
    sidecarEnabled: true,
    sidecarUrl: "http://127.0.0.1:1", // nothing listens here
    timeoutMs: 300,
  });
  const t0 = Date.now();
  const r = await mp.add("test memory", { containerTag: "hh1" });
  const elapsed = Date.now() - t0;
  // Falls through to the sqlite backend after the sidecar attempt fails/times out — the
  // call still succeeds overall (fail-soft to the local store), and never hangs past a
  // couple of timeout budgets.
  assert.equal(r.ok, true);
  assert.ok(elapsed < 3000, `expected the sidecar timeout to bound total latency, took ${elapsed}ms`);
});

test("fail-soft: a provider whose sqlite store can't even open reports degraded, never throws", async () => {
  // Point dataDir at a path that is itself a FILE, so mkdirSync("<dataDir>/supermemory")
  // fails — a realistic "can't open the store" condition (permissions, disk, corruption).
  const base = tmpDir();
  const fileAsDir = join(base, "not-a-directory");
  fs.writeFileSync(fileAsDir, "x");
  const mp = createMemoryProvider({ dataDir: fileAsDir });

  const h = await mp.health();
  assert.equal(h.ok, false);
  assert.equal(h.degraded, true);

  const a = await mp.add("anything", { containerTag: "hh1" });
  assert.equal(a.ok, false);
  assert.equal(a.degraded, true);

  const s = await mp.search("anything", { containerTag: "hh1" });
  assert.equal(s.ok, false);
  assert.equal(s.degraded, true);
  assert.deepEqual(s.results, []);

  const p = await mp.profile({ containerTag: "hh1" });
  assert.equal(p.ok, false);
  assert.equal(p.degraded, true);
});

test("add() with an explicit id is idempotent (migration re-run safety)", async () => {
  const mp = createMemoryProvider({ dataDir: tmpDir() });
  const first = await mp.add("Recurring dentist appointment every March", { containerTag: "hh1", id: "sm_migrated_mem_abc123" });
  assert.equal(first.ok, true);
  assert.equal(first.deduped, undefined);
  const second = await mp.add("Recurring dentist appointment every March", { containerTag: "hh1", id: "sm_migrated_mem_abc123" });
  assert.equal(second.ok, true);
  assert.equal(second.deduped, true);
  const p = await mp.profile({ containerTag: "hh1" });
  assert.equal(p.totalMemories, 1, "re-adding the same id must not duplicate the row");
});
