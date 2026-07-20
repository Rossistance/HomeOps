import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { workflowTemplates } from "@/data/workflowTemplates";
import { BrowserWorkflowsPanel, SandboxRunsPanel } from "@/components/BrowserSandbox";
import {
  PageHeader, Card, Button, IconButton, Badge, Tabs, Modal, Drawer, Field, TextInput, TextArea, Select, Toggle, EmptyState, StatusDot, RiskBadge,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { InlineApprovals } from "@/components/InlineApprovals";
import { ExecutionMonitor } from "@/components/runs/ExecutionMonitor";
import { ServerTriggersPanel } from "@/components/triggers/ServerTriggers";
import { relativeTime, fmtDateTime } from "@/lib/dates";
import { useAdvancedMode } from "@/lib/prefs";
import { detectTrigger, detectIntent } from "@/lib/ai";
import { PlanPreview, useConnectables } from "@/screens/Agents";
import type { Automation, TriggerType, WorkflowPlan, WorkflowTemplate } from "@/types";
import type { AgentPlan } from "@/connectors/api";

const TRIGGER_TYPES: TriggerType[] = ["Manual", "Schedule", "Webhook", "RSS Feed", "Email Received", "Email Label Applied", "Text Message Received", "Email Reply Received", "Calendar Event Created", "Calendar Event Changed", "File Changed", "Agent-to-Agent"];
const AUTO_STATUSES: Automation["status"][] = ["active", "paused", "draft", "error"];

// The low-level surfaces (raw Triggers, Browser Workflows, Background Jobs) are power-user
// tools; they're gated behind Advanced Mode so a new household sees only the everyday tabs
// (Automations, Live, Workflow Builder, Templates, Run History). Same toggle that gates
// Skills/Functions in the nav — keeps "simple by default" consistent across the app.
const TABS: { id: string; label: string; icon: string; advanced?: boolean }[] = [
  { id: "automations", label: "Automations", icon: "Workflow" },
  { id: "triggers", label: "Triggers", icon: "Zap", advanced: true },
  { id: "monitor", label: "Live", icon: "Activity" },
  { id: "builder", label: "Workflow Builder", icon: "Sparkles" },
  { id: "templates", label: "Templates", icon: "LayoutGrid" },
  { id: "browser", label: "Browser Workflows", icon: "Globe", advanced: true },
  { id: "sandbox", label: "Background Jobs", icon: "Clock", advanced: true },
  { id: "history", label: "Run History", icon: "History" },
];

export function Automations() {
  const data = useStore((s) => s.data);
  const params = useStore((s) => s.route.params);
  const [advanced] = useAdvancedMode();
  const [tab, setTab] = useState("automations");
  const [editId, setEditId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const visibleTabs = TABS.filter((t) => advanced || !t.advanced);

  useEffect(() => {
    if (params?.tab && TABS.some((t) => t.id === params.tab)) setTab(params.tab);
    if (params?.id) { setTab("automations"); setEditId(params.id); }
  }, [params?.tab, params?.id]);

  // If Advanced Mode is turned off while on a now-hidden power tab, fall back to the list.
  useEffect(() => {
    if (!visibleTabs.some((t) => t.id === tab)) setTab("automations");
  }, [advanced, tab, visibleTabs]);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Automations" subtitle="Triggers, workflow plans, browser & sandbox runs — all in one place." icon="Workflow" />
      <Tabs tabs={visibleTabs.map((t) => ({ ...t, count: t.id === "automations" ? data.automations.length : t.id === "templates" ? workflowTemplates.length : undefined }))} active={tab} onChange={setTab} />
      <div className="pt-5">
        {tab === "automations" && <AutomationsList onEdit={setEditId} />}
        {tab === "triggers" && <ServerTriggersPanel />}
        {tab === "monitor" && <ExecutionMonitor />}
        {tab === "builder" && <WorkflowBuilder onActivated={() => setTab("automations")} />}
        {tab === "templates" && <TemplatesGrid onOpen={setTemplateId} />}
        {tab === "browser" && <BrowserWorkflowsPanel />}
        {tab === "sandbox" && <SandboxRunsPanel />}
        {tab === "history" && <RunHistory />}
      </div>
      {editId && <EditAutomationModal id={editId} onClose={() => setEditId(null)} />}
      {templateId && <TemplateDetail id={templateId} onClose={() => setTemplateId(null)} onUse={() => { setTemplateId(null); setTab("automations"); }} />}
    </div>
  );
}

const STATUS: Record<Automation["status"], "sage" | "amber" | "sky" | "coral"> = { active: "sage", paused: "amber", draft: "sky", error: "coral" };

function AutomationsList({ onEdit }: { onEdit: (id: string) => void }) {
  const automations = useStore((s) => s.data.automations);
  const agents = useStore((s) => s.data.agents);
  const toggle = useStore((s) => s.toggleAutomation);
  const test = useStore((s) => s.testAutomation);
  const del = useStore((s) => s.deleteAutomation);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<Automation | null>(null);
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "Agent";

  if (!automations.length) return <EmptyState icon="Workflow" title="No automations yet" message="Build one from plain English or start from a template." />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {automations.map((a) => (
        <Card key={a.id} className="card-pad">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display text-base font-semibold text-ink-900">{a.name}</p>
              <p className="text-xs text-ink-500">{a.description}</p>
            </div>
            <Badge color={STATUS[a.status]}>{a.status}</Badge>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
            <span className="flex items-center gap-1"><Icon name="Zap" size={12} /> {a.triggerType}</span>
            <span className="flex items-center gap-1"><Icon name="Bot" size={12} /> {agentName(a.agentId)}</span>
            {a.lastRunAt && <span className="flex items-center gap-1"><Icon name="History" size={12} /> ran {relativeTime(a.lastRunAt)}</span>}
            {a.nextRunAt && <span className="flex items-center gap-1"><Icon name="Clock" size={12} /> next {relativeTime(a.nextRunAt)}</span>}
            {a.approvalRequired && <span className="flex items-center gap-1 text-coral-600"><Icon name="ShieldAlert" size={12} /> Approval</span>}
            {a.failureCount > 0 && <span className="flex items-center gap-1 text-coral-600"><Icon name="TriangleAlert" size={12} /> {a.failureCount} fail</span>}
          </div>
          {a.secondaryTriggers && a.secondaryTriggers.length > 0 && (
            <p className="mt-1 text-xs text-sky-600">+{a.secondaryTriggers.length} more trigger: {a.secondaryTriggers.map((t) => t.type).join(", ")}</p>
          )}
          <div className="mt-3 flex items-center gap-1 border-t border-ink-900/[0.06] pt-3">
            <Toggle checked={a.enabled} onChange={() => toggle(a.id)} />
            <span className="text-xs text-ink-500">{a.enabled ? "Enabled" : "Disabled"}</span>
            <div className="ml-auto flex gap-1">
              <Button size="sm" variant="secondary" disabled={runningId === a.id} onClick={async () => { setRunningId(a.id); await test(a.id); setRunningId(null); }}>{runningId === a.id ? <><Icon name="Loader2" size={13} className="animate-spin" /> Running</> : <><Icon name="Play" size={13} /> Run</>}</Button>
              <IconButton icon="Pencil" label="Edit" onClick={() => onEdit(a.id)} />
              <IconButton icon="Trash2" label="Delete" onClick={() => setConfirmDel(a)} />
            </div>
          </div>
        </Card>
      ))}
      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Delete this automation?" icon="Trash2"
        footer={<><Button variant="ghost" onClick={() => setConfirmDel(null)}>Cancel</Button><Button variant="danger" onClick={() => { if (confirmDel) del(confirmDel.id); setConfirmDel(null); }}><Icon name="Trash2" size={15} /> Delete</Button></>}>
        <p className="text-sm text-ink-600">Permanently delete <strong>{confirmDel?.name}</strong>? Its run history stays in the activity log.</p>
      </Modal>
    </div>
  );
}

