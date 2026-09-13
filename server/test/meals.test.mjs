// MEAL — family meal plan + grocery-list generation (reuses list-tasks).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult, child;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");    // Child View
});
after(async () => { await stopServer(ctx); });

test("a child cannot create a meal (below Limited Member)", async () => {
  const r = await child.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Pizza" }) });
  assert.equal(r.status, 403);
});

test("an adult plans a meal; the whole household can see it", async () => {
  const created = await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Taco night", date: "2026-04-06", slot: "dinner", ingredients: ["tortillas", { item: "cheese", have: true }, "salsa"] }) });
  assert.equal(created.status, 200);
  const meal = created.data.meal;
  assert.equal(meal.slot, "dinner");
  assert.equal(meal.ingredients.length, 3);
  // Household visibility — a child sees the family meal plan.
  const childMeals = (await child.req("/api/meals")).data.meals;
  assert.ok(childMeals.some((m) => m.id === meal.id), "child sees the household meal");
});

test("sending a meal to groceries adds only the not-yet-have ingredients as list tasks", async () => {
  // Creating the meal is what adds them now (P2), so the count is measured from BEFORE that —
  // the behaviour under test is which ingredients get shopped for, not which call does it.
  const before = (await adult.req("/api/tasks")).data.tasks.filter((t) => t.type === "list" && t.listName === "Groceries").length;
  const created = await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Spaghetti", ingredients: ["pasta", { item: "olive oil", have: true }, "tomatoes"] }) });
  assert.equal(created.data.groceriesAdded, 2, "only pasta + tomatoes (olive oil is have:true)");
  const after = (await adult.req("/api/tasks")).data.tasks.filter((t) => t.type === "list" && t.listName === "Groceries");
  assert.equal(after.length, before + 2);
  assert.ok(after.some((t) => t.title === "pasta"));
  assert.ok(!after.some((t) => t.title === "olive oil"), "we already have it");
  // And the explicit button is now an idempotent re-sync over the same implementation.
  const r = await adult.req(`/api/meals/${created.data.meal.id}/to-grocery`, { method: "POST" });
  assert.equal(r.status, 200);
  assert.equal(r.data.added, 0);
});

