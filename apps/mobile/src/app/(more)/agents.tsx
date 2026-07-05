// Agents — the household's helpers at a glance: status, purpose, run history,
// one-tap Run with a live result, pause/activate, and duplicate/delete via
// long-press. Creation and editing stay conversational in Ask HomeOps (the one
// front door); this screen operates what already exists.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import { api, type AgentRec, type RunRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic, type HearthColors } from "@/theme";
// "ui/index" (not "ui"): the legacy src/components/ui.tsx still shadows the ui/
// directory until the old screens are all ported — this resolves the new system.
import { Badge, Button, EmptyState, ErrorState, HScreen, Notice, PressableCard, Rise, SkeletonCards, Sym, SymTile, T } from "@/components/ui";

// The server's publicAgent() returns the whole record; these extras aren't in the
// shared AgentRec type, so read them defensively here.
type AgentX = AgentRec & { system?: boolean; icon?: string };
// runs() carries source attribution beyond the minimal RunRec type.
type RunX = RunRec & { sourceRef?: { agentId?: string | null } | null; createdAt?: string | number; source?: string };

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

function statusBadge(c: HearthColors, status: string): { fg: string; bg: string } {
  switch (status) {
    case "Active": return { fg: c.sage, bg: c.sageBg };
    case "Paused": return { fg: c.amber, bg: c.amberBg };
    case "Needs Attention": return { fg: c.coral, bg: c.coralBg };
    default: return { fg: c.textMuted, bg: c.surfaceSunken }; // Draft & anything unknown
  }
}

function friendly(error?: string, message?: string): string {
  if (message) return message;
  switch (error) {
    case "insufficient_role": return "Only an Owner or Adult Admin can do that.";
    case "system_agent_protected": return "This is a built-in agent and can't be deleted.";
    case "network": return "Couldn't reach HomeOps — check your connection.";
    default: return `Something went wrong${error ? ` (${error})` : ""}.`;
  }
}

function runStatusText(status?: string): string {
  switch (status) {
    case "completed": return "finished";
    case "waiting_approval": return "paused for your approval";
    case "failed": return "failed";
    case "running": case "in_progress": return "running";
    default: return status ?? "started";
  }
}