function PlanView({ plan, approvalRequired }: { plan: WorkflowPlan; approvalRequired: boolean }) {
  const rows: { n: number; label: string; body: React.ReactNode }[] = [
    { n: 1, label: "Trigger", body: plan.trigger },
    { n: 2, label: "Input sources", body: plan.inputSources.join(", ") || "—" },
    { n: 3, label: "Agent assigned", body: plan.agentName },
    { n: 4, label: "Steps", body: <ol className="ml-4 list-decimal space-y-0.5">{plan.steps.map((s) => <li key={s.id}>{s.label} {s.needsApproval && <Icon name="ShieldAlert" size={12} className="inline text-coral-500" />}<span className="text-xs text-ink-400"> — {s.detail}</span></li>)}</ol> },
    { n: 5, label: "Tools / actions", body: plan.toolsActions.join(", ") },
    { n: 6, label: "Approval gates", body: <span className={approvalRequired ? "text-coral-600" : ""}>{plan.approvalGates.join(" · ")}</span> },
    { n: 7, label: "Output", body: plan.output },
    { n: 8, label: "Notifications", body: plan.notifications.join(", ") },
    { n: 9, label: "Error handling", body: plan.errorHandling },
    { n: 10, label: "Activity logging", body: plan.activityLogging },
  ];
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.n} className="well flex gap-3 p-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ink-700 to-ink-900 text-xs font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">{r.n}</span>
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-ink-400">{r.label}</p><div className="text-sm text-ink-700">{r.body}</div></div>
        </div>
      ))}
    </div>
  );
}

