// Agent detail — identity, Run now / Pause, schedule ("Runs on"), how it
// works (from its instructions), and recent runs. All server-truth.
import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { api, type AgentRec, type ApprovalRec, type RunRec, type TriggerRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, statusColor } from "@/theme";
import {
  T, Card, Badge, Chip, ChipRow, Row, SectionHeader, SkeletonCards, ErrorState,
  Rise, HScreen, PressableScale, Sym, useConfirmFlash,
} from "@/components/ui";
import { agentIcon, agentTint, humanSchedule } from "@/lib/agent-meta";

type RunX = RunRec & { sourceRef?: { agentId?: string | null } | null; createdAt?: string | number };

function connectorChips(toolIds: string[] | undefined): string[] {
  if (!toolIds?.length) return [];
  const names = new Set<string>();
  for (const t of toolIds) {
    const prefix = t.split(".")[0] ?? t;
    names.add(prefix.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
  }
  return [...names].slice(0, 6);
}

function stepsFrom(instructions: string | undefined): string[] {
  if (!instructions) return [];
  const lines = instructions
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.replace(/^\s*[-*\d.)]+\s*/, "").trim())
    .filter((s) => s.length > 8);
  return lines.slice(0, 4);
}

export default function AgentDetailScreen() {
  const { colors, spacing } = useTheme();
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { flash, show } = useConfirmFlash();
  const canManage = session?.role === "Owner" || session?.role === "Adult Admin";

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [agent, setAgent] = useState<AgentRec | null>(null);
  const [triggers, setTriggers] = useState<TriggerRec[]>([]);
  const [runs, setRuns] = useState<RunX[]>([]);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRec | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [ags, tg, rn, aps] = await Promise.all([api.agents(), api.triggers(), api.runs(), api.approvals()]);
    const a = ags.find((x) => x.id === id) ?? null;
    setAgent(a);
    setTriggers(tg.filter((t) => t.agentId === id));
    const mine = (rn as RunX[]).filter((r) =>
      r.sourceRef?.agentId === id || (a && r.title?.toLowerCase().includes(a.name.toLowerCase())));
    setRuns(mine.slice(0, 5));
    // Best-effort: surface a pending approval created by one of this agent's runs.
    const waitingRunIds = new Set(mine.filter((r) => r.status === "waiting_for_approval").flatMap((r) => r.steps.map((s) => s.approvalId).filter(Boolean)));
    setPendingApproval(aps.find((p) => p.status === "pending" && waitingRunIds.has(p.id)) ?? null);
    setLoading(false);
  }, [id]);
  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const steps = useMemo(() => stepsFrom(agent?.instructions), [agent]);
  const chips = useMemo(() => connectorChips(agent?.toolIds), [agent]);

  async function runNow() {
    if (!agent || busy) return;
    setBusy(true);
    const r = await api.runAgent(agent.id);
    setBusy(false);
    if (r.error) {
      Alert.alert("Couldn't run the agent", r.message ?? (r.error === "insufficient_role" ? "Only an Owner or Adult Admin can run agents." : "Something went wrong."));
      return;
    }
    show("run", () => void load());
  }

  async function togglePause() {
    if (!agent || busy) return;
    const next = agent.status === "Active" ? "Paused" : "Active";
    setAgent({ ...agent, status: next });
    const r = await api.patchAgent(agent.id, { status: next });
    if (!r.agent) {
      setAgent(agent);
      Alert.alert("Couldn't change status", r.error === "insufficient_role" ? "Only an Owner or Adult Admin can do that." : "Something went wrong.");
    }
  }

  if (loading) return <HScreen><SkeletonCards count={3} /></HScreen>;
  if (!agent) return <HScreen refreshing={refreshing} onRefresh={onRefresh}><ErrorState message="This agent no longer exists." onRetry={() => router.back()} /></HScreen>;

  const tint = agentTint(colors, agent.status);

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      <Rise index={0}>
        <View style={{ alignItems: "center", gap: 10, marginTop: spacing.sm }}>
          <View style={{ width: 58, height: 58, borderRadius: 17, borderCurve: "continuous", backgroundColor: tint.bg, alignItems: "center", justifyContent: "center" }}>
            <Sym name={agentIcon(agent.name)} size={26} color={tint.fg} />
          </View>
          <T kind="h2Serif" center>{agent.name}</T>
          <Badge label={agent.status} fg={tint.fg} bg={tint.bg} />
          {!!agent.purpose && <T kind="body" center>{agent.purpose}</T>}
        </View>
      </Rise>

      {canManage && (
        <Rise index={1}>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <PressableScale onPress={() => void runNow()} disabled={busy} style={{ flex: 1.4, borderRadius: 15, borderCurve: "continuous", overflow: "hidden", opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Run now">
              <LinearGradient colors={[colors.hero1, colors.hero2]} start={{ x: 0.1, y: 0 }} end={{ x: 0.75, y: 1 }} style={{ height: 48, alignItems: "center", justifyContent: "center" }}>
                <T kind="bodyMedium" color={colors.heroText} style={{ fontWeight: "600" }}>Run now</T>
              </LinearGradient>
            </PressableScale>
            <PressableScale onPress={() => void togglePause()} style={{ flex: 1, height: 48, borderRadius: 15, borderCurve: "continuous", backgroundColor: colors.surfaceSunken, alignItems: "center", justifyContent: "center" }} accessibilityRole="button" accessibilityLabel={agent.status === "Active" ? "Pause" : "Resume"}>
              <T kind="bodyMedium" color={colors.textSecondary} style={{ fontWeight: "600" }}>{agent.status === "Active" ? "Pause" : "Resume"}</T>
            </PressableScale>
          </View>
        </Rise>
      )}

      {/* Space: family agents are shared; personal agents exist only for you.
          Color-coded to match chat spaces (ember = family, lavender = personal). */}
      {canManage && (
        <Rise index={2}>
          <SectionHeader title="Space" />
          <Card style={{ flexDirection: "row", gap: spacing.sm }}>
            {([["household", "Family", colors.ember], ["personal", "Personal", colors.lavender]] as const).map(([key, label, tintC]) => {
              const active = (agent.visibility ?? "household") === key;
              return (
                <PressableScale
                  key={key}
                  haptic="select"
                  onPress={() => void (async () => {
                    if (active) return;
                    const prev = agent.visibility;
                    setAgent({ ...agent, visibility: key });
                    const r = await api.patchAgent(agent.id, { visibility: key });
                    if (r.error) {
                      setAgent({ ...agent, visibility: prev });
                      Alert.alert("Couldn't move the agent", r.error === "insufficient_role" ? "Only an Owner or Adult Admin can do that." : "Something went wrong.");
                    }
                  })()}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${label} space`}
                  style={{
                    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                    paddingVertical: 10, borderRadius: 12, borderCurve: "continuous",
                    backgroundColor: active ? tintC : colors.surfaceSunken,
                  }}
                >
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: active ? colors.surface : tintC }} />
                  <T kind="subMedium" color={active ? colors.surface : colors.textSecondary} style={{ fontWeight: "600" }}>{label}</T>
                </PressableScale>
              );
            })}
          </Card>
          <T kind="caption" color={colors.textFaint}>
            {(agent.visibility ?? "household") === "personal" ? "Only you can see and use this agent." : "Everyone in the household can see and use this agent."}
          </T>
        </Rise>
      )}

      <Rise index={2}>
        <SectionHeader title="Runs on" />
        <Card padded={triggers.length === 0}>
          {triggers.length === 0 ? (
            <T kind="sub">Runs manually — ask Famili or tap Run now.</T>
          ) : (
            triggers.map((t, i) => (
              <Row
                key={t.id}
                icon="clock"
                iconColor={t.enabled ? colors.sage : colors.textMuted}
                iconBg={t.enabled ? colors.sageBg : colors.surfaceSunken}
                title={humanSchedule(t)}
                subtitle={t.enabled ? t.name : `${t.name} · paused`}
                last={i === triggers.length - 1}
              />
            ))
          )}
        </Card>
      </Rise>

      {chips.length > 0 && (
        <Rise index={3}>
          <SectionHeader title="Uses" />
          <ChipRow>
            {chips.map((c) => <Chip key={c} label={c} icon="link" />)}
          </ChipRow>
        </Rise>
      )}

      {steps.length > 0 && (
        <Rise index={4}>
          <SectionHeader title="How this agent works" />
          <Card style={{ gap: spacing.md }}>
            {steps.map((s, i) => (
              <View key={i} style={{ flexDirection: "row", gap: spacing.md, alignItems: "flex-start" }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.emberBg, alignItems: "center", justifyContent: "center" }}>
                  <T kind="caption" color={colors.ember}>{i + 1}</T>
                </View>
                <T kind="sub" color={colors.textSecondary} style={{ flex: 1 }}>{s}</T>
              </View>
            ))}
          </Card>
        </Rise>
      )}

      <Rise index={5}>
        <SectionHeader title="Recent activity" />
        <Card padded={runs.length === 0 && !pendingApproval}>
          {pendingApproval && (
            <Row
              icon="bell.badge"
              iconColor={colors.amber}
              iconBg={colors.amberBg}
              title="View pending approval"
              subtitle="This agent is waiting on you"
              chevron
              onPress={() => router.push("/(home)")}
              last={runs.length === 0}
            />
          )}
          {runs.length === 0 && !pendingApproval ? (
            <T kind="sub">No runs yet.</T>
          ) : (
            runs.map((r, i) => {
              const tone = statusColor(colors, r.status);
              const done = r.steps.filter((s) => ["done", "completed", "succeeded"].includes(s.status)).length;
              return (
                <Row
                  key={r.id}
                  icon="clock.arrow.circlepath"
                  iconColor={tone.fg}
                  iconBg={tone.bg}
                  title={r.title || "Run"}
                  subtitle={`${done}/${r.steps.length} steps`}
                  trailing={<Badge label={r.status.replace(/_/g, " ")} fg={tone.fg} bg={tone.bg} />}
                  last={i === runs.length - 1}
                />
              );
            })
          )}
        </Card>
      </Rise>
      {flash}
    </HScreen>
  );
}