export default function AgentsScreen() {
  const { session } = useSession();
  const { colors, spacing } = useTheme();
  const canManage = session?.role === "Owner" || session?.role === "Adult Admin";

  const [agents, setAgents] = useState<AgentX[]>([]);
  const [runs, setRuns] = useState<RunX[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ag, rn] = await Promise.all([api.agents(), api.runs()]);
    if (ag.length === 0 && rn.length === 0 && !(await api.health())) {
      setError("The HomeOps server didn't answer.");
    } else {
      setError(null);
      setAgents(ag as AgentX[]);
      setRuns(rn as RunX[]);
    }
    setLoading(false);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  // The agent record itself carries no run stats — derive them from the durable
  // runs feed (sourceRef.agentId), falling back to any fields the server may add.
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

  const visible = useMemo(() => agents.filter((a) => a.status !== "Archived"), [agents]);

  /* ------------------------------ actions ------------------------------ */
  const doRun = async (a: AgentX) => {
    setRunningId(a.id); setNotice(null);
    const r = await api.runAgent(a.id);
    setRunningId(null);
    if (r.run) {
      const failed = r.run.status === "failed";
      tapHaptic(failed ? "error" : "success");
      setNotice({ ok: !failed, text: `${a.name}: run ${runStatusText(r.run.status)}.` });
      await load();
    } else {
      setNotice({ ok: false, text: friendly(r.error, r.message) });
    }
  };

  const toggleStatus = async (a: AgentX) => {
    const next = a.status === "Active" ? "Paused" : "Active";
    setBusyId(a.id); setNotice(null);
    setAgents((arr) => arr.map((x) => (x.id === a.id ? { ...x, status: next } : x)));
    const r = await api.patchAgent(a.id, { status: next });
    setBusyId(null);
    if (!r.agent) {
      setAgents((arr) => arr.map((x) => (x.id === a.id ? { ...x, status: a.status } : x)));
      setNotice({ ok: false, text: friendly(r.error) });
    }
  };

  const doDuplicate = async (a: AgentX) => {
    setNotice(null);
    const r = await api.duplicateAgent(a.id);
    if (r.agent) {
      tapHaptic("success");
      setNotice({ ok: true, text: `Duplicated as "${r.agent.name}" (Draft).` });
      await load();
    } else {
      setNotice({ ok: false, text: friendly(r.error) });
    }
  };

  const doDelete = async (a: AgentX) => {
    setNotice(null);
    const r = await api.deleteAgent(a.id);
    if (r.ok) {
      tapHaptic("warning");
      setAgents((arr) => arr.filter((x) => x.id !== a.id));
      setNotice({ ok: true, text: `"${a.name}" deleted.` });
    } else {
      setNotice({ ok: false, text: friendly(r.error) });
    }
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

  /* ------------------------------- render ------------------------------ */
  if (loading) return <HScreen><SkeletonCards count={3} /></HScreen>;
  if (error) return <HScreen refreshing={refreshing} onRefresh={onRefresh}><ErrorState message={error} onRetry={() => void load()} /></HScreen>;

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

      <Rise index={0}>
        <PressableCard
          onPress={() => router.push("/(ask)")}
          accessibilityRole="button"
          accessibilityLabel="Open Ask HomeOps"
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
        >
          <SymTile name="sparkles" color={colors.ember} bg={colors.emberBg} />
          <View style={{ flex: 1, gap: 2 }}>
            <T kind="bodyMedium" color={colors.text}>Create and edit agents in Ask HomeOps</T>
            <T kind="sub">Just describe what you need — it builds the helper for you.</T>
          </View>
          <Sym name="chevron.right" size={13} color={colors.textFaint} />
        </PressableCard>
      </Rise>

      {!canManage && visible.length > 0 ? (
        <T kind="caption" center color={colors.textFaint}>Only an Owner or Adult Admin can run or change agents.</T>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          icon="sparkles"
          title="No agents yet"
          hint="Describe what you need in Ask HomeOps — like a morning briefing or a bill watcher — and it becomes an agent here."
          action={{ title: "Ask HomeOps", onPress: () => router.push("/(ask)") }}
        />
      ) : null}

      {visible.map((a, i) => {
        const b = statusBadge(colors, a.status);
        const st = stats.get(a.id);
        const count = a.runCount ?? st?.count ?? 0;
        const last = toMs(a.lastRunAt ?? null) ?? st?.last ?? null;
        const lastTxt = last ? `Last run ${timeAgo(last)}` : "Never run";
        return (
          <Rise key={a.id} index={i + 1}>
            <PressableCard
              onLongPress={canManage ? () => menu(a) : undefined}
              haptic="select"
              scaleTo={0.985}
              accessibilityLabel={`${a.name}, ${a.status}`}
              accessibilityHint={canManage ? "Long-press for duplicate and delete" : undefined}
              style={{ gap: spacing.sm }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <SymTile name="brain.head.profile" color={colors.lavender} bg={colors.lavenderBg} />
                <View style={{ flex: 1 }}>
                  <T kind="h3" color={colors.text} numberOfLines={1}>{a.name}</T>
                </View>
                <Badge label={a.status} fg={b.fg} bg={b.bg} />
              </View>
              {a.purpose ? <T kind="sub" numberOfLines={2}>{a.purpose}</T> : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Sym name="clock" size={12} color={colors.textFaint} />
                <T kind="caption" color={colors.textFaint}>
                  {lastTxt} · {count} {count === 1 ? "run" : "runs"}
                </T>
              </View>
              {canManage ? (
                <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: 2 }}>
                  <Button
                    title="Run"
                    icon="play.fill"
                    variant="ember"
                    small
                    loading={runningId === a.id}
                    disabled={runningId !== null && runningId !== a.id}
                    onPress={() => void doRun(a)}
                  />
                  <Button
                    title={a.status === "Active" ? "Pause" : "Activate"}
                    icon={a.status === "Active" ? "pause" : "checkmark.circle"}
                    small
                    loading={busyId === a.id}
                    onPress={() => void toggleStatus(a)}
                  />
                </View>
              ) : null}
            </PressableCard>
          </Rise>
        );
      })}
    </HScreen>
  );
}
