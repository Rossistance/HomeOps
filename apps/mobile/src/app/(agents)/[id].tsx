// Agent detail — what this helper is, what it actually uses, what it's allowed to do,
// whether it will run without you, and how to change any of it.
//
// The 2026-07-25 walkthrough spent [17:48]–[18:52] on this one screen:
//   [17:48] "There's not really anything I can do here except run it, pause it, and blank
//           space. I should be able to change the name of the agent, edit what it does."
//   [18:06] "It says it runs the assigned use case skill. Well, what IS that skill?"
//   [18:30] "I should see the connections, the skills, the current permissions… will it run
//           unattended?"
//   [18:47] "There should be an override to run all the time no matter what."
//   [18:52] and for one built from chat: "don't ask for permission, you have approval."
//
// Every answer here comes from the server's ONE effective-policy computation
// (server/agents.mjs agentContext) — the same pass the engine enforces — so this screen can
// state not just what the policy is but which rule decided it. Nothing on it is a label
// standing in for a fact.
import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { api, type AgentContextRec, type AgentRec, type ApprovalRec, type RunRec, type TriggerRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, statusColor, tapHaptic, type HearthColors } from "@/theme";
import {
  T, Card, Badge, Chip, ChipRow, Row, SectionHeader, SkeletonCards, ErrorState,
  Rise, HScreen, PressableScale, Sym, ExpandCard, useConfirmFlash,
} from "@/components/ui";
import { AgentEditSheet, type AgentEdits } from "@/components/sheets/agent-edit-sheet";
import { agentIcon, agentTint, humanSchedule } from "@/lib/agent-meta";

type RunX = RunRec & { sourceRef?: { agentId?: string | null } | null; createdAt?: string | number };

