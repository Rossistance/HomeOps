// The bucket every household shared.
//
// `containerTag` IS the tenant boundary in this store: one sqlite file holds every household's
// memories, and `container_tag` is the only thing keeping them apart. It used to default to the
// literal string "default" — and a JS default parameter fires on `undefined`, which is exactly
// what `{ containerTag: ctx.householdId }` produces the moment that field is missing.
//
// So any call that arrived without a household wrote into a bucket EVERY household shares, and
// searched it too. One family's memories surfacing in another family's assistant, with nothing
// that looks like an error anywhere: the write succeeds, the search returns rows.
//
// There is no correct value to guess, so it no longer guesses.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-mem-tag-"));
const { createMemoryProvider } = await import("../memory-provider.mjs");
const provider = createMemoryProvider();

process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {} });

/* ---- the refusal ---- */

const MISSING = [
  ["omitted entirely", {}],
  ["explicitly undefined", { containerTag: undefined }],
  ["null — a default parameter does NOT fire on null, so this used to become the string \"null\"", { containerTag: null }],
  ["empty string", { containerTag: "" }],
  ["whitespace", { containerTag: "   " }],
  ["the shared bucket, named outright", { containerTag: "default" }],
];

for (const [label, opts] of MISSING) {
  test(`add() refuses when the household is ${label}`, async () => {
    const r = await provider.add("Lily is allergic to peanuts", opts);
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_container_tag");
    assert.equal(r.degraded, false, "this is a refusal, not a backend having a bad day");
  });

  test(`search() refuses when the household is ${label}`, async () => {
    const r = await provider.search("peanuts", opts);
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_container_tag");
    assert.deepEqual(r.results, [], "and returns nothing rather than another family's rows");
  });
}

test("profile() refuses too — reading the shared bucket is the same leak in reverse", async () => {
  const r = await provider.profile({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "no_container_tag");
  assert.equal(r.totalMemories, 0);
});

test("the refusal never throws — callers invoke this unconditionally", async () => {
  // The module's contract: planner and write-path code call it without guarding, so a refusal
  // has to be a shaped result. A throw here would take out an assistant turn.
  for (const call of [
    () => provider.add("x", { containerTag: null }),
    () => provider.search("x", { containerTag: null }),
    () => provider.profile({ containerTag: null }),
  ]) {
    const r = await call();
    assert.equal(typeof r, "object");
    assert.equal(r.ok, false);
  }
});

/* ---- and nothing leaked on the way ---- */

test("a refused write leaves NOTHING behind for anyone to find", async () => {
  await provider.add("SECRET-DO-NOT-POOL", { containerTag: undefined });
  await provider.add("SECRET-DO-NOT-POOL", { containerTag: "default" });
  // Search the buckets an untagged write would previously have landed in, plus a real one.
  for (const tag of ["hh_someone", "local"]) {
    const r = await provider.search("SECRET", { containerTag: tag });
    assert.equal(r.ok, true);
    assert.deepEqual(r.results, [], `nothing reachable from ${tag}`);
  }
});

test("a properly tagged household still works exactly as before", async () => {
  const w = await provider.add("Noah has swim practice on Tuesdays", { containerTag: "hh_alpha", type: "Fact" });
  assert.equal(w.ok, true, JSON.stringify(w));
  const r = await provider.search("swim", { containerTag: "hh_alpha" });
  assert.equal(r.ok, true);
  assert.equal(r.results.length, 1, "the fix refuses the ambiguous case, not the ordinary one");
  const p = await provider.profile({ containerTag: "hh_alpha" });
  assert.equal(p.ok, true);
  assert.equal(p.containerTag, "hh_alpha");
  assert.equal(p.totalMemories, 1);
});

test("and is still invisible to a different household", async () => {
  const r = await provider.search("swim", { containerTag: "hh_beta" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.results, []);
});
