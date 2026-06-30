import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { Card, Button, Badge, StatusDot, Avatar, EmptyState, Modal, Field, TextInput, ReadinessBadge, ACCENT_BG } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { generateBriefing, suggestNextActions } from "@/lib/ai";
import { fmtDateFull, fmtTime, dayName, relativeTime, isOverdue } from "@/lib/dates";
import type { ScreenId } from "@/types";

export function Dashboard() {
  const data = useStore((s) => s.data);
  const me = useStore((s) => s.currentMember());
  const connectors = useStore((s) => s.connectors);
  const backendOnline = useStore((s) => s.backendOnline);
  const navigate = useStore((s) => s.navigate);
  const params = useStore((s) => s.route.params);
  const createTask = useStore((s) => s.createTask);
  const startConversation = useStore((s) => s.startConversation);
  const spaceFilter = useStore((s) => s.spaceFilter);
  const setSpaceFilter = useStore((s) => s.setSpaceFilter);
  const activeSpace = data.spaces.find((s) => s.id === spaceFilter);
  // Space filter actually scopes the dashboard's space-bound lists (P2-DATA-001).
  const inSpace = <T extends { spaceId?: string }>(arr: T[]): T[] => (spaceFilter === "all" ? arr : arr.filter((x) => x.spaceId === spaceFilter));

  const [reminderOpen, setReminderOpen] = useState(false);
  const [rTitle, setRTitle] = useState("");
  const [ask, setAsk] = useState("");

  useEffect(() => { if (params?.new === "reminder") setReminderOpen(true); }, [params?.new]);

  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = (me?.displayName ?? "there").split(" ")[0];

  const briefing = useMemo(() => generateBriefing(data), [data]);
  const suggestions = useMemo(() => suggestNextActions(data), [data]);
  const todayEvents = useMemo(() => inSpace([...data.events]).filter((e) => new Date(e.startAt).getTime() >= Date.now() - 3600_000).sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)).slice(0, 6), [data.events, spaceFilter]);
  const pendingApprovals = inSpace(data.approvals.filter((a) => a.status === "Pending"));
  const overdue = inSpace(data.tasks.filter((t) => t.status !== "done" && isOverdue(t.dueAt)));
  const activeAgents = inSpace(data.agents.filter((a) => a.status === "Active" || a.status === "Needs Attention"));
  const recentFiles = useMemo(() => inSpace([...data.files]).sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt)).slice(0, 4), [data.files, spaceFilter]);
  const recentThreads = useMemo(() => inSpace([...data.threads]).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 4), [data.threads, spaceFilter]);
  const liveConnectors = connectors.filter((c) => c.live);
  const attentionCount = overdue.length + pendingApprovals.length;

  const saveReminder = () => { if (rTitle.trim()) { createTask({ title: rTitle.trim(), type: "reminder", priority: "medium" }); setRTitle(""); setReminderOpen(false); } };
  const runAsk = () => {
    const t = ask.trim(); if (!t) return;
    void startConversation(t); // → opens a real assistant conversation (NL → plan → approval → run)
    setAsk("");
  };

  const quick: { label: string; icon: string; accent: keyof typeof ACCENT_BG; run: () => void }[] = [
    { label: "New agent", icon: "Bot", accent: "ink", run: () => navigate("agents", { new: "1" }) },
    { label: "New automation", icon: "Workflow", accent: "sage", run: () => navigate("automations", { tab: "builder" }) },
    { label: "Connect", icon: "Plug", accent: "lavender", run: () => navigate("connections") },
    { label: "Upload", icon: "Upload", accent: "amber", run: () => navigate("files", { new: "1" }) },
    { label: "Reminder", icon: "BellPlus", accent: "coral", run: () => setReminderOpen(true) },
    { label: "Template", icon: "Sparkles", accent: "sky", run: () => navigate("automations", { tab: "templates" }) },
  ];

  return (
    <div className="space-y-5">
      {/* ───────────────────────── The Hearth (signature) ───────────────────────── */}
      <div className="hearth card-pad animate-scale-in sm:p-7">
        <span className="hearth-glow" aria-hidden="true" />
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">{fmtDateFull(new Date())}</p>
            <h1 className="font-display mt-1.5 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-[2.7rem]">Good {partOfDay}, {firstName}</h1>
            <p className="mt-2.5 text-sm leading-relaxed text-white/70">
              Here's your household at a glance.{" "}
              {pendingApprovals.length > 0
                ? `${pendingApprovals.length} thing${pendingApprovals.length > 1 ? "s" : ""} need${pendingApprovals.length > 1 ? "" : "s"} your approval.`
                : "Nothing is waiting on you right now."}
            </p>
            {activeSpace && (
              <button onClick={() => setSpaceFilter("all")} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-white/25">
                <Icon name="Filter" size={12} /> Filtered to {activeSpace.name} · clear <Icon name="X" size={12} />
              </button>
            )}
            <div className="mt-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 p-1.5 shadow-[inset_0_2px_6px_rgba(0,0,0,0.25)] backdrop-blur">
              <Icon name="Sparkles" size={18} className="ml-2 text-ember-200" />
              <input value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runAsk()} placeholder="Ask HomeOps to do something…" aria-label="Ask HomeOps to do something" className="flex-1 bg-transparent py-2 text-sm text-white placeholder:text-white/50 focus:outline-none" />
              <button onClick={runAsk} className="rounded-xl bg-ember-400 px-3.5 py-2 text-sm font-semibold text-ink-900 shadow-ember transition-transform active:scale-95 hover:bg-ember-300">Go</button>
            </div>
          </div>
          {/* Family rhythm strip */}
          <div className="shrink-0">
            <p className="mb-2.5 text-xs font-medium uppercase tracking-[0.18em] text-white/45">Your family today</p>
            <div className="flex gap-2.5">
              {data.members.slice(0, 6).map((m) => {
                const count = data.events.filter((e) => e.memberIds.includes(m.id)).length + data.tasks.filter((t) => t.assignedMemberId === m.id && t.status !== "done").length;
                return (
                  <button key={m.id} onClick={() => navigate("spaces", { tab: "members", member: m.id })} className="group flex flex-col items-center gap-1.5">
                    <span className="relative transition-transform group-hover:-translate-y-0.5">
                      <Avatar initials={m.initials} color={m.avatarColor} size={44} />
                      {count > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ember-400 px-1 text-[10px] font-bold text-ink-900 shadow-ember">{count}</span>}
                    </span>
                    <span className="text-[10px] text-white/70">{m.displayName.split(" ")[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ───────────────────────── Quick actions ───────────────────────── */}
      <div className="stagger grid grid-cols-3 gap-2.5 sm:grid-cols-6">
        {quick.map((q, i) => (
          <button key={q.label} onClick={q.run} style={{ ["--i" as string]: i }} className="card lift pressable flex flex-col items-center gap-2 px-2 py-3.5">
            <span className={`flex h-10 w-10 items-center justify-center rounded-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ${ACCENT_BG[q.accent]}`}><Icon name={q.icon} size={18} /></span>
            <span className="text-xs font-semibold text-ink-700">{q.label}</span>
          </button>
        ))}
      </div>

      {/* ───────────────────────── Bento: briefing + attention ───────────────────────── */}
      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-6">
        {/* Briefing (wide) */}
        <Card className="card-pad lg:col-span-4">
          <Header icon="Sun" title="Today's family briefing" action={<Button size="sm" variant="secondary" onClick={() => navigate("messages", { thread: "th-briefing" })}><Icon name="MessageSquare" size={14} /> Open thread</Button>} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {briefing.map((s) => (
              <div key={s.label} className="well p-3.5">
                <div className="mb-2 flex items-center gap-2"><span className={`flex h-7 w-7 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ${ACCENT_BG[s.accent] ?? ACCENT_BG.gray}`}><Icon name={s.icon} size={15} /></span><h4 className="text-sm font-semibold text-ink-800">{s.label}</h4></div>
                <ul className="space-y-1.5">{s.items.map((it, i) => <li key={i} className="flex items-start gap-2 text-sm text-ink-600"><span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${(ACCENT_BG[s.accent] ?? ACCENT_BG.gray).split(" ")[0]}`} /><span>{it}</span></li>)}</ul>
              </div>
            ))}
          </div>
        </Card>

        {/* Needs attention (narrow accent tile) */}
        <Card className={`card-pad lg:col-span-2 ${attentionCount > 0 ? "border-amber-200 bg-gradient-to-b from-amber-50/70 to-surface-raised" : ""}`}>
          <Header icon="AlertCircle" title="Needs attention" action={attentionCount > 0 ? <Badge color="amber">{attentionCount}</Badge> : undefined} />
          {attentionCount === 0 ? <EmptyState icon="CheckCircle2" title="All caught up" message="Nothing needs you right now." /> : (
            <ul className="space-y-2">
              {pendingApprovals.slice(0, 3).map((a) => (
                <li key={a.id} onClick={() => navigate("messages", { tab: "approvals", approval: a.id })} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-amber-200/70 bg-surface-rim px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition-colors hover:bg-amber-50">
                  <Icon name="ShieldAlert" size={16} className="shrink-0 text-amber-600" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-800">{a.title}</p><p className="text-xs text-amber-600">Approval · {a.riskLevel} risk</p></div>
                </li>
              ))}
              {overdue.slice(0, 3).map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-2xl border border-coral-200/70 bg-surface-rim px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                  <Icon name="Clock" size={16} className="shrink-0 text-coral-600" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-800">{t.title}</p><p className="text-xs text-coral-600">Overdue{t.dueAt ? ` · ${relativeTime(t.dueAt)}` : ""}</p></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ───────────────────────── Bento: today · agents · systems ───────────────────────── */}
      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-6">
        {/* Today timeline */}
        <Card className="card-pad lg:col-span-2">
          <Header icon="CalendarDays" title="Today" />
          {todayEvents.length === 0 ? <EmptyState icon="CalendarCheck" title="A calm day" message="No appointments scheduled." /> : (
            <ol className="relative space-y-3 border-l border-ink-900/10 pl-4">
              {todayEvents.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface-raised bg-sky-400" />
                  <p className="text-xs font-semibold text-ink-400">{dayName(e.startAt).slice(0, 3)} · {fmtTime(e.startAt)}</p>
                  <p className="text-sm font-medium text-ink-800">{e.title}</p>
                  {e.location && <p className="text-xs text-ink-500">{e.location}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>

        {/* Active agents */}
        <Card className="card-pad lg:col-span-2">
          <Header icon="Bot" title="Helper agents" action={<button onClick={() => navigate("agents")} className="text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">All</button>} />
          {activeAgents.length === 0 ? <EmptyState icon="Bot" title="No active agents" message="Create your first helper." /> : (
            <ul className="space-y-2">
              {activeAgents.slice(0, 4).map((a) => (
                <li key={a.id} onClick={() => navigate("agents", { id: a.id })} className="data-row cursor-pointer">
                  <span className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-ink-700 to-ink-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"><Icon name={a.icon} size={16} /></span><span className="text-sm font-medium text-ink-800">{a.name}</span></span>
                  <StatusDot color={a.status === "Active" ? "sage" : "coral"} pulse={a.status === "Active"} label={a.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Connected systems health (REAL) */}
        <Card className="card-pad lg:col-span-2">
          <Header icon="Plug" title="Connected systems" action={<button onClick={() => navigate("connections")} className="text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">Manage</button>} />
          {!backendOnline && <div className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-600">Backend runtime offline — start it with <code>npm run dev</code>.</div>}
          <ul className="space-y-1.5">
            {(liveConnectors.length ? liveConnectors : connectors).slice(0, 5).map((c) => (
              <li key={c.id} onClick={() => navigate("connections", { id: c.id })} className="data-row cursor-pointer">
                <span className="flex items-center gap-2 text-sm font-medium text-ink-800"><Icon name="Plug" size={14} className="text-ink-400" />{c.name}</span>
                <ReadinessBadge readiness={c.readiness} />
              </li>
            ))}
            {connectors.length === 0 && <li className="text-sm text-ink-400">No connectors loaded.</li>}
          </ul>
        </Card>
      </div>

      {/* ───────────────────────── Bento: suggestions + recent ───────────────────────── */}
      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-6">
        {/* Suggested next actions (wide) */}
        <Card className="card-pad lg:col-span-4">
          <Header icon="Sparkles" title="Suggested next actions" />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => navigate(s.route.screen as ScreenId, s.route.params)} className="group flex items-center gap-3 rounded-2xl border border-ink-900/[0.06] bg-surface-rim px-3.5 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition-all hover:-translate-y-0.5 hover:border-ember-200 hover:shadow-e2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ember-50 text-ember-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><Icon name={s.icon} size={18} /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-800">{s.title}</p><p className="truncate text-xs text-ink-500">{s.detail}</p></div>
                <Icon name="ChevronRight" size={16} className="shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </Card>

        {/* Recent files + messages (narrow column) */}
        <div className="space-y-4 lg:col-span-2">
          <Card className="card-pad">
            <Header icon="FolderOpen" title="Recent documents" action={<button onClick={() => navigate("files")} className="text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">All</button>} />
            <ul className="space-y-1.5">
              {recentFiles.map((f) => (
                <li key={f.id} onClick={() => navigate("files", { file: f.id })} className="data-row cursor-pointer">
                  <span className="flex min-w-0 items-center gap-2"><Icon name="FileText" size={15} className="shrink-0 text-amber-600" /><span className="truncate text-sm text-ink-800">{f.name}</span></span>
                  {f.sensitive && <Icon name="Lock" size={13} className="shrink-0 text-lavender-600" />}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="card-pad">
            <Header icon="MessagesSquare" title="Family messages" action={<button onClick={() => navigate("messages")} className="text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">Inbox</button>} />
            <ul className="space-y-1.5">
              {recentThreads.map((t) => (
                <li key={t.id} onClick={() => navigate("messages", { thread: t.id })} className="data-row cursor-pointer">
                  <span className="flex min-w-0 items-center gap-2">{t.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" />}<span className={`truncate text-sm ${t.unread ? "font-bold text-ink-900" : "text-ink-700"}`}>{t.title}</span></span>
                  <span className="shrink-0 text-[11px] text-ink-400">{relativeTime(t.updatedAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Modal open={reminderOpen} onClose={() => setReminderOpen(false)} title="Create a reminder" icon="BellPlus" footer={<><Button variant="ghost" onClick={() => setReminderOpen(false)}>Cancel</Button><Button variant="ember" onClick={saveReminder} disabled={!rTitle.trim()}><Icon name="Plus" size={16} /> Add</Button></>}>
        <Field label="What's the reminder?"><TextInput autoFocus value={rTitle} onChange={(e) => setRTitle(e.target.value)} placeholder="e.g. Sign the field-trip slip" /></Field>
        <p className="mt-3 text-xs text-ink-400">Saved locally to your household.</p>
      </Modal>
    </div>
  );
}

function Header({ icon, title, action }: { icon: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-500"><Icon name={icon} size={14} /> {title}</h3>
      {action}
    </div>
  );
}
