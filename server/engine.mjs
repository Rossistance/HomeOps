// HomeOps AI — durable, server-side run executor (the canonical runtime).
// Every meaningful task (chat, command, manual agent/skill run, schedule, webhook)
// flows through startRun → driveRun, producing a durable run + run steps that:
//   • execute REAL internal/connector/provider tools (no simulation),
//   • pause at approval-gated steps and resume after a real human approval,
//   • are idempotent + restart-recoverable (a side effect fires at most once),
//   • write audit + memory + artifacts, and feed evolution on genuine failure.
// The browser is NOT the source of truth — it observes runs via /api/runs.
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import {
  createRun, getRun, patchRun, patchRunStep, appendToolCall, listRuns,
  createApproval, consumeApproval, getApproval, decideApproval,
  appendAudit, getSettings, putEvolution, patchEvolution,
  idempotencyKey, checkIdempotency, recordIdempotency, withRunLock, hashInput,
} from "./store.mjs";
import { findToolGlobal } from "./providers.mjs";
import { listConnectors, executeTool } from "./connectors.mjs";
import { listAccountsFor } from "./accounts.mjs";
import { apiForAccount } from "./oauth.mjs";
import { getInternalFunction } from "./internal-functions.mjs";
import { resolveRegisteredFunction, runFunctionHandler, computeFunctionState } from "./functions.mjs";
import { getAgent } from "./store.mjs";
import { isToolStepAllowed } from "./agents.mjs";
import { pushApprovalNotification } from "./notify.mjs";
import { proposeEvolution } from "./planner.mjs";

const RUN_STEP_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const LEASE_OWNER = String(process.pid);

/* ---- per-run event emitters (live progress; Slice 2 SSE route consumes these) ---- */
const emitters = new Map();
export function runEmitter(runId) {
  let e = emitters.get(runId);
  if (!e) { e = new EventEmitter(); e.setMaxListeners(64); emitters.set(runId, e); }
  return e;
}
function emit(runId, type) {
  try { runEmitter(runId).emit("event", { type, run: getRun(runId) }); } catch { /* non-fatal */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("step_timeout")), ms))]);
}
function summarize(result) {
  if (result == null) return "ok";
  const s = typeof result === "string" ? result : JSON.stringify(result);
  return s.slice(0, 200);
}
function externalActionsEnabled() { return getSettings().externalActionsEnabled !== false; }

/* ---- authoritative tool resolution (server decides requiresApproval, NOT client) ---- */
function resolveTool(toolId) {
  const internal = getInternalFunction(toolId);
  if (internal) return { kind: "internal", def: internal, requiresApproval: !!internal.requiresApproval, action: internal.action, risk: internal.risk, connectorId: internal.connectorId, connectorName: internal.connectorName };
  const platform = findToolGlobal(toolId);
  if (platform) return { kind: "provider", provider: platform.provider, tool: platform.tool, requiresApproval: !!platform.tool.requiresApproval, action: platform.tool.action, risk: platform.tool.risk, connectorId: platform.provider.id, connectorName: platform.provider.name };
  const conn = listConnectors().find((x) => x.tools.some((t) => t.id === toolId));
  const tool = conn?.tools.find((t) => t.id === toolId);
  if (tool) return { kind: "connector", connector: conn, tool, requiresApproval: !!tool.requiresApproval, action: tool.action, risk: tool.risk, connectorId: conn.id, connectorName: conn.name };
  // Registered functions (Slice 4): user-authored capabilities. requiresApproval is
  // server-authoritative (never relaxes below the wrapped tool); the "available"
  // gate is re-checked at execution in execResolved.
  const registered = resolveRegisteredFunction(toolId);
  if (registered) return registered;
  return null;
}

