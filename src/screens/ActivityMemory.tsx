import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { PageHeader, Card, Button, IconButton, Badge, Tabs, Modal, Field, TextInput, TextArea, Select, Toggle, EmptyState, StatusDot } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { relativeTime, fmtDateTime } from "@/lib/dates";
import { backend, type AuditEvent, type MemorySearchResponse } from "@/connectors/api";
import { useAdvancedMode } from "@/lib/prefs";
import { plainLanguageAudit, routeForAudit } from "@/lib/activityCopy";
import type { ActivityLogEntry, MemoryEntry, MemoryType, ScreenId, Route } from "@/types";

export function ActivityMemory() {
  const params = useStore((s) => s.route.params);
  // The raw Activity Log is a firehose of low-level audit rows — kept for the record, but
  // moved behind Advanced Mode so the everyday view (Memory + Improvements) stays calm.
  const [advanced] = useAdvancedMode();
  const [tab, setTab] = useState(advanced ? "activity" : "memory");
  useEffect(() => {
    if (params?.tab) setTab(params.tab);
    else if (params?.id) setTab("memory");
    else if (params?.entry && advanced) setTab("activity");
  }, [params?.tab, params?.id, params?.entry, advanced]);
  // With Advanced Mode off the Activity Log tab is hidden — resolve any activity target to Memory.
  const effectiveTab = tab === "activity" && !advanced ? "memory" : tab;
  const tabs = [
    ...(advanced ? [{ id: "activity", label: "Activity Log", icon: "Activity" }] : []),
    { id: "memory", label: "Memory", icon: "Brain" },
  ];
  return (
    <div className="animate-fade-in">
      <PageHeader title="Activity & Memory" subtitle={advanced ? "A full audit trail of what your helpers did, and what they remember." : "What your helpers remember. (Turn on Advanced Mode in Settings to see the full activity log.)"} icon="Activity" />
      <Tabs tabs={tabs} active={effectiveTab} onChange={setTab} />
      <div className="pt-5">{effectiveTab === "activity" ? <ActivityLog /> : <Memory />}</div>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = { success: "sage", info: "sky", warning: "amber", error: "coral", pending: "lavender" };

function entityRoute(e: ActivityLogEntry): Route | null {
  if (!e.entityType || !e.entityId) return null;
  switch (e.entityType) {
    case "agent": case "helper": return { screen: "helpers", params: { id: e.entityId } };
    case "run": return { screen: "activity" };
    case "file": return { screen: "files", params: { file: e.entityId } };
    case "approval": return { screen: "messages", params: { tab: "approvals", approval: e.entityId } };
    case "thread": return { screen: "messages", params: { thread: e.entityId } };
    case "memory": return { screen: "activity", params: { tab: "memory", id: e.entityId } };
    case "miniApp": return { screen: "miniapps", params: { id: e.entityId } };
    case "connection": return { screen: "connections", params: { id: e.entityId } };
    default: return null;
  }
}

/** One normalized row for the unified activity feed, whether it came from the server's
 *  real audit trail or a locally-recorded client action. `description` is the raw
 *  string (shown only in Advanced Mode); `plain` is the warm, honest translation every
 *  household sees by default (ISS-014). */
interface ActivityRow { id: string; timestamp: string; actorName: string; actionType: string; description: string; plain: string; status: string; spaceId?: string; route: Route | null; source: "server" | "local" }

function localRow(e: ActivityLogEntry): ActivityRow {
  // Client-recorded entries are already household-facing copy (written by the app,
  // not a raw audit code), so the raw and plain-language views are the same text.
  return { id: e.id, timestamp: e.timestamp, actorName: e.actorName, actionType: e.actionType, description: e.description, plain: e.description, status: e.status, spaceId: e.spaceId, route: entityRoute(e), source: "local" };
}

// ISS-014 — the server audit trail speaks in event codes and tool ids
// ("run.step · gmail.search — not_connected"), which is exactly right for Advanced
// Mode but meaningless to most families. Each connector/tool id maps to what a
// household actually calls the thing, and to what they'd need to reconnect.
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
    plain: plainLanguageAudit(a),
    status: a.ok ? "success" : "error",
    // ISS-114: deep-link from whatever entity the event names, not just connectors.
    route: routeForAudit(a),
    source: "server",
  };
}

function ActivityLog() {
  const data = useStore((s) => s.data);
  const navigate = useStore((s) => s.navigate);
  // ISS-014: Advanced Mode (src/lib/prefs.ts, surfaced in Settings) is the existing
  // opt-in for technical detail across the app — the Activity Log reuses it rather
  // than inventing a second raw/friendly toggle. Off by default → plain language.
  const [advanced] = useAdvancedMode();
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
                  <p className="text-sm text-ink-800">{advanced ? e.description : e.plain}</p>
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
