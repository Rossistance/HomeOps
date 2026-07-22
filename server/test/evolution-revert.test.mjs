// WP-008a (ISS-007/DEC-015/HYP-002) — beforeVersionId recording at apply time, and the
// revert path that uses it. Unit-tests the shared apply helper (server/engine.mjs
// applyEvolutionToTarget) and the revert module (server/evolution-revert.mjs) directly,
// in-process, against an isolated hermetic tenant data dir — the same
// set-HOMEOPS_DATA_DIR-then-dynamic-import pattern server/test/family-safety.test.mjs
// already uses for judgeEvolutionConfidence.
//
// The HTTP surface (POST /api/evolutions/:id/revert, and the human /api/evolution/:id
// /review route calling applyEvolutionToTarget instead of duplicating its two branches)
// is a HANDOFF item for server/index.mjs — owned by another work package this wave and
// not wired into the running server yet — so this suite proves the underlying logic
// directly rather than through the test harness's HTTP routes, per the mission's own
// fallback instruction ("unit the shared helper" when the route isn't reachable).
//
// NEVER touches server/.data/tenants/local: HOMEOPS_DATA_DIR is set to a throwaway
// mkdtemp dir below BEFORE the first import of store.mjs (enforced by store.mjs's own
// ISS-001 guard), so "local" here names a tenant inside that temp dir, not the real one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

const dataDir = fs.mkdtempSync(join(os.tmpdir(), "homeops-wp008a-"));
process.env.HOMEOPS_DATA_DIR = dataDir;
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ } });

const { getSettings, getAgent, getSkill, putEvolution, getEvolution, patchEvolution, readAudit, tenantEngine } = await import("../store.mjs");
const { createAgent, deleteAgent, listAgentVersions } = await import("../agents.mjs");
const { createSkill, listSkillVersions } = await import("../skills.mjs");
const { applyEvolutionToTarget } = await import("../engine.mjs");
const { revertEvolution, resolveEvolutionBefore, canRevertEvolution, listEvolutionArchive } = await import("../evolution-revert.mjs");

let seq = 0;
const nextId = (p) => `${p}_${Date.now()}_${seq++}`;

function seedAppliedAgentEvolution(instructionsBefore, instructionsAfter) {
  const agent = createAgent({ name: "Test Agent", instructions: instructionsBefore }, { householdId: "local" });
  const evoId = nextId("evo");
  putEvolution({
    id: evoId, householdId: "local", kind: "agent", agentId: agent.id, skillId: null,
    runId: "run_x", status: "pending", source: "trace", title: "Improve: test",
    reason: "r", summary: "s", after: instructionsAfter, risk: "Low",
    createdAt: Date.now(), updatedAt: new Date().toISOString(),
  });
  return { agent, evoId };
}

test("applyEvolutionToTarget patches an agent's instructions and stamps beforeVersionId", () => {
  const { agent, evoId } = seedAppliedAgentEvolution("Original instructions.", "New instructions.");
  const r = applyEvolutionToTarget({ id: evoId, kind: "agent", agentId: agent.id, after: "New instructions." });
  assert.equal(r.applied, true);
  assert.equal(r.applyError, null);

  const updated = getAgent(agent.id);
  assert.equal(updated.instructions, "New instructions.");
  assert.equal(updated.version, 2, "partialUpdateAgent bumps the version");

  const evo = getEvolution(evoId);
  assert.equal(evo.beforeVersionId, 1, "beforeVersionId is the version BEFORE the patch");
  assert.equal(evo.applied, true);
});

