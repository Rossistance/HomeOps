/* ONE DECLARATION, AND WHAT IT REFUSES.
 *
 * defineAction is the fence that makes the rest of ADR-003 safe: a schema keyword the
 * validator or the TypeScript emitter does not know is refused at BOOT, not discovered
 * when a client's type is silently wrong. This file pins the fence, the validator's two
 * modes, the derived registry forms, and the one behaviour the door decides — via.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-actions-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

/* IMPORT ORDER IS PART OF THE TEST. context.mjs imports internal-functions.mjs, which
 * imports the registry; loading context FIRST is the order the server boots in, and the
 * order in which a cycle would leave INTERNAL_INPUTS half-built. */
const { INTERNAL_INPUTS } = await import("../context.mjs");
const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
const { defineAction, validateInput, SUPPORTED_KEYWORDS } = await import("../actions/define-action.mjs");
const { createEvent } = await import("../actions/events.mjs");
const { getAction, actionForRoute, buildRegistry } = await import("../actions/registry.mjs");
const store = await import("../store.mjs");
const { seedDefaults } = await import("../seed.mjs");
seedDefaults();

const ID = "homeops.create_event_draft";
const minimal = (over = {}) => ({
  id: "test.thing", name: "Thing", description: "A thing.", action: "Write", risk: "Low",
  input: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
  errorCodes: ["invalid_input"], run: async () => ({ ok: true, result: {} }), ...over,
});

/* ───────────────────────── the fence ───────────────────────── */

test("A SCHEMA KEYWORD NOBODY UNDERSTANDS IS REFUSED AT LOAD", () => {
  assert.throws(() => defineAction(minimal({ input: { type: "object", properties: { n: { type: "number", minimum: 1 } } } })),
    /unsupported schema keyword "minimum"/);
  assert.throws(() => defineAction(minimal({ input: { type: "object", properties: { n: { type: "integer" } } } })), /unknown type "integer"/);
  assert.throws(() => defineAction(minimal({ input: { type: "object", properties: {}, required: ["ghost"] } })), /required "ghost"/);
  assert.throws(() => defineAction(minimal({ input: { type: "object", properties: { x: { $ref: "#/$defs/Nope" } } } })), /unknown \$defs\.Nope/);
  assert.ok(SUPPORTED_KEYWORDS.includes("$ref") && !SUPPORTED_KEYWORDS.includes("minimum"));
});

test("a bad id, verb, risk, route or error map is refused at load", () => {
  assert.throws(() => defineAction(minimal({ id: "CreateThing" })), /namespace\.snake_case/);
  assert.throws(() => defineAction(minimal({ action: "Delete" })), /Read \| Write \| Send/);
  assert.throws(() => defineAction(minimal({ http: { method: "PUT", path: "/api/x" } })), /http\.method/);
  assert.throws(() => defineAction(minimal({ http: { method: "POST", path: "/x" } })), /start with \/api\//);
  assert.throws(() => defineAction(minimal({ errors: { nope: 400 } })), /errors\.nope is not in errorCodes/);
  assert.throws(() => defineAction(minimal({ errorCodes: ["empty"] })), /must include "invalid_input"/);
});

test("two actions cannot claim one id or one route", () => {
  const a = defineAction(minimal({ id: "test.a", http: { method: "POST", path: "/api/same" } }));
  const b = defineAction(minimal({ id: "test.b", http: { method: "POST", path: "/api/same" } }));
  assert.throws(() => buildRegistry([a, b]), /both claim POST \/api\/same/);
  assert.throws(() => buildRegistry([a, a]), /duplicate id test\.a/);
});

test("a declared action is frozen, schema included", () => {
  const a = getAction(ID);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.input) && Object.isFrozen(a.input.properties.title), "the declaration cannot drift after load");
  assert.equal(actionForRoute("POST", "/api/events"), a);
  assert.equal(actionForRoute("GET", "/api/events")?.id, "homeops.list_events", "GET is a declared read (action-reads.test.mjs)");
});

/* ───────────────────────── the validator ───────────────────────── */

const S = { type: "object", properties: { t: { type: "string" }, n: { type: "number" }, b: { type: "boolean" }, e: { type: "string", enum: ["a", "b"] }, sn: { type: ["string", "null"] }, l: { type: "array", items: { type: "string" } } }, required: ["t"], additionalProperties: false };

test("validateInput: strip mode drops undeclared keys and says which; reject mode refuses them", () => {
  const s = validateInput(S, { t: "x", extra: 1 }, { unknown: "strip" });
  assert.equal(s.ok, true); assert.deepEqual(s.value, { t: "x" }); assert.deepEqual(s.stripped, ["extra"]);
  const r = validateInput(S, { t: "x", extra: 1 }, { unknown: "reject" });
  assert.equal(r.ok, false); assert.equal(r.error, "invalid_input"); assert.equal(r.field, "extra");
});

