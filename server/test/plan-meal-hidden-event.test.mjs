/* PLAN_MEAL AND A HIDDEN MEAL EVENT (ADR-005 privacy review, second pass).
 *
 * The assistant's meal planner writes the dish's calendar event and, on replace:true, runs the
 * retire cascade that deletes it. Once the event's owner has hidden it, neither may reach
 * through the hide for anyone else: the meal is planned (or retired) and the hidden event is
 * left exactly as its owner left it — no id, no record handed back to the model.
 *
 * In-process against this process's own store, like action-plan-meal.test.mjs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-plan-meal-hidden-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
const { retireMeal } = await import("../actions/meals.mjs");
const store = await import("../store.mjs");
const { seedDefaults } = await import("../seed.mjs");
seedDefaults();

const plan = (actorId, input) => INTERNAL_FUNCTIONS["homeops.plan_meal"].run({ householdId: "local", actorId, runId: "run_test" }, input);
const SECRET_PLACE = "Chez Rosa, back room";

/** Morgan plans a dish; its event is hers; she hides it and gives it a place. */
async function morgansHiddenDish(title, date) {
  const r = await plan("m-morgan", { title, date, slot: "dinner" });
  assert.equal(r.ok, true, JSON.stringify(r));
  store.patchEvent(r.result.eventId, { shareState: "hidden", location: SECRET_PLACE });
  return { mealId: r.result.mealId, eventId: r.result.eventId, before: store.getEvent(r.result.eventId) };
}

test("re-planning the dish as someone else plans the meal and leaves its hidden event untouched — nothing of it comes back", async () => {
  const { eventId, before } = await morgansHiddenDish("Birthday lasagna", "2031-06-06");
  const r = await plan("m-alex", { title: "Birthday lasagna", date: "2031-06-07", slot: "dinner" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.meal.date, "2031-06-07", "the meal itself moved");
  assert.equal(r.result.eventId, null, "no event id to act on");
  assert.equal("event" in r.result, false, "and no record");
  assert.match(r.result.note ?? "", /hidden by its owner/);
  assert.equal(JSON.stringify(r.result).includes(SECRET_PLACE), false);
  assert.deepEqual(store.getEvent(eventId), before, "the hidden event was not rewritten");
});

test("its owner re-planning it gets the event back as her own screen shows it", async () => {
  const { eventId } = await morgansHiddenDish("Anniversary risotto", "2031-06-12");
  const r = await plan("m-morgan", { title: "Anniversary risotto", date: "2031-06-13", slot: "dinner" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.eventId, eventId);
  assert.equal(r.result.event.privacy?.obscured, true, "presented through event-privacy, not the raw record");
  assert.equal(store.getEvent(eventId).startAt.slice(0, 10), "2031-06-13", "the owner's re-plan did move it");
});

test("replace:true and a delete retire the meal but keep someone else's hidden event", async () => {
  const { mealId, eventId, before } = await morgansHiddenDish("Gift-wrapping supper", "2031-07-01");
  const r = await plan("m-alex", { title: "Pizza", date: "2031-07-01", slot: "dinner", replace: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(store.getMeal(mealId)?.archived, true, "the occupant was retired");
  assert.deepEqual(store.getEvent(eventId), before, "its hidden event survives the replace");

  const second = await morgansHiddenDish("Vacation brunch", "2031-07-09");
  const out = await retireMeal(store.getMeal(second.mealId), { householdId: "local", actorId: "m-alex", role: "Owner" }, { mode: "delete" });
  assert.equal(out.eventsRemoved, 0);
  assert.deepEqual(store.getEvent(second.eventId), second.before, "a delete does not reach through the hide either");
  const own = await morgansHiddenDish("Surprise pancakes", "2031-07-15");
  const mine = await retireMeal(store.getMeal(own.mealId), { householdId: "local", actorId: "m-morgan" }, { mode: "delete" });
  assert.equal(mine.eventsRemoved, 1, "its owner's retire still removes it");
  assert.equal(store.getEvent(own.eventId), null);
});
