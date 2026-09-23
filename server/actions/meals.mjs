// Meals, declared: POST /api/meals and GET /api/meals (ADR-003), and homeops.plan_meal,
// the model's meal tool, as a declared composite beside them (ADR-004).
//
// The two HTTP doors are HTTP-only (agent: false), and the reason is different from the
// reads'. Planning a meal is more than creating one: it de-duplicates against the plan,
// writes the groceries, puts the dish on the calendar and may push it to Google — because
// "plan dinner Tuesday" means all of that. A person typing a meal into the app asked for
// less: the meal, and its groceries. Those are two intents, not one drifted contract, so
// they keep two doors. What they share is underneath: one newMealRecord, one grocery
// writer (syncMealGroceries — plan_meal kept a loop of its own until ADR-004, whatever the
// earlier record said), one meal-to-event composer (mealEventFields) and one retire
// cascade (retireMeal), which the meal routes in index.mjs and famili.delete_meal use too.
import { listTasks, putTask, patchTask, listMeals, putMeal, patchMeal, deleteMealRec, listEvents, putEvent, patchEvent, deleteEventRec, getSettings, appendAudit, canSeeEntity, normalizeVisibility } from "../store.mjs";
import { resolveVisibility } from "../nests.mjs";
import { roleAtLeast } from "../auth.mjs";
import { householdTimeZone, wallClockISO } from "../household-time.mjs";
import { mealEventNotes, pushEventToGoogle, deleteGoogleCopy, googleReachAllowed } from "../calendar.mjs";
import { defineAction } from "./define-action.mjs";
import { nowISO } from "./shared.mjs";
import { MEAL_RECORD, MEAL_SLOTS, newMealRecord } from "./schemas/meal.mjs";
import { EVENT_RECORD, newEventRecord } from "./schemas/event.mjs";
import { newTaskRecord } from "./schemas/task.mjs";

const err = (error, message) => ({ ok: false, error, message });
const str = { type: "string" };
const strOrNull = { type: ["string", "null"] };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/* One title normaliser for the grocery list, and it is plan_meal's: lowercase, every run of
 * punctuation or whitespace folded to one space. "Ground Beef" and "ground-beef" are the
 * same item to a shopper, and the trim-and-lowercase the create route used let both land.
 * Letters and digits in ANY script: the [a-z0-9] fold turned "свёкла" and "капуста" into the
 * same empty key, so a non-Latin ingredient list collapsed to one item and two non-Latin
 * dishes within a week were one meal. */
const groceryKey = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

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
 * request handler until the declared create needed it; the PATCH route still calls it.
 *
 * ONE grocery writer (ADR-004). plan_meal kept a loop of its own beside this one for a
 * long time, and the two disagreed on the normaliser, the `source`, the visibility and
 * whether two "eggs" in one call both land. Now plan_meal calls this, so it returns what
 * plan_meal needs — the ids as well as the count — and takes the normaliser plan_meal
 * used (the punctuation-folding one) as the default. */
export function syncMealGroceries(meal, session, { norm = groceryKey } = {}) {
  const wanted = (meal.ingredients ?? []).filter((i) => i?.item && !i.have);
  if (wanted.length === 0) return { added: 0, ids: [] };
  const open = new Set(
    listTasks((t) => t.householdId === session.householdId && t.type === "list" && t.listName === "Groceries" && t.status !== "done")
      .map((t) => norm(t.title)),
  );
  const ids = [];
  for (const ing of wanted) {
    if (open.has(norm(ing.item))) continue;
    open.add(norm(ing.item));
    const tk = putTask(newTaskRecord({
      title: String(ing.item).trim(), type: "list", listName: "Groceries", priority: "low",
      visibility: meal.visibility ?? "household", mealId: meal.id, notes: `For ${meal.title}`, source: "meal",
    }, session));
    ids.push(tk.id);
  }
  return { added: ids.length, ids };
}

/* ---- Meal → calendar event, composed ONCE ----
 * The slot's default time, the "Dinner: Chili" title, a real instant on the household's
 * clock and the recipe body as notes. This was written three times — plan_meal, PATCH
 * /api/meals/:id and POST /api/meals/:id/to-calendar — and they had already drifted on
 * whether a malformed `time` was tolerated. The caller decides the visibility. */
