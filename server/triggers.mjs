// FamiliOS AI — real server-side triggers. A trigger fires a durable run through the
// ONE canonical runtime (orchestrator → engine), with NO browser involved:
//   • schedule     — fire once at a time
//   • recurring    — fire every intervalMs
//   • webhook      — fire on a validated inbound POST to /api/webhooks/{id}
//   • connector_event — fire when a polled connector reports new data
//   • manual       — fire on demand from the UI
// Trigger state (nextRunAt / lastRunId / lastStatus / fireCount) is persisted, so the
// schedule survives restarts. The kill switch + approval gate still apply: a gated
// scheduled run PARKS for approval (and push-notifies) instead of acting unattended.
import crypto from "node:crypto";
import {
  listTriggers, getTrigger, putTrigger, patchTrigger, deleteTriggerRec,
  setConnectorConfig, getSecret, revokeConnector, appendAudit,
} from "./store.mjs";
import { runAgent, runSkill } from "./orchestrator.mjs";
import { runWithTenant } from "./tenant-context.mjs";

export const TRIGGER_TYPES = ["schedule", "recurring", "webhook", "connector_event", "manual"];
const TICKABLE = ["schedule", "recurring"];

/* -------------------------------- secrets ------------------------------- */
function setTriggerSecret(id, value) {
  if (value == null || value === "") return; // empty = unchanged
  setConnectorConfig(`tr:${id}`, {}, { signingSecret: value });
}
export function getTriggerSecret(id) {
  return getSecret(`tr:${id}`, "signingSecret");
}
function clearTriggerSecret(id) {
  revokeConnector(`tr:${id}`);
}

