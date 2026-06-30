import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { Card, Button, Badge, RiskBadge } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { InlineApprovals } from "@/components/InlineApprovals";
import { MarkdownContent } from "@/lib/markdown";
import type { AssistantConversation, AssistantMessage, AutomationRun } from "@/types";
import type { AgentPlan } from "@/connectors/api";

const SUGGESTIONS = [
  { icon: "Sun", text: "Summarize today's family schedule and what needs my attention" },
  { icon: "Mail", text: "Draft an email to the soccer coach that Noah will miss Saturday practice" },
  { icon: "Receipt", text: "What bills are due this week?" },
  { icon: "BellPlus", text: "Remind me to sign the field-trip permission form tomorrow" },
];

export function Assistant() {
  const conversations = useStore((s) => s.data.conversations) ?? [];
  const convId = useStore((s) => s.route.params?.id);
  const startConversation = useStore((s) => s.startConversation);
  const sendToAssistant = useStore((s) => s.sendToAssistant);
  const navigate = useStore((s) => s.navigate);
  const conv = conversations.find((c) => c.id === convId);

  if (!conv) return <AssistantHome conversations={conversations} onStart={startConversation} onOpen={(id) => navigate("assistant", { id })} />;
  return <Conversation key={conv.id} conv={conv} onSend={(t) => sendToAssistant(conv.id, t)} />;
}

