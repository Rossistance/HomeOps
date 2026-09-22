// Meals, declared (ADR-003): POST /api/meals and GET /api/meals.
//
// HTTP-only (agent: false), both of them, and the reason is different from the reads'.
// The model's meal tool is homeops.plan_meal, and planning a meal is more than creating
// one: it de-duplicates against the plan, writes the groceries, puts the dish on the
// calendar and may push it to Google — because "plan dinner Tuesday" means all of that.
// A person typing a meal into the app asked for less: the meal, and its groceries. Those
// are two intents, not one drifted contract, so they keep two doors; plan_meal simply
// writes its meal through the same newMealRecord and its groceries through the same
// syncMealGroceries. Whether plan_meal itself becomes a declared composite is rung 4's
// conversation, not this one.
import { listTasks, putTask, listMeals, putMeal, canSeeEntity, normalizeVisibility } from "../store.mjs";
import { resolveVisibility } from "../nests.mjs";
import { roleAtLeast } from "../auth.mjs";
import { defineAction } from "./define-action.mjs";
import { MEAL_RECORD, MEAL_SLOTS, newMealRecord } from "./schemas/meal.mjs";
import { newTaskRecord } from "./schemas/task.mjs";

const err = (error, message) => ({ ok: false, error, message });
const str = { type: "string" };
const strOrNull = { type: ["string", "null"] };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* P2 [09:20] — "are these ingredients automatically added to the grocery list? If not,
 * they need to be."
 *
 * They were, but only when the ASSISTANT planned the meal (homeops.plan_meal). A meal a
 * person typed in themselves never reached the list — the same recipe, added by hand,
 * silently produced no groceries. Same behaviour both ways now.
 *
 * Only ingredients not already marked `have`, deduped against what is already open on the
 * list so re-saving a meal doesn't stack a third "eggs", and linked by mealId so the
 * grocery item can be traced back to the meal that asked for it. Lived in index.mjs's
 * request handler until the declared create needed it; the PATCH route still calls it. */
export function syncMealGroceries(meal, session) {
  const wanted = (meal.ingredients ?? []).filter((i) => i?.item && !i.have);
  if (wanted.length === 0) return 0;
  const norm = (x) => String(x ?? "").trim().toLowerCase();
  const open = new Set(
    listTasks((t) => t.householdId === session.householdId && t.type === "list" && t.listName === "Groceries" && t.status !== "done")
      .map((t) => norm(t.title)),
  );
  let added = 0;
  for (const ing of wanted) {
    if (open.has(norm(ing.item))) continue;
    open.add(norm(ing.item));
    putTask(newTaskRecord({
      title: String(ing.item).trim(), type: "list", listName: "Groceries", priority: "low",
      visibility: meal.visibility ?? "household", mealId: meal.id, notes: `For ${meal.title}`, source: "meal",
    }, session));
    added++;
  }
  return added;
}

/** What a client may send as an ingredient — a bare string, or { item, have }. */
const normalizeIngredients = (v) => (Array.isArray(v)
  ? v.map((i) => (typeof i === "string" ? { item: i, have: false } : { item: String(i?.item ?? ""), have: !!i?.have })).filter((i) => i.item)
  : []);

