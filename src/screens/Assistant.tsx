import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { Card, Button, Badge, RiskBadge, IconButton } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { InlineApprovals } from "@/components/InlineApprovals";
import { MarkdownContent } from "@/lib/markdown";
import { suggestAskPrompts, answerLocally } from "@/lib/ai";
import type { AssistantConversation, AssistantMessage, AutomationRun } from "@/types";
import { backend, type AgentPlan, type ChatBuild, type EmailReviewMessage, type EmailReviewLabel } from "@/connectors/api";

type ChatScope = "household" | "personal";

export function Assistant() {
  const conversations = useStore((s) => s.data.conversations) ?? [];
  const convId = useStore((s) => s.route.params?.id);
  const startConversation = useStore((s) => s.startConversation);
  const sendToAssistant = useStore((s) => s.sendToAssistant);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const navigate = useStore((s) => s.navigate);
  const conv = conversations.find((c) => c.id === convId);
  // Personal vs Family scope for NEW chats (persisted for the visit; passed as the
  // conversation's visibility when a chat is created).
  const [scope, setScope] = useState<ChatScope>("household");
  const start = (t: string) => void startConversation(t, { visibility: scope });

  if (!conv) return <AssistantHome conversations={conversations} scope={scope} onScope={setScope} onStart={start} onOpen={(id) => navigate("assistant", { id })} onDismiss={deleteConversation} />;
  return <Conversation key={conv.id} conv={conv} conversations={conversations} scope={scope} onScope={setScope} onOpen={(id) => navigate("assistant", { id })} onSend={(t, extra) => sendToAssistant(conv.id, t, extra)} />;
}

