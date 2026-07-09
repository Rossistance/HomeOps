// MEAL PLAN → CALENDAR → GOOGLE SYNC — the "plan my week" build:
//   * meals carry extracted step-by-step instructions,
//   * meal → calendar composes the FULL event body (recipe URL + ingredients +
//     instructions) into `notes`, which is what Google receives as description,
//   * events accept a `notes` body and PATCH round-trips it,
//   * calendarAutoSync is an Adult Admin setting; when ON the Google push route
//     skips the approval gate (it fails honestly on the missing account instead
//     of parking an approval),
//   * mergeGoogleEdit treats Google `description` edits as merge-able changes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { mergeGoogleEdit, mealEventNotes } from "../calendar.mjs";

let ctx, adult, child;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");   // Child View
});
after(async () => { await stopServer(ctx); });

test("meals persist step-by-step instructions", async () => {
  const r = await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Chili night", instructions: ["Brown the beef.", " Simmer 30 min. ", ""], ingredients: ["beef", "beans"] }) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.meal.instructions, ["Brown the beef.", "Simmer 30 min."]);
});

test("meal → calendar composes the full recipe body into the event notes", async () => {
  const meal = (await adult.req("/api/meals", { method: "POST", body: JSON.stringify({
    title: "Sheet-pan fajitas", date: "2026-07-08", slot: "dinner", servings: 4,
    recipeUrl: "https://example.com/fajitas",
    ingredients: ["chicken", "peppers", { item: "tortillas", have: true }],
    instructions: ["Slice everything.", "Roast at 425°F for 20 minutes."],
  }) })).data.meal;
  const r = await adult.req(`/api/meals/${meal.id}/to-calendar`, { method: "POST" });
  assert.equal(r.status, 200);
  const ev = r.data.event;
  assert.equal(ev.title, "Dinner: Sheet-pan fajitas");
  assert.ok(ev.notes.includes("Recipe: https://example.com/fajitas"), "notes carry the source URL");
  assert.ok(ev.notes.includes("• chicken"), "notes carry the ingredient list");
  assert.ok(ev.notes.includes("2. Roast at 425°F for 20 minutes."), "notes carry numbered instructions");
  assert.ok(ev.notes.includes("Linked in FamiliOS"), "notes point back to the mini apps");
});

test("events accept and round-trip a notes body via PATCH", async () => {
  const created = await adult.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Team dinner", startAt: "2026-07-09T18:00:00", notes: "Bring the good hot sauce." }) });
  assert.equal(created.status, 200);
  assert.equal(created.data.event.notes, "Bring the good hot sauce.");
  const patched = await adult.req(`/api/events/${created.data.event.id}`, { method: "PATCH", body: JSON.stringify({ notes: "Updated context + https://example.com/menu" }) });
  assert.equal(patched.data.event.notes, "Updated context + https://example.com/menu");
});

test("calendarAutoSync: Adult Admin only; when ON the push route skips the approval gate", async () => {
  // Child can't flip household settings.
  const denied = await child.req("/api/settings", { method: "POST", body: JSON.stringify({ calendarAutoSync: true }) });
  assert.equal(denied.status, 403);
  // Admin turns it on; the setting round-trips.
  const set = await adult.req("/api/settings", { method: "POST", body: JSON.stringify({ calendarAutoSync: true }) });
  assert.equal(set.status, 200);
  assert.equal(set.data.settings.calendarAutoSync, true);
  assert.equal((await adult.req("/api/settings")).data.settings.calendarAutoSync, true);
  // With auto-sync ON, pushing an event does NOT park an approval — it goes straight
  // to execution and fails honestly on the missing Google account.
  const ev = (await adult.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Push me", startAt: "2026-07-10T18:00:00" }) })).data.event;
  const push = await adult.req(`/api/calendar/push/${ev.id}`, { method: "POST", body: JSON.stringify({}) });
  assert.equal(push.status, 422);
  assert.equal(push.data.error, "connect_google_first");
  assert.ok(!push.data.needsApproval, "no approval parked when auto-sync pre-authorizes pushes");
  // OFF again → the approval-first gate is back (account check still comes first,
  // so flip the setting and confirm it stuck; gating order is covered by merge-back tests).
  const off = await adult.req("/api/settings", { method: "POST", body: JSON.stringify({ calendarAutoSync: false }) });
  assert.equal(off.data.settings.calendarAutoSync, false);
});

test("pure: mealEventNotes composes URL, servings, ingredients, instructions", () => {
  const notes = mealEventNotes({ title: "X", recipeUrl: "https://r.example/x", servings: 2, ingredients: [{ item: "rice" }, "beans"], instructions: ["Cook rice."] });
  assert.ok(notes.startsWith("Recipe: https://r.example/x"));
  assert.ok(notes.includes("Servings: 2"));
  assert.ok(notes.includes("• rice"));
  assert.ok(notes.includes("• beans"));
  assert.ok(notes.includes("1. Cook rice."));
});

test("pure: a Google description edit merges back into notes (two-way body sync)", () => {
  const baseline = Date.parse("2026-07-01T12:00:00Z");
  const ev = { title: "Dinner: Chili", startAt: "2026-07-08T18:00:00", endAt: null, location: "", notes: "Recipe: https://r.example/chili", updatedAt: "2026-07-01T12:00:01.000Z", provenance: { googleEventId: "g1", pushedAt: baseline } };
  const gev = { summary: "Dinner: Chili", start: { dateTime: "2026-07-08T18:00:00" }, end: {}, location: "", description: "Recipe: https://r.example/chili\nNote from Google: double the beans", updated: "2026-07-02T09:00:00.000Z" };
  const d = mergeGoogleEdit({ ev, gev });
  assert.equal(d.action, "merge");
  assert.ok(d.fields.notes.includes("double the beans"));
});