// WP-004: the shared statusColor() helper doesn't know "waiting_for_approval",
// "waiting_for_connector"/"waiting_for_provider", or "expired" — they fall to its
// neutral gray default, which reads as "nothing to see here" for a run that is
// either parked waiting on the household or one that expired unattended (sent
// nothing). Override just those cases; everything else still defers to the shared
// helper so its palette stays the single source of truth.
function runToneOverride(colors: HearthColors, status: string) {
  if (status === "waiting_for_approval" || status === "waiting_for_connector" || status === "waiting_for_provider") {
    return { fg: colors.amber, bg: colors.amberBg };
  }
  if (status === "expired") return { fg: colors.coral, bg: colors.coralBg };
  return statusColor(colors, status);
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
  const [ctx, setCtx] = useState<AgentContextRec | null>(null);
  const [triggers, setTriggers] = useState<TriggerRec[]>([]);
  const [runs, setRuns] = useState<RunX[]>([]);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRec | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [ags, tg, rn, aps, context] = await Promise.all([
      api.agents(), api.triggers(), api.runs(), api.approvals(),
      id ? api.agentContext(id).catch(() => null) : Promise.resolve(null),
    ]);
    const a = ags.find((x) => x.id === id) ?? null;
    setAgent(a);
    setCtx(context);
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

  // G3 — the connections this helper reaches, named from the SERVER's catalog rather than
  // guessed from a tool-id prefix, and split by whether they're actually usable today.
  const connections = useMemo(() => {
    const map = new Map<string, { name: string; available: boolean }>();
    for (const t of ctx?.tools ?? []) {
      if (!t.permitted || !t.connectorName || t.connectorName === "FamiliOS") continue;
      const prev = map.get(t.connectorName);
      map.set(t.connectorName, { name: t.connectorName, available: (prev?.available ?? false) || t.available });
    }
    return [...map.values()];
  }, [ctx]);

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

  /* ---- G1: rename + edit what it does ---- */
  const saveEdits = useCallback(async (edits: AgentEdits) => {
    if (!agent) return;
    setSaving(true);
    const r = await api.patchAgent(agent.id, { ...edits });
    setSaving(false);
    if (!r.agent) {
      Alert.alert("Couldn't save", r.error === "insufficient_role" ? "Only an Owner or Adult Admin can edit a helper." : "Something went wrong.");
      return;
    }
    setAgent(r.agent);
    setEditing(false);
    show("agent", () => void load());
  }, [agent, load, show]);

  /* ---- G4: run unattended, in two honest tiers ---- */
  const setUnattended = useCallback(async (enabled: boolean, includeHighRisk: boolean) => {
    if (!agent) return;
    const r = await api.patchAgent(agent.id, {
      approvalPolicy: {
        autoAllow: agent.approvalPolicy?.autoAllow ?? [],
        alwaysApprove: agent.approvalPolicy?.alwaysApprove ?? [],
        unattended: enabled ? { enabled: true, includeHighRisk } : { enabled: false },
      },
    });
    if (!r.agent) {
      Alert.alert("Couldn't change that", r.error === "insufficient_role" ? "Only an Owner or Adult Admin can do that." : "Something went wrong.");
      return;
    }
    tapHaptic("success");
    await load();          // re-read the policy: the tier that APPLIES may not be the one asked for
  }, [agent, load]);

  const confirmHighRisk = useCallback(() => {
    Alert.alert(
      "Let it send and spend on its own?",
      "It will email, text, and pay without stopping to ask you. Steps you've marked “always ask me” still pause, and the household's external-actions switch still overrides everything.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Allow", style: "destructive", onPress: () => void setUnattended(true, true) },
      ],
    );
  }, [setUnattended]);

  if (loading) return <HScreen><SkeletonCards count={3} /></HScreen>;
  if (!agent) return <HScreen refreshing={refreshing} onRefresh={onRefresh}><ErrorState message="This agent no longer exists." onRetry={() => router.back()} /></HScreen>;

  const tint = agentTint(colors, agent.status);
  const un = ctx?.unattended;
  const gated = ctx?.gatedCount ?? 0;

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
            {/* G1 — the third thing this row was missing. */}
            <PressableScale onPress={() => { tapHaptic("light"); setEditing(true); }} style={{ flex: 1, height: 48, borderRadius: 15, borderCurve: "continuous", backgroundColor: colors.surfaceSunken, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }} accessibilityRole="button" accessibilityLabel="Edit helper">
              <Sym name="pencil" size={15} color={colors.textSecondary} />
              <T kind="bodyMedium" color={colors.textSecondary} style={{ fontWeight: "600" }}>Edit</T>
            </PressableScale>
            <PressableScale onPress={() => void togglePause()} style={{ flex: 1, height: 48, borderRadius: 15, borderCurve: "continuous", backgroundColor: colors.surfaceSunken, alignItems: "center", justifyContent: "center" }} accessibilityRole="button" accessibilityLabel={agent.status === "Active" ? "Pause" : "Resume"}>
              <T kind="bodyMedium" color={colors.textSecondary} style={{ fontWeight: "600" }}>{agent.status === "Active" ? "Pause" : "Resume"}</T>
            </PressableScale>
          </View>
        </Rise>
      )}

      {/* ---- G3/G4: will it run without you? The headline fact, stated first. ---- */}
      {ctx && (
        <Rise index={2}>
          <SectionHeader title="Running on its own" />
          <ExpandCard
            title={
              agent.status !== "Active" ? `It won't run on its own while it's ${agent.status.toLowerCase()}`
              : ctx.runsUnattended ? "Runs start to finish without you"
              : gated === 1 ? "One step will stop and wait for you"
              : `${gated} steps will stop and wait for you`
            }
            icon={ctx.runsUnattended && agent.status === "Active" ? "bolt.fill" : "hand.raised.fill"}
            iconColor={ctx.runsUnattended && agent.status === "Active" ? colors.sage : colors.amber}
            iconBg={ctx.runsUnattended && agent.status === "Active" ? colors.sageBg : colors.amberBg}
            badge={un?.enabled ? { label: un.includeHighRisk ? "Unattended · full" : "Unattended", fg: colors.sage, bg: colors.sageBg } : undefined}
            summary={
              un?.enabled
                ? un.includeHighRisk
                  ? `An ${un.setByRole ?? "admin"} allowed it to send and spend on its own.`
                  : "It runs low-risk steps on its own. Anything that sends or spends still pauses for you."
                : "It pauses for your approval on gated steps."
            }
            chips={[
              { label: `${ctx.executableCount} can run now`, icon: "bolt", tone: ctx.executableCount > 0 ? "good" : "warn" },
              { label: `${ctx.permittedCount} permitted`, icon: "checkmark.shield" },
              ...(gated > 0 ? [{ label: `${gated} need you`, icon: "hand.raised", tone: "warn" as const }] : []),
            ]}
          >
            {/* Naming the steps is the difference between a status and an explanation. */}
            {ctx.gatedCapabilityNames.length > 0 ? (
              <View style={{ gap: 6 }}>
                <T kind="eyebrow">Waits for you</T>
                {ctx.gatedCapabilityNames.map((n) => (
                  <View key={n} style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
                    <Sym name="hand.raised" size={12} color={colors.amber} />
                    <T kind="sub" style={{ flex: 1 }}>{n}</T>
                  </View>
                ))}
                {gated > ctx.gatedCapabilityNames.length ? (
                  <T kind="caption" color={colors.textFaint}>…and {gated - ctx.gatedCapabilityNames.length} more</T>
                ) : null}
              </View>
            ) : null}

            {canManage ? (
              <View style={{ gap: spacing.sm }}>
                <UnattendedRow
                  label="Run unattended"
                  detail="Don't pause on low-risk steps."
                  on={!!un?.enabled}
                  onToggle={() => void setUnattended(!un?.enabled, false)}
                />
                <UnattendedRow
                  label="Including sending and spending"
                  detail={
                    un?.enabled
                      ? "Emails, texts and payments go out without asking."
                      : "Turn on “Run unattended” first."
                  }
                  on={!!un?.includeHighRisk}
                  disabled={!un?.enabled}
                  danger
                  onToggle={() => (un?.includeHighRisk ? void setUnattended(true, false) : confirmHighRisk())}
                />
                <T kind="caption" color={colors.textFaint}>
                  Steps you mark “always ask me”, and the household's external-actions switch, still override this.
                </T>
              </View>
            ) : null}
          </ExpandCard>
        </Rise>
      )}

      {/* ---- G2: name the actual skills ---- */}
      {ctx && ctx.skills.length > 0 && (
        <Rise index={3}>
          <SectionHeader title={ctx.skills.length === 1 ? "The skill it runs" : "The skills it runs"} />
          <View style={{ gap: spacing.sm }}>
            {ctx.skills.map((s) => (
              <ExpandCard
                key={s.id}
                title={s.name}
                icon="list.bullet"
                iconColor={s.ready ? colors.sky : colors.amber}
                iconBg={s.ready ? colors.skyBg : colors.amberBg}
                summary={s.description || undefined}
                badge={s.ready ? undefined : { label: "Not ready", fg: colors.amber, bg: colors.amberBg }}
                chips={[{ label: `${s.stepCount} step${s.stepCount === 1 ? "" : "s"}`, icon: "number" }]}
              >
                {(s.stepNames ?? []).length > 0 ? (
                  <View style={{ gap: 6 }}>
                    {s.stepNames!.map((n, i) => (
                      <View key={`${n}-${i}`} style={{ flexDirection: "row", gap: spacing.sm }}>
                        <T kind="sub" color={colors.textFaint} style={{ width: 18 }}>{i + 1}</T>
                        <T kind="sub" style={{ flex: 1 }}>{n}</T>
                      </View>
                    ))}
                  </View>
                ) : null}
                {!s.ready && s.blockedReason ? (
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <Sym name="exclamationmark.triangle" size={13} color={colors.amber} style={{ marginTop: 2 }} />
                    <T kind="sub" color={colors.amber} style={{ flex: 1 }}>{s.blockedReason}</T>
                  </View>
                ) : null}
              </ExpandCard>
            ))}
          </View>
        </Rise>
      )}

      <Rise index={4}>
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

      {/* ---- G3: connections, then the capability list with the RULE behind each gate ---- */}
      {connections.length > 0 && (
        <Rise index={5}>
          <SectionHeader title="Connections it uses" />
          <ChipRow>
            {connections.map((c) => (
              <Chip
                key={c.name}
                label={c.available ? c.name : `${c.name} · reconnect`}
                icon={c.available ? "link" : "link.badge.plus"}
              />
            ))}
          </ChipRow>
          {connections.some((c) => !c.available) ? (
            <PressableScale
              onPress={() => router.push({ pathname: "/(settings)/connections", params: { from: `/(agents)/${id}` } })}
              haptic="select" accessibilityRole="button" accessibilityLabel="Fix connections"
            >
              <T kind="subMedium" color={colors.ember}>One of these needs reconnecting — fix it in Connections</T>
            </PressableScale>
          ) : null}
        </Rise>
      )}

      {ctx && (
        <Rise index={6}>
          <SectionHeader title="What it's allowed to do" />
          <ExpandCard
            title={
              ctx.openToolAllowList && ctx.openFunctionAllowList
                ? "Anything the household allows, minus what you've blocked"
                : ctx.openToolAllowList || ctx.openFunctionAllowList
                  ? "A specific list, partly"
                  : "Only the capabilities you listed"
            }
            icon="checkmark.shield"
            iconColor={colors.lavender}
            iconBg={colors.lavenderBg}
            summary={
              ctx.openToolAllowList && ctx.openFunctionAllowList
                ? "No explicit list, so it inherits the household's permissions. Denied items are still denied."
                : "It can only use what's on its list — everything else is out of scope for this helper."
            }
            chips={[
              { label: `${ctx.availableCount} available`, icon: "circle.grid.2x2" },
              { label: `${ctx.permittedCount} permitted`, icon: "checkmark.shield" },
              { label: `${ctx.executableCount} can run now`, icon: "bolt", tone: ctx.executableCount > 0 ? "good" : "warn" },
            ]}
          >
            <PolicyList
              rows={[
                ...ctx.tools.filter((t) => t.permitted).map((t) => ({ key: t.toolId, name: t.name, where: t.connectorName, available: t.available, policy: t.policy })),
                ...ctx.functions.filter((f) => f.permitted).map((f) => ({ key: f.id, name: f.name, where: "FamiliOS", available: f.available, policy: f.policy })),
              ]}
            />
          </ExpandCard>
        </Rise>
      )}

      {steps.length > 0 && (
        <Rise index={7}>
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
            {canManage ? (
              <PressableScale onPress={() => { tapHaptic("light"); setEditing(true); }} haptic="select" accessibilityRole="button" accessibilityLabel="Edit these instructions">
                <T kind="subMedium" color={colors.ember}>Edit these instructions</T>
              </PressableScale>
            ) : null}
          </Card>
        </Rise>
      )}

      <Rise index={8}>
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
              const tone = runToneOverride(colors, r.status);
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

      {/* Space: family agents are shared; personal agents exist only for you.
          Color-coded to match chat spaces (ember = family, lavender = personal). */}
      {canManage && (
        <Rise index={9}>
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

      <AgentEditSheet visible={editing} agent={agent} saving={saving} onClose={() => setEditing(false)} onSave={saveEdits} />
      {flash}
    </HScreen>
  );
}

