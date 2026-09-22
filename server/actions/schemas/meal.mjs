// The meal RECORD — what the store holds and what GET /api/meals returns.
//
// Two writers — POST /api/meals and homeops.plan_meal — and, unusually, the two clients
// already agreed with each other about the shape. What they agreed on is kept: `time`,
// `instructions`, `servings` and `recipeUrl` arrived in later phases and rows from before
// them exist, so those stay optional; everything both writers have always set is required.
import { eid, nowISO } from "../shared.mjs";
import { validateInput } from "../define-action.mjs";

const str = { type: "string" };
const strOrNull = { type: ["string", "null"] };
const bool = { type: "boolean" };

export const MEAL_SLOTS = Object.freeze(["breakfast", "lunch", "dinner", "snack"]);

export const MEAL_RECORD = {
  type: "object",
  properties: {
    id: { ...str, description: "Starts with meal_." },
    householdId: str,
    title: str,
    date: { ...strOrNull, description: "YYYY-MM-DD, or null for an unplanned dish." },
    slot: { type: "string", enum: [...MEAL_SLOTS] },
    time: { ...strOrNull, description: "HH:MM on the household's clock; the slot's default applies when null." },
    notes: str,
    ingredients: { type: "array", items: { type: "object", properties: { item: str, have: bool }, required: ["item", "have"], additionalProperties: false } },
    instructions: { type: "array", items: str, description: "Step-by-step, one step per entry." },
    servings: { type: ["number", "null"] },
    recipeUrl: str,
    visibility: str,
    nestId: strOrNull,
    archived: { ...bool, description: "Set when plan_meal replaced this dish; the planner hides it." },
    source: str,
    createdBy: str,
    createdAt: { ...str, description: "ISO 8601." },
    updatedAt: { ...str, description: "ISO 8601." },
  },
  required: ["id", "householdId", "title", "date", "slot", "notes", "ingredients", "visibility", "source", "createdBy", "createdAt", "updatedAt"],
  additionalProperties: false,
};

/* ───────────────────────── one writer of the defaults ─────────────────────────
 * Same contract as newEventRecord / newTaskRecord: a writer passes what it knows, this
 * fills the rest, validates with unknown keys rejected, and throws. `source` is required. */
const HELPER_OWNED = Object.freeze(["id", "householdId", "createdBy", "createdAt", "updatedAt", "archived"]);
const KNOWN = new Set(Object.keys(MEAL_RECORD.properties));

export function newMealRecord(fields, ctx) {
  if (!ctx?.householdId || !ctx?.actorId) throw new Error("newMealRecord: ctx needs householdId and actorId");
  if (!fields || typeof fields !== "object") throw new Error("newMealRecord: fields must be an object");
  for (const k of Object.keys(fields)) {
    if (fields[k] === undefined) continue;
    if (HELPER_OWNED.includes(k)) throw new Error(`newMealRecord: "${k}" is decided here, not by the writer`);
    if (!KNOWN.has(k)) throw new Error(`newMealRecord: "${k}" is not a field of MEAL_RECORD — declare it in schemas/meal.mjs or do not write it`);
  }
  if (typeof fields.source !== "string" || !fields.source) throw new Error("newMealRecord: source is required — a meal says how it got here");
  const now = nowISO();
  const rec = {
    id: eid("meal"), householdId: ctx.householdId,
    title: String(fields.title ?? ""), date: fields.date ?? null, slot: fields.slot ?? "dinner", time: fields.time ?? null,
    notes: typeof fields.notes === "string" ? fields.notes : "",
    ingredients: fields.ingredients ?? [], instructions: fields.instructions ?? [],
    servings: fields.servings ?? null, recipeUrl: typeof fields.recipeUrl === "string" ? fields.recipeUrl : "",
    visibility: fields.visibility ?? "household", nestId: fields.nestId ?? null,
    source: fields.source, createdBy: ctx.actorId, createdAt: now, updatedAt: now,
  };
  const v = validateInput(MEAL_RECORD, rec, { unknown: "reject" });
  if (!v.ok) throw new Error(`newMealRecord: ${v.field} — ${v.message}`);
  return v.value;
}
