import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import {
  PageHeader, Card, Button, Badge, Tabs, Modal, Field, TextInput, TextArea, Select, EmptyState, RiskBadge, Avatar, StatusDot, Checkbox,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { relativeTime, fmtDateTime } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { backend } from "@/connectors/api";
import type { ApprovalRequest, MessageThread } from "@/types";

export function Messages() {
  const data = useStore((s) => s.data);
  const params = useStore((s) => s.route.params);
  const [tab, setTab] = useState("inbox");

  const pending = data.approvals.filter((a) => a.status === "Pending").length;
  const unread = data.threads.filter((t) => t.unread).length;

  useEffect(() => {
    if (params?.tab) setTab(params.tab);
    if (params?.approval) setTab("approvals");
    if (params?.thread || params?.new) setTab("inbox");
  }, [params?.tab, params?.approval, params?.thread, params?.new]);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Messages" subtitle="Agent updates, approval requests, and family contacts." icon="MessageSquare" />
      <Tabs tabs={[{ id: "inbox", label: "Inbox", icon: "Inbox", count: unread || undefined }, { id: "approvals", label: "Approvals", icon: "ShieldCheck", count: pending || undefined }, { id: "contacts", label: "Contacts", icon: "Users" }]} active={tab} onChange={setTab} />
      <div className="pt-5">
        {tab === "inbox" && <Inbox />}
        {tab === "approvals" && <Approvals />}
        {tab === "contacts" && <Contacts />}
      </div>
    </div>
  );
}

/* ------------------------------- Inbox ---------------------------------- */