const SLOT_TIMES = Object.freeze({ breakfast: "08:00", lunch: "12:00", dinner: "18:00", snack: "15:00" });
export function mealEventFields(meal, timeZone) {
  const slot = MEAL_SLOTS.includes(meal.slot) ? meal.slot : "dinner";
  const time = TIME_RE.test(meal.time ?? "") ? meal.time : (SLOT_TIMES[slot] ?? "18:00");
  const slotLabel = slot.charAt(0).toUpperCase() + slot.slice(1);
  // A zoneless "2026-07-23T18:00:00" meant one time on the server and another on every
  // phone, and went to Google with no zone beside a UTC end; the fallback is only for a
  // date the zone helper cannot place.
  const startAt = wallClockISO(meal.date, time, timeZone) ?? `${meal.date}T${time}:00`;
  return { title: `${slotLabel}: ${meal.title}`, startAt, notes: mealEventNotes(meal), category: "Meal" };
}

/* ---- Retiring a meal, composed ONCE ----
 * Archiving the meal alone left its calendar event and grocery items behind — two dinners
 * on the calendar and both ingredient lists on the shopping list. The cascade was written
 * three times (plan_meal's replace, DELETE /api/meals/:id, famili.delete_meal) with small
 * divergences: one unlinked only open groceries, one did not check the kill switch. One
 * cascade now: the meal goes (archived for a replace, deleted for a delete), every event
 * linked by mealId goes — its Google copy too, best effort, unless the household paused
 * external actions — and EVERY grocery item linked by mealId is unlinked, done or not: a
 * still-wanted item outlives the meal that put it on the list, and a bought one keeps
 * its history. `google` is reported the way delete_meal always has. */
