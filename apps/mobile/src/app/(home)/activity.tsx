// Activity — one timeline surface: the live client-orchestrated run (run-context),
// durable server run history (api.runs), household memory (deletable, confirmed),
// and the server audit trail.
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api, type AuditEvent, type MemoryRec, type RunRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useRun } from "@/lib/run-context";
import { useTheme, statusColor, tapHaptic } from "@/theme";
import {
  T, Card, Badge, Row, SectionHeader, SkeletonCards, ErrorState, Notice,
  Rise, HScreen, Sym, PressableScale,
} from "@/components/ui";

const RUN_LABEL: Record<string, string> = {
  running: "Running", waiting: "Waiting for approval", completed: "Completed", failed: "Failed",
};

export default function ActivityScreen() {
  const { colors, spacing } = useTheme();
  const { session } = useSession();
  const { activeRun, clearRun } = useRun();
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [runs, setRuns] = useState<RunRec[]>([]);
  const [memory, setMemory] = useState<MemoryRec[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [h, rs, mem, ev] = await Promise.all([api.health(), api.runs(), api.memory(), api.audit(20)]);
    setOffline(!h);
    if (h) { setRuns(rs); setMemory(mem); setAudit(ev); }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  const onRefresh = useCallback(async () => {
    setRefreshing(true); setNotice(null); await load(); setRefreshing(false);
  }, [load]);

  // Optimistic delete; the server enforces visibility/role — reload restores truth
  // if it refuses.
  const removeMemory = async (m: MemoryRec) => {
    setMemory((list) => list.filter((x) => x.id !== m.id));
    const r = await api.deleteMemory(m.id);
    if (r.error) {
      tapHaptic("error");
      setNotice(r.error === "insufficient_role" ? "Your role can't delete this memory." : "Couldn't delete that memory — restored it.");
      void load();
    } else {
      tapHaptic("success");
    }
  };
  const confirmDelete = (m: MemoryRec) => {
    Alert.alert(
      "Delete this memory?",
      m.text.length > 120 ? `${m.text.slice(0, 120)}…` : m.text,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void removeMemory(m) },
      ],
    );
  };

  const stepDot = (s: string) =>
    s === "done" ? colors.sage : s === "running" ? colors.ember : s === "blocked" ? colors.amber : colors.textFaint;

  // Live-run tone: running reads ember (it's ours, right now); waiting reads amber.
  const liveTone = activeRun
    ? activeRun.status === "running" ? { fg: colors.ember, bg: colors.emberBg }
      : activeRun.status === "waiting" ? { fg: colors.amber, bg: colors.amberBg }
      : statusColor(colors, activeRun.status)
    : null;

  const history = runs.slice(0, 12);

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      {notice ? <Notice text={notice} ok={false} /> : null}

      {loading ? (
        <SkeletonCards count={4} />
      ) : offline ? (
        <ErrorState
          message={`Can't reach the backend at ${api.url}. Make sure "npm run dev" is running on your PC and you're on the same Wi-Fi.`}
          onRetry={() => { setLoading(true); void load(); }}
        />
      ) : (
        <>
          {activeRun && liveTone ? (
            <Rise index={0}>
              <SectionHeader
                title="Live run"
                trailing={
                  activeRun.status === "completed" || activeRun.status === "failed" ? (
                    <PressableScale onPress={clearRun} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear finished run">
                      <T kind="subMedium" color={colors.ember}>Clear</T>
                    </PressableScale>
                  ) : undefined
                }
              />
              <Card>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                  <T kind="h3" color={colors.text} style={{ flex: 1 }}>{activeRun.planTitle}</T>
                  <Badge label={RUN_LABEL[activeRun.status] ?? activeRun.status} fg={liveTone.fg} bg={liveTone.bg} />
                </View>
                <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                  {activeRun.steps.map((s, i) => (
                    <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: stepDot(s.status) }} />
                      <View style={{ flex: 1, gap: 1 }}>
                        <T kind="subMedium" color={colors.text}>{s.title}</T>
                        {s.output || s.detail ? <T kind="sub" numberOfLines={2}>{s.output || s.detail}</T> : null}
                      </View>
                      {s.status === "done" ? <Sym name="checkmark.circle.fill" size={15} color={colors.sage} />
                        : s.status === "blocked" ? <Sym name="pause.circle.fill" size={15} color={colors.amber} />
                        : s.status === "running" ? <Sym name="ellipsis" size={15} color={colors.ember} /> : null}
                    </View>
                  ))}
                </View>
                {activeRun.status === "waiting" ? (
                  <T kind="sub" style={{ marginTop: spacing.sm }}>Review the gated steps in the Inbox tab, then re-run.</T>
                ) : null}
              </Card>
            </Rise>
          ) : null}

          <Rise index={1}>
            <SectionHeader title="Run history" />
            {history.length === 0 ? (
              <Card><T kind="sub">No server runs yet — fire an automation or ask HomeOps to do something.</T></Card>
            ) : (
              <Card padded={false}>
                {history.map((r, i) => {
                  const done = r.steps.filter((s) => s.status === "done" || s.status === "completed").length;
                  const tone = statusColor(colors, r.status);
                  return (
                    <Row
                      key={r.id}
                      icon="clock.arrow.circlepath"
                      iconColor={tone.fg}
                      iconBg={tone.bg}
                      title={r.title || "Run"}
                      subtitle={`${done}/${r.steps.length} step${r.steps.length === 1 ? "" : "s"} done`}
                      trailing={<Badge label={r.status} fg={tone.fg} bg={tone.bg} />}
                      last={i === history.length - 1}
                    />
                  );
                })}
              </Card>
            )}
          </Rise>

          <Rise index={2}>
            <SectionHeader title="Memory" />
            {memory.length === 0 ? (
              <Card><T kind="sub">No memories yet — helpers write these as they learn your household&apos;s routines.</T></Card>
            ) : (
              <Card padded={false}>
                {memory.map((m, i) => (
                  <Row
                    key={m.id}
                    icon="lightbulb.fill"
                    iconColor={colors.amber}
                    iconBg={colors.amberBg}
                    title={m.text}
                    subtitle={`${m.type}${m.scope === "personal" ? " · personal" : ""} · ${new Date(m.createdAt).toLocaleDateString()}`}
                    trailing={
                      <PressableScale
                        onPress={() => confirmDelete(m)}
                        haptic="warning"
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete memory: ${m.text.slice(0, 40)}`}
                      >
                        <Sym name="trash" size={16} color={colors.textFaint} />
                      </PressableScale>
                    }
                    last={i === memory.length - 1}
                  />
                ))}
              </Card>
            )}
          </Rise>

          <Rise index={3}>
            <SectionHeader title="Audit trail" />
            {audit.length === 0 ? (
              <Card><T kind="sub">No server events yet — run a plan to see activity here.</T></Card>
            ) : (
              <Card padded={false}>
                {audit.map((e, i) => (
                  <Row
                    key={e.id}
                    icon={e.ok ? "checkmark.circle.fill" : "xmark.circle.fill"}
                    iconColor={e.ok ? colors.sage : colors.coral}
                    iconBg={e.ok ? colors.sageBg : colors.coralBg}
                    title={e.toolId ? `${e.type} · ${e.toolId}` : e.type}
                    subtitle={`${e.actorName ?? "system"} · ${new Date(e.at).toLocaleTimeString()}`}
                    trailing={!e.ok ? <Badge label="Failed" fg={colors.coral} bg={colors.coralBg} /> : undefined}
                    last={i === audit.length - 1}
                  />
                ))}
              </Card>
            )}
          </Rise>
        </>
      )}
    </HScreen>
  );
}
