/* EVERY TOOL THE PLANNER, THE PROMPT OR A HINT TABLE NAMES MUST EXIST.
 *
 * For months INTERNAL_INPUTS carried rows for homeops.list_agents / get_agent /
 * update_agent, and the system prompt told the model "to fix a helper, homeops__get_agent
 * first, then homeops__update_agent". None of the three was in INTERNAL_FUNCTIONS. The
 * catalog is built from the registry, so they never became tools — the model was simply
 * told to call something it could not, and nothing could notice, because the three
 * places that name tools (the input table, the extra-keys table, the prompt) were joined
 * to the registry by string and never checked against it.
 *
 * This file is the check. It reads the prompt and the hint tables as TEXT, which is what
 * the model reads, and refuses any tool name that does not resolve to a real registry
 * entry (homeops__*) or a real native tool (famili__*).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-registry-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
const { INTERNAL_INPUTS } = await import("../context.mjs");
const { EXTRA_INPUT_KEYS, toToolName } = await import("../assistant-agent.mjs");
const { ACTION_INPUTS } = await import("../actions/registry.mjs");

const registryIds = new Set(Object.keys(INTERNAL_FUNCTIONS));
const src = await fs.promises.readFile(new URL("../assistant-agent.mjs", import.meta.url), "utf8");
const nativeIds = new Set([...src.matchAll(/add\("(famili\.[a-z_]+)"/g)].map((m) => m[1]));

test("EVERY INTERNAL_INPUTS ROW IS A REAL TOOL", () => {
  const phantoms = Object.keys(INTERNAL_INPUTS).filter((id) => !registryIds.has(id));
  assert.deepEqual(phantoms, [], `rows for tools that do not exist: ${phantoms.join(", ")}`);
});

test("every EXTRA_INPUT_KEYS row is a real tool", () => {
  const phantoms = Object.keys(EXTRA_INPUT_KEYS).filter((id) => !registryIds.has(id));
  assert.deepEqual(phantoms, [], `extra keys for tools that do not exist: ${phantoms.join(", ")}`);
});

test("EVERY DECLARED ACTION'S INTERNAL_INPUTS ROW IS THE DERIVED ONE — a hand-kept row would shadow it silently", () => {
  /* INTERNAL_INPUTS spreads ACTION_INPUTS first and lists the hand-written rows after it,
   * so a row left behind for a tool that has since been declared (plan_meal was the
   * first) wins by object-literal order: the planner and the engine's input fill would
   * read the stale hand row, keys only, while the model read the declared schema — and
   * the phantom check above cannot see it, because the id does resolve. */
  assert.ok(Object.keys(ACTION_INPUTS).length >= 1, "there are declared agent actions");
  for (const [id, row] of Object.entries(ACTION_INPUTS)) {
    assert.deepEqual(INTERNAL_INPUTS[id], row, `${id}: INTERNAL_INPUTS carries a hand-kept row that shadows the declared one`);
  }
});

test("EVERY TOOL THE PROMPT OR A HINT NAMES EXISTS — homeops__* in the registry, famili__* as a native tool", () => {
  const named = new Set([...src.matchAll(/\b(homeops|famili)__([a-z_]+)\b/g)].map((m) => `${m[1]}.${m[2]}`));
  assert.ok(named.size >= 8, `the prompt names tools at all: ${[...named].join(", ")}`);
  const missing = [...named].filter((id) => !(id.startsWith("homeops.") ? registryIds.has(id) : nativeIds.has(id)));
  assert.deepEqual(missing, [], `named but not callable: ${missing.join(", ")}`);
  // The specific trio that was wrong, spelled out so a regression reads as what it is.
  for (const id of ["homeops.list_agents", "homeops.get_agent", "homeops.update_agent"]) {
    assert.equal(named.has(id), false, `${id} is named again — it does not exist; the helper tools are famili.*_helper`);
  }
});

test("the exposed name of every registry tool is unique after sanitising", () => {
  // toToolName replaces every character a provider rejects with "__"; two ids must not
  // collapse onto one exposed name, or one of them silently becomes unreachable.
  const seen = new Map();
  for (const id of [...registryIds, ...nativeIds]) {
    const n = toToolName(id);
    assert.ok(!seen.has(n), `${id} and ${seen.get(n)} both expose as ${n}`);
    seen.set(n, id);
  }
});
