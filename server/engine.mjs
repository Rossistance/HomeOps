// FamiliOS AI — durable, server-side run executor (the canonical runtime).
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
  appendAudit, getSettings, recordAiUsage, aiBudgetExhausted,
  idempotencyKey, checkIdempotency, recordIdempotency, withRunLock, hashInput,
  getRiskOverride, addArtifact, addMemory, listMemory, addNotification,
} from "./store.mjs";
import { findToolGlobal } from "./providers.mjs";
import { listConnectors, executeTool, toolActionOf } from "./connectors.mjs";
import { listAccountsFor } from "./accounts.mjs";
import { apiForAccount } from "./oauth.mjs";
import { getInternalFunction } from "./internal-functions.mjs";
import { NATIVE_ACTIONS } from "./actions/registry.mjs";
import { getAgent, getMember } from "./store.mjs";
import { roleAtLeast } from "./auth.mjs";
import { isToolStepAllowed } from "./helper-shape.mjs";
import { resolveEffectivePolicy, reachesOutside, BLOCKED } from "./policy.mjs";
import { pushApprovalNotification } from "./notify.mjs";
import { INTERNAL_INPUTS, claimsExternalEffect } from "./context.mjs";
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

/* ---- Run-finished hooks (C-intel): observers of terminal runs ----
 * Registered by higher layers (assistant self-healing, conversation result
 * append). Fire-and-forget: a hook can never delay or fail the engine. */
const _runFinishedHooks = [];
export function onRunFinished(cb) { _runFinishedHooks.push(cb); }
function fireRunFinished(runId) {
  const run = getRun(runId);
  if (!run) return;
  for (const cb of _runFinishedHooks) {
    try { void Promise.resolve(cb(run)).catch(() => {}); } catch { /* observer-only */ }
  }
  // The per-run EventEmitter was never released — one live emitter per run for the life of
  // the process. A finished run's SSE subscribers get their terminal event first (emitted
  // just before this hook fires); a minute later the entry goes.
  const t = setTimeout(() => emitters.delete(runId), 60_000);
  if (typeof t.unref === "function") t.unref();
}

/* ---- WP-004: PARKED-RUN hooks (ISS-004) ----
 * A run that parks for approval used to emit an SSE event and nothing else. With no
 * browser open — the normal case for a 7 AM scheduled fire — the conversation kept its
 * last optimistic line ("On it —") forever and the family learned nothing (EV-013).
 * Parking is a real, reportable outcome, so it gets a hook of its own.
 * Fired at most ONCE per run (a resume that re-parks on a LATER step fires again, but
 * re-entering _drive on the same parked step does not — that duplicate message is the
 * failure mode this guard exists to prevent). */
