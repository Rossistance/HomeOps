/* POST /api/tasks IS THE DECLARED ACTION — the wire it keeps, and what it gained.
 *
 * The second surface (ADR-003). Same discipline as action-routes.test.mjs: the first half
 * pins what the hand-written route already did with the exact mobile payload; the second
 * half pins what the route gained by sharing the tool's run — a ghost assignee, a priority
 * the app does not offer, a reminder with nothing to count back from — and what the tool
 * gained from the route, asserted through the registry entry.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult, child;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan");
  child = await makeSession(ctx, "m-lily");
});
after(async () => { await stopServer(ctx); });

/** The exact body apps/mobile createTask() sends. */
const mobileBody = (over = {}) => ({
  title: "Take out recycling", type: "chore", dueAt: "2031-04-01T18:00:00Z", startAt: null, endAt: null,
  assignedMemberId: "m-lily", priority: "medium", visibility: "household", remindOffsets: [15, 1440], ...over,
});
const post = (who, body) => who.req("/api/tasks", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

test("THE MOBILE PAYLOAD STILL CREATES A TASK, in the shape the reminder sweep reads", async () => {
  const r = await post(adult, mobileBody());
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const t = r.data.task;
  assert.ok(t?.id?.startsWith("tk_"));
  assert.equal(t.status, "todo"); assert.equal(t.source, "user"); assert.equal(t.createdBy, "m-morgan");
  assert.deepEqual(t.remindOffsets, [15, 1440]);
  assert.equal(t.remindMinutesBefore, 15, "the legacy single lead is the first of the plan");
  assert.deepEqual(t.remindersSent, []); assert.equal(t.reminderSentAt, null);
  assert.equal("createdByAgentId" in t, false, "a person created it — no helper is credited");
  assert.ok((await adult.req("/api/tasks")).data.tasks.some((x) => x.id === t.id));
});

test("the role floor, the JSON gate, a bad lead and an unknown nest refuse with the same codes", async () => {
  const c = await post(child, mobileBody()); assert.equal(c.status, 403); assert.equal(c.data.error, "insufficient_role");
  const m = await post(adult, "{nope"); assert.equal(m.status, 400); assert.equal(m.data.error, "malformed_json");
  const lead = await post(adult, mobileBody({ remindOffsets: [7] })); assert.equal(lead.status, 400); assert.equal(lead.data.error, "bad_reminder");
  const nest = await post(adult, mobileBody({ visibility: "nest", nestId: "nest_nope" })); assert.equal(nest.status, 403); assert.equal(nest.data.error, "not_in_nest");
  const stamp = await post(adult, mobileBody({ dueAt: "someday" })); assert.equal(stamp.status, 400); assert.equal(stamp.data.error, "invalid_dueAt");
  const blank = await post(adult, mobileBody({ title: " " })); assert.equal(blank.status, 400); assert.equal(blank.data.error, "empty_title");
});

test("a list item through the same door: type list + listName, none of the task-only fields", async () => {
  const r = await post(adult, { title: "Milk", type: "list", listName: "Groceries" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.task.listName, "Groceries");
  assert.equal(r.data.task.dueAt, null);
});

/* ───────────────── gained by sharing the tool's run ───────────────── */

test("A GHOST ASSIGNEE IS REFUSED, NAMED — the route used to store it", async () => {
  const r = await post(adult, mobileBody({ assignedMemberId: "m-ghost" }));
  assert.equal(r.status, 400); assert.equal(r.data.error, "unknown_member"); assert.match(r.data.message, /m-ghost/);
});

test("a priority the app does not offer is refused with the field named — the route used to store 'urgent'", async () => {
  const r = await post(adult, mobileBody({ priority: "urgent" }));
  assert.equal(r.status, 400); assert.equal(r.data.error, "invalid_input"); assert.equal(r.data.field, "priority");
});

test("A REMINDER BEFORE A DATE IS STORED ARMED — the tool used to refuse it; the route (and the sheet) were right", async () => {
  /* The task sheet lets a person pick the nudge before the day, sending remindOffsets
   * with startAt:null; the sweep only counts back once there is a time. The tool had a
   * private "reminder_needs_time" refusal the route never had. Unifying strictly meant
   * picking ONE rule, and the product's is the one the family already lives with. */
  const r = await post(adult, mobileBody({ dueAt: null, startAt: null, remindOffsets: [15] }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.task.remindOffsets, [15]);
  assert.equal(r.data.task.dueAt, null);
  const dated = await adult.req(`/api/tasks/${r.data.task.id}`, { method: "PATCH", body: JSON.stringify({ startAt: "2031-04-01T09:00:00Z" }) });
  assert.equal(dated.status, 200);
  assert.deepEqual(dated.data.task.remindOffsets, [15], "and once dated the nudge is still there to fire");
});

test("the route cannot be re-declared by hand", async () => {
  const src = await fs.promises.readFile(new URL("../index.mjs", import.meta.url), "utf8");
  assert.equal(src.includes('path === "/api/tasks" && method === "POST"'), false);
});