test("a child cannot delete an adult's meal", async () => {
  const meal = (await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Soup" }) })).data.meal;
  const del = await child.req(`/api/meals/${meal.id}`, { method: "DELETE" });
  assert.equal(del.status, 403);
});

test("meal recipe metadata: servings + recipeUrl persist; garbage servings become null", async () => {
  const good = (await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Lasagna", servings: 6, recipeUrl: "https://example.com/lasagna" }) })).data.meal;
  assert.equal(good.servings, 6);
  assert.equal(good.recipeUrl, "https://example.com/lasagna");
  // Round-trips through GET (not just the create response).
  const fetched = (await adult.req("/api/meals")).data.meals.find((m) => m.id === good.id);
  assert.equal(fetched.servings, 6);
  assert.equal(fetched.recipeUrl, "https://example.com/lasagna");
  // Non-numeric / non-positive servings are rejected to null, not stored as junk.
  const junk = (await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Junk", servings: "lots", recipeUrl: 42 }) })).data.meal;
  assert.equal(junk.servings, null);
  assert.equal(junk.recipeUrl, "");
  const zero = (await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Zero", servings: 0 }) })).data.meal;
  assert.equal(zero.servings, null);
});

test("groceries carry a real mealId back-reference, and deleting the meal unlinks (never deletes) them", async () => {
  const meal = (await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Chili night", ingredients: ["beans", "beef"] }) })).data.meal;
  // Creating the meal now ALREADY adds its ingredients (P2 — "are these automatically added
  // to the grocery list? If not, they need to be"), so this button is a re-sync: it shares one
  // deduping implementation with the create path, and correctly adds nothing the second time.
  const groc = await adult.req(`/api/meals/${meal.id}/to-grocery`, { method: "POST" });
  assert.equal(groc.data.added, 0, "already on the list — a second press must not duplicate");
  const tasksBefore = (await adult.req("/api/tasks")).data.tasks.filter((t) => t.mealId === meal.id);
  assert.equal(tasksBefore.length, 2, "grocery tasks carry the real mealId");
  assert.ok(tasksBefore.every((t) => t.notes === `For ${meal.title}`));

  const del = await adult.req(`/api/meals/${meal.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  assert.equal(del.data.unlinkedGroceries, 2);

  // The grocery items SURVIVE the meal's deletion — just unlinked, not removed.
  const tasksAfter = (await adult.req("/api/tasks")).data.tasks.filter((t) => tasksBefore.some((b) => b.id === t.id));
  assert.equal(tasksAfter.length, 2, "grocery items are not cascade-deleted");
  assert.ok(tasksAfter.every((t) => t.mealId === null), "mealId cleared");
  assert.ok(tasksAfter.every((t) => t.notes === ""), "stale 'For <meal>' note cleared too");
});

test("a grocery item can be deleted directly (adult, or the household member who added it)", async () => {
  const meal = (await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Extra", ingredients: ["napkins"] }) })).data.meal;
  await adult.req(`/api/meals/${meal.id}/to-grocery`, { method: "POST" });
  const item = (await adult.req("/api/tasks")).data.tasks.find((t) => t.title === "napkins" && t.mealId === meal.id);
  assert.ok(item, "grocery item exists");
  const childDel = await child.req(`/api/tasks/${item.id}`, { method: "DELETE" });
  assert.equal(childDel.status, 403, "child cannot delete an adult-created grocery item");
  const ok = await adult.req(`/api/tasks/${item.id}`, { method: "DELETE" });
  assert.equal(ok.status, 200);
  const gone = (await adult.req("/api/tasks")).data.tasks.some((t) => t.id === item.id);
  assert.equal(gone, false);
});
// Item 5 (2026-07-03): meal scheduling + calendar push. A meal with a date lands on the
// household calendar as a CANONICAL event linked by mealId; re-pushing updates instead
// of duplicating; deleting the meal unlinks (never deletes) the event — it may already
// be on Google. From there the existing approval-gated /api/calendar/push handles Google.
test("a meal pushes to the calendar as a linked canonical event (idempotent, slot-default time)", async () => {
  const meal = (await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Lasagna", date: "2026-07-07", slot: "dinner" }) })).data.meal;
  const r1 = await adult.req(`/api/meals/${meal.id}/to-calendar`, { method: "POST" });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.action, "created");
  const ev = r1.data.event;
  assert.equal(ev.title, "Dinner: Lasagna");
  // A REAL instant now (household clock; this household declares none, so the server's):
  // the zoneless "2026-07-07T18:00:00" this used to be meant a different time on every device.
  assert.equal(ev.startAt, new Date(2026, 6, 7, 18, 0, 0).toISOString(), "dinner slot defaults to 18:00 local");
  assert.equal(ev.layer, "canonical", "canonical — pushable to Google via the existing route");
  assert.equal(ev.mealId, meal.id, "event carries the real meal back-reference");
  // Re-push after changing the time: updates the SAME event, no duplicate.
  await adult.req(`/api/meals/${meal.id}`, { method: "PATCH", body: JSON.stringify({ time: "17:30" }) });
  const r2 = await adult.req(`/api/meals/${meal.id}/to-calendar`, { method: "POST" });
  assert.equal(r2.data.action, "updated");
  assert.equal(r2.data.event.id, ev.id, "same event updated, not duplicated");
  assert.equal(r2.data.event.startAt, new Date(2026, 6, 7, 17, 30, 0).toISOString(), "explicit meal time wins over the slot default");
});

test("a dateless meal cannot be pushed; deleting a meal deletes its calendar event", async () => {
  const dateless = (await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Someday soup" }) })).data.meal;
  const bad = await adult.req(`/api/meals/${dateless.id}/to-calendar`, { method: "POST" });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, "date_required");

  const meal = (await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Tacos", date: "2026-07-08" }) })).data.meal;
  const ev = (await adult.req(`/api/meals/${meal.id}/to-calendar`, { method: "POST" })).data.event;
  const del = await adult.req(`/api/meals/${meal.id}`, { method: "DELETE" });
  assert.equal(del.data.removedEvents, 1);
  const after = (await adult.req("/api/events")).data.events.find((e) => e.id === ev.id);
  assert.equal(after, undefined, "the meal's calendar event is deleted with the meal");
});

test("deleting a meal keeps groceries by default, deletes them with ?groceries=delete", async () => {
  // Default: unlink — items survive with the stale meal link cleared.
  /* Distinct ingredient names on purpose. Groceries dedupe by name across the whole open
   * list — you buy beans once, however many meals want them — so reusing "Beans" here would
   * collide with an earlier test's leftovers and this meal would (correctly) link to nothing. */
  const keep = (await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Chili", date: "2026-07-09", ingredients: [{ item: "Cannellini beans", have: false }] }) })).data.meal;
  // (creating the meal already put it on the list — P2)
  const delKeep = await adult.req(`/api/meals/${keep.id}`, { method: "DELETE" });
  assert.equal(delKeep.data.unlinkedGroceries, 1);
  assert.equal(delKeep.data.removedGroceries, 0);
  const beans = (await adult.req("/api/tasks")).data.tasks.find((t) => t.title === "Cannellini beans");
  assert.ok(beans, "grocery item survives by default");

  // Opt-in cascade: the meal's ingredients leave the list with it.
  const drop = (await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Curry", date: "2026-07-10", ingredients: [{ item: "Coconut milk", have: false }] }) })).data.meal;
  const delDrop = await adult.req(`/api/meals/${drop.id}?groceries=delete`, { method: "DELETE" });
  assert.equal(delDrop.data.removedGroceries, 1);
  const milk = (await adult.req("/api/tasks")).data.tasks.find((t) => t.title === "Coconut milk");
  assert.equal(milk, undefined, "opt-in delete removes the meal's grocery items");
});