const _runParkedHooks = [];
export function onRunParked(cb) { _runParkedHooks.push(cb); }
const _parkedAnnounced = new Set();
function fireRunParked(runId, { stepIndex, approvalId, expiresAt } = {}) {
  const key = `${runId}:${stepIndex}`;
  if (_parkedAnnounced.has(key)) return;
  _parkedAnnounced.add(key);
  if (_parkedAnnounced.size > 5000) _parkedAnnounced.clear(); // bounded; re-announce is benign
  const run = getRun(runId);
  if (!run) return;
  for (const cb of _runParkedHooks) {
    try { void Promise.resolve(cb(run, { stepIndex, approvalId, expiresAt })).catch(() => {}); } catch { /* observer-only */ }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(promise, ms) {
  // The timer is cleared however the race ends: left running, every call held a live timer
  // for its whole limit (60 s a step, five minutes after a native run_helper).
  let timer;
  const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("step_timeout")), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}
function summarize(result) {
  if (result == null) return "ok";
  const s = typeof result === "string" ? result : JSON.stringify(result);
  return s.slice(0, 200);
}
function externalActionsEnabled(householdId) { return getSettings(householdId).externalActionsEnabled !== false; }

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

function activeAiProvider(householdId) { return getSettings(householdId).aiActiveProvider || null; }

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
  // WP-101 slice 3: a partially-failed run still did real work whose succeeded steps can
  // hold a durable household fact — the judge below only ever reads succeeded steps.
  if (!run || !["completed", "partially_failed"].includes(run.status)) return;
  const provider = activeAiProvider(run.householdId);
  if (!provider) return;
  const material = run.steps
    .filter((s) => s.status === "succeeded")
    .map((s) => ({ title: s.title, detail: (s.detail ?? "").slice(0, 300), text: s.result?.text ? String(s.result.text).slice(0, 1200) : null }))
    .slice(0, 12);
  if (!material.length) return;
  if (aiBudgetExhausted(run.householdId)) return; // optional enrichment — budget saves it for real work
  const user = `Run title: ${run.title}\n\nStep outcomes (JSON): ${JSON.stringify(material)}`;
  recordAiUsage(run.householdId, "run");
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
  // Send-style content fields (an email/message body) are frequently schema-optional,
  // yet a briefing must never go out with just a subject. Treat an empty body/message/
  // content field as needing a fill so it gets threaded from the prior composed step.
  const missingContent = schema.some((f) => /^(body|message|content)$/i.test(f.key) && !String(inp[f.key] ?? "").trim());
  return hasTemplate || missingRequired || missingContent;
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
    if (/^(body|message|content)$/i.test(f.key)) {
      // Thread the composed prose from the most recent step that produced text (a
      // reasoning step, a created artifact, a summary) so a send step never goes out
      // empty. This is what was missing when briefing emails shipped as subject-only.
      for (let j = stepIndex - 1; j >= 0; j--) {
        const s = run.steps[j];
        if (s?.status !== "succeeded" || !s.result) continue;
        const r = s.result;
        const text = typeof r === "string" ? r : (r.text ?? r.body ?? r.answer ?? r.summary ?? r.content ?? null);
        if (text && String(text).trim().length > 20) { filled[f.key] = String(text); changed = true; break; }
      }
    } else if (/(^|_)(url|link|page|href)/i.test(f.key)) {
      for (let j = stepIndex - 1; j >= 0; j--) {
        const s = run.steps[j];
        if (s?.status !== "succeeded" || !s.result) continue;
        const m = JSON.stringify(s.result).match(/https?:\/\/[^"\\\s)>]+/);
        if (m) { filled[f.key] = m[0]; changed = true; break; }
      }
    } else if (/^eventid$/i.test(f.key)) {
      // Entity-id threading (UC-19): a multi-step family-event skill creates the event
      // in step 1 (homeops.create_event_draft / plan_meal) and the follow-on steps
      // (update_event_checklist, assign_driver, assign_what_to_bring) all need that
      // fresh eventId. With no AI provider the agentic fill is unavailable, so thread
      // it deterministically here. Deliberately NARROW: only fills a required, empty
      // `eventId` field, and only from a prior succeeded step whose returned id is an
      // event id (`ev_` prefix). It never touches member-reference ids like driverId.
      for (let j = stepIndex - 1; j >= 0; j--) {
        const s = run.steps[j];
        if (s?.status !== "succeeded" || !s.result) continue;
        // A declared action returns the whole record ({ event }); the older tools return
        // a flat id. Both thread.
        const id = s.result.eventId ?? s.result.id ?? s.result.event?.id;
        if (id && String(id).startsWith("ev_")) { filled[f.key] = String(id); changed = true; break; }
      }
    } else if (/(query|q$|search|topic|text|goal)/i.test(f.key)) {
      const q = String(step.detail || step.title || run.plan?.title || "").trim();
      if (q) { filled[f.key] = q.slice(0, 300); changed = true; }
    }
  }
  return changed ? filled : null;
}
async function fillStepInput(run, stepIndex, step, schema) {
  const provider = activeAiProvider(run.householdId);
  if (!provider) return { filled: null, note: "No AI provider connected — used the plan's original input." };
  if (aiBudgetExhausted(run.householdId)) return { filled: null, note: "Daily AI budget reached — used the plan's original input." };
  recordAiUsage(run.householdId, "run");
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

/* What the chat verdict for a queued step was computed from (orchestrate stamps it on
 * sourceRef; clientSourceRef strips it from a request body). Only a boolean counts. */
const actorIsAdultOf = (run) => (typeof run?.sourceRef?.actorIsAdult === "boolean" ? run.sourceRef.actorIsAdult : null);

/* THE ONE NATIVE APPROVAL (ADR-004 decision C). A native famili.* write waits for an adult in
 * exactly one case: a non-adult asked for it in the family group thread. Nothing else — no
 * stance, autonomy tier or per-tool setting — makes a native write ask (decision A), and a
 * read never asks. `actorIsAdult` must be the boolean false, not merely absent: absent is "not
 * stated", which leaves the ladder alone everywhere else. Shared by the chat lane
 * (runNativeAction) and the run engine (resolveToolBase), so the two cannot disagree. */
export function nativeRequiresApproval(action, { channel = null, actorIsAdult = null } = {}) {
  return action?.action === "Write" && channel === "group" && actorIsAdult === false;
}

/* ---- authoritative tool resolution (server decides requiresApproval, NOT client) ---- */
// `runCtx` is what a run recorded about who asked and where (its sourceRef): only a native
// action reads it, to decide decision C above. Every other kind ignores it.
function resolveToolBase(toolId, runCtx = null) {
  const internal = getInternalFunction(toolId);
  if (internal) return { kind: "internal", def: internal, requiresApproval: !!internal.requiresApproval, action: internal.action, risk: internal.risk, connectorId: internal.connectorId, connectorName: internal.connectorName };
  /* The native lane (ADR-004 Stage 2): reachable by a run so a step parked for an adult can
   * execute once one approves. Only lane:"native" actions — never an HTTP-only declared read. */
  const native = NATIVE_ACTIONS.find((a) => a.id === toolId);
  if (native) {
    return {
      kind: "native", def: native,
      requiresApproval: nativeRequiresApproval(native, { channel: runCtx?.channel ?? null, actorIsAdult: typeof runCtx?.actorIsAdult === "boolean" ? runCtx.actorIsAdult : null }),
      action: native.action, risk: native.risk, connectorId: native.connectorId, connectorName: native.connectorName,
    };
  }
  const platform = findToolGlobal(toolId);
  if (platform) return { kind: "provider", provider: platform.provider, tool: platform.tool, requiresApproval: !!platform.tool.requiresApproval, action: platform.tool.action, risk: platform.tool.risk, connectorId: platform.provider.id, connectorName: platform.provider.name };
  const conn = listConnectors().find((x) => x.tools.some((t) => t.id === toolId));
  const tool = conn?.tools.find((t) => t.id === toolId);
  if (tool) return { kind: "connector", connector: conn, tool, requiresApproval: !!tool.requiresApproval, action: tool.action, risk: tool.risk, connectorId: conn.id, connectorName: conn.name };
  // Registered functions (Slice 4): user-authored capabilities. requiresApproval is
  // server-authoritative (never relaxes below the wrapped tool); the "available"
  // gate is re-checked at execution in execResolved.
  return null;
}
// Household risk override (item 9): an Owner/Adult Admin may re-class a tool's risk and
// skip its approval gate for THEIR household. Applied here — inside the single server
// authority — so every caller (run steps, catalogs) sees the same effective values.
// baseRequiresApproval is kept so audits can record when a gate was actually bypassed.
// actorId is threaded so a nest's own risk rules apply to its members' runs (Cluster W);
// omitted, it resolves the household's rule, which is the correct default for anything
// running without a person behind it.
function resolveTool(toolId, householdId, actorId = null, runCtx = null) {
  const base = resolveToolBase(toolId, runCtx);
  if (!base || !householdId) return base;
  const ov = getRiskOverride(householdId, toolId, actorId);
  // Always hand back a FRESH object: the agent-policy pass below refines
  // requiresApproval per run, and resolveToolBase may return a registered-function
  // record that other callers share. Mutating that would leak across runs.
  if (!ov) return { ...base };
  return {
    ...base,
    baseRequiresApproval: base.requiresApproval,
    requiresApproval: ov.skipApproval ? false : base.requiresApproval,
    risk: ov.riskClass ?? base.risk,
    riskOverridden: true,
  };
}

/* WHO A NATIVE STEP RUNS AS: the person who asked, with the role recorded when the run
 * started (sourceRef.actorRole, server-assigned). If that person's standing has changed
 * since — a promotion or a demotion while the step waited for an adult — the LOWER of the two
 * roles applies: an approval must never widen what the asker may touch, and a demotion or
 * removal in between is honoured rather than outlived. A removed member runs as no one. */
function requesterRole(run) {
  const stored = typeof run?.sourceRef?.actorRole === "string" ? run.sourceRef.actorRole : null;
  if (!stored) return null;
  const member = run.actorId ? getMember(run.actorId) : null;
  if (member?.archived) return null;
  const current = member?.role ?? null;
  if (!current || current === stored) return stored;
  return roleAtLeast(current, stored) ? stored : current;
}

// Execute a resolved tool. For gated steps this is called only AFTER the approval
// has been consumed. Returns { ok, result } | { ok:false, error, message, waiting? }.
async function execResolved(resolved, input, ctx, approvalId) {
  if (resolved.kind === "internal") {
    // Defence in depth for the kill switch. The policy layer refuses an outside-reaching
    // capability while external actions are paused, but that layer only runs for a run
    // that names an agent (`run.sourceRef.agentId`) — and one caller creates runs without
    // one: the self-repair path in assistant-runs.mjs. `kind:"internal"` was then the ONE
    // execution path with no kill-switch check of its own (provider has the check below,
    // connector tools re-check inside executeTool), so homeops.notify_contact could text a
    // family whose switch was off. Local internal writes are unaffected — see
    // reachesOutside() for why `delivers` and not `action` decides that.
    if (!externalActionsEnabled(ctx.householdId)
        && reachesOutside({ action: resolved.action, delivers: resolved.def?.delivers ?? false })) {
      return { ok: false, error: "external_actions_disabled", message: "External actions are paused by the household kill switch." };
    }
    // WP-005: the acting AGENT travels with the call. homeops.notify_contact enforces
    // the recipient's per-agent allowlist, and it cannot do that without knowing who
    // is acting — an unattributed send would silently skip that gate.
    return await resolved.def.run({ householdId: ctx.householdId, actorId: ctx.actorId, runId: ctx.runId, agentId: ctx.agentId ?? null }, input);
  }
  if (resolved.kind === "native") {
    /* A native action's body reads the session and the channel (actions/native/*), so its
     * ctx is rebuilt from the run: the REQUESTER's role (requesterRole below — never the
     * approver's, so an adult's approval cannot widen what the asker may touch; the body's own
     * ownership checks still run) and the channel the request came from. A run that recorded
     * no requester role — anything not queued by the chat lane, e.g. a hand-rolled plan
     * posted to /api/runs/start, whose sourceRef cannot carry one — is refused rather than
     * run as nobody in particular. The run's own step timeout is the action's (see _drive). */
    if (!ctx.role) return { ok: false, error: "no_requester_role", message: "This step can only run for the person who asked for it, and this run doesn't say who that was — nothing was changed." };
    const session = { householdId: ctx.householdId, actorId: ctx.actorId, role: ctx.role, ...(ctx.actorName ? { actorName: ctx.actorName } : {}) };
    return await resolved.def.invoke({
      householdId: ctx.householdId, actorId: ctx.actorId, role: ctx.role, channel: ctx.channel ?? "personal", session,
      via: "agent", runId: ctx.runId ?? null, agentId: ctx.agentId ?? null, asHelper: false,
    }, input);
  }
  if (resolved.kind === "provider") {
    if (!externalActionsEnabled(ctx.householdId) && ["Write", "Send", "Download"].includes(resolved.action)) {
      return { ok: false, error: "external_actions_disabled", message: "External actions are paused by the household kill switch." };
    }
    const accounts = listAccountsFor(ctx.householdId, ctx.actorId).filter((a) => a.provider === resolved.provider.id);
    const account = ctx.accountId ? accounts.find((a) => a.id === ctx.accountId) : accounts[0];
    if (!account) return { ok: false, error: "not_connected", message: `Connect your ${resolved.provider.name} account to use this tool.`, waiting: "connector" };
    try {
      const result = await resolved.tool.run(apiForAccount(account), input);
      return { ok: true, result };
    } catch (e) {
      // Provider tools flag validation failures via e.code so the run records the
      // honest cause (invalid_input) instead of a generic provider error.
      return { ok: false, error: e?.code === "invalid_input" ? "invalid_input" : "provider_error", message: String(e?.message ?? e) };
    }
  }
  /* connector tool — executeTool re-checks readiness + kill switch.
   *
   * TWO ways a gated connector tool is allowed to run, and only one of them used to be
   * wired. A consumed approval is the obvious one. The other is a POLICY GRANT: an Owner
   * letting a helper run high-risk steps unattended (agent.unattended_high_risk), a
   * household set to Trusted (household.autonomy_trusted), or a per-tool risk override
   * (household.risk_override). In all three the policy layer resolves the capability to
   * "no approval needed" and no approval record is ever created, so approvalId is
   * undefined here and executeTool's own gate — which re-reads the STATIC registry flag,
   * not the verdict — refused anyway. The grant was honoured everywhere except the layer
   * that acts on it, so a family could turn every dial they own and still be told their
   * text needed approval.
   *
   * `policyCleared` carries the verdict the gate should be reading. It is deliberately
   * NOT folded into approvalConsumed: those are different claims, and the audit trail
   * should not say an approval was consumed when none existed. The direct
   * /api/tools/:id/execute route passes neither, so its gate is untouched. */
  return await executeTool(resolved.tool.id, input, {
    actorId: ctx.actorId, householdId: ctx.householdId, requestId: ctx.runId,
    approvalConsumed: !!approvalId, approvalId,
    policyCleared: resolved.requiresApproval === false,
  });
}

/* ================= CHAT TOOL EXECUTION (assistant-agent.mjs) =================
 * The Ask Famili agent loop calls tools one at a time, observes the result, and decides
 * what to do next. A read, or a write the policy allows outright, executes HERE — through
 * the SAME resolveTool → agent policy → effective-policy → execResolved chain a run step
 * goes through, so a chat turn can never do something a run could not. Anything that
 * resolves to NEEDS_APPROVAL is NOT executed here: the caller starts a durable one-step
 * run for it (orchestrate → startRun), which creates the approval, parks, and later
 * consumes the approval exactly as every scheduled run does. This function only ever
 * reports that verdict (`needsApproval: true`).
 *
 * Returns one of:
 *   { ok: true,  result, resolved }                      executed
 *   { ok: false, needsApproval: true, resolved }         caller must queue a run
 *   { ok: false, error, message, policyBlocked?: true }  refused or failed (model sees why)
 */
/* `actorIsAdult` is OPT-IN, and deliberately not derived from session.role here.
 *
 * Reading it off the session would switch policy rule 4b on for every caller at once —
 * including the app and 1:1 texts, where a Limited Member in a Balanced household would
 * abruptly start needing approval for things that have always just worked. That is a
 * behaviour change families would feel as new nagging, and it is not what was asked for.
 * The rule itself is written channel-agnostically; only the group lane passes the flag,
 * so widening it later is a change at a call site rather than a rewrite of the policy. */
export async function executeToolForChat({ toolId, input = {}, session, agent = null, conversationId = null, actorIsAdult = null } = {}) {
  const householdId = session?.householdId;
  const actorId = session?.actorId ?? null;
  if (!householdId) return { ok: false, error: "no_session", message: "No household session." };
  const resolved = resolveTool(toolId, householdId, actorId);
  if (!resolved) return { ok: false, error: "unknown_tool", message: `There is no tool called "${toolId}".` };
  const meta = () => ({ toolId, action: resolved.action, risk: resolved.risk, connectorId: resolved.connectorId ?? null, connectorName: resolved.connectorName ?? null, requiresApproval: !!resolved.requiresApproval });
  const gate = gateToolCall({
    cap: {
      id: toolId,
      name: resolved.tool?.name ?? resolved.def?.name ?? toolId,
      requiresApproval: resolved.baseRequiresApproval ?? resolved.requiresApproval,
      risk: resolved.risk,
      action: resolved.action,
      delivers: resolved.tool?.delivers ?? resolved.def?.delivers ?? false,
      external: resolved.kind === "provider" || resolved.kind === "connector",
    },
    toolId, agent, householdId, actorId, conversationId, actorIsAdult,
    requiresApproval: resolved.requiresApproval,
  });
  if (gate.blocked) return { ok: false, error: gate.error, message: gate.message, policyBlocked: true, resolved: meta() };
  if (gate.decision) {
    resolved.requiresApproval = gate.decision.requiresApproval;
    resolved.policy = gate.decision;
  }
  if (gate.needsApproval) return { ok: false, needsApproval: true, resolved: meta() };
  // Kill switch for an UNATTRIBUTED chat turn — execResolved covers internal + provider
  // tools and executeTool covers connectors, so this mirrors the run path exactly.
  let out;
  const t0 = Date.now();
  try {
    out = await withTimeout(execResolved(resolved, input, { householdId, actorId, runId: null, accountId: null, agentId: agent?.id ?? null }, undefined), RUN_STEP_TIMEOUT_MS);
  } catch (e) {
    out = { ok: false, error: "timeout", message: String(e?.message ?? e) };
  }
  appendAudit({ type: "assistant.tool", toolId, connectorId: resolved.connectorId ?? null, ok: !!out?.ok, error: out?.ok ? undefined : out?.error, action: resolved.action, durationMs: Date.now() - t0, householdId, actorId, conversationId });
  if (!out) return { ok: false, error: "no_result", message: "The tool returned nothing.", resolved: meta() };
  if (out.ok) return { ok: true, result: out.result ?? null, resolved: meta() };
  return { ok: false, error: out.error ?? "tool_failed", message: out.message ?? out.error ?? "The tool failed.", waiting: out.waiting, needsSetup: out.needsSetup, resolved: meta() };
}

/* THE LADDER A CHAT TOOL CALL MEETS, as one function, so the two ways a chat turn calls a
 * tool — the catalog (executeToolForChat, above) and the native famili.* lane
 * (runNativeAction, below) — cannot drift apart: the agent's allow/deny lists
 * (isToolStepAllowed), then resolveEffectivePolicy with the household's settings, its risk
 * override and — in the group lane only — whether the person asking is an adult. A refusal
 * writes the same assistant.tool_blocked row and names the same error either way.
 *
 * `cap.requiresApproval` is the capability's BASE gate, the one the policy reasons from;
 * `requiresApproval` is the gate as it stands before the ladder (a household risk override
 * may already have cleared it), which is all that decides when there is no acting agent —
 * exactly as executeToolForChat always behaved. `decision` is null in that case.
 *
 * Returns { blocked, needsApproval, decision, error, message }. */
export function gateToolCall({ cap, toolId, agent = null, householdId, actorId = null, conversationId = null, actorIsAdult = null, requiresApproval } = {}) {
  // Not a boolean (absent, or null) → the capability's own gate; never "no gate" by accident.
  const preLadder = typeof requiresApproval === "boolean" ? requiresApproval : !!cap?.requiresApproval;
  if (!agent) return { blocked: false, needsApproval: preLadder, decision: null, error: null, message: null };
  const verdict = isToolStepAllowed(agent, toolId, { householdId, actorId });
  if (!verdict.ok) {
    appendAudit({ type: "assistant.tool_blocked", toolId, agentId: agent.id, reason: verdict.reason, householdId, actorId, conversationId });
    return { blocked: true, needsApproval: false, decision: null, error: `not_permitted_${verdict.reason}`, message: verdict.message ?? "Not permitted for this helper." };
  }
  const decision = resolveEffectivePolicy({
    cap,
    agent,
    settings: getSettings(householdId),
    override: getRiskOverride(householdId, toolId, actorId),
    actorIsAdult,
  });
  if (decision.decision === BLOCKED) {
    appendAudit({ type: "assistant.tool_blocked", toolId, agentId: agent.id, rule: decision.rule, reason: decision.reason, householdId, actorId, conversationId });
    return { blocked: true, needsApproval: false, decision, error: `policy_${decision.rule}`, message: decision.reason };
  }
  return { blocked: false, needsApproval: !!decision.requiresApproval, decision, error: null, message: null };
}

/* ================= THE NATIVE LANE (ADR-004 Stage 1) =================
 * The famili.* tools the chat loop offers itself (actions/native/*). They are declared
 * actions, but not catalog tools: their bodies read the session and the channel, which
 * execResolved's ctx cannot carry. What they now share with every catalog tool is the gate
 * above, a per-action timeout and the engine's audit row. What the gate can actually do to a
 * native tool in Stage 1 is narrower than "the ladder": a helper's allow/deny lists (rules
 * 2/3) reach it for the first time, and "always ask me" / autoAllow (rules 4 and 6) refuse
 * it, below. Rule 1 cannot fire — a native write is local, and its Google calls ask
 * googleReachAllowed() inside run — and rules 4b and 5 act only on a capability that
 * requires approval by default, which no native tool does until Stage 2.
 *
 * Every native action is requiresApproval:false, so the ladder's verdict is ALLOWED for every
 * stance — with two exceptions an agent can still produce: "always ask me" (rule 4) and an
 * autoAllow listed for a write (rule 6 refuses to relax a high-stakes step, and every Write
 * is high-stakes there). Parking a native write for approval needs the run engine to resolve
 * it, which is Stage 2. Until then such a call is REFUSED, honestly and in words the model can
 * repeat — never executed, never silently dropped.
 *
 * Returns the action's own { ok, result } | { ok:false, error, message } — or, refused by
 * policy, { ok:false, error, message, policyBlocked:true } with the errors
 * executeToolForChat uses. */
const NATIVE_APPROVAL_LATER = "This helper is set to ask before doing this, and approvals for this tool arrive in a later update — nothing was done.";
export async function runNativeAction({ action, input = {}, session, agent = null, channel = "personal", conversationId = null, asHelper = false, actorIsAdult = null } = {}) {
  const householdId = session?.householdId;
  const actorId = session?.actorId ?? null;
  if (!householdId) return { ok: false, error: "no_session", message: "No household session." };
  const toolId = action.id;
  const cap = { id: toolId, name: action.name, requiresApproval: false, risk: action.risk, action: action.action, delivers: false, external: false };
  const gate = gateToolCall({ cap, toolId, agent, householdId, actorId, conversationId, actorIsAdult });
  if (gate.blocked) return { ok: false, error: gate.error, message: gate.message, policyBlocked: true };
  if (gate.needsApproval) {
    /* One sentence of our own, not the ladder's reason: rule 6's says "…it still needs you",
     * promising an ask that Stage 1 cannot make. The row keeps the ladder's reason, the same
     * shape as every other assistant.tool_blocked row. */
    const rule = gate.decision?.rule ?? "capability.requires_approval";
    appendAudit({ type: "assistant.tool_blocked", toolId, agentId: agent?.id ?? null, rule, reason: gate.decision?.reason ?? null, householdId, actorId, conversationId });
    return { ok: false, error: `policy_${rule}`, message: NATIVE_APPROVAL_LATER, policyBlocked: true };
  }
  const ctx = { householdId, actorId, role: session.role, channel, session, via: "agent", runId: null, agentId: agent?.id ?? null, asHelper: !!asHelper };
  let out;
  const t0 = Date.now();
  try {
    out = await withTimeout(action.invoke(ctx, input), action.timeoutMs);
  } catch (e) {
    out = { ok: false, error: e?.message === "step_timeout" ? "timeout" : "tool_failed", message: String(e?.message ?? e) };
  }
  appendAudit({ type: "assistant.tool", toolId, connectorId: action.connectorId ?? "homeops", ok: !!out?.ok, error: out?.ok ? undefined : out?.error, action: action.action, durationMs: Date.now() - t0, householdId, actorId, agentId: agent?.id ?? null, conversationId });
  return out;
}

const WAITING_CONNECTOR_RE = /not_configured|not_connected|not_authorized|connector_|runtime_unavailable/;

/* ============ WP-101 slice 3 (ISS-110): HONEST TERMINAL STATUS AGGREGATION ============
 * A parent run must never report success when a child step it depended on failed.
 *
 * Before this, the loop below had exactly two endings: any hard failure returned through
 * `finishFailed` (→ "failed"), and reaching the end of the plan wrote "completed"
 * UNCONDITIONALLY — including when a step had been SOFT-failed on the way past. The
 * soft-fail rule (see the "SOFT failure for read-only enrichment steps" comment further
 * down) is genuinely right: one bot-walled recipe page must not kill a ten-step plan.
 * But it left the step honestly marked `failed` inside a run whose own status said
 * "completed", so every consumer above it — the trigger's lastStatus, the run chip, the
 * digest — read a run that partly failed as a run that worked.
 *
 * The truth table, expressed in this engine's existing vocabulary ("completed" IS the
 * success terminal — it is what every client, route, and stored run already says):
 *   • no failed steps                     → completed         (all required children succeeded)
 *   • any REQUIRED child failed           → failed            (never success, never partial)
 *   • only OPTIONAL/soft-failed children  → partially_failed  (never success)
 *
 * "Optional" is not guessed from a step's shape: it is recorded at the moment the engine
 * DECIDES to continue past a failure, by stamping `softFailed: true` on that step. Any
 * other failed step is required by definition — the engine would have stopped for it —
 * so a future path that fails a step and keeps going without opting into soft-fail
 * lands on `failed` here, not on a quiet "completed". Fail-closed, on purpose.
 *
 * Rollback: HOMEOPS_PARTIAL_FAILURE_STATUS=off restores the pre-WP-101 terminal exactly
 * (soft failures end "completed"), for the window before every consumer of the run-status
 * enum — server/assistant-runs.mjs, index.mjs's TERMINAL_RUN, src/store/useStore.ts's
 * runStatusView/mapRunStatus — has learned the new state.
 */
export const TERMINAL_RUN_STATUSES = ["completed", "partially_failed", "failed", "cancelled", "expired"];
function partialFailureStatusEnabled() {
  return String(process.env.HOMEOPS_PARTIAL_FAILURE_STATUS ?? "on").trim().toLowerCase() !== "off";
}

/** Pure classifier over a run record — exported for the truth-table unit test.
 *  Returns { status, error, required, optional }: `status` is the terminal the run has
 *  EARNED, `required`/`optional` are the failed steps in each class. */
export function classifyRunOutcome(run) {
  const failed = (run?.steps ?? []).filter((s) => s?.status === "failed");
  const optional = failed.filter((s) => s?.softFailed === true);
  const required = failed.filter((s) => s?.softFailed !== true);
  if (required.length) return { status: "failed", error: "required_step_failed", required, optional };
  if (optional.length) {
    return partialFailureStatusEnabled()
      ? { status: "partially_failed", error: "partial_step_failure", required, optional }
      : { status: "completed", error: null, required, optional };
  }
  return { status: "completed", error: null, required, optional };
}

/* ---- start a run from a concrete plan ---- */
// Graceful-shutdown support: once draining, new runs are refused (existing runs
// finish their current step and park via lease release — recovery re-drives them
// on the next boot). Flipped by the SIGTERM handler in index.mjs.
let _draining = false;
export function setDraining(v = true) { _draining = !!v; }

/** Release every live lease without changing run state — the shutdown handoff.
 * recoverRuns() on next boot re-drives them (idempotent steps resume; mid-write
 * non-idempotent steps quarantine per at-most-once policy). */
export function releaseAllLeases() {
  let released = 0;
  for (const r of listRuns({ limit: 1000 })) {
    if (r.lease) { patchRun(r.id, { lease: null }); released++; }
  }
  return released;
}

export async function startRun({ source = "manual", sourceRef = {}, plan, params = {}, session, title, visibility, goal } = {}) {
  // Callers treat the return as a run record, so refuse loudly while draining
  // (the window is seconds long; clients surface the message and retry).
  if (_draining) throw new Error("server_restarting: an update is deploying — try again in about a minute.");
  const runId = "run_" + crypto.randomBytes(10).toString("hex");
  const now = Date.now();
  const steps = (plan?.steps ?? []).map((s, i) => {
    // sourceRef carries what a queued chat step was judged on; a native step's gate reads it.
    const resolved = s.toolId ? resolveTool(s.toolId, session?.householdId, session?.actorId ?? null, sourceRef) : null;
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
      // WP-003: both truth flags ride into the durable run so the trace, the summary,
      // and both clients read the same verdict the planner/orchestrator reached.
      //
      // The effect-claim check is RE-EVALUATED here rather than merely copied, because
      // `normalizePlan` is not on every path into a run. A deterministic skill's steps
      // come through `buildPlanFromSkill`, and `POST /api/runs/start` accepts a raw
      // plan — both skip normalization entirely. Since the chat-built briefing runs as
      // a SKILL, trusting the upstream flag would have left the user's exact scenario
      // still reporting a toolless "Send email" step as succeeded. startRun is the one
      // choke point every run passes through, so the verdict is settled here.
      effectClaimed: s.effectClaimed ?? claimsExternalEffect({ toolId: s.toolId ?? null, title: s.title, detail: s.detail }),
      clampedOut: s.clampedOut ?? null,
      // WP-101 slice 3: set to true ONLY by the engine, at the moment it decides to
      // continue past this step's failure (see the soft-fail branch in _drive). It is
      // what makes a failed step "optional" for the run's terminal status, so it can
      // never be pre-declared by a plan — a caller cannot mark its own step optional.
      softFailed: false,
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
    // Scope for approval fan-out: a personal run's approvals notify only its requester.
    visibility: visibility === "personal" ? "personal" : "household",
    source,
    sourceRef,
    title: title ?? plan?.title ?? "Run",
    // WHAT THE FAMILY ACTUALLY ASKED FOR.
    //
    // Two step-level LLM calls — the reasoning step and the input fill — both read
    // `run.goal ?? run.plan?.title` and label the result "Run goal". Nothing ever wrote a
    // `goal`, so for every run in the product's history that fallback was the ONLY branch
    // taken: a model-generated plan TITLE stood in for the request. Every reasoning step and
    // every threaded input was working from a summary of a summary, with the person's own
    // words — the sentence carrying the names, dates, quantities and intent — discarded
    // before any step ran. It is the cheapest large quality fix in this codebase.
    //
    // Kept separate from `title` rather than overwriting it: the title is what a human scans
    // in Activity, the goal is what a model needs to act correctly, and collapsing them
    // would trade one of those away. Trimmed, because a pasted wall of text is a prompt
    // hazard, not extra context.
    goal: goal ? String(goal).trim().slice(0, 2000) : null,
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
  if (TERMINAL_RUN_STATUSES.includes(run.status)) return { ok: true, status: run.status };
  patchRun(runId, { status: "running", startedAt: run.startedAt ?? Date.now(), lease: { owner: LEASE_OWNER, at: Date.now() } });
  emit(runId, "run.running");

  while (true) {
    run = getRun(runId);
    if (!run || run.status === "cancelled") return { ok: true, status: "cancelled" };
    const i = run.cursor;
    if (i >= run.steps.length) {
      // WP-101 slice 3 (ISS-110) — the run gets the terminal it EARNED, not an
      // unconditional "completed". See classifyRunOutcome above for the truth table.
      const outcome = classifyRunOutcome(run);
      if (outcome.status === "failed") {
        // A required child failed and something let the loop walk past it. Report the
        // failure the run actually had, through the one failure path (audit + evolution
        // + repeated-non-delivery alert), never a green "completed".
        appendAudit({ type: "run.required_step_failed", runId, householdId: run.householdId, steps: outcome.required.map((s) => s.index) });
        return finishFailed(runId, outcome.error);
      }
      const partial = outcome.status === "partially_failed";
      patchRun(runId, { status: outcome.status, error: outcome.error, finishedAt: Date.now(), lease: null });
      appendAudit({
        type: partial ? "run.partially_failed" : "run.complete",
        runId, householdId: run.householdId, steps: run.steps.length,
        ...(partial ? { softFailedSteps: outcome.optional.map((s) => s.index) } : {}),
      });
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
      // A partially-failed run is still FINISHED: the same observers must hear about it
      // (the conversation's result message, the trigger's lastStatus writeback, the SSE
      // stream's close) — what changes is only that they now hear the honest outcome.
      emit(runId, partial ? "run.partially_failed" : "run.completed");
      fireRunFinished(runId);
      return { ok: true, status: outcome.status };
    }
    const step = run.steps[i];
    if (["succeeded", "skipped", "skipped_no_tool"].includes(step.status)) { patchRun(runId, { cursor: i + 1 }); continue; }

    // WP-003 (ISS-005) — a step the agent's policy forbids is recorded as SKIPPED and
    // left in the trace. It never executes (that is the point of the clamp), but the
    // family can now see that it was asked for and refused, instead of the step simply
    // ceasing to exist between the plan and the run.
    if (step.clampedOut) {
      patchRunStep(runId, i, { status: "skipped", detail: `Not permitted: ${step.clampedOut.message}`, finishedAt: Date.now() });
      appendAudit({ type: "run.step_clamped", runId, toolId: step.toolId, reason: step.clampedOut.reason, householdId: run.householdId });
      patchRun(runId, { cursor: i + 1 });
      emit(runId, "run.step");
      continue;
    }

    // WP-003 (ISS-002) — THE FALSE-SUCCESS SEAM. A toolless step that claims to send,
    // email, text, or notify cannot possibly have done so: there is no tool behind it.
    // It used to be marked `succeeded`, which is how a run that delivered nothing
    // reported "finished (3/3)" and the chat said "That worked". It is now terminal-
    // but-honest: `skipped_no_tool`, naming what was missing. The run can still
    // complete — the composition was real work — but no step lies about an effect.
    if (!step.toolId && step.effectClaimed) {
      patchRunStep(runId, i, {
        status: "skipped_no_tool",
        detail: `Not sent — this step had no delivery tool behind it. Connect the service it needs (or allow it for this helper) and run it again.`,
        finishedAt: Date.now(),
      });
      appendAudit({ type: "run.step_skipped_no_tool", runId, title: step.title, householdId: run.householdId, actorId: run.actorId });
      patchRun(runId, { cursor: i + 1 });
      emit(runId, "run.step");
      continue;
    }

    // Reasoning step (no tool) — the LLM works over prior step results and stores
    // {text, data}; later steps draw on `data` (e.g. which message ids to act on).
    if (!step.toolId) {
      const provider = activeAiProvider(run.householdId);
      if (!provider) {
        patchRunStep(runId, i, { status: "succeeded", detail: `${step.detail || "Reasoning step"} (no AI provider connected — reasoning skipped)`, finishedAt: Date.now() });
        patchRun(runId, { cursor: i + 1 });
        emit(runId, "run.step");
        continue;
      }
      if (aiBudgetExhausted(run.householdId)) {
        patchRunStep(runId, i, { status: "succeeded", detail: `${step.detail || "Reasoning step"} (daily AI budget reached — reasoning skipped)`, finishedAt: Date.now() });
        patchRun(runId, { cursor: i + 1 });
        emit(runId, "run.step");
        continue;
      }
      patchRunStep(runId, i, { status: "running", startedAt: step.startedAt ?? Date.now() });
      emit(runId, "run.step");
      const user = `Run goal: ${run.goal ?? run.plan?.title ?? ""}\nPlan summary: ${run.plan?.summary ?? ""}\n\nThis step: ${step.title}\nInstruction: ${step.detail ?? ""}\n\nPrior step results (JSON): ${priorResultsJSON(run, i)}`;
      recordAiUsage(run.householdId, "run");
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

    const resolved = resolveTool(step.toolId, run.householdId, run.actorId ?? null, run.sourceRef);
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
      // SECURITY (adversarial review, finding H1 + L4): an agentId that does not
      // resolve — or resolves into another household — used to SKIP the policy check
      // entirely, while still being forwarded as the acting identity for send
      // authority. Deleting an agent is how a family expects to revoke it, so a run
      // naming a deleted agent must fail closed, never run unpoliced.
      if (!agent || (agent.householdId !== run.householdId && agent.householdId !== "local")) {
        patchRunStep(runId, i, { status: "failed", detail: "This run names a helper that no longer exists in this household, so its permissions can't be checked.", finishedAt: Date.now() });
        appendAudit({ type: "run.policy_block", runId, toolId: step.toolId, agentId: run.sourceRef.agentId, reason: "unknown_agent", householdId: run.householdId });
        return finishFailed(runId, "agent_policy_unknown_agent");
      }
      {
        const verdict = isToolStepAllowed(agent, step.toolId, { householdId: run.householdId, actorId: run.actorId });
        if (!verdict.ok) {
          patchRunStep(runId, i, { status: "failed", detail: verdict.message ?? "Blocked by agent policy.", finishedAt: Date.now() });
          appendAudit({ type: "run.policy_block", runId, toolId: step.toolId, agentId: agent.id, reason: verdict.reason, householdId: run.householdId });
          return finishFailed(runId, `agent_policy_${verdict.reason}`);
        }
      }
      // WP-105/ISS-107: the agent's OWN approval policy — the "Runs without approval
      // (low-risk)" and "Always requires your approval" lists the UI has always let a
      // family edit, and which NO decision point read until now. They were inert, which is
      // why the same settings kept getting re-applied with nothing changing. Resolved
      // through the one policy authority so household, agent and capability rules can't
      // disagree, and so a relaxation is bounded (see policy.mjs).
      {
        const baseApproval = resolved.baseRequiresApproval ?? resolved.requiresApproval;
        const decision = resolveEffectivePolicy({
          cap: {
            id: step.toolId,
            name: resolved.tool?.name ?? resolved.def?.name ?? step.toolId,
            requiresApproval: baseApproval,
            risk: resolved.risk,
            action: resolved.action,
            delivers: resolved.tool?.delivers ?? resolved.def?.delivers ?? false,
            // KIND is reach: every provider and connector tool talks to a third party,
            // whatever its action reads. policy.mjs is pure and can't know that, so the
            // engine — which just resolved the tool — tells it. Internal homeops.* tools
            // are local unless they declare `delivers` (only notify_contact does).
            external: resolved.kind === "provider" || resolved.kind === "connector",
          },
          agent,
          settings: getSettings(run.householdId),
          override: getRiskOverride(run.householdId, step.toolId, run.actorId ?? null),
          /* The chat verdict's own input (ADR-004 Stage 2). A step parked under rule 4b — a
           * non-adult asking in the group thread — used to be re-judged here without it, so a
           * Trusted or Balanced stance cleared it and it ran with no approval. It is recorded on
           * the run by queueApprovalRun and is never client-writable; absent, the rule is off,
           * exactly as before. */
          actorIsAdult: actorIsAdultOf(run),
        });
        // A BLOCKED verdict is a REFUSAL, and until now nothing read it. `decide()` reports
        // requiresApproval:false for every verdict that isn't NEEDS_APPROVAL, so consuming
        // only that field turned the household kill switch into an approval BYPASS: with
        // external actions paused, a gated capability resolved to BLOCKED, then to
        // requiresApproval:false, and executed with no approval at all. Turning safety ON
        // removed a gate. The two agent-permission BLOCKED paths were already caught above
        // by isToolStepAllowed; the kill-switch path was not.
        if (decision.decision === BLOCKED) {
          patchRunStep(runId, i, { status: "failed", detail: decision.reason, finishedAt: Date.now() });
          appendAudit({ type: "run.policy_block", runId, toolId: step.toolId, agentId: agent.id, rule: decision.rule, reason: decision.reason, householdId: run.householdId });
          return finishFailed(runId, `policy_${decision.rule}`);
        }
        // Clearing a gate is admin-sanctioned but NEVER silent — the household override
        // path is audited a few lines above, and an agent-level clear is audited here.
        if (decision.rule === "agent.auto_allow" && baseApproval && !step.agentPolicyAudited) {
          appendAudit({ type: "run.approval_skipped_by_agent_policy", runId, toolId: step.toolId, agentId: agent.id, rule: decision.rule, householdId: run.householdId, actorId: run.actorId });
          patchRunStep(runId, i, { agentPolicyAudited: true });
        }
        resolved.requiresApproval = decision.requiresApproval;
        resolved.policy = decision; // decision + rule + reason, for the effective-policy view
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
        const a = createApproval({ actorId: run.actorId, householdId: run.householdId, connectorId: resolved.connectorId, toolId: stepNow.toolId, input: stepNow.input, risk: resolved.risk, category: resolved.action, preview: stepNow.title, visibility: run.visibility });
        patchRunStep(runId, i, { status: "waiting_for_approval", approvalId: a.id });
        patchRun(runId, { status: "waiting_for_approval" });
        appendAudit({ type: "run.await_approval", runId, toolId: stepNow.toolId, approvalId: a.id, householdId: run.householdId });
        // Push-notify the household — crucial for scheduled/trigger runs that park with
        // no browser open. Fire-and-forget; no-op when no device tokens are registered.
        pushApprovalNotification(a).catch(() => {});
        emit(runId, "run.waiting_for_approval");
        // WP-004: tell the CONVERSATION too — a push notification is not a record, and
        // a scheduled fire parks with nobody watching.
        fireRunParked(runId, { stepIndex: i, approvalId: a.id, expiresAt: a.expiresAt ?? null });
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
    // A native step also carries who asked and where (execResolved rebuilds its ctx from
    // these), and keeps its own declared time limit rather than the step default.
    const native = resolved.kind === "native";
    const stepCtx = {
      householdId: run.householdId, actorId: run.actorId, runId, accountId: run.params?.accountId, agentId: run.sourceRef?.agentId ?? null,
      ...(native ? { role: requesterRole(run), channel: run.sourceRef?.channel ?? null, actorName: getMember(run.actorId)?.displayName ?? null } : {}),
    };
    try {
      out = await withTimeout(execResolved(resolved, stepNow.input, stepCtx, approvalId), native ? resolved.def.timeoutMs : RUN_STEP_TIMEOUT_MS);
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
    // SOFT failure for read-only enrichment steps: a recipe page that won't
    // parse or a feed that won't load must not kill a 10-step plan that
    // already gathered good material — later steps (LLM reasoning, writes)
    // see the honest failure detail and work with what succeeded. Writes and
    // approval-gated steps keep hard-fail semantics, and a failing FINAL step
    // still fails the run (there's nothing left to salvage it).
    const actionClass = step.toolId ? toolActionOf(step.toolId) : null;
    const hasLaterSteps = i < run.steps.length - 1;
    if (actionClass === "Read" && !resolved.requiresApproval && hasLaterSteps) {
      // WP-101 slice 3 — `softFailed` is the durable record of THIS decision: the engine
      // chose to treat this child as optional and carry on. It is what stops the run
      // from ending "completed" (→ partially_failed) and what distinguishes an optional
      // failure from a required one. Stamped here, never inferred later.
      patchRunStep(runId, i, { status: "failed", softFailed: true, detail: `${out.message ?? out.error} — continued without this step's result.`, finishedAt: Date.now() });
      appendAudit({ type: "run.step_failed_soft", runId, toolId: step.toolId, error: out.error, householdId: run.householdId });
      patchRun(runId, { cursor: i + 1 });
      emit(runId, "run.step");
      continue;
    }
    patchRunStep(runId, i, { status: "failed", detail: out.message ?? out.error, finishedAt: Date.now() });
    return finishFailed(runId, out.error);
  }
}

// Failure classes make silent degradation visible: dashboards, digests, and
// alerts key off these instead of raw error strings.
function classifyFailure(error) {
  const e = String(error ?? "").toLowerCase();
  if (/interrupt|stall/.test(e)) return "interrupted";
  if (/timeout/.test(e)) return "timeout";
  if (/no_provider|provider_error|rate_limit|429/.test(e)) return "provider_down";
  if (/bot|blocked|fetch_failed|no results|search_failed|no_recipe/.test(e)) return "bot_wall";
  if (/invalid_input|empty_|bad_/.test(e)) return "invalid_input";
  return "other";
}

function finishFailed(runId, error) {
  patchRun(runId, { status: "failed", error, finishedAt: Date.now(), lease: null });
  const run = getRun(runId);
  appendAudit({ type: "run.failed", runId, error, failureClass: classifyFailure(error), householdId: run?.householdId });
  if (run) {
    notifyRepeatedNonDelivery(run, classifyFailure(error));
  }
  emit(runId, "run.failed");
  fireRunFinished(runId);
  return { ok: false, status: "failed", error };
}

/* ---- WP-004 (ISS-008): "this routine keeps not delivering" ----
 * The same agent/automation coming up empty TWICE IN A ROW is a broken routine, not a
 * blip — so the Owner hears about it in-app. Previously only `failed` counted, which
 * meant a briefing whose approval expired every single morning could go silent
 * indefinitely without ever tripping the alert (EV-026). Expiry is non-delivery too,
 * and non-delivery is the thing the family actually cares about. */
const NON_DELIVERY = ["failed", "expired"];
// WP-101 slice 3: `partially_failed` is a TERMINAL outcome (so it breaks a non-delivery
// streak the way "completed" does — the routine did deliver something), but it is not
// itself non-delivery, so it never trips the alert on its own.
const TERMINAL_FOR_STREAK = ["completed", "partially_failed", ...NON_DELIVERY];
function notifyRepeatedNonDelivery(run, failureClass) {
  if (!run) return;
  try {
    const refId = run.sourceRef?.agentId || run.sourceRef?.automationId || run.sourceRef?.triggerId || null;
    if (!refId) return;
    const siblings = listRuns({ householdId: run.householdId, limit: 50 })
      .filter((r) => (r.sourceRef?.agentId || r.sourceRef?.automationId || r.sourceRef?.triggerId) === refId
        && r.id !== run.id && TERMINAL_FOR_STREAK.includes(r.status))
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
    if (!NON_DELIVERY.includes(siblings[0]?.status)) return;
    const why = run.status === "expired"
      ? "its approval expired before anyone decided, both times"
      : `${failureClass ?? classifyFailure(run.error)}, twice in a row`;
    addNotification({
      householdId: run.householdId, actorId: run.actorId, channel: "In-App", to: null,
      title: "An automation keeps not finishing",
      body: `"${run.title}" hasn't delivered twice in a row (${why}). Check it in Agents — it may need a connection fixed, an approval allowlisted, or its instructions adjusted.`,
    });
  } catch { /* alerting must never mask the original outcome */ }
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
    if (TERMINAL_RUN_STATUSES.includes(run.status)) return { ok: true, run };
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
  // By STATUS, not the newest 500 runs: a run parked while 500 newer ones were created fell
  // outside the page, so tapping Approve marked the approval approved and resumed nothing.
  return listRuns({ status: "waiting_for_approval", limit: 10_000 }).find((r) => r.steps?.some((s) => s.approvalId === approvalId && s.status === "waiting_for_approval")) ?? null;
}

// Server-owned stale-run expiry: a run parked on an approval whose 30-min TTL has
// lapsed (or was denied/expired) is moved to `expired` so it doesn't linger forever.
// Runs by household; safe to call on an interval. Returns count expired.
// Only genuine TTL lapse expires a parked run here; a `denied` approval is owned by
// the _drive/resumeRun path (→ failed) so the terminal status stays consistent.
//
// ISS-017: `waiting_for_connector` runs used to have NO expiry at all — a household
// missing a connection (e.g. Google) accumulated parked runs forever. Below adds the
// same honest treatment approval-parks and stalls already get, PLUS a real in-app
// notification (the Inbox otherwise never learns the run died).
const RUN_STALL_MS = 30 * 60_000;
function connectorParkTtlMs() {
  const days = Number(process.env.HOMEOPS_CONNECTOR_PARK_TTL_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : 7) * 24 * 60 * 60_000;
}
// Feature epoch: the moment this sweep shipped. A run PARKED (see
// connectorParkMoment in expireStaleRuns — the blocked cursor step's startedAt,
// never the generic `updatedAt` write stamp) at/after this stamp parked under a
// codebase that HAS this TTL, so the TTL applies to it by default — that's the
// honest, opt-out-by-nature default for new parks. A run parked BEFORE this stamp
// is a pre-existing ("legacy") park —
// e.g. the resident household's long-stuck connector-parked runs — and is
// grandfathered: this code landing must never silently vanish months-old runs on the
// next boot/interval sweep. Sweeping those too is a real decision for a household (or
// operator) to make, not an automatic side effect — set HOMEOPS_SWEEP_LEGACY_PARKED=1
// to opt in once that decision is made.
const CONNECTOR_PARK_FEATURE_EPOCH_MS = Date.parse("2026-07-22T00:00:00Z");
function sweepLegacyParkedEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.HOMEOPS_SWEEP_LEGACY_PARKED ?? ""));
}
// What a family would call the thing a connector-parked run is stuck waiting on —
// mirrors the ActivityMemory.tsx plain-language mapping (ISS-014) so the reason a
// run shows in the Inbox/Activity matches the language used everywhere else.
const PARK_CONNECTOR_LABEL = { gmail: "Google", gcal: "Google", google: "Google", calendar: "Google", sms: "text messaging", bluebubbles: "text messaging", imessage: "text messaging" };
function parkConnectorLabel(toolId) {
  const key = String(toolId ?? "").split(".")[0].toLowerCase();
  return PARK_CONNECTOR_LABEL[key] ?? (key || "needed");
}

// The detail written on the cursor step of a stalled run. A named constant
// because the sweep also READS it back: a step already carrying this exact text
// is one this sweep half-expired on an earlier tick (see the stall loop below).
const STALL_STEP_DETAIL = "Run stalled (no progress for 30 minutes) — stopped so it doesn't hang forever. Retry when ready.";

/* ---- sweep jobs: isolated, but never silent ----
 * Each expireStaleRuns job runs per-run so one wedged run can't abort the sweep
 * for the rest of the household. That isolation is right; throwing the error away
 * was not. `.catch(() => {})` meant a transient write failure — SQLite SQLITE_BUSY
 * (errcode 5) under a concurrent writer, a stale handle, a full disk — left the run
 * exactly as it was with NO audit entry, NO log line and no trace of any kind: the
 * run simply stayed waiting_for_connector/waiting_for_approval/running and the only
 * symptom was that nothing ever happened. (Found from the other end: a flaky test
 * whose sole evidence was a bare assertion failure, because the SQLITE_BUSY thrown
 * by patchRun inside the connector-park job died here.)
 *
 * The handler itself must not throw. These promises are awaited via Promise.all, so
 * a rejecting handler would re-introduce the sweep-wide abort the isolation exists
 * to prevent — and appendAudit is file I/O, which can fail for the very reason the
 * job did. Every step is guarded.
 *
 * Retry: recording is not the whole answer, but no separate retry machinery is
 * needed. A failed job leaves the run holding the status that selected it, so the
 * next 60s tick re-selects it — an expired approval stays expired, and the
 * connector-park clock is the cursor step's `startedAt`, which no sweep writes. A
 * transient error therefore costs one tick. The single exception is a PARTIAL stall
 * write, which refreshes `updatedAt` and would hide the run behind its own time
 * gate; the stall loop detects that state explicitly rather than waiting it out. */
function isolateSweepJob(sweep, r, work) {
  return withRunLock(r.id, work).catch((err) => {
    try {
      console.error(`[sweep] ${sweep} failed for run ${r.id} (household ${r.householdId ?? "?"}) — left as-is for the next tick:`, err?.stack ?? err);
    } catch { /* logging must never be the thing that breaks the sweep */ }
    try {
      appendAudit({
        type: "run.sweep_failed", sweep, runId: r.id, householdId: r.householdId,
        error: String(err?.message ?? err), code: err?.code ?? null, errcode: err?.errcode ?? null,
      });
    } catch { /* the audit write can fail for the same reason the job did */ }
  });
}

export async function expireStaleRuns() {
  let expired = 0;
  const jobs = [];
  // Belt-and-braces stall sweeper: a run claiming "running"/"retrying" that
  // hasn't been touched in 30 minutes has lost its driver (step timeouts patch
  // every ≤2 min, so silence this long means the loop is gone). Fail it
  // honestly instead of showing a family a forever-spinning run.
  for (const r of listRuns({ limit: 1000 })) {
    if (!["running", "retrying"].includes(r.status)) continue;
    const touched = Date.parse(r.updatedAt ?? "") || r.createdAt || 0;
    // A cursor step already carrying the stall detail is a run THIS sweep
    // half-expired on an earlier tick: the step patch landed, the run patch
    // threw. That partial write refreshed `updatedAt`, so the silence gate below
    // would hide the run for a further 30 minutes while it kept claiming to run.
    // Finish the job now instead — the detail is written by nothing else, so this
    // can never grab a run that is legitimately making progress.
    const halfSwept = r.steps?.[r.cursor]?.status === "failed" && r.steps[r.cursor]?.detail === STALL_STEP_DETAIL;
    if (!touched || (Date.now() - touched < RUN_STALL_MS && !halfSwept)) continue;
    jobs.push(isolateSweepJob("stall", r, async () => {
      const run = getRun(r.id);
      if (!run || !["running", "retrying"].includes(run.status)) return;
      const cur = run.steps[run.cursor];
      if (cur && ["running", "ready", "pending"].includes(cur.status)) {
        patchRunStep(run.id, run.cursor, { status: "failed", detail: STALL_STEP_DETAIL, finishedAt: Date.now() });
      }
      patchRun(run.id, { status: "failed", error: "stalled", finishedAt: Date.now(), lease: null });
      appendAudit({ type: "run.stalled", runId: run.id, householdId: run.householdId });
      emit(run.id, "run.failed");
      expired++;
    }));
  }
  for (const r of listRuns({ limit: 1000 })) {
    if (r.status !== "waiting_for_approval") continue;
    // Optional chaining, not `r.steps[r.cursor]`: a malformed record with no steps
    // threw HERE, in the selection pass — outside every per-job guard — killing the
    // whole household's sweep for that tick. Selection must be as unkillable as the
    // jobs it feeds.
    const step = r.steps?.[r.cursor];
    if (!step?.approvalId) continue;
    const appr = getApproval(step.approvalId);
    const stale = !appr || appr.status === "expired" || (appr.expiresAt && Date.now() > appr.expiresAt);
    if (!stale) continue;
    jobs.push(isolateSweepJob("approval_park", r, async () => {
      const run = getRun(r.id);
      if (!run || run.status !== "waiting_for_approval") return; // a concurrent decide won
      patchRunStep(r.id, run.cursor, { status: "expired", detail: "Approval expired before a decision.", finishedAt: Date.now() });
      patchRun(r.id, { status: "expired", error: "approval_expired", finishedAt: Date.now(), lease: null });
      appendAudit({ type: "run.expired", runId: r.id, householdId: run.householdId });
      emit(r.id, "run.expired");
      // WP-004 (ISS-004/EV-007): expiry is TERMINAL, so it must reach the run-finished
      // observers like every other terminal state. Skipping the hook here is why an
      // expired approval produced total silence — no chat message, no trigger status,
      // no keeps-failing signal. A run that quietly died is the worst of the false
      // successes, because nothing at all marks the moment it stopped mattering.
      notifyRepeatedNonDelivery(getRun(r.id));
      fireRunFinished(r.id);
      expired++; // count only runs actually transitioned
    }));
  }
  // ISS-017 — connector-parked runs (waiting_for_connector) past the TTL.
  //
  // The park CLOCK is the moment the run actually parked — NOT `updatedAt`.
  // `updatedAt` is a generic write stamp: boot reconciliation, lease churn, and
  // unrelated patches all refresh it, which silently restarted the TTL. Observed
  // in the resident household (2026-07-22): a restart mass-touched every legacy
  // park's updatedAt to 2026-07-21T18:28:47Z, so the operator's explicit
  // HOMEOPS_SWEEP_LEGACY_PARKED=1 sweep expired nothing — months-old runs looked
  // hours old, and the epoch check even misclassified them as post-epoch parks.
  // The cursor step's `startedAt` is written when the step attempt begins — the
  // attempt whose refusal parked the run — so it IS the park moment, refreshed
  // only by a genuine re-drive (connector connected → resume → re-park).
  const parkTtlMs = connectorParkTtlMs();
  const sweepLegacy = sweepLegacyParkedEnabled();
  const connectorParkMoment = (r) => {
    const stepStarted = Number(r.steps?.[r.cursor]?.startedAt);
    if (Number.isFinite(stepStarted) && stepStarted > 0) return stepStarted;
    const updated = Date.parse(r.updatedAt ?? "");
    if (Number.isFinite(updated) && updated > 0) return updated;
    return Number(r.createdAt) || 0;
  };
  for (const r of listRuns({ limit: 1000 })) {
    if (r.status !== "waiting_for_connector") continue;
    const parkedAt = connectorParkMoment(r);
    if (!parkedAt) continue;
    const isLegacyPark = parkedAt < CONNECTOR_PARK_FEATURE_EPOCH_MS;
    if (isLegacyPark && !sweepLegacy) continue; // grandfathered until explicitly opted in
    // A legacy park under the flag expires NOW: the flag is the operator's
    // one-shot decision to clear the pre-epoch backlog — making that decision
    // then waiting a further TTL from some later incidental touch is exactly
    // the gap that stranded the resident stragglers. Post-epoch parks get the
    // normal TTL, measured from the park moment so touches never restart it.
    if (!isLegacyPark && Date.now() - parkedAt < parkTtlMs) continue;
    jobs.push(isolateSweepJob("connector_park", r, async () => {
      const run = getRun(r.id);
      if (!run || run.status !== "waiting_for_connector") return; // a concurrent resume won
      const cur = run.steps[run.cursor];
      const reason = `expired — needed the ${parkConnectorLabel(cur?.toolId)} connection`;
      if (cur) patchRunStep(r.id, run.cursor, { status: "expired", detail: reason, finishedAt: Date.now() });
      patchRun(r.id, { status: "expired", error: "connector_park_expired", finishedAt: Date.now(), lease: null });
      appendAudit({ type: "run.connector_park_expired", runId: r.id, householdId: run.householdId, toolId: cur?.toolId, legacy: isLegacyPark, parkedAt });
      emit(r.id, "run.expired");
      // A parked run can sit for days with no browser ever open to see it die — the
      // in-app notification is how the household actually learns about it (Inbox).
      addNotification({
        householdId: run.householdId, actorId: run.actorId, channel: "In-App", to: null,
        title: "A task expired waiting for a connection",
        body: `"${run.title || "A task"}" ${reason}. Connect it in Connections, then run it again.`,
      });
      fireRunFinished(r.id);
      expired++;
    }));
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
// Tools that are safe to RE-RUN after an interruption because they are
// idempotent by construction (dedupe-by-title, slot-aware, no double writes).
// Every deploy restarts the server; without this list a family's 12-step plan
// died mid-flight whenever a deploy landed during a run.
const IDEMPOTENT_TOOLS = new Set(["homeops.plan_meal", "homeops.write_memory", "homeops.create_artifact"]);

export async function recoverRuns() {
  let recovered = 0, quarantined = 0;
  for (const r of listRuns({ limit: 1000 })) {
    if (!["running", "retrying", "planning", "queued"].includes(r.status)) continue;
    const step = r.steps[r.cursor];
    if (step && step.status === "running") {
      // Idempotent step → safe to re-drive: re-running lands the same state.
      if (step.toolId && IDEMPOTENT_TOOLS.has(step.toolId)) {
        recovered++;
        withRunLock(r.id, async () => {
          const run = getRun(r.id);
          if (!run) return;
          const cur = run.steps[run.cursor];
          if (cur && cur.status === "running") {
            patchRunStep(run.id, run.cursor, { status: "ready", detail: "Interrupted by a server restart — safely re-run (idempotent step)." });
          }
          await _drive(run.id);
        }).catch(() => {});
        continue;
      }
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
