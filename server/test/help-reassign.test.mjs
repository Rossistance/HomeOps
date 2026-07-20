// WP-001 (ISS-001 P1, ISS-009): accepting a help request with a linked task must
// actually TRANSFER the task, in both directions, and the server must refuse
// duplicate pending asks for the same (taskId, toActorId).
// Isolated harness: real server, temp HOMEOPS_DATA_DIR — never the live store.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, alex, morgan;
before(async () => {
  ctx = await startServer();
  alex = await makeSession(ctx, "m-alex");     // Owner (asker)
  morgan = await makeSession(ctx, "m-morgan"); // Adult Admin (helper)
});
after(async () => { await stopServer(ctx); });

async function createTask(client, title) {
  const r = await client.req("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ title, assignedMemberId: client.actorId }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.task;
}

async function ask(from, toActorId, taskId, message) {
  return from.req("/api/help-requests", {
    method: "POST",
    body: JSON.stringify({ toActorId, taskId, message }),
  });
}

test("accepting an ASK with a linked task reassigns the task to the helper", async () => {
  const task = await createTask(alex, "TG-test clean up guest room");
  const created = await ask(alex, "m-morgan", task.id, "Can you take care of it?");
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const hr = created.data.helpRequest;

  const ok = await morgan.req(`/api/help-requests/${hr.id}/respond`, {
    method: "POST", body: JSON.stringify({ response: "accept" }),
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.helpRequest.status, "accepted");
  // The respond payload reports the transfer so clients can render it truthfully.
  assert.equal(ok.data.reassigned, true, "respond payload carries reassigned:true");
  assert.equal(ok.data.task?.assignedMemberId, "m-morgan", "payload task shows the new owner");

  // Server truth: the task now belongs to the helper.
  const tasks = (await morgan.req("/api/tasks")).data.tasks;
  const mine = tasks.find((t) => t.id === task.id);
  assert.ok(mine, "task visible to helper");
  assert.equal(mine.assignedMemberId, "m-morgan", "task transferred to helper");

  // The asker is notified that the request was accepted.
  const notifs = (await alex.req("/api/notifications")).data.notifications;
  assert.ok(notifs.some((n) => n.title === "Request accepted"), "asker notified");
});

test("accepting an OFFER with a linked task reassigns the task to the offerer", async () => {
  const task = await createTask(alex, "TG-test water the plants");
  // Morgan OFFERS to help with Alex's task; Alex (recipient) accepts.
  const created = await morgan.req("/api/help-requests", {
    method: "POST",
    body: JSON.stringify({ toActorId: "m-alex", kind: "offer", taskId: task.id, message: "I can water the plants" }),
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const hr = created.data.helpRequest;

  const ok = await alex.req(`/api/help-requests/${hr.id}/respond`, {
    method: "POST", body: JSON.stringify({ response: "accept" }),
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.reassigned, true);
  assert.equal(ok.data.task?.assignedMemberId, "m-morgan", "task moves to the OFFERER");

  const tasks = (await alex.req("/api/tasks")).data.tasks;
  assert.equal(tasks.find((t) => t.id === task.id)?.assignedMemberId, "m-morgan");
});

test("declining never reassigns; accept without a linked task reassigns nothing", async () => {
  const task = await createTask(alex, "TG-test rake leaves");
  const declined0 = await ask(alex, "m-morgan", task.id, "Rake?");
  const dr = await morgan.req(`/api/help-requests/${declined0.data.helpRequest.id}/respond`, {
    method: "POST", body: JSON.stringify({ response: "decline" }),
  });
  assert.equal(dr.status, 200);
  assert.equal(dr.data.reassigned ?? false, false, "decline does not reassign");
  const afterDecline = (await alex.req("/api/tasks")).data.tasks.find((t) => t.id === task.id);
  assert.equal(afterDecline.assignedMemberId, "m-alex", "task untouched on decline");

  // No linked task: respond keeps working, no reassignment claimed.
  const noTask = await ask(alex, "m-morgan", null, "General moral support?");
  const ok = await morgan.req(`/api/help-requests/${noTask.data.helpRequest.id}/respond`, {
    method: "POST", body: JSON.stringify({ response: "accept" }),
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.reassigned ?? false, false);
});

test("accept survives the linked task being deleted (no crash, honest reassigned:false)", async () => {
  const task = await createTask(alex, "TG-test doomed task");
  const created = await ask(alex, "m-morgan", task.id, "Handle the doomed task?");
  const del = await alex.req(`/api/tasks/${task.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  const ok = await morgan.req(`/api/help-requests/${created.data.helpRequest.id}/respond`, {
    method: "POST", body: JSON.stringify({ response: "accept" }),
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.helpRequest.status, "accepted");
  assert.equal(ok.data.reassigned ?? false, false, "cannot reassign a deleted task");
});

test("duplicate pending ask for the same (taskId, recipient) is refused with 409 + existing record", async () => {
  const task = await createTask(alex, "TG-test dedupe task");
  const first = await ask(alex, "m-morgan", task.id, "Can you?");
  assert.equal(first.status, 200);
  const dup = await ask(alex, "m-morgan", task.id, "Can you? (again)");
  assert.equal(dup.status, 409, JSON.stringify(dup.data));
  assert.equal(dup.data.error, "duplicate_request");
  assert.equal(dup.data.helpRequest?.id, first.data.helpRequest.id, "409 returns the existing pending request");

  // A different recipient for the same task is fine (not a duplicate).
  const other = await ask(alex, "m-noah", task.id, "Or you?");
  assert.equal(other.status, 200, JSON.stringify(other.data));

  // After the pending one resolves, a new ask to the same person is allowed again.
  await morgan.req(`/api/help-requests/${first.data.helpRequest.id}/respond`, {
    method: "POST", body: JSON.stringify({ response: "decline" }),
  });
  const again = await ask(alex, "m-morgan", task.id, "Round two?");
  assert.equal(again.status, 200, JSON.stringify(again.data));
});
