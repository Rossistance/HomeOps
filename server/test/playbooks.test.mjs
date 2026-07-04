// PLAYBOOKS — server-owned workflow library (Phase 6): seeded starters, browse for
// every role, Limited Member+ creation, adult-or-creator deletion.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult, child;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");   // Child View
});
after(async () => { await stopServer(ctx); });

test("seeded starter playbooks are listed for every role, steps intact", async () => {
  const list = (await child.req("/api/playbooks")).data.playbooks;
  const school = list.find((p) => p.id === "pb_school_form");
  assert.ok(school, "seeded school-form playbook present");
  assert.ok(school.steps.length >= 4, "playbook has readable end-to-end steps");
  assert.ok(list.some((p) => p.id === "pb_weekly_reset"));
});

test("a child cannot create a playbook; an adult can, and steps are required", async () => {
  const denied = await child.req("/api/playbooks", { method: "POST", body: JSON.stringify({ name: "X", steps: ["a"] }) });
  assert.equal(denied.status, 403);
  const noSteps = await adult.req("/api/playbooks", { method: "POST", body: JSON.stringify({ name: "No steps" }) });
  assert.equal(noSteps.status, 400);
  const ok = await adult.req("/api/playbooks", { method: "POST", body: JSON.stringify({ name: "Trash night", category: "Routines", steps: ["Roll bins out Monday night", "Roll bins back Tuesday"] }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.playbook.steps.length, 2);
  // Round-trips through GET.
  const list = (await adult.req("/api/playbooks")).data.playbooks;
  assert.ok(list.some((p) => p.id === ok.data.playbook.id));
});

test("a child cannot delete a playbook; an adult can", async () => {
  const pb = (await adult.req("/api/playbooks", { method: "POST", body: JSON.stringify({ name: "Temp", steps: ["x"] }) })).data.playbook;
  const denied = await child.req(`/api/playbooks/${pb.id}`, { method: "DELETE" });
  assert.equal(denied.status, 403);
  const ok = await adult.req(`/api/playbooks/${pb.id}`, { method: "DELETE" });
  assert.equal(ok.status, 200);
});
