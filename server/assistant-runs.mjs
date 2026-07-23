// Assistant run intelligence — the inline chat loop around engine runs.
//
// Two behaviors, both riding the engine's run-finished hook and both scoped to
// runs that came FROM a conversation (sourceRef.conversationId):
//
//   1. Results come back to the chat. Every conversation-born run appends a
//      durable run_result message when it finishes — the thread shows what
//      happened without the user hunting through Activity.
//
//   2. Failures self-heal, once. A failed conversation run gets its step logs
//      mined, an improved plan generated, and that plan auto-executed — with an
//      honest inline message at each stage. After a successful repair the chat
//      offers to save the now-working plan as a reusable helper (a build card
//      the user can confirm). One repair attempt max: a failed repair reports
//      honestly instead of looping.
import {
  getConversation, appendConversationMessage, getMember, appendAudit,
  recordAiUsage, aiBudgetExhausted, getSettings, runWithTenant,
} from "./store.mjs";
import { onRunFinished, onRunParked, startRun } from "./engine.mjs";
import { toolCatalog, normalizePlan } from "./planner.mjs";
import { providerChatWithFallback } from "./ai.mjs";
import { getInternalFunction } from "./internal-functions.mjs";
import { findToolGlobal } from "./providers.mjs";
import { CONNECTORS } from "./connectors.mjs";

const REPAIR_SYS = `You repair a failed household-automation plan using its actual run trace. You get the original plan, each step's status/detail/error, and the tool catalog. Produce a CORRECTED plan that avoids the specific failure:
- Ground every change in the trace — swap a failing tool for a working alternative from the catalog, fix bad inputs, drop or reorder steps that can't succeed, add a reasoning step where data was missing.
- Keep everything that worked. Smallest change that fixes the failure.
- Use tool ids ONLY from the catalog; requiresApproval true for send/write/pay steps.
Respond with ONLY JSON (no prose, no fences):
{ "diagnosis": string, "plan": { "title": string, "summary": string, "steps": [ { "toolId": string|null, "title": string, "detail": string, "input": object, "requiresApproval": boolean } ] } }
"diagnosis" is one plain sentence naming what broke and what you changed.`;

/* ---- WP-003 (ISS-002, FEAT-014): the run summary tells the truth ----
 * The old summary counted `succeeded` steps and called it done: "Done — finished (3/3)".
 * It could not distinguish a briefing that was EMAILED from one that was merely
 * COMPOSED, so the family read success either way (EV-012). The rewrite separates what
 * was delivered from what was only prepared, and names — in plain words — every step
 * that did not happen and why. The warm voice stays; the certainty is now earned.
 *
 * WP-002 (Honest delivery) — the ABOVE fix still had a hole: "delivered" was inferred
 * from `requiresApproval` OR a name-sniffing regex (/send|notify|email|sms|post|deliver/i)
 * against the toolId. `homeops.send_notification_draft` is a review-only DRAFT tool by
 * design (internal-functions.mjs) — it never sends anything — but its id literally
 * CONTAINS "send_notification", so the regex matched and a run that only ever drafted a
 * message was reported as having "delivered". The regex is gone. "Delivered" is now
 * decided by ONE explicit `delivers` flag on the tool's own definition (internal-
 * functions.mjs / providers.mjs / connectors.mjs) — the single source of truth for
 * whether that tool reaches outside the run — never the tool's id, name, or approval
 * gate (an approval gate is about RISK, not about whether the step reaches anyone). */
const SUCCESS_STATUSES = ["succeeded", "done", "completed"];

// Static, synchronous lookup across all three tool catalogs — deliberately NOT the
// tenant-aware listConnectors()/toolCatalog() (this runs from a run-finished hook and
// must also work as a pure function in unit tests with no server/tenant booted). An
// unknown toolId honestly returns false: never claim a delivery for a tool this layer
// can't identify.
function toolDelivers(toolId) {
  if (!toolId) return false;
  const internal = getInternalFunction(toolId);
  if (internal) return !!internal.delivers;
  const platform = findToolGlobal(toolId);
  if (platform) return !!platform.tool.delivers;
  for (const c of CONNECTORS) {
    const t = (c.tools ?? []).find((x) => x.id === toolId);
    if (t) return !!t.delivers;
  }
  return false;
}
function toolIsDraft(toolId) {
  if (!toolId) return false;
  return !!getInternalFunction(toolId)?.draft;
}