/** Personal / Family scope toggle for new chats. */
function ScopeToggle({ scope, onScope }: { scope: ChatScope; onScope: (s: ChatScope) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-xl border border-ink-900/[0.08] bg-surface-sunken/60 p-0.5" role="tablist" aria-label="Chat scope">
      {([["personal", "Personal", "Lock"], ["household", "Family", "Users"]] as const).map(([v, label, icon]) => (
        <button key={v} role="tab" aria-selected={scope === v} onClick={() => onScope(v)} title={v === "personal" ? "New chats are visible only to you" : "New chats are shared with the household"}
          className={`rounded-[10px] px-2.5 py-1 text-xs font-semibold transition-colors ${scope === v ? "bg-surface text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700"}`}>
          <Icon name={icon} size={11} className="mr-1 inline" />{label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------- Home / empty --------------------------- */
function AssistantHome({ conversations, scope, onScope, onStart, onOpen, onDismiss }: { conversations: AssistantConversation[]; scope: ChatScope; onScope: (s: ChatScope) => void; onStart: (t: string) => void; onOpen: (id: string) => void; onDismiss: (id: string) => void }) {
  const [text, setText] = useState("");
  const data = useStore((s) => s.data);
  const me = useStore((s) => s.currentMember());
  const first = (me?.displayName ?? "there").split(" ")[0];
  const suggestions = useMemo(() => suggestAskPrompts(data, me), [data, me]);
  const submit = () => { const t = text.trim(); if (t) { onStart(t); setText(""); } };
  return (
    <div className="animate-fade-in mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center py-6">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-ember-400 to-ember-600 text-white shadow-ember">
          <Icon name="Sparkles" size={26} />
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">Ask FamiliOS, {first}</h1>
        <p className="mt-1.5 text-sm text-ink-500">Tell me what you need. I'll answer, or draft a plan you can approve and run.</p>
        <div className="mt-3 flex justify-center"><ScopeToggle scope={scope} onScope={onScope} /></div>
      </div>

      <div className="card card-pad">
        <div className="flex items-end gap-2">
          <textarea
            autoFocus value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="e.g. Plan Lily's birthday and email the invites"
            aria-label="Ask FamiliOS"
            className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent py-2 text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none"
            rows={1}
          />
          <Button variant="ember" onClick={submit} disabled={!text.trim()}><Icon name="ArrowUp" size={16} /> Ask</Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
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
              <div key={c.id} className="group data-row flex items-center">
                <button onClick={() => onOpen(c.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
                  <Icon name="MessageSquare" size={14} className="shrink-0 text-ink-400" /><span className="truncate text-sm text-ink-700">{c.title}</span>
                </button>
                <IconButton
                  icon="X" label={`Remove "${c.title}" from recent chats`}
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={(e) => { e.stopPropagation(); onDismiss(c.id); }}
                />
                <Icon name="ChevronRight" size={15} className="ml-1 shrink-0 text-ink-300" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Conversation ---------------------------- */
function Conversation({ conv, conversations, scope, onScope, onOpen, onSend }: { conv: AssistantConversation; conversations: AssistantConversation[]; scope: ChatScope; onScope: (s: ChatScope) => void; onOpen: (id: string) => void; onSend: (t: string, extra?: Record<string, unknown>) => void }) {
  const navigate = useStore((s) => s.navigate);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const toast = useStore((s) => s.toast);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const assistantTopRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attached, setAttached] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const thinking = conv.messages.some((m) => m.status === "thinking");

  // Scroll rules: a user send follows to the bottom (the thinking indicator); when an
  // assistant reply ARRIVES, jump to the TOP of that reply so long answers read from
  // the start instead of the tail.
  const lastAssistant = [...conv.messages].reverse().find((m) => m.role === "assistant");
  const arrivedKey = lastAssistant && lastAssistant.status !== "thinking" && lastAssistant.status !== "streaming" ? lastAssistant.id : null;
  useEffect(() => {
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role === "user" || last.status === "thinking" || last.status === "streaming") {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [conv.messages.length]);
  useEffect(() => {
    if (arrivedKey) assistantTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [arrivedKey]);

  const attachFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    const base64 = await new Promise<string | undefined>((res) => {
      const reader = new FileReader();
      reader.onload = () => { const u = reader.result as string; res(u.includes(",") ? u.split(",")[1] : undefined); };
      reader.onerror = () => res(undefined);
      reader.readAsDataURL(file);
    });
    if (!base64) { setUploading(false); toast({ kind: "error", title: "Couldn't read that file" }); return; }
    const up = await backend.uploadFile({ name: file.name, mime: file.type || "application/octet-stream", contentBase64: base64, tags: ["Chat"], source: "chat" });
    setUploading(false);
    if (up.file) setAttached({ id: up.file.id, name: up.file.name });
    else toast({ kind: "error", title: "Upload failed", message: up.message ?? up.error });
  };

  const submit = () => {
    const t = text.trim();
    if (!t || thinking || uploading) return;
    if (attached) {
      onSend(`[Attached: ${attached.name}]\n${t}`, { attachedFileId: attached.id, attachedFileName: attached.name });
      setAttached(null);
    } else {
      onSend(t);
    }
    setText("");
  };
  const others = conversations.filter((c) => c.id !== conv.id).slice(0, 8);

  return (
    <div className="animate-fade-in mx-auto flex h-full max-w-3xl flex-col">
      {/* Pinned header: title + scope toggle + recent chats, above the scrolling list */}
      <div className="sticky top-0 z-10 mb-3 space-y-2 border-b border-ink-900/[0.06] bg-surface-base/85 pb-2 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-display truncate text-xl font-semibold text-ink-900">{conv.title}</h1>
          <div className="flex items-center gap-1.5">
            <ScopeToggle scope={scope} onScope={onScope} />
            <Button size="sm" variant="secondary" onClick={() => navigate("assistant")}><Icon name="Plus" size={14} /> New chat</Button>
            <Button size="sm" variant="ghost" onClick={() => deleteConversation(conv.id)} aria-label="Delete conversation"><Icon name="Trash2" size={15} /></Button>
          </div>
        </div>
        {others.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" aria-label="Recent chats">
            {others.map((c) => (
              <button key={c.id} onClick={() => onOpen(c.id)} title={c.title}
                className="chip max-w-[12rem] shrink-0 bg-surface-sunken text-ink-600 transition-colors hover:bg-surface-overlay">
                <Icon name="MessageSquare" size={11} /> <span className="truncate">{c.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto pb-4">
        {conv.messages.map((m, i) => (
          <div key={m.id} ref={m.id === lastAssistant?.id ? assistantTopRef : undefined} className="scroll-mt-28">
            <MessageRow conversationId={conv.id} m={m} precedingUserText={i > 0 && conv.messages[i - 1].role === "user" ? conv.messages[i - 1].text : undefined} />
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 mt-2 border-t border-ink-900/[0.06] bg-surface-base/80 pt-3 backdrop-blur-xl">
        {attached && (
          <div className="mb-1.5 flex items-center gap-2 px-1">
            <span className="chip bg-sky-100 text-sky-700"><Icon name="Paperclip" size={11} /> {attached.name}</span>
            <button onClick={() => setAttached(null)} aria-label="Remove attachment" className="text-ink-400 transition-colors hover:text-coral-600"><Icon name="X" size={13} /></button>
          </div>
        )}
        <div className="card flex items-end gap-2 px-3 py-2">
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => { void attachFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading || thinking} aria-label="Attach a file"
            className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-ink-900/[0.08] text-ink-500 transition-colors hover:border-ember-300 hover:text-ember-600 disabled:opacity-50">
            <Icon name={uploading ? "Loader2" : "Plus"} size={16} className={uploading ? "animate-spin" : ""} />
          </button>
          <textarea
            value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="Reply to FamiliOS…" aria-label="Message FamiliOS"
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none"
            rows={1} disabled={thinking}
          />
          <Button variant="ember" onClick={submit} disabled={!text.trim() || thinking || uploading}><Icon name="ArrowUp" size={16} /></Button>
        </div>
        <p className="px-1 pt-1.5 text-center text-[11px] text-ink-400">FamiliOS proposes; you approve. Risky actions never run without your sign-off.</p>
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

function MessageRow({ conversationId, m, precedingUserText }: { conversationId: string; m: AssistantMessage; precedingUserText?: string }) {
  const run = useStore((s) => m.runId ? s.data.runs?.find((r) => r.id === m.runId) : undefined);
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-b from-ink-700 to-ink-900 px-3.5 py-2.5 text-sm text-white shadow-e1">{m.text}</div>
      </div>
    );
  }
  const isGenerating = m.status === "thinking" || m.status === "streaming";
  // No AI provider connected: the backend honestly reports `error: "no_provider"`
  // rather than faking a response. Instead of leaving that as a dead end, hand the
  // original request to the local deterministic engine (src/lib/ai.ts) — the same
  // one the Workflow Builder's "built-in rules engine" already uses — so planning
  // and household-data requests still get a real, approvable answer. Genuinely
  // open-ended requests still get an honest, SCOPED prompt to connect a provider
  // (never the blanket wall). Provider-configured behavior is untouched below.
  const noProvider = m.status === "error" && m.error === "no_provider";
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-ember-400 to-ember-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"><Icon name="Sparkles" size={15} /></div>
      <div className="min-w-0 flex-1 space-y-2.5">
        {isGenerating
          ? <PhaseStrip status={m.status} />
          : noProvider
            ? <LocalFallbackCard originalText={precedingUserText ?? ""} />
            : m.status === "error"
              ? <div className="text-sm text-coral-600">{m.text}{m.error && <p className="mt-0.5 text-xs text-ink-400">Details: {m.error}</p>}</div>
              : <>
                  <MarkdownContent text={m.text} />
                  {m.model && <p className="flex items-center gap-1 text-[11px] text-ink-400"><Icon name="Sparkles" size={11} /> Answered by {m.model}.</p>}
                </>}
        {/* Phase strip for an active dispatched run */}
        {run && (run.status === "Running" || run.status === "Queued" || run.status === "Waiting for Approval") && (
          <PhaseStrip runStatus={run.status} />
        )}
        {m.plan && <PlanCard conversationId={conversationId} messageId={m.id} plan={m.plan} runId={m.runId} />}
        {m.build && <BuildCard conversationId={conversationId} messageId={m.id} build={m.build} status={m.status} progress={m.buildProgress} builtIds={m.builtIds} />}
        {/* Item 3: after a completed run that touched Gmail labels, an inline review card. */}
        {m.runId && run && run.status === "Completed" && <EmailReviewCard runId={m.runId} />}
      </div>
    </div>
  );
}

/* --------------------------- Local engine fallback ----------------------- *
 * Shown in place of the "no AI provider" wall. Classifies the original
 * request with the local deterministic engine (answerLocally, src/lib/ai.ts)
 * and renders whatever it can genuinely deliver: a real household-data
 * answer, a capability summary, or an approvable automation plan — the same
 * local rules engine that already powers the Workflow Builder's fallback.
 * Anything truly open-ended gets an honest, scoped nudge to connect a
 * provider instead of a dead-end wall. */
function LocalFallbackCard({ originalText }: { originalText: string }) {
  const data = useStore((s) => s.data);
  const member = useStore((s) => s.currentMember());
  const createAutomation = useStore((s) => s.createAutomation);
  const navigate = useStore((s) => s.navigate);
  const [created, setCreated] = useState(false);
  const answer = useMemo(() => answerLocally(originalText, data, member), [originalText, data, member]);

  const approve = () => {
    if (!answer.plan) return;
    createAutomation({
      name: originalText.slice(0, 48) || answer.plan.agentName,
      description: originalText,
      agentId: answer.plan.agentId,
      plan: answer.plan.plan,
      approvalRequired: answer.plan.approvalRequired,
      // T-05: the trigger the local engine actually detected (e.g. "Every morning
      // at 7am…" → Schedule), never hardcoded to Manual.
      triggerType: answer.plan.triggerType,
      status: "active",
      enabled: true,
    });
    setCreated(true);
  };

  return (
    <div className="space-y-2.5">
      <MarkdownContent text={answer.text} />
      {answer.kind === "plan" && answer.plan && (
        <div className="rounded-2xl border border-ink-900/[0.06] bg-surface-sunken/50 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge color="sky"><Icon name="Zap" size={10} /> {answer.plan.triggerType}</Badge>
            {answer.plan.approvalRequired && <Badge color="coral"><Icon name="ShieldAlert" size={10} /> approval</Badge>}
          </div>
          <ol className="space-y-1">
            {answer.plan.plan.steps.map((s) => (
              <li key={s.id} className="text-xs text-ink-600">
                {s.order}. {s.label}
                {s.needsApproval && <Icon name="ShieldAlert" size={11} className="ml-1 inline text-coral-500" />}
              </li>
            ))}
          </ol>
          {created ? (
            <p className="mt-2.5 flex items-center gap-1.5 text-xs text-sage-600"><Icon name="CheckCircle2" size={13} /> Added to Automations — approve any gated steps when it runs.</p>
          ) : (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ember" onClick={approve}><Icon name="Check" size={13} /> Approve & create automation</Button>
              <span className="text-xs text-ink-400">Creates a draft — gated steps still ask for approval.</span>
            </div>
          )}
        </div>
      )}
      {answer.kind === "unsupported" && (
        <Button size="sm" variant="secondary" onClick={() => navigate("settings")}><Icon name="Plug" size={13} /> Connect an AI provider</Button>
      )}
      <p className="flex items-center gap-1 text-[11px] text-ink-400"><Icon name="Cpu" size={11} /> Answered by the local rules engine{answer.kind === "unsupported" ? " — no provider connected" : "."}</p>
    </div>
  );
}

/* ---------------------------- Email review card ------------------------- *
 * Item 3: after a Gmail-triage run, review each modified message inline and undo /
 * relabel / mark-unread per row. Each action dispatches a fresh one-step
 * gmail.modifyLabels run (runPlan) so it still flows through the normal approval gate
 * (unless the household set a risk override for that tool). Reversal is derived from
 * what the original run applied: revert = add-back what was removed, remove what was added. */
function EmailReviewRow({ msg, labels, onAction }: { msg: EmailReviewMessage; labels: EmailReviewLabel[]; onAction: (m: EmailReviewMessage, add: string[], remove: string[], verb: string) => void }) {
  const [relabel, setRelabel] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const act = (add: string[], remove: string[], verb: string) => { onAction(msg, add, remove, verb); setDone(verb); };
  const senderName = msg.from.replace(/<[^>]*>/, "").trim() || msg.from;
  return (
    <li className="rounded-xl border border-ink-900/[0.06] bg-surface-sunken/40 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-800">{msg.subject || "(no subject)"}</p>
          <p className="truncate text-xs text-ink-500">{senderName}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {msg.added.map((l) => <Badge key={`a${l}`} color="sage">+{l}</Badge>)}
            {msg.removed.map((l) => <Badge key={`r${l}`} color="gray">−{l}</Badge>)}
          </div>
        </div>
      </div>
      {done ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-sage-600"><Icon name="CheckCircle2" size={13} /> {done} — sent{done === "Kept as-is" ? "" : " for approval"}.</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setDone("Kept as-is")}>Keep</Button>
          {(msg.added.length > 0 || msg.removed.length > 0) && (
            <Button size="sm" variant="secondary" onClick={() => act(msg.removed, msg.added, "Reverted")}><Icon name="Undo2" size={12} /> Revert</Button>
          )}
          {!msg.removed.includes("UNREAD") ? null : (
            <Button size="sm" variant="secondary" onClick={() => act(["UNREAD"], [], "Marked unread")}><Icon name="Mail" size={12} /> Mark unread</Button>
          )}
          <div className="flex items-center gap-1">
            <select value={relabel} onChange={(e) => setRelabel(e.target.value)} className="rounded-lg border border-ink-900/10 bg-surface-raised px-2 py-1 text-xs text-ink-700">
              <option value="">Relabel…</option>
              {labels.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
            </select>
            {relabel && <Button size="sm" variant="ember" onClick={() => act([relabel], msg.added, `Relabeled → ${relabel}`)}>Apply</Button>}
          </div>
        </div>
      )}
    </li>
  );
}

function EmailReviewCard({ runId }: { runId: string }) {
  const runPlan = useStore((s) => s.runPlan);
  const toast = useStore((s) => s.toast);
  const [messages, setMessages] = useState<EmailReviewMessage[]>([]);
  const [labels, setLabels] = useState<EmailReviewLabel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [customLabel, setCustomLabel] = useState("");

  useEffect(() => {
    let alive = true;
    void backend.emailReview(runId).then((r) => {
      if (!alive || !r) { setLoaded(true); return; }
      setMessages(r.touchedGmail ? r.messages : []);
      setLabels(r.labels);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [runId]);

  if (!loaded || messages.length === 0) return null;

  const action = (m: EmailReviewMessage, add: string[], remove: string[], verb: string) => {
    // One-step gmail.modifyLabels run — reuses the durable engine + approval gate.
    void runPlan({
      title: verb === "Reverted" ? `Revert label change for "${m.subject}"` : `${verb} — "${m.subject}"`,
      summary: "",
      steps: [{ toolId: "gmail.modifyLabels", title: verb, detail: `${verb} for ${m.from}`, requiresApproval: true, input: { messageIds: m.id, addLabels: add.join(","), removeLabels: remove.join(",") } }],
    }, { label: "Email review" });
    toast({ kind: "info", title: verb, message: "Sent to your runs — approve it in Messages & Approvals if prompted." });
  };

  return (
    <Card className="card-pad">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 text-white"><Icon name="MailCheck" size={16} /></span>
        <div>
          <p className="font-display text-sm font-semibold text-ink-900">Review what changed</p>
          <p className="text-xs text-ink-500">{messages.length} email{messages.length === 1 ? "" : "s"} modified — keep, revert, relabel, or mark unread.</p>
        </div>
      </div>
      <ul className="space-y-2">
        {messages.map((m) => <EmailReviewRow key={m.id} msg={m} labels={labels} onAction={action} />)}
      </ul>
      <div className="mt-3 flex items-center gap-2 border-t border-ink-900/[0.06] pt-3">
        <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="New label for all…" className="min-w-0 flex-1 rounded-lg border border-ink-900/10 bg-surface-raised px-2.5 py-1.5 text-xs text-ink-700" />
        <Button size="sm" variant="secondary" disabled={!customLabel.trim()} onClick={() => {
          const ids = messages.map((m) => m.id).join(",");
          void runPlan({ title: `Label ${messages.length} emails → ${customLabel}`, summary: "", steps: [{ toolId: "gmail.modifyLabels", title: `Relabel → ${customLabel}`, detail: "Bulk relabel from review", requiresApproval: true, input: { messageIds: ids, addLabels: customLabel.trim(), removeLabels: "" } }] }, { label: "Email review" });
          toast({ kind: "info", title: "Bulk relabel queued", message: `Creating "${customLabel}" and applying it — approve if prompted.` });
          setCustomLabel("");
        }}>Apply to all</Button>
      </div>
    </Card>
  );
}

/* -------------------------------- Build card ---------------------------- *
 * The unified chat-builder surface: previews the durable agent/skill/automation the
 * assistant proposes (each row expands to inspect details), then "Approve & build"
 * materializes them server-side (role-gated) with live per-entity progress — so you
 * build by talking, watch it happen, in the same thread. */
type RowState = "idle" | "building" | "done";
function BuildRow({ icon, kind, title, subtitle, detail, state, accent }: { icon: string; kind: string; title: string; subtitle?: string; detail?: React.ReactNode; state: RowState; accent?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`rounded-xl border px-3 py-2 ${accent ? "border-amber-200/60 bg-amber-50/60" : "border-ink-900/[0.05] bg-surface-sunken/50"}`}>
      <div className="flex items-start gap-2.5">
        {state === "building" ? <Icon name="Loader2" size={15} className="mt-0.5 shrink-0 animate-spin text-sky-500" />
          : state === "done" ? <Icon name="CheckCircle2" size={15} className="mt-0.5 shrink-0 text-sage-500" />
          : <Icon name={icon} size={15} className={`mt-0.5 shrink-0 ${accent ? "text-amber-600" : "text-ink-500"}`} />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-800">{kind} · {title}</p>
          {subtitle && <p className="text-xs text-ink-500">{subtitle}</p>}
        </div>
        {detail && (
          <button onClick={() => setOpen((v) => !v)} className="shrink-0 text-ink-400 transition-colors hover:text-ink-700" aria-label={open ? "Hide details" : "Show details"} aria-expanded={open}>
            <Icon name={open ? "ChevronUp" : "ChevronDown"} size={15} />
          </button>
        )}
      </div>
      {open && detail && <div className="mt-2 border-t border-ink-900/[0.06] pt-2 text-xs text-ink-600">{detail}</div>}
    </li>
  );
}
function BuildCard({ conversationId, messageId, build, status, progress, builtIds }: { conversationId: string; messageId: string; build: ChatBuild; status?: string; progress?: string[]; builtIds?: { skillId?: string; agentId?: string; triggerId?: string } }) {
  const buildFromChat = useStore((s) => s.buildFromChat);
  const navigate = useStore((s) => s.navigate);
  const [busy, setBusy] = useState(false);
  const built = status === "built";
  const running = status === "running";
  const done = new Set(progress ?? []);
  // A row's state: done once its entity arrived in the progress stream (or the whole
  // build finished); building while the build is running but this row hasn't arrived yet.
  const rowState = (key: string): RowState => built ? "done" : running ? (done.has(key) ? "done" : "building") : "idle";
  const go = async () => { setBusy(true); try { await buildFromChat(conversationId, messageId); } finally { setBusy(false); } };
  const editOnly = !build.skill && !build.agent && !build.automation && (build.edits ?? []).length > 0;
  return (
    <Card className="card-pad">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 text-white"><Icon name="Wand2" size={16} /></span>
        <div>
          <p className="font-display text-sm font-semibold text-ink-900">{built ? "Built" : editOnly ? "I'll update this" : "I'll set this up"}</p>
          <p className="text-xs text-ink-500">{build.summary}</p>
        </div>
      </div>
      <ul className="space-y-1.5">
        {build.skill && (
          <BuildRow icon="ListChecks" kind="Skill" title={build.skill.name} state={rowState("skill")}
            subtitle={build.skill.description || (build.skill.steps?.length ? `${build.skill.steps.length} step${build.skill.steps.length === 1 ? "" : "s"}` : undefined)}
            detail={
              <div className="space-y-1">
                {build.skill.planner_guidance && <p><span className="text-ink-400">Guidance:</span> {build.skill.planner_guidance}</p>}
                {build.skill.risk_level && <p><span className="text-ink-400">Risk:</span> {build.skill.risk_level}</p>}
                {build.skill.steps && build.skill.steps.length > 0 && (
                  <ol className="ml-3 list-decimal space-y-0.5">
                    {build.skill.steps.map((s, i) => <li key={i}>{s.name}{s.tool_id ? <span className="text-ink-400"> · {s.tool_id}</span> : <span className="text-ink-400"> · reasoning</span>}{s.approval_required && <span className="text-coral-600"> · approval</span>}</li>)}
                  </ol>
                )}
              </div>
            } />
        )}
        {build.agent && (
          <BuildRow icon="Bot" kind="Agent" title={build.agent.name} state={rowState("agent")} subtitle={build.agent.purpose}
            detail={build.agent.instructions ? <p><span className="text-ink-400">Instructions:</span> {build.agent.instructions}</p> : undefined} />
        )}
        {build.automation && (
          <BuildRow icon="Clock" kind="Automation" title={build.automation.name} state={rowState("automation")} subtitle={build.automation.type}
            detail={
              <p>{build.automation.type === "recurring" && build.automation.intervalMs ? `Runs every ${Math.round(build.automation.intervalMs / 3600000)}h` : build.automation.type === "schedule" && build.automation.runAt ? `Runs at ${build.automation.runAt}` : `Trigger: ${build.automation.type}`}. Gated steps still pause for approval.</p>
            } />
        )}
        {(build.edits ?? []).map((e, i) => (
          <BuildRow key={i} icon="Pencil" accent kind={`Update ${e.kind}`} title={e.id} state={rowState(e.kind)} subtitle={e.summary}
            detail={<pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-ink-600">{JSON.stringify(e.patch, null, 2)}</pre>} />
        ))}
      </ul>
      {built ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-1.5 text-sm text-sage-600"><Icon name="CheckCircle2" size={15} /> Done.</p>
          {builtIds?.agentId && <Button size="sm" variant="secondary" onClick={() => navigate("agents", { id: builtIds.agentId! })}><Icon name="Bot" size={13} /> Open helper</Button>}
          {builtIds?.triggerId && <Button size="sm" variant="secondary" onClick={() => navigate("automations", { id: builtIds.triggerId! })}><Icon name="Workflow" size={13} /> Open automation</Button>}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="ember" disabled={busy || running} onClick={go}>
            {busy || running ? <><Icon name="Loader2" size={15} className="animate-spin" /> {editOnly ? "Applying…" : "Building…"}</> : <><Icon name="Wand2" size={15} /> {editOnly ? "Approve & apply" : "Approve & build"}</>}
          </Button>
          <span className="text-xs text-ink-400">{editOnly ? "Changes are versioned and reversible." : "Creates a draft — gated steps still ask for approval when it runs."}</span>
        </div>
      )}
    </Card>
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
          <li key={i} className="text-xs">
            <div className="flex items-center gap-2">
              {/* "skipped" covers three honest non-successes (no delivery tool, policy
                  clamp, or a denied/expired approval) — never the neutral default a
                  status this codebase doesn't recognize used to fall into. */}
              <Icon
                name={st.status === "done" ? "CheckCircle2" : st.status === "blocked" ? "Lock" : st.status === "running" ? "Loader2" : st.status === "skipped" ? "SkipForward" : "Circle"}
                size={13}
                className={st.status === "done" ? "text-sage-500" : st.status === "blocked" ? "text-amber-600" : st.status === "running" ? "animate-spin text-sky-500" : st.status === "skipped" ? "text-amber-600" : "text-ink-300"}
              />
              <span className="text-ink-600">{st.label}</span>
            </div>
            {st.status === "skipped" && st.detail && <p className="ml-5 mt-0.5 text-[11px] text-amber-700">{st.detail}</p>}
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