// Execute a resolved tool. For gated steps this is called only AFTER the approval
// has been consumed. Returns { ok, result } | { ok:false, error, message, waiting? }.
async function execResolved(resolved, input, ctx, approvalId) {
  if (resolved.kind === "internal") {
    return await resolved.def.run({ householdId: ctx.householdId, actorId: ctx.actorId, runId: ctx.runId }, input);
  }
  if (resolved.kind === "function") {
    // HARD RULE: a registered function executes in a run ONLY when its live state is
    // "available" (passed a real test + deps satisfied). Anything else fails honestly;
    // a missing dependency parks the run as resumable rather than fabricating success.
    const { state, reason } = computeFunctionState(resolved.fn, { householdId: ctx.householdId, actorId: ctx.actorId });
    if (state !== "available") {
      const waiting = ["needs_connector", "needs_runtime", "degraded"].includes(state);
      return { ok: false, error: `function_${state}`, message: reason, waiting: waiting ? "connector" : undefined };
    }
    return await runFunctionHandler(resolved.fn, input, { householdId: ctx.householdId, actorId: ctx.actorId, runId: ctx.runId, accountId: ctx.accountId }, { approvalConsumed: !!approvalId });
  }
  if (resolved.kind === "provider") {
    if (!externalActionsEnabled() && ["Write", "Send", "Download"].includes(resolved.action)) {
      return { ok: false, error: "external_actions_disabled", message: "External actions are paused by the household kill switch." };
    }
    const accounts = listAccountsFor(ctx.householdId, ctx.actorId).filter((a) => a.provider === resolved.provider.id);
    const account = ctx.accountId ? accounts.find((a) => a.id === ctx.accountId) : accounts[0];
    if (!account) return { ok: false, error: "not_connected", message: `Connect your ${resolved.provider.name} account to use this tool.`, waiting: "connector" };
    try {
      const result = await resolved.tool.run(apiForAccount(account), input);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: "provider_error", message: String(e?.message ?? e) };
    }
  }
  // connector tool — executeTool re-checks readiness + kill switch; we pass the
  // consumed-approval flag so gated connector tools (http.post/sms.send) run.
  return await executeTool(resolved.tool.id, input, { actorId: ctx.actorId, requestId: ctx.runId, approvalConsumed: !!approvalId, approvalId });
}

const WAITING_CONNECTOR_RE = /not_configured|not_connected|not_authorized|connector_|runtime_unavailable/;

/* ---- start a run from a concrete plan ---- */
export async function startRun({ source = "manual", sourceRef = {}, plan, params = {}, session, title } = {}) {
  const runId = "run_" + crypto.randomBytes(10).toString("hex");
  const now = Date.now();
  const steps = (plan?.steps ?? []).map((s, i) => {
    const resolved = s.toolId ? resolveTool(s.toolId) : null;
    return {
      index: i,
      toolId: s.toolId ?? null,
      functionId: (resolved?.kind === "internal" || resolved?.kind === "function") ? s.toolId : null,
      title: String(s.title ?? resolved?.tool?.name ?? resolved?.def?.name ?? (s.toolId ?? "Reasoning step")),
      detail: String(s.detail ?? ""),
      input: s.input && typeof s.input === "object" ? s.input : {},
      requiresApproval: resolved ? resolved.requiresApproval : false, // server-authoritative
      risk: resolved?.risk ?? s.risk ?? "Low",
      connectorId: resolved?.connectorId ?? null,
      connectorName: resolved?.connectorName ?? null,
      attribution: resolved?.kind ?? (s.toolId ? "unknown" : "reasoning"),
      status: "pending",
      approvalId: null,
      idempotencyKey: null,
      attempts: 0,
      result: null,
      toolCalls: [],
      startedAt: null,
      finishedAt: null,
    };
  });
  const run = {
    id: runId,
    householdId: session?.householdId ?? "local",
    actorId: session?.actorId ?? "system",
    source,
    sourceRef,
    title: title ?? plan?.title ?? "Run",
    summary: plan?.summary ?? "",
    status: "queued",
    params,
    plan: { title: plan?.title ?? null, summary: plan?.summary ?? null, stepCount: steps.length },
    cursor: 0,
    steps,
    error: null,
    lease: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  };
  createRun(run);
  appendAudit({ type: "run.start", runId, source, householdId: run.householdId, actorId: run.actorId, steps: steps.length });
  emit(runId, "run.created");
  driveRun(runId).catch(() => {}); // drive asynchronously; caller gets the runId now
  return run;
}

