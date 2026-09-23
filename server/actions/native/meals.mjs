// The native meal delete (ADR-004 Stage 1): famili.delete_meal.
//
/* The App QA helper (2026-09-22) left four test meals and a test memory behind and said,
 * truthfully, that it had no way to remove them: the API could, the assistant could not.
 * Anything the assistant can plant it must be able to pull — under the same ownership
 * rules as the API's DELETE routes, writing the same audit rows. */
//
// The body is the one that lived inline in assistant-agent.mjs nativeTools(), moved
// unchanged; the cascade itself (and its kill-switch check) is retireMeal's, in ../meals.mjs.
import { getMeal, isAdultRole, appendAudit } from "../../store.mjs";
import { retireMeal } from "../meals.mjs";
import { defineAction } from "../define-action.mjs";
import { readOnly, nativeScope, always } from "./shared.mjs";

export const familiDeleteMeal = defineAction({
  id: "famili.delete_meal",
  name: "Remove a planned meal",
  description: "Take a meal off the planner — the person who planned it, or any adult. Its calendar event goes with it (and its Google copy, best effort); grocery items it added stay on the list but are no longer linked to it. List meals first to get the id.",
  action: "Write", risk: "Medium", requiresApproval: false, delivers: false, lane: "native", timeoutMs: 60_000, available: always,
  input: { type: "object", properties: { mealId: { type: "string", description: "The meal's id (starts with meal_), from famili__list_meals." } }, required: ["mealId"], additionalProperties: false },
  output: {
    type: "object",
    properties: {
      deleted: { type: "boolean" }, title: { type: "string" },
      eventsRemoved: { type: "number" }, groceryItemsUnlinked: { type: "number" }, google: { type: "string" },
    },
    required: ["deleted", "title", "eventsRemoved", "groceryItemsUnlinked"], additionalProperties: false,
  },
  errorCodes: ["invalid_input", "read_only_profile", "meal_not_found", "forbidden"],
  async run(ctx, input) {
    const { session, hh, canWrite } = nativeScope(ctx);
    if (!canWrite) return readOnly();
    const m = getMeal(String(input?.mealId ?? ""));
    if (!m || m.householdId !== hh || m.archived) return { ok: false, error: "meal_not_found", message: "No such meal — list meals to find the right id." };
    if (!isAdultRole(session.role) && m.createdBy !== session.actorId) return { ok: false, error: "forbidden", message: "Only an adult or the person who planned it can remove this meal." };
    // The meal, its calendar event (and its Google copy, best effort — kept when the
    // household paused external actions) and the unlink of its grocery items — never
    // deleted; a still-wanted item outlives the meal that put it on the list — are the
    // one cascade DELETE /api/meals/:id and plan_meal's replace run too (retireMeal).
    const { eventsRemoved: events, groceryItemsUnlinked: unlinked, google = null } = await retireMeal(m, { householdId: hh, actorId: session.actorId }, { mode: "delete" });
    appendAudit({ type: "meal.delete", mealId: m.id, via: "assistant", events, unlinked, ...(google ? { google } : {}), householdId: hh, actorId: session.actorId });
    return { ok: true, result: { deleted: true, title: m.title, eventsRemoved: events, groceryItemsUnlinked: unlinked, ...(google ? { google } : {}) } };
  },
});
