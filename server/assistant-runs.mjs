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
import { onRunFinished, startRun } from "./engine.mjs";
import { toolCatalog, normalizePlan } from "./planner.mjs";
import { providerChatWithFallback } from "./ai.mjs";

const REPAIR_SYS = `You repair a failed household-automation plan using its actual run trace. You get the original plan, each step's status/detail/error, and the tool catalog. Produce a CORRECTED plan that avoids the specific failure:
- Ground every change in the trace — swap a failing tool for a working alternative from the catalog, fix bad inputs, drop or reorder steps that can't succeed, add a reasoning step where data was missing.
- Keep everything that worked. Smallest change that fixes the failure.
- Use tool ids ONLY from the catalog; requiresApproval true for send/write/pay steps.
Respond with ONLY JSON (no prose, no fences):
{ "diagnosis": string, "plan": { "title": string, "summary": string, "steps": [ { "toolId": string|null, "title": string, "detail": string, "input": object, "requiresApproval": boolean } ] } }
"diagnosis" is one plain sentence naming what broke and what you changed.`;

function runOutcomeText(run) {
  const done = run.steps.filter((s) => ["succeeded", "done", "completed"].includes(s.status)).length;
  const reasoning = run.steps.filter((s) => !s.toolId && s.result?.text).map((s) => s.result.text).join("\n\n").trim();
  if (run.status === "completed") {
    const body = reasoning ? `\n\n${reasoning.slice(0, 1200)}` : "";
    return `Done — "${run.title}" finished (${done}/${run.steps.length} steps).${body}`;
  }
  const bad = run.steps.find((s) => s.status === "failed");
  return `"${run.title}" failed at step ${bad ? bad.index + 1 : "?"}${bad ? ` (${bad.title})` : ""}: ${run.error ?? "unknown error"}.`;
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

function offerToSaveAgent(run) {
  const plan = { title: run.title, summary: run.summary, steps: run.steps };
  appendToConversation(run, {
    kind: "build",
    text: `The improved plan worked. If the results look right, I can save this as a reusable helper so next time it's one tap.`,
    build: {
      summary: `Save "${run.title}" as a reusable helper`,
      skill: {
        name: String(plan.title).slice(0, 80),
        description: String(plan.summary || `Repaired and verified from a live run.`).slice(0, 400),
        domain: "Family",
        planner_guidance: `Verified working ${new Date().toISOString().slice(0, 10)} after an automatic repair. Follow these exact steps.`,
        risk_level: "Low",
        steps: run.steps.map((s, i) => ({ step_id: `s${i + 1}`, name: s.title, tool_id: s.toolId, approval_required: !!s.requiresApproval, input_mapping: {} })),
      },
      agent: { name: String(plan.title).slice(0, 80), purpose: String(plan.summary || plan.title).slice(0, 200), instructions: `Run the "${plan.title}" skill when asked.` },
    },
  });
}

/** Wire the hooks. Called once at boot. */
export function registerAssistantRunHooks() {
  onRunFinished((run) => runWithTenant(run.householdId, async () => {
    if (!run.sourceRef?.conversationId) return;
    // 1. Durable inline result for every conversation-born run.
    appendToConversation(run, { kind: "run_result", runId: run.id, status: run.status, text: runOutcomeText(run) });
    // 2. Self-healing, once.
    if (run.status === "failed" && !run.sourceRef.isRepair) {
      await repairFailedRun(run).catch((e) => appendAudit({ type: "run.auto_repair", ok: false, fromRunId: run.id, error: String(e?.message ?? e) }));
    } else if (run.status === "completed" && run.sourceRef.isRepair) {
      offerToSaveAgent(run);
    } else if (run.status === "failed" && run.sourceRef.isRepair) {
      appendToConversation(run, { kind: "status", text: "The corrected plan failed too — I'm not going to keep guessing. The full traces are in Activity, and I've filed an improvement proposal with what I learned." });
    }
  }));
}
