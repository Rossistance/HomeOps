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
  setConnectorConfig, getSecret, revokeConnector, appendAudit, getAgent, getMember, getSettings,
} from "./store.mjs";
import { orchestrate } from "./orchestrator.mjs";
import { onRunFinished, onRunParked } from "./engine.mjs";
import { runWithTenant } from "./tenant-context.mjs";
import { tzOffsetAt, wallClockToUtc, localParts, formatForHousehold } from "./household-time.mjs";

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

/* ---- WP-002: TIME-OF-DAY ANCHORS ("every day at 7 AM" means 07:00) ----
 * A recurring trigger used to be pure interval arithmetic: nextRunAt = now +
 * intervalMs. Ask for a 7 AM briefing at 09:23 and it fired at 09:23 the next day,
 * forever — the spec simply could not express a time of day (ISS-003, EV-011).
 *
 * An `anchor` of "HH:MM" fixes the run to a WALL-CLOCK time in the household's
 * timezone, and every fire recomputes from that wall clock rather than from the
 * moment the last fire happened. That distinction is what keeps 07:00 at 07:00
 * across a DST transition (and stops the slow drift that interval-chaining
 * accumulates when a fire runs late).                                            */

// The household's declared timezone, else null so the anchor math discloses a
// server-local fallback instead of silently scheduling in the wrong zone.
function householdTimezone(householdId) {
  try { return getSettings(householdId)?.timezone || null; } catch { return null; }
}