// Best-effort human label for WHERE a delivered step reached — read from the step's
// own result first (e.g. homeops.notify_contact reports the real channel it resolved
// to), falling back to a static per-tool hint. Used only for wording; never changes
// what counts as delivered.
const CHANNEL_WORD = { email: "email", sms: "text", in_app: "in-app", dashboard: "in-app" };
const TOOL_CHANNEL_HINT = { "gmail.send": "email", "outlook.send": "email", "sms.send": "text", "slack.postMessage": "Slack", "alexa.announce": "Alexa" };
function channelLabel(step) {
  const ch = step.result?.channel;
  if (ch) return CHANNEL_WORD[ch] ?? String(ch);
  return TOOL_CHANNEL_HINT[step.toolId] ?? null;
}

export function summarizeOutcome(run) {
  const steps = run.steps ?? [];
  const succeeded = steps.filter((s) => SUCCESS_STATUSES.includes(s.status));
  // "Delivered" = a real tool ran, succeeded, AND that tool's own definition says it
  // reaches outside the run. Nothing else — see the flag rationale above.
  const delivered = succeeded.filter((s) => toolDelivers(s.toolId));
  // "Drafted" = a real tool ran, succeeded, produced something a human still has to
  // review and send themselves (send_notification_draft) — distinct from both a real
  // delivery and from ordinary internal record-keeping (create_task, write_memory, …).
  const drafted = succeeded.filter((s) => !toolDelivers(s.toolId) && toolIsDraft(s.toolId));
  const composed = succeeded.filter((s) => !s.toolId);
  const noTool = steps.filter((s) => s.status === "skipped_no_tool");
  const skipped = steps.filter((s) => s.status === "skipped");
  const parked = steps.filter((s) => s.status === "waiting_for_approval");
  const expired = steps.filter((s) => s.status === "expired");
  const failed = steps.filter((s) => s.status === "failed");
  return { steps, succeeded, delivered, drafted, composed, noTool, skipped, parked, expired, failed, anyEffect: delivered.length > 0, anyDraft: drafted.length > 0 };
}

function shortfallLines(o) {
  const lines = [];
  for (const s of o.noTool) lines.push(`• Not sent — "${s.title}" had no delivery tool behind it, so nothing left the house.`);
  for (const s of o.skipped) lines.push(`• Skipped — "${s.title}": ${String(s.detail ?? "not permitted").replace(/^Not permitted:\s*/, "not permitted — ")}`);
  for (const s of o.expired) lines.push(`• Expired — "${s.title}" was waiting on approval and the window closed. Nothing was sent.`);
  for (const s of o.failed) lines.push(`• Failed — "${s.title}": ${String(s.detail ?? "unknown error").slice(0, 160)}`);
  return lines;
}

// Headline for a run that delivered at least one step for real. Names the channel when
// there's exactly one delivered step (the common case) and folds in an honest mention
// of any step that only drafted — a mixed run must never round a draft up to "sent".
function deliveredHeadline(run, o) {
  const n = o.delivered.length;
  const labels = [...new Set(o.delivered.map(channelLabel).filter(Boolean))];
  const where = labels.length === 1 ? ` (${labels[0]})` : labels.length > 1 ? ` (${labels.join(", ")})` : "";
  const draftNote = o.drafted.length ? ` ${o.drafted.length} more step${o.drafted.length === 1 ? "" : "s"} drafted — review before sending.` : "";
  return `Done — "${run.title}" ran and delivered ${n} step${n === 1 ? "" : "s"}${where}.${draftNote}`;
}
// Headline for a run that produced only draft(s) — the exact false-success repro this
// WP fixes: "1 step drafted (review), nothing sent externally", never "delivered".
function draftedHeadline(run, o) {
  const n = o.drafted.length;
  return `I finished "${run.title}" — ${n} step${n === 1 ? "" : "s"} drafted for your review. Nothing was sent externally.`;
}

