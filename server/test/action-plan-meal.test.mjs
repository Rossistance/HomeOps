/* PLAN_MEAL, DECLARED (ADR-004) — what declaring the composite changed.
 *
 * The flat result keys and the dedupe / replace / shift semantics were product features
 * before this and are pinned where they always were (internal-tools, scheduling-consistency,
 * tool-input-validation, task-record-contract). This file pins the four things the rung 4
 * audits found missing or duplicated: a private dish now carries its visibility onto its
 * calendar event and its grocery items; the household kill switch stands in front of the
 * Google push; replace:true runs the ONE retire cascade DELETE /api/meals/:id runs, and
 * leaves the same store state behind; ingredients validate as a string or { item, have }.
 * And the guard that makes the declaration real: the planner's row is the derived one.
 *
 * Two halves, like action-meals.test.mjs: the tool in-process against this process's own
 * store, and the DELETE route through the real server, so the parity claim is a comparison
 * of two things that actually ran.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-plan-meal-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession } = await import("./harness.mjs");
const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
const { INTERNAL_INPUTS } = await import("../context.mjs");
const { planMeal } = await import("../actions/meals.mjs");
const { getAction } = await import("../actions/registry.mjs");
const store = await import("../store.mjs");
const { seedDefaults } = await import("../seed.mjs");
seedDefaults();

const ctx = { householdId: "local", actorId: "m-alex", runId: "run_test" };
const run = (input) => INTERNAL_FUNCTIONS["homeops.plan_meal"].run(ctx, input);
const tasksOf = (mealId) => store.listTasks((t) => t.householdId === "local" && t.mealId === mealId);
const eventsOf = (mealId) => store.listEvents((e) => e.householdId === "local" && e.mealId === mealId);

let hctx, adult;
before(async () => { hctx = await startServer(); adult = await makeSession(hctx, "m-morgan"); });
after(async () => { await stopServer(hctx); });

test("A PRIVATE DISH STAYS PRIVATE: its calendar event and its grocery items carry the meal's visibility", async () => {
  const r = await run({ title: "Secret ramen", date: "2031-08-01", slot: "dinner", visibility: "private", ingredients: ["noodles", "miso"] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.meal.id, r.result.mealId, "the meal record travels beside the flat id");
  assert.equal(r.result.event.id, r.result.eventId, "so does the event record");
  assert.equal(r.result.meal.visibility, "private");
  const ev = store.getEvent(r.result.eventId);
  assert.equal(ev.visibility, "private", "the hand-written tool put a household-visible 'Dinner: X' on the calendar");
  assert.equal(ev.title, "Dinner: Secret ramen");
  assert.equal(ev.provenance.via, "meal");
  assert.equal(ev.provenance.runId, "run_test");
  const groceries = tasksOf(r.result.mealId);
  assert.equal(groceries.length, 2);
  for (const g of groceries) {
    assert.equal(g.visibility, "private", `${g.title} follows the meal`);
    assert.equal(g.source, "meal", "one grocery writer, the app door's value (ADR-004, owner decision B)");
    assert.equal(g.notes, "For Secret ramen");
  }
  // "personal" is the Library's old spelling, normalised on write exactly as createMeal does.
  const p = await run({ title: "Personal toast", date: "2031-08-02", slot: "breakfast", visibility: "personal", ingredients: ["bread"] });
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(p.result.meal.visibility, "private");
  assert.equal(store.getEvent(p.result.eventId).visibility, "private");
  const nest = await run({ title: "Nest stew", visibility: "nest", nestId: "nest_nope", ingredients: ["beef"] });
  assert.equal(nest.ok, false); assert.equal(nest.error, "not_in_nest");
});

test("THE KILL SWITCH STANDS IN FRONT OF THE GOOGLE PUSH: auto-sync on, external actions paused → no push is attempted", async () => {
  store.setSettings({ calendarAutoSync: true, externalActionsEnabled: false }, "local");
  try {
    const r = await run({ title: "Paused pasta", date: "2031-08-03", slot: "dinner", ingredients: ["pasta"] });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.result.eventId, "the local event still lands — the switch pauses reach, not the meal");
    /* No Google account is connected in this process, so an ATTEMPTED push reports
     * no_account. The switch has to answer before that question is even asked — the hand-
     * written tool pushed on calendarAutoSync alone, and the policy ladder cannot see a
     * push made from inside a local Write. */
    assert.deepEqual(r.result.google, { pushed: false, error: "external_actions_disabled" });
    store.setSettings({ externalActionsEnabled: true }, "local");
    const r2 = await run({ title: "Reached pasta", date: "2031-08-04", slot: "dinner", ingredients: ["penne"] });
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(r2.result.google.pushed, false);
    assert.equal(r2.result.google.error, "no_account", "with the switch on, the push is attempted and reports honestly");
  } finally {
    store.setSettings({ calendarAutoSync: false, externalActionsEnabled: true }, "local");
  }
});

