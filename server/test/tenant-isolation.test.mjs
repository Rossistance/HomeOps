// C1.1 cross-tenant isolation invariants (written FIRST, per the plan).
//
// These test the tenant storage engine directly — the layer every store
// accessor sits on. The invariant: NOTHING written under one household id is
// ever readable, listable, or deletable under another. If these fail, no
// route-level scoping can save us, so they gate the store swap.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { createEngine } from "../tenant-db.mjs";

function tmpDir() {
  return fs.mkdtempSync(join(os.tmpdir(), "familios-tenant-test-"));
}

describe("cross-tenant isolation (storage engine)", () => {
  let dir, engine;
  before(() => { dir = tmpDir(); engine = createEngine(dir); });
  after(() => { try { engine.closeAll(); fs.rmSync(dir, { recursive: true, force: true }); } catch { /* win file locks */ } });

  it("records written in tenant A are invisible in tenant B", () => {
    engine.putRecord("hh-a", "tasks", "t1", { id: "t1", title: "A's secret task" });
    assert.equal(engine.getRecord("hh-b", "tasks", "t1"), null);
    assert.deepEqual(engine.allRecords("hh-b", "tasks"), null); // not even row-backed
    assert.deepEqual(engine.getDoc("hh-b", "tasks.json", {}), {});
    // and A still sees its own
    assert.equal(engine.getRecord("hh-a", "tasks", "t1").title, "A's secret task");
  });

  it("docs (settings, sessions, idempotency) are tenant-scoped", () => {
    engine.putDoc("hh-a", "settings.json", { externalActionsEnabled: false, aiActiveProvider: "openai" });
    engine.putDoc("hh-a", "idempotency.json", { k1: { at: 1 } });
    assert.deepEqual(engine.getDoc("hh-b", "settings.json", { externalActionsEnabled: true }), { externalActionsEnabled: true });
    assert.deepEqual(engine.getDoc("hh-b", "idempotency.json", {}), {});
  });

  it("C1.2: one household's kill switch / AI provider can never leak into another's", async () => {
    // Through the store's own settings accessors (what engine.mjs/planner.mjs call),
    // not just the raw engine: household A pauses external actions and picks a
    // provider; household B must still read its own defaults.
    process.env.HOMEOPS_DATA_DIR = dir;
    const store = await import("../store.mjs");
    store.setSettings({ externalActionsEnabled: false, aiActiveProvider: "openai" }, "hh-kill-a");
    assert.equal(store.getSettings("hh-kill-a").externalActionsEnabled, false);
    assert.equal(store.getSettings("hh-kill-a").aiActiveProvider, "openai");
    assert.notEqual(store.getSettings("hh-kill-b").externalActionsEnabled, false, "B still allows external actions");
    assert.equal(store.getSettings("hh-kill-b").aiActiveProvider, undefined, "B has no provider set");
  });

  it("deleting in tenant B can never touch tenant A", () => {
    engine.putRecord("hh-a", "meals", "m1", { id: "m1", title: "lasagna" });
    engine.deleteRecord("hh-b", "meals", "m1"); // no-op in B
    assert.equal(engine.getRecord("hh-a", "meals", "m1").title, "lasagna");
  });

  it("tenant databases are physically separate files", () => {
    assert.ok(fs.existsSync(join(dir, "tenants", "hh-a", "household.db")));
    assert.ok(fs.existsSync(join(dir, "tenants", "hh-b", "household.db")));
  });
});

describe("doc/record routing consistency", () => {
  let dir, engine;
  before(() => { dir = tmpDir(); engine = createEngine(dir); });
  after(() => { try { engine.closeAll(); fs.rmSync(dir, { recursive: true, force: true }); } catch { /* win */ } });

  it("a keyed-shaped doc becomes row-backed and reads back identically both ways", () => {
    const doc = { r1: { id: "r1", n: 1 }, r2: { id: "r2", n: 2 } };
    engine.putDoc("t", "runs.json", doc);
    assert.deepEqual(engine.getDoc("t", "runs.json", {}), doc);
    assert.deepEqual(engine.getRecord("t", "runs", "r2"), { id: "r2", n: 2 });
  });

  it("a keyed-without-embedded-id doc (members shape) stays whole-doc and round-trips", () => {
    const doc = { "m-ross": { role: "Owner", name: "Ross" }, "m-melissa": { role: "Adult Admin", name: "Melissa" } };
    engine.putDoc("t", "members.json", doc);
    assert.deepEqual(engine.getDoc("t", "members.json", {}), doc);
    assert.equal(engine.allRecords("t", "members"), null); // kv-backed, not rows
  });

  it("array docs (memory/artifacts shape) round-trip", () => {
    const arr = [{ id: "a1" }, { id: "a2" }];
    engine.putDoc("t", "artifacts.json", arr);
    assert.deepEqual(engine.getDoc("t", "artifacts.json", []), arr);
  });

  it("single-record ops and whole-doc reads stay coherent", () => {
    engine.putDoc("t", "tasks.json", { t1: { id: "t1", s: "open" } });
    engine.putRecord("t", "tasks", "t2", { id: "t2", s: "open" });
    engine.deleteRecord("t", "tasks", "t1");
    assert.deepEqual(engine.getDoc("t", "tasks.json", {}), { t2: { id: "t2", s: "open" } });
  });

  it("writing an empty object to a row-backed collection clears it", () => {
    engine.putRecord("t", "clearme", "x", { id: "x" });
    engine.putDoc("t", "clearme.json", {});
    assert.deepEqual(engine.getDoc("t", "clearme.json", {}), {});
    assert.equal(engine.getRecord("t", "clearme", "x"), null);
  });
});