test("validateInput: types, unions, enums, arrays and required — with the FIELD named", () => {
  assert.equal(validateInput(S, {}).field, "t");
  assert.equal(validateInput(S, { t: "x", n: "7" }).field, "n", "a string is not a number without coerce");
  assert.equal(validateInput(S, { t: "x", n: "7" }, { coerce: true }).value.n, 7);
  assert.equal(validateInput(S, { t: "x", b: "true" }, { coerce: true }).value.b, true);
  assert.equal(validateInput(S, { t: "x", e: "c" }).field, "e");
  assert.equal(validateInput(S, { t: "x", sn: null }).ok, true, "a declared null is allowed");
  assert.equal(validateInput(S, { t: "x", n: null }).field, "n", "an undeclared null is not");
  assert.equal(validateInput(S, { t: "x", l: ["a", 2] }).field, "l[1]");
});

test("validateInput: $ref resolves against $defs", () => {
  const defs = { Row: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } };
  const out = { type: "object", properties: { row: { $ref: "#/$defs/Row" } }, required: ["row"], additionalProperties: false };
  assert.equal(validateInput(out, { row: { id: "x" } }, { defs }).ok, true);
  assert.equal(validateInput(out, { row: { id: "x", junk: 1 } }, { defs, unknown: "reject" }).field, "row.junk");
});

/* ───────────────────────── the derived forms ───────────────────────── */

test("INTERNAL_INPUTS AND INTERNAL_FUNCTIONS ARE DERIVED, NOT HAND-KEPT", () => {
  assert.deepEqual(INTERNAL_INPUTS[ID], createEvent.toInternalInputs());
  assert.equal(INTERNAL_INPUTS[ID].find((r) => r.key === "title").required, true);
  assert.ok(INTERNAL_INPUTS[ID].some((r) => r.key === "remindOffsets"), "the planner row carries what the action accepts");
  assert.equal(INTERNAL_FUNCTIONS[ID].name, createEvent.name);
  assert.equal(INTERNAL_FUNCTIONS[ID].description, createEvent.description, "the engine entry now carries a description");
  assert.equal(typeof INTERNAL_FUNCTIONS[ID].run, "function");
});

/* ───────────────────────── the door ───────────────────────── */

const ctx = { householdId: "local", actorId: "m-alex", runId: "run_test" };

test("THROUGH THE REGISTRY (no via) AN EVENT IS A DRAFT FROM AN AGENT", async () => {
  const r = await INTERNAL_FUNCTIONS[ID].run(ctx, { title: "Dentist", participantIds: ["m-lily"] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.event.status, "draft");
  assert.equal(r.result.event.provenance.via, "agent");
  assert.equal(r.result.event.provenance.runId, "run_test");
  assert.equal(r.result.event.source, "FamiliOS Assistant");
  assert.deepEqual(r.result.event.remindersSent, []);
  assert.equal(store.getEvent(r.result.event.id).title, "Dentist");
});

test("via:user IS CONFIRMED, and carries no runId", async () => {
  const r = await createEvent.invoke({ ...ctx, runId: null, via: "user" }, { title: "Recital" });
  assert.equal(r.result.event.status, "confirmed");
  assert.equal(r.result.event.provenance.via, "user");
  assert.equal("runId" in r.result.event.provenance, false);
  assert.equal(r.result.event.source, "FamiliOS");
});

test("the tool now honours a nest and reminders — and refuses the ones it should", async () => {
  const nest = await createEvent.invoke(ctx, { title: "Ours", visibility: "nest", nestId: "nest_nope" });
  assert.equal(nest.error, "not_in_nest");
  const rem = await createEvent.invoke(ctx, { title: "Ping", remindOffsets: [7] });
  assert.equal(rem.error, "bad_reminder");
  const ok = await createEvent.invoke(ctx, { title: "Ping", startAt: "2031-03-03T10:00:00Z", remindOffsets: [15, 15] });
  assert.deepEqual(ok.result.event.remindOffsets, [15], "deduplicated, like the route always did");
  const personal = await createEvent.invoke(ctx, { title: "Mine", visibility: "personal" });
  assert.equal(personal.result.event.visibility, "private", "the Library's old spelling is normalised on WRITE");
});

test("the shape gate names the field; the meaning checks still run after it", async () => {
  const shape = await createEvent.invoke(ctx, { title: "X", allDay: "yes" });
  assert.equal(shape.error, "invalid_input"); assert.equal(shape.field, "allDay");
  const meaning = await createEvent.invoke(ctx, { title: "X", participantIds: ["m-ghost"] });
  assert.equal(meaning.error, "unknown_member");
  const strings = await createEvent.invoke(ctx, { title: "Camp", whatToBring: ["Tent", { item: "Stove", memberId: "m-alex" }] });
  assert.deepEqual(strings.result.event.whatToBring, [{ item: "Tent", memberId: null }, { item: "Stove", memberId: "m-alex" }]);
});
