import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { PageHeader, Card, Button, IconButton, Badge, Tabs, Modal, Field, TextInput, TextArea, Select, Toggle, EmptyState, StatusDot } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { relativeTime, fmtDateTime } from "@/lib/dates";
import { backend, type ServerEvolution, type AuditEvent, type MemorySearchResponse } from "@/connectors/api";
import type { ActivityLogEntry, MemoryEntry, MemoryType, ScreenId, Route, EvolutionProposal } from "@/types";

export function ActivityMemory() {
  const params = useStore((s) => s.route.params);
  const pendingEvos = useStore((s) => (s.data.evolutions ?? []).filter((e) => e.status === "pending").length);
  const [tab, setTab] = useState("activity");
  useEffect(() => { if (params?.tab) setTab(params.tab); if (params?.id) setTab("memory"); if (params?.entry) setTab("activity"); }, [params?.tab, params?.id, params?.entry]);
  return (
    <div className="animate-fade-in">
      <PageHeader title="Activity & Memory" subtitle="A full audit trail of what your helpers did — what they remember, and what they've learned." icon="Activity" />
      <Tabs
        tabs={[
          { id: "activity", label: "Activity Log", icon: "Activity" },
          { id: "memory", label: "Memory", icon: "Brain" },
          { id: "improvements", label: "Improvements", icon: "Sparkles", count: pendingEvos || undefined },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="pt-5">{tab === "activity" ? <ActivityLog /> : tab === "improvements" ? <Improvements /> : <Memory />}</div>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = { success: "sage", info: "sky", warning: "amber", error: "coral", pending: "lavender" };

function entityRoute(e: ActivityLogEntry): Route | null {
  if (!e.entityType || !e.entityId) return null;
  switch (e.entityType) {
    case "agent": return { screen: "agents", params: { id: e.entityId } };
    case "automation": case "run": case "subagentRun": case "sandboxRun": return { screen: "automations", params: { tab: "history" } };
    case "browserWorkflow": return { screen: "automations", params: { tab: "browser" } };
    case "file": return { screen: "files", params: { file: e.entityId } };
    case "approval": return { screen: "messages", params: { tab: "approvals", approval: e.entityId } };
    case "thread": return { screen: "messages", params: { thread: e.entityId } };
    case "memory": return { screen: "activity", params: { tab: "memory", id: e.entityId } };
    case "miniApp": return { screen: "miniapps", params: { id: e.entityId } };
    case "connection": return { screen: "connections", params: { id: e.entityId } };
    case "webhook": return { screen: "automations", params: { tab: "history" } };
    default: return null;
  }
}

/** One normalized row for the unified activity feed, whether it came from the server's
 *  real audit trail or a locally-recorded client action. */
interface ActivityRow { id: string; timestamp: string; actorName: string; actionType: string; description: string; status: string; spaceId?: string; route: Route | null; source: "server" | "local" }

function localRow(e: ActivityLogEntry): ActivityRow {
  return { id: e.id, timestamp: e.timestamp, actorName: e.actorName, actionType: e.actionType, description: e.description, status: e.status, spaceId: e.spaceId, route: entityRoute(e), source: "local" };
}

// Map the server's raw audit event into the same display shape. This is the fix for the
// web/mobile divergence: web previously showed ONLY client-local `pushActivity` entries
// (this browser tab, this session) and never pulled the server's real, cross-device audit
// trail — so actions on mobile, by the server itself (auto-repair, auto-memory), or in
// another tab were invisible here. `backend.audit()` existed but went unused on web.
function serverRow(a: AuditEvent): ActivityRow {
  const desc = `${a.type}${a.toolId ? ` · ${a.toolId}` : ""}${a.ok ? "" : a.error ? ` — ${a.error}` : " — failed"}`;
  return {
    id: a.id,
    timestamp: a.at,
    actorName: a.actorName ?? a.actorId ?? "System",
    actionType: a.type,
    description: desc,
    status: a.ok ? "success" : "error",
    route: a.connectorId ? { screen: "connections", params: { id: a.connectorId } } : null,
    source: "server",
  };
}

function ActivityLog() {
  const data = useStore((s) => s.data);
  const navigate = useStore((s) => s.navigate);
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [space, setSpace] = useState("all");
  const [q, setQ] = useState("");
  const [server, setServer] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { setLoading(true); const evs = await backend.audit(200); setServer(evs); setLoading(false); }, []);
  useEffect(() => { void load(); }, [load]);

  // Merge server audit (source of truth, cross-device) with local entries, deduped by id
  // (server wins), newest first.
  const merged = useMemo(() => {
    const serverRows = server.map(serverRow);
    const seen = new Set(serverRows.map((r) => r.id));
    const localRows = data.activity.filter((e) => !seen.has(e.id)).map(localRow);
    return [...serverRows, ...localRows].sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
  }, [server, data.activity]);

  const types = useMemo(() => Array.from(new Set(merged.map((e) => e.actionType))).sort(), [merged]);
  const list = merged.filter((e) =>
    (type === "all" || e.actionType === type) && (status === "all" || e.status === status) && (space === "all" || e.spaceId === space) &&
    (!q || e.description.toLowerCase().includes(q.toLowerCase()) || e.actorName.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]"><Icon name="Search" size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-ink-400" /><TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search activity…" className="pl-8" /></div>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="!w-auto"><option value="all">All actions</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto"><option value="all">All statuses</option><option>success</option><option>info</option><option>warning</option><option>error</option><option>pending</option></Select>
        <Select value={space} onChange={(e) => setSpace(e.target.value)} className="!w-auto"><option value="all">All spaces</option>{data.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <IconButton icon={loading ? "Loader2" : "RefreshCw"} label="Refresh from server" className={loading ? "animate-spin" : ""} onClick={() => void load()} />
      </div>
      {list.length === 0 ? <EmptyState icon="Activity" title={loading ? "Loading activity…" : "No matching activity"} message={loading ? "Pulling the household's audit trail from the server." : "Adjust filters or take an action to populate the log."} /> : (
        <Card className="card-pad">
          <ol className="relative ml-1 space-y-1 border-l border-ink-900/10 pl-5">
            {list.map((e) => (
              <li key={e.id} className="group relative flex items-start gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-surface-overlay">
                <span className={`absolute -left-[27px] top-3 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-surface-raised bg-${STATUS_COLOR[e.status] ?? "sky"}-500`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-800">{e.description}</p>
                  <p className="text-xs text-ink-400">{e.actorName} · <span className="font-mono">{e.actionType}</span> · <span title={fmtDateTime(e.timestamp)}>{relativeTime(e.timestamp)}</span>{e.source === "server" && <span className="ml-1 text-sage-500" title="From the server audit trail">· synced</span>}</p>
                </div>
                {e.route && <button onClick={() => navigate(e.route!.screen as ScreenId, e.route!.params)} className="shrink-0 text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">View</button>}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

const MEM_TYPES: MemoryType[] = ["Fact", "Preference", "Routine", "Rule", "Contact", "Insight"];

/** WP-007 s5 — retrieval-quality memory search + profile, backed by
 *  GET /api/memory/search (server/memory-provider.mjs; DEC-014: sqlite-FTS5 fallback, or
 *  a real Supermemory sidecar when configured). Additive to the existing local Memory
 *  list below — this searches the household's whole recall history via the provider,
 *  not just the client-cached `data.memories` array. */
function ProviderMemorySearch() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MemorySearchResponse | null>(null);

  const runSearch = useCallback(async (query: string) => {
    setLoading(true);
    const r = await backend.memorySearch(query);
    setResult(r);
    setLoading(false);
  }, []);
  // Load the profile (and any top highlights) once on mount, even with no query typed yet.
  useEffect(() => { void runSearch(""); }, [runSearch]);

  const profile = result?.profile ?? null;
  const degraded = result?.degraded ?? false;

  return (
    <Card className="card-pad mb-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon name="Sparkles" size={15} className="text-ember-500" />
        <p className="font-display text-sm font-semibold text-ink-900">Search memory</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Icon name="Search" size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-ink-400" />
          <TextInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void runSearch(q); }}
            placeholder="Ask what your helpers remember…"
            aria-label="Search memory across your household's full recall history"
            className="pl-8"
          />
        </div>
        <Button variant="secondary" onClick={() => void runSearch(q)} disabled={loading}>
          {loading ? <Icon name="Loader2" size={14} className="animate-spin" /> : <Icon name="Search" size={14} />}
          Search
        </Button>
      </div>

      {degraded && (
        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-2.5 text-sm text-amber-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]" role="status">
          <Icon name="AlertTriangle" size={15} />
          Enhanced memory recall is offline right now — showing best-effort local results, not the full household history.
        </div>
      )}

      {profile && profile.totalMemories > 0 && (
        <div className="mt-3 rounded-2xl border border-ink-900/[0.06] bg-surface-sunken/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Household memory profile</p>
          <p className="mt-1 text-sm text-ink-700">{profile.totalMemories} memories remembered across this household.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(profile.byType).map(([type, count]) => (
              <Badge key={type} color="gray">{type} · {count}</Badge>
            ))}
          </div>
        </div>
      )}

      {result && q && (
        result.results.length === 0 ? (
          <p className="mt-3 text-sm text-ink-400">No memories match "{q}" yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {result.results.map((m, i) => (
              <li key={m.id ?? i} className="rounded-xl border border-ink-900/[0.06] bg-surface-rim px-3 py-2 text-sm text-ink-700">
                {m.text}
                <span className="ml-2 text-xs text-ink-400">{m.scope ?? "household"}{m.type ? ` · ${m.type}` : ""}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </Card>
  );
}

function Memory() {
  const data = useStore((s) => s.data);
  const params = useStore((s) => s.route.params);
  const approve = useStore((s) => s.approveMemory);
  const toggleSensitive = useStore((s) => s.toggleMemorySensitive);
  const del = useStore((s) => s.deleteMemory);
  const [agentFilter, setAgentFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<MemoryEntry | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (params?.id) { const m = data.memories.find((x) => x.id === params.id); if (m) setEditing(m); } }, [params?.id]);

  const list = data.memories.filter((m) =>
    (agentFilter === "all" || m.agentId === agentFilter) && (typeFilter === "all" || m.type === typeFilter) &&
    (!q || m.title.toLowerCase().includes(q.toLowerCase()) || m.content.toLowerCase().includes(q.toLowerCase())),
  );
  const agentName = (id: string) => data.agents.find((a) => a.id === id)?.name ?? "Agent";
  const spaceName = (id: string) => data.spaces.find((s) => s.id === id)?.name ?? "";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]"><Icon name="Search" size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-ink-400" /><TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memory…" className="pl-8" /></div>
        <Select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="!w-auto"><option value="all">All agents</option>{data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="!w-auto"><option value="all">All types</option>{MEM_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
        <Button variant="ember" onClick={() => setCreating(true)}><Icon name="Plus" size={16} /> New memory</Button>
      </div>
      <ProviderMemorySearch />
      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-lavender-200/70 bg-lavender-50 px-4 py-2.5 text-sm text-lavender-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><Icon name="Lock" size={15} /> Sensitive memories stay within their space and aren't used by agents elsewhere.</div>
      {list.length === 0 ? <EmptyState icon="Brain" title="No memories" message="Add a fact your helpers should remember." /> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {list.map((m) => (
            <Card key={m.id} className="card-pad lift">
              <div className="flex items-start justify-between gap-2">
                <p className="font-display text-lg font-semibold text-ink-900">{m.title}</p>
                <div className="flex gap-1">{m.sensitive && <Badge color="lavender"><Icon name="Lock" size={11} /></Badge>}<Badge color={m.userApproved ? "sage" : "amber"}>{m.userApproved ? "Approved" : "Unverified"}</Badge></div>
              </div>
              <p className="mt-1 text-sm text-ink-600">{m.content}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-400">
                <Badge color="gray">{m.type}</Badge>
                <span className="flex items-center gap-1"><Icon name="Bot" size={11} /> {agentName(m.agentId)}</span>
                <span>{spaceName(m.spaceId)}</span>
                <span>· {Math.round(m.confidence * 100)}%</span>
              </div>
              <div className="mt-3 flex items-center gap-1 border-t border-ink-900/[0.06] pt-3">
                {!m.userApproved && <Button size="sm" variant="success" onClick={() => approve(m.id)}><Icon name="Check" size={13} /> Approve</Button>}
                <IconButton icon="Pencil" label="Edit" onClick={() => setEditing(m)} />
                <IconButton icon={m.sensitive ? "Unlock" : "Lock"} label="Toggle sensitive" onClick={() => toggleSensitive(m.id)} />
                <IconButton icon="Trash2" label="Delete" className="ml-auto" onClick={() => del(m.id)} />
              </div>
            </Card>
          ))}
        </div>
      )}
      {(editing || creating) && <MemoryModal item={editing} onClose={() => { setEditing(null); setCreating(false); }} />}
    </div>
  );
}

/* ----------------------- Improvements (evolution) ----------------------- */

const KIND_META: Record<string, { icon: string; label: string }> = {
  agent: { icon: "Bot", label: "Agent" },
  skill: { icon: "BookOpen", label: "Skill" },
  function: { icon: "FunctionSquare", label: "Function" },
  tool: { icon: "Wrench", label: "Tool" },
};

// Merges local (IndexedDB-backed) evolutions with server evolutions, deduplicating by id.
function mergeEvolutions(local: EvolutionProposal[], server: ServerEvolution[]): (EvolutionProposal | ServerEvolution)[] {
  const ids = new Set(server.map((s) => s.id));
  const localOnly = local.filter((l) => !ids.has(l.id));
  return [...server, ...localOnly];
}

function Improvements() {
  const localEvolutions = useStore((s) => s.data.evolutions) ?? [];
  const review = useStore((s) => s.reviewEvolution);
  const navigate = useStore((s) => s.navigate);
  const [serverEvolutions, setServerEvolutions] = useState<ServerEvolution[]>([]);
  const [loading, setLoading] = useState(true);
  // WP-008a (DEC-015): a one-time nudge when self-changes are ON only because the
  // household never explicitly decided — not because anyone chose it. Once the setting
  // is explicitly set (either way), the server stops reporting `Defaulted` and this
  // banner stops appearing on its own — "one-time" in the sense of "until decided,"
  // not a dismiss-and-forget toast, so it can't be missed by a household that never opens it.
  const [autoApproveDefaulted, setAutoApproveDefaulted] = useState(false);
  const [revertTarget, setRevertTarget] = useState<ServerEvolution | null>(null);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [evos, settings] = await Promise.all([backend.evolutions(), backend.getSettings()]);
    setServerEvolutions(evos);
    setAutoApproveDefaulted(settings.autoApproveImprovementsDefaulted === true && settings.autoApproveImprovements !== false);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const all = mergeEvolutions(localEvolutions, serverEvolutions);
  const sorted = [...all].sort((a, b) => {
    if (a.status !== b.status) { if (a.status === "pending") return -1; if (b.status === "pending") return 1; }
    return +new Date(b.createdAt) - +new Date(a.createdAt);
  });

  const confirmRevert = async () => {
    if (!revertTarget) return;
    setReverting(true);
    setRevertError(null);
    const r = await backend.revertEvolution(revertTarget.id);
    setReverting(false);
    if (!r.ok) { setRevertError(r.message ?? r.error ?? "The revert failed."); return; }
    setRevertTarget(null);
    void load();
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-ink-400 py-6"><Icon name="Loader2" size={14} className="animate-spin" /> Loading improvements…</div>;

  return (
    <div>
      {autoApproveDefaulted && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-2.5 text-sm text-amber-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]" role="status">
          <Icon name="AlertTriangle" size={15} />
          <span className="flex-1">Automatic self-changes are on — review or turn off in Settings.</span>
          <button onClick={() => navigate("settings")} className="shrink-0 text-xs font-semibold text-amber-800 underline hover:no-underline">Open Settings</button>
        </div>
      )}
      {sorted.length === 0 ? (
        <EmptyState icon="Sparkles" title="No improvement suggestions yet" message="When a run fails, FamiliOS studies the trace and proposes a concrete, low-risk fix here — automatically." />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2 rounded-2xl border border-ember-200/70 bg-ember-50 px-4 py-2.5 text-sm text-ember-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <Icon name="Sparkles" size={15} /> FamiliOS learns from real run traces. Accepting a suggestion versions the target entity server-side — and, if it goes wrong, an accepted change can be reverted.
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {sorted.map((e) => (
              <ProposalCard key={e.id} e={e}
                onReview={async (id, accept) => { await review(id, accept); void load(); }}
                onRevert={() => { setRevertError(null); setRevertTarget(e as ServerEvolution); }}
                onView={() => {
                  if (e.kind === "agent" && (e as any).agentId) navigate("agents", { id: (e as any).agentId });
                  else if (e.kind === "skill" && (e as any).skillId) navigate("skills", { id: (e as any).skillId });
                  else if (e.kind === "function") navigate("functions", { create: "1", name: (e as any).toolId ?? "", description: e.summary });
                }}
              />
            ))}
          </div>
        </>
      )}
      <Modal open={!!revertTarget} onClose={() => { if (!reverting) setRevertTarget(null); }} title="Revert this improvement?" icon="Undo2"
        footer={<>
          <Button variant="ghost" disabled={reverting} onClick={() => setRevertTarget(null)}>Cancel</Button>
          <Button variant="danger" disabled={reverting} onClick={() => void confirmRevert()}>
            {reverting ? <><Icon name="Loader2" size={14} className="animate-spin" /> Reverting…</> : <><Icon name="Undo2" size={14} /> Revert</>}
          </Button>
        </>}>
        <p className="text-sm text-ink-600">
          This restores <strong>{(revertTarget as any)?.agentName ?? (revertTarget as any)?.skillName ?? (revertTarget?.kind === "agent" ? "the agent" : "the skill")}</strong> to what it was
          just before "{revertTarget?.title}" was applied. The current version stays in its history — this adds a new version rather than erasing anything.
        </p>
        {revertError && <p className="mt-2 rounded-xl bg-coral-50 px-3 py-2 text-sm text-coral-600">{revertError}</p>}
      </Modal>
    </div>
  );
}

function DiffBlock({ label, text, tone }: { label: string; text: string | null | undefined; tone: "before" | "after" }) {
  if (!text) return null;
  return (
    <div className="mt-1.5">
      <p className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${tone === "before" ? "text-coral-500" : "text-sage-600"}`}>{label}</p>
      <div className={`whitespace-pre-wrap rounded-xl border p-3 font-mono text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] ${tone === "before" ? "border-coral-200/60 bg-coral-50/40 text-coral-700" : "border-sage-200/60 bg-sage-50/40 text-sage-700"}`}>{text}</div>
    </div>
  );
}

function ProposalCard({ e, onReview, onRevert, onView }: { e: EvolutionProposal | ServerEvolution; onReview: (id: string, accept: boolean) => Promise<void>; onRevert: () => void; onView: () => void }) {
  const [showDiff, setShowDiff] = useState(false);
  const [busy, setBusy] = useState(false);
  const isReverted = e.status === "reverted";
  const statusColor: "sage" | "gray" | "amber" | "coral" = e.status === "accepted" ? "sage" : e.status === "rejected" ? "gray" : isReverted ? "coral" : "amber";
  const meta = KIND_META[e.kind] ?? KIND_META.tool;
  // Server-side low-risk auto-approval: applied without a human when the household opts in.
  const autoApproved = (e as any).autoApproved === true;
  const autoReason = (e as any).autoReason as string | undefined;
  const entityName = (e as any).agentName ?? (e as any).skillName ?? (e as any).functionId ?? (e as any).toolId ?? null;
  const hasView = (e as any).agentId || (e as any).skillId || e.kind === "function";
  const archived = (e as any).archived === true;
  // The server is the source of truth for "can this be reverted right now" (target
  // still exists, a prior version is available) — an archived row is read-only history
  // regardless of what the flag says.
  const canRevert = !archived && (e as any).revertible === true;
  const before = (e as any).before as string | undefined;
  const after = (e as any).after as string | undefined;
  const doReview = async (accept: boolean) => { setBusy(true); await onReview(e.id, accept); setBusy(false); };

  return (
    <Card className="card-pad">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-ember-50 text-ember-600"><Icon name={meta.icon} size={16} /></span>
          <div>
            <p className="font-display text-sm font-semibold text-ink-900">{e.title}</p>
            <p className="text-xs text-ink-500">
              {entityName ? `${meta.label}: ${entityName}` : meta.label}
              {" · "}{(e as any).source === "ai" ? "AI-refined" : "from trace"}
              {(e as any).risk ? ` · ${(e as any).risk} risk` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {archived && <Badge color="gray"><Icon name="Archive" size={11} /> Archived</Badge>}
          {autoApproved && <Badge color="lavender"><Icon name="Sparkles" size={11} /> Auto-applied by AI</Badge>}
          <Badge color={statusColor}>{e.status}</Badge>
        </div>
      </div>
      <p className="rounded-xl bg-surface-sunken/60 px-3 py-2 text-xs text-ink-600"><Icon name="Search" size={11} className="mr-1 inline" /> {e.reason}</p>
      <p className="mt-2 text-sm text-ink-700">{e.summary}</p>
      {(before || after) && (
        <div className="mt-2">
          <button onClick={() => setShowDiff((v) => !v)} className="flex items-center gap-1 text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">
            <Icon name={showDiff ? "ChevronDown" : "ChevronRight"} size={12} />
            {e.status === "pending" ? (e.kind === "agent" ? "Proposed instructions" : e.kind === "function" ? "Suggested implementation" : "Suggested guidance") : "Before / after"}
          </button>
          {showDiff && (
            <>
              {e.status !== "pending" && <DiffBlock label="Before" text={before} tone="before" />}
              <DiffBlock label={e.status === "pending" ? "" : "After"} text={after} tone="after" />
            </>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-900/[0.06] pt-3">
        {e.status === "pending" ? (
          <>
            <Button size="sm" variant="success" disabled={busy} onClick={() => doReview(true)}>
              {busy ? <><Icon name="Loader2" size={13} className="animate-spin" /> Applying…</> : <><Icon name="Check" size={13} /> {(e as any).after ? "Accept & apply" : "Accept"}</>}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => doReview(false)}>Dismiss</Button>
          </>
        ) : autoApproved && !isReverted ? (
          <span className="flex items-center gap-1 text-xs text-lavender-600"><Icon name="Sparkles" size={12} /> {autoReason || "Auto-applied by AI"}</span>
        ) : isReverted ? (
          <span className="flex items-center gap-1 text-xs text-coral-500"><Icon name="Undo2" size={12} /> Reverted{(e as any).revertedBy ? ` by ${(e as any).revertedBy}` : ""}</span>
        ) : archived ? (
          <span className="text-xs text-ink-400">Archived history — read-only</span>
        ) : <span className="text-xs text-ink-400">Reviewed</span>}
        {canRevert && (
          <Button size="sm" variant="ghost" className="text-coral-600 hover:bg-coral-50" onClick={onRevert}><Icon name="Undo2" size={13} /> Revert</Button>
        )}
        {e.kind === "function" && (
          <Button size="sm" variant="secondary" className="ml-auto" onClick={onView}><Icon name="FunctionSquare" size={13} /> Open in Functions</Button>
        )}
        {hasView && e.kind !== "function" && (
          <button onClick={onView} className="ml-auto text-xs font-semibold text-ink-500 transition-colors hover:text-ember-600">View {meta.label.toLowerCase()}</button>
        )}
      </div>
    </Card>
  );
}

function MemoryModal({ item, onClose }: { item: MemoryEntry | null; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const create = useStore((s) => s.createMemory);
  const update = useStore((s) => s.updateMemory);
  const [title, setTitle] = useState(item?.title ?? "");
  const [content, setContent] = useState(item?.content ?? "");
  const [type, setType] = useState<MemoryType>(item?.type ?? "Fact");
  const [agentId, setAgentId] = useState(item?.agentId ?? data.agents[0]?.id ?? "");
  const [spaceId, setSpaceId] = useState(item?.spaceId ?? data.spaces[0]?.id ?? "");
  const [sensitive, setSensitive] = useState(item?.sensitive ?? false);
  const submit = () => {
    if (!title.trim() || !content.trim()) return;
    if (item) update(item.id, { title, content, type, agentId, spaceId, sensitive });
    else create({ title, content, type, agentId, spaceId, sensitive });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={item ? "Edit memory" : "New memory"} icon="Brain" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!title.trim() || !content.trim()} onClick={submit}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Content"><TextArea value={content} onChange={(e) => setContent(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as MemoryType)}>{MEM_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Agent"><Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>{data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        </div>
        <Field label="Space"><Select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>{data.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <div className="flex items-center gap-2"><Toggle checked={sensitive} onChange={setSensitive} /><span className="text-sm text-ink-700">Mark as sensitive</span></div>
      </div>
    </Modal>
  );
}
