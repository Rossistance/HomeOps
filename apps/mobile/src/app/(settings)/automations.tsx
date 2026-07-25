// Automations — the server's trigger registry: schedules, recurring timers,
// webhooks, connector watchers and manual triggers. Each card shows what fires,
// when, what it runs, and how the last firing went; the Switch flips `enabled`
// live and "Test run" fires the real trigger through the durable runtime.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Switch, View } from "react-native";
import { router } from "expo-router";
import { api, type RunRec, type TriggerRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic, statusColor, type HearthColors } from "@/theme";
// "ui/index" (not "ui"): the legacy src/components/ui.tsx still shadows the ui/
// directory until the old screens are all ported — this resolves the new system.
import { Badge, Button, Card, EmptyState, ErrorState, HScreen, Notice, PressableCard, PressableScale, Rise, Row, SectionHeader, SkeletonCards, Sym, T } from "@/components/ui";

// The server's publicTrigger() shape (server/triggers.mjs): agent linkage lives in
// target.agentId (not top-level agentId), the last outcome is the string
// `lastStatus` (not a lastResult object), and schedule state is nextRunAt (ms).
// Read all of it defensively on top of the shared TriggerRec.
// WP-002/WP-006 (see server/triggers.mjs publicTrigger): the server now resolves a
// human schedule plus anchor/tzSource alongside the raw fields, and settles
// lastStatus to a TERMINAL value (completed/failed/expired/waiting_for_approval)
// instead of a permanent "started" (ISS-009). The shared TriggerRec type predates
// all of this, so it's widened defensively here rather than trusted blindly.
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
  /** "HH:MM" wall-clock anchor, e.g. "07:00" for a daily 7 AM briefing. */
  anchor?: string | null;
  /** Which clock the anchor resolved against — discloses a server-local fallback
   * when the household never set a timezone, instead of hiding it. */
  tzSource?: "household" | "server" | null;
  /** Ready-to-render human schedule, e.g. "Daily · 7:00 AM" — never raw intervalMs. */
  scheduleText?: string;
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
// Fallback only: the server now sends a ready-made `scheduleText` (preferred
// wherever a trigger is rendered below) — this covers a record from before that
// field existed.
function fallbackScheduleText(t: TriggerX): string {
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

// lastStatus is now a TERMINAL run-status string (ISS-009: completed, failed,
// expired, waiting_for_approval, …) or "error:<code>" — never a permanent
// "started". A bare "started"/"queued" can still show up for a run mid-flight or
// a record from before the terminal writeback landed; render it neutrally rather
// than as a false "ok".
function lastResultBadge(c: HearthColors, t: TriggerX): { label: string; fg: string; bg: string } | null {
  const raw = t.lastStatus ?? (t.lastResult ? (t.lastResult.ok ? "completed" : "failed") : null);
  if (!raw) return null;
  if (raw.startsWith("error") || raw === "failed" || raw === "denied" || raw === "expired" || raw === "cancelled") {
    return { label: raw.replace(/^error:/, "").replace(/_/g, " "), fg: c.coral, bg: c.coralBg };
  }
  if (raw.startsWith("waiting")) return { label: raw.replace(/_/g, " "), fg: c.amber, bg: c.amberBg };
  if (raw === "completed" || raw === "succeeded") return { label: "completed", fg: c.sage, bg: c.sageBg };
  return { label: raw.replace(/_/g, " "), fg: c.textMuted, bg: c.surfaceSunken };
}

function friendly(error?: string, message?: string): string {
  if (message) return message;
  switch (error) {
    case "insufficient_role": return "Only an Owner or Adult Admin can change automations.";
    case "invalid_target": return "This automation has no agent or skill to run — rebuild it in Ask Famili.";
    case "network": return "Couldn't reach FamiliOS — check your connection.";
    default: return `Something went wrong${error ? ` (${error})` : ""}.`;
  }
}

/* ----------------------- live "Test run" progress ------------------------ */
// Poll the durable run the fired trigger started, so the user watches it move
// step-by-step instead of a one-line "started" notice. Mapping mirrors the
// vocabulary in lib/run-context.tsx but keeps failed/waiting distinct for glyphs.
const LIVE_POLL_MS = 1800;
const LIVE_POLL_MAX_MS = 3 * 60 * 1000;
type StepVis = "pending" | "running" | "done" | "failed" | "waiting" | "not_sent" | "skipped" | "expired";
type RunVis = "running" | "waiting" | "completed" | "failed";

// WP-004: a step that claimed an effect (send/email/notify) but had no delivery tool
// behind it, one a policy clamped, and one whose approval window closed unattended
// each get their own honest glyph below — none of them may fall into the neutral
// "pending" default, which is exactly how a run that delivered nothing used to read
// as though it was still quietly working.
function stepVis(st: RunRec["steps"][number]): StepVis {
  const s = st.status;
  if (s === "done" || s === "completed" || s === "succeeded") return "done";
  if (s === "skipped_no_tool") return "not_sent";
  if (s === "expired") return "expired";
  if (s === "skipped") return "skipped";
  if (s === "failed" || s === "error") return "failed";
  if (s === "waiting_approval" || s === "waiting_for_approval" || s === "blocked" || s === "paused" || st.approvalId) return "waiting";
  if (s === "running" || s === "in_progress") return "running";
  return "pending";
}
function runVis(s: string): RunVis {
  switch (s) {
    case "completed": case "succeeded": return "completed";
    case "failed": case "error": case "cancelled": case "expired": return "failed";
    case "waiting_approval": case "waiting_for_approval": case "waiting_for_connector": case "waiting_for_provider": case "paused": return "waiting";
    default: return "running";
  }
}
function runTone(c: HearthColors, vis: RunVis): { fg: string; bg: string } {
  switch (vis) {
    case "completed": return { fg: c.sage, bg: c.sageBg };
    case "failed": return { fg: c.coral, bg: c.coralBg };
    case "waiting": return { fg: c.amber, bg: c.amberBg };
    default: return { fg: c.ember, bg: c.emberBg };
  }
}

// The pinned progress card: run title + status badge, a "Step N of M" summary,
// the step list with a status glyph each, and a terminal outcome + Done control.
function LiveRunCard({ triggerName, run, onDismiss }: { triggerName: string; run: RunRec; onDismiss: () => void }) {
  const { colors, spacing } = useTheme();
  const steps = run.steps ?? [];
  const total = steps.length;
  const vis = runVis(run.status);
  const tone = runTone(colors, vis);
  const done = steps.filter((s) => stepVis(s) === "done").length;
  const activeIdx = steps.findIndex((s) => { const v = stepVis(s); return v === "running" || v === "waiting"; });
  const stepN = total === 0 ? 0 : activeIdx >= 0 ? activeIdx + 1 : vis === "completed" ? total : Math.min(done + 1, total);
  const terminal = vis === "completed" || vis === "failed";
  const failedStep = steps.find((s) => stepVis(s) === "failed");
  const label = run.status === "cancelled" ? "Cancelled"
    : vis === "completed" ? "Completed"
    : vis === "failed" ? "Failed"
    : vis === "waiting" ? "Waiting" : "Running";
  const outcome = vis === "completed"
    ? `${triggerName} finished${total ? ` — ${done} of ${total} step${total === 1 ? "" : "s"} done` : ""}.`
    : run.status === "cancelled" ? "This run was cancelled."
    : failedStep ? (failedStep.detail || `${failedStep.title} failed.`)
    : "This run didn't finish.";

  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T kind="h3" color={colors.text}>{run.title || triggerName}</T>
          <T kind="caption" color={colors.textFaint}>{total === 0 ? "Starting…" : `Step ${stepN} of ${total}`}</T>
        </View>
        <Badge label={label} fg={tone.fg} bg={tone.bg} />
        <PressableScale onPress={onDismiss} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss run progress">
          <Sym name="xmark" size={14} color={colors.textFaint} />
        </PressableScale>
      </View>

      {total === 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 }}>
          <ActivityIndicator size="small" color={colors.ember} />
          <T kind="sub">Kicking off the run…</T>
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {steps.map((s, i) => {
            const v = stepVis(s);
            return (
              <View key={s.index ?? i} style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                <View style={{ width: 20, alignItems: "center", marginTop: 1 }}>
                  {v === "running" ? <ActivityIndicator size="small" color={colors.ember} />
                    : v === "done" ? <Sym name="checkmark.circle.fill" size={16} color={colors.sage} />
                    : v === "failed" ? <Sym name="xmark.circle.fill" size={16} color={colors.coral} />
                    : v === "not_sent" ? <Sym name="envelope.badge.exclamationmark" size={16} color={colors.amber} />
                    : v === "expired" ? <Sym name="exclamationmark.triangle.fill" size={16} color={colors.amber} />
                    : v === "skipped" ? <Sym name="minus.circle.fill" size={16} color={colors.textMuted} />
                    : v === "waiting" ? <Sym name="hourglass" size={16} color={colors.amber} />
                    : <Sym name="circle" size={13} color={colors.textFaint} />}
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <T kind="subMedium" color={v === "pending" ? colors.textMuted : colors.text}>{s.title}</T>
                  {v === "waiting" ? (
                    <T kind="sub" color={colors.amber}>Waiting for approval in your Inbox</T>
                  ) : v === "not_sent" ? (
                    <T kind="sub" color={colors.amber} numberOfLines={2}>{s.detail || "Not sent — this step had no delivery tool behind it."}</T>
                  ) : v === "expired" ? (
                    <T kind="sub" color={colors.amber} numberOfLines={2}>{s.detail || "Expired — nothing was sent."}</T>
                  ) : v === "skipped" ? (
                    <T kind="sub" color={colors.textMuted} numberOfLines={2}>{s.detail || "Skipped — not permitted."}</T>
                  ) : v === "failed" && s.detail ? (
                    <T kind="sub" numberOfLines={2}>{s.detail}</T>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {vis === "waiting" ? (
        <View style={{ marginTop: 2 }}>
          <Button title="Open Inbox" icon="tray" variant="ember" small onPress={() => router.push("/inbox")} />
        </View>
      ) : terminal ? (
        <View style={{ gap: spacing.sm, marginTop: 2 }}>
          <Notice text={outcome} ok={vis === "completed"} />
          <View style={{ flexDirection: "row" }}>
            <Button title="Done" variant="neutral" small onPress={onDismiss} />
          </View>
        </View>
      ) : null}
    </Card>
  );
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
  // Live "Test run" progress: the run the fired trigger started, polled to completion.
  const [live, setLive] = useState<{ triggerName: string; run: RunRec } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false); // guard: never overlap two getRun fetches

  const load = useCallback(async () => {
    const [trs, rns, ags] = await Promise.all([api.triggers(), api.runs(), api.agents()]);
    if (trs.length === 0 && rns.length === 0 && !(await api.health())) {
      setError("The FamiliOS server didn't answer.");
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

  /* --------------------- live run polling (Test run) --------------------- */
  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => stopPoll, [stopPoll]); // clear the interval on unmount
  const dismissLive = useCallback(() => { stopPoll(); setLive(null); }, [stopPoll]);

  // Start tracking a freshly-fired run: optimistic shell, then poll every ~1.8s
  // until it's terminal or the 3-min safety deadline; refresh the lists at the end.
  const trackRun = useCallback((triggerName: string, runId: string) => {
    stopPoll();
    inFlightRef.current = false;
    setLive({ triggerName, run: { id: runId, title: triggerName, status: "running", steps: [] } });
    const deadline = Date.now() + LIVE_POLL_MAX_MS;
    const tick = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const res = await api.getRun(runId);
        if (res.run) {
          setLive({ triggerName, run: res.run });
          const v = runVis(res.run.status);
          if (v === "completed" || v === "failed") { stopPoll(); void load(); }
        }
      } finally {
        inFlightRef.current = false;
      }
      if (Date.now() > deadline) stopPoll();
    };
    void tick(); // poll immediately so the shell fills in without a 1.8s wait
    pollRef.current = setInterval(() => { void tick(); }, LIVE_POLL_MS);
  }, [stopPoll, load]);

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
    if (!r.ok) {
      setNotice({ ok: false, text: friendly(r.error, r.message) });
      return;
    }
    tapHaptic("success");
    if (r.runId) {
      // Watch the real run move step-by-step in the pinned progress card.
      trackRun(t.name, r.runId);
    } else {
      // No run id to follow (e.g. a webhook with nothing to execute) — keep the notice.
      setNotice({ ok: true, text: `${t.name}: fired.` });
      await load();
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
    Alert.alert(t.name, t.scheduleText ?? fallbackScheduleText(t), [
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

      {live ? (
        <Rise index={0}>
          <LiveRunCard triggerName={live.triggerName} run={live.run} onDismiss={dismissLive} />
        </Rise>
      ) : null}

      {triggers.length === 0 ? (
        <EmptyState
          icon="arrow.triangle.2.circlepath"
          title="No automations yet"
          hint={'Ask Famili to schedule something — like "every morning at 7, brief me on today" — and it lands here as a trigger.'}
          action={{ title: "Ask Famili", onPress: () => router.push("/(ask)") }}
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
                  <T kind="h3" color={colors.text}>{t.name}</T>
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
                  <T kind="caption" color={colors.textMuted} numberOfLines={1} style={{ flex: 1 }}>{t.scheduleText ?? fallbackScheduleText(t)}</T>
                </View>
                {t.tzSource === "server" ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Sym name="exclamationmark.triangle" size={12} color={colors.amber} />
                    <T kind="caption" color={colors.amber} numberOfLines={2} style={{ flex: 1 }}>
                      Household time zone isn't set — this uses the server's time zone instead.
                    </T>
                  </View>
                ) : null}
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