test("applyEvolutionToTarget patches a skill's planner_guidance and stamps beforeVersionId", () => {
  const skill = createSkill({ name: "Test Skill", planner_guidance: "Original guidance." }, { householdId: "local" });
  const evoId = nextId("evo");
  putEvolution({
    id: evoId, householdId: "local", kind: "skill", skillId: skill.id, agentId: null,
    runId: "run_x", status: "pending", source: "trace", title: "Improve: test",
    reason: "r", summary: "s", after: "New guidance.", risk: "Low",
    createdAt: Date.now(), updatedAt: new Date().toISOString(),
  });
  const r = applyEvolutionToTarget({ id: evoId, kind: "skill", skillId: skill.id, after: "New guidance." });
  assert.equal(r.applied, true);

  const updated = getSkill(skill.id);
  assert.equal(updated.planner_guidance, "New guidance.");
  assert.equal(updated.version, 2);

  const evo = getEvolution(evoId);
  assert.equal(evo.beforeVersionId, 1);
});

test("applyEvolutionToTarget reports not_found for a deleted/unknown target and never patches the evolution", () => {
  const evoId = nextId("evo");
  putEvolution({ id: evoId, householdId: "local", kind: "agent", agentId: "agt_does_not_exist", status: "pending", title: "t", reason: "r", summary: "s", after: "X", createdAt: Date.now(), updatedAt: new Date().toISOString() });
  const r = applyEvolutionToTarget({ id: evoId, kind: "agent", agentId: "agt_does_not_exist", after: "X" });
  assert.equal(r.applied, false);
  assert.equal(r.applyError, "not_found");
  assert.equal(getEvolution(evoId).beforeVersionId, undefined);
});