/* ---- drive a run forward (locked); resumeRun calls the inner loop directly ---- */
export function driveRun(runId) {
  return withRunLock(runId, () => _drive(runId));
}

async function _drive(runId) {
  let run = getRun(runId);
  if (!run) return { error: "not_found" };
  if (["completed", "failed", "cancelled", "expired"].includes(run.status)) return { ok: true, status: run.status };
  patchRun(runId, { status: "running", startedAt: run.startedAt ?? Date.now(), lease: { owner: LEASE_OWNER, at: Date.now() } });
  emit(runId, "run.running");

  while (true) {
    run = getRun(runId);
    if (!run || run.status === "cancelled") return { ok: true, status: "cancelled" };
    const i = run.cursor;
    if (i >= run.steps.length) {
      patchRun(runId, { status: "completed", finishedAt: Date.now(), lease: null });
      appendAudit({ type: "run.complete", runId, householdId: run.householdId, steps: run.steps.length });
      emit(runId, "run.completed");
      return { ok: true, status: "completed" };
    }
    const step = run.steps[i];
    if (["succeeded", "skipped"].includes(step.status)) { patchRun(runId, { cursor: i + 1 }); continue; }

    // Reasoning step (no tool) — nothing to execute.
    if (!step.toolId) {
      patchRunStep(runId, i, { status: "succeeded", detail: step.detail || "Reasoning step.", finishedAt: Date.now() });
      patchRun(runId, { cursor: i + 1 });
      emit(runId, "run.step");
      continue;
    }

    const resolved = resolveTool(step.toolId);
    if (!resolved) {
      patchRunStep(runId, i, { status: "failed", detail: `Unknown tool: ${step.toolId}`, finishedAt: Date.now() });
      return finishFailed(runId, "unknown_tool");
    }

    // Agent policy re-validation (Slice 5): if this run is attributed to an agent that
    // exists server-side, a denied or unpermitted tool can NEVER execute — even if a
    // plan slipped one in. Availability is enforced separately below; this is policy.
    if (run.sourceRef?.agentId) {
      const agent = getAgent(run.sourceRef.agentId);
      if (agent) {
        const verdict = isToolStepAllowed(agent, step.toolId, { householdId: run.householdId, actorId: run.actorId });
        if (!verdict.ok) {
          patchRunStep(runId, i, { status: "failed", detail: verdict.message ?? "Blocked by agent policy.", finishedAt: Date.now() });
          appendAudit({ type: "run.policy_block", runId, toolId: step.toolId, agentId: agent.id, reason: verdict.reason, householdId: run.householdId });
          return finishFailed(runId, `agent_policy_${verdict.reason}`);
        }
      }
    }

    // Approval gate — create the approval, park, and return until a human decides.
    if (resolved.requiresApproval) {
      if (!step.approvalId) {
        const a = createApproval({ actorId: run.actorId, householdId: run.householdId, connectorId: resolved.connectorId, toolId: step.toolId, input: step.input, risk: resolved.risk, category: resolved.action, preview: step.title });
        patchRunStep(runId, i, { status: "waiting_for_approval", approvalId: a.id });
        patchRun(runId, { status: "waiting_for_approval" });
        appendAudit({ type: "run.await_approval", runId, toolId: step.toolId, approvalId: a.id, householdId: run.householdId });
        // Push-notify the household — crucial for scheduled/trigger runs that park with
        // no browser open. Fire-and-forget; no-op when no device tokens are registered.
        pushApprovalNotification(a).catch(() => {});
        emit(runId, "run.waiting_for_approval");
        return { ok: true, status: "waiting_for_approval", approvalId: a.id };
      }
      const appr = getApproval(step.approvalId);
      if (!appr || appr.status === "pending") {
        patchRun(runId, { status: "waiting_for_approval" });
        emit(runId, "run.waiting_for_approval");
        return { ok: true, status: "waiting_for_approval" };
      }
      if (appr.status === "denied" || appr.status === "expired") {
        patchRunStep(runId, i, { status: "skipped", detail: `Approval ${appr.status}.`, finishedAt: Date.now() });
        appendAudit({ type: "run.approval_denied", runId, approvalId: appr.id, status: appr.status, householdId: run.householdId });
        return finishFailed(runId, `approval_${appr.status}`);
      }
      // approved → fall through to consume + execute
    }

    // Idempotency — never run the same step's side effect twice (across restarts too).
    const idem = idempotencyKey(runId, i, step.toolId, JSON.stringify(step.input ?? {}));
    const prior = checkIdempotency(idem);
    if (prior?.done) {
      patchRunStep(runId, i, { status: "succeeded", detail: prior.summary ?? "Already done.", finishedAt: Date.now(), idempotencyKey: idem });
      patchRun(runId, { cursor: i + 1 });
      emit(runId, "run.step");
      continue;
    }

    const attempts = (step.attempts ?? 0) + 1;
    patchRunStep(runId, i, { status: "running", startedAt: step.startedAt ?? Date.now(), idempotencyKey: idem, attempts });
    emit(runId, "run.step");

    // Consume the approval atomically with the FROZEN input (hash must match).
    let approvalId;
    if (resolved.requiresApproval) {
      const c = consumeApproval({ id: step.approvalId, actorId: run.actorId, householdId: run.householdId, toolId: step.toolId, input: step.input });
      if (c.error) {
        patchRunStep(runId, i, { status: "failed", detail: c.error, finishedAt: Date.now() });
        appendAudit({ type: "run.step", runId, toolId: step.toolId, ok: false, error: c.error, householdId: run.householdId });
        return finishFailed(runId, c.error);
      }
      approvalId = c.approval.id;
    }

    let out;
    const t0 = Date.now();
    try {
      out = await withTimeout(execResolved(resolved, step.input, { householdId: run.householdId, actorId: run.actorId, runId, accountId: run.params?.accountId }, approvalId), RUN_STEP_TIMEOUT_MS);
    } catch (e) {
      out = { ok: false, error: "timeout", message: String(e?.message ?? e) };
    }
    const durationMs = Date.now() - t0;
    // First-class trace fields (P3.2): who acted, which account/connector, the input
    // hash, and the approval consumed — enough to explain why an automation acted.
    appendToolCall(runId, i, { ok: !!out.ok, error: out.ok ? null : out.error, durationMs, approvalId: approvalId ?? null, actorId: run.actorId, accountId: run.params?.accountId ?? null, connectorId: resolved.connectorId ?? null, attribution: resolved.kind, inputHash: hashInput(step.input), resultSummary: out.ok ? summarize(out.result) : (out.message ?? out.error) });
    appendAudit({ type: "run.step", runId, toolId: step.toolId, connectorId: resolved.connectorId, ok: !!out.ok, error: out.ok ? undefined : out.error, action: resolved.action, householdId: run.householdId, actorId: run.actorId });

    if (out.ok) {
      recordIdempotency(idem, { done: true, summary: summarize(out.result) });
      patchRunStep(runId, i, { status: "succeeded", detail: summarize(out.result), result: out.result ?? null, finishedAt: Date.now() });
      patchRun(runId, { cursor: i + 1 });
      emit(runId, "run.step");
      continue;
    }

    // Dependency missing → park (resumable once the user connects the service).
    if (out.waiting === "connector" || WAITING_CONNECTOR_RE.test(String(out.error))) {
      patchRunStep(runId, i, { status: "blocked", detail: out.message ?? out.error });
      patchRun(runId, { status: "waiting_for_connector" });
      emit(runId, "run.waiting_for_connector");
      return { ok: true, status: "waiting_for_connector" };
    }
    // Transient provider error → bounded retry, but ONLY for non-gated steps
    // (a human-approved sensitive action is never silently re-attempted).
    if (out.error === "provider_error" && !resolved.requiresApproval && attempts < MAX_ATTEMPTS) {
      patchRunStep(runId, i, { status: "ready", detail: `Retrying after: ${out.message ?? out.error}` });
      patchRun(runId, { status: "retrying" });
      emit(runId, "run.retrying");
      await sleep(400 * attempts);
      continue;
    }
    patchRunStep(runId, i, { status: "failed", detail: out.message ?? out.error, finishedAt: Date.now() });
    return finishFailed(runId, out.error);
  }
}

