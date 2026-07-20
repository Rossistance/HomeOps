// Agents — the household's helpers at a glance. Handoff layout: "+" to draft a
// new agent conversationally, segmented status filter, tinted agent cards with
// status pills → detail. Duplicate/delete stay on long-press; run/pause live on
// the detail screen.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { api, type AgentRec, type RunRec, type TriggerRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
import { Badge, EmptyState, ErrorState, HScreen, Notice, PressableCard, PressableScale, Rise, SkeletonCards, Sym, SymTile, T } from "@/components/ui";
import { NewAgentSheet } from "@/components/sheets/new-agent-sheet";
import { agentIcon, agentTint, scheduleForAgent } from "@/lib/agent-meta";

type AgentX = AgentRec & { system?: boolean; icon?: string };
type RunX = RunRec & { sourceRef?: { agentId?: string | null } | null; createdAt?: string | number };
// The server now resolves a human `scheduleText` (plus anchor/tzSource) on every
// trigger (WP-002/WP-006, see server/triggers.mjs publicTrigger) — the shared
// TriggerRec type predates that, so it's widened defensively here rather than
// trusted blindly, same as the Automations screen does.
type TriggerX = TriggerRec & { scheduleText?: string; anchor?: string | null; tzSource?: "household" | "server" | null };

// Prefer the server's own schedule text over lib/agent-meta.ts's humanSchedule(),
// which only knows intervalMs/runAt and predates anchors — and disclose a
// household-timezone-not-set fallback rather than hiding it (ISS-009/WP-006).
function scheduleTextForAgent(agentId: string, triggers: TriggerX[]): string | null {
  const mine = triggers.find((t) => t.agentId === agentId && t.enabled !== false);
  if (!mine) return null;
  const base = mine.scheduleText ?? scheduleForAgent(agentId, triggers);
  if (!base) return base;
  return mine.tzSource === "server" ? `${base} · server time zone (household's isn't set)` : base;
}

const FILTERS = ["All", "Active", "Attention", "Paused"] as const;
type Filter = (typeof FILTERS)[number];