test("REPLACE:TRUE RETIRES THE OCCUPANT: archived, its event gone, EVERY grocery link cleared — bought or not", async () => {
  const first = await run({ title: "Salmon", date: "2031-08-10", slot: "dinner", ingredients: ["salmon", "lemon"] });
  assert.equal(first.ok, true, JSON.stringify(first));
  const old = first.result.mealId;
  assert.equal(eventsOf(old).length, 1);
  // A bought item. The old replace path skipped done groceries while DELETE unlinked them;
  // one cascade now, and it is DELETE's rule (the ADR accepts this).
  const lemon = tasksOf(old).find((t) => t.title === "lemon");
  store.patchTask(lemon.id, { status: "done" });

  const second = await run({ title: "Curry", date: "2031-08-10", slot: "dinner", replace: true, ingredients: ["rice"] });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.match(second.result.note, /Replaced Salmon on 2031-08-10/);
  assert.equal(second.result.date, "2031-08-10", "the new dish took the slot");
  assert.equal(store.getMeal(old).archived, true, "archived, not deleted — that is the replace mode");
  assert.equal(eventsOf(old).length, 0, "its calendar event is gone");
  assert.equal(eventsOf(second.result.mealId).length, 1, "one dinner on the calendar, not two");
  assert.equal(tasksOf(old).length, 0, "nothing on the list points at the archived meal");
  const survivors = store.listTasks((t) => t.householdId === "local" && ["salmon", "lemon"].includes(t.title));
  assert.equal(survivors.length, 2, "the grocery items themselves survive");
  for (const t of survivors) {
    assert.equal(t.mealId, null);
    assert.equal(t.notes, "", "the 'For Salmon' note went with the link");
  }
  assert.equal(survivors.find((t) => t.title === "lemon").status, "done", "a bought item keeps its history");
});

test("…AND DELETE /api/meals/:id LEAVES THE SAME STATE BEHIND, because it is the same cascade — and its response did not change shape", async () => {
  const post = (body) => adult.req("/api/meals", { method: "POST", body: JSON.stringify(body) });
  const meal = (await post({ title: "Trout", date: "2031-08-11", slot: "dinner", ingredients: ["trout", "dill"] })).data.meal;
  assert.ok(meal?.id, "the meal exists");
  assert.equal((await adult.req(`/api/meals/${meal.id}/to-calendar`, { method: "POST" })).status, 200);
  assert.equal((await adult.req("/api/events")).data.events.filter((e) => e.mealId === meal.id).length, 1);

  const del = await adult.req(`/api/meals/${meal.id}`, { method: "DELETE" });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.deepEqual(del.data, { ok: true, removedEvents: 1, removedGroceries: 0, unlinkedGroceries: 2 });
  assert.ok(!(await adult.req("/api/meals")).data.meals.some((m) => m.id === meal.id), "deleted, not archived — that is the delete mode");
  assert.equal((await adult.req("/api/events")).data.events.filter((e) => e.mealId === meal.id).length, 0, "its calendar event is gone");
  const left = (await adult.req("/api/tasks")).data.tasks.filter((t) => ["trout", "dill"].includes(t.title));
  assert.equal(left.length, 2, "the grocery items themselves survive");
  for (const t of left) {
    assert.equal(t.mealId ?? null, null);
    assert.equal(t.notes, "", "the 'For Trout' note went with the link");
  }

  // The opt-in the route always had: ?groceries=delete removes the items first, and the
  // cascade then finds nothing left to unlink.
  const cod = (await post({ title: "Cod", date: "2031-08-12", slot: "dinner", ingredients: ["cod"] })).data.meal;
  const del2 = await adult.req(`/api/meals/${cod.id}?groceries=delete`, { method: "DELETE" });
  assert.equal(del2.status, 200, JSON.stringify(del2.data));
  assert.deepEqual(del2.data, { ok: true, removedEvents: 0, removedGroceries: 1, unlinkedGroceries: 0 });
  assert.ok(!(await adult.req("/api/tasks")).data.tasks.some((t) => t.title === "cod"), "the item went with the meal this time");
});