test("revertEvolution restores the exact prior text, self-snapshots, audits, and marks reverted", () => {
  const { agent, evoId } = seedAppliedAgentEvolution("Original instructions.", "New instructions.");
  applyEvolutionToTarget({ id: evoId, kind: "agent", agentId: agent.id, after: "New instructions." });
  patchEvolution(evoId, { status: "accepted", reviewedAt: Date.now(), reviewedBy: "m-admin" });

  // Diff-view helpers agree the row is revertible before we act.
  assert.equal(resolveEvolutionBefore(getEvolution(evoId)), "Original instructions.");
  assert.equal(canRevertEvolution(getEvolution(evoId)), true);

  const versionsBefore = listAgentVersions(agent.id).length;
  const auditBefore = readAudit(500).length;

  const r = revertEvolution(evoId, { householdId: "local", actorId: "m-reverter" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.restoredToVersion, 1);

  const restored = getAgent(agent.id);
  assert.equal(restored.instructions, "Original instructions.", "restores the EXACT prior text");
  assert.equal(restored.version, 3, "the revert itself is a new version, not a silent overwrite");

  const versionsAfter = listAgentVersions(agent.id).length;
  assert.ok(versionsAfter > versionsBefore, "rollbackAgent self-snapshots the pre-revert (version 2) state");

  const evo = getEvolution(evoId);
  assert.equal(evo.status, "reverted");
  assert.equal(evo.revertedBy, "m-reverter");
  assert.equal(evo.revertedFromVersion, 1);
  assert.ok(typeof evo.revertedAt === "number" && evo.revertedAt > 0);

  const auditAfter = readAudit(500);
  assert.ok(auditAfter.length > auditBefore, "revert is audited");
  const revertEvent = auditAfter.find((a) => a.type === "evolution.revert" && a.id === evoId);
  assert.ok(revertEvent, "an evolution.revert audit row exists");
  assert.equal(revertEvent.targetId, agent.id);

  // Idempotency: reverting again is refused, not silently repeated.
  const again = revertEvolution(evoId, { householdId: "local" });
  assert.equal(again.ok, false);
  assert.equal(again.error, "already_reverted");
});

test("revertEvolution refuses when the target agent was deleted", () => {
  const { agent, evoId } = seedAppliedAgentEvolution("Original.", "New.");
  applyEvolutionToTarget({ id: evoId, kind: "agent", agentId: agent.id, after: "New." });
  patchEvolution(evoId, { status: "accepted" });
  deleteAgent(agent.id);

  const r = revertEvolution(evoId, { householdId: "local" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "target_deleted");
});

test("revertEvolution refuses when no prior version is available", () => {
  // An "accepted" row whose target was never actually run through applyEvolutionToTarget
  // (no snapshot exists at all) — the honest data-inconsistency case, not the happy path.
  const agent = createAgent({ name: "Never Touched", instructions: "Stays as-is." }, { householdId: "local" });
  const evoId = nextId("evo");
  putEvolution({ id: evoId, householdId: "local", kind: "agent", agentId: agent.id, status: "accepted", title: "t", reason: "r", summary: "s", after: "Would-be new text.", createdAt: Date.now(), updatedAt: new Date().toISOString() });
  assert.equal(listAgentVersions(agent.id).length, 0, "precondition: no version history yet");

  const r = revertEvolution(evoId, { householdId: "local" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "no_prior_version");
});

test("revertEvolution refuses a still-pending evolution", () => {
  const { evoId } = seedAppliedAgentEvolution("Original.", "New.");
  const r = revertEvolution(evoId, { householdId: "local" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "not_revertible");
});

test("revertEvolution reports not_found for an unknown id", () => {
  const r = revertEvolution("evo_does_not_exist", { householdId: "local" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "not_found");
});

test("listEvolutionArchive reads archived rows read-only, without ever writing to the archive", () => {
  const archived = {
    evo_archived_1: {
      id: "evo_archived_1", householdId: "local", kind: "agent", status: "accepted",
      title: "Old improvement", reason: "r", summary: "s", createdAt: Date.now(), updatedAt: new Date().toISOString(),
    },
  };
  tenantEngine().putDoc("local", "evolution_archive.json", archived);
  const before = JSON.stringify(tenantEngine().getDoc("local", "evolution_archive.json", null));

  const rows = listEvolutionArchive("local");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "evo_archived_1");

  const after = JSON.stringify(tenantEngine().getDoc("local", "evolution_archive.json", null));
  assert.equal(after, before, "reading the archive never mutates it (IRON RULE: never truncated/deleted)");
});

/* ---- Settings default (scope item 4): fresh household defaults autoApproveImprovements
 * OFF; an existing household's stored value (or lack of the key) is untouched. A distinct,
 * never-before-touched tenant id is used here (rather than "local", which other tests in
 * this file use for agents/skills/evolutions) so this is unambiguously a tenant that has
 * NEVER had settings.json written — the actual definition of "new household" this store
 * fallback keys off. */
test("autoApproveImprovements defaults OFF for a brand-new household", () => {
  const fresh = getSettings("wp008a_fresh_household");
  assert.equal(fresh.autoApproveImprovements, false);
});

test("the OFF default is baked into the persisted doc on first write (not just implied)", async () => {
  const { setSettings } = await import("../store.mjs");
  const hh = "wp008a_fresh_household_2";
  assert.equal(getSettings(hh).autoApproveImprovements, false, "precondition: nothing stored yet");
  setSettings({ timezone: "America/New_York" }, hh); // any first settings write for this household
  const stored = tenantEngine().getDoc(hh, "settings.json", null);
  assert.equal(stored?.autoApproveImprovements, false, "false is written explicitly, not left implicit");
  assert.equal(getSettings(hh).autoApproveImprovements, false, "still OFF on a subsequent read");
});

test("an EXISTING household's settings (predating this key) are left exactly as they were", () => {
  const hh = "wp008a_legacy_household";
  // Simulate a household whose settings.json already existed before this feature —
  // some other key is set, autoApproveImprovements never was.
  tenantEngine().putDoc(hh, "settings.json", { externalActionsEnabled: true, calendarAutoSync: true });
  const s = getSettings(hh);
  assert.equal(s.autoApproveImprovements, undefined, "the fallback default never applies once a doc exists");
  // Every real call site reads it as `settings.autoApproveImprovements !== false`, so
  // undefined still means ON — unchanged legacy behavior.
  assert.equal(s.autoApproveImprovements !== false, true, "legacy households keep reading as ON, unchanged");
});
