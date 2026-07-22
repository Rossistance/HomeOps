// FamiliOS AI — WP-008a: revert + read-only history support for evolution
// ("improvements") records.
//
// Why this module exists (ISS-007 / DEC-015 / HYP-002): the evolution loop applies
// accepted proposals to an agent's instructions or a skill's planner_guidance with no
// revert button and no before/after diff surface. WP-008b already proved (by hand) that
// a family can want a change undone — it had to reconstruct the pre-change text by
// correlating snapshot timestamps because nothing recorded which version an evolution
// changed FROM. `engine.mjs`'s `applyEvolutionToTarget` (used by both the auto-accept
// path and the human /api/evolution/:id/review route) now stamps that link at apply
// time as `beforeVersionId`; this module is what USES it to revert, and what falls back
// to timestamp correlation for legacy rows that predate the stamp.
//
// This module is deliberately HTTP-agnostic: `revertEvolution` and the read helpers
// return plain result objects. The route registration in server/index.mjs is a HANDOFF
// item (index.mjs is owned by another work package this wave) — see the mission return
// for the exact diff.
import { getEvolution, patchEvolution, appendAudit, getAgent, getSkill, readJSON } from "./store.mjs";
import { rollbackAgent, listAgentVersions } from "./agents.mjs";
import { rollbackSkill, listSkillVersions } from "./skills.mjs";

function versionsFor(kind, targetId) {
  return kind === "agent" ? listAgentVersions(targetId) : listSkillVersions(targetId);
}
function targetOf(kind, targetId) {
  return kind === "agent" ? getAgent(targetId) : getSkill(targetId);
}
function fieldOf(kind, snap) {
  return kind === "agent" ? (snap.instructions ?? null) : (snap.planner_guidance ?? null);
}

// Legacy fallback for evolution rows that predate `beforeVersionId`: the snapshot whose
// snapshotAt is the newest one AT OR BEFORE the moment the evolution was applied
// (updatedAt when the AI enrichment/accept landed, else reviewedAt, else createdAt) is
// the pre-change state — snapshotAgent/snapshotSkill fire immediately before the patch
// that applied `after`, so that ordering holds even without the explicit link.
function correlateByTimestamp(versions, e) {
  if (!versions.length) return null;
  const cutoff = Date.parse(e.updatedAt ?? "") || e.reviewedAt || e.createdAt || Date.now();
  const before = versions.filter((v) => (Date.parse(v.snapshotAt) || 0) <= cutoff);
  return before.length ? before[before.length - 1] : versions[0];
}

function resolveSnapshot(kind, targetId, e) {
  const versions = versionsFor(kind, targetId);
  if (!versions.length) return { versions, snap: null };
  let snap = e.beforeVersionId != null ? versions.find((v) => v.version === e.beforeVersionId) ?? null : null;
  if (!snap) snap = correlateByTimestamp(versions, e);
  return { versions, snap };
}

/** The pre-change text for an accepted/archived evolution's diff view, or null when it
 *  can't be resolved (no versions, target gone, not an agent/skill kind). Read-only —
 *  never mutates anything. */
export function resolveEvolutionBefore(e) {
  if (!e || (e.kind !== "agent" && e.kind !== "skill")) return null;
  const targetId = e.kind === "agent" ? e.agentId : e.skillId;
  if (!targetId) return null;
  const { snap } = resolveSnapshot(e.kind, targetId, e);
  return snap ? fieldOf(e.kind, snap) : null;
}

/** Whether an evolution row is eligible for the revert button right now: accepted,
 *  targets an agent/skill that still exists, and a prior version is available. */
export function canRevertEvolution(e) {
  if (!e || e.status !== "accepted") return false;
  if (e.kind !== "agent" && e.kind !== "skill") return false;
  const targetId = e.kind === "agent" ? e.agentId : e.skillId;
  if (!targetId) return false;
  if (!targetOf(e.kind, targetId)) return false;
  return versionsFor(e.kind, targetId).length > 0;
}

/** Read-only archived evolution history (WP-008b moved the resident household's rows
 *  here on a user-approved wipe). Never written by this module — the archive is
 *  append-only, historical record; nothing here truncates or deletes it. */
export function listEvolutionArchive(householdId) {
  const all = readJSON("evolution_archive.json", {});
  return Object.values(all).filter((e) => !householdId || !e.householdId || e.householdId === householdId);
}

/**
 * Revert an applied evolution: restores the target agent/skill to the version it was
 * at just before this evolution's change (via the existing self-snapshotting
 * rollbackAgent/rollbackSkill — so the revert ITSELF is a new, snapshotted version, not
 * a silent overwrite), marks the row `reverted`, and audits the action.
 * @param {string} evolutionId
 * @param {{ householdId?: string, actorId?: string }} [session]
 */
export function revertEvolution(evolutionId, session) {
  const e = getEvolution(evolutionId);
  if (!e) return { ok: false, error: "not_found", message: "No such improvement record." };
  if (session?.householdId && e.householdId && e.householdId !== session.householdId) {
    return { ok: false, error: "forbidden", message: "This improvement belongs to a different household." };
  }
  if (e.status === "reverted") return { ok: false, error: "already_reverted", message: "This improvement was already reverted." };
  if (e.status !== "accepted") return { ok: false, error: "not_revertible", message: `Only an accepted improvement can be reverted (current status: ${e.status}).` };
  if (e.kind !== "agent" && e.kind !== "skill") return { ok: false, error: "not_revertible", message: "This kind of improvement can't be reverted." };

  const targetId = e.kind === "agent" ? e.agentId : e.skillId;
  if (!targetId) return { ok: false, error: "not_revertible", message: "No target was recorded on this improvement." };
  if (!targetOf(e.kind, targetId)) return { ok: false, error: "target_deleted", message: `The ${e.kind} this improvement changed no longer exists.` };

  const { versions, snap } = resolveSnapshot(e.kind, targetId, e);
  if (!versions.length || !snap) return { ok: false, error: "no_prior_version", message: "No prior version is available to restore." };

  const restored = e.kind === "agent" ? rollbackAgent(targetId, snap.version) : rollbackSkill(targetId, snap.version);
  if (!restored || restored.error) return { ok: false, error: restored?.error ?? "revert_failed", message: "The restore failed." };

  const updated = patchEvolution(evolutionId, {
    status: "reverted",
    revertedAt: Date.now(),
    revertedBy: session?.actorId ?? null,
    revertedFromVersion: snap.version,
  });
  appendAudit({
    type: "evolution.revert", id: evolutionId, kind: e.kind, targetId,
    restoredToVersion: snap.version, householdId: e.householdId ?? session?.householdId ?? null,
    actorId: session?.actorId ?? null,
  });
  return { ok: true, evolution: updated, restoredToVersion: snap.version };
}
