import { useEffect, useMemo, useState } from "react";
import { useStore, runStatusView, useServerRuns } from "@/store/useStore";
import { agentTemplates } from "@/data/agentTemplates";
import {
  PageHeader, Card, Button, IconButton, Badge, StatusDot, Drawer, Modal, Tabs, Field, TextInput, TextArea, Select, EmptyState, RiskBadge, ReadinessBadge, Checkbox,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { relativeTime, fmtDateTime } from "@/lib/dates";
import type { Agent, AgentStatus, SpaceType } from "@/types";
import { backend, type AgentPlan, type ServerAgent, type AgentContext, type AgentVersion } from "@/connectors/api";

const STATUS_COLOR: Record<AgentStatus, "sage" | "amber" | "coral" | "sky" | "gray"> = {
  Active: "sage",
  Paused: "amber",
  "Needs Attention": "coral",
  Draft: "sky",
  Archived: "gray",
};

const FILTERS: (AgentStatus | "All")[] = ["All", "Active", "Needs Attention", "Paused", "Draft", "Archived"];
const AGENT_ICONS = ["Bot", "Sun", "Mail", "Inbox", "Calendar", "Receipt", "CreditCard", "UtensilsCrossed", "Plane", "Stethoscope", "Wrench", "HeartHandshake", "FolderOpen", "PawPrint", "Gift", "Search", "ShoppingCart", "Bell", "ShieldCheck", "FileText", "Globe", "MessageSquare", "ListChecks"];
const EDIT_STATUSES: AgentStatus[] = ["Active", "Paused", "Draft", "Needs Attention"];

/** A unified picker entry across legacy connectors + first-party providers. */
export interface Connectable { id: string; name: string; kind: "connector" | "provider"; connected: boolean; readinessLabel: string; tools: { id: string; name: string; requiresApproval: boolean }[] }
export function useConnectables(): Connectable[] {
  const connectors = useStore((s) => s.connectors);
  const providers = useStore((s) => s.providers);
  return useMemo(() => [
    ...providers.map((p) => ({ id: p.id, name: p.name, kind: "provider" as const, connected: (p.accounts?.length ?? 0) > 0, readinessLabel: (p.accounts?.length ?? 0) > 0 ? "Connected" : p.readiness === "configured" ? "Not connected" : "Setup by admin", tools: p.tools.map((t) => ({ id: t.id, name: t.name, requiresApproval: t.requiresApproval })) })),
    ...connectors.map((c) => ({ id: c.id, name: c.name, kind: "connector" as const, connected: !!c.live, readinessLabel: c.readiness.replace(/_/g, " "), tools: c.tools.map((t) => ({ id: t.id, name: t.name, requiresApproval: t.requiresApproval })) })),
  ], [connectors, providers]);
}

export function Agents() {
  const data = useStore((s) => s.data);
  const params = useStore((s) => s.route.params);
  const navigate = useStore((s) => s.navigate);
  const runAgentLive = useStore((s) => s.runAgentLive);
  const setAgentStatus = useStore((s) => s.setAgentStatus);
  const duplicateAgent = useStore((s) => s.duplicateAgent);
  const deleteAgent = useStore((s) => s.deleteAgent);
  const [runningId, setRunningId] = useState<string | null>(null);
  const runAgent = async (id: string) => { setRunningId(id); await runAgentLive(id); setRunningId(null); };

  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Agent | null>(null);

  useEffect(() => {
    if (params?.id) setSelectedId(params.id);
    if (params?.new) setCreateOpen(true);
  }, [params?.id, params?.new]);

  const agents = useMemo(() => {
    let list = [...data.agents];
    if (filter !== "All") list = list.filter((a) => a.status === filter);
    else list = list.filter((a) => a.status !== "Archived");
    return list;
  }, [data.agents, filter]);

  const selected = data.agents.find((a) => a.id === selectedId) ?? null;
  const triggerCount = (id: string) => data.automations.filter((a) => a.agentId === id).length;
  const lastRun = (id: string) => data.runs.filter((r) => r.agentId === id).sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt))[0];
  const spaceName = (id: string) => data.spaces.find((s) => s.id === id)?.name ?? "Household";

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Helper Agents"
        subtitle="Specialized helpers that take ownership of household work."
        icon="Bot"
        actions={<Button variant="ember" onClick={() => setCreateOpen(true)}><Icon name="Plus" size={16} /> New agent</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`chip ${filter === f ? "bg-ink-800 text-white shadow-e1" : "bg-surface-raised text-ink-600 border border-ink-900/10 hover:border-ink-900/20"}`}>
            {f}
            {f !== "All" && <span className="opacity-70">{data.agents.filter((a) => a.status === f).length}</span>}
          </button>
        ))}
      </div>

      {agents.length === 0 ? (
        <EmptyState icon="Bot" title="No agents here" message="Create a helper agent from a template or describe one in plain English." action={<Button variant="ember" onClick={() => setCreateOpen(true)}>New agent</Button>} />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => {
            const lr = lastRun(a.id);
            const archived = a.status === "Archived";
            return (
              <Card key={a.id} className="card-pad flex flex-col" hover>
                <div className="flex items-start gap-3" onClick={() => setSelectedId(a.id)} role="button">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-ink-700 to-ink-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_12px_rgba(23,27,38,0.20)]"><Icon name={a.icon} size={22} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display truncate text-lg font-semibold text-ink-900">{a.name}</p>
                    <p className="line-clamp-2 text-xs text-ink-500">{a.purpose}</p>
                  </div>
                  <Badge color={STATUS_COLOR[a.status]}>{a.status}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
                  <span className="flex items-center gap-1"><Icon name="MapPin" size={12} /> {spaceName(a.spaceId)}</span>
                  <span className="flex items-center gap-1"><Icon name="Zap" size={12} /> {triggerCount(a.id)} triggers</span>
                  {lr && <span className="flex items-center gap-1"><Icon name="History" size={12} /> ran {relativeTime(lr.startedAt)}</span>}
                </div>
                <div className="mt-3 flex items-center gap-1 border-t border-ink-900/[0.06] pt-3">
                  {!archived && <Button size="sm" variant="secondary" disabled={runningId === a.id} onClick={() => runAgent(a.id)}>{runningId === a.id ? <><Icon name="Loader2" size={14} className="animate-spin" /> Running</> : <><Icon name="Play" size={14} /> Run</>}</Button>}
                  {a.status === "Paused" ? (
                    <IconButton icon="Play" label="Activate" onClick={() => setAgentStatus(a.id, "Active")} />
                  ) : !archived ? (
                    <IconButton icon="Pause" label="Pause" onClick={() => setAgentStatus(a.id, "Paused")} />
                  ) : null}
                  <IconButton icon="Copy" label="Duplicate" onClick={() => duplicateAgent(a.id)} />
                  {!archived ? (
                    <IconButton icon="Archive" label="Archive" onClick={() => setAgentStatus(a.id, "Archived")} />
                  ) : (
                    <>
                      <IconButton icon="ArchiveRestore" label="Restore" onClick={() => setAgentStatus(a.id, "Draft")} />
                      <IconButton icon="Trash2" label="Delete permanently" onClick={() => setConfirmDelete(a)} />
                    </>
                  )}
                  <IconButton icon="ChevronRight" label="Open" className="ml-auto" onClick={() => setSelectedId(a.id)} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {selected && <AgentDetail agent={selected} onClose={() => { setSelectedId(null); navigate("agents"); }} onDelete={() => setConfirmDelete(selected)} />}
      <CreateAgentModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={(id) => { setCreateOpen(false); setSelectedId(id); }} templates={agentTemplates} />

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete this agent?" icon="Trash2"
        footer={<><Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="danger" onClick={() => { if (confirmDelete) deleteAgent(confirmDelete.id); setConfirmDelete(null); setSelectedId(null); }}><Icon name="Trash2" size={15} /> Delete permanently</Button></>}>
        <p className="text-sm text-ink-600">This permanently removes <strong>{confirmDelete?.name}</strong> and its configuration. Its run history stays in the activity log. This can't be undone.</p>
      </Modal>
    </div>
  );
}

/* ----------------------------- Create modal ----------------------------- */

function CreateAgentModal({ open, onClose, onCreate, templates }: {
  open: boolean; onClose: () => void; onCreate: (id: string) => void; templates: typeof agentTemplates;
}) {
  const planAgentFromGoal = useStore((s) => s.planAgentFromGoal);
  const createAgentFromPlan = useStore((s) => s.createAgentFromPlan);
  const createAgentFromTemplate = useStore((s) => s.createAgentFromTemplate);
  const createAgentFromPrompt = useStore((s) => s.createAgentFromPrompt);
  const runPlan = useStore((s) => s.runPlan);
  const connectables = useConnectables();

  const [mode, setMode] = useState<"template" | "prompt">("template");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const reset = () => { setPrompt(""); setPlan(null); setBusy(false); setPicked(new Set()); };
  const close = () => { reset(); onClose(); };

  const generate = async () => {
    setBusy(true);
    const r = await planAgentFromGoal(prompt.trim());
    setBusy(false);
    if (r.ok && r.plan) { setPlan(r.plan); setPicked(new Set(r.plan.connectorIds)); }
  };
  const create = (run: boolean) => {
    if (!plan) return;
    const id = createAgentFromPlan(plan, { connectorIds: [...picked], status: run ? "Active" : "Draft" });
    if (run) void runPlan(plan, { agentId: id, label: "First run" });
    reset();
    onCreate(id);
  };
  const fallbackCreate = (run: boolean) => {
    // No AI provider — fall back to the local rules engine so creation still works.
    const id = createAgentFromPrompt(prompt.trim());
    reset();
    onCreate(id);
    void run;
  };

  const footer = mode === "template"
    ? <Button variant="ghost" onClick={close}>Cancel</Button>
    : !plan
      ? <><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="ember" disabled={!prompt.trim() || busy} onClick={generate}>{busy ? <><Icon name="Loader2" size={16} className="animate-spin" /> Generating…</> : <><Icon name="Sparkles" size={16} /> Generate</>}</Button></>
      : <><Button variant="ghost" onClick={() => setPlan(null)}><Icon name="ChevronLeft" size={15} /> Back</Button><Button variant="secondary" onClick={() => create(false)}>Create agent</Button><Button variant="primary" onClick={() => create(true)}><Icon name="Play" size={15} /> Create & run</Button></>;

  return (
    <Modal open={open} onClose={close} title="Create a helper agent" icon="Bot" size="lg" footer={footer}>
      <Tabs tabs={[{ id: "template", label: "From a template", icon: "LayoutGrid" }, { id: "prompt", label: "From plain English", icon: "Sparkles" }]} active={mode} onChange={(m) => { setMode(m as "template" | "prompt"); setPlan(null); }} />
      {mode === "template" ? (
        <div className="mt-4 grid max-h-[55vh] grid-cols-1 gap-2.5 overflow-y-auto sm:grid-cols-2">
          {templates.map((t) => (
            <button key={t.id} onClick={() => { onCreate(createAgentFromTemplate(t.id)); }} className="card lift pressable flex items-start gap-3 p-3 text-left">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><Icon name={t.icon} size={18} /></span>
              <div>
                <p className="text-sm font-semibold text-ink-800">{t.name}</p>
                <p className="text-xs text-ink-500">{t.purpose}</p>
                {t.suggestedConnections.length > 0 && <p className="mt-1 text-[11px] text-ink-400">Connectors: {t.suggestedConnections.join(", ")}</p>}
              </div>
            </button>
          ))}
        </div>
      ) : !plan ? (
        <div className="mt-4 space-y-3">
          <Field label="Describe what this agent should do" hint="Your connected AI provider reads the live tool catalog and configures a real agent — tools, connectors, and approval gates.">
            <TextArea autoFocus value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-[120px]" placeholder="Watch for school emails, summarize them, extract due dates, and remind me two days before anything is due." />
          </Field>
          {busy && <p className="flex items-center gap-2 text-sm text-ink-500"><Icon name="Loader2" size={15} className="animate-spin" /> Reading your tools and drafting an agent…</p>}
          <p className="text-xs text-ink-400">No AI provider connected? You can still <button className="font-medium text-ink-700 underline" onClick={() => fallbackCreate(false)} disabled={!prompt.trim()}>create with the built-in rules engine</button>.</p>
        </div>
      ) : (
        <PlanPreview plan={plan} picked={picked} onToggle={(id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; })} connectables={connectables} />
      )}
    </Modal>
  );
}

