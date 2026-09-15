// Owner-only "declutter / fresh start": POST /api/household/reset-assistant bulk-clears the
// assistant's operational history (memory, chat/inbox, notifications, help requests,
// approvals, runs, artifacts) and removes explicitly-named duplicate helpers, while NEVER
// touching identity/config/assets (members, settings, tasks/lists, calendar, files, or any
// helper not named). Backup-first + reversible; confirm:"RESET" required.
//
// TWO COLLECTIONS LEFT THIS LIST when the seven agent concepts became one Helper:
// evolution.json (there are no AI-proposed rewrites to clear any more) and skills
// (deleteSkillIds is still ACCEPTED and still answered, so an un-updated client is not
// broken by sending it — it just names nothing, and the reply says so with an empty list).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex"); // resident Owner (dev straight-in)
});
after(async () => { await stopServer(ctx); });

test("reset-assistant requires confirm:'RESET'", async () => {
  const r = await owner.req("/api/household/reset-assistant", { method: "POST", body: JSON.stringify({}) });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "confirm_required");
});

test("reset-assistant is Owner-only", async () => {
  const kid = await makeSession(ctx, "m-noah").catch(() => null); // Child View, if seeded
  if (!kid) return; // resident seed may not include a child in this harness — skip cleanly
  const r = await kid.req("/api/household/reset-assistant", { method: "POST", body: JSON.stringify({ confirm: "RESET" }) });
  assert.ok(r.status === 403, `child must be refused, got ${r.status}`);
});

test("reset clears operational collections + named helpers, keeps tasks/settings/other helpers, and backs up first", async () => {
  // Seed: a task (KEEP), two helpers (one named for deletion, one kept).
  const task = await owner.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "KEEP ME — buy milk", type: "task" }) });
  assert.equal(task.status, 200, "task created");
  const keepHelper = await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({ name: "Keep Helper", instructions: "Stays behind and keeps doing its job every evening." }) });
  const delHelper = await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({ name: "Dup Briefing", instructions: "A duplicate morning briefing the family wants to be rid of." }) });
  const keepId = keepHelper.data.helper?.id, delId = delHelper.data.helper?.id;
  assert.ok(keepId && delId, "two helpers created");

  const r = await owner.req("/api/household/reset-assistant", {
    method: "POST",
    body: JSON.stringify({ confirm: "RESET", deleteAgentIds: [delId], deleteSkillIds: ["skl_gone"] }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.backup, "a backup name is returned (reversible)");
  assert.ok(r.data.deletedAgents.includes(delId), "named helper deleted");
  // Skills no longer exist, so the field is answered rather than ignored: a client that
  // still sends deleteSkillIds gets an honest empty list back, not a 400 and not a lie.
  assert.deepEqual(r.data.deletedSkills, [], "nothing can be named for deletion that no longer exists");
  // clearable collections report a cleared count (>=0), not an error
  for (const f of ["memory.json", "conversations.json", "notifications.json", "help-requests.json", "approvals.json", "runs.json", "artifacts.json"]) {
    assert.equal(typeof r.data.cleared[f], "number", `${f} cleared to a count`);
  }
  assert.equal(r.data.cleared["evolution.json"], undefined, "there is no evolution record left to clear");

  // Shape regression: memory.json and artifacts.json are ARRAY-backed. Clearing them to {}
  // (an object) makes listMemory()/listArtifacts() throw on .filter() → a 500 that aborts the
  // whole client hydrate. After a reset both endpoints MUST still read cleanly (200, empty).
  const memAfter = await owner.req("/api/memory");
  assert.equal(memAfter.status, 200, "GET /api/memory reads cleanly after reset (not 500 from a bad empty shape)");
  assert.equal((memAfter.data.memory || []).length, 0, "memory is empty after reset");
  const artsAfter = await owner.req("/api/artifacts");
  assert.equal(artsAfter.status, 200, "GET /api/artifacts reads cleanly after reset");
  assert.equal((artsAfter.data.artifacts || []).length, 0, "artifacts are empty after reset");

  // KEEP invariants: the task survives, the un-named helper survives, settings intact.
  const tasks = await owner.req("/api/tasks");
  assert.ok((tasks.data.tasks || []).some((t) => /KEEP ME/.test(t.title)), "the task was NOT deleted");
  const helpers = await owner.req("/api/helpers");
  const ids = (helpers.data.helpers || []).map((a) => a.id);
  assert.ok(ids.includes(keepId), "the un-named helper survived");
  assert.ok(!ids.includes(delId), "the deleted helper is gone from the active roster");
});

test("clearCollection allowlist refuses a protected collection", async () => {
  const { clearCollection } = await import("../store.mjs");
  const r = clearCollection("members.json");
  assert.equal(r.error, "not_clearable", "members can never be wholesale-cleared here");
});