function toMs(v?: string | number | null): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function timeAgo(ms: number | null): string | null {
  if (!ms) return null;
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function friendly(error?: string, message?: string): string {
  if (message) return message;
  switch (error) {
    case "insufficient_role": return "Only an Owner or Adult Admin can do that.";
    case "system_agent_protected": return "This is a built-in agent and can't be deleted.";
    case "network": return "Couldn't reach Famili — check your connection.";
    default: return `Something went wrong${error ? ` (${error})` : ""}.`;
  }
}

export default function AgentsScreen() {
  const { session } = useSession();
  const { colors, spacing } = useTheme();
  const { create } = useLocalSearchParams<{ create?: string }>();
  const canManage = session?.role === "Owner" || session?.role === "Adult Admin";

  const [agents, setAgents] = useState<AgentX[]>([]);
  const [runs, setRuns] = useState<RunX[]>([]);
  const [triggers, setTriggers] = useState<TriggerX[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    const [ag, rn, tg] = await Promise.all([api.agents(), api.runs(), api.triggers()]);
    if (ag.length === 0 && rn.length === 0 && !(await api.health())) {
      setError("The Famili server didn't answer.");
    } else {
      setError(null);
      setAgents(ag as AgentX[]);
      setRuns(rn as RunX[]);
      setTriggers(tg);
    }
    setLoading(false);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  useEffect(() => { if (create === "1" && canManage) setCreateOpen(true); }, [create, canManage]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const stats = useMemo(() => {
    const m = new Map<string, { count: number; last: number }>();
    for (const r of runs) {
      const aid = r.sourceRef?.agentId;
      if (!aid) continue;
      const t = toMs(r.createdAt) ?? 0;
      const cur = m.get(aid) ?? { count: 0, last: 0 };
      m.set(aid, { count: cur.count + 1, last: Math.max(cur.last, t) });
    }
    return m;
  }, [runs]);

  const visible = useMemo(() => {
    const notArchived = agents.filter((a) => a.status !== "Archived");
    switch (filter) {
      case "Active": return notArchived.filter((a) => a.status === "Active");
      case "Attention": return notArchived.filter((a) => a.status === "Needs Attention");
      case "Paused": return notArchived.filter((a) => a.status === "Paused");
      default: return notArchived;
    }
  }, [agents, filter]);

  const doDuplicate = async (a: AgentX) => {
    const r = await api.duplicateAgent(a.id);
    if (r.agent) { tapHaptic("success"); setNotice({ ok: true, text: `Duplicated as "${r.agent.name}" (Draft).` }); await load(); }
    else setNotice({ ok: false, text: friendly(r.error) });
  };
  const doDelete = async (a: AgentX) => {
    const r = await api.deleteAgent(a.id);
    if (r.ok) { tapHaptic("warning"); setAgents((arr) => arr.filter((x) => x.id !== a.id)); setNotice({ ok: true, text: `"${a.name}" deleted.` }); }
    else setNotice({ ok: false, text: friendly(r.error) });
  };
  const menu = (a: AgentX) => {
    tapHaptic("select");
    Alert.alert(a.name, a.purpose || undefined, [
      { text: "Duplicate", onPress: () => void doDuplicate(a) },
      {
        text: "Delete…", style: "destructive",
        onPress: () => Alert.alert("Delete agent?", `"${a.name}" and its configuration will be removed.`, [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => void doDelete(a) },
        ]),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  if (loading) return <HScreen><SkeletonCards count={3} /></HScreen>;
  if (error) return <HScreen refreshing={refreshing} onRefresh={onRefresh}><ErrorState message={error} onRetry={() => void load()} /></HScreen>;

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

      {canManage && (
        <Rise index={0}>
          <PressableCard
            onPress={() => setCreateOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="New agent"
            style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
          >
            <SymTile name="plus" color={colors.ember} bg={colors.emberBg} />
            <View style={{ flex: 1, gap: 2 }}>
              <T kind="rowTitle">New agent</T>
              <T kind="detail">Describe what you need — Famili drafts it for your review.</T>
            </View>
            <Sym name="chevron.right" size={13} color={colors.textFaint} />
          </PressableCard>
        </Rise>
      )}

      <Rise index={1}>
        <View style={{ flexDirection: "row", backgroundColor: colors.surfaceSunken, borderRadius: 12, borderCurve: "continuous", padding: 3, gap: 2 }}>
          {FILTERS.map((f) => (
            <PressableScale
              key={f}
              onPress={() => { tapHaptic("select"); setFilter(f); }}
              haptic={null}
              style={{ flex: 1, paddingVertical: 7, borderRadius: 9, borderCurve: "continuous", alignItems: "center", backgroundColor: filter === f ? colors.surface : "transparent" }}
            >
              <T kind="caption" color={filter === f ? colors.text : colors.textSecondary} style={{ fontSize: 12.5 }}>{f}</T>
            </PressableScale>
          ))}
        </View>
      </Rise>

      {!canManage && visible.length > 0 ? (
        <T kind="caption" center color={colors.textFaint}>Only an Owner or Adult Admin can run or change agents.</T>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          icon="sparkles"
          title={filter === "All" ? "No agents yet" : `No ${filter.toLowerCase()} agents`}
          hint="Describe what you need — like a morning briefing or a bill watcher — and it becomes an agent here."
          action={canManage ? { title: "New agent", onPress: () => setCreateOpen(true) } : undefined}
        />
      ) : null}

      {visible.map((a, i) => {
        const tint = agentTint(colors, a.status);
        const st = stats.get(a.id);
        const count = a.runCount ?? st?.count ?? 0;
        const last = toMs(a.lastRunAt ?? null) ?? st?.last ?? null;
        const schedule = scheduleTextForAgent(a.id, triggers);
        return (
          <Rise key={a.id} index={i + 2}>
            <PressableCard
              onPress={() => router.push(`/(agents)/${a.id}`)}
              onLongPress={canManage ? () => menu(a) : undefined}
              haptic="select"
              scaleTo={0.985}
              accessibilityLabel={`${a.name}, ${a.status}`}
              accessibilityHint={canManage ? "Opens details. Long-press for duplicate and delete" : "Opens details"}
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
            >
              <SymTile name={agentIcon(a.name)} color={tint.fg} bg={tint.bg} size={44} iconSize={20} />
              <View style={{ flex: 1, gap: 2 }}>
                <T kind="rowTitle" numberOfLines={1}>{a.name}</T>
                {!!a.purpose && <T kind="detail" numberOfLines={1}>{a.purpose}</T>}
                <T kind="detail" color={colors.textFaint} numberOfLines={1}>
                  {schedule ?? "Runs manually"}{last ? ` · last run ${timeAgo(last)}` : count ? ` · ${count} runs` : ""}
                </T>
              </View>
              <Badge label={a.status} fg={tint.fg} bg={tint.bg} />
              <Sym name="chevron.right" size={13} color={colors.textFaint} />
            </PressableCard>
          </Rise>
        );
      })}

      <NewAgentSheet visible={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => void load()} />
    </HScreen>
  );
}