function finishFailed(runId, error) {
  patchRun(runId, { status: "failed", error, finishedAt: Date.now(), lease: null });
  const run = getRun(runId);
  appendAudit({ type: "run.failed", runId, error, householdId: run?.householdId });
  if (run) recordFailureEvolution(run); // real, evidence-backed proposal (deterministic baseline)
  emit(runId, "run.failed");
  return { ok: false, status: "failed", error };
}

// Evidence-backed improvement proposal from a real failed run. Writes a
// deterministic trace-based baseline immediately, then fires an async AI
// enrichment pass (proposeEvolution) to upgrade it with better wording +
// a concrete "after" suggestion. Never invents a failure.
function recordFailureEvolution(run) {
  const bad = run.steps.find((s) => s.status === "failed");
  if (!bad) return;
  const evoId = "evo_" + crypto.randomBytes(8).toString("hex");
  const kind = run.sourceRef?.skillId ? "skill" : run.sourceRef?.agentId ? "agent" : "tool";
  putEvolution({
    id: evoId,
    householdId: run.householdId,
    kind,
    skillId: run.sourceRef?.skillId ?? null,
    agentId: run.sourceRef?.agentId ?? null,
    runId: run.id,
    status: "pending",
    source: "trace",
    title: `Improve: ${bad.title}`,
    reason: `Step "${bad.title}" (${bad.toolId ?? "unknown"}) failed: ${bad.detail ?? run.error ?? "unknown error"}`,
    summary: `Handle "${bad.toolId ?? "this tool"}" failures more gracefully, or connect the required service before running.`,
    createdAt: Date.now(),
    updatedAt: new Date().toISOString(),
  });
  // Fire-and-forget AI enrichment — upgrades the deterministic baseline with
  // better wording + a concrete "after" suggestion. Non-fatal if provider absent.
  const trace = {
    runId: run.id, status: run.status, error: run.error,
    steps: (run.steps ?? []).map((s) => ({ title: s.title, toolId: s.toolId, status: s.status, detail: s.detail })),
    sourceRef: run.sourceRef,
  };
  proposeEvolution({ trace }).then((r) => {
    if (r.ok && r.proposal) {
      patchEvolution(evoId, {
        title: r.proposal.title,
        reason: r.proposal.reason,
        summary: r.proposal.summary,
        after: r.proposal.after,
        risk: r.proposal.risk,
        source: "ai",
        model: r.model,
        updatedAt: new Date().toISOString(),
      });
    }
  }).catch(() => {});
}

