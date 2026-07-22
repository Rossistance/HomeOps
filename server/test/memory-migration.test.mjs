// WP-007 s3 — migration script (server/scripts/migrate-memory-to-provider.mjs) on a
// fixture tenant: dry-run parity report first, then idempotent apply.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

const DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-migration-"));
process.env.HOMEOPS_DATA_DIR = DATA_DIR;
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";

const store = await import("../store.mjs");
const { memoryProvider } = await import("../memory-provider.mjs");
const { main, readViaStore } = await import("../scripts/migrate-memory-to-provider.mjs");

after(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

// Seed a fixture tenant directly through store.mjs (this is the sanctioned "isolated
// dataDir, nothing else has it open" path the migration script itself uses for dry runs).
const FIXTURE = [
  { householdId: "local", scope: "household", type: "Routine", text: "The family does taco night on Wednesdays" },
  { householdId: "local", scope: "household", type: "Fact", text: "We're vegetarian on weeknights" },
  { householdId: "local", scope: "personal", type: "Preference", text: "Alex prefers early morning meetings", source: { actorId: "m-alex" } },
];
const seeded = FIXTURE.map((m) => store.addMemory(m));

test("readViaStore sees exactly the fixture rows", async () => {
  const r = await readViaStore();
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, FIXTURE.length);
});

test("dry run prints a parity report and writes NOTHING to the provider", async () => {
  const before = await memoryProvider.profile({ containerTag: "local" });
  assert.equal(before.totalMemories ?? 0, 0, "provider starts empty");

  const result = await main(); // APPLY defaults false when --apply is absent from argv
  assert.equal(result.applied, false);
  assert.ok(result.byHousehold.get("local"));
  assert.equal(result.byHousehold.get("local").length, FIXTURE.length);

  const after1 = await memoryProvider.profile({ containerTag: "local" });
  assert.equal(after1.totalMemories ?? 0, 0, "dry run must never write");
});

test("apply migrates every fixture row, and re-running apply is idempotent (no duplicates)", async () => {
  process.argv.push("--apply");
  try {
    const first = await main();
    assert.equal(first.applied, true);
    assert.equal(first.outcome.written, FIXTURE.length);
    assert.equal(first.outcome.deduped, 0);
    assert.equal(first.outcome.failed, 0);

    const profileAfterFirst = await memoryProvider.profile({ containerTag: "local" });
    assert.equal(profileAfterFirst.totalMemories, FIXTURE.length);

    // Re-run: every row should now be reported as already-present (deduped), not written again.
    const second = await main();
    assert.equal(second.outcome.written, 0);
    assert.equal(second.outcome.deduped, FIXTURE.length);
    assert.equal(second.outcome.failed, 0);

    const profileAfterSecond = await memoryProvider.profile({ containerTag: "local" });
    assert.equal(profileAfterSecond.totalMemories, FIXTURE.length, "idempotent re-run must not duplicate rows");
  } finally {
    process.argv = process.argv.filter((a) => a !== "--apply");
  }
});

test("tenant records are untouched by migration (read-only on the source)", async () => {
  for (const rec of seeded) {
    const still = store.getMemoryEntry(rec.id);
    assert.ok(still, `tenant row ${rec.id} still exists`);
    assert.equal(still.text, rec.text);
  }
});