// Exported for the WP-002 summarizeOutcome truth-table unit test (server/test/
// summarize-outcome.test.mjs) — a pure function over a plain run object, no server
// or tenant context required.
export function runOutcomeText(run) {
  const o = summarizeOutcome(run);
  const reasoning = o.composed.filter((s) => s.result?.text).map((s) => s.result.text).join("\n\n").trim();
  const body = reasoning ? `\n\n${reasoning.slice(0, 1200)}` : "";
  const shortfalls = shortfallLines(o);
  const caveat = shortfalls.length ? `\n\n${shortfalls.join("\n")}` : "";

  if (run.status === "expired") {
    return `That approval expired — nothing was sent for "${run.title}". Ask me again when you're ready and I'll re-run it.${caveat}`;
  }
  if (run.status === "completed") {
    // The headline must match the strongest thing that actually happened, in order:
    // a real delivery beats a draft, a draft beats a silent shortfall, and only a run
    // with nothing to disclose at all gets the plain "finished (N/N)" wording.
    const head = o.anyEffect
      ? deliveredHeadline(run, o)
      : o.anyDraft
        ? draftedHeadline(run, o)
        : shortfalls.length
          ? `I finished "${run.title}", but nothing was actually sent.`
          : `Done — "${run.title}" finished (${o.succeeded.length}/${o.steps.length} steps).`;
    return `${head}${caveat}${body}`;
  }
  // WP-101 slice 3 (ISS-110): a partially_failed run is one where only OPTIONAL
  // (soft-failed) work fell over — the required work landed. The hard-failure sentence
  // below would be over-negative for it: true that a step failed, but it buries the part
  // that actually worked. Stay honest in both directions — neither "Done" nor "failed".
  if (run.status === "partially_failed") {
    const head = o.anyEffect
      ? deliveredHeadline(run, o)
      : o.anyDraft
        ? draftedHeadline(run, o)
        : `I finished "${run.title}", but part of it didn't work.`;
    return `${head}${caveat}${body}`;
  }
  const bad = o.failed[0];
  return `"${run.title}" failed at step ${bad ? bad.index + 1 : "?"}${bad ? ` (${bad.title})` : ""}: ${run.error ?? "unknown error"}.${caveat}`;
}

/* ---- WP-004 (ISS-008, FEAT-019/005): "Done" always links to the thing ----
 * Every succeeded step that created something with a stable id gets a link on the
 * run_result message, so a task, list item, or artifact a run produced is reachable
 * straight from the chat that started it — not just from Activity/Files & Knowledge
 * after hunting. Derived strictly from each step's OWN recorded result shape
 * (internal-functions.mjs, read-only from here) for the exact tool that ran; never
 * guessed from a title or the run's summary text, and never for a step that didn't
 * succeed. Tasks and list items are the same underlying store resource
 * (homeops.create_list_item writes a Task with type:"list" — see
 * internal-functions.mjs), so both link with kind:"task"; only the label differs.
 * This is additive: the WP-002 artifactId/link fields on the message are untouched. */
const TASK_LINK_LABEL = { "homeops.create_task": "View task", "homeops.create_list_item": "View list item" };
const ARTIFACT_LINK_LABEL = { "homeops.send_notification_draft": "Review draft", "homeops.create_artifact": "View artifact" };
export function buildResultLinks(run) {
  const links = [];
  for (const s of run.steps ?? []) {
    if (!SUCCESS_STATUSES.includes(s.status)) continue;
    const id = s.result?.id;
    if (!id || typeof id !== "string") continue;
    if (Object.prototype.hasOwnProperty.call(TASK_LINK_LABEL, s.toolId)) {
      links.push({ kind: "task", id, label: TASK_LINK_LABEL[s.toolId] });
    } else if (Object.prototype.hasOwnProperty.call(ARTIFACT_LINK_LABEL, s.toolId)) {
      links.push({ kind: "artifact", id, label: ARTIFACT_LINK_LABEL[s.toolId] });
    }
  }
  return links;
}

function appendToConversation(run, message) {
  const conv = getConversation(run.sourceRef.conversationId);
  if (!conv || conv.householdId !== run.householdId) return false;
  appendConversationMessage(conv.id, { role: "assistant", at: new Date().toISOString(), ...message });
  return true;
}

