// P1.2 / P4.1 — server-owned events & tasks with role/visibility filtering.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, child;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
  child = await makeSession(ctx, "m-noah");
});
after(async () => { await stopServer(ctx); });

test("a child cannot create an event (below Limited Member)", async () => {
  const r = await child.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Sneaky party" }) });
  assert.equal(r.status, 403);
});

test("household events are visible to children; adults-only events are not", async () => {
  await owner.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Family dinner", visibility: "household" }) });
  await owner.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Mortgage refi call", visibility: "adults" }) });
  const childEvents = (await child.req("/api/events")).data.events;
  const titles = childEvents.map((e) => e.title);
  assert.ok(titles.includes("Family dinner"), "child sees the shared family event");
  assert.ok(!titles.includes("Mortgage refi call"), "child must NOT see the adults-only event");
});

test("a child sees a private event they are a participant in", async () => {
  const ev = (await owner.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Lily birthday surprise", visibility: "private", participantIds: ["m-noah"] }) })).data.event;
  const childEvents = (await child.req("/api/events")).data.events;
  assert.ok(childEvents.some((e) => e.id === ev.id), "participant sees their private event");
});

test("rich event model fields round-trip", async () => {
  const ev = (await owner.req("/api/events", { method: "POST", body: JSON.stringify({
    title: "Soccer game", location: "Field 3", participantIds: ["m-noah"], driverId: "m-morgan",
    whatToBring: [{ item: "Cleats", memberId: "m-noah" }], visibility: "household",
  }) })).data.event;
  assert.equal(ev.driverId, "m-morgan");
  assert.equal(ev.whatToBring[0].item, "Cleats");
  assert.equal(ev.layer, "canonical");
  assert.equal(ev.provenance.via, "user");
});

test("a child can complete a task assigned to them, but not rename it", async () => {
  const tk = (await owner.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Feed the dog", assignedMemberId: "m-noah", visibility: "household" }) })).data.task;
  const childTasks = (await child.req("/api/tasks")).data.tasks;
  assert.ok(childTasks.some((t) => t.id === tk.id), "child sees their assigned task");
  const complete = await child.req(`/api/tasks/${tk.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
  assert.equal(complete.status, 200);
  assert.equal(complete.data.task.status, "done");
  const rename = await child.req(`/api/tasks/${tk.id}`, { method: "PATCH", body: JSON.stringify({ title: "hacked" }) });
  assert.equal(rename.status, 403, "child cannot rename a task");
});

test("conversations are private to their owner", async () => {
  const c = (await owner.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Plan the week" }) })).data.conversation;
  const childList = (await child.req("/api/conversations")).data.conversations;
  assert.ok(!childList.some((x) => x.id === c.id), "child cannot list another actor's conversation");
  const childGet = await child.req(`/api/conversations/${c.id}`);
  assert.equal(childGet.status, 404, "child cannot fetch another actor's conversation");
});