/** Shared preview of a generated plan — used by agent + automation builders. */
export function PlanPreview({ plan, picked, onToggle, connectables }: { plan: AgentPlan; picked: Set<string>; onToggle: (id: string) => void; connectables: Connectable[] }) {
  return (
    <div className="mt-4 max-h-[58vh] space-y-4 overflow-y-auto pr-1">
      <div className="well flex items-start gap-3 p-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-ink-700 to-ink-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_12px_rgba(23,27,38,0.20)]"><Icon name={plan.icon} size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-semibold text-ink-900">{plan.title}</p>
          <p className="text-sm text-ink-600">{plan.summary}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5"><RiskBadge level={plan.risk} /><Badge color="sky">{plan.triggerType}{plan.triggerDetail ? ` · ${plan.triggerDetail}` : ""}</Badge><Badge color="gray">{plan.spaceType}</Badge></div>
        </div>
      </div>

      <div>
        <p className="section-title mb-2">Steps the agent will run</p>
        <ol className="space-y-1.5">
          {plan.steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 rounded-2xl border border-ink-900/[0.06] bg-surface-raised p-2.5 text-sm shadow-e1">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-800 text-[11px] font-bold text-white">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-800">{s.title} {s.requiresApproval && <Icon name="ShieldAlert" size={12} className="inline text-coral-500" />}</p>
                {s.detail && <p className="text-xs text-ink-500">{s.detail}</p>}
                {s.toolId ? <p className="mt-0.5 text-[11px] text-ink-400">tool: <code className="rounded bg-surface-sunken px-1">{s.toolId}</code>{s.connectorName ? ` · ${s.connectorName}` : ""}{!s.connected ? " · not connected yet" : ""}</p> : <p className="mt-0.5 text-[11px] text-ink-400">reasoning step (no external tool)</p>}
              </div>
            </li>
          ))}
          {plan.steps.length === 0 && <li className="text-sm text-ink-400">No steps proposed.</li>}
        </ol>
      </div>

      <div>
        <p className="section-title mb-2">Connectors to attach</p>
        {plan.requiredConnectors.length === 0 ? <p className="text-sm text-ink-400">No external connectors needed.</p> : (
          <div className="space-y-1.5">
            {plan.requiredConnectors.map((rc) => {
              const meta = connectables.find((c) => c.id === rc.id);
              return (
                <label key={rc.id} className="flex items-center gap-2 rounded-2xl border border-ink-900/[0.06] bg-surface-raised p-2.5 shadow-e1">
                  <Checkbox checked={picked.has(rc.id)} onChange={() => onToggle(rc.id)} />
                  <span className="flex-1 text-sm font-medium text-ink-800">{meta?.name ?? rc.name}</span>
                  <StatusDot color={rc.connected ? "sage" : "amber"} label={rc.connected ? "Connected" : "Connect in Connections"} />
                </label>
              );
            })}
          </div>
        )}
      </div>

      {plan.missing.length > 0 && (
        <div className="rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <Icon name="TriangleAlert" size={14} className="mr-1 inline" /> You'll need to connect: <strong>{plan.missing.join(", ")}</strong> before those steps can run. The agent will pause and ask rather than guess.
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Agent detail ---------------------------- */

const TABS = [
  { id: "overview", label: "Overview", icon: "LayoutDashboard" },
  { id: "settings", label: "Settings", icon: "SlidersHorizontal" },
  { id: "instructions", label: "Instructions", icon: "FileText" },
  { id: "connections", label: "Connections & tools", icon: "Plug" },
  { id: "triggers", label: "Triggers", icon: "Zap" },
  { id: "memory", label: "Memory", icon: "Brain" },
  { id: "files", label: "Files", icon: "FolderOpen" },
  { id: "runs", label: "Run History", icon: "History" },
  { id: "permissions", label: "Permissions", icon: "ShieldCheck" },
  { id: "capabilities", label: "Capabilities", icon: "Boxes" },
  { id: "versions", label: "Versions", icon: "History" },
];

function AgentDetail({ agent, onClose, onDelete }: { agent: Agent; onClose: () => void; onDelete: () => void }) {
  const data = useStore((s) => s.data);
  const navigate = useStore((s) => s.navigate);
  const runAgentLive = useStore((s) => s.runAgentLive);
  const setAgentStatus = useStore((s) => s.setAgentStatus);
  const duplicateAgent = useStore((s) => s.duplicateAgent);
  const updateAgent = useStore((s) => s.updateAgent);
  const connectables = useConnectables();
  const [tab, setTab] = useState("overview");
  const [instr, setInstr] = useState(agent.instructions);
  const [running, setRunning] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const space = data.spaces.find((s) => s.id === agent.spaceId);
  const owner = data.members.find((m) => m.id === agent.ownerMemberId);
  const attached = connectables.filter((c) => agent.connectionIds.includes(c.id));
  const triggers = data.automations.filter((a) => a.agentId === agent.id);
  const memories = data.memories.filter((m) => m.agentId === agent.id);
  const files = data.files.filter((f) => f.linkedAgentIds.includes(agent.id));
  const playbooks = data.playbooks.filter((p) => agent.playbookIds.includes(p.id));
  const knowledge = data.knowledge.filter((k) => agent.knowledgeItemIds.includes(k.id));
  // WP-003 slice 2 (ONE HISTORY) — server truth (GET /api/runs), the SAME hook +
  // mapper Automations » Run History uses, so a run shows identical status text in
  // both places. `data.runs` (the local write-mirror) is no longer read as a listing
  // source here.
  const { runs, loading: runsLoading, stale: runsStale, fetchedAt: runsFetchedAt, refresh: refreshRuns } = useServerRuns({ agentId: agent.id });
  const enabledTools = attached.flatMap((c) => c.tools.filter((t) => agent.allowedToolIds.includes(t.id)).map((t) => ({ conn: c.name, tool: t })));
  const pendingEvos = (data.evolutions ?? []).filter((e) => e.agentId === agent.id && e.status === "pending");

  const toggleConnector = (id: string) => {
    const has = agent.connectionIds.includes(id);
    updateAgent(agent.id, { connectionIds: has ? agent.connectionIds.filter((x) => x !== id) : [...agent.connectionIds, id] });
  };
  const toggleTool = (id: string) => {
    const has = agent.allowedToolIds.includes(id);
    updateAgent(agent.id, { allowedToolIds: has ? agent.allowedToolIds.filter((x) => x !== id) : [...agent.allowedToolIds, id] });
  };
  // runAgentLive resolves only once the run reaches a terminal/parked state (it awaits
  // runPlan → syncServerRun) — by then GET /api/runs already reflects it, so refetch.
  const runNow = async () => { setRunning(true); await runAgentLive(agent.id); setRunning(false); setTab("runs"); refreshRuns(); };

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-3xl"
      title={<span className="flex items-center gap-2"><Icon name={agent.icon} size={20} /> {agent.name}</span>}
      footer={<>
        <Button variant="ghost" onClick={onDelete}><Icon name="Trash2" size={15} /> Delete</Button>
        <Button variant="ghost" onClick={() => duplicateAgent(agent.id)}><Icon name="Copy" size={15} /> Duplicate</Button>
        {agent.status === "Paused" ? <Button variant="secondary" onClick={() => setAgentStatus(agent.id, "Active")}><Icon name="Play" size={15} /> Activate</Button> : <Button variant="secondary" onClick={() => setAgentStatus(agent.id, "Paused")}><Icon name="Pause" size={15} /> Pause</Button>}
        <Button variant="primary" disabled={running} onClick={runNow}>{running ? <><Icon name="Loader2" size={15} className="animate-spin" /> Running…</> : <><Icon name="Play" size={15} /> Run now</>}</Button>
      </>}
    >
      <div className="mb-4 flex items-center gap-2">
        <Badge color={STATUS_COLOR[agent.status]}>{agent.status}</Badge>
        <span className="text-sm text-ink-500">{agent.purpose}</span>
      </div>
      {pendingEvos.length > 0 && (
        <button onClick={() => navigate("activity", { tab: "improvements" })} className="mb-4 flex w-full items-center gap-2 rounded-2xl border border-ember-200/70 bg-ember-50 px-3.5 py-2.5 text-left text-sm text-ember-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] transition-colors hover:bg-ember-100">
          <Icon name="Sparkles" size={15} className="shrink-0" />
          <span className="flex-1">{pendingEvos.length} improvement suggestion{pendingEvos.length === 1 ? "" : "s"} from recent runs — review &amp; apply</span>
          <Icon name="ChevronRight" size={15} className="shrink-0" />
        </button>
      )}
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="pt-4">
        {tab === "overview" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[{ l: "Space", v: space?.name }, { l: "Owner", v: owner?.displayName }, { l: "Triggers", v: triggers.length }, { l: "Runs", v: runs.length }].map((x) => (
                <div key={x.l} className="well p-3"><p className="text-xs text-ink-400">{x.l}</p><p className="font-display text-lg font-semibold text-ink-800">{x.v}</p></div>
              ))}
            </div>
            <Section title="Safety limits">
              <ul className="space-y-1">{agent.safetyLimits.map((s, i) => <li key={i} className="flex items-start gap-2 text-sm text-ink-600"><Icon name="ShieldCheck" size={14} className="mt-0.5 text-sage-500" />{s}</li>)}</ul>
            </Section>
            {playbooks.length > 0 && <Section title="Playbooks"><div className="flex flex-wrap gap-2">{playbooks.map((p) => <button key={p.id} onClick={() => navigate("playbooks", { id: p.id })} className="chip bg-surface-sunken text-ink-600 hover:bg-ink-900/[0.05]"><Icon name="ScrollText" size={12} /> {p.name}</button>)}</div></Section>}
            {knowledge.length > 0 && <Section title="Knowledge"><div className="flex flex-wrap gap-2">{knowledge.map((k) => <span key={k.id} className="chip bg-surface-sunken text-ink-600"><Icon name="BookOpen" size={12} /> {k.title}</span>)}</div></Section>}
          </div>
        )}
        {tab === "settings" && <SettingsTab agent={agent} spaces={data.spaces} onSave={(patch) => updateAgent(agent.id, patch)} />}
        {tab === "instructions" && (
          <div className="space-y-3">
            <TextArea value={instr} onChange={(e) => setInstr(e.target.value)} className="min-h-[220px]" />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setInstr(agent.instructions)}>Reset</Button>
              <Button variant="primary" disabled={instr === agent.instructions} onClick={() => updateAgent(agent.id, { instructions: instr })}><Icon name="Save" size={15} /> Save instructions</Button>
            </div>
          </div>
        )}
        {tab === "connections" && (
          <div className="space-y-2">
            <p className="text-xs text-ink-400">Toggle which connectors this agent may use, then pick the exact tools. Send / write / delete tools stay approval-gated.</p>
            {connectables.map((c) => {
              const on = agent.connectionIds.includes(c.id);
              return (
                <div key={c.id} className={`rounded-2xl border p-3 ${on ? "border-ink-900/10 bg-surface-raised shadow-e1" : "well"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 font-medium text-ink-800"><Checkbox checked={on} onChange={() => toggleConnector(c.id)} /><Icon name="Plug" size={15} /> {c.name}</label>
                    <StatusDot color={c.connected ? "sage" : "amber"} label={c.readinessLabel} />
                  </div>
                  {on && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-900/[0.06] pt-2">
                      {c.tools.length === 0 ? <span className="text-xs text-ink-400">No tools.</span> : c.tools.map((t) => (
                        <Checkbox key={t.id} checked={agent.allowedToolIds.includes(t.id)} onChange={() => toggleTool(t.id)} label={<span className="text-xs">{t.name}{t.requiresApproval ? " 🔒" : ""}</span>} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {tab === "triggers" && (
          <div className="space-y-2">
            {triggers.length === 0 ? <EmptyState icon="Zap" title="No triggers" message="Add a trigger so this agent runs automatically." action={<Button size="sm" variant="primary" onClick={() => navigate("automations", { tab: "builder" })}>Add trigger</Button>} /> : triggers.map((t) => (
              <button key={t.id} onClick={() => navigate("automations", { id: t.id })} className="flex w-full items-center justify-between rounded-2xl border border-ink-900/[0.06] bg-surface-raised p-3 text-left shadow-e1 lift pressable">
                <div><p className="font-medium text-ink-800">{t.name}</p><p className="text-xs text-ink-500">{t.triggerType}{t.triggerConfig.schedule ? ` · ${t.triggerConfig.schedule}` : ""}</p></div>
                <StatusDot color={t.enabled ? "sage" : "gray"} label={t.enabled ? "On" : "Off"} />
              </button>
            ))}
            <Button size="sm" variant="secondary" onClick={() => navigate("automations", { tab: "builder" })}><Icon name="Plus" size={14} /> Add trigger</Button>
          </div>
        )}
        {tab === "memory" && (
          <div className="space-y-2">
            {memories.length === 0 ? <EmptyState icon="Brain" title="No memories yet" message="This agent will remember useful facts over time." /> : memories.map((m) => (
              <div key={m.id} className="rounded-2xl border border-ink-900/[0.06] p-3">
                <div className="flex items-center justify-between"><p className="font-medium text-ink-800">{m.title}</p><div className="flex gap-1">{m.sensitive && <Badge color="lavender">Sensitive</Badge>}<Badge color={m.userApproved ? "sage" : "amber"}>{m.userApproved ? "Approved" : "Unverified"}</Badge></div></div>
                <p className="mt-1 text-sm text-ink-600">{m.content}</p>
                <p className="mt-1 text-xs text-ink-400">{m.source} · {Math.round(m.confidence * 100)}% confidence</p>
              </div>
            ))}
          </div>
        )}
        {tab === "files" && (
          <div className="space-y-2">
            {files.length === 0 ? <EmptyState icon="FolderOpen" title="No files" message="Files this agent works with will appear here." /> : files.map((f) => (
              <button key={f.id} onClick={() => navigate("files", { file: f.id })} className="flex w-full items-center gap-3 rounded-2xl border border-ink-900/[0.06] p-3 text-left hover:bg-surface-overlay">
                <Icon name="FileText" size={16} className="text-amber-600" /><div className="min-w-0 flex-1"><p className="truncate font-medium text-ink-800">{f.name}</p><p className="truncate text-xs text-ink-500">{f.summary}</p></div>{f.sensitive && <Icon name="Lock" size={13} className="text-lavender-600" />}
              </button>
            ))}
          </div>
        )}
        {tab === "runs" && (
          <div className="space-y-2">
            {runsStale && (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-600">
                <span>Backend runtime offline — showing the last run history fetched{runsFetchedAt ? ` at ${fmtDateTime(new Date(runsFetchedAt).toISOString())}` : ""}.</span>
                <button onClick={refreshRuns} className="shrink-0 font-semibold underline">Retry</button>
              </div>
            )}
            {runs.length === 0 && !runsLoading ? <EmptyState icon="History" title="No runs yet" message="Run the agent to see its history." action={<Button size="sm" variant="primary" disabled={running} onClick={runNow}>Run now</Button>} /> : runs.map((r) => {
              const view = runStatusView(r.serverStatus ?? r.status);
              return (
              <div key={r.id} className="rounded-2xl border border-ink-900/[0.06] p-3">
                <button className="flex w-full items-center justify-between" onClick={() => setExpandedRun(expandedRun === r.id ? null : r.id)}>
                  <div className="text-left"><p className="font-medium text-ink-800">{r.triggerLabel}</p><p className="text-xs text-ink-400">{fmtDateTime(r.startedAt)}</p></div>
                  <Badge color={view.tone}>{view.active && <Icon name="Loader2" size={11} className="animate-spin" />} {view.label}</Badge>
                </button>
                <p className="mt-1 text-sm text-ink-600">{r.outputSummary}</p>
                {expandedRun === r.id && (
                  <div className="mt-3 space-y-1 border-t border-ink-900/[0.06] pt-3">
                    {r.steps.map((st, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <Icon name={st.status === "done" ? "CheckCircle2" : st.status === "blocked" ? "Lock" : st.status === "running" ? "Loader2" : "Circle"} size={14} className={`mt-0.5 ${st.status === "done" ? "text-sage-500" : st.status === "blocked" ? "text-coral-500" : st.status === "running" ? "animate-spin text-sky-500" : "text-ink-300"}`} />
                        <span className="flex-1"><span className={st.status === "done" ? "text-ink-500" : "text-ink-700"}>{st.label}</span>{st.detail && <span className="block text-xs text-ink-400">{st.detail}</span>}</span>
                      </div>
                    ))}
                    {/* Cause-specific parked CTA — never the collapsed "Waiting for
                        Approval" label for a connector/provider wait, which has
                        nothing to approve. */}
                    {view.parked && view.cta && <Button size="sm" variant="secondary" onClick={() => navigate(view.cta!.screen, view.cta!.params)}><Icon name="ArrowRight" size={13} /> {view.cta.label}</Button>}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
        {tab === "permissions" && (
          <div className="space-y-4">
            <Section title="What can this agent do?">
              {enabledTools.length === 0 ? <p className="text-sm text-ink-400">No connector tools enabled yet — pick some in “Connections & tools”.</p> : <ul className="space-y-1">{enabledTools.map((x, i) => <li key={i} className="flex items-center gap-2 text-sm text-ink-600"><Icon name="Wrench" size={13} className="text-ink-400" /> {x.tool.name} <span className="text-xs text-ink-400">via {x.conn}</span>{x.tool.requiresApproval && <Badge color="coral">approval</Badge>}</li>)}</ul>}
            </Section>
            <ListEditor title="Runs without approval (low-risk)" items={agent.approvalPolicy.autoAllow} onSave={(items) => updateAgent(agent.id, { approvalPolicy: { ...agent.approvalPolicy, autoAllow: items } })} />
            <ListEditor title="Always requires your approval" items={agent.approvalPolicy.alwaysApprove} onSave={(items) => updateAgent(agent.id, { approvalPolicy: { ...agent.approvalPolicy, alwaysApprove: items } })} />
            <ListEditor title="Safety limits" items={agent.safetyLimits} onSave={(items) => updateAgent(agent.id, { safetyLimits: items })} />
          </div>
        )}
        {tab === "capabilities" && <AgentCapabilities agentId={agent.id} agentName={agent.name} />}
        {tab === "versions" && <AgentVersions agentId={agent.id} />}
      </div>
    </Drawer>
  );
}

/* --------- Server-enforced capabilities (permitted ∩ available) --------- */
function AgentCapabilities({ agentId, agentName }: { agentId: string; agentName: string }) {
  const navigate = useStore((s) => s.navigate);
  const migrate = useStore((s) => s.migrateAgentsToServer);
  const [server, setServer] = useState<ServerAgent | null>(null);
  const [ctx, setCtx] = useState<AgentContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = async () => {
    setLoading(true);
    const [a, c] = await Promise.all([backend.getAgent(agentId), backend.agentContext(agentId)]);
    setServer(a); setCtx(c); setNotFound(!a); setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agentId]);

  // Tri-state per item: allowed | denied | inherit. Persisted to the server policy.
  const setPolicy = async (kind: "tool" | "function", id: string, next: "allow" | "deny" | "inherit") => {
    if (!server) return;
    setSaving(true);
    const allowKey = kind === "tool" ? "allowedToolIds" : "allowedFunctionIds";
    const denyKey = kind === "tool" ? "deniedToolIds" : "deniedFunctionIds";
    const allow = new Set(server[allowKey] ?? []);
    const deny = new Set(server[denyKey] ?? []);
    allow.delete(id); deny.delete(id);
    if (next === "allow") allow.add(id);
    if (next === "deny") deny.add(id);
    const patch = { [allowKey]: [...allow], [denyKey]: [...deny] } as Partial<ServerAgent>;
    const r = await backend.patchAgent(agentId, patch);
    if (r.agent) { setServer(r.agent); setCtx(await backend.agentContext(agentId)); }
    setSaving(false);
  };

  const runViaServer = async () => {
    setRunning(true);
    const r = await backend.runAgentServer(agentId);
    setRunning(false);
    if (r.run) navigate("automations", { tab: "monitor" });
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-ink-400"><Icon name="Loader2" size={14} className="animate-spin" /> Loading server policy…</div>;
  if (notFound) return (
    <div className="space-y-3">
      <EmptyState icon="CloudOff" title="Not synced to the server yet" message="This agent hasn't been migrated to the durable server registry. Sync it (as an Adult Admin) to enforce its capability policy at run time." />
      <div className="flex justify-center"><Button variant="secondary" onClick={async () => { await migrate(); await load(); }}><Icon name="RefreshCw" size={14} /> Sync to server</Button></div>
    </div>
  );

  const stateColor = (s: string) => s === "available" ? "sage" : s === "deprecated" ? "lavender" : "amber";
  const TriState = ({ kind, id, allowed, denied }: { kind: "tool" | "function"; id: string; allowed: boolean; denied: boolean }) => {
    const cur = denied ? "deny" : allowed ? "allow" : "inherit";
    return (
      <div className="flex shrink-0 overflow-hidden rounded-lg border border-ink-900/10">
        {(["allow", "inherit", "deny"] as const).map((opt) => (
          <button key={opt} disabled={saving} onClick={() => setPolicy(kind, id, opt)}
            className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${cur === opt ? (opt === "deny" ? "bg-coral-500 text-white" : opt === "allow" ? "bg-sage-500 text-white" : "bg-ink-700 text-white") : "bg-surface-raised text-ink-500 hover:bg-ink-900/[0.05]"}`}>
            {opt === "inherit" ? "—" : opt === "allow" ? "Allow" : "Deny"}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-ink-900/[0.06] bg-surface-raised p-3 shadow-e1">
        <div>
          <p className="text-sm font-semibold text-ink-800">Server-enforced capability policy</p>
          <p className="text-xs text-ink-400">
            {ctx?.executableCount ?? 0} executable now · {ctx?.permittedCount ?? 0} permitted
            {ctx?.openAllowList ? " · open allow-list (any available tool, except denied)" : ""}
          </p>
        </div>
        <Button size="sm" variant="primary" disabled={running} onClick={runViaServer}>{running ? <><Icon name="Loader2" size={13} className="animate-spin" /> Running…</> : <><Icon name="Play" size={13} /> Run via server</>}</Button>
      </div>
      <p className="text-xs text-ink-400"><Icon name="ShieldCheck" size={12} className="mr-1 inline text-sage-500" />The durable executor re-validates every step against this policy — a <strong>Denied</strong> or unpermitted tool can never run, even if a plan proposes it. <strong>—</strong> inherits the open default. Unavailable items can be permitted but won't run until connected.</p>

      <Section title="Tools">
        <div className="space-y-1">
          {(ctx?.tools ?? []).map((t) => (
            <div key={t.toolId} className="flex items-center gap-2 rounded-xl border border-ink-900/[0.06] bg-surface-rim px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink-800">{t.name} {t.requiresApproval && <Icon name="ShieldAlert" size={11} className="inline text-coral-500" />}</p>
                <p className="truncate text-[11px] text-ink-400">{t.connectorName} · {t.action} · {t.available ? "available" : "not connected"}</p>
              </div>
              <StatusDot color={t.available ? "sage" : "amber"} label={t.available ? "Available" : "Unavailable"} />
              <TriState kind="tool" id={t.toolId} allowed={t.permitted && !ctx?.openAllowList} denied={t.denied} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Functions">
        {(ctx?.functions ?? []).length === 0 ? <p className="text-sm text-ink-400">No registered functions yet — build some in <button className="font-medium text-ink-700 underline" onClick={() => navigate("functions")}>Functions</button>.</p> : (
          <div className="space-y-1">
            {(ctx?.functions ?? []).map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-xl border border-ink-900/[0.06] bg-surface-rim px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-800">{f.name} {f.requiresApproval && <Icon name="ShieldAlert" size={11} className="inline text-coral-500" />}</p>
                  <p className="truncate text-[11px] text-ink-400">{f.type}</p>
                </div>
                <Badge color={stateColor(f.state)}>{f.state}</Badge>
                <TriState kind="function" id={f.id} allowed={f.permitted && !ctx?.openAllowList} denied={f.denied} />
              </div>
            ))}
          </div>
        )}
      </Section>
      {saving && <p className="text-xs text-ink-400"><Icon name="Loader2" size={11} className="mr-1 inline animate-spin" /> Saving policy…</p>}
      <p className="text-[11px] text-ink-300">Agent: {agentName} · {agentId}</p>
    </div>
  );
}

/* ------------------------- Server agent versions ------------------------ */
function AgentVersions({ agentId }: { agentId: string }) {
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const [vs, a] = await Promise.all([backend.agentVersions(agentId), backend.getAgent(agentId)]);
    setVersions([...vs].reverse()); setCurrent(a?.version ?? null); setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agentId]);
  const rollback = async (v: number) => { setBusy(true); await backend.rollbackAgent(agentId, v); await load(); setBusy(false); };
  if (loading) return <div className="flex items-center gap-2 text-sm text-ink-400"><Icon name="Loader2" size={14} className="animate-spin" /> Loading…</div>;
  if (!versions.length) return <EmptyState icon="History" title="No versions yet" message="Server versions are saved automatically each time this agent's policy or settings change." />;
  return (
    <div className="space-y-2">
      {current != null && <p className="text-xs text-ink-400">Current server version: v{current}</p>}
      {versions.map((v) => (
        <div key={v.version} className="flex items-center justify-between gap-2 rounded-2xl border border-ink-900/[0.06] p-3">
          <div>
            <p className="text-sm font-semibold text-ink-800">v{v.version} <span className="font-normal text-ink-400">— {v.name}</span></p>
            <p className="text-xs text-ink-400">{relativeTime(v.snapshotAt)} · {(v.allowedToolIds?.length ?? 0) + (v.allowedFunctionIds?.length ?? 0)} allowed · {(v.deniedToolIds?.length ?? 0) + (v.deniedFunctionIds?.length ?? 0)} denied</p>
          </div>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => rollback(v.version)}><Icon name="RotateCcw" size={13} /> Restore</Button>
        </div>
      ))}
    </div>
  );
}

function SettingsTab({ agent, spaces, onSave }: { agent: Agent; spaces: { id: string; name: string; type: SpaceType }[]; onSave: (patch: Partial<Agent>) => void }) {
  const [name, setName] = useState(agent.name);
  const [icon, setIcon] = useState(agent.icon);
  const [purpose, setPurpose] = useState(agent.purpose);
  const [spaceId, setSpaceId] = useState(agent.spaceId);
  const [status, setStatus] = useState<AgentStatus>(agent.status === "Archived" ? "Draft" : agent.status);
  const dirty = name !== agent.name || icon !== agent.icon || purpose !== agent.purpose || spaceId !== agent.spaceId || status !== agent.status;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Icon"><Select value={icon} onChange={(e) => setIcon(e.target.value)}>{AGENT_ICONS.map((i) => <option key={i} value={i}>{i}</option>)}</Select></Field>
        <Field label="Space"><Select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>{spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as AgentStatus)}>{EDIT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
      </div>
      <Field label="Purpose"><TextArea value={purpose} onChange={(e) => setPurpose(e.target.value)} className="min-h-[80px]" /></Field>
      <div className="flex items-center gap-2"><Icon name={icon} size={18} className="text-ink-500" /><span className="text-xs text-ink-400">Icon preview</span></div>
      <div className="flex justify-end"><Button variant="primary" disabled={!dirty || !name.trim()} onClick={() => onSave({ name, icon, purpose, spaceId, status })}><Icon name="Save" size={15} /> Save settings</Button></div>
    </div>
  );
}

function ListEditor({ title, items, onSave }: { title: string; items: string[]; onSave: (items: string[]) => void }) {
  const [text, setText] = useState(items.join("\n"));
  const current = text.split("\n").map((t) => t.trim()).filter(Boolean);
  const dirty = JSON.stringify(current) !== JSON.stringify(items);
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{title} <span className="text-ink-400">(one per line)</span></p>
      <TextArea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[80px]" />
      {dirty && <div className="mt-1 flex justify-end"><Button size="sm" variant="secondary" onClick={() => onSave(current)}><Icon name="Save" size={13} /> Save</Button></div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</p>
      {children}
    </div>
  );
}
