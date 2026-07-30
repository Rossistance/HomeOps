// R0 data durability contracts, now over the tenant db (C1.1): backup
// round-trip, restore refusing a tampered bundle, corruption quarantine
// (a collection that can't be read cleanly must never be silently
// overwritten), and shutdown lease release.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

let store, backup;
const DIR = fs.mkdtempSync(join(os.tmpdir(), "familios-backup-test-"));

before(async () => {
  process.env.HOMEOPS_DATA_DIR = DIR;
  // A corrupt LEGACY collection sits in the data root before first boot — the
  // migration must quarantine it (preserved in place), not destroy or shadow it.
  fs.writeFileSync(join(DIR, "tasks.json"), "{ corrupt!!");
  store = await import("../store.mjs");
  backup = await import("../backup.mjs");
});

test("backup round-trip: snapshot captures collections and restore brings them back", async () => {
  store.putMember({ actorId: "m-owner", displayName: "Ross", role: "Owner", householdId: "local" });
  const name = backup.createBackup();
  assert.ok(backup.listBackups().some((b) => b.name === name));

  // Damage the live record, then restore.
  store.putMember({ actorId: "m-owner", displayName: "WRONG NAME", role: "Guest", householdId: "local" });
  const out = backup.restoreBackup(name);
  assert.equal(out.ok, true, JSON.stringify(out));
  const m = store.getMember("m-owner");
  assert.equal(m.displayName, "Ross");
  assert.equal(m.role, "Owner");
});

// Snapshots live under backups/<householdId>/ as of 2026-07-30 — one bundle per household
// rather than one shared bundle containing every tenant. See the header note in backup.mjs
// for why (any signed-up stranger is an Owner, and Owner was the whole gate).
const tenantBackupDir = (t = "local") => join(DIR, "backups", t);

test("restore refuses a tampered bundle (never partial-writes)", async () => {
  store.putMember({ actorId: "m-owner", displayName: "Ross", role: "Owner", householdId: "local" });
  const name = backup.createBackup();
  const p = join(tenantBackupDir(), name);
  const { gunzipSync, gzipSync } = await import("node:zlib");
  const bundle = JSON.parse(gunzipSync(fs.readFileSync(p)).toString("utf8"));
  bundle.files = "definitely not a files object"; // format 3 is single-tenant
  fs.writeFileSync(p, gzipSync(JSON.stringify(bundle)));
  const out = backup.restoreBackup(name);
  assert.equal(out.ok, false);
  assert.equal(out.error, "bad_format");
  assert.equal(store.getMember("m-owner").displayName, "Ross", "live data untouched");
});

test("legacy format-1 bundles (JSON-file era) still restore", async () => {
  const { gzipSync } = await import("node:zlib");
  const legacy = {
    meta: { format: 1, app: "familios" },
    files: { "events.json": JSON.stringify({ ev1: { id: "ev1", title: "From the old world" } }) },
  };
  const name = "familios-backup-2026-01-01.json.gz";
  fs.mkdirSync(tenantBackupDir(), { recursive: true });
  fs.writeFileSync(join(tenantBackupDir(), name), gzipSync(JSON.stringify(legacy)));
  const out = backup.restoreBackup(name);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(store.getEvent("ev1").title, "From the old world");
});

test("a format-2 all-tenant bundle imports only the caller's own slice", async () => {
  // The pre-2026-07-30 shape, restored by a household: its own slice lands, a neighbour's
  // does not. Proven at the HTTP layer too in backup-tenant-isolation.test.mjs; this pins
  // the module contract directly.
  const { gzipSync } = await import("node:zlib");
  const name = "familios-backup-2026-01-02.json.gz";
  fs.mkdirSync(tenantBackupDir(), { recursive: true });
  fs.writeFileSync(join(tenantBackupDir(), name), gzipSync(JSON.stringify({
    meta: { format: 2, app: "familios", tenants: ["local", "hh_neighbour"] },
    tenants: {
      local: { files: { "events.json": { ev2: { id: "ev2", title: "Mine" } } }, audit: "" },
      hh_neighbour: { files: { "events.json": { ev3: { id: "ev3", title: "Theirs" } } }, audit: "" },
    },
  })));
  const out = backup.restoreBackup(name);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(store.getEvent("ev2")?.title, "Mine");
  assert.ok(!store.getEvent("ev3"), "the neighbour's slice was not imported");
});

test("corruption quarantine: reads fall back, writes REFUSE until acknowledged", () => {
  // tasks.json was corrupt at boot (see before()): reads degrade to empty…
  assert.deepEqual(store.listTasks(() => true), []);
  const q = store.quarantinedCollections();
  assert.ok(q.some((x) => x.file === "tasks.json"), JSON.stringify(q));
  // …the original is preserved in place, never destroyed or migrated…
  assert.ok(fs.existsSync(join(DIR, "tasks.json")), "corrupt original preserved");
  // …and writes must throw — this is the whole point.
  assert.throws(() => store.putTask({ id: "tk_x", householdId: "local", title: "boom", type: "task", status: "todo" }), /store_quarantined/);
  // Owner acknowledges (after recovering what they can) → writes flow again.
  assert.equal(store.acknowledgeQuarantine("tasks.json"), true);
  const rec = store.putTask({ id: "tk_x", householdId: "local", title: "ok now", type: "task", status: "todo" });
  assert.equal(rec.title, "ok now");
});

test("releaseAllLeases hands leases back without touching run state", async () => {
  const engine = await import("../engine.mjs");
  const runId = "run_leasetest";
  store.createRun({ id: runId, householdId: "local", status: "running", cursor: 0, steps: [], lease: { owner: 1, at: Date.now() } });
  const released = engine.releaseAllLeases();
  assert.ok(released >= 1);
  const run = store.getRun(runId);
  assert.equal(run.lease, null);
  assert.equal(run.status, "running", "state preserved for recovery");
});
