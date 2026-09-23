/* MEALS, DECLARED — the create, the read, the record's one writer, and plan_meal beside them.
 *
 * The last surface on rung 3 (ADR-003). Both HTTP doors are declared and HTTP-only: the
 * model's meal tool is plan_meal, which does MORE than create (de-dupe, groceries, the
 * calendar, Google), because "plan dinner Tuesday" means all of that; a person typing a
 * meal asked for the meal and its groceries. Two intents, two doors — not one drifted run.
 * plan_meal writes its meal through the same newMealRecord and — since ADR-004 declared it
 * as a composite; this header claimed it earlier, wrongly — its groceries through the same
 * syncMealGroceries, and the contract holds for both. action-plan-meal.test.mjs pins the
 * composite itself.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-meals-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession } = await import("./harness.mjs");
const { validateInput } = await import("../actions/define-action.mjs");
const { MEAL_RECORD, newMealRecord } = await import("../actions/schemas/meal.mjs");
const { createMeal, readMeals } = await import("../actions/meals.mjs");
const { getAction, actionForRoute } = await import("../actions/registry.mjs");
const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
const store = await import("../store.mjs");
const { seedDefaults } = await import("../seed.mjs");
seedDefaults();

const ok200 = (r, what) => { assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.data)}`); return r.data; };
const fits = (m, what) => {
  const v = validateInput(MEAL_RECORD, m, { unknown: "reject" });
  assert.ok(v.ok, `${what} (${m.id}, source ${m.source}) does not fit MEAL_RECORD: ${v.field} — ${v.message}`);
};

let ctx, adult, owner, child;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan");
  owner = await makeSession(ctx, "m-alex");
  child = await makeSession(ctx, "m-lily");
});
after(async () => { await stopServer(ctx); });

const post = (who, body) => who.req("/api/meals", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

/* ───────────────── the wire the hand-written route had, kept ───────────────── */

test("THE APP'S PAYLOAD STILL ADDS A MEAL AND SAYS HOW MANY GROCERIES IT ADDED", async () => {
  const r = await post(adult, { title: "Taco night", date: "2031-04-06", slot: "dinner", ingredients: ["tortillas", { item: "cheese", have: true }, "salsa"], servings: 4, recipeUrl: " https://example.com/tacos ", instructions: [" Warm the tortillas ", ""] });
  const { meal, groceriesAdded } = ok200(r, "POST /api/meals");
  assert.ok(meal.id.startsWith("meal_"));
  assert.equal(meal.slot, "dinner"); assert.equal(meal.date, "2031-04-06"); assert.equal(meal.source, "user"); assert.equal(meal.createdBy, "m-morgan");
  assert.deepEqual(meal.ingredients, [{ item: "tortillas", have: false }, { item: "cheese", have: true }, { item: "salsa", have: false }]);
  assert.equal(meal.servings, 4); assert.equal(meal.recipeUrl, "https://example.com/tacos"); assert.deepEqual(meal.instructions, ["Warm the tortillas"]);
  assert.equal(meal.time, null); assert.equal(meal.nestId, null);
  assert.equal(groceriesAdded, 2, "only what the family does not have");
  const groceries = ok200(await adult.req("/api/tasks"), "tasks").tasks.filter((t) => t.mealId === meal.id);
  assert.deepEqual(groceries.map((t) => t.title).sort(), ["salsa", "tortillas"]);
  fits(meal, "the created meal");
});

test("the role floor, the JSON gate, a blank name, a malformed time and a bad servings value", async () => {
  const c = await post(child, { title: "Cereal" }); assert.equal(c.status, 403); assert.equal(c.data.error, "insufficient_role");
  const m = await post(adult, "{nope"); assert.equal(m.status, 400); assert.equal(m.data.error, "malformed_json");
  const blank = await post(adult, { title: "  " }); assert.equal(blank.status, 400); assert.equal(blank.data.error, "empty_title");
  const time = ok200(await post(adult, { title: "Late supper", time: "25:99" }), "bad time").meal;
  assert.equal(time.time, null, "a malformed time falls back to the slot's default, as both doors always did");
  const zero = ok200(await post(adult, { title: "Nobody eats", servings: 0 }), "servings 0").meal;
  assert.equal(zero.servings, null, "servings: 0 is 'unknown', as before");
  /* The wire is wider than the record on purpose: a form sends "" for an empty box, and the
   * route never refused a whole meal over a servings value it could not read. The RECORD's
   * servings is number | null; the door accepts what forms send and normalises. */
  const words = ok200(await post(adult, { title: "Feast", servings: "lots" }), "servings 'lots'").meal;
  assert.equal(words.servings, null, "garbage servings become null, as meals.test.mjs has always pinned");
  const empty = ok200(await post(adult, { title: "Snack", servings: "" }), "servings ''").meal;
  assert.equal(empty.servings, null);
});

/* ───────────────── gained by being declared ───────────────── */

test("A SLOT THE APP DOES NOT HAVE IS REFUSED, NAMED — the route used to store 'brunch' as dinner", async () => {
  const r = await post(adult, { title: "Brunch", slot: "brunch" });
  assert.equal(r.status, 400); assert.equal(r.data.error, "invalid_input"); assert.equal(r.data.field, "slot");
});