function WorkflowBuilder({ onActivated }: { onActivated: () => void }) {
  const planAgentFromGoal = useStore((s) => s.planAgentFromGoal);
  const createAutomationFromPlan = useStore((s) => s.createAutomationFromPlan);
  const testAutomation = useStore((s) => s.testAutomation);
  const planFromPrompt = useStore((s) => s.planFromPrompt);
  const createAutomation = useStore((s) => s.createAutomation);
  const connectables = useConnectables();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Local rules-engine preview (no AI provider needed). Kept separate from `plan`
  // (the provider-generated AgentPlan shape) since planFromPrompt returns a
  // WorkflowPlan — previewed here so the resolved trigger is visible BEFORE the
  // automation is created, instead of creating it blind.
  const [localPreview, setLocalPreview] = useState<{ plan: WorkflowPlan; agentId: string; agentName: string; approvalRequired: boolean; triggerType: TriggerType } | null>(null);

  const samples = [
    "Every morning, send me a family briefing with appointments, school events, chores, and bills due.",
    "When a school PDF comes in, save it, summarize it, extract due dates, and add reminders.",
    "Every Friday, archive non-actionable emails and summarize what I should handle next week.",
  ];

  const generate = async () => {
    setBusy(true);
    const r = await planAgentFromGoal(prompt.trim());
    setBusy(false);
    if (r.ok && r.plan) { setLocalPreview(null); setPlan(r.plan); setPicked(new Set(r.plan.connectorIds)); }
  };
  const activate = async (run: boolean) => {
    if (!plan) return;
    const id = createAutomationFromPlan(plan, { enabled: true, connectorIds: [...picked] });
    if (run) await testAutomation(id);
    setPlan(null); setPrompt(""); setPicked(new Set());
    onActivated();
  };
  const previewFallback = () => {
    const text = prompt.trim();
    const r = planFromPrompt(text);
    // T-05: derive the trigger with detectTrigger() — the same function the
    // engine already uses internally to label the plan's "Trigger" row — instead
    // of leaving it to createAutomation's "Manual" default. Detection logic is
    // untouched; this just wires its result through to automation creation.
    const triggerType = detectTrigger(text, detectIntent(text).defaultTrigger);
    setPlan(null);
    setLocalPreview({ ...r, triggerType });
  };
  const activateFallback = () => {
    if (!localPreview) return;
    createAutomation({
      name: prompt.slice(0, 48),
      description: prompt,
      agentId: localPreview.agentId,
      plan: localPreview.plan,
      approvalRequired: localPreview.approvalRequired,
      triggerType: localPreview.triggerType,
      status: "active",
      enabled: true,
    });
    setLocalPreview(null);
    setPrompt("");
    onActivated();
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card className="card-pad">
        <Field label="Describe the workflow in plain English" hint="Your connected AI provider turns this into a real plan — selecting actual tools from your connected accounts.">
          <TextArea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-[140px]" placeholder="When I upload receipts, categorize them, total them, and update the budget tracker." />
        </Field>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {samples.map((s) => <button key={s} onClick={() => setPrompt(s)} className="chip bg-surface-sunken/60 text-ink-500 transition-colors hover:bg-surface-sunken hover:text-ink-700">{s.slice(0, 32)}…</button>)}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="ember" disabled={!prompt.trim() || busy} onClick={generate}>{busy ? <><Icon name="Loader2" size={16} className="animate-spin" /> Generating…</> : <><Icon name="Sparkles" size={16} /> Generate plan</>}</Button>
          <button className="text-xs text-ink-400 underline" disabled={!prompt.trim()} onClick={previewFallback}>or use the built-in rules engine</button>
        </div>
      </Card>
      <Card className="card-pad">
        {plan ? (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="font-display text-base font-semibold text-ink-900">Generated plan</p>
              <div className="flex gap-1.5">
                <Button variant="secondary" size="sm" onClick={() => activate(false)}><Icon name="Check" size={15} /> Activate</Button>
                <Button variant="ember" size="sm" onClick={() => activate(true)}><Icon name="Play" size={15} /> Activate & run</Button>
              </div>
            </div>
            <PlanPreview plan={plan} picked={picked} onToggle={(id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; })} connectables={connectables} />
          </>
        ) : localPreview ? (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-display text-base font-semibold text-ink-900">Built-in rules engine plan</p>
                {/* T-05: the resolved trigger, shown before the user confirms — so
                    "Every morning at 7am…" visibly reads as Schedule, not Manual. */}
                <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-500"><Icon name="Zap" size={12} /> Trigger: <span className="font-medium text-ink-700">{localPreview.triggerType}</span></p>
              </div>
              <Button variant="ember" size="sm" onClick={activateFallback}><Icon name="Check" size={15} /> Activate</Button>
            </div>
            <PlanView plan={localPreview.plan} approvalRequired={localPreview.approvalRequired} />
          </>
        ) : (
          <EmptyState icon="Workflow" title="Your workflow plan appears here" message="Describe a routine and your AI provider drafts a real, tool-by-tool plan before you activate it." />
        )}
      </Card>
    </div>
  );
}

