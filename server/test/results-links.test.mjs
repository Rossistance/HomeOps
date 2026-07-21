// FamiliOS — WP-004 (ISS-008, FEAT-019/005): "Done" always links to the thing.
//
// Extends the assistant-runs.test.mjs pattern (real server via harness.mjs, real
// conversation, real run) to prove the run_result message carries a `links[]` entry
// for every succeeded step that created a task, list item, or artifact — derived from
// the tool's own recorded result shape, never guessed from text. Also covers the
// buildResultLinks() pure function directly for edge cases (missing id, failed step,
// unlinked tool) the same way summarize-outcome.test.mjs covers summarizeOutcome().
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { startServer, stopServer, makeSession } from "./harness.mjs";

// buildResultLinks/summarizeOutcome are pure functions over a plain run object, but
// importing assistant-runs.mjs transitively pulls in ./store.mjs, which refuses to
// open the live server/.data from a test process unless HOMEOPS_DATA_DIR already
// points at an isolated temp dir (harness.mjs does this too, for the spawned server).
if (!process.env.HOMEOPS_DATA_DIR) {
  process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-test-proc-"));
}
const { buildResultLinks } = await import("../assistant-runs.mjs");

function run(steps) {
  return { title: "TG-test run", status: "completed", steps };
}

/* -------------------------- pure function: edge cases -------------------------- */

test("buildResultLinks: create_task success links as kind:task, label 'View task'", () => {
  const links = buildResultLinks(run([
    { index: 0, toolId: "homeops.create_task", status: "succeeded", result: { id: "tk_1", title: "Pack bags", type: "task" } },
  ]));
  assert.deepEqual(links, [{ kind: "task", id: "tk_1", label: "View task" }]);
});

test("buildResultLinks: create_list_item success links as kind:task, label 'View list item'", () => {
  const links = buildResultLinks(run([
    { index: 0, toolId: "homeops.create_list_item", status: "succeeded", result: { id: "li_1", title: "Buy wood screws", listName: "Weekend" } },
  ]));
  assert.deepEqual(links, [{ kind: "task", id: "li_1", label: "View list item" }]);
});

test("buildResultLinks: send_notification_draft success links as kind:artifact, label 'Review draft'", () => {
  const links = buildResultLinks(run([
    { index: 0, toolId: "homeops.send_notification_draft", status: "succeeded", result: { id: "art_1", draft: true, to: "coach@example.com" } },
  ]));
  assert.deepEqual(links, [{ kind: "artifact", id: "art_1", label: "Review draft" }]);
});

test("buildResultLinks: create_artifact success links as kind:artifact, label 'View artifact'", () => {
  const links = buildResultLinks(run([
    { index: 0, toolId: "homeops.create_artifact", status: "succeeded", result: { id: "art_2", title: "Morning Family Briefing", kind: "briefing" } },
  ]));
  assert.deepEqual(links, [{ kind: "artifact", id: "art_2", label: "View artifact" }]);
});

test("buildResultLinks: a FAILED step never gets a link, even for a linkable tool", () => {
  const links = buildResultLinks(run([
    { index: 0, toolId: "homeops.create_task", status: "failed", detail: "boom" },
  ]));
  assert.deepEqual(links, []);
});

test("buildResultLinks: a succeeded step with no result.id never gets a link (no guessing)", () => {
  const links = buildResultLinks(run([
    { index: 0, toolId: "homeops.create_task", status: "succeeded", result: { title: "no id here" } },
  ]));
  assert.deepEqual(links, []);
});

test("buildResultLinks: unlinked tools (e.g. write_memory) are ignored", () => {
  const links = buildResultLinks(run([
    { index: 0, toolId: "homeops.write_memory", status: "succeeded", result: { id: "mem_1" } },
  ]));
  assert.deepEqual(links, []);
});

test("buildResultLinks: a toolless (reasoning-only) step is ignored", () => {
  const links = buildResultLinks(run([
    { index: 0, toolId: null, status: "succeeded", result: { text: "Composed the briefing." } },
  ]));
  assert.deepEqual(links, []);
});