test("INGREDIENTS ARRIVE AS STRINGS OR { item, have }: both validate, and the record holds one shape", async () => {
  const r = await run({ title: "Union omelette", ingredients: ["eggs", { item: "milk" }, { item: "chives", have: true }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.result.meal.ingredients, [{ item: "eggs", have: false }, { item: "milk", have: false }, { item: "chives", have: true }]);
  assert.equal(r.result.groceryItems, 2, "what the family already has stays off the list");
  assert.equal(r.result.eventId, null, "no date, no event");
  assert.equal("event" in r.result, false, "and the key is absent rather than null — a $ref cannot be nullable");
  const bad = await run({ title: "Broken", ingredients: [{ have: true }] });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "invalid_input");
  assert.equal(bad.field, "ingredients[0].item", "the shape gate names the entry");
  assert.ok(!store.listMeals((m) => m.title === "Broken").length, "nothing was planned");
});

test("A COMMA-JOINED INGREDIENT STRING IS AN ARRAY ON THE RUN PATH: fillStepInput joins arrays that way, and the door splits them", async () => {
  const r = await run({ title: "Joined omelette", ingredients: "cheddar, spinach" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.result.meal.ingredients, [{ item: "cheddar", have: false }, { item: "spinach", have: false }], "two ingredients stored, not invalid_input");
  assert.equal(r.result.groceryItems, 2);
});

test("RE-PLANNING A DISH MERGES THE CALL'S INGREDIENTS INTO THE RECORD, and the list is synced from the record", async () => {
  const first = await run({ title: "Tacos", date: "2031-09-01", slot: "dinner", ingredients: ["tortillas", { item: "salsa", have: true }] });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.result.groceryItems, 1);
  // The dupe branch wrote the call's ingredients only when the stored dish had none, and the
  // groceries come from the PERSISTED record — so limes never reached the list.
  const again = await run({ title: "tacos", ingredients: ["Tortillas", "salsa", "limes"] });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.result.mealId, first.result.mealId, "the same dish, updated, not duplicated");
  assert.deepEqual(again.result.meal.ingredients, [{ item: "tortillas", have: false }, { item: "salsa", have: true }, { item: "limes", have: false }],
    "the stored entries keep their spelling and their `have`; the new one joins the record");
  assert.equal(again.result.groceryItems, 1, "only limes is new to the list");
  assert.deepEqual(tasksOf(first.result.mealId).map((t) => t.title).sort(), ["limes", "tortillas"]);
  assert.equal(again.result.date, "2031-09-01", "a dateless re-plan keeps the stored date");
});

test("A NON-LATIN INGREDIENT OR TITLE IS STILL A KEY: two Cyrillic ingredients land as two items, two Cyrillic titles as two meals", async () => {
  // The [a-z0-9] fold turned every non-Latin string into the same empty key.
  const r = await run({ title: "Борщ", date: "2031-09-05", slot: "dinner", ingredients: ["свёкла", "капуста"] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.groceryItems, 2, "the second ingredient no longer collides with the first");
  assert.deepEqual(tasksOf(r.result.mealId).map((t) => t.title).sort(), ["капуста", "свёкла"]);
  const other = await run({ title: "Пельмени", date: "2031-09-06", slot: "dinner", ingredients: ["тесто"] });
  assert.equal(other.ok, true, JSON.stringify(other));
  assert.notEqual(other.result.mealId, r.result.mealId, "a different Cyrillic title within the week is a different dish, not a dupe");
  assert.equal(store.listMeals((m) => ["Борщ", "Пельмени"].includes(m.title) && !m.archived).length, 2);
});

test("THE PLANNER ROW IS THE DERIVED ONE, and the registry entry is the action itself", () => {
  assert.deepEqual(INTERNAL_INPUTS["homeops.plan_meal"], planMeal.toInternalInputs());
  assert.equal(getAction("homeops.plan_meal"), planMeal);
  assert.equal(planMeal.agent, true);
  assert.equal(planMeal.http, undefined, "agent-only: no HTTP door of its own");
  assert.equal(planMeal.delivers, false, "a local Write — the kill switch is asked in-run, where the ladder cannot see");
  assert.ok(!planMeal.errorCodes.includes("bad_slot"), "the slot enum made bad_slot unreachable, so it is not declared");
  assert.ok(planMeal.errorCodes.includes("bad_servings"), "servings keeps the wide wire and run still refuses garbage");
});