function TemplatesGrid({ onOpen }: { onOpen: (id: string) => void }) {
  const [cat, setCat] = useState("All");
  const cats = useMemo(() => ["All", ...Array.from(new Set(workflowTemplates.map((t) => t.category)))], []);
  const list = cat === "All" ? workflowTemplates : workflowTemplates.filter((t) => t.category === cat);
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {cats.map((c) => <button key={c} onClick={() => setCat(c)} className={`chip pressable transition-colors ${cat === c ? "bg-gradient-to-b from-ink-700 to-ink-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" : "border border-ink-900/10 bg-surface-raised text-ink-600 hover:border-ink-900/20 hover:bg-surface-overlay"}`}>{c}</button>)}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((t) => (
          <Card key={t.id} className="card-pad flex flex-col" hover onClick={() => onOpen(t.id)}>
            <div className="mb-1 flex items-center justify-between"><Badge color="lavender">{t.category}</Badge>{t.multiAgent && <span className="chip bg-sky-100 text-sky-600"><Icon name="Users" size={11} /> Multi-agent</span>}</div>
            <p className="font-display text-base font-semibold text-ink-900">{t.name}</p>
            <p className="mt-1 line-clamp-3 text-xs text-ink-500">{t.prompt}</p>
            <div className="mt-3 flex items-center gap-1 text-xs text-ink-400"><Icon name="Zap" size={12} /> {t.triggerType}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function TemplateDetail({ id, onClose, onUse }: { id: string; onClose: () => void; onUse: () => void }) {
  const t = workflowTemplates.find((x) => x.id === id) as WorkflowTemplate;
  const create = useStore((s) => s.createAutomationFromTemplate);
  if (!t) return null;
  const List = ({ title, items, icon }: { title: string; items: string[]; icon: string }) => (
    items.length ? <div><p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500"><Icon name={icon} size={12} />{title}</p><ul className="ml-1 space-y-0.5">{items.map((i, k) => <li key={k} className="text-sm text-ink-600">• {i}</li>)}</ul></div> : null
  );
  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={t.name} icon="Workflow" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" onClick={() => { create(t.id); onUse(); }}><Icon name="Plus" size={15} /> Use this template</Button></>}>
      <div className="space-y-4">
        <div className="well p-3.5 text-sm text-ink-700"><span className="font-medium">Prompt:</span> “{t.prompt}”</div>
        <div className="flex flex-wrap gap-2"><Badge color="lavender">{t.category}</Badge><Badge color="sky">{t.triggerType}</Badge><Badge color="gray">{t.recommendedAgent}</Badge></div>
        {t.multiAgent && (
          <div><p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500"><Icon name="Users" size={12} /> Multi-agent workflow</p>
            <div className="space-y-1.5">{t.multiAgent.map((m, k) => <div key={k} className="flex items-center gap-2 rounded-2xl border border-ink-900/[0.06] bg-surface-rim p-2.5 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"><Icon name={m.icon} size={15} className="text-ink-600" /><span className="font-medium text-ink-800">{m.name}</span><span className="text-xs text-ink-500">— {m.role}</span></div>)}</div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <List title="Required connections" items={t.requiredConnections} icon="Plug" />
          <List title="Optional connections" items={t.optionalConnections} icon="Plug" />
          <List title="Approval requirements" items={t.approvalRequirements} icon="ShieldCheck" />
          <List title="File processing" items={t.fileProcessingNeeds} icon="FileText" />
          <List title="Output format" items={t.outputFormat} icon="FileOutput" />
          <List title="Example output" items={t.exampleOutput} icon="Eye" />
          <List title="Activity log events" items={t.activityLogEvents} icon="Activity" />
          <List title="Failure states" items={t.failureStates} icon="TriangleAlert" />
          <List title="Setup checklist" items={t.setupChecklist} icon="ListChecks" />
        </div>
        <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Browser needs</p><p className="text-sm text-ink-600">{t.browserNeeds}</p></div>
      </div>
    </Drawer>
  );
}

function EditAutomationModal({ id, onClose }: { id: string; onClose: () => void }) {
  const a = useStore((s) => s.data.automations.find((x) => x.id === id));
  const agents = useStore((s) => s.data.agents);
  const update = useStore((s) => s.updateAutomation);
  const [name, setName] = useState(a?.name ?? "");
  const [desc, setDesc] = useState(a?.description ?? "");
  const [category, setCategory] = useState(a?.category ?? "Custom");
  const [agentId, setAgentId] = useState(a?.agentId ?? "");
  const [triggerType, setTriggerType] = useState<TriggerType>(a?.triggerType ?? "Manual");
  const [schedule, setSchedule] = useState(a?.triggerConfig.schedule ?? "");
  const [status, setStatus] = useState<Automation["status"]>(a?.status ?? "active");
  const [approval, setApproval] = useState(a?.approvalRequired ?? false);
  const [enabled, setEnabled] = useState(a?.enabled ?? true);
  const [showPlan, setShowPlan] = useState(false);
  if (!a) return null;
  const save = () => {
    update(id, {
      name, description: desc, category, agentId, triggerType,
      triggerConfig: { ...a.triggerConfig, schedule: schedule || undefined },
      status, approvalRequired: approval, enabled,
    });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Edit automation" icon="Workflow" size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={save}><Icon name="Save" size={15} /> Save</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description"><TextArea value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Trigger type"><Select value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)}>{TRIGGER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
          <Field label="Schedule / cadence" hint="e.g. every morning, Fridays 5pm"><TextInput value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="every morning at 7am" /></Field>
          <Field label="Assigned agent"><Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>{agents.map((ag) => <option key={ag.id} value={ag.id}>{ag.name}</option>)}</Select></Field>
          <Field label="Category"><TextInput value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as Automation["status"])}>{AUTO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2"><Toggle checked={approval} onChange={setApproval} aria-label="Require approval" /><span className="text-sm text-ink-700">Require approval before external actions</span></label>
          <label className="flex items-center gap-2"><Toggle checked={enabled} onChange={setEnabled} aria-label="Enabled" /><span className="text-sm text-ink-700">Enabled</span></label>
        </div>
        <div className="border-t border-ink-900/[0.06] pt-3">
          <button className="flex items-center gap-1 text-sm font-medium text-ink-600 hover:text-ink-900" onClick={() => setShowPlan((v) => !v)}><Icon name={showPlan ? "ChevronDown" : "ChevronRight"} size={15} /> Workflow plan ({a.plan.steps.length} steps)</button>
          {showPlan && <div className="mt-3"><PlanView plan={a.plan} approvalRequired={approval} /></div>}
        </div>
      </div>
    </Modal>
  );
}

function RunHistory() {
  const runs = useStore((s) => s.data.runs);
  const subagentRuns = useStore((s) => s.data.subagentRuns);
  const agents = useStore((s) => s.data.agents);
  const proposeFix = useStore((s) => s.maybeProposeEvolution);
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...runs].sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt));
  if (!sorted.length) return <EmptyState icon="History" title="No runs yet" message="Test an automation to see run history." />;
  return (
    <div className="space-y-2">
      {sorted.map((r) => {
        const subs = subagentRuns.filter((s) => r.subagentRunIds.includes(s.id));
        return (
          <Card key={r.id} className="card-pad">
            <button className="flex w-full items-center justify-between gap-2" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <div className="min-w-0 text-left">
                <p className="font-display truncate text-base font-semibold text-ink-900">{agents.find((a) => a.id === r.agentId)?.name} · {r.triggerLabel}</p>
                <p className="text-xs text-ink-400">{fmtDateTime(r.startedAt)} · {r.outputSummary}</p>
              </div>
              <Badge color={r.status === "Completed" ? "sage" : r.status === "Failed" ? "coral" : r.status === "Waiting for Approval" ? "amber" : "sky"}>{r.status}</Badge>
            </button>
            {open === r.id && (
              <div className="mt-3 space-y-1 border-t border-ink-900/[0.06] pt-3">
                {r.steps.map((st, i) => (
                  <div key={i} className="text-sm">
                    <div className="flex items-center gap-2">
                      <Icon
                        name={st.status === "done" ? "CheckCircle2" : st.status === "blocked" ? "Lock" : st.status === "running" ? "Loader2" : st.status === "skipped" ? "SkipForward" : "Circle"}
                        size={14}
                        className={st.status === "done" ? "text-sage-500" : st.status === "blocked" ? "text-coral-500" : st.status === "running" ? "animate-spin text-sky-500" : st.status === "skipped" ? "text-amber-600" : "text-ink-300"}
                      />
                      <span className="text-ink-600">{st.label}</span>
                      {st.agentName && <span className="text-xs text-ink-400">· {st.agentName}</span>}
                    </div>
                    {/* "skipped" bundles no-delivery-tool, policy-clamped, and denied/
                        expired-approval steps — `detail` (set distinctly server-side)
                        names which one this was, so it's never a silent gray dot. */}
                    {st.status === "skipped" && st.detail && <p className="ml-5 mt-0.5 text-xs text-amber-700">{st.detail}</p>}
                  </div>
                ))}
                {subs.length > 0 && <div className="well mt-2 p-2.5"><p className="mb-1 text-xs font-semibold uppercase text-ink-400">Subagents (multi-agent)</p>{subs.map((s) => <div key={s.id} className="flex items-center gap-2 text-sm text-ink-600"><Icon name={s.icon} size={13} /> {s.name} — {s.outputSummary}</div>)}</div>}
                {r.error && <p className="text-sm text-coral-600">{r.error}</p>}
                {r.status === "Waiting for Approval" && <InlineApprovals runId={r.id} />}
                <div className="flex flex-wrap items-center gap-2">
                  {r.status === "Failed" && <Button size="sm" variant="ember" onClick={() => proposeFix(r.id)}><Icon name="Sparkles" size={13} /> Suggest improvement</Button>}
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
