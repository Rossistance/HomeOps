// SCHEDULING CONSISTENCY — the data-consistency and timezone defects a family actually hits
// day to day, each verified through the real HTTP server (harness.mjs) or the real module:
//   • meal edits keep the calendar event + grocery list in step; replaced meals disappear
//   • deleting/renaming a task follows through to its calendar mirror
//   • deleting a personal memory follows the same rule as reading it (no adult bypass)
//   • write_memory never invents a fourth scope
//   • calendar events carry reminders and the sweep fires them once
//   • Google push payloads are real instants on the household's clock
//   • a repeat "request to attend" does not re-notify the owner
//   • a timezone change re-anchors every scheduled trigger
//   • archiving a member closes their contact methods
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { googleEventTimes, normalizeAllDaySpan, mergeGoogleEdit } from "../calendar.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runTool(session, toolId, input) {
  const start = await session.req("/api/runs/start", {
    method: "POST",
    body: JSON.stringify({ source: "manual", plan: { title: `Test ${toolId}`, steps: [{ toolId, title: toolId, input, requiresApproval: false }] } }),
  });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const runId = start.data.run.id;
  for (let i = 0; i < 60; i++) {
    const r = await session.req(`/api/runs/${runId}`);
    if (["completed", "failed", "partially_failed"].includes(r.data.run.status)) return r.data.run;
    await sleep(50);
  }
  throw new Error("run did not finish");
}

describe("pure: Google push times and all-day spans on the household's clock", () => {
  test("a zoneless meal start becomes a real instant and the end is derived in the same frame", () => {
    const t = googleEventTimes({ startAt: "2026-07-23T18:00:00", endAt: null }, "America/New_York");
    assert.deepEqual(t.start, { dateTime: "2026-07-23T22:00:00.000Z" });
    assert.deepEqual(t.end, { dateTime: "2026-07-23T23:00:00.000Z" });
  });
  test("an all-day span anchors to the household's midnight (Los Angeles), and pushes back as the same dates", () => {
    const ev = normalizeAllDaySpan({ allDay: true, startAt: "2026-07-25", endAt: "2026-07-28" }, "America/Los_Angeles");
    assert.equal(ev.startAt, "2026-07-25T07:00:00.000Z");
    assert.equal(ev.endAt, "2026-07-27T07:00:00.000Z");
    assert.deepEqual(googleEventTimes(ev, "America/Los_Angeles"), { start: { date: "2026-07-25" }, end: { date: "2026-07-28" } });
  });
  test("mergeGoogleEdit reads Google's date form on the given zone", () => {
    const ev = { id: "e", householdId: "hh", title: "Camp", startAt: "2026-07-25T07:00:00.000Z", endAt: null, allDay: true, location: "", notes: "", updatedAt: "2026-07-01T00:00:00.000Z", provenance: { googleEventId: "g", pushedAt: Date.parse("2026-07-10T00:00:00Z"), lastMergeAt: 0 } };
    const gev = { summary: "Camp", start: { date: "2026-07-25" }, end: { date: "2026-07-26" }, location: "", description: "", updated: "2026-07-09T00:00:00Z" };
    assert.equal(mergeGoogleEdit({ ev, gev, tz: "America/Los_Angeles" }).action, "none", "same span in LA — no false diff");
  });
});