test("a meal can go in a nest — the route never resolved one", async () => {
  const nope = await post(adult, { title: "Ours", visibility: "nest", nestId: "nest_nope" });
  assert.equal(nope.status, 403); assert.equal(nope.data.error, "not_in_nest");
  const personal = ok200(await post(adult, { title: "Mine", visibility: "personal" }), "personal").meal;
  assert.equal(personal.visibility, "private", "the Library's old spelling is normalised on WRITE");
});

/* ───────────────── the read ───────────────── */

test("GET /api/meals KEEPS THE VISIBILITY GATE AND HIDES WHAT WAS REPLACED", async () => {
  const secret = ok200(await post(adult, { title: "Morgan's private lunch", visibility: "private" }), "secret").meal;
  const gone = ok200(await post(adult, { title: "Replaced dish" }), "to archive").meal;
  ok200(await adult.req(`/api/meals/${gone.id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) }), "archive");
  const mine = ok200(await adult.req("/api/meals"), "as writer").meals.map((m) => m.id);
  assert.ok(mine.includes(secret.id) && !mine.includes(gone.id), "the writer sees the private dish, never the archived one");
  const theirs = ok200(await owner.req("/api/meals"), "as Owner").meals.map((m) => m.id);
  assert.equal(theirs.includes(secret.id), false, "private is private, even from the Owner");
  const all = ok200(await adult.req("/api/meals"), "meals").meals;
  const v = validateInput(readMeals.output, { meals: all }, { unknown: "reject", defs: readMeals.$defs });
  assert.ok(v.ok, `the declared output holds for the whole response: ${v.field} — ${v.message}`);
  for (const m of all) fits(m, "a listed meal");
});

/* ───────────────── one writer of the defaults, and plan_meal beside the door ───────────────── */

test("newMealRecord fills the record, requires a source, and refuses an invented field", () => {
  const rec = newMealRecord({ title: "Chili", source: "user" }, { householdId: "local", actorId: "m-alex" });
  assert.ok(rec.id.startsWith("meal_")); assert.equal(rec.slot, "dinner"); assert.equal(rec.date, null); assert.equal(rec.time, null);
  assert.deepEqual(rec.ingredients, []); assert.deepEqual(rec.instructions, []); assert.equal(rec.servings, null); assert.equal(rec.recipeUrl, "");
  assert.equal(rec.visibility, "household"); assert.equal(rec.nestId, null); assert.equal("archived" in rec, false);
  assert.throws(() => newMealRecord({ title: "x" }, { householdId: "local", actorId: "m-alex" }), /source is required/);
  assert.throws(() => newMealRecord({ title: "x", source: "user", colour: "teal" }, { householdId: "local", actorId: "m-alex" }), /"colour" is not a field of MEAL_RECORD/);
  assert.throws(() => newMealRecord({ title: "x", source: "user", slot: "brunch" }, { householdId: "local", actorId: "m-alex" }), /slot/);
  assert.throws(() => newMealRecord({ title: "x", source: "user", ingredients: [{ item: "eggs" }] }, { householdId: "local", actorId: "m-alex" }), /ingredients\[0\]\.have/);
});

test("PLAN_MEAL WRITES ITS MEAL THROUGH THE SAME HELPER, and the record fits", async () => {
  const tctx = { householdId: "local", actorId: "m-alex", runId: "run_test" };
  const r = await INTERNAL_FUNCTIONS["homeops.plan_meal"].run(tctx, { title: "Contract chili", date: "2031-07-09", slot: "dinner", servings: 4, ingredients: ["beans", { item: "salt", have: true }], instructions: ["Simmer."] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const meal = store.getMeal(r.result.mealId);
  fits(meal, "plan_meal's meal");
  assert.equal(meal.source, "assistant"); assert.equal(meal.nestId, null, "the same structural keys as a typed meal");
  assert.deepEqual(meal.instructions, ["Simmer."]);
});

test("EVERY putMeal( IN THE SERVER GOES THROUGH newMealRecord, and index.mjs no longer hand-writes the meal routes", async () => {
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
    if (path.basename(f) === "store.mjs") continue;
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/putMeal\(/g)) {
      const after = src.slice(m.index, m.index + 40);
      if (!after.startsWith("putMeal(newMealRecord(")) offenders.push(`${path.relative(root, f)}: ${after.split("\n")[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `a hand-built meal record slipped in:\n${offenders.join("\n")}`);
  const index = fs.readFileSync(path.join(root, "index.mjs"), "utf8");
  assert.equal(index.includes('path === "/api/meals" && method === "POST"'), false);
  assert.equal(index.includes('path === "/api/meals" && method === "GET"'), false);
  assert.equal(index.includes("const syncMealGroceries ="), false, "the grocery sync lives with the declared create now");
});

test("both meal actions are HTTP-only: the model keeps plan_meal", () => {
  assert.equal(actionForRoute("POST", "/api/meals")?.id, "homeops.create_meal");
  assert.equal(actionForRoute("GET", "/api/meals")?.id, "homeops.list_meals");
  assert.equal(getAction("homeops.create_meal").agent, false);
  assert.equal(INTERNAL_FUNCTIONS["homeops.create_meal"], undefined);
  assert.equal(typeof INTERNAL_FUNCTIONS["homeops.plan_meal"]?.run, "function", "plan_meal is still the model's meal tool");
  assert.equal(createMeal.http.path, "/api/meals");
});
