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
  getRiskOverride, addArtifact, addMemory, listMemory,
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
import { proposeEvolution, INTERNAL_INPUTS } from "./planner.mjs";
import { providerChat } from "./ai.mjs";

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

/* ---- Agentic step execution (data flows BETWEEN steps) ----
 * Two engine capabilities that turn a static plan into a working run:
 *   1. Reasoning steps (toolId:null) actually reason: the LLM works over prior step
 *      results and stores {text, data} — e.g. selecting which message ids to act on.
 *   2. Tool inputs are resolved from prior results before execution — and crucially
 *      BEFORE the approval record is created, so what a human approves is the real,
 *      final input (the consume-once hash then binds exactly that input).
 * Both fail open and honest: with no AI provider they leave the plan's static input
 * untouched and say so, and the downstream tool surfaces its own truthful error. */
const REASONING_SYS = `You execute ONE reasoning step inside a household automation run. Use the run goal, this step's instruction, and prior step results. Be decisive and concrete. Respond with ONLY a JSON object: {"text": string, "data": object|null}. "text" = 1-3 sentence human summary of what you determined. "data" = machine-usable output later steps may need (ids, lists, selections), e.g. {"messageIds": ["abc","def"]}. COMPLETENESS IS MANDATORY: process EVERY item in the prior results, not a sample — if 200 items are present, your selection must consider all 200, and "data" must list every qualifying item's id. Use ONLY real values from prior results — never invent ids. No prose outside the JSON.`;
const FILL_SYS = `You fill the input fields for ONE tool step inside a household automation run, using prior step results. Respond with ONLY a JSON object mapping input keys to STRING values. Rules: keep any provided non-empty value unless it contains a {{template}}; join lists into comma-separated strings; when a prior reasoning step selected a set of items, include EVERY selected id — never a sample or truncation; use ONLY real values from prior results or the run goal — NEVER invent ids or addresses. If a required value truly cannot be determined, set it to "".`;

function activeAiProvider() { return getSettings().aiActiveProvider || null; }