/* ------------------------------- Home / empty --------------------------- */
function AssistantHome({ conversations, onStart, onOpen }: { conversations: AssistantConversation[]; onStart: (t: string) => void; onOpen: (id: string) => void }) {
  const [text, setText] = useState("");
  const me = useStore((s) => s.currentMember());
  const first = (me?.displayName ?? "there").split(" ")[0];
  const submit = () => { const t = text.trim(); if (t) { onStart(t); setText(""); } };
  return (
    <div className="animate-fade-in mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center py-6">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-ember-400 to-ember-600 text-white shadow-ember">
          <Icon name="Sparkles" size={26} />
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">Ask HomeOps, {first}</h1>
        <p className="mt-1.5 text-sm text-ink-500">Tell me what you need. I'll answer, or draft a plan you can approve and run.</p>
      </div>

      <div className="card card-pad">
        <div className="flex items-end gap-2">
          <textarea
            autoFocus value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="e.g. Plan Lily's birthday and email the invites"
            aria-label="Ask HomeOps"
            className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent py-2 text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none"
            rows={1}
          />
          <Button variant="ember" onClick={submit} disabled={!text.trim()}><Icon name="ArrowUp" size={16} /> Ask</Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button key={s.text} onClick={() => onStart(s.text)} className="group flex items-center gap-3 rounded-2xl border border-ink-900/[0.06] bg-surface-rim px-3.5 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition-all hover:-translate-y-0.5 hover:border-ember-200 hover:shadow-e2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ember-50 text-ember-600"><Icon name={s.icon} size={16} /></span>
            <span className="text-sm text-ink-700">{s.text}</span>
          </button>
        ))}
      </div>

      {conversations.length > 0 && (
        <div className="mt-8">
          <p className="section-title mb-2">Recent</p>
          <div className="flex flex-col gap-1.5">
            {conversations.slice(0, 6).map((c) => (
              <button key={c.id} onClick={() => onOpen(c.id)} className="data-row cursor-pointer text-left">
                <span className="flex min-w-0 items-center gap-2"><Icon name="MessageSquare" size={14} className="shrink-0 text-ink-400" /><span className="truncate text-sm text-ink-700">{c.title}</span></span>
                <Icon name="ChevronRight" size={15} className="shrink-0 text-ink-300" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Conversation ---------------------------- */
function Conversation({ conv, onSend }: { conv: AssistantConversation; onSend: (t: string) => void }) {
  const navigate = useStore((s) => s.navigate);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const thinking = conv.messages.some((m) => m.status === "thinking");
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [conv.messages.length, thinking]);
  const submit = () => { const t = text.trim(); if (t && !thinking) { onSend(t); setText(""); } };

  return (
    <div className="animate-fade-in mx-auto flex h-full max-w-3xl flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="font-display truncate text-xl font-semibold text-ink-900">{conv.title}</h1>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => navigate("assistant")}><Icon name="Plus" size={14} /> New chat</Button>
          <Button size="sm" variant="ghost" onClick={() => deleteConversation(conv.id)} aria-label="Delete conversation"><Icon name="Trash2" size={15} /></Button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto pb-4">
        {conv.messages.map((m) => <MessageRow key={m.id} conversationId={conv.id} m={m} />)}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 mt-2 border-t border-ink-900/[0.06] bg-surface-base/80 pt-3 backdrop-blur-xl">
        <div className="card flex items-end gap-2 px-3 py-2">
          <textarea
            value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="Reply to HomeOps…" aria-label="Message HomeOps"
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none"
            rows={1} disabled={thinking}
          />
          <Button variant="ember" onClick={submit} disabled={!text.trim() || thinking}><Icon name="ArrowUp" size={16} /></Button>
        </div>
        <p className="px-1 pt-1.5 text-center text-[11px] text-ink-400">HomeOps proposes; you approve. Risky actions never run without your sign-off.</p>
      </div>
    </div>
  );
}

/** Phase strip shown while the AI is generating or a dispatched run is active. */
function PhaseStrip({ status, runStatus }: { status?: string; runStatus?: string }) {
  const phase =
    status === "thinking" ? { icon: "Loader2" as const, label: "Routing…", spin: true } :
    status === "streaming" ? { icon: "Loader2" as const, label: "Generating…", spin: true } :
    runStatus === "Running" || runStatus === "Queued" ? { icon: "Play" as const, label: "Executing…", spin: false } :
    runStatus === "Waiting for Approval" ? { icon: "ShieldAlert" as const, label: "Awaiting your approval", spin: false } :
    null;
  if (!phase) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-ink-400">
      <Icon name={phase.icon} size={13} className={phase.spin ? "animate-spin" : ""} />
      <span>{phase.label}</span>
    </div>
  );
}

function MessageRow({ conversationId, m }: { conversationId: string; m: AssistantMessage }) {
  const run = useStore((s) => m.runId ? s.data.runs?.find((r) => r.id === m.runId) : undefined);
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-b from-ink-700 to-ink-900 px-3.5 py-2.5 text-sm text-white shadow-e1">{m.text}</div>
      </div>
    );
  }
  const isGenerating = m.status === "thinking" || m.status === "streaming";
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-ember-400 to-ember-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"><Icon name="Sparkles" size={15} /></div>
      <div className="min-w-0 flex-1 space-y-2.5">
        {isGenerating
          ? <PhaseStrip status={m.status} />
          : m.status === "error"
            ? <div className="text-sm text-coral-600">{m.text}{m.error && <p className="mt-0.5 text-xs text-ink-400">Details: {m.error}</p>}</div>
            : <MarkdownContent text={m.text} />}
        {/* Phase strip for an active dispatched run */}
        {run && (run.status === "Running" || run.status === "Queued" || run.status === "Waiting for Approval") && (
          <PhaseStrip runStatus={run.status} />
        )}
        {m.plan && <PlanCard conversationId={conversationId} messageId={m.id} plan={m.plan} runId={m.runId} />}
      </div>
    </div>
  );
}

