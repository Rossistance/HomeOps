/* THE READS ARE DECLARED — what GET returns is written down, and the model is not shown it.
 *
 * GET /api/events and GET /api/tasks are answered by declared actions with an OUTPUT
 * schema (server/actions/reads.mjs). Two things this file pins. First, that the read kept
 * exactly what the hand-written route did: the visibility gate, the per-viewer decorations
 * (editable is about ownership, not role; appendable for anyone who can see; myNotes is
 * the viewer's own), and no session → 401. Second, what agent:false means: the read is
 * not in the registry, not in the catalog, has no planner row — the model keeps its own
 * windowed famili.list_events — and cannot exist without an HTTP door.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-reads-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession } = await import("./harness.mjs");
const { defineAction, validateInput } = await import("../actions/define-action.mjs");
const { readEvents, readTasks } = await import("../actions/reads.mjs");
const { getAction, actionForRoute } = await import("../actions/registry.mjs");
const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
const { INTERNAL_INPUTS, toolCatalog } = await import("../context.mjs");

let ctx, owner, adult, child;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");    // Owner
  adult = await makeSession(ctx, "m-morgan");  // Adult Admin
  child = await makeSession(ctx, "m-lily");    // Child View
});
after(async () => { await stopServer(ctx); });

const ok200 = (r, what) => { assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.data)}`); return r.data; };
let shared, secret, sharedTask, secretTask;

test("SETUP: an adult writes a household event and a private one, a household task and a private one", async () => {
  shared = ok200(await adult.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Recital", startAt: "2031-06-01T18:00:00Z", visibility: "household" }) }), "shared").event;
  secret = ok200(await adult.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Morgan's dentist", startAt: "2031-06-02T09:00:00Z", visibility: "private" }) }), "secret").event;
  sharedTask = ok200(await adult.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Fix the gate" }) }), "shared task").task;
  secretTask = ok200(await adult.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Buy Alex's present", visibility: "private" }) }), "secret task").task;
});

test("GET /api/events KEEPS THE VISIBILITY GATE AND THE PER-VIEWER DECORATIONS", async () => {
  const mine = ok200(await adult.req("/api/events"), "as the owner of both").events;
  const byId = new Map(mine.map((e) => [e.id, e]));
  assert.ok(byId.has(shared.id) && byId.has(secret.id), "the writer sees both");
  assert.equal(byId.get(shared.id).editable, true, "editable is about OWNERSHIP");
  assert.equal(byId.get(shared.id).appendable, true);
  assert.equal(byId.get(shared.id).myNotes, null, "no private margin yet, but the key is there");

  const theirs = ok200(await owner.req("/api/events"), "as the household Owner").events;
  const ids = new Set(theirs.map((e) => e.id));
  assert.ok(ids.has(shared.id), "household is household");
  assert.equal(ids.has(secret.id), false, "PRIVATE IS PRIVATE — even from the Owner");
  assert.equal(theirs.find((e) => e.id === shared.id).editable, false, "…and not editable by someone who does not own it, whatever their role");

  const kid = ok200(await child.req("/api/events"), "as a child").events.map((e) => e.id);
  assert.ok(kid.includes(shared.id) && !kid.includes(secret.id));
});

test("GET /api/tasks keeps the visibility gate", async () => {
  const ids = ok200(await owner.req("/api/tasks"), "tasks as Owner").tasks.map((t) => t.id);
  assert.ok(ids.includes(sharedTask.id));
  assert.equal(ids.includes(secretTask.id), false);
});

test("THE DECLARED OUTPUT HOLDS FOR THE WHOLE RESPONSE, unknown keys rejected", async () => {
  const events = ok200(await adult.req("/api/events"), "events").events;
  const tasks = ok200(await adult.req("/api/tasks"), "tasks").tasks;
  const e = validateInput(readEvents.output, { events }, { unknown: "reject", defs: readEvents.$defs });
  assert.ok(e.ok, `events: ${e.field} — ${e.message}`);
  const t = validateInput(readTasks.output, { tasks }, { unknown: "reject", defs: readTasks.$defs });
  assert.ok(t.ok, `tasks: ${t.field} — ${t.message}`);
});

test("LEGACY DATA WITH AN UNDECLARED KEY IS SERVED, NOT REFUSED — the output check warns; a family's calendar still loads", async () => {
  /* The writers are held to the schema at the write (newEventRecord throws). A read may
   * meet a row written years before the schema existed, and refusing to load a family's
   * calendar over one stray key would be the wrong failure. So the declared output is
   * checked on the way out and WARNED about — once per field — never enforced. */
  const { writeStoreRecord } = await import("./harness.mjs");
  const legacy = { ...shared, id: `ev_legacy${Date.now().toString(16)}`, title: "From before the schema", legacyKey: "kept as-is" };
  writeStoreRecord(ctx, "events", legacy.id, legacy);
  const r = await adult.req("/api/events");
  assert.equal(r.status, 200, "an old row with a stray key must never break the read");
  const got = r.data.events.find((e) => e.id === legacy.id);
  assert.ok(got, "it is listed");
  assert.equal(got.legacyKey, "kept as-is", "and a read does not rewrite stored data");
  // The same validator the contract tests use would refuse it — that is the point: the
  // tests reject on fresh data, the route only warns on real data.
  const v = validateInput(readEvents.output, { events: r.data.events }, { unknown: "reject", defs: readEvents.$defs });
  assert.equal(v.ok, false); assert.match(v.field, /legacyKey$/);
});

test("no session → 401; an unknown query parameter is ignored, not refused", async () => {
  const anon = await ctx.fetch("/api/events");
  assert.equal(anon.status, 401);
  assert.equal((await adult.req("/api/events?refresh=1")).status, 200);
});

/* ───────────────── what agent:false means ───────────────── */

test("AN HTTP-ONLY READ IS NOT A TOOL: not in the registry, not in the catalog, no planner row", () => {
  assert.equal(actionForRoute("GET", "/api/events")?.id, "homeops.list_events");
  assert.equal(actionForRoute("GET", "/api/tasks")?.id, "homeops.list_tasks");
  assert.equal(getAction("homeops.list_events").agent, false);
  assert.equal(INTERNAL_FUNCTIONS["homeops.list_events"], undefined);
  assert.equal(INTERNAL_INPUTS["homeops.list_events"], undefined);
  const catalog = toolCatalog({ actorId: "m-alex", role: "Owner", householdId: "local" }).map((t) => t.toolId);
  assert.equal(catalog.includes("homeops.list_events"), false, "the model keeps famili__list_events, its own windowed read");
  assert.throws(() => readEvents.toInternalFunction(), /HTTP-only/);
  assert.throws(() => readEvents.toInternalInputs(), /HTTP-only/);
});

test("agent:false without an http door is refused at load — nothing could reach it", () => {
  assert.throws(() => defineAction({
    id: "test.orphan", name: "Orphan", description: "x", action: "Read", risk: "Low", agent: false,
    input: { type: "object", properties: {}, additionalProperties: false }, errorCodes: ["invalid_input"], run: async () => ({ ok: true, result: {} }),
  }), /agent:false must have an http door/);
});