/* ---- resume after approval / connector / provider becomes available ---- */
export function resumeRun(runId) {
  return withRunLock(runId, async () => {
    const run = getRun(runId);
    if (!run) return { error: "not_found" };
    if (!["waiting_for_approval", "waiting_for_connector", "waiting_for_provider", "retrying", "queued"].includes(run.status)) {
      return { ok: true, status: run.status }; // idempotent — nothing to resume
    }
    return await _drive(runId); // call inner loop directly (already inside the lock)
  });
}

/* ---- cancel a run (denies any pending approval on the current step) ---- */
export function cancelRun(runId) {
  return withRunLock(runId, async () => {
    const run = getRun(runId);
    if (!run) return { error: "not_found" };
    if (["completed", "failed", "cancelled", "expired"].includes(run.status)) return { ok: true, run };
    const step = run.steps[run.cursor];
    if (step?.approvalId) { try { decideApproval(step.approvalId, { decision: "deny", actorId: run.actorId }); } catch { /* ignore */ } }
    patchRun(runId, { status: "cancelled", finishedAt: Date.now(), lease: null });
    appendAudit({ type: "run.cancel", runId, householdId: run.householdId });
    emit(runId, "run.cancelled");
    return { ok: true, run: getRun(runId) };
  });
}

// Find the run currently parked on a given approval (for the decide→resume hook).
export function findRunByApprovalId(approvalId) {
  return listRuns({ limit: 500 }).find((r) => r.steps?.some((s) => s.approvalId === approvalId && s.status === "waiting_for_approval")) ?? null;
}