/* -------------------------------- Plan card ----------------------------- */
function PlanCard({ conversationId, messageId, plan, runId }: { conversationId: string; messageId: string; plan: AgentPlan; runId?: string }) {
  const runConversationPlan = useStore((s) => s.runConversationPlan);
  const run = useStore((s) => (runId ? s.data.runs.find((r) => r.id === runId) : undefined));
  const [busy, setBusy] = useState(false);
  const dispatch = async () => { setBusy(true); try { await runConversationPlan(conversationId, messageId); } finally { setBusy(false); } };

  return (
    <Card className="card-pad">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-ink-900 text-white"><Icon name={plan.icon || "Bot"} size={16} /></span>
          <div>
            <p className="font-display text-sm font-semibold text-ink-900">{plan.title}</p>
            <p className="text-xs text-ink-500">{plan.steps.length} step{plan.steps.length === 1 ? "" : "s"} · {plan.triggerType}</p>
          </div>
        </div>
        <RiskBadge level={plan.risk} />
      </div>

      <ol className="space-y-1.5">
        {plan.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2.5 rounded-xl border border-ink-900/[0.05] bg-surface-sunken/50 px-3 py-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-raised text-[11px] font-bold text-ink-600 shadow-e1">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-800">{s.title}</p>
              {s.detail && <p className="text-xs text-ink-500">{s.detail}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {s.connectorName && <Badge color={s.connected ? "sage" : "amber"}><Icon name="Plug" size={10} /> {s.connectorName}{s.connected ? "" : " · connect"}</Badge>}
                {s.requiresApproval && <Badge color="coral"><Icon name="ShieldAlert" size={10} /> approval</Badge>}
                {!s.toolId && <Badge color="gray">reasoning</Badge>}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {plan.missing.length > 0 && (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700"><Icon name="TriangleAlert" size={12} className="mr-1 inline" /> Connect {plan.missing.join(", ")} for every step to run.</p>
      )}

      {run ? <RunStatus run={run} /> : (
        <div className="mt-3 flex items-center gap-2">
          <Button variant={plan.approvalRequired ? "primary" : "ember"} disabled={busy} onClick={dispatch}>
            {busy ? <><Icon name="Loader2" size={15} className="animate-spin" /> Starting…</> : <><Icon name={plan.approvalRequired ? "ShieldCheck" : "Play"} size={15} /> {plan.approvalRequired ? "Run (with approvals)" : "Run plan"}</>}
          </Button>
          {plan.approvalRequired && <span className="text-xs text-ink-400">Risky steps will pause for your approval.</span>}
        </div>
      )}
    </Card>
  );
}

function RunStatus({ run }: { run: AutomationRun }) {
  const navigate = useStore((s) => s.navigate);
  const color = run.status === "Completed" ? "sage" : run.status === "Failed" ? "coral" : run.status === "Waiting for Approval" ? "amber" : "sky";
  return (
    <div className="mt-3 rounded-xl border border-ink-900/[0.06] bg-surface-rim p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
      <div className="mb-2 flex items-center justify-between">
        <Badge color={color}>
          {run.status === "Running" && <Icon name="Loader2" size={11} className="animate-spin" />}
          {run.status}
        </Badge>
        <span className="text-xs text-ink-500">{run.outputSummary}</span>
      </div>
      <ul className="space-y-1">
        {run.steps.map((st, i) => (
          <li key={i} className="flex items-center gap-2 text-xs">
            <Icon name={st.status === "done" ? "CheckCircle2" : st.status === "blocked" ? "Lock" : st.status === "running" ? "Loader2" : "Circle"} size={13} className={st.status === "done" ? "text-sage-500" : st.status === "blocked" ? "text-amber-600" : st.status === "running" ? "animate-spin text-sky-500" : "text-ink-300"} />
            <span className="text-ink-600">{st.label}</span>
          </li>
        ))}
      </ul>
      {run.status === "Waiting for Approval" && (
        <>
          <InlineApprovals runId={run.id} />
          <button onClick={() => navigate("messages", { tab: "approvals" })} className="mt-2 text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">Open full approvals console →</button>
        </>
      )}
      {(run.status === "Completed" || run.status === "Failed") && (
        <Button size="sm" variant="ghost" className="mt-2.5" onClick={() => navigate("activity")}><Icon name="History" size={13} /> View in history</Button>
      )}
    </div>
  );
}