test("buildResultLinks: multi-step run collects one link per linkable success, in step order", () => {
  const links = buildResultLinks(run([
    { index: 0, toolId: "homeops.create_task", status: "succeeded", result: { id: "tk_2" } },
    { index: 1, toolId: "homeops.write_memory", status: "succeeded", result: { id: "mem_2" } },
    { index: 2, toolId: "homeops.send_notification_draft", status: "succeeded", result: { id: "art_3", draft: true } },
  ]));
  assert.deepEqual(links, [
    { kind: "task", id: "tk_2", label: "View task" },
    { kind: "artifact", id: "art_3", label: "Review draft" },
  ]);
});

test("buildResultLinks: no steps at all returns an empty array, not a crash", () => {
  assert.deepEqual(buildResultLinks({ title: "empty", status: "completed", steps: [] }), []);
  assert.deepEqual(buildResultLinks({ title: "no steps field", status: "completed" }), []);
});

/* --------------------- integration: real server, real run --------------------- */

let ctx, owner;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
});
after(async () => { await stopServer(ctx); });

async function newConversation(title) {
  const r = await owner.req("/api/conversations", { method: "POST", body: JSON.stringify({ title }) });
  return r.data.conversation;
}
async function messagesOf(id) {
  const r = await owner.req(`/api/conversations/${id}`);
  return r.data.conversation?.messages ?? [];
}
const waitFor = async (fn, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 150));
  }
};

test("a run that creates an undated task carries a task link on the run_result message", async () => {
  const conv = await newConversation("TG-task link thread");
  const plan = { title: "TG-Add a chore", summary: "", steps: [{ toolId: "homeops.create_task", title: "Create the task", input: { title: "TG-Take out recycling" } }] };
  const started = await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "assistant", sourceRef: { conversationId: conv.id, via: "chat" }, plan }) });
  assert.equal(started.status, 200);
  const result = await waitFor(async () => (await messagesOf(conv.id)).find((m) => m.kind === "run_result"));
  assert.equal(result.status, "completed");
  // The run_result hook fires after the run's steps are recorded, so by now the
  // engine's own step result is the source of truth for the id the link must carry.
  const finished = await owner.req(`/api/runs/${result.runId}`);
  const taskId = finished.data.run.steps[0]?.result?.id;
  assert.ok(taskId, "the run must have actually recorded a created task id");
  assert.ok(Array.isArray(result.links), "links[] must be present on the message");
  assert.deepEqual(result.links, [{ kind: "task", id: taskId, label: "View task" }]);
});

test("a run with create_task + send_notification_draft carries both links, and WP-002 artifactId/link stay intact", async () => {
  const conv = await newConversation("TG-mixed links thread");
  const plan = {
    title: "TG-Chore and a draft",
    summary: "",
    steps: [
      { toolId: "homeops.create_task", title: "Create the task", input: { title: "TG-Water the plants" } },
      { toolId: "homeops.send_notification_draft", title: "Draft a note", input: { to: "family@example.com", body: "TG-Reminder about the plants." } },
    ],
  };
  const started = await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "assistant", sourceRef: { conversationId: conv.id, via: "chat" }, plan }) });
  assert.equal(started.status, 200);
  const result = await waitFor(async () => (await messagesOf(conv.id)).find((m) => m.kind === "run_result"));
  const finished = await owner.req(`/api/runs/${result.runId}`);
  const taskId = finished.data.run.steps[0]?.result?.id;
  const artifactId = finished.data.run.steps[1]?.result?.id;
  assert.ok(taskId && artifactId, "both steps must have recorded real ids");
  assert.deepEqual(result.links, [
    { kind: "task", id: taskId, label: "View task" },
    { kind: "artifact", id: artifactId, label: "Review draft" },
  ]);
  // Regression guard: WP-002's own fields (commit b6174e6) must be untouched.
  assert.equal(result.artifactId, artifactId, "WP-002 artifactId linkage must stay intact");
  assert.match(result.link, new RegExp(`runId=${started.data.run.id}$`));
});

test("a run with only non-linkable steps (write_memory) omits links entirely", async () => {
  const conv = await newConversation("TG-no links thread");
  const plan = { title: "TG-Just remember it", summary: "", steps: [{ toolId: "homeops.write_memory", title: "Remember", input: { text: "TG-The dog's vet is Dr. Paws", scope: "household" } }] };
  await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "assistant", sourceRef: { conversationId: conv.id, via: "chat" }, plan }) });
  const result = await waitFor(async () => (await messagesOf(conv.id)).find((m) => m.kind === "run_result"));
  assert.equal(result.status, "completed");
  assert.equal(result.links, undefined, "links must be omitted, not an empty array, when there is nothing to link");
});