// Item 11 (second half): AUTOMATIC memory-writing. After a run completes, one AI pass
// judges whether the outcome contains a durable household fact/preference/routine worth
// remembering — without the planner having scripted a write_memory step. Strict bar:
// one-off task outcomes are NOT memories. Fire-and-forget (never delays or fails the
// run), deduped against existing memory text, always audited.
const MEMORY_JUDGE_SYS = `You decide whether a completed household-assistant run revealed something DURABLE about the household worth remembering for future runs.
Remember ONLY lasting facts, preferences, routines, or rules (e.g. "The family does taco night on Wednesdays", "Noah's dentist is Dr. Lee").
Do NOT remember one-off task outcomes, generic summaries, or anything already obvious from the run title.
Respond with ONLY JSON: {"remember": boolean, "text": string, "type": "fact"|"preference"|"routine"|"rule"|"insight"}. When remember is false, text may be empty.`;
async function proposeRunMemory(runId) {
  const run = getRun(runId);
  if (!run || run.status !== "completed") return;
  const provider = activeAiProvider();
  if (!provider) return;
  const material = run.steps
    .filter((s) => s.status === "succeeded")
    .map((s) => ({ title: s.title, detail: (s.detail ?? "").slice(0, 300), text: s.result?.text ? String(s.result.text).slice(0, 1200) : null }))
    .slice(0, 12);
  if (!material.length) return;
  const user = `Run title: ${run.title}\n\nStep outcomes (JSON): ${JSON.stringify(material)}`;
  const out = await providerChat(provider, { messages: [{ role: "system", content: MEMORY_JUDGE_SYS }, { role: "user", content: user }] }).catch(() => null);
  if (!out?.ok) return;
  const parsed = extractJSONLoose(out.text);
  const text = String(parsed?.text ?? "").trim();
  if (!parsed?.remember || text.length < 8 || text.length > 500) return;
  // Dedupe: an identical (case-insensitive) memory already exists → no noise.
  const existing = listMemory({ householdId: run.householdId, limit: 500 });
  if (existing.some((m) => String(m.text).trim().toLowerCase() === text.toLowerCase())) return;
  const type = ["fact", "preference", "routine", "rule", "insight"].includes(parsed.type) ? parsed.type : "insight";
  addMemory({ householdId: run.householdId, scope: "household", type, text, source: { runId, actorId: run.actorId, via: "auto" } });
  appendAudit({ type: "run.memory_captured", runId, householdId: run.householdId, memoryType: type });
}
function extractJSONLoose(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf("{"); const last = t.lastIndexOf("}");
  if (first === -1 || last <= first) return null;
  try { return JSON.parse(t.slice(first, last + 1)); } catch { return null; }
}
function priorResultsJSON(run, uptoIndex) {
  const out = [];
  for (let j = 0; j < uptoIndex; j++) {
    const s = run.steps[j];
    if (!s || s.status !== "succeeded") continue;
    let result = s.result ?? s.detail ?? null;
    let str = JSON.stringify(result);
    // Generous per-step budget: a paginated gmail.search of 250 compact messages is
    // ~50KB, and truncating it would silently break the "process EVERY item" contract.
    if (str && str.length > 60000) result = str.slice(0, 60000) + "…(truncated)";
    out.push({ step: j + 1, title: s.title, toolId: s.toolId, result });
  }
  let str = JSON.stringify(out);
  if (str.length > 90000) str = str.slice(0, 90000) + "…";
  return str;
}
function toolInputSchema(resolved) {
  // Internal homeops.* tools declare their inputs in INTERNAL_INPUTS (the same
  // hints the planner uses) — without this the engine saw an empty schema and
  // never threaded their inputs.
  const internalHints = resolved?.kind === "internal" ? INTERNAL_INPUTS[resolved.def?.id] : null;
  const raw = resolved?.tool?.inputs ?? resolved?.def?.input_schema ?? internalHints ?? [];
  return (Array.isArray(raw) ? raw : []).map((f) => ({ key: f.key, label: f.label ?? f.key, required: !!f.required }));
}
// Does this step's input need resolving from prior results (or, for the first
// step, from the run goal itself — a plan's opening web.search often arrives
// with query:"" and must not execute empty)?
function inputNeedsFill(step, schema, stepIndex) {
  const inp = step.input ?? {};
  const hasTemplate = Object.values(inp).some((v) => typeof v === "string" && v.includes("{{"));
  const missingRequired = schema.some((f) => f.required && !String(inp[f.key] ?? "").trim());
  return hasTemplate || missingRequired;
}
// Deterministic input threading — no AI required. URLs come from the most recent
// succeeded step whose result carries one (search results, read pages); queries
// come from the step's own instruction. This keeps runs functional when the AI
// fill is unavailable or returns nothing, instead of executing with empty input.
function deterministicFill(run, stepIndex, step, schema) {
  const filled = { ...(step.input ?? {}) };
  let changed = false;
  for (const f of schema) {
    if (String(filled[f.key] ?? "").trim()) continue;
    if (/(^|_)(url|link|page|href)/i.test(f.key)) {
      for (let j = stepIndex - 1; j >= 0; j--) {
        const s = run.steps[j];
        if (s?.status !== "succeeded" || !s.result) continue;
        const m = JSON.stringify(s.result).match(/https?:\/\/[^"\\\s)>]+/);
        if (m) { filled[f.key] = m[0]; changed = true; break; }
      }
    } else if (/(query|q$|search|topic|text|goal)/i.test(f.key)) {
      const q = String(step.detail || step.title || run.plan?.title || "").trim();
      if (q) { filled[f.key] = q.slice(0, 300); changed = true; }
    }
  }
  return changed ? filled : null;
}
async function fillStepInput(run, stepIndex, step, schema) {
  const provider = activeAiProvider();
  if (!provider) return { filled: null, note: "No AI provider connected — used the plan's original input." };
  const user = `Run goal: ${run.goal ?? run.plan?.title ?? ""}\nPlan summary: ${run.plan?.summary ?? ""}\n\nTool: ${step.toolId}\nStep: ${step.title}${step.detail ? ` — ${step.detail}` : ""}\nInput schema: ${JSON.stringify(schema)}\nCurrent input: ${JSON.stringify(step.input ?? {})}\n\nPrior step results (JSON): ${priorResultsJSON(run, stepIndex)}`;
  const out = await providerChat(provider, { messages: [{ role: "system", content: FILL_SYS }, { role: "user", content: user }] }).catch(() => null);
  if (!out?.ok) return { filled: null, note: `Input resolution unavailable (${out?.error ?? "provider error"}) — used the plan's original input.` };
  const parsed = extractJSONLoose(out.text);
  if (!parsed || typeof parsed !== "object") return { filled: null, note: "Input resolution returned no usable values — used the plan's original input." };
  const filled = { ...(step.input ?? {}) };
  for (const f of schema) {
    if (parsed[f.key] == null) continue;
    const v = parsed[f.key];
    filled[f.key] = Array.isArray(v) ? v.map(String).join(",") : String(v);
  }
  return { filled, note: null };
}

/* ---- authoritative tool resolution (server decides requiresApproval, NOT client) ---- */
function resolveToolBase(toolId) {
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
// Household risk override (item 9): an Owner/Adult Admin may re-class a tool's risk and
// skip its approval gate for THEIR household. Applied here — inside the single server
// authority — so every caller (run steps, catalogs) sees the same effective values.
// baseRequiresApproval is kept so audits can record when a gate was actually bypassed.
function resolveTool(toolId, householdId) {
  const base = resolveToolBase(toolId);
  if (!base || !householdId) return base;
  const ov = getRiskOverride(householdId, toolId);
  if (!ov) return base;
  return {
    ...base,
    baseRequiresApproval: base.requiresApproval,
    requiresApproval: ov.skipApproval ? false : base.requiresApproval,
    risk: ov.riskClass ?? base.risk,
    riskOverridden: true,
  };
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
    const resolved = s.toolId ? resolveTool(s.toolId, session?.householdId) : null;
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
      // Knowledge capture (item 15): a completed run whose reasoning produced a real
      // written result gets saved as a durable artifact — findable later in Files &
      // Knowledge instead of buried in run history. Only substantive text (>120 chars)
      // qualifies, and never when the plan already wrote its own artifact (no dupes).
      try {
        const wroteOwn = run.steps.some((s) => s.toolId === "homeops.create_artifact" && s.status === "succeeded");
        const reasoningText = run.steps
          .filter((s) => !s.toolId && s.status === "succeeded" && s.result?.text)
          .map((s) => s.result.text).join("\n\n").trim();
        if (!wroteOwn && reasoningText.length > 120) {
          addArtifact({ householdId: run.householdId, runId, kind: "run_summary", title: run.title || "Run summary", body: reasoningText.slice(0, 20_000) });
          appendAudit({ type: "run.artifact_captured", runId, householdId: run.householdId });
        }
      } catch { /* knowledge capture is best-effort — never fails the run */ }
      // Automatic memory (item 11b) — fire-and-forget so completion is never delayed.
      void proposeRunMemory(runId).catch(() => {});
      emit(runId, "run.completed");
      return { ok: true, status: "completed" };
    }
    const step = run.steps[i];
    if (["succeeded", "skipped"].includes(step.status)) { patchRun(runId, { cursor: i + 1 }); continue; }

    // Reasoning step (no tool) — the LLM works over prior step results and stores
    // {text, data}; later steps draw on `data` (e.g. which message ids to act on).
    if (!step.toolId) {
      const provider = activeAiProvider();
      if (!provider) {
        patchRunStep(runId, i, { status: "succeeded", detail: `${step.detail || "Reasoning step"} (no AI provider connected — reasoning skipped)`, finishedAt: Date.now() });
        patchRun(runId, { cursor: i + 1 });
        emit(runId, "run.step");
        continue;
      }
      patchRunStep(runId, i, { status: "running", startedAt: step.startedAt ?? Date.now() });
      emit(runId, "run.step");
      const user = `Run goal: ${run.goal ?? run.plan?.title ?? ""}\nPlan summary: ${run.plan?.summary ?? ""}\n\nThis step: ${step.title}\nInstruction: ${step.detail ?? ""}\n\nPrior step results (JSON): ${priorResultsJSON(run, i)}`;
      const out = await providerChat(provider, { messages: [{ role: "system", content: REASONING_SYS }, { role: "user", content: user }] }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
      const parsed = out?.ok ? extractJSONLoose(out.text) : null;
      const text = parsed?.text ? String(parsed.text) : out?.ok ? String(out.text ?? "").slice(0, 400) : null;
      const result = parsed ? { text: text ?? "", data: parsed.data ?? null } : text ? { text, data: null } : null;
      patchRunStep(runId, i, {
        status: "succeeded",
        detail: text ?? `${step.detail || "Reasoning step"} (reasoning unavailable: ${out?.error ?? "provider error"})`,
        result, finishedAt: Date.now(),
      });
      appendAudit({ type: "run.step", runId, toolId: null, ok: true, action: "Reason", householdId: run.householdId, actorId: run.actorId });
      patchRun(runId, { cursor: i + 1 });
      emit(runId, "run.step");
      continue;
    }

    const resolved = resolveTool(step.toolId, run.householdId);
    if (!resolved) {
      patchRunStep(runId, i, { status: "failed", detail: `Unknown tool: ${step.toolId}`, finishedAt: Date.now() });
      return finishFailed(runId, "unknown_tool");
    }
    // When a household override actually bypasses a default approval gate, that fact is
    // audited — approval-skipping is admin-sanctioned but never silent.
    if (resolved.riskOverridden && resolved.baseRequiresApproval && !resolved.requiresApproval && !step.riskOverrideAudited) {
      appendAudit({ type: "run.approval_skipped_by_override", runId, toolId: step.toolId, householdId: run.householdId, actorId: run.actorId });
      patchRunStep(runId, i, { riskOverrideAudited: true });
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

    // Resolve this step's input from prior results (agentic threading) — exactly once,
    // and BEFORE any approval exists, so the human approves the real, final input and
    // the consume-once hash binds it. Never re-fills after an approval was created.
    if (!step.inputResolved && !step.approvalId) {
      const schema = toolInputSchema(resolved);
      if (inputNeedsFill(step, schema, i)) {
        const { filled, note } = await fillStepInput(run, i, step, schema);
        // AI fill unavailable or incomplete → deterministic threading before giving up.
        const missing = (inp) => schema.some((f) => f.required && !String((inp ?? {})[f.key] ?? "").trim());
        let finalInput = filled;
        if (!finalInput || missing(finalInput)) {
          const det = deterministicFill(run, i, { ...step, input: finalInput ?? step.input }, schema);
          if (det) finalInput = det;
        }
        if (finalInput) {
          patchRunStep(runId, i, { input: finalInput, inputResolved: true, detail: step.detail });
          appendAudit({ type: "run.input_resolved", runId, toolId: step.toolId, keys: Object.keys(finalInput), householdId: run.householdId });
        } else {
          patchRunStep(runId, i, { inputResolved: true, detail: note ? `${step.detail ?? step.title} — ${note}` : step.detail });
        }
        run = getRun(runId);
      } else {
        patchRunStep(runId, i, { inputResolved: true });
      }
    }
    // Re-read the step: its input may have just been resolved; everything below
    // (approval, hash, execution) must use the FINAL input.
    const stepNow = getRun(runId).steps[i];

    // Approval gate — create the approval, park, and return until a human decides.
    if (resolved.requiresApproval) {
      if (!stepNow.approvalId) {
        const a = createApproval({ actorId: run.actorId, householdId: run.householdId, connectorId: resolved.connectorId, toolId: stepNow.toolId, input: stepNow.input, risk: resolved.risk, category: resolved.action, preview: stepNow.title });
        patchRunStep(runId, i, { status: "waiting_for_approval", approvalId: a.id });
        patchRun(runId, { status: "waiting_for_approval" });
        appendAudit({ type: "run.await_approval", runId, toolId: stepNow.toolId, approvalId: a.id, householdId: run.householdId });
        // Push-notify the household — crucial for scheduled/trigger runs that park with
        // no browser open. Fire-and-forget; no-op when no device tokens are registered.
        pushApprovalNotification(a).catch(() => {});
        emit(runId, "run.waiting_for_approval");
        return { ok: true, status: "waiting_for_approval", approvalId: a.id };
      }
      const appr = getApproval(stepNow.approvalId);
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
    const idem = idempotencyKey(runId, i, stepNow.toolId, JSON.stringify(stepNow.input ?? {}));
    const prior = checkIdempotency(idem);
    if (prior?.done) {
      patchRunStep(runId, i, { status: "succeeded", detail: prior.summary ?? "Already done.", finishedAt: Date.now(), idempotencyKey: idem });
      patchRun(runId, { cursor: i + 1 });
      emit(runId, "run.step");
      continue;
    }

    const attempts = (stepNow.attempts ?? 0) + 1;
    patchRunStep(runId, i, { status: "running", startedAt: stepNow.startedAt ?? Date.now(), idempotencyKey: idem, attempts });
    emit(runId, "run.step");

    // Consume the approval atomically with the FROZEN input (hash must match).
    let approvalId;
    if (resolved.requiresApproval) {
      const c = consumeApproval({ id: stepNow.approvalId, actorId: run.actorId, householdId: run.householdId, toolId: stepNow.toolId, input: stepNow.input });
      if (c.error) {
        patchRunStep(runId, i, { status: "failed", detail: c.error, finishedAt: Date.now() });
        appendAudit({ type: "run.step", runId, toolId: stepNow.toolId, ok: false, error: c.error, householdId: run.householdId });
        return finishFailed(runId, c.error);
      }
      approvalId = c.approval.id;
    }

    let out;
    const t0 = Date.now();
    try {
      out = await withTimeout(execResolved(resolved, stepNow.input, { householdId: run.householdId, actorId: run.actorId, runId, accountId: run.params?.accountId }, approvalId), RUN_STEP_TIMEOUT_MS);
    } catch (e) {
      out = { ok: false, error: "timeout", message: String(e?.message ?? e) };
    }
    const durationMs = Date.now() - t0;
    // First-class trace fields (P3.2): who acted, which account/connector, the input
    // hash, and the approval consumed — enough to explain why an automation acted.
    appendToolCall(runId, i, { ok: !!out.ok, error: out.ok ? null : out.error, durationMs, approvalId: approvalId ?? null, actorId: run.actorId, accountId: run.params?.accountId ?? null, connectorId: resolved.connectorId ?? null, attribution: resolved.kind, inputHash: hashInput(stepNow.input), resultSummary: out.ok ? summarize(out.result) : (out.message ?? out.error) });
    appendAudit({ type: "run.step", runId, toolId: stepNow.toolId, connectorId: resolved.connectorId, ok: !!out.ok, error: out.ok ? undefined : out.error, action: resolved.action, householdId: run.householdId, actorId: run.actorId });

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