export async function retireMeal(meal, ctx, { mode = "archive" } = {}) {
  if (mode === "delete") deleteMealRec(meal.id);
  else patchMeal(meal.id, { archived: true });
  const hh = ctx.householdId;
  const reach = googleReachAllowed(hh);
  let eventsRemoved = 0;
  let google = null;
  for (const e of listEvents((x) => x.householdId === hh && x.mealId === meal.id)) {
    if (e.provenance?.googleEventId) {
      if (!reach) google = "kept (external actions paused)";
      else {
        const r = await deleteGoogleCopy({ ev: e, householdId: hh, actorId: ctx.actorId }).catch((err) => ({ ok: false, error: String(err?.message ?? err) }));
        appendAudit({ type: "calendar.googledelete", eventId: e.id, ok: r.ok, householdId: hh, actorId: ctx.actorId });
        google = r.ok ? "deleted" : `kept (${r.error ?? "google error"})`;
      }
    }
    deleteEventRec(e.id);
    eventsRemoved++;
  }
  let groceryItemsUnlinked = 0;
  for (const t of listTasks((x) => x.householdId === hh && x.mealId === meal.id)) {
    patchTask(t.id, { mealId: null, notes: t.notes === `For ${meal.title}` ? "" : t.notes });
    groceryItemsUnlinked++;
  }
  return { eventsRemoved, groceryItemsUnlinked, ...(google ? { google } : {}) };
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
    const groceriesAdded = syncMealGroceries(meal, ctx).added;
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

/* ---- Plan a meal: the model's meal tool, declared (ADR-004) ----
 * More than a create, because "plan dinner Tuesday" means all of it: the dish on the plan
 * (de-duplicated against the same dish within a week; moved to the next free day when the
 * slot is taken, or — only when the family said replace — swapped in), its missing
 * ingredients on the Groceries list, a calendar event on the household's clock, and a
 * Google push when the household turned auto-sync on. The dedupe / replace / shift /
 * enrichment semantics are product features with tests and moved here verbatim from
 * internal-functions.mjs; the three side effects go through the helpers above, so there is
 * one writer of each. Agent-only, no HTTP door: a person typing a meal into the app asked
 * for less (createMeal), and the two intents keep their two doors. The id is load-bearing —
 * CHAT_DENIED_TOOL_IDS is copied onto stored helper records by id, and IDEMPOTENT_TOOLS
 * names it for restart replay. */
export const planMeal = defineAction({
  id: "homeops.plan_meal",
  name: "Plan a meal (planner + groceries + calendar)",
  description: "Plan a dish for the family: put it on the meal plan, add the ingredients the family does not already have to the Groceries list, and put a calendar event on the household's clock (pushed to Google Calendar when the household turned calendar auto-sync on). The same dish already planned within a week is updated, never duplicated. When the slot is taken the dish moves to the next free day and the note says so; pass replace:true only when the family asked to swap — that archives the old dish and removes its calendar event and grocery links. Give the full ingredient list with quantities; with none, the recipe page (recipeUrl) is read, or a standard list is estimated and labelled as such. Use this for anything cooked or eaten on a day; for a bare item on the list use homeops__create_list_item.",
  action: "Write",
  risk: "Low",
  requiresApproval: false,
  delivers: false,
  input: {
    type: "object",
    properties: {
      title: { ...str, description: "Short human title." },
      date: { ...strOrNull, description: "Calendar date, YYYY-MM-DD." },
      /* null means absent, for every optional field below. The chat path strips nulls before
       * the call (coerceInput); the run path hands the step input to the door as it is, and
       * the hand-written tool tolerated a null it was given. The enum carries null so the
       * shape gate still refuses "brunch" by name — bad_slot stays unreachable. */
      slot: { type: ["string", "null"], enum: [...MEAL_SLOTS, null], description: "Default dinner." },
      time: { ...strOrNull, description: "Time of day, 24-hour HH:MM." },
      ingredients: {
        type: ["array", "null"],
        items: {
          type: ["string", "object"],
          properties: { item: str, have: { type: "boolean", description: "true when the family already has it — it stays off the grocery list." } },
          required: ["item"], additionalProperties: false,
        },
        description: "Full ingredient list, one entry per ingredient with quantity — a bare string, or { item, have }.",
      },
      instructions: { type: ["array", "null"], items: str, description: "Step-by-step cooking instructions, one step per entry." },
      recipeUrl: { ...strOrNull, description: "Source recipe URL, if any." },
      /* createMeal's wire, on purpose: the record's servings is number | null. A value that
       * is not a positive number is refused by run (bad_servings) rather than stored as
       * null — the App QA helper found servings:0 becoming null without a word. */
      servings: { type: ["number", "string", "null"], description: "Number of servings — size to the household. A positive whole number." },
      replace: { type: ["boolean", "null"], description: "true to replace whatever is already planned in that slot (only when the family said so)." },
      notes: { ...strOrNull, description: "Free-form notes." },
      visibility: { type: "string", enum: ["household", "private", "personal", "adults", "nest", "childVisible"], description: "Who can see it. Default household. nest needs nestId." },
      nestId: { ...strOrNull, description: "The nest, when visibility is nest." },
    },
    required: ["title"],
    additionalProperties: false,
  },
  /* The flat keys are what every consumer reads today — the iOS run formatter, the chat
   * card, the engine's eventId threading, four test files — and they stay; the records are
   * added beside them. `event` is optional, not nullable: a $ref cannot carry null, so the
   * key is omitted when the meal has no date. */
  output: {
    type: "object",
    properties: {
      id: { ...str, description: "The meal's id (starts with meal_); the same as mealId." },
      mealId: str,
      title: str,
      date: strOrNull,
      slot: { type: "string", enum: [...MEAL_SLOTS] },
      groceryItems: { type: "number", description: "How many ingredients were added to the Groceries list." },
      eventId: { ...strOrNull, description: "The linked calendar event, when the meal has a date." },
      google: {
        type: "object",
        properties: { pushed: { type: "boolean" }, googleEventId: str, action: { type: "string", enum: ["created", "updated"] }, error: str },
        required: ["pushed"], additionalProperties: false,
        description: "Whether the event reached Google Calendar — attempted only when calendar auto-sync is on and external actions are not paused.",
      },
      note: { ...str, description: "What the planner did differently from what was asked: moved, replaced, de-duplicated, estimated." },
      meal: { $ref: "#/$defs/MealRecord" },
      event: { $ref: "#/$defs/EventRecord" },
    },
    required: ["id", "mealId", "title", "date", "slot", "groceryItems", "eventId", "google", "meal"],
    additionalProperties: false,
  },
  $defs: { MealRecord: MEAL_RECORD, EventRecord: EVENT_RECORD },
  errorCodes: ["invalid_input", "empty_title", "bad_servings", "not_in_nest"],
  errors: { not_in_nest: 403 },

  // One approved meal → everything wired in a single real action:
  //   1. meal in the Meal Planner (title, date, slot, recipe URL, ingredients, instructions)
  //   2. missing ingredients onto the shared Groceries list (mealId back-reference,
  //      so the grocery mini app shows them linked to this meal)
  //   3. a canonical calendar event whose `notes` body carries the recipe URL,
  //      full ingredient list, and step-by-step instructions
  //   4. when the household enabled calendar auto-sync, the event is pushed to
  //      Google Calendar immediately (description = the same notes body).
  // This is what the assistant calls per approved meal in the "plan my week" flow.
  async run(ctx, input) {
    const title = String(input?.title ?? "").trim();
    if (!title) return err("empty_title", "A meal needs a title.");
    // servings:0 used to become null silently. ("brunch" used to become dinner the same
    // way; the slot is an enum in the schema now, so it is invalid_input, field named,
    // before this runs.)
    if (input?.servings != null && input.servings !== "" && !(Number.isFinite(+input.servings) && +input.servings > 0)) return err("bad_servings", "servings must be a whole number greater than zero.");
    // Exactly as createMeal resolves it: a nest you're not in is refused, "personal" is
    // normalised to "private". The hand-written tool passed the model's word through.
    const vis = resolveVisibility(input.visibility, input.nestId, ctx);
    if (!vis) return err("not_in_nest", "You can only put this in a nest you're part of.");
    const now = nowISO();
    let ingredients = (Array.isArray(input?.ingredients) ? input.ingredients : [])
      .map((i) => (typeof i === "string" ? { item: i.trim(), have: false } : { item: String(i.item ?? "").trim(), have: !!i.have }))
      .filter((i) => i.item).slice(0, 60);
    let instructions = (Array.isArray(input?.instructions) ? input.instructions : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 60);
    let enrichmentNote = "";
    // Self-enrichment: planners routinely arrive with a bare title (recipe pages
    // bot-walled upstream). A meal without ingredients puts NOTHING on the
    // grocery list — the exact silent failure users hit — so fetch the recipe
    // here, and as a last resort estimate a standard list, honestly labeled.
    if (ingredients.length === 0) {
      const recipeUrl = typeof input?.recipeUrl === "string" ? input.recipeUrl.trim() : "";
      try {
        const { extractRecipe, estimateIngredients } = await import("../web.mjs");
        if (recipeUrl) {
          const r = await extractRecipe(recipeUrl);
          if (r.ok && r.recipe?.ingredients?.length) {
            ingredients = r.recipe.ingredients.map((x) => ({ item: String(x).slice(0, 160), have: false })).slice(0, 60);
            if (instructions.length === 0) instructions = (r.recipe.instructions ?? []).map((s) => String(s)).slice(0, 60);
            if (r.extraction === "text") enrichmentNote = "Ingredients read from the recipe page text.";
          }
        }
        if (ingredients.length === 0) {
          const est = await estimateIngredients(title, input?.servings ?? 4);
          if (est) {
            ingredients = est.ingredients.map((x) => ({ item: x, have: false }));
            if (instructions.length === 0) instructions = est.instructions;
            enrichmentNote = "Ingredients estimated by Famili — check quantities before shopping.";
          }
        }
      } catch { /* enrichment is best-effort; the meal still lands */ }
    }
    const slot = MEAL_SLOTS.includes(input?.slot) ? input.slot : "dinner";
    let date = typeof input?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
    let scheduleNote = "";
    // State-aware scheduling — the intelligence users expect:
    // 1. Same meal already planned this week → update it, never duplicate.
    // 2. The requested slot is taken → replace only when explicitly asked
    //    (replace:true); otherwise shift to the nearest free slot and say so.
    const household = (m) => m.householdId === ctx.householdId && !m.archived;
    const norm = groceryKey;
    const dupe = listMeals(household).find((m) => norm(m.title) === norm(title) && (!date || !m.date || Math.abs(Date.parse(m.date) - Date.parse(date)) < 8 * 86400000));
    const occupant = (d) => listMeals(household).find((m) => m.date === d && m.slot === slot && (!dupe || m.id !== dupe.id));
    if (date && occupant(date)) {
      if (input?.replace === true) {
        const old = occupant(date);
        // Archiving the meal alone left its calendar event and grocery items behind —
        // two dinners on the calendar and both ingredient lists on the shopping list.
        // The one cascade DELETE /api/meals/:id and famili.delete_meal run.
        await retireMeal(old, ctx, { mode: "archive" });
        scheduleNote = `Replaced ${old.title} on ${date}.`;
      } else {
        const requested = date;
        for (let d = 1; d <= 7 && occupant(date); d++) {
          date = new Date(Date.parse(requested) + d * 86400000).toISOString().slice(0, 10);
        }
        if (occupant(date)) {
          // Week is full — keep the requested date, but SAY it is now a double booking.
          date = requested;
          scheduleNote = `${requested} ${slot} already had ${occupant(requested)?.title ?? "a meal"} and the week is full, so both are on that slot now. Ask me to "replace" if you'd rather swap.`;
        } else {
          scheduleNote = `${requested} ${slot} already had ${occupant(requested)?.title ?? "a meal"} — moved to ${date}. Ask me to "replace" if you'd rather swap.`;
        }
      }
    }
    let meal;
    if (dupe) {
      // Same dish already on the plan — move/refresh it instead of duplicating.
      // Only move it when a date was actually given — re-planning "tacos" with no date used
      // to write date:null over the real one, dropping the meal off the planner while its
      // calendar event stayed on the old day.
      // The call's ingredients JOIN the stored list rather than being dropped when the dish
      // already had one: the groceries are synced from the PERSISTED record (below), so an
      // ingredient that never reaches the record never reaches the list — re-planning
      // "tacos" with limes added put no limes on Groceries. Same key as the list itself
      // (groceryKey), the stored entry wins so a `have` the family set is kept, and the
      // record's cap holds.
      const stored = dupe.ingredients ?? [];
      const seen = new Set(stored.map((i) => norm(i?.item)));
      const merged = [...stored];
      for (const ing of ingredients) {
        const k = norm(ing.item);
        if (seen.has(k)) continue;
        seen.add(k); merged.push(ing);
      }
      meal = patchMeal(dupe.id, {
        ...(date ? { date, slot } : {}), updatedAt: now,
        ...(merged.length > stored.length ? { ingredients: merged.slice(0, 60) } : {}),
        ...(instructions.length && !(dupe.instructions ?? []).length ? { instructions } : {}),
      }) ?? dupe;
      date = meal.date ?? date;
      scheduleNote = scheduleNote || `${meal.title} was already planned — updated it instead of adding a duplicate.`;
    } else {
      meal = putMeal(newMealRecord({
        title, date, slot,
        time: typeof input?.time === "string" && TIME_RE.test(input.time) ? input.time : null,
        notes: String(input?.notes ?? ""), ingredients, instructions,
        servings: Number.isFinite(+input?.servings) && +input.servings > 0 ? Math.floor(+input.servings) : null,
        recipeUrl: typeof input?.recipeUrl === "string" ? input.recipeUrl.trim() : "",
        visibility: normalizeVisibility(vis.visibility), nestId: vis.nestId, source: "assistant",
      }, ctx));
    }
    if (enrichmentNote) scheduleNote = [scheduleNote, enrichmentNote].filter(Boolean).join(" ");
    // 2) Groceries — every not-yet-have ingredient, linked by mealId, through the same
    // writer the app's door uses, and from the meal record that was actually PERSISTED:
    // the engine re-drives this step after a restart (IDEMPOTENT_TOOLS), and a replay must
    // not link the list to ingredients the meal does not hold.
    const { added: groceryItems } = syncMealGroceries(meal, ctx);
    // 3) Calendar event (idempotent by mealId) with the full recipe body in notes, and
    // the meal's own visibility — a private dish used to put a household-visible
    // "Dinner: X" on the calendar.
    let event = null;
    if (meal.date) {
      const fields = mealEventFields(meal, householdTimeZone(ctx.householdId));
      const existing = listEvents((e) => e.householdId === ctx.householdId && e.mealId === meal.id)[0];
      event = existing
        ? patchEvent(existing.id, fields)
        : putEvent(newEventRecord({
            ...fields, ownerId: ctx.actorId, mealId: meal.id,
            visibility: meal.visibility, nestId: meal.nestId ?? null,
            source: "FamiliOS Assistant",
            provenance: { via: "meal", runId: ctx.runId, actorId: ctx.actorId },
          }, ctx));
    }
    // 4) Google push — only when the household pre-authorized it (calendar auto-sync),
    // and never while external actions are paused. The policy ladder cannot see a push
    // made from inside a local Write (this action does not `deliver`), so the kill switch
    // is asked here, as update_event and the retire cascade ask it.
    let google = { pushed: false };
    if (event && getSettings(ctx.householdId).calendarAutoSync === true) {
      if (!googleReachAllowed(ctx.householdId)) google = { pushed: false, error: "external_actions_disabled" };
      else {
        const r = await pushEventToGoogle({ ev: event, householdId: ctx.householdId, actorId: ctx.actorId });
        google = r.ok ? { pushed: true, googleEventId: r.googleEventId, action: r.action } : { pushed: false, error: r.error };
      }
    }
    return {
      ok: true,
      result: {
        id: meal.id, mealId: meal.id, title: meal.title, date: meal.date ?? null, slot: meal.slot, groceryItems,
        eventId: event?.id ?? null, google, ...(scheduleNote ? { note: scheduleNote } : {}),
        meal, ...(event ? { event } : {}),
      },
    };
  },
});