// Server-owned stale-run expiry: a run parked on an approval whose 30-min TTL has
// lapsed (or was denied/expired) is moved to `expired` so it doesn't linger forever.
// Runs by household; safe to call on an interval. Returns count expired.
// Only genuine TTL lapse expires a parked run here; a `denied` approval is owned by
// the _drive/resumeRun path (→ failed) so the terminal status stays consistent.
export async function expireStaleRuns() {
  let expired = 0;
  const jobs = [];
  for (const r of listRuns({ limit: 1000 })) {
    if (r.status !== "waiting_for_approval") continue;
    const step = r.steps[r.cursor];
    if (!step?.approvalId) continue;
    const appr = getApproval(step.approvalId);
    const stale = !appr || appr.status === "expired" || (appr.expiresAt && Date.now() > appr.expiresAt);
    if (!stale) continue;
    jobs.push(withRunLock(r.id, async () => {
      const run = getRun(r.id);
      if (!run || run.status !== "waiting_for_approval") return; // a concurrent decide won
      patchRunStep(r.id, run.cursor, { status: "expired", detail: "Approval expired before a decision.", finishedAt: Date.now() });
      patchRun(r.id, { status: "expired", error: "approval_expired", finishedAt: Date.now(), lease: null });
      appendAudit({ type: "run.expired", runId: r.id, householdId: run.householdId });
      emit(r.id, "run.expired");
      expired++; // count only runs actually transitioned
    }).catch(() => {}));
  }
  await Promise.all(jobs);
  return expired;
}

// On boot: re-drive runs that were mid-flight when the process stopped. A step left
// in "running" status was interrupted DURING its side effect — to honor at-most-once
// we must NOT re-run it (the effect may already have landed), so we fail it for
// review rather than risk a duplicate action. All other interrupted runs (queued/
// retrying/planning, or a "running" run whose cursor step is pending/ready) re-drive
// safely because `done` steps are skipped via the cursor. Parked (waiting_*) runs
// stay parked until their dependency resolves.
export async function recoverRuns() {
  let recovered = 0, quarantined = 0;
  for (const r of listRuns({ limit: 1000 })) {
    if (!["running", "retrying", "planning", "queued"].includes(r.status)) continue;
    const step = r.steps[r.cursor];
    if (step && step.status === "running") {
      quarantined++;
      withRunLock(r.id, async () => {
        const run = getRun(r.id);
        if (!run) return;
        const cur = run.steps[run.cursor];
        if (!cur || cur.status !== "running") { await _drive(run.id); return; } // changed under us → drive
        patchRunStep(run.id, run.cursor, { status: "failed", detail: "Interrupted mid-execution on restart; not re-run to avoid a duplicate action — please review and retry if needed.", finishedAt: Date.now() });
        patchRun(run.id, { status: "failed", error: "interrupted", finishedAt: Date.now(), lease: null });
        appendAudit({ type: "run.interrupted", runId: run.id, householdId: run.householdId });
        emit(run.id, "run.failed");
      }).catch(() => {});
      continue;
    }
    recovered++;
    driveRun(r.id).catch(() => {});
  }
  if (recovered || quarantined) appendAudit({ type: "engine.recover", recovered, quarantined });
  return recovered;
}