function Inbox() {
  const data = useStore((s) => s.data);
  const params = useStore((s) => s.route.params);
  const sendMessage = useStore((s) => s.sendMessage);
  const resolveThread = useStore((s) => s.resolveThread);
  const escalateThread = useStore((s) => s.escalateThread);
  const reopenThread = useStore((s) => s.reopenThread);
  const markRead = useStore((s) => s.markThreadRead);
  const navigate = useStore((s) => s.navigate);
  const threads = useMemo(() => [...data.threads].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || +new Date(b.updatedAt) - +new Date(a.updatedAt)), [data.threads]);
  const [selected, setSelected] = useState<string | null>(threads[0]?.id ?? null);
  const [reply, setReply] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (params?.thread) { setSelected(params.thread); markRead(params.thread); }
    if (params?.new) setComposeOpen(true);
  }, [params?.thread, params?.new]);

  const thread = threads.find((t) => t.id === selected) ?? null;
  const messages = data.messages.filter((m) => m.threadId === selected);

  const open = (t: MessageThread) => { setSelected(t.id); markRead(t.id); };
  const send = () => { if (reply.trim() && thread) { sendMessage(thread.id, reply.trim()); setReply(""); setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50); } };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_1fr]">
      <div>
        <Button variant="primary" size="sm" className="mb-3 w-full" onClick={() => setComposeOpen(true)}><Icon name="Plus" size={15} /> New family update</Button>
        <div className="space-y-1.5">
          {threads.map((t) => (
            <button key={t.id} onClick={() => open(t)} className={cn("w-full rounded-2xl border p-3 text-left transition-all pressable", selected === t.id ? "border-ink-900/10 bg-surface-raised shadow-e1" : "border-ink-900/[0.06] bg-surface-sunken/60 hover:bg-surface-raised hover:shadow-e1")}>
              <div className="flex items-center gap-2">
                {t.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" />}
                {t.pinned && <Icon name="Pin" size={12} className="text-ink-400" />}
                <p className={cn("flex-1 truncate text-sm", t.unread ? "font-bold text-ink-900" : "font-medium text-ink-700")}>{t.title}</p>
                {t.status === "resolved" && <Badge color="sage">Resolved</Badge>}
                {t.status === "escalated" && <Badge color="coral">Urgent</Badge>}
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-500">{t.preview}</p>
              <p className="mt-0.5 text-[11px] text-ink-400">{relativeTime(t.updatedAt)}</p>
            </button>
          ))}
        </div>
      </div>

      <Card className="flex max-h-[70vh] flex-col">
        {!thread ? (
          <div className="flex-1"><EmptyState icon="MessageSquare" title="Select a conversation" message="Pick a thread to read and reply." /></div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-ink-900/[0.06] p-4">
              <div><p className="font-display text-lg font-semibold text-ink-900">{thread.title}</p><p className="text-xs text-ink-400">{data.spaces.find((s) => s.id === thread.spaceId)?.name}</p></div>
              <div className="flex gap-1">
                {thread.status === "open" ? <>
                  <Button size="sm" variant="ghost" onClick={() => escalateThread(thread.id)}><Icon name="Flame" size={14} /> Escalate</Button>
                  <Button size="sm" variant="secondary" onClick={() => resolveThread(thread.id)}><Icon name="Check" size={14} /> Resolve</Button>
                </> : <Button size="sm" variant="ghost" onClick={() => reopenThread(thread.id)}><Icon name="RotateCcw" size={14} /> Reopen</Button>}
              </div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.map((m) => {
                const mine = m.senderType === "user";
                return (
                  <div key={m.id} className={cn("flex", mine && "justify-end")}>
                    <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2.5", mine ? "bg-gradient-to-b from-ink-700 to-ink-900 text-white shadow-e1" : "bg-surface-sunken/70 text-ink-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]")}>
                      {!mine && <p className="mb-0.5 text-xs font-semibold text-ink-500">{m.senderName}</p>}
                      <p className="text-sm">{m.body}</p>
                      <div className={cn("mt-1 flex items-center gap-2 text-[10px]", mine ? "text-white/60" : "text-ink-400")}>
                        <span>{m.channel}</span><span>·</span><span>{m.deliveryStatus}</span><span>·</span><span>{relativeTime(m.createdAt)}</span>
                      </div>
                      {m.approvalRequestId && <Button size="sm" variant="secondary" className="mt-2" onClick={() => navigate("messages", { tab: "approvals", approval: m.approvalRequestId! })}><Icon name="ShieldCheck" size={13} /> Review approval</Button>}
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            <div className="flex items-center gap-2 border-t border-ink-900/[0.06] p-3">
              <TextInput value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Reply — your message becomes an instruction…" />
              <Button variant="primary" onClick={send} disabled={!reply.trim()}><Icon name="Send" size={15} /></Button>
            </div>
          </>
        )}
      </Card>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} onCreated={(id) => { setComposeOpen(false); setSelected(id); }} />
    </div>
  );
}

function ComposeModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const spaces = useStore((s) => s.data.spaces);
  const createThread = useStore((s) => s.createThread);
  const sendMessage = useStore((s) => s.sendMessage);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? "");
  const submit = () => {
    if (!title.trim()) return;
    const id = createThread({ title: title.trim(), spaceId });
    if (body.trim()) sendMessage(id, body.trim());
    onCreated(id);
    setTitle(""); setBody("");
  };
  return (
    <Modal open={open} onClose={onClose} title="Send a family update" icon="Send" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!title.trim()} onClick={submit}>Post update</Button></>}>
      <div className="space-y-3">
        <Field label="Title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekend plans" /></Field>
        <Field label="Space"><Select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>{spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Message"><TextArea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Posting to the family dashboard…" /></Field>
      </div>
    </Modal>
  );
}

/* ----------------------------- Approvals -------------------------------- */