describe("legacy JSON migration (local becomes tenant #1)", () => {
  let dir, engine;
  const LEGACY_RUNS = { run_1: { id: "run_1", status: "succeeded", steps: [{ index: 0, status: "succeeded" }] } };
  const LEGACY_MEMBERS = { "m-owner": { role: "Owner", name: "Ross", householdId: "local" } };
  const LEGACY_MEMORY = [{ id: "mem_1", text: "kids allergic to peanuts", householdId: "local" }];
  const LEGACY_SETTINGS = { externalActionsEnabled: true, calendarAutoSync: true };

  before(() => {
    dir = tmpDir();
    fs.writeFileSync(join(dir, "runs.json"), JSON.stringify(LEGACY_RUNS));
    fs.writeFileSync(join(dir, "members.json"), JSON.stringify(LEGACY_MEMBERS));
    fs.writeFileSync(join(dir, "memory.json"), JSON.stringify(LEGACY_MEMORY));
    fs.writeFileSync(join(dir, "settings.json"), JSON.stringify(LEGACY_SETTINGS));
    fs.writeFileSync(join(dir, "audit.jsonl"), '{"type":"a"}\n{"type":"b"}\n');
    fs.writeFileSync(join(dir, "broken.json"), "{ not json !!");
    fs.mkdirSync(join(dir, "files"), { recursive: true });
    fs.writeFileSync(join(dir, "files", "f1.bin"), "blobdata");
    fs.writeFileSync(join(dir, "key"), "aa".repeat(32)); // must stay in root
    engine = createEngine(dir); // migration happens on first open of "local"
    engine.openTenant("local");
  });
  after(() => { try { engine.closeAll(); fs.rmSync(dir, { recursive: true, force: true }); } catch { /* win */ } });

  it("all three record shapes survive migration byte-identical", () => {
    assert.deepEqual(engine.getDoc("local", "runs.json", {}), LEGACY_RUNS);
    assert.deepEqual(engine.getDoc("local", "members.json", {}), LEGACY_MEMBERS);
    assert.deepEqual(engine.getDoc("local", "memory.json", []), LEGACY_MEMORY);
    assert.deepEqual(engine.getDoc("local", "settings.json", {}), LEGACY_SETTINGS);
  });

  it("keyed collections migrated to rows (point reads work)", () => {
    assert.equal(engine.getRecord("local", "runs", "run_1").status, "succeeded");
  });

  it("originals are preserved in .migrated, never deleted", () => {
    assert.ok(fs.existsSync(join(dir, ".migrated", "runs.json")));
    assert.deepEqual(JSON.parse(fs.readFileSync(join(dir, ".migrated", "runs.json"), "utf8")), LEGACY_RUNS);
    assert.ok(!fs.existsSync(join(dir, "runs.json")));
  });

  it("audit log and file blobs moved into the tenant dir", () => {
    assert.equal(fs.readFileSync(join(dir, "tenants", "local", "audit.jsonl"), "utf8").trim().split("\n").length, 2);
    assert.equal(fs.readFileSync(join(dir, "tenants", "local", "files", "f1.bin"), "utf8"), "blobdata");
  });

  it("an unparseable legacy file is left in place (quarantined), not destroyed", () => {
    assert.ok(fs.existsSync(join(dir, "broken.json")));
    assert.ok(engine.quarantined("local").some((q) => q.file === "broken.json"));
  });

  it("the vault key stays in the data root", () => {
    assert.ok(fs.existsSync(join(dir, "key")));
  });

  it("migration is one-shot: a second engine over the same dir does not re-migrate", () => {
    engine.putRecord("local", "runs", "run_2", { id: "run_2", status: "running" });
    engine.closeAll();
    engine = createEngine(dir);
    assert.equal(engine.getRecord("local", "runs", "run_2").status, "running");
    assert.deepEqual(engine.getDoc("local", "runs.json", {}).run_1, LEGACY_RUNS.run_1);
  });
});

describe("corruption quarantine (tenant db integrity)", () => {
  it("a corrupt database file quarantines the tenant: reads degrade, writes refuse", () => {
    const dir = tmpDir();
    const tdir = join(dir, "tenants", "broken");
    fs.mkdirSync(tdir, { recursive: true });
    fs.writeFileSync(join(tdir, "household.db"), "this is not a sqlite database at all");
    const engine = createEngine(dir);
    assert.deepEqual(engine.getDoc("broken", "settings.json", { fallback: true }), { fallback: true });
    assert.throws(() => engine.putDoc("broken", "settings.json", { x: 1 }), /quarantin/i);
    assert.ok(engine.quarantined("broken").length > 0);
    try { engine.closeAll(); fs.rmSync(dir, { recursive: true, force: true }); } catch { /* win */ }
  });
});
