/* WHAT A TOOL REFUSES, IT REFUSES OUT LOUD.
 *
 * The App QA helper (2026-09-22) ran three passes against the assistant's own tools and
 * came back with one finding repeated six ways: invalid input was accepted and stored
 * silently. A participant id that belongs to nobody. A driver who does not exist. Priority
 * "urgent". Meal slot "brunch", saved as dinner. servings: 0, saved as null. An end time
 * before the start, dropped to null. Every one returned ok:true, and the assistant told the
 * family the thing was done as asked.
 *
 * The roster is the only source of member ids; the app's own menus are the only source of
 * priorities and slots. An input that is not on them is refused with a reason the model can
 * act on — never turned into something else, never stored as a ghost.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-tool-validation-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
const { seedDefaults } = await import("../seed.mjs");
const store = await import("../store.mjs");
seedDefaults();

const ctx = { householdId: "local", actorId: "m-alex", runId: "run_test" };
const run = (id, input) => INTERNAL_FUNCTIONS[id].run(ctx, input);

/* ---------------------------------- tasks ---------------------------------- */

test("create_task: a priority the app does not have is refused, not stored", async () => {
  const bad = await run("homeops.create_task", { title: "Urgent thing", priority: "urgent" });
  assert.equal(bad.ok, false);
  // The action's schema declares priority as an enum, so the SHAPE gate refuses it first
  // and names the field — same refusal, earlier, and the model sees the enum up front.
  assert.equal(bad.error, "invalid_input");
  assert.equal(bad.field, "priority");
  const ok = await run("homeops.create_task", { title: "High thing", priority: "high" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(store.getTask(ok.result.task.id).priority, "high");
});

test("create_task: a made-up assignee is refused, and the refusal names the id", async () => {
  const bad = await run("homeops.create_task", { title: "For nobody", assignedMemberId: "m-ghost" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "unknown_member");
  assert.match(bad.message, /m-ghost/, "the model is told which id was wrong");
  const ok = await run("homeops.create_task", { title: "For Lily", assignedMemberId: "m-lily" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(store.getTask(ok.result.task.id).assignedMemberId, "m-lily");
});

test("an ARCHIVED member is not a valid assignee either — the roster means the live roster", async () => {
  store.putMember({ actorId: "m-moved-out", householdId: "local", displayName: "Moved Out", role: "Adult Member", relationship: "Relative", archived: true });
  const r = await run("homeops.create_task", { title: "For someone gone", assignedMemberId: "m-moved-out" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "unknown_member");
});

/* ---------------------------------- events --------------------------------- */

test("create_event_draft: every participant and the driver must be on the roster", async () => {
  const p = await run("homeops.create_event_draft", { title: "Recital", participantIds: ["m-lily", "m-ghost"] });
  assert.equal(p.ok, false);
  assert.equal(p.error, "unknown_member");
  assert.match(p.message, /m-ghost/, "the one bad id is named, not the whole list");

  const d = await run("homeops.create_event_draft", { title: "Recital", participantIds: ["m-lily"], driverId: "m-nobody" });
  assert.equal(d.ok, false);
  assert.equal(d.error, "unknown_member");
  assert.match(d.message, /m-nobody/);

  const ok = await run("homeops.create_event_draft", { title: "Recital", participantIds: ["m-lily"], driverId: "m-morgan" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const ev = store.getEvent(ok.result.event.id);
  assert.deepEqual(ev.participantIds, ["m-lily"]);
  assert.equal(ev.driverId, "m-morgan");
});

test("create_event_draft: an end BEFORE the start is an error, not a silent null", async () => {
  const bad = await run("homeops.create_event_draft", { title: "Backwards", startAt: "2031-05-01T15:00:00Z", endAt: "2031-05-01T14:00:00Z" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "end_before_start");

  // Equal is still "no end" — a same-day all-day event arrives with end == start.
  const same = await run("homeops.create_event_draft", { title: "Same day", startAt: "2031-05-01", endAt: "2031-05-01" });
  assert.equal(same.ok, true, JSON.stringify(same));
  assert.equal(store.getEvent(same.result.event.id).endAt, null);

  const ok = await run("homeops.create_event_draft", { title: "Forwards", startAt: "2031-05-01T15:00:00Z", endAt: "2031-05-01T16:00:00Z" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(store.getEvent(ok.result.event.id).endAt, "2031-05-01T16:00:00Z", "a real end is kept");
});

/* ---------------------------------- meals ---------------------------------- */

test("plan_meal: an unknown slot is refused rather than quietly becoming dinner", async () => {
  const bad = await run("homeops.plan_meal", { title: "QA Brunch", date: "2031-05-03", slot: "brunch", ingredients: ["eggs"] });
  assert.equal(bad.ok, false);
  // plan_meal is declared now (ADR-004): slot is an enum in its schema, so the SHAPE gate
  // refuses "brunch" first and names the field — the create_task precedent above.
  assert.equal(bad.error, "invalid_input");
  assert.equal(bad.field, "slot");
  assert.ok(!store.listMeals((m) => m.title === "QA Brunch").length, "nothing was planned");

  const ok = await run("homeops.plan_meal", { title: "QA Lunch", date: "2031-05-03", slot: "lunch", ingredients: ["bread"] });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.result.slot, "lunch");
});

test("plan_meal: zero (or nonsense) servings is an error, not null", async () => {
  const zero = await run("homeops.plan_meal", { title: "QA Nobody eats", date: "2031-05-04", slot: "dinner", servings: 0, ingredients: ["rice"] });
  assert.equal(zero.ok, false);
  assert.equal(zero.error, "bad_servings");
  const words = await run("homeops.plan_meal", { title: "QA Nobody eats", date: "2031-05-04", slot: "dinner", servings: "lots", ingredients: ["rice"] });
  assert.equal(words.ok, false);
  assert.equal(words.error, "bad_servings");

  const ok = await run("homeops.plan_meal", { title: "QA Four eat", date: "2031-05-04", slot: "dinner", servings: 4, ingredients: ["rice"] });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(store.listMeals((m) => m.title === "QA Four eat")[0]?.servings, 4);
});

test("a tool that is given nothing to validate still works exactly as before", async () => {
  // No priority, no assignee, no slot, no servings: the defaults the app has always applied.
  const t = await run("homeops.create_task", { title: "Plain task" });
  assert.equal(t.ok, true);
  assert.equal(store.getTask(t.result.task.id).priority, "medium");
  const m = await run("homeops.plan_meal", { title: "QA Plain meal", date: "2031-05-05", ingredients: ["salt"] });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.equal(m.result.slot, "dinner");
});