export const createMeal = defineAction({
  id: "homeops.create_meal",
  name: "Add a meal",
  description: "Add a dish to the meal plan and put its missing ingredients on the grocery list.",
  action: "Write",
  risk: "Low",
  agent: false,
  input: {
    type: "object",
    properties: {
      title: { ...str, description: "The dish." },
      date: { ...strOrNull, description: "YYYY-MM-DD, or null for an unplanned dish." },
      slot: { type: "string", enum: [...MEAL_SLOTS], description: "Default dinner." },
      time: { ...strOrNull, description: "HH:MM; the slot's default applies when absent or malformed." },
      notes: str,
      ingredients: { type: "array", items: {}, description: "Bare strings, or { item, have }." },
      instructions: { type: "array", items: str, description: "Step-by-step, one step per entry." },
      /* What the door ACCEPTS is wider than what the record holds: a form sends "" for an
       * empty box and always has, and the route always turned anything that is not a
       * positive whole number into null rather than refusing the whole meal over it. The
       * record's servings is number | null; this is the wire. */
      servings: { type: ["number", "string", "null"], description: "A positive whole number of servings. Anything else is stored as null (unknown)." },
      /* Same reason as servings: the record holds a string, the door accepts what it is
       * sent and keeps the meal, turning anything that is not a string into "". */
      recipeUrl: { description: "Source recipe URL, if any. Anything that is not a string is stored as empty." },
      visibility: { type: "string", enum: ["household", "private", "personal", "adults", "nest", "childVisible"], description: "Who can see it. Default household. nest needs nestId." },
      nestId: strOrNull,
    },
    required: ["title"],
    additionalProperties: false,
  },
  output: { type: "object", properties: { meal: { $ref: "#/$defs/MealRecord" }, groceriesAdded: { type: "number" } }, required: ["meal", "groceriesAdded"], additionalProperties: false },
  $defs: { MealRecord: MEAL_RECORD },
  errorCodes: ["invalid_input", "empty_title", "not_in_nest"],
  errors: { not_in_nest: 403 },
  http: {
    method: "POST", path: "/api/meals",
    // The count travels so the app can SAY what happened rather than the family finding
    // out later, or not at all.
    audit: (result) => ({ type: "meal.create", mealId: result.meal.id, groceriesAdded: result.groceriesAdded, ok: true }),
  },
  authorize: (session) => (roleAtLeast(session?.role, "Limited Member") ? null : { status: 403, error: "insufficient_role" }),

  async run(ctx, input) {
    const title = String(input.title ?? "").trim();
    if (!title) return err("empty_title", "A meal needs a name.");
    const vis = resolveVisibility(input.visibility, input.nestId, ctx);
    if (!vis) return err("not_in_nest", "You can only put this in a nest you're part of.");
    const meal = putMeal(newMealRecord({
      title, date: input.date ?? null, slot: input.slot ?? "dinner",
      // Optional suggested time (HH:MM) — used when pushing the meal to the calendar;
      // slot-default times apply when unset (item 5).
      time: typeof input.time === "string" && TIME_RE.test(input.time) ? input.time : null,
      notes: typeof input.notes === "string" ? input.notes : "",
      ingredients: normalizeIngredients(input.ingredients),
      // Recipe metadata (Phase 3): servings is a positive integer or null; recipeUrl free-form.
      servings: Number.isFinite(+input.servings) && +input.servings > 0 ? Math.floor(+input.servings) : null,
      recipeUrl: typeof input.recipeUrl === "string" ? input.recipeUrl.trim() : "",
      // Step-by-step instructions (extracted from the recipe source by web.recipe, or typed).
      instructions: (input.instructions ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 60),
      visibility: normalizeVisibility(vis.visibility), nestId: vis.nestId,
      source: "user",
    }, ctx));
    const groceriesAdded = syncMealGroceries(meal, ctx);
    return { ok: true, result: { meal, groceriesAdded } };
  },
});

export const readMeals = defineAction({
  id: "homeops.list_meals",
  name: "List meals",
  description: "Every dish on the plan the viewer can see. A dish plan_meal replaced is archived and not shown.",
  action: "Read",
  risk: "Low",
  agent: false,
  input: { type: "object", properties: {}, additionalProperties: false },
  output: { type: "object", properties: { meals: { type: "array", items: { $ref: "#/$defs/MealRecord" } } }, required: ["meals"], additionalProperties: false },
  $defs: { MealRecord: MEAL_RECORD },
  errorCodes: ["invalid_input"],
  http: { method: "GET", path: "/api/meals" },

  async run(ctx) {
    const viewer = { role: ctx.role, actorId: ctx.actorId };
    // plan_meal's replace:true archives the meal it replaced; the planner must not show both.
    const meals = listMeals((m) => m.householdId === ctx.householdId && !m.archived).filter((m) => canSeeEntity(m, viewer));
    return { ok: true, result: { meals } };
  },
});
