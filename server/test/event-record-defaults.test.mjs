/* ONE WRITER OF AN EVENT'S DEFAULTS — and no other way to write one.
 *
 * putEvent is a blind upsert, so for a long time "what an event record looks like" was
 * whatever each of seven call sites happened to spell out. EVENT_RECORD declared the shape
 * (ADR-003), the contract test proved every writer fit it; this rung makes the shape
 * impossible to get wrong at the write: newEventRecord fills every structural default,
 * validates the result with unknown keys rejected, and throws. The second half of this
 * file reads the server as text and refuses any putEvent( that does not go through it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-evdefaults-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { newEventRecord, EVENT_RECORD } = await import("../actions/schemas/event.mjs");
const { validateInput } = await import("../actions/define-action.mjs");

const ctx = { householdId: "local", actorId: "m-alex" };
const minimal = { title: "Recital", provenance: { via: "user", actorId: "m-alex" } };

test("A WRITER PASSES WHAT IT KNOWS AND GETS A COMPLETE RECORD", () => {
  const rec = newEventRecord(minimal, ctx);
  assert.ok(rec.id.startsWith("ev_"));
  assert.equal(rec.householdId, "local"); assert.equal(rec.createdBy, "m-alex");
  assert.equal(typeof rec.createdAt, "number", "events stamp createdAt as epoch ms — every writer always did");
  assert.match(rec.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  // Every structural default, present and typed, the same for every door.
  assert.equal(rec.startAt, null); assert.equal(rec.endAt, null); assert.equal(rec.allDay, false);
  assert.equal(rec.notes, ""); assert.equal(rec.location, ""); assert.equal(rec.spaceId, "sp-family");
  assert.deepEqual(rec.participantIds, []); assert.equal(rec.driverId, null); assert.equal(rec.ownerId, null); assert.equal(rec.backupOwnerId, null);
  assert.deepEqual(rec.whatToBring, []); assert.deepEqual(rec.checklist, []); assert.equal(rec.travel, null);
  assert.deepEqual(rec.reminders, []); assert.deepEqual(rec.attachments, []); assert.deepEqual(rec.comments, []); assert.equal(rec.mealImpact, null);
  assert.deepEqual(rec.remindersSent, []); assert.equal("remindOffsets" in rec, false, "no reminder plan unless one was given");
  assert.equal(rec.visibility, "household"); assert.equal(rec.nestId, null);
  assert.equal(rec.category, "Family"); assert.equal(rec.layer, "canonical"); assert.equal(rec.status, "confirmed"); assert.equal(rec.source, "FamiliOS");
  assert.equal("mealId" in rec, false); assert.equal("taskId" in rec, false);
  assert.equal(validateInput(EVENT_RECORD, rec, { unknown: "reject" }).ok, true);
});

test("what a writer knows wins over the default; what it does not know is the default", () => {
  const rec = newEventRecord({ ...minimal, layer: "linked", category: "Calendar", ownerId: "m-morgan", mealId: "meal_1", participantIds: ["m-lily"], allDay: true, remindOffsets: [15] }, ctx);
  assert.equal(rec.layer, "linked"); assert.equal(rec.category, "Calendar"); assert.equal(rec.ownerId, "m-morgan");
  assert.equal(rec.mealId, "meal_1"); assert.deepEqual(rec.participantIds, ["m-lily"]); assert.equal(rec.allDay, true);
  assert.deepEqual(rec.remindOffsets, [15]); assert.equal(rec.status, "confirmed");
});

test("A RECORD MUST SAY HOW IT GOT HERE", () => {
  assert.throws(() => newEventRecord({ title: "x" }, ctx), /provenance\.via is required/);
  assert.throws(() => newEventRecord({ title: "x", provenance: {} }, ctx), /provenance\.via is required/);
  assert.throws(() => newEventRecord(minimal, { actorId: "m-alex" }), /ctx needs householdId and actorId/);
});

test("A WRITER THAT INVENTS A FIELD FAILS AT THE WRITE, NAMING IT", () => {
  assert.throws(() => newEventRecord({ ...minimal, colour: "teal" }, ctx), /"colour" is not a field of EVENT_RECORD/);
  // …and a writer may not decide what the helper decides.
  assert.throws(() => newEventRecord({ ...minimal, id: "ev_mine" }, ctx), /"id" is decided here/);
  assert.throws(() => newEventRecord({ ...minimal, createdAt: 1 }, ctx), /"createdAt" is decided here/);
  // …and a wrong TYPE is refused by the same validator the contract test uses.
  assert.throws(() => newEventRecord({ ...minimal, startAt: 1234 }, ctx), /startAt/);
  assert.throws(() => newEventRecord({ ...minimal, checklist: [{ done: true }] }, ctx), /checklist\[0\]\.text/);
});

test("an undefined value is not a field — spreads with holes are fine", () => {
  const rec = newEventRecord({ ...minimal, location: undefined, ownerId: undefined }, ctx);
  assert.equal(rec.location, ""); assert.equal(rec.ownerId, null);
});

/* ───────────────── and there is no other way to write one ───────────────── */

test("EVERY putEvent( IN THE SERVER GOES THROUGH newEventRecord", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!["test", "spike", "node_modules", ".data"].includes(e.name)) walk(p); }
      else if (e.name.endsWith(".mjs")) files.push(p);
    }
  };
  walk(root);
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    if (path.basename(f) === "store.mjs") continue; // the definition itself
    for (const m of src.matchAll(/putEvent\(/g)) {
      const after = src.slice(m.index, m.index + 40);
      if (!after.startsWith("putEvent(newEventRecord(")) offenders.push(`${path.relative(root, f)}: ${after.split("\n")[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `a hand-built event record slipped in:\n${offenders.join("\n")}`);
  assert.ok(files.some((f) => fs.readFileSync(f, "utf8").includes("putEvent(newEventRecord(")), "and the helper is actually used");
});
