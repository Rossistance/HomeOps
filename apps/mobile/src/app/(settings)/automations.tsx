// Automations — the server's trigger registry: schedules, recurring timers,
// webhooks, connector watchers and manual triggers. Each card shows what fires,
// when, what it runs, and how the last firing went; the Switch flips `enabled`
// live and "Test run" fires the real trigger through the durable runtime.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Switch, View } from "react-native";
import { router } from "expo-router";
import { api, type RunRec, type TriggerRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic, statusColor, type HearthColors } from "@/theme";
// "ui/index" (not "ui"): the legacy src/components/ui.tsx still shadows the ui/
// directory until the old screens are all ported — this resolves the new system.
import { Badge, Button, Card, EmptyState, ErrorState, HScreen, Notice, PressableCard, Rise, Row, SectionHeader, SkeletonCards, Sym, T } from "@/components/ui";

// The server's publicTrigger() shape (server/triggers.mjs): agent linkage lives in
// target.agentId (not top-level agentId), the last outcome is the string
// `lastStatus` (not a lastResult object), and schedule state is nextRunAt (ms).
// Read all of it defensively on top of the shared TriggerRec.
type TriggerX = TriggerRec & {
  target?: { kind?: string; agentId?: string | null; skillId?: string | null; goal?: string | null } | null;
  nextRunAt?: number | null;
  lastRunId?: string | null;
  lastStatus?: string | null;
  fireCount?: number;
  connectorId?: string | null;
  event?: string | null;
  webhookPath?: string | null;
  system?: boolean;
};
type RunX = RunRec & { source?: string; sourceRef?: { triggerId?: string | null } | null; createdAt?: string | number };