describe("meals, tasks and their calendar mirrors", () => {
  let ctx, adult;
  before(async () => { ctx = await startServer(); adult = await makeSession(ctx, "m-morgan"); });
  after(async () => { await stopServer(ctx); });

  test("editing a meal's date moves its calendar event and adds new ingredients to groceries", async () => {
    const meal = (await adult.req("/api/meals", { method: "POST", body: JSON.stringify({ title: "Tacos", date: "2030-09-16", slot: "dinner", ingredients: ["tortillas"] }) })).data.meal;
    const cal = await adult.req(`/api/meals/${meal.id}/to-calendar`, { method: "POST" });
    assert.equal(cal.status, 200);
    const evId = cal.data.event.id;
    assert.match(cal.data.event.startAt, /Z$/, "a real instant, not a zoneless stamp");
    const patched = await adult.req(`/api/meals/${meal.id}`, { method: "PATCH", body: JSON.stringify({ date: "2030-09-18", title: "Chili", ingredients: ["tortillas", "beans"] }) });
    assert.equal(patched.status, 200);
    assert.equal(patched.data.eventSynced, true);
    assert.equal(patched.data.groceriesAdded, 1, "only the NEW ingredient lands on the list");
    const ev = (await adult.req("/api/events")).data.events.find((e) => e.id === evId);
    assert.equal(ev.title, "Dinner: Chili");
    assert.ok(ev.startAt.startsWith("2030-09-1"), "moved");
    assert.notEqual(ev.startAt, cal.data.event.startAt);
    const groceries = (await adult.req("/api/tasks")).data.tasks.filter((t) => t.mealId === meal.id);
    assert.deepEqual(groceries.map((t) => t.title).sort(), ["beans", "tortillas"]);
  });

  test("plan_meal with replace:true retires the old meal everywhere: planner, calendar and groceries", async () => {
    const first = await runTool(adult, "homeops.plan_meal", { title: "Salmon", date: "2030-10-01", slot: "dinner", ingredients: ["salmon", "lemon"] });
    assert.equal(first.status, "completed", JSON.stringify(first.steps?.[0]));
    const second = await runTool(adult, "homeops.plan_meal", { title: "Curry", date: "2030-10-01", slot: "dinner", replace: true, ingredients: ["rice"] });
    assert.equal(second.status, "completed", JSON.stringify(second.steps?.[0]));
    const meals = (await adult.req("/api/meals")).data.meals.filter((m) => m.date === "2030-10-01");
    assert.deepEqual(meals.map((m) => m.title), ["Curry"], "the replaced meal is gone from the planner");
    const events = (await adult.req("/api/events")).data.events.filter((e) => e.category === "Meal" && String(e.startAt).startsWith("2030-10-0"));
    assert.deepEqual(events.map((e) => e.title), ["Dinner: Curry"], "one dinner on the calendar, not two");
    const salmonGroceries = (await adult.req("/api/tasks")).data.tasks.filter((t) => t.title === "salmon");
    assert.ok(salmonGroceries.every((t) => !t.mealId), "the old meal's groceries are unlinked, never orphaned to a hidden meal");
  });

  test("re-planning a meal without a date keeps its date (it used to erase it)", async () => {
    const first = await runTool(adult, "homeops.plan_meal", { title: "Pancakes", date: "2030-11-02", slot: "breakfast", ingredients: ["flour"] });
    assert.equal(first.status, "completed");
    const again = await runTool(adult, "homeops.plan_meal", { title: "pancakes", ingredients: ["flour", "eggs"] });
    assert.equal(again.status, "completed");
    const meal = (await adult.req("/api/meals")).data.meals.find((m) => m.title === "Pancakes");
    assert.equal(meal.date, "2030-11-02");
    assert.equal(meal.slot, "breakfast");
    const events = (await adult.req("/api/events")).data.events.filter((e) => e.mealId === meal.id);
    assert.equal(events.length, 1, "still exactly one linked event");
  });

  test("renaming or deleting a task follows through to its calendar mirror", async () => {
    const tk = (await adult.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Dentist", dueAt: "2030-09-20T15:00:00.000Z" }) })).data.task;
    const cal = await adult.req(`/api/tasks/${tk.id}/to-calendar`, { method: "POST" });
    assert.equal(cal.status, 200);
    const evId = cal.data.event.id;
    await adult.req(`/api/tasks/${tk.id}`, { method: "PATCH", body: JSON.stringify({ title: "Dentist (Noah)", dueAt: "2030-09-21T15:00:00.000Z" }) });
    let ev = (await adult.req("/api/events")).data.events.find((e) => e.id === evId);
    assert.equal(ev.title, "Dentist (Noah)");
    assert.equal(ev.startAt, "2030-09-21T15:00:00.000Z");
    const del = await adult.req(`/api/tasks/${tk.id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.equal(del.data.removedEvents, 1);
    ev = (await adult.req("/api/events")).data.events.find((e) => e.id === evId);
    assert.equal(ev, undefined, "no phantom event left on the calendar");
  });

  test("an assistant-created event refuses an unparseable start and understands a date-only start as all-day", async () => {
    const bad = await runTool(adult, "homeops.create_event_draft", { title: "Movie night", startAt: "tomorrow" });
    assert.equal(bad.status, "failed");
    assert.match(String(bad.steps[0].detail), /valid date/i);
    const ok = await runTool(adult, "homeops.create_event_draft", { title: "Field day", startAt: "2030-05-05" });
    assert.equal(ok.status, "completed");
    assert.equal(ok.steps[0].result.event.allDay, true);
    assert.match(ok.steps[0].result.event.startAt, /^2030-05-05T\d\d:00:00\.000Z$/, "anchored to a real midnight");
  });
});

describe("memory rules", () => {
  let ctx, owner, adult;
  before(async () => { ctx = await startServer(); owner = await makeSession(ctx, "m-alex"); adult = await makeSession(ctx, "m-morgan"); });
  after(async () => { await stopServer(ctx); });

  test("an adult cannot delete another member's PERSONAL memory (DELETE mirrors GET)", async () => {
    const run = await runTool(owner, "homeops.write_memory", { text: "Alex's private note.", scope: "personal" });
    assert.equal(run.status, "completed");
    const id = run.steps[0].result.id;
    assert.ok(!(await adult.req("/api/memory")).data.memory.some((m) => m.id === id), "not readable by another adult");
    const del = await adult.req(`/api/memory/${id}`, { method: "DELETE" });
    assert.equal(del.status, 404, "and therefore not deletable either");
    assert.ok((await owner.req("/api/memory")).data.memory.some((m) => m.id === id), "still there for its author");
    assert.equal((await owner.req(`/api/memory/${id}`, { method: "DELETE" })).status, 200);
  });

  test("write_memory maps the legacy 'family' scope to household and defaults to household", async () => {
    const legacy = await runTool(owner, "homeops.write_memory", { text: "We're vegetarian.", scope: "family" });
    assert.equal(legacy.steps[0].result.scope, "household");
    const bare = await runTool(owner, "homeops.write_memory", { text: "Grandma visits Sundays." });
    assert.equal(bare.steps[0].result.scope, "household");
    const list = (await adult.req("/api/memory")).data.memory;
    assert.ok(list.some((m) => m.text === "We're vegetarian." && m.scope === "household"));
  });
});

describe("events: reminders, repeat asks, nests", () => {
  let ctx, owner, adult;
  before(async () => { ctx = await startServer(); owner = await makeSession(ctx, "m-alex"); adult = await makeSession(ctx, "m-morgan"); });
  after(async () => { await stopServer(ctx); });

  test("an event stores its reminder offsets; moving it re-arms them; a bad offset is refused", async () => {
    const created = await owner.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Pickup", startAt: "2030-09-20T15:00:00.000Z", remindOffsets: [15, 60] }) });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.deepEqual(created.data.event.remindOffsets, [15, 60]);
    assert.deepEqual(created.data.event.remindersSent, []);
    const bad = await owner.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Nope", startAt: "2030-09-20T15:00:00.000Z", remindOffsets: [7] }) });
    assert.equal(bad.status, 400);
    const moved = await owner.req(`/api/events/${created.data.event.id}`, { method: "PATCH", body: JSON.stringify({ startAt: "2030-09-21T15:00:00.000Z" }) });
    assert.equal(moved.status, 200);
    assert.deepEqual(moved.data.event.remindersSent, []);
  });

  test("a second 'request to attend' tap is a duplicate — no second notification for the owner", async () => {
    const ev = (await owner.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Owner's dinner", startAt: "2030-09-22T18:00:00.000Z" }) })).data.event;
    const before1 = (await owner.req("/api/notifications")).data.notifications?.length ?? 0;
    const first = await adult.req(`/api/events/${ev.id}/request-attend`, { method: "POST", body: "{}" });
    assert.equal(first.status, 200);
    assert.notEqual(first.data.duplicate, true);
    const second = await adult.req(`/api/events/${ev.id}/request-attend`, { method: "POST", body: "{}" });
    assert.equal(second.status, 200);
    assert.equal(second.data.duplicate, true);
    const after1 = (await owner.req("/api/notifications")).data.notifications?.length ?? 0;
    assert.equal(after1 - before1, 1, "exactly one notification for two taps");
  });

  test("an event cannot claim a nest the creator isn't in", async () => {
    const r = await adult.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Secret", startAt: "2030-09-23T18:00:00.000Z", visibility: "nest", nestId: "nest_nope" }) });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, "not_in_nest");
  });
});

describe("household clock and roster", () => {
  let ctx, owner;
  before(async () => { ctx = await startServer(); owner = await makeSession(ctx, "m-alex"); });
  after(async () => { await stopServer(ctx); });

  test("changing the household timezone re-anchors a scheduled trigger", async () => {
    const t = await owner.req("/api/triggers", { method: "POST", body: JSON.stringify({ name: "Morning brief", type: "recurring", intervalMs: 86400000, anchor: "07:00", target: { kind: "agent", agentId: "agt_household", goal: "brief" } }) });
    assert.equal(t.status, 200, JSON.stringify(t.data));
    const before1 = t.data.trigger.nextRunAt;
    const s = await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ timezone: "Pacific/Kiritimati" }) });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    const after1 = (await owner.req(`/api/triggers/${t.data.trigger.id}`)).data.trigger;
    assert.notEqual(after1.nextRunAt, before1, "07:00 now means 07:00 on the new clock");
    assert.equal(after1.tzSource, "household");
  });

  test("archiving a member closes their contact methods so nothing keeps reaching them", async () => {
    const cm = await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ memberId: "m-sam", label: "Sam mobile", type: "Phone/Text", value: "+15550001111" }) });
    assert.equal(cm.status, 200, JSON.stringify(cm.data));
    const arch = await owner.req("/api/members/m-sam", { method: "DELETE" });
    assert.equal(arch.status, 200, JSON.stringify(arch.data));
    const list = (await owner.req("/api/contact-methods")).data.contactMethods ?? [];
    const sam = list.find((m) => m.id === cm.data.contactMethod?.id) ?? list.find((m) => m.memberId === "m-sam");
    assert.ok(sam, "the record still exists (history), but…");
    assert.equal(sam.optInStatus, "Opted Out");
    assert.deepEqual(sam.allowedAgentIds ?? [], []);
  });
});
