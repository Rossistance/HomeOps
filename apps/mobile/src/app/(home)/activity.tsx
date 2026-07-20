// Activity — one timeline surface: the live client-orchestrated run (run-context),
// durable server run history (api.runs), household memory (deletable, confirmed),
// and the server audit trail.
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api, type AuditEvent, type EvolutionReviewRec, type MemoryRec, type RunRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useRevSync } from "@/lib/rev-sync";
import { useRun } from "@/lib/run-context";
import { useTheme, statusColor, riskColor, tapHaptic } from "@/theme";
import { humanDetail } from "@/lib/format";
import {
  T, Card, Badge, Button, Row, SectionHeader, SkeletonCards, ErrorState, Notice,
  Rise, HScreen, Sym, PressableScale,
} from "@/components/ui";

const RUN_LABEL: Record<string, string> = {
  running: "Running", waiting: "Waiting for approval", completed: "Completed", failed: "Failed",
};

const FILTERS = ["All", "Agents", "Approvals", "Files"] as const;
type Filter = (typeof FILTERS)[number];

function matchesFilter(e: AuditEvent, f: Filter): boolean {
  const k = `${e.type} ${e.toolId ?? ""}`.toLowerCase();
  switch (f) {
    case "Approvals": return k.includes("approv") || k.includes("decide") || k.includes("deny");
    case "Files": return k.includes("file") || k.includes("upload") || k.includes("doc");
    case "Agents": return k.includes("run") || k.includes("agent") || k.includes("tool");
    default: return true;
  }
}

function dayGroup(at: string): string {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return "Earlier";
}

function Segmented({ value, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", backgroundColor: colors.surfaceSunken, borderRadius: 12, borderCurve: "continuous", padding: 3, gap: 2 }}>
      {FILTERS.map((f) => (
        <PressableScale
          key={f}
          onPress={() => { tapHaptic("select"); onChange(f); }}
          haptic={null}
          style={{
            flex: 1, paddingVertical: 7, borderRadius: 9, borderCurve: "continuous", alignItems: "center",
            backgroundColor: value === f ? colors.surface : "transparent",
          }}
        >
          <T kind="caption" color={value === f ? colors.text : colors.textSecondary} style={{ fontSize: 12.5 }}>{f}</T>
        </PressableScale>
      ))}
    </View>
  );
}