/* ------------------------------ pieces ------------------------------ */

/** A switch row that reads as a sentence. Deliberately not RN's Switch: the danger tier needs
 *  a confirmation before it flips, and a Switch that snaps back after a cancelled Alert looks
 *  broken. */
function UnattendedRow({ label, detail, on, disabled, danger, onToggle }: {
  label: string; detail: string; on: boolean; disabled?: boolean; danger?: boolean; onToggle: () => void;
}) {
  const { colors, spacing, radii } = useTheme();
  const tint = danger ? colors.coral : colors.sage;
  return (
    <PressableScale
      onPress={disabled ? undefined : onToggle}
      disabled={disabled}
      haptic="select"
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: !!disabled }}
      accessibilityLabel={label}
      accessibilityHint={detail}
      style={{
        flexDirection: "row", alignItems: "center", gap: spacing.md,
        backgroundColor: colors.surfaceSunken, borderRadius: radii.sm, borderCurve: "continuous",
        padding: spacing.sm + 2, opacity: disabled ? 0.45 : 1,
      }}
    >
      <View style={{
        width: 26, height: 26, borderRadius: 13,
        alignItems: "center", justifyContent: "center",
        backgroundColor: on ? tint : "transparent",
        borderWidth: on ? 0 : 1.5, borderColor: colors.border,
      }}>
        {on ? <Sym name="checkmark" size={13} color={colors.surface} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <T kind="subMedium" color={colors.text}>{label}</T>
        <T kind="caption" color={colors.textFaint}>{detail}</T>
      </View>
    </PressableScale>
  );
}

