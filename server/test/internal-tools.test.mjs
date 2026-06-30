// P1.2 — internal HomeOps data tools do real, durable writes (run-engine handlers).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

const DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-itools-"));
process.env.HOMEOPS_DATA_DIR = DATA_DIR;
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";

const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
const store = await import("../store.mjs");
after(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const ctx = { householdId: "local", actorId: "m-alex", runId: "run_test" };
const run = (id, input) => INTERNAL_FUNCTIONS[id].run(ctx, input);

test("create_event_draft writes a durable draft event", async () => {
  const r = await run("homeops.create_event_draft", { title: "Dentist — Lily", participantIds: ["m-lily"], driverId: "m-morgan" });
  assert.equal(r.ok, true);
  assert.equal(r.result.status, "draft");
  const ev = store.getEvent(r.result.id);
  assert.equal(ev.title, "Dentist — Lily");
  assert.equal(ev.driverId, "m-morgan");
  assert.equal(ev.provenance.via, "agent");
});

test("update_event_checklist and assign_what_to_bring mutate the event", async () => {
  const ev = (await run("homeops.create_event_draft", { title: "Camping trip" })).result;
  await run("homeops.update_event_checklist", { eventId: ev.id, items: ["Tent", "Sleeping bags"] });
  await run("homeops.assign_what_to_bring", { eventId: ev.id, items: [{ item: "Marshmallows", memberId: "m-noah" }] });
  const fresh = store.getEvent(ev.id);
  assert.equal(fresh.checklist.length, 2);
  assert.equal(fresh.checklist[0].text, "Tent");
  assert.equal(fresh.whatToBring[0].item, "Marshmallows");
});

test("create_task and create_list_item write durable tasks", async () => {
  const t = await run("homeops.create_task", { title: "Pay water bill", type: "bill", amount: 80 });
  assert.equal(t.ok, true);
  assert.equal(store.getTask(t.result.id).type, "bill");
  const li = await run("homeops.create_list_item", { text: "Milk", listName: "Groceries" });
  assert.equal(store.getTask(li.result.id).listName, "Groceries");
});

test("send_notification_draft produces a draft artifact (never sends)", async () => {
  const r = await run("homeops.send_notification_draft", { to: "coach@example.com", body: "Noah will miss practice.", channel: "email" });
  assert.equal(r.ok, true);
  assert.equal(r.result.draft, true);
  const art = store.listArtifacts({ householdId: "local" }).find((a) => a.id === r.result.id);
  assert.equal(art.kind, "notification-draft");
});

test("empty inputs are rejected (no junk writes)", async () => {
  assert.equal((await run("homeops.create_event_draft", { title: "" })).error, "empty_title");
  assert.equal((await run("homeops.create_task", {})).error, "empty_title");
});