export default function ActivityScreen() {
  const { colors, spacing } = useTheme();
  const { session } = useSession();
  const { activeRun, clearRun } = useRun();
  const canManage = session?.role === "Owner" || session?.role === "Adult Admin";
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [runs, setRuns] = useState<RunRec[]>([]);
  const [memory, setMemory] = useState<MemoryRec[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [evolutions, setEvolutions] = useState<EvolutionReviewRec[]>([]);
  const [evoBusy, setEvoBusy] = useState<string | null>(null);
  const [evoMsg, setEvoMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("All");

  const load = useCallback(async () => {
    const [h, rs, mem, ev, evos] = await Promise.all([api.health(), api.runs(), api.memory(), api.audit(20), api.evolutionReviews()]);
    setOffline(!h);
    if (h) { setRuns(rs); setMemory(mem); setAudit(ev); setEvolutions(evos); }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  useRevSync(useCallback(() => { void load(); }, [load]));
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

  // Accept applies the improvement (server versions the agent/skill); dismiss rejects it.
  // Adult Admin+ only — the server returns 403 for anyone else, surfaced inline.
  const reviewEvo = async (ev: EvolutionReviewRec, accept: boolean) => {
    setEvoBusy(ev.id); setEvoMsg(null);
    const r = await api.reviewEvolution(ev.id, accept);
    setEvoBusy(null);
    if (r.error) {
      tapHaptic("error");
      setEvoMsg({ ok: false, text: r.error === "insufficient_role" ? "Only an Owner or Adult Admin can review improvements." : r.message ?? "Couldn't save that — try again." });
      return;
    }
    if (accept && r.applyError) {
      tapHaptic("warning");
      setEvoMsg({ ok: false, text: `Accepted, but couldn't apply automatically: ${r.applyError}` });
    } else {
      tapHaptic(accept ? "success" : "select");
      setEvoMsg({ ok: true, text: accept ? (r.applied ? "Accepted and applied." : "Accepted.") : "Dismissed." });
    }
    await load();
  };
  // Dismissed proposals drop off the list; keep pending + accepted (incl. auto-applied).
  const improvements = evolutions.filter((e) => e.status !== "rejected");

  // WP-003/WP-004: a step that did NOT deliver must never read as neutral-pending.
  // `not_sent` (no delivery tool behind a send step), `skipped` (agent policy refused)
  // and `expired` (approval window closed) all land amber — the same weight as a
  // waiting gate — so a non-delivery is as visible as a success.
  const stepDot = (s: string) =>
    s === "done" ? colors.sage
      : s === "running" ? colors.ember
        : s === "blocked" || s === "not_sent" || s === "skipped" || s === "expired" ? colors.amber
          : colors.textFaint;

  // Live-run tone: running reads ember (it's ours, right now); waiting reads amber.
  const liveTone = activeRun
    ? activeRun.status === "running" ? { fg: colors.ember, bg: colors.emberBg }
      : activeRun.status === "waiting" ? { fg: colors.amber, bg: colors.amberBg }
      : statusColor(colors, activeRun.status)
    : null;

  // Collapsed by default — the newest few runs; "Show all" expands to the full dozen.
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = runs.slice(0, historyOpen ? 12 : 3);
  const hiddenRuns = Math.min(runs.length, 12) - history.length;

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
                        {humanDetail(s.output || s.detail) ? <T kind="sub" numberOfLines={2}>{humanDetail(s.output || s.detail)}</T> : null}
                      </View>
                      {s.status === "done" ? <Sym name="checkmark.circle.fill" size={15} color={colors.sage} />
                        : s.status === "blocked" ? <Sym name="pause.circle.fill" size={15} color={colors.amber} />
                        : s.status === "not_sent" ? <Sym name="exclamationmark.circle.fill" size={15} color={colors.amber} />
                          : s.status === "skipped" ? <Sym name="forward.circle.fill" size={15} color={colors.amber} />
                            : s.status === "expired" ? <Sym name="clock.badge.exclamationmark.fill" size={15} color={colors.amber} />
                              : s.status === "running" ? <Sym name="ellipsis" size={15} color={colors.ember} /> : null}
                    </View>
                  ))}
                </View>
                {activeRun.status === "waiting" ? (
                  <T kind="sub" style={{ marginTop: spacing.sm }}>Review the gated steps on Today — they're waiting in your approvals.</T>
                ) : null}
              </Card>
            </Rise>
          ) : null}

          <Rise index={1}>
            <SectionHeader
              title="Run history"
              trailing={runs.length > 3 ? (
                <PressableScale onPress={() => { tapHaptic("select"); setHistoryOpen((v) => !v); }} haptic={null} hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded: historyOpen }} accessibilityLabel={historyOpen ? "Show fewer runs" : "Show all runs"}>
                  <T kind="subMedium" color={colors.ember}>{historyOpen ? "Show less" : `Show all${hiddenRuns > 0 ? ` (${hiddenRuns} more)` : ""}`}</T>
                </PressableScale>
              ) : undefined}
            />
            {history.length === 0 ? (
              <Card><T kind="sub">No server runs yet — fire an automation or ask Famili to do something.</T></Card>
            ) : (
              <Card padded={false}>
                {history.map((r, i) => {
                  // Server step vocabulary is "succeeded" — counting only local
                  // statuses made every finished run read "0/N steps done".
                  const done = r.steps.filter((s) => ["done", "completed", "succeeded"].includes(s.status)).length;
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

          {improvements.length > 0 ? (
            <Rise index={2}>
              <SectionHeader title="Improvements" />
              {evoMsg ? <View style={{ marginBottom: spacing.sm }}><Notice text={evoMsg.text} ok={evoMsg.ok} /></View> : null}
              <View style={{ gap: spacing.sm }}>
                {improvements.map((ev) => {
                  const rc = ev.risk ? riskColor(colors, ev.risk) : null;
                  const auto = ev.status === "accepted" && ev.autoApproved;
                  return (
                    <Card key={ev.id} style={{ gap: 6 }}>
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                        <T kind="h3" color={colors.text} style={{ flex: 1 }}>{ev.title}</T>
                        {rc ? <Badge label={ev.risk!} fg={rc.fg} bg={rc.bg} /> : null}
                      </View>
                      {ev.reason ? <T kind="sub">{ev.reason}</T> : null}
                      {ev.summary && ev.summary !== ev.reason ? <T kind="sub" color={colors.textMuted}>{ev.summary}</T> : null}
                      {ev.agentName ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                          <Sym name="sparkles" size={12} color={colors.textFaint} />
                          <T kind="caption" color={colors.textMuted}>{ev.agentName}</T>
                        </View>
                      ) : null}

                      {auto ? (
                        <View style={{ gap: 4, marginTop: 2 }}>
                          <View style={{ flexDirection: "row" }}>
                            <Badge label="Auto-applied by AI" icon="sparkles" fg={colors.sky} bg={colors.skyBg} />
                          </View>
                          {ev.autoReason ? <T kind="caption" color={colors.textMuted}>{ev.autoReason}</T> : null}
                        </View>
                      ) : ev.status === "accepted" ? (
                        <View style={{ flexDirection: "row", marginTop: 2 }}>
                          <Badge label="Accepted" icon="checkmark" fg={colors.sage} bg={colors.sageBg} />
                        </View>
                      ) : canManage ? (
                        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: 4 }}>
                          <Button title="Accept" variant="success" small loading={evoBusy === ev.id} disabled={evoBusy !== null && evoBusy !== ev.id} onPress={() => void reviewEvo(ev, true)} />
                          <Button title="Dismiss" variant="ghost" small disabled={evoBusy !== null} onPress={() => void reviewEvo(ev, false)} />
                        </View>
                      ) : (
                        <View style={{ flexDirection: "row", marginTop: 2 }}>
                          <Badge label="Pending review" fg={colors.amber} bg={colors.amberBg} />
                        </View>
                      )}
                    </Card>
                  );
                })}
              </View>
            </Rise>
          ) : null}

          <Rise index={3}>
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

          <Rise index={4}>
            <SectionHeader title="Timeline" />
            <Segmented value={filter} onChange={setFilter} />
            {(() => {
              const filtered = audit.filter((e) => matchesFilter(e, filter));
              if (filtered.length === 0) {
                return <Card style={{ marginTop: spacing.md }}><T kind="sub">Nothing here yet — agent actions land in this timeline.</T></Card>;
              }
              const groups = ["Today", "Yesterday", "Earlier"].map((g) => ({
                label: g, items: filtered.filter((e) => dayGroup(e.at) === g),
              })).filter((g) => g.items.length > 0);
              return groups.map((g) => (
                <View key={g.label} style={{ gap: spacing.sm, marginTop: spacing.md }}>
                  <T kind="eyebrow">{g.label}</T>
                  <Card padded={false}>
                    {g.items.map((e, i) => (
                      <Row
                        key={e.id}
                        icon={e.ok ? "checkmark.circle.fill" : "xmark.circle.fill"}
                        iconColor={e.ok ? colors.sage : colors.coral}
                        iconBg={e.ok ? colors.sageBg : colors.coralBg}
                        title={e.toolId ? `${e.type} · ${e.toolId}` : e.type}
                        subtitle={e.actorName ?? "system"}
                        trailing={
                          <T kind="detail" color={colors.textMuted}>
                            {new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                          </T>
                        }
                        last={i === g.items.length - 1}
                      />
                    ))}
                  </Card>
                </View>
              ));
            })()}
          </Rise>

          <T kind="detail" center style={{ marginTop: spacing.sm }}>
            Everything agents do is logged here.{"\n"}Nothing leaves the household without approval.
          </T>
        </>
      )}
    </HScreen>
  );
}
