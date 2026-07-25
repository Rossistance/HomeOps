// P2 [09:20] — "are these ingredients automatically added to the grocery list? If not, they
// need to be."
//
// They were — but only when the ASSISTANT planned the meal (homeops.plan_meal). A meal a person
// typed in themselves never reached the list. Same recipe, added by hand, silently produced no
// groceries, and nothing anywhere said so.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, alex;
before(async () => { ctx = await startServer(); alex = await makeSession(ctx, "m-alex"); });
after(async () => { await stopServer(ctx); });

const groceries = async () =>
  (await alex.req("/api/tasks")).data.tasks.filter((t) => t.type === "list" && t.listName === "Groceries");

test("THE GAP: a meal added by hand puts its ingredients on the grocery list", async () => {
  const r = await alex.req("/api/meals", {
    method: "POST",
    body: JSON.stringify({ title: "Tacos", date: "2026-08-01", slot: "dinner", ingredients: ["tortillas", "mince", "salsa"] }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.groceriesAdded, 3, "and it reports the count, so the app can say so");
  const names = (await groceries()).map((t) => t.title);
  for (const want of ["tortillas", "mince", "salsa"]) assert.ok(names.includes(want), `${want} should be on the list`);
});

test("an ingredient already marked `have` is not shopped for", async () => {
  const r = await alex.req("/api/meals", {
    method: "POST",
    body: JSON.stringify({ title: "Pasta", ingredients: [{ item: "spaghetti", have: false }, { item: "olive oil", have: true }] }),
  });
  assert.equal(r.data.groceriesAdded, 1);
  const names = (await groceries()).map((t) => t.title);
  assert.ok(names.includes("spaghetti"));
  assert.ok(!names.includes("olive oil"), "we already have it");
});

test("saving a second meal that shares an ingredient does not stack a duplicate", async () => {
  await alex.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Meal A", ingredients: ["eggs"] }) });
  const second = await alex.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Meal B", ingredients: ["eggs", "butter"] }) });
  assert.equal(second.data.groceriesAdded, 1, "only the new one");
  const eggs = (await groceries()).filter((t) => t.title === "eggs");
  assert.equal(eggs.length, 1, "one line for eggs, not two");
});

test("each grocery item remembers the meal that asked for it", async () => {
  const meal = await alex.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Curry", ingredients: ["coconut milk"] }) });
  const item = (await groceries()).find((t) => t.title === "coconut milk");
  assert.equal(item.mealId, meal.data.meal.id);
  assert.match(item.notes, /Curry/);
});

test("a meal with nothing to buy adds nothing", async () => {
  const r = await alex.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Leftovers" }) });
  assert.equal(r.data.groceriesAdded, 0);
});
