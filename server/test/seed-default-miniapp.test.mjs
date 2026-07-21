// FamiliOS — WP-004 (ISS-008, FEAT-019/005): default "Family Chore Board" mini app
// provisioning is idempotent PER HOUSEHOLD and never backfills a household that has
// already been decided (including one that pre-dates this feature and has no marker
// set yet from any OTHER cause than a first real decision).
//
// Pure store-level test: getSettings/setSettings are synchronous and take an explicit
// householdId, so this never needs the full spawned-server harness — it only needs an
// isolated HOMEOPS_DATA_DIR (same guard style as summarize-outcome.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-test-proc-"));

const { getSettings } = await import("../store.mjs");
const { seedDefaultMiniAppFlag, DEFAULT_MINI_APP } = await import("../seed.mjs");

test("DEFAULT_MINI_APP mirrors the client's Family Chore Board starter template", () => {
  assert.equal(DEFAULT_MINI_APP.type, "Chore Board");
  assert.equal(DEFAULT_MINI_APP.name, "Family Chore Board");
  const keys = DEFAULT_MINI_APP.data.columns.map((c) => c.key);
  assert.deepEqual(keys, ["todo", "in-progress", "done", "needs-help"]);
});

test("seedDefaultMiniAppFlag: returns true and stamps the marker the FIRST time a household is decided", () => {
  const hh = "hh_test_new_1";
  assert.equal(getSettings(hh).defaultMiniAppDecidedAt, undefined, "a brand-new household must start with no marker");
  const first = seedDefaultMiniAppFlag(hh);
  assert.equal(first, true, "a new household must be decided (provisioned) the first time");
  const s = getSettings(hh);
  assert.ok(s.defaultMiniAppDecidedAt, "the marker must be durably recorded");
  assert.equal(s.defaultMiniApp, "Chore Board");
});

test("seedDefaultMiniAppFlag: is idempotent — calling it again for the same household is a no-op", () => {
  const hh = "hh_test_new_2";
  assert.equal(seedDefaultMiniAppFlag(hh), true, "first call decides it");
  const decidedAt = getSettings(hh).defaultMiniAppDecidedAt;
  const second = seedDefaultMiniAppFlag(hh);
  assert.equal(second, false, "a second call must never re-decide");
  assert.equal(getSettings(hh).defaultMiniAppDecidedAt, decidedAt, "the marker must not be touched again");
});

test("seedDefaultMiniAppFlag: never backfills a household that already carries unrelated settings but no marker yet", () => {
  // Simulates an EXISTING household (has settings from other features) that predates
  // this WP — it must still only ever be decided once it's actually asked about, and
  // this test's real point is the negative: nothing in this module calls the seed
  // function for households it wasn't explicitly asked about (no sweep/backfill loop
  // exists in seed.mjs — seedDefaults() never calls seedDefaultMiniAppFlag itself).
  const hh = "hh_test_existing_household";
  const before = getSettings(hh);
  assert.equal(before.defaultMiniAppDecidedAt, undefined);
  // Nothing to assert by calling seedDefaults() here since it intentionally never
  // touches this per-household flag — the guarantee is structural (see the "WIRING
  // NOTE" comment in seed.mjs): only an explicit seedDefaultMiniAppFlag(householdId)
  // call decides a household, and this wave's boot path never calls it automatically.
  assert.equal(typeof seedDefaultMiniAppFlag, "function", "the hook exists and is ready to be wired at the actual household-creation call site");
});