function Approvals() {
  const approvals = useStore((s) => s.data.approvals);
  const params = useStore((s) => s.route.params);
  const pending = approvals.filter((a) => a.status === "Pending");
  const decided = approvals.filter((a) => a.status !== "Pending");
  const [openId, setOpenId] = useState<string | null>(params?.approval ?? null);
  useEffect(() => { if (params?.approval) setOpenId(params.approval); }, [params?.approval]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-lavender-200/70 bg-lavender-50 px-4 py-2.5 text-sm text-lavender-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] flex items-center gap-2">
        <Icon name="ShieldCheck" size={16} /> High-risk actions pause here for your approval before anything leaves the household.
      </div>
      <div>
        <p className="section-title mb-2">Pending ({pending.length})</p>
        {pending.length === 0 ? <EmptyState icon="CheckCircle2" title="Nothing to approve" message="Your helpers have everything they need." /> : (
          <div className="space-y-3">{pending.map((a) => <ApprovalCard key={a.id} approval={a} expanded={openId === a.id} onToggle={() => setOpenId(openId === a.id ? null : a.id)} />)}</div>
        )}
      </div>
      {decided.length > 0 && (
        <div>
          <p className="section-title mb-2">Decided</p>
          <div className="space-y-2">{decided.map((a) => <ApprovalCard key={a.id} approval={a} expanded={openId === a.id} onToggle={() => setOpenId(openId === a.id ? null : a.id)} />)}</div>
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ approval: a, expanded, onToggle }: { approval: ApprovalRequest; expanded: boolean; onToggle: () => void }) {
  const data = useStore((s) => s.data);
  const approve = useStore((s) => s.approveRequest);
  const deny = useStore((s) => s.denyRequest);
  const askChanges = useStore((s) => s.askAgentForChanges);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(a.previewContent);
  const [askMode, setAskMode] = useState(false);
  const [note, setNote] = useState("");
  const agent = data.agents.find((ag) => ag.id === a.requestedByAgentId);
  const space = data.spaces.find((s) => s.id === a.spaceId);
  const decider = data.members.find((m) => m.id === a.decisionByMemberId);
  const pending = a.status === "Pending";

  return (
    <Card className="card-pad">
      <button className="flex w-full items-start justify-between gap-3 text-left" onClick={onToggle}>
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold text-ink-900">{a.title}</p>
          <p className="text-xs text-ink-500">{agent?.name} · {space?.name} · {a.category}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RiskBadge level={a.riskLevel} />
          {!pending && <Badge color={a.status === "Denied" || a.status === "Execution Failed" ? "coral" : a.status === "Changes Requested" ? "amber" : a.status === "Executing" ? "sky" : "sage"}>{a.status}</Badge>}
        </div>
      </button>
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-ink-900/[0.06] pt-3 text-sm">
          {a.status === "Executing" && <div className="flex items-center gap-2 rounded-2xl border border-sky-200/70 bg-sky-50 px-3 py-2 text-sky-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><Icon name="Loader2" size={15} className="animate-spin" /> Executing the approved action…</div>}
          {a.executionOk !== undefined && (
            <div className={cn("rounded-2xl px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]", a.executionOk ? "border border-sage-200/70 bg-sage-50 text-sage-700" : "border border-coral-200/70 bg-coral-50 text-coral-700")}>
              <p className="flex items-center gap-2 font-medium"><Icon name={a.executionOk ? "CheckCircle2" : "XCircle"} size={15} /> {a.executionOk ? "Executed successfully" : "Execution failed"}{a.executionMs ? ` · ${(a.executionMs / 1000).toFixed(1)}s` : ""}</p>
              {a.executionResult && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{a.executionResult.slice(0, 800)}</pre>}
            </div>
          )}
          <Detail label="Proposed action" value={a.proposedAction} />
          <Detail label="Data used" value={a.dataUsedSummary} />
          <Detail label="Recipient / target" value={a.recipientSummary} />
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Preview</p>
            {editing ? <TextArea value={edited} onChange={(e) => setEdited(e.target.value)} className="min-h-[120px]" /> : <pre className="well whitespace-pre-wrap p-3 text-sm text-ink-700">{a.previewContent}</pre>}
          </div>
          {askMode && <Field label="What should the agent change?"><TextArea value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
          <p className="text-xs text-ink-400">{pending ? `Requested ${relativeTime(a.createdAt)}` : `${a.status} by ${decider?.displayName ?? "you"} · ${fmtDateTime(a.decisionAt ?? a.updatedAt)}`}</p>
          {pending && (
            <div className="flex flex-wrap items-center gap-2">
              {!editing && !askMode && <>
                <Button variant="success" onClick={() => approve(a.id)}><Icon name="Check" size={15} /> Approve</Button>
                <Button variant="danger" onClick={() => deny(a.id)}><Icon name="X" size={15} /> Deny</Button>
                {/* Edit / Ask-for-changes are meaningless for a server-driven run gate —
                    the server executes the frozen step input on approval. Hide them so the
                    edit isn't silently dropped and the run can't be left hanging. */}
                {!a.serverManaged && <>
                  <Button variant="secondary" onClick={() => setEditing(true)}><Icon name="Pencil" size={14} /> Edit before approval</Button>
                  <Button variant="ghost" onClick={() => setAskMode(true)}><Icon name="MessageCircleQuestion" size={14} /> Ask for changes</Button>
                </>}
              </>}
              {editing && <><Button variant="success" onClick={() => { approve(a.id, edited); setEditing(false); }}><Icon name="Check" size={15} /> Approve edited</Button><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></>}
              {askMode && <><Button variant="primary" disabled={!note.trim()} onClick={() => { askChanges(a.id, note.trim()); setAskMode(false); setNote(""); }}>Send to agent</Button><Button variant="ghost" onClick={() => setAskMode(false)}>Cancel</Button></>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><span className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}: </span><span className="text-ink-700">{value}</span></div>;
}

/* ----------------------------- Contacts --------------------------------- */

function Contacts() {
  const data = useStore((s) => s.data);
  const session = useStore((s) => s.session);
  const sendCode = useStore((s) => s.sendContactVerification);
  const confirmCode = useStore((s) => s.confirmContactVerification);
  const manualVerify = useStore((s) => s.verifyContactMethod);
  const setAllowed = useStore((s) => s.setContactAllowedAgents);
  const addContact = useStore((s) => s.addContactMethod);
  const toast = useStore((s) => s.toast);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  // The true verification loop: request a code through the method's real channel,
  // then enter it. The adult-only manual override is offered only when the channel
  // honestly can't deliver a code yet (needs setup in Connections).
  const isAdult = ["Owner", "Adult Admin", "Adult Member"].includes(session?.role ?? "");
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [codeEntryId, setCodeEntryId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [manualOfferId, setManualOfferId] = useState<string | null>(null);

  const startVerify = async (id: string) => {
    setSendingId(id); setManualOfferId(null);
    const r = await sendCode(id);
    setSendingId(null);
    if (r.ok) { setCodeEntryId(id); setCode(""); }
    else if (r.needsSetup) setManualOfferId(id);
  };
  const submitCode = async (id: string) => {
    if (!/^\d{6}$/.test(code.trim())) return;
    setConfirming(true);
    const r = await confirmCode(id, code.trim());
    setConfirming(false);
    if (r.ok) { setCodeEntryId(null); setCode(""); }
  };

  // Item 16b: actually attempt delivery through the method's real channel and report the
  // honest result (delivered, or which connector needs setup). The send goes by methodId
  // so the SERVER resolves channel + address from its registry — including the verified/
  // opt-in gate, which is enforced there, not here.
  const sendTest = async (c: { id: string; type: string; value: string; label: string }) => {
    setTestingId(c.id);
    const r = await backend.notify({ methodId: c.id, title: "FamiliOS test", body: `This is a test notification to your "${c.label}" contact method.` });
    setTestingId(null);
    if (r.delivered) toast({ kind: "success", title: "Test sent", message: r.message ?? "Delivered." });
    else if (r.needsSetup) toast({ kind: "warn", title: "Channel needs setup", message: r.message ?? "Connect the required service in Connections." });
    else if (r.error === "method_not_verified" || r.error === "method_not_opted_in") toast({ kind: "warn", title: "Not deliverable yet", message: r.message ?? "Verify this contact method first." });
    else toast({ kind: "error", title: "Couldn't deliver", message: r.message ?? r.error ?? "Delivery failed." });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-sky-200/70 bg-sky-50 px-4 py-2.5 text-sm text-sky-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] flex items-center gap-2"><Icon name="Info" size={16} /> Agents can only message a contact method that's <strong>verified</strong> and opted-in.</div>
      {data.members.map((m) => {
        const methods = data.contactMethods.filter((c) => c.memberId === m.id);
        return (
          <Card key={m.id} className="card-pad">
            <div className="mb-3 flex items-center gap-3">
              <Avatar initials={m.initials} color={m.avatarColor} size={36} />
              <div className="flex-1"><p className="font-display text-lg font-semibold text-ink-900">{m.displayName}</p><p className="text-xs text-ink-500">{m.role} · {m.relationship}</p></div>
              <Button size="sm" variant="ghost" onClick={() => setAddingFor(m.id)}><Icon name="Plus" size={14} /> Add method</Button>
            </div>
            {methods.length === 0 ? <p className="text-sm text-ink-400">No contact methods yet.</p> : (
              <div className="space-y-2">{methods.map((c) => (
                <div key={c.id} className="well p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><Icon name={c.type === "Email" ? "Mail" : c.type === "Phone/Text" ? "Smartphone" : "Bell"} size={15} className="text-ink-500" /><div><p className="text-sm font-medium text-ink-800">{c.label}</p><p className="text-xs text-ink-500">{c.value}</p></div></div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="ghost" disabled={testingId === c.id} onClick={() => sendTest(c)}>{testingId === c.id ? <Icon name="Loader2" size={13} className="animate-spin" /> : <Icon name="Send" size={13} />} Send test</Button>
                      {c.verified ? <Badge color="sage"><Icon name="BadgeCheck" size={11} /> Verified</Badge> : (
                        <Button size="sm" variant="secondary" disabled={sendingId === c.id} onClick={() => startVerify(c.id)}>
                          {sendingId === c.id ? <Icon name="Loader2" size={13} className="animate-spin" /> : <Icon name="ShieldCheck" size={13} />} Verify
                        </Button>
                      )}
                      <StatusDot color={c.optInStatus === "Opted In" ? "sage" : "amber"} label={c.optInStatus} />
                    </div>
                  </div>
                  {codeEntryId === c.id && !c.verified && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-sky-200/70 bg-sky-50 p-2.5">
                      <p className="text-xs text-sky-700">Enter the 6-digit code sent to <strong>{c.value}</strong>:</p>
                      <TextInput
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        onKeyDown={(e) => e.key === "Enter" && submitCode(c.id)}
                        placeholder="000000"
                        inputMode="numeric"
                        className="w-28 text-center tracking-[0.3em]"
                      />
                      <Button size="sm" variant="primary" disabled={!/^\d{6}$/.test(code) || confirming} onClick={() => submitCode(c.id)}>{confirming ? <Icon name="Loader2" size={13} className="animate-spin" /> : <Icon name="Check" size={13} />} Confirm</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setCodeEntryId(null); setCode(""); }}>Cancel</Button>
                    </div>
                  )}
                  {manualOfferId === c.id && !c.verified && isAdult && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200/70 bg-amber-50 p-2.5">
                      <p className="text-xs text-amber-700">This channel can't deliver a code until it's set up in Connections. As an adult you can take responsibility and mark it verified.</p>
                      <Button size="sm" variant="secondary" onClick={() => { setManualOfferId(null); void manualVerify(c.id); }}><Icon name="ShieldAlert" size={13} /> Mark verified manually</Button>
                    </div>
                  )}
                  <div className="mt-2">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Agents allowed to message this</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {data.agents.filter((a) => a.status !== "Archived").slice(0, 8).map((a) => (
                        <Checkbox key={a.id} checked={c.allowedAgentIds.includes(a.id)} onChange={(v) => setAllowed(c.id, v ? [...c.allowedAgentIds, a.id] : c.allowedAgentIds.filter((x) => x !== a.id))} label={<span className="text-xs">{a.name}</span>} />
                      ))}
                    </div>
                  </div>
                </div>
              ))}</div>
            )}
          </Card>
        );
      })}
      {addingFor && <AddContactModal memberId={addingFor} onClose={() => setAddingFor(null)} onAdd={addContact} />}
    </div>
  );
}

// Per-type shape for the "Value" field — this is the bug fix: the field used to be
// hardcoded to phone formatting regardless of which type was selected. In-App and
// Family Dashboard aren't external addresses at all (there's nothing to type — the
// notification is just "shown inside FamiliOS" / "shown on the shared dashboard"), so
// they get a fixed, non-editable value instead of an address field.
const CONTACT_TYPE_META: Record<"Email" | "Phone/Text" | "In-App" | "Family Dashboard", {
  inputType: string; placeholder: string; hint: string; fixedValue: string | null; validate: (v: string) => boolean;
}> = {
  "Email": { inputType: "email", placeholder: "you@example.com", hint: "Used for email notifications.", fixedValue: null, validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) },
  "Phone/Text": { inputType: "tel", placeholder: "(555) 000-0000", hint: "Used for text message notifications.", fixedValue: null, validate: (v) => v.replace(/\D/g, "").length >= 7 },
  "In-App": { inputType: "text", placeholder: "", hint: "Notifications appear in FamiliOS when this profile is signed in — no address needed.", fixedValue: "in-app", validate: () => true },
  "Family Dashboard": { inputType: "text", placeholder: "", hint: "Shown on the shared household dashboard display — no address needed.", fixedValue: "dashboard", validate: () => true },
};

function AddContactModal({ memberId, onClose, onAdd }: { memberId: string; onClose: () => void; onAdd: (memberId: string, input: { label: string; value: string; type?: "Email" | "Phone/Text" | "In-App" | "Family Dashboard" }) => void }) {
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [type, setType] = useState<"Email" | "Phone/Text" | "In-App" | "Family Dashboard">("Email");
  // Guard the lookup: a select can surface an out-of-set value (autofill, extensions,
  // scripted input) and an unguarded index would crash the whole modal.
  const meta = CONTACT_TYPE_META[type] ?? CONTACT_TYPE_META["Email"];
  const effectiveValue = meta.fixedValue ?? value;
  const valueValid = meta.fixedValue != null || (value.trim() !== "" && meta.validate(value.trim()));
  const changeType = (t: typeof type) => { if (!CONTACT_TYPE_META[t]) return; setType(t); if (CONTACT_TYPE_META[t].fixedValue == null) setValue(""); };
  return (
    <Modal open onClose={onClose} title="Add contact method" icon="Plus" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!label.trim() || !valueValid} onClick={() => { onAdd(memberId, { label, value: effectiveValue, type }); onClose(); }}>Add</Button></>}>
      <div className="space-y-3">
        <Field label="Type"><Select value={type} onChange={(e) => changeType(e.target.value as typeof type)}><option>Email</option><option>Phone/Text</option><option>In-App</option><option>Family Dashboard</option></Select></Field>
        <Field label="Label"><TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Mobile" /></Field>
        {meta.fixedValue == null ? (
          <Field label="Value" hint={meta.hint}>
            <TextInput type={meta.inputType} value={value} onChange={(e) => setValue(e.target.value)} placeholder={meta.placeholder} />
            {value.trim() !== "" && !valueValid && <p className="mt-1 text-xs text-coral-600">{type === "Email" ? "Enter a valid email address." : "Enter a valid phone number."}</p>}
          </Field>
        ) : (
          <Field label="Value" hint={meta.hint}><p className="rounded-lg border border-ink-900/[0.06] bg-surface-sunken/60 px-3 py-2 text-sm text-ink-500">No address needed for this type.</p></Field>
        )}
      </div>
    </Modal>
  );
}
