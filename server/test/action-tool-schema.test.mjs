/* WHAT THE MODEL IS SHOWN for a declared action is the action's own schema.
 *
 * Before ADR-003 the schema a tool got was assembled at request time from three tables
 * joined by string key — INTERNAL_INPUTS (which keys), EXTRA_INPUT_KEYS (which extra keys),
 * KEY_HINTS (what a key means, by NAME, shared across every tool). A key the handler read
 * but no table named could never be threaded, and the tables had drifted once already
 * (plan_meal). A declared action's schema is handed to the AI SDK's jsonSchema() verbatim.
 *
 * Asserted through a pure helper rather than a live model turn: the question is WHICH
 * schema, and that needs no provider.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-toolschema-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { inputSchemaForCatalogTool } = await import("../assistant-agent.mjs");
const { createEvent } = await import("../actions/events.mjs");
const { toolCatalog } = await import("../context.mjs");

const catalogRow = (id) => toolCatalog({ actorId: "m-alex", role: "Owner", householdId: "local" }).find((t) => t.toolId === id);

test("A DECLARED ACTION'S SCHEMA REACHES THE MODEL VERBATIM", () => {
  const row = catalogRow("homeops.create_event_draft");
  assert.ok(row, "the action is in the catalog like any internal tool");
  const schema = inputSchemaForCatalogTool(row);
  assert.equal(schema, createEvent.input, "the very object — not a re-join of the key tables");
  // What the join could never express: a typed union, an enum with nest, a described key.
  assert.deepEqual(schema.properties.startAt.type, ["string", "null"]);
  assert.ok(schema.properties.visibility.enum.includes("nest"));
  assert.match(schema.properties.remindOffsets.description, /minutes/);
  assert.equal(schema.additionalProperties, false);
});

test("the catalog row carries the action's description, so the model reads it", () => {
  const row = catalogRow("homeops.create_event_draft");
  assert.equal(row.description, createEvent.description);
  assert.match(row.description, /draft/i);
});

test("an undeclared tool still takes the legacy join, unchanged", () => {
  const row = catalogRow("homeops.create_task");
  const schema = inputSchemaForCatalogTool(row);
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.properties.title, "INTERNAL_INPUTS key");
  assert.ok(schema.properties.notes, "EXTRA_INPUT_KEYS key");
  assert.equal(schema.properties.priority.enum?.length, 3, "KEY_HINTS meaning");
  assert.equal(row.description, undefined, "and no description, because nothing declares one yet");
});