function traceFor(run) {
  return {
    title: run.title, error: run.error,
    steps: run.steps.map((s) => ({
      index: s.index, toolId: s.toolId, title: s.title, status: s.status,
      detail: String(s.detail ?? "").slice(0, 300), input: s.input,
      resultText: s.result?.text ? String(s.result.text).slice(0, 300) : undefined,
    })),
  };
}

async function repairFailedRun(run) {
  const conversationId = run.sourceRef.conversationId;
  if (aiBudgetExhausted(run.householdId)) {
    appendToConversation(run, { kind: "status", text: "That run failed, and the household's daily AI budget is used up — I'll leave the failure details in Activity instead of retrying." });
    return;
  }
  const member = getMember(run.actorId);
  const session = { householdId: run.householdId, actorId: run.actorId, role: member?.role ?? "Adult Member" };
  const providerId = getSettings(run.householdId).aiActiveProvider;
  if (!providerId) return; // nothing to repair with — the honest failure message already landed
  appendToConversation(run, {
    kind: "status",
    text: `Looks like that run failed — I've gathered details from the failed steps and I'm executing an improved plan now. I'll report back here when it's done.`,
  });
  const catalog = toolCatalog(session);
  const compact = catalog.map((t) => ({ id: t.toolId, name: t.name, action: t.action, approval: t.requiresApproval, connected: t.connected, inputs: t.inputs.map((i) => i.key) }));
  recordAiUsage(run.householdId, "run");
  const out = await providerChatWithFallback(providerId, {
    messages: [
      { role: "system", content: REPAIR_SYS },
      { role: "user", content: `Failed run trace (JSON): ${JSON.stringify(traceFor(run)).slice(0, 5000)}\n\nTool catalog (JSON): ${JSON.stringify(compact).slice(0, 6000)}` },
    ],
  }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
  let parsed = null;
  if (out.ok) { try { const t = String(out.text); const a = t.indexOf("{"); const b = t.lastIndexOf("}"); parsed = JSON.parse(t.slice(a, b + 1)); } catch { /* handled below */ } }
  if (!parsed?.plan) {
    appendToConversation(run, { kind: "status", text: `I couldn't work out a safe fix automatically (${out.error ?? "the repair pass returned nothing usable"}). The failure details are in Activity, and I've logged an improvement proposal.` });
    return;
  }
  const plan = normalizePlan(parsed.plan, catalog, run.title);
  appendAudit({ type: "run.auto_repair", fromRunId: run.id, diagnosis: String(parsed.diagnosis ?? "").slice(0, 300) });
  const repaired = await startRun({
    source: "assistant",
    sourceRef: { conversationId, isRepair: true, repairedFrom: run.id, originalTitle: run.title },
    plan, session, title: plan.title,
  });
  appendToConversation(run, {
    kind: "status",
    text: `Diagnosis: ${String(parsed.diagnosis ?? "adjusted the failing step").slice(0, 280)} — running the corrected plan now.`,
    runId: repaired.id,
  });
}

function offerToSaveAgent(run, { repaired } = {}) {
  const plan = { title: run.title, summary: run.summary, steps: run.steps };
  const text = repaired
    ? `The improved plan worked. If the results look right, I can save this as a reusable helper so next time it's one tap.`
    : `That worked. Want me to save "${run.title}" as a reusable helper, so next time it's one tap?`;
  const guidance = repaired
    ? `Verified working ${new Date().toISOString().slice(0, 10)} after an automatic repair. Follow these exact steps.`
    : `Verified working ${new Date().toISOString().slice(0, 10)} from a live run. Follow these exact steps.`;
  appendToConversation(run, {
    kind: "build",
    text,
    build: {
      summary: `Save "${run.title}" as a reusable helper`,
      skill: {
        name: String(plan.title).slice(0, 80),
        description: String(plan.summary || `Verified from a live run.`).slice(0, 400),
        domain: "Family",
        planner_guidance: guidance,
        risk_level: "Low",
        steps: run.steps.map((s, i) => ({ step_id: `s${i + 1}`, name: s.title, tool_id: s.toolId, approval_required: !!s.requiresApproval, input_mapping: {} })),
      },
      agent: { name: String(plan.title).slice(0, 80), purpose: String(plan.summary || plan.title).slice(0, 200), instructions: `Run the "${plan.title}" skill when asked.` },
    },
  });
}

// Only nudge "save as a helper" when the run genuinely DID something reusable: it used at
// least one real tool and had more than one step. Trivial one-shot answers don't get a nag,
// and a run that came from an already-saved skill/agent is skipped (nothing new to save).
function worthSavingAsHelper(run) {
  if (run.sourceRef?.skillId || run.sourceRef?.agentId || run.sourceRef?.savedFrom) return false;
  // WP-003: gate on what SUCCEEDED, not on what was planned. The old check counted
  // planned tool steps, so a run whose only send was a toolless no-op still got the
  // cheerful "That worked — want me to save it?" offer. Offering to immortalize a
  // recipe that just failed to deliver is the false success at its most galling.
  const o = summarizeOutcome(run);
  if (o.noTool.length || o.skipped.length || o.expired.length || o.failed.length) return false;
  const ranRealTool = o.succeeded.filter((s) => s.toolId).length;
  return ranRealTool >= 1 && run.steps.length >= 2;
}

/** Wire the hooks. Called once at boot. */
export function registerAssistantRunHooks() {
  // WP-004 (ISS-004) — a run that PARKS says so in the thread, immediately. Before
  // this, a scheduled 7 AM briefing that stopped at its approval step left the
  // conversation showing "On it —" indefinitely: the run was alive, waiting, and
  // completely invisible. The message names the step, the deadline, and where to act.
  onRunParked((run, { approvalId, expiresAt } = {}) => runWithTenant(run.householdId, async () => {
    if (!run.sourceRef?.conversationId) return;
    const step = run.steps?.[run.cursor];
    const mins = expiresAt ? Math.max(1, Math.round((expiresAt - Date.now()) / 60000)) : null;
    const window = mins ? ` It expires in about ${mins} minute${mins === 1 ? "" : "s"}.` : "";
    appendToConversation(run, {
      kind: "status",
      runId: run.id,
      approvalId: approvalId ?? null,
      text: `Waiting for your approval before "${step?.title ?? run.title}" can run — nothing has been sent yet.${window} Review it in your Inbox to let it through.`,
    });
  }));

  onRunFinished((run) => runWithTenant(run.householdId, async () => {
    if (!run.sourceRef?.conversationId) return;
    // 1. Durable inline result for every conversation-born run.
    // WP-002 slice 4 — when the run produced a draft artifact, carry its id and a real,
    // working link on the message (runOutcomeText already names the review cue in the
    // text itself — see draftedHeadline/deliveredHeadline) so a later WP can render an
    // actual "Review draft" action in the thread instead of sending the family hunting
    // through Activity/Artifacts for what was drafted. Only the first draft is linked;
    // that matches today's plans, which draft at most one notification per run.
    const draftArtifactId = summarizeOutcome(run).drafted[0]?.result?.id ?? null;
    // WP-004 — every created task/list item/artifact across the whole run, not just
    // the first draft (see buildResultLinks above). Additive alongside artifactId/link.
    const links = buildResultLinks(run);
    appendToConversation(run, {
      kind: "run_result", runId: run.id, status: run.status, text: runOutcomeText(run),
      ...(draftArtifactId ? { artifactId: draftArtifactId, link: `/api/artifacts?runId=${run.id}` } : {}),
      ...(links.length ? { links } : {}),
    });
    // 2. Self-healing, once.
    if (run.status === "failed" && !run.sourceRef.isRepair) {
      await repairFailedRun(run).catch((e) => appendAudit({ type: "run.auto_repair", ok: false, fromRunId: run.id, error: String(e?.message ?? e) }));
    } else if (run.status === "completed" && run.sourceRef.isRepair) {
      offerToSaveAgent(run, { repaired: true });
    } else if (run.status === "completed" && !run.sourceRef.isRepair && worthSavingAsHelper(run)) {
      // 3. Learn from ordinary success too — not only after a repair. If a plain chat-driven
      //    run genuinely did something reusable, offer to save it as a helper right in the thread.
      offerToSaveAgent(run, { repaired: false });
    } else if (run.status === "failed" && run.sourceRef.isRepair) {
      appendToConversation(run, { kind: "status", text: "The corrected plan failed too — I'm not going to keep guessing. The full traces are in Activity, and I've filed an improvement proposal with what I learned." });
    }
  }));
}