export function parseAnchor(v) {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (!(h >= 0 && h <= 23 && min >= 0 && min <= 59)) return null;
  return { hour: h, minute: min, text: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` };
}

// tzOffsetAt / wallClockToUtc / localParts live in household-time.mjs now — one
// implementation for scheduling, day boundaries and everything a person reads.

/**
 * The next instant at which the household's wall clock reads `anchor`, strictly
 * after `now`. Falls back to server-local arithmetic when the timezone is unknown —
 * and reports which basis it used, so the caller can disclose a fallback rather
 * than silently scheduling in the wrong zone.
 */
export function nextAnchorOccurrence(anchor, tz, now = Date.now()) {
  const a = parseAnchor(anchor);
  if (!a) return null;
  const zone = tz && tzOffsetAt(now, tz) != null ? tz : null;
  if (!zone) {
    // Server-local fallback (disclosed by the caller via `tzSource`).
    const d = new Date(now);
    const cand = new Date(d.getFullYear(), d.getMonth(), d.getDate(), a.hour, a.minute, 0, 0).getTime();
    const at = cand > now ? cand : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, a.hour, a.minute, 0, 0).getTime();
    return { at, tzSource: "server", tz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "server-local" };
  }
  const today = localParts(now, zone);
  let at = wallClockToUtc({ ...today, hour: a.hour, minute: a.minute }, zone);
  if (at == null || at <= now) {
    // Advance by one CALENDAR day in the household's zone, then re-resolve. Adding
    // 24h of milliseconds instead would drift by an hour across a DST boundary.
    const tomorrow = localParts((at ?? now) + 26 * 3600_000, zone);
    at = wallClockToUtc({ ...tomorrow, hour: a.hour, minute: a.minute }, zone);
  }
  return at == null ? null : { at, tzSource: "household", tz: zone };
}

/** Human schedule copy for the clients ("Daily · 7:00 AM"), never raw intervalMs. */
export function scheduleTextFor(trigger) {
  const a = parseAnchor(trigger?.anchor);
  if (a) {
    const h12 = a.hour % 12 === 0 ? 12 : a.hour % 12;
    const ampm = a.hour < 12 ? "AM" : "PM";
    const clock = `${h12}:${String(a.minute).padStart(2, "0")} ${ampm}`;
    if (trigger.type === "recurring") return `Daily · ${clock}`;
    return `Once · ${clock}`;
  }
  if (trigger?.type === "recurring" && trigger.intervalMs) {
    const h = trigger.intervalMs / 3600_000;
    if (h === 24) return "Daily";
    if (h === 168) return "Weekly";
    if (h >= 1 && Number.isInteger(h)) return `Every ${h} hour${h === 1 ? "" : "s"}`;
    const m = Math.round(trigger.intervalMs / 60_000);
    return `Every ${m} minute${m === 1 ? "" : "s"}`;
  }
  if (trigger?.type === "schedule" && trigger.nextRunAt) return `Once · ${formatForHousehold(new Date(trigger.nextRunAt).toISOString(), trigger.householdId)}`;
  const labels = { webhook: "On webhook", connector_event: "On new data", manual: "Manual only" };
  return labels[trigger?.type] ?? "Manual only";
}

/** The household changed its timezone: every anchored trigger's next fire was resolved on
 *  the OLD clock (or the server's). Re-resolve them now, rather than letting a 7 AM
 *  briefing fire at the wrong hour once and a one-shot schedule at the wrong hour forever. */
export function reanchorTriggersForHousehold(householdId, now = Date.now()) {
  let changed = 0;
  const tz = householdTimezone(householdId);
  for (const t of listTriggers((x) => x.householdId === householdId && x.enabled && TICKABLE.includes(x.type) && x.anchor)) {
    const occ = nextAnchorOccurrence(t.anchor, tz, now);
    if (!occ) continue;
    patchTrigger(t.id, { nextRunAt: occ.at, tzSource: occ.tzSource });
    changed++;
  }
  return changed;
}

/* --------------------------------- CRUD --------------------------------- */
export function createTrigger(body, session, now) {
  const id = "trg_" + crypto.randomBytes(10).toString("hex");
  const type = TRIGGER_TYPES.includes(body.type) ? body.type : "manual";
  const intervalMs = Number(body.intervalMs) > 0 ? Number(body.intervalMs) : null;
  const householdId = session?.householdId ?? "local";
  const anchor = parseAnchor(body.anchor)?.text ?? null;
  let nextRunAt = null;
  let tzSource = null;
  if (TICKABLE.includes(type)) {
    // WP-002: an anchor beats interval arithmetic — "every day at 7 AM" resolves to
    // the next 07:00 on the household's clock, not to creation-time + 24h.
    const occ = anchor ? nextAnchorOccurrence(anchor, householdTimezone(householdId), now ?? Date.now()) : null;
    if (occ) { nextRunAt = occ.at; tzSource = occ.tzSource; }
    else nextRunAt = toMs(body.runAt) ?? (type === "recurring" ? (now ?? 0) + (intervalMs ?? 0) : (now ?? 0));
  }
  const trigger = {
    id,
    householdId,
    name: body.name ?? "Untitled trigger",
    type,
    enabled: body.enabled !== false,
    target: sanitizeTarget(body.target),
    intervalMs,
    anchor,
    tzSource,
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
  const anchor = patch.anchor !== undefined ? (parseAnchor(patch.anchor)?.text ?? null) : (existing.anchor ?? null);
  let nextRunAt = existing.nextRunAt;
  let tzSource = existing.tzSource ?? null;
  if (patch.runAt !== undefined) nextRunAt = toMs(patch.runAt);
  // A changed anchor (or re-enabling an anchored trigger) re-resolves the wall clock.
  const anchorChanged = patch.anchor !== undefined && anchor !== (existing.anchor ?? null);
  const reEnabled = TICKABLE.includes(type) && patch.enabled === true && !existing.enabled;
  if (TICKABLE.includes(type) && anchor && (anchorChanged || (reEnabled && !nextRunAt))) {
    const occ = nextAnchorOccurrence(anchor, householdTimezone(existing.householdId), now ?? Date.now());
    if (occ) { nextRunAt = occ.at; tzSource = occ.tzSource; }
  } else if (reEnabled && !nextRunAt) {
    nextRunAt = type === "recurring" ? (now ?? 0) + (intervalMs ?? 0) : (now ?? 0);
  }
  const next = {
    ...existing,
    ...patch,
    id, householdId: existing.householdId, system: existing.system,
    type, intervalMs, anchor, tzSource, nextRunAt,
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
    // WP-002/WP-006: the clients render the human schedule, never raw intervalMs.
    anchor: t.anchor ?? null, tzSource: t.tzSource ?? null, scheduleText: scheduleTextFor(t),
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
  const tgt = trigger.target ?? {};
  // Attribute the run to a real owner when the target is a PERSONAL agent, so its
  // approvals notify that person only — a scheduled personal briefing must not ping the
  // whole household. Otherwise runs are attributed to the "scheduler" system actor.
  let actorId = "scheduler";
  let role = "Owner";
  if (tgt.kind === "agent" && tgt.agentId) {
    const agent = getAgent(tgt.agentId);
    if (agent?.visibility === "personal" && agent.createdBy) {
      const owner = getMember(agent.createdBy);
      if (owner && !owner.archived) { actorId = owner.actorId; role = owner.role; }
    }
  }
  const session = { householdId: trigger.householdId ?? "local", actorId, role };
  const params = { ...(tgt.params ?? {}), ...(payload ? { trigger_payload: payload } : {}) };

  // WP-001 slice 2 — PREFER THE SKILL. Whatever the target's `kind` says, a skillId is
  // the most specific thing to run: it is the deterministic recipe the chat actually
  // built. An agent target that carries one runs it AS that agent (the engine still
  // re-validates every step against the agent's policy). Only a target with neither a
  // skill nor a goal has nothing to execute — and that now says so instead of quietly
  // degrading into a read-only status pass.
  // WP-006 slice 1 — every trigger fire creates its run through the single orchestrate()
  // entry (which derives sourceRef.via = schedule|webhook|connector_event from triggerType
  // and delegates to the same runSkill/runAgent machinery). Target-shape decisions (prefer
  // skill; an agent target needs a skill or a goal to be runnable) stay here.
  const ref = { triggerId: trigger.id, triggerType };
  let out;
  try {
    if (tgt.skillId && tgt.kind === "skill") {
      out = await orchestrate({ source: "trigger", triggerType, skillId: tgt.skillId, params, session, sourceRef: ref });
    } else if (tgt.kind === "agent" && tgt.agentId) {
      if (!tgt.skillId && !String(tgt.goal ?? "").trim()) {
        out = { error: "unrunnable_target", message: "This automation has no skill to run and no instructions to work from, so firing it would do nothing. Edit it to say what each run should do." };
      } else {
        out = await orchestrate({ source: "trigger", triggerType, agentId: tgt.agentId, goal: tgt.goal ?? undefined, skillId: tgt.skillId ?? undefined, params, session, sourceRef: ref });
      }
    } else if (tgt.skillId) {
      out = await orchestrate({ source: "trigger", triggerType, skillId: tgt.skillId, params, session, sourceRef: ref });
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

/* ---- WP-001 slice 4: TERMINAL lastStatus writeback (ISS-009) ----
 * fireTriggerInner records the status the run had the INSTANT it was created —
 * almost always "started" or "queued". Nothing ever wrote the outcome back, so the
 * Automations list showed a permanent "started" for a routine that had long since
 * completed, failed, or expired. Runs are fire-and-forget by design, so the truth
 * has to arrive on the run-finished hook.
 * Registered once at boot (index.mjs), matched by lastRunId so a stale hook can
 * never overwrite a newer fire's status. */
export function registerTriggerRunHooks() {
  const writeBack = (run, extra = {}) => {
    try {
      const triggerId = run?.sourceRef?.triggerId;
      if (!triggerId) return;
      const t = getTrigger(triggerId);
      if (!t || t.lastRunId !== run.id) return; // a newer fire owns the status now
      patchTrigger(triggerId, { lastStatus: run.status, ...extra });
    } catch { /* observer-only: never disturb the run */ }
  };
  onRunFinished((run) => writeBack(run, { lastFinishedAt: run.finishedAt ?? Date.now() }));
  // A parked run is not terminal, but "waiting for approval" is still the truthful
  // answer to "what is this automation doing?" — and leaving it as the fire-time
  // "queued" placeholder is precisely the stale status ISS-009 describes.
  onRunParked((run) => writeBack(run));
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
    // WP-002: recompute from the WALL CLOCK, not from this fire's timestamp. Chaining
    // `now + intervalMs` drifts a little later every time a fire runs late, and slips
    // by a full hour at each DST transition; re-resolving the anchor does neither.
    if (t.type === "recurring" && t.anchor) {
      const occ = nextAnchorOccurrence(t.anchor, householdTimezone(t.householdId), now);
      patchTrigger(t.id, occ ? { nextRunAt: occ.at, tzSource: occ.tzSource } : { nextRunAt: now + (t.intervalMs ?? 86_400_000) });
    } else if (t.type === "recurring" && t.intervalMs) patchTrigger(t.id, { nextRunAt: now + t.intervalMs });
    else patchTrigger(t.id, { enabled: false, nextRunAt: null }); // one-shot schedule completes
    fired++;
    fireTrigger(t, { triggerType: t.type, now }).catch(() => {});
  }
  return fired;
}