/* --------------------------------- time --------------------------------- */
function toMs(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/* --------------------------------- CRUD --------------------------------- */
export function createTrigger(body, session, now) {
  const id = "trg_" + crypto.randomBytes(10).toString("hex");
  const type = TRIGGER_TYPES.includes(body.type) ? body.type : "manual";
  const intervalMs = Number(body.intervalMs) > 0 ? Number(body.intervalMs) : null;
  let nextRunAt = null;
  if (TICKABLE.includes(type)) {
    nextRunAt = toMs(body.runAt) ?? (type === "recurring" ? (now ?? 0) + (intervalMs ?? 0) : (now ?? 0));
  }
  const trigger = {
    id,
    householdId: session?.householdId ?? "local",
    name: body.name ?? "Untitled trigger",
    type,
    enabled: body.enabled !== false,
    target: sanitizeTarget(body.target),
    intervalMs,
    nextRunAt,
    connectorId: body.connectorId ?? null,
    event: body.event ?? null,
    lastFiredAt: null, lastRunId: null, lastStatus: null, lastTriggerType: null, fireCount: 0,
    system: false,
    createdAt: now ?? 0,
    updatedAt: new Date().toISOString(),
  };
  putTrigger(trigger);
  if (type === "webhook" && body.secret) setTriggerSecret(id, body.secret);
  return getTrigger(id);
}

function sanitizeTarget(target) {
  const t = target ?? {};
  const kind = t.kind === "skill" ? "skill" : "agent";
  return {
    kind,
    agentId: t.agentId ?? null,
    skillId: t.skillId ?? null,
    goal: t.goal ?? null,
    params: t.params && typeof t.params === "object" ? t.params : {},
  };
}

export function updateTrigger(id, patch, now) {
  const existing = getTrigger(id);
  if (!existing) return null;
  const type = TRIGGER_TYPES.includes(patch.type) ? patch.type : existing.type;
  const intervalMs = patch.intervalMs !== undefined ? (Number(patch.intervalMs) > 0 ? Number(patch.intervalMs) : null) : existing.intervalMs;
  // Recompute nextRunAt when scheduling inputs change or the trigger is (re)enabled.
  let nextRunAt = existing.nextRunAt;
  if (patch.runAt !== undefined) nextRunAt = toMs(patch.runAt);
  if (TICKABLE.includes(type) && (patch.enabled === true && !existing.enabled) && !nextRunAt) {
    nextRunAt = type === "recurring" ? (now ?? 0) + (intervalMs ?? 0) : (now ?? 0);
  }
  const next = {
    ...existing,
    ...patch,
    id, householdId: existing.householdId, system: existing.system,
    type, intervalMs, nextRunAt,
    target: patch.target ? sanitizeTarget(patch.target) : existing.target,
    updatedAt: new Date().toISOString(),
  };
  delete next.secret;
  putTrigger(next);
  if (type === "webhook" && patch.secret) setTriggerSecret(id, patch.secret);
  return getTrigger(id);
}

export function deleteTrigger(id) {
  const existing = getTrigger(id);
  if (!existing) return { error: "not_found" };
  clearTriggerSecret(id);
  deleteTriggerRec(id);
  return { ok: true };
}

/* ----------------------------- public view ------------------------------ */
export function publicTrigger(t) {
  if (!t) return null;
  return {
    id: t.id, householdId: t.householdId, name: t.name, type: t.type, enabled: t.enabled,
    target: t.target, intervalMs: t.intervalMs, nextRunAt: t.nextRunAt,
    connectorId: t.connectorId, event: t.event,
    lastFiredAt: t.lastFiredAt, lastRunId: t.lastRunId, lastStatus: t.lastStatus, lastTriggerType: t.lastTriggerType, fireCount: t.fireCount,
    webhookPath: t.type === "webhook" ? `/api/webhooks/${t.id}` : null,
    hasSecret: t.type === "webhook" ? !!getTriggerSecret(t.id) : false,
    createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}
export function listPublicTriggers(session, { type } = {}) {
  const hh = session?.householdId ?? "local";
  return listTriggers((t) => t.householdId === hh || t.householdId === "local")
    .filter((t) => !type || t.type === type)
    .map(publicTrigger)
    .sort((a, b) => (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? 1 : -1);
}

/* ------------------------------ firing ---------------------------------- */
// Start a durable run for this trigger's target through the canonical runtime.
// A synthetic system session carries the household; runs are attributed to the
// "scheduler" actor. Fire-and-forget: startRun returns once the run is created and
// driveRun proceeds asynchronously (so the scheduler never blocks on a long run).
export async function fireTrigger(trigger, opts = {}) {
  if (!trigger) return { ok: false, error: "unknown_trigger" };
  // The fire executes AS the trigger's household (webhooks arrive with no
  // session; the tick may run under a different tenant's context).
  return runWithTenant(trigger.householdId ?? "local", () => fireTriggerInner(trigger, opts));
}
async function fireTriggerInner(trigger, { triggerType = trigger.type, payload, now = Date.now() } = {}) {
  const session = { householdId: trigger.householdId ?? "local", actorId: "scheduler", role: "Owner" };
  const tgt = trigger.target ?? {};
  const params = { ...(tgt.params ?? {}), ...(payload ? { trigger_payload: payload } : {}) };

  let out;
  try {
    if (tgt.kind === "skill" && tgt.skillId) {
      out = await runSkill({ skillId: tgt.skillId, params, session, source: "trigger", sourceRef: { triggerId: trigger.id, triggerType } });
    } else if (tgt.kind === "agent" && tgt.agentId) {
      out = await runAgent({ agentId: tgt.agentId, goal: tgt.goal ?? undefined, skillId: tgt.skillId ?? undefined, params, session, source: "trigger" });
    } else {
      out = { error: "invalid_target" };
    }
  } catch (e) {
    out = { error: "fire_failed", message: String(e?.message ?? e) };
  }

  const runId = out?.run?.id ?? null;
  const status = out?.error ? `error:${out.error}` : (out?.run?.status ?? "started");
  patchTrigger(trigger.id, { lastFiredAt: now, lastRunId: runId, lastStatus: status, lastTriggerType: triggerType, fireCount: (trigger.fireCount ?? 0) + 1 });
  appendAudit({ type: "trigger.fire", triggerId: trigger.id, triggerType, runId, ok: !out?.error, error: out?.error, householdId: trigger.householdId });
  return out?.error ? { ok: false, error: out.error, message: out.message } : { ok: true, runId };
}

// Fire any enabled webhook trigger registered at this id with the inbound payload.
export async function fireWebhookTrigger(id, payload) {
  const t = getTrigger(id);
  if (!t || t.type !== "webhook" || !t.enabled) return { ok: false, error: "no_webhook_trigger" };
  return await fireTrigger(t, { triggerType: "webhook", payload });
}

// Fire connector_event triggers for a connector that just reported new data.
export async function fireConnectorEvent(connectorId, payload) {
  const matches = listTriggers((t) => t.enabled && t.type === "connector_event" && t.connectorId === connectorId);
  const out = [];
  for (const t of matches) out.push(await fireTrigger(t, { triggerType: "connector_event", payload }).catch(() => ({ ok: false })));
  return out;
}

/* --------------------------------- tick --------------------------------- */
// Called on an interval by the server. Fires due schedule/recurring triggers
// EXACTLY once: scheduling state is advanced BEFORE firing so an overlapping tick
// can't double-fire, and the run itself is fire-and-forget.
//
// Fairness (C1.3): fires are capped per tick, and capped PER HOUSEHOLD first —
// one family with fifty due automations can neither starve another family's
// single morning briefing nor flood the AI provider in one burst. Skipped
// triggers keep their due nextRunAt untouched, so the next tick (10s later)
// picks them up — deferred, never dropped.
const MAX_FIRES_PER_TICK = 10;
const MAX_FIRES_PER_HOUSEHOLD_PER_TICK = 3;
export async function tick(now = Date.now()) {
  const due = listTriggers((x) => x.enabled && TICKABLE.includes(x.type) && x.nextRunAt && x.nextRunAt <= now)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0)); // oldest-due first
  let fired = 0;
  const perHousehold = new Map();
  for (const t of due) {
    if (fired >= MAX_FIRES_PER_TICK) break;
    const hh = t.householdId ?? "local";
    const used = perHousehold.get(hh) ?? 0;
    if (used >= MAX_FIRES_PER_HOUSEHOLD_PER_TICK) continue; // stays due; next tick
    perHousehold.set(hh, used + 1);
    if (t.type === "recurring" && t.intervalMs) patchTrigger(t.id, { nextRunAt: now + t.intervalMs });
    else patchTrigger(t.id, { enabled: false, nextRunAt: null }); // one-shot schedule completes
    fired++;
    fireTrigger(t, { triggerType: t.type, now }).catch(() => {});
  }
  return fired;
}
