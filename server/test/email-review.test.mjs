// Item 3 — interactive email review. GET /api/runs/:id/email-review correlates a run's
// gmail.search results (subject/from per message) with its gmail.modifyLabels steps
// (what was added/removed to which ids), producing the per-message list the chat renders
// with revert/relabel actions. A live Google account isn't available in this env, so we
// inject a completed run fixture (the store reads runs.json fresh) and assert the pure
// correlation — the network half is the already-tested gmail.modifyLabels tool.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult, other, hh;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan");
  other = await makeSession(ctx, "m-alex");
  hh = adult.raw.session.householdId;

  const run = {
    id: "run_review_fixture", householdId: hh, actorId: "m-morgan", source: "manual",
    title: "Scan & label promos", summary: "", status: "completed", cursor: 3, error: null,
    createdAt: Date.now(), updatedAt: Date.now(), startedAt: Date.now(), finishedAt: Date.now(),
    steps: [
      { index: 0, toolId: "gmail.search", status: "succeeded", input: { query: "is:unread newer_than:14d" },
        result: { count: 2, messages: [
          { id: "m1", subject: "50% OFF everything!", from: "Deals <deals@shop.com>", snippet: "Big sale", labelIds: ["INBOX", "UNREAD", "CATEGORY_PROMOTIONS"] },
          { id: "m2", subject: "Your weekly digest", from: "News <news@site.com>", snippet: "This week", labelIds: ["INBOX", "UNREAD"] },
        ] } },
      { index: 1, toolId: null, status: "succeeded", result: { text: "Both look promotional.", data: { ids: ["m1", "m2"] } } },
      { index: 2, toolId: "gmail.modifyLabels", status: "succeeded",
        input: { messageIds: "m1,m2", addLabels: "Social", removeLabels: "UNREAD" },
        result: { modified: 2, added: ["Social"], removed: ["UNREAD"], createdLabels: ["Social"] } },
    ],
  };
  // Also seed a listLabels-style label set by piggybacking on the search step is not
  // enough; the endpoint reads labels from a gmail.listLabels step, so add one.
  run.steps.push({ index: 3, toolId: "gmail.listLabels", status: "succeeded", input: {}, result: { count: 2, labels: [{ id: "Label_1", name: "Social", type: "user" }, { id: "Label_2", name: "Receipts", type: "user" }] } });

  const foreign = { ...run, id: "run_foreign", householdId: "some-other-household" };
  const { writeStoreDoc } = await import("./harness.mjs");
  writeStoreDoc(ctx, "runs.json", { [run.id]: run, [foreign.id]: foreign });
});
after(async () => { await stopServer(ctx); });

test("email-review correlates search metadata with applied label changes per message", async () => {
  const r = await adult.req("/api/runs/run_review_fixture/email-review");
  assert.equal(r.status, 200);
  assert.equal(r.data.touchedGmail, true);
  assert.equal(r.data.messages.length, 2);
  const m1 = r.data.messages.find((m) => m.id === "m1");
  assert.equal(m1.subject, "50% OFF everything!");
  assert.equal(m1.from, "Deals <deals@shop.com>");
  assert.deepEqual(m1.added, ["Social"]);
  assert.deepEqual(m1.removed, ["UNREAD"]);
  // Available labels surface so the relabel dropdown has real options.
  assert.ok(r.data.labels.some((l) => l.name === "Receipts"));
});

test("a run that never touched Gmail returns touchedGmail:false", async () => {
  const plain = await adult.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "manual", plan: { title: "No gmail", steps: [{ toolId: "homeops.write_memory", title: "note", input: { text: "x", scope: "household" } }] } }) });
  const r = await adult.req(`/api/runs/${plain.data.run.id}/email-review`);
  assert.equal(r.status, 200);
  assert.equal(r.data.touchedGmail, false);
  assert.equal(r.data.messages.length, 0);
});

test("another household cannot read this household's run review (404, no leak)", async () => {
  const r = await other.req("/api/runs/run_foreign/email-review");
  assert.equal(r.status, 404);
});