/** Each capability with the RULE that decided its gate — WP-105's effective-policy view, so
 *  the screen explains WHY rather than just asserting a state. */
function PolicyList({ rows }: {
  rows: { key: string; name: string; where: string; available: boolean; policy: { decision: string; reason: string; requiresApproval: boolean } }[];
}) {
  const { colors, spacing } = useTheme();
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) return <T kind="sub">Nothing is permitted yet.</T>;
  const shown = showAll ? rows : rows.slice(0, 8);
  return (
    <View style={{ gap: spacing.sm }}>
      {shown.map((r) => {
        const blocked = r.policy?.decision === "blocked";
        const gate = r.policy?.requiresApproval;
        const tint = blocked ? colors.coral : gate ? colors.amber : r.available ? colors.sage : colors.textMuted;
        return (
          <View key={r.key} style={{ flexDirection: "row", gap: spacing.sm }}>
            <Sym
              name={blocked ? "xmark.circle" : gate ? "hand.raised" : r.available ? "checkmark.circle" : "circle.dashed"}
              size={13} color={tint} style={{ marginTop: 2 }}
            />
            <View style={{ flex: 1 }}>
              <T kind="subMedium" color={colors.text}>{r.name}</T>
              <T kind="caption" color={colors.textFaint}>
                {r.where}{r.available ? "" : " · not connected"} — {r.policy?.reason ?? "No rule recorded."}
              </T>
            </View>
          </View>
        );
      })}
      {rows.length > shown.length ? (
        <PressableScale onPress={() => setShowAll(true)} haptic="select" accessibilityRole="button" accessibilityLabel="Show all capabilities">
          <T kind="subMedium" color={colors.ember}>Show all {rows.length}</T>
        </PressableScale>
      ) : null}
    </View>
  );
}
