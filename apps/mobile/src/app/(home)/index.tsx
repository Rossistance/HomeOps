// Home dashboard — the warm front page. Greeting hero with an ember glow, then
// the day at a glance: what needs attention, today's events, open tasks, quick
// actions, and recent server activity. All data is server-truth via api.*.
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { api, type ApprovalRec, type AuditEvent, type EventRec, type MemberRec, type TaskRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
import {
  T, Card, PressableCard, cardStyle, Badge, ChipRow, Row, SectionHeader,
  SkeletonCards, ErrorState, Rise, HScreen, Sym, SymTile, PressableScale,
} from "@/components/ui";

/** Small ember text-link used as a SectionHeader trailing action. */
function SeeAll({ label = "See all", onPress }: { label?: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
      <T kind="subMedium" color={colors.ember}>{label}</T>
    </PressableScale>
  );
}

export default function HomeScreen() {
  const { colors, dark, spacing } = useTheme();
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState(0);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [events, setEvents] = useState<EventRec[]>([]);
  const [tasks, setTasks] = useState<TaskRec[]>([]);
  const [members, setMembers] = useState<MemberRec[]>([]);

  const load = useCallback(async () => {
    const [h, aps, ev, evts, tks, mem] = await Promise.all([
      api.health(), api.approvals(), api.audit(8), api.events(), api.tasks(), api.members(),
    ]);
    setOffline(!h);
    if (h) {
      setPending(aps.filter((a: ApprovalRec) => a.status === "pending").length);
      setAudit(ev); setEvents(evts); setTasks(tks); setMembers(mem);
    }
    setLoading(false);
  }, []);

  // Reload on every focus so approvals/tasks stay fresh after visiting other tabs.
  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const now = new Date();
  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const first = (session?.actorName ?? "there").split(" ")[0];
  const isAdmin = session?.role === "Owner" || session?.role === "Adult Admin";

  const nameOf = (id: string | null) =>
    id ? members.find((m) => m.actorId === id)?.displayName?.split(" ")[0] ?? null : null;

  const isToday = (iso: string | null) => {
    if (!iso) return false;
    const d = new Date(iso);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };
  const today = events
    .filter((e) => isToday(e.startAt))
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
  const openTasks = tasks.filter((t) => t.status !== "done").slice(0, 5);
  const recent = audit.slice(0, 5);

  // Optimistic complete; server is truth — roll back if it says no (e.g. role gate).
  const completeTask = async (t: TaskRec) => {
    tapHaptic("success");
    setTasks((list) => list.map((x) => (x.id === t.id ? { ...x, status: "done" } : x)));
    const r = await api.updateTask(t.id, { status: "done" });
    if (r.error) {
      tapHaptic("error");
      setTasks((list) => list.map((x) => (x.id === t.id ? { ...x, status: t.status } : x)));
    }
  };

  const actions = [
    { title: "Ask HomeOps", sub: "Plan, draft, summarize", icon: "sparkles", fg: colors.ember, bg: colors.emberBg, go: () => router.push("/(ask)") },
    { title: "Add event", sub: "Put it on the calendar", icon: "calendar.badge.plus", fg: colors.sky, bg: colors.skyBg, go: () => router.push("/event-form") },
    { title: "Meals", sub: "This week's plan", icon: "fork.knife", fg: colors.sage, bg: colors.sageBg, go: () => router.push("/meals") },
    { title: "Tasks", sub: "Chores, bills, errands", icon: "checklist", fg: colors.lavender, bg: colors.lavenderBg, go: () => router.push("/tasks") },
  ];

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      {/* Greeting hero — an ember glow rising from the corner of a normal card.
          The gradient fades to transparent so it stays tasteful in both modes. */}
      <Rise index={0}>
        <View style={[cardStyle(colors, dark), { overflow: "hidden", padding: spacing.xl }]}>
          <LinearGradient
            colors={[colors.emberBg, "transparent"] as const}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <T kind="eyebrow">{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</T>
          <T kind="h1" style={{ marginTop: 6 }}>Good {part}, {first}</T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.sm }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: offline ? colors.amber : loading ? colors.textFaint : colors.sage }} />
            <T kind="sub">
              {loading ? "Checking the hearth…" : offline ? "Runtime offline" : "Runtime online"}
              {session?.role ? ` · ${session.role}` : ""}
            </T>
          </View>
        </View>
      </Rise>

      {loading ? (
        <SkeletonCards count={4} />
      ) : offline ? (
        <Rise index={1}>
          <ErrorState
            message={`Can't reach the backend at ${api.url}. Make sure "npm run dev" is running on your PC and you're on the same Wi-Fi (see apps/mobile/MOBILE_SETUP.md).`}
            onRetry={() => { setLoading(true); void load(); }}
          />
        </Rise>
      ) : (
        <>
          <Rise index={1}>
            <SectionHeader title="Needs your attention" />
            <PressableCard
              onPress={() => router.push("/(inbox)")}
              accessibilityRole="button"
              accessibilityLabel={pending > 0 ? `${pending} approvals waiting, open inbox` : "Nothing waiting, open inbox"}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <SymTile
                  name={pending > 0 ? "bell.badge.fill" : "checkmark.seal.fill"}
                  color={pending > 0 ? colors.amber : colors.sage}
                  bg={pending > 0 ? colors.amberBg : colors.sageBg}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <T kind="bodyMedium" color={colors.text}>
                    {pending > 0 ? `${pending} approval${pending === 1 ? "" : "s"} waiting` : "Nothing waiting on you"}
                  </T>
                  <T kind="sub">
                    {pending > 0 ? "Agents are paused until you decide." : "Approvals will land here when agents need you."}
                  </T>
                </View>
                {pending > 0 ? <Badge label={String(pending)} fg={colors.amber} bg={colors.amberBg} /> : null}
                <Sym name="chevron.right" size={13} color={colors.textFaint} />
              </View>
            </PressableCard>
          </Rise>

          <Rise index={2}>
            <SectionHeader title="Today" trailing={<SeeAll label="Calendar" onPress={() => router.push("/(calendar)")} />} />
            {today.length === 0 ? (
              <Card><T kind="sub">Nothing on the calendar today.</T></Card>
            ) : (
              <Card padded={false}>
                {today.map((e, i) => {
                  const driver = nameOf(e.driverId);
                  const hasChips = !!driver || e.whatToBring?.length > 0 || e.layer !== "canonical";
                  return (
                    <View
                      key={e.id}
                      style={{
                        paddingHorizontal: spacing.lg, paddingVertical: 12, gap: 6,
                        borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border,
                      }}
                    >
                      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
                        <T kind="bodyMedium" color={colors.text} numberOfLines={2} style={{ flex: 1 }}>{e.title}</T>
                        <T kind="subMedium" color={colors.textMuted}>
                          {e.startAt ? new Date(e.startAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "All day"}
                        </T>
                      </View>
                      {e.location ? <T kind="sub" numberOfLines={1}>{e.location}</T> : null}
                      {hasChips ? (
                        <ChipRow>
                          {driver ? <Badge icon="car.fill" label={`Driver: ${driver}`} fg={colors.sky} bg={colors.skyBg} /> : null}
                          {e.whatToBring?.length > 0 ? <Badge icon="bag.fill" label={`Bring ${e.whatToBring.length}`} fg={colors.amber} bg={colors.amberBg} /> : null}
                          {e.layer !== "canonical" ? <Badge icon="arrow.triangle.2.circlepath" label="Synced" fg={colors.textMuted} bg={colors.surfaceSunken} /> : null}
                        </ChipRow>
                      ) : null}
                    </View>
                  );
                })}
              </Card>
            )}
          </Rise>

          <Rise index={3}>
            <SectionHeader title="Open tasks" trailing={<SeeAll onPress={() => router.push("/tasks")} />} />
            {openTasks.length === 0 ? (
              <Card><T kind="sub">You&apos;re all caught up.</T></Card>
            ) : (
              <Card padded={false}>
                {openTasks.map((t, i) => {
                  const who = nameOf(t.assignedMemberId);
                  const meta = [
                    t.type,
                    who,
                    t.dueAt ? `due ${new Date(t.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : null,
                    t.type === "bill" && t.amount != null ? `$${t.amount}` : null,
                  ].filter(Boolean).join(" · ");
                  return (
                    <View
                      key={t.id}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: spacing.md,
                        paddingHorizontal: spacing.lg, paddingVertical: 12,
                        borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border,
                      }}
                    >
                      {/* completeTask fires its own haptic, so the pressable stays silent */}
                      <PressableScale
                        onPress={() => void completeTask(t)}
                        haptic={null}
                        hitSlop={10}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: false }}
                        accessibilityLabel={`Mark ${t.title} done`}
                      >
                        <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.textFaint }} />
                      </PressableScale>
                      <View style={{ flex: 1, gap: 2 }}>
                        <T kind="bodyMedium" color={colors.text} numberOfLines={2}>{t.title}</T>
                        {meta ? <T kind="sub">{meta}</T> : null}
                      </View>
                    </View>
                  );
                })}
              </Card>
            )}
          </Rise>

          <Rise index={4}>
            <SectionHeader title="Quick actions" />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
              {actions.map((a) => (
                <PressableCard
                  key={a.title}
                  onPress={a.go}
                  accessibilityRole="button"
                  accessibilityLabel={a.title}
                  style={{ flexGrow: 1, flexBasis: "40%" }}
                >
                  <SymTile name={a.icon} color={a.fg} bg={a.bg} />
                  <T kind="bodyMedium" color={colors.text} style={{ marginTop: spacing.sm }}>{a.title}</T>
                  <T kind="sub">{a.sub}</T>
                </PressableCard>
              ))}
            </View>
          </Rise>

          <Rise index={5}>
            <SectionHeader title="Recent activity" trailing={<SeeAll onPress={() => router.push("/activity")} />} />
            {recent.length === 0 ? (
              <Card>
                <T kind="sub">No recent server activity{!isAdmin ? " (admins see the full audit trail)" : ""}.</T>
              </Card>
            ) : (
              <Card padded={false}>
                {recent.map((e, i) => (
                  <Row
                    key={e.id}
                    icon={e.ok ? "checkmark.circle.fill" : "xmark.circle.fill"}
                    iconColor={e.ok ? colors.sage : colors.coral}
                    iconBg={e.ok ? colors.sageBg : colors.coralBg}
                    title={e.toolId ? `${e.type} · ${e.toolId}` : e.type}
                    subtitle={`${e.actorName ?? "system"} · ${new Date(e.at).toLocaleTimeString()}`}
                    trailing={!e.ok ? <Badge label="Failed" fg={colors.coral} bg={colors.coralBg} /> : undefined}
                    last={i === recent.length - 1}
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