function toMs(v?: string | number | null): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function timeAgo(v?: string | number | null): string | null {
  const ms = toMs(v);
  if (!ms) return null;
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const TYPE_LABEL: Record<string, string> = {
  schedule: "Schedule", recurring: "Recurring", webhook: "Webhook",
  connector_event: "Connector event", manual: "Manual",
};

function typeBadge(c: HearthColors, type: string): { fg: string; bg: string; icon: string } {
  switch (type) {
    case "schedule": return { fg: c.sky, bg: c.skyBg, icon: "clock" };
    case "recurring": return { fg: c.sky, bg: c.skyBg, icon: "arrow.triangle.2.circlepath" };
    case "webhook": return { fg: c.lavender, bg: c.lavenderBg, icon: "link" };
    case "connector_event": return { fg: c.amber, bg: c.amberBg, icon: "bolt" };
    default: return { fg: c.textMuted, bg: c.surfaceSunken, icon: "hand.tap" };
  }
}

// "every 30 min" / "daily at 7:00 AM" / "runs Jul 9, 7:00 AM" — human words, not ms.
function scheduleText(t: TriggerX): string {
  const at = (ms: number | null | undefined, style: Intl.DateTimeFormatOptions) =>
    ms ? new Date(ms).toLocaleString(undefined, style) : null;
  if (t.type === "recurring" && t.intervalMs) {
    const ms = t.intervalMs;
    if (ms % 86400000 === 0) {
      const days = ms / 86400000;
      const time = at(t.nextRunAt, { hour: "numeric", minute: "2-digit" });
      const cadence = days === 1 ? "daily" : days === 7 ? "weekly" : `every ${days} days`;
      return time ? `${cadence} at ${time}` : cadence;
    }
    const min = Math.round(ms / 60000);
    if (min < 60) return `every ${min} min`;
    if (min % 60 === 0) return `every ${min / 60} hr`;
    return `every ${Math.round((min / 60) * 10) / 10} hr`;
  }
  if (t.type === "schedule") {
    const when = at(t.nextRunAt ?? toMs(t.runAt), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return when ? `runs ${when}` : "one-time — already ran";
  }
  if (t.type === "webhook") return t.webhookPath ?? "fires on inbound webhook";
  if (t.type === "connector_event") return `on ${t.connectorId ?? "connector"}${t.event ? ` · ${t.event}` : ""} events`;
  return "fires on demand";
}

// lastStatus is a run-status string ("completed", "started", …) or "error:<code>".
function lastResultBadge(c: HearthColors, t: TriggerX): { label: string; fg: string; bg: string } | null {
  const raw = t.lastStatus ?? (t.lastResult ? (t.lastResult.ok ? "completed" : "failed") : null);
  if (!raw) return null;
  if (raw.startsWith("error") || raw === "failed" || raw === "denied") return { label: "error", fg: c.coral, bg: c.coralBg };
  if (raw === "started" || raw === "running" || raw === "waiting_approval" || raw === "pending") {
    return { label: raw.replace(/_/g, " "), fg: c.amber, bg: c.amberBg };
  }
  return { label: "ok", fg: c.sage, bg: c.sageBg };
}

function friendly(error?: string, message?: string): string {
  if (message) return message;
  switch (error) {
    case "insufficient_role": return "Only an Owner or Adult Admin can change automations.";
    case "invalid_target": return "This automation has no agent or skill to run — rebuild it in Ask HomeOps.";
    case "network": return "Couldn't reach HomeOps — check your connection.";
    default: return `Something went wrong${error ? ` (${error})` : ""}.`;
  }
}

export default function AutomationsScreen() {
  const { session } = useSession();
  const { colors, spacing } = useTheme();
  const canManage = session?.role === "Owner" || session?.role === "Adult Admin";

  const [triggers, setTriggers] = useState<TriggerX[]>([]);
  const [runs, setRuns] = useState<RunX[]>([]);
  const [agentNames, setAgentNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [firingId, setFiringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [trs, rns, ags] = await Promise.all([api.triggers(), api.runs(), api.agents()]);
    if (trs.length === 0 && rns.length === 0 && !(await api.health())) {
      setError("The HomeOps server didn't answer.");
    } else {
      setError(null);
      setTriggers(trs as TriggerX[]);
      setRuns(rns as RunX[]);
      setAgentNames(new Map(ags.map((a) => [a.id, a.name])));
    }
    setLoading(false);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  // Trigger-fired runs are attributed source:"trigger" by the server; if none are
  // identifiable yet, fall back to the latest runs so the section stays honest.
  const { recentRuns, recentIsFallback } = useMemo(() => {
    const sorted = [...runs].sort((a, b) => (toMs(b.createdAt) ?? 0) - (toMs(a.createdAt) ?? 0));
    const fired = sorted.filter((r) => r.source === "trigger");
    return fired.length > 0
      ? { recentRuns: fired.slice(0, 8), recentIsFallback: false }
      : { recentRuns: sorted.slice(0, 10), recentIsFallback: sorted.length > 0 };
  }, [runs]);

  const triggerName = useMemo(() => new Map(triggers.map((t) => [t.id, t.name])), [triggers]);

  /* ------------------------------ actions ------------------------------ */
  const toggleEnabled = async (t: TriggerX, v: boolean) => {
    tapHaptic("select");
    setNotice(null);
    setTriggers((arr) => arr.map((x) => (x.id === t.id ? { ...x, enabled: v } : x)));
    const r = await api.patchTrigger(t.id, { enabled: v });
    if (r.trigger) {
      setTriggers((arr) => arr.map((x) => (x.id === t.id ? (r.trigger as TriggerX) : x)));
    } else {
      setTriggers((arr) => arr.map((x) => (x.id === t.id ? { ...x, enabled: t.enabled } : x)));
      setNotice({ ok: false, text: friendly(r.error) });
    }
  };

  const testRun = async (t: TriggerX) => {
    setFiringId(t.id); setNotice(null);
    const r = await api.fireTrigger(t.id);
    setFiringId(null);
    if (r.ok) {
      tapHaptic("success");
      setNotice({ ok: true, text: `${t.name}: fired${r.runId ? ` — run ${r.runId.slice(0, 12)}… started` : ""}.` });
      await load();
    } else {
      setNotice({ ok: false, text: friendly(r.error, r.message) });
    }
  };

  const doDelete = async (t: TriggerX) => {
    setNotice(null);
    const r = await api.deleteTrigger(t.id);
    if (r.ok) {
      tapHaptic("warning");
      setTriggers((arr) => arr.filter((x) => x.id !== t.id));
      setNotice({ ok: true, text: `"${t.name}" deleted.` });
    } else {
      setNotice({ ok: false, text: friendly(r.error) });
    }
  };

  const menu = (t: TriggerX) => {
    tapHaptic("select");
    Alert.alert(t.name, scheduleText(t), [
      { text: "Test run", onPress: () => void testRun(t) },
      {
        text: "Delete…", style: "destructive",
        onPress: () => Alert.alert("Delete automation?", `"${t.name}" will stop firing and be removed.`, [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => void doDelete(t) },
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

      {triggers.length === 0 ? (
        <EmptyState
          icon="arrow.triangle.2.circlepath"
          title="No automations yet"
          hint={'Ask HomeOps to schedule something — like "every morning at 7, brief me on today" — and it lands here as a trigger.'}
          action={{ title: "Ask HomeOps", onPress: () => router.push("/(ask)") }}
        />
      ) : null}

      {!canManage && triggers.length > 0 ? (
        <T kind="caption" center color={colors.textFaint}>Only an Owner or Adult Admin can change automations.</T>
      ) : null}

      {triggers.map((t, i) => {
        const tb = typeBadge(colors, t.type);
        const res = lastResultBadge(colors, t);
        const agentId = t.target?.agentId ?? t.agentId ?? null;
        const linkage = t.target?.kind === "skill" && t.target?.skillId
          ? `Runs skill: ${t.target.skillId}`
          : agentId
            ? `Runs agent: ${agentNames.get(agentId) ?? agentId}`
            : t.target?.goal
              ? `Goal: ${t.target.goal}`
              : null;
        const fired = timeAgo(t.lastFiredAt);
        const fireCount = t.fireCount ?? 0;
        return (
          <Rise key={t.id} index={i + 1}>
            <PressableCard
              onLongPress={canManage ? () => menu(t) : undefined}
              haptic="select"
              scaleTo={0.985}
              accessibilityLabel={`${t.name}, ${TYPE_LABEL[t.type] ?? t.type}, ${t.enabled ? "enabled" : "disabled"}`}
              accessibilityHint={canManage ? "Long-press for test run and delete" : undefined}
              style={{ gap: spacing.sm }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <View style={{ flex: 1, gap: 5 }}>
                  <T kind="h3" color={colors.text} numberOfLines={1}>{t.name}</T>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Badge label={TYPE_LABEL[t.type] ?? t.type} icon={tb.icon} fg={tb.fg} bg={tb.bg} />
                    {res ? <Badge label={res.label} fg={res.fg} bg={res.bg} /> : null}
                  </View>
                </View>
                <Switch
                  value={!!t.enabled}
                  disabled={!canManage}
                  onValueChange={(v) => void toggleEnabled(t, v)}
                  trackColor={{ false: colors.surfaceSunken, true: colors.sage }}
                  thumbColor={colors.surface}
                  ios_backgroundColor={colors.surfaceSunken}
                  accessibilityLabel={`${t.name} enabled`}
                />
              </View>

              <View style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Sym name="clock" size={12} color={colors.textFaint} />
                  <T kind="caption" color={colors.textMuted} numberOfLines={1} style={{ flex: 1 }}>{scheduleText(t)}</T>
                </View>
                {linkage ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Sym name="sparkles" size={12} color={colors.textFaint} />
                    <T kind="caption" color={colors.textMuted} numberOfLines={1} style={{ flex: 1 }}>{linkage}</T>
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Sym name="clock.arrow.circlepath" size={12} color={colors.textFaint} />
                  <T kind="caption" color={colors.textFaint}>
                    {fired ? `Last fired ${fired}` : "Never fired"} · {fireCount} {fireCount === 1 ? "firing" : "firings"}
                  </T>
                </View>
              </View>

              {canManage ? (
                <View style={{ flexDirection: "row", marginTop: 2 }}>
                  <Button
                    title="Test run"
                    icon="play.circle"
                    small
                    loading={firingId === t.id}
                    disabled={firingId !== null && firingId !== t.id}
                    onPress={() => void testRun(t)}
                  />
                </View>
              ) : null}
            </PressableCard>
          </Rise>
        );
      })}

      {recentRuns.length > 0 ? (
        <Rise index={triggers.length + 1}>
          <SectionHeader title={recentIsFallback ? "Recent runs" : "Recent automation runs"} />
          {recentIsFallback ? (
            <T kind="caption" color={colors.textFaint} style={{ marginBottom: spacing.sm }}>
              No trigger-fired runs yet — showing the latest runs instead.
            </T>
          ) : null}
          <Card padded={false}>
            {recentRuns.map((r, i) => {
              const sc = statusColor(colors, r.status);
              const trg = r.sourceRef?.triggerId ? triggerName.get(r.sourceRef.triggerId) : null;
              const when = timeAgo(r.createdAt);
              return (
                <Row
                  key={r.id}
                  title={r.title || "Run"}
                  subtitle={[when, trg].filter(Boolean).join(" · ") || undefined}
                  icon="bolt.badge.clock"
                  iconColor={sc.fg}
                  iconBg={sc.bg}
                  trailing={<Badge label={r.status.replace(/_/g, " ")} fg={sc.fg} bg={sc.bg} />}
                  last={i === recentRuns.length - 1}
                />
              );
            })}
          </Card>
        </Rise>
      ) : null}
    </HScreen>
  );
}
