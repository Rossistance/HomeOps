// Today — the FamiliOS front page. Greeting + approval count, the household
// member strip, the Ask Famili hero, quick actions, then the day at a glance:
// approvals needing you, today's events, coming up, bills due. Server-truth
// via api.*; approvals open the signature Approval sheet.
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type ApprovalRec, type EventRec, type MemberRec, type TaskRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, riskColor } from "@/theme";
import {
  T, Card, Badge, SectionHeader, SkeletonCards, ErrorState, Rise, HScreen,
  Sym, SymTile, PressableScale, PressableCard,
} from "@/components/ui";
import { ApprovalSheet } from "@/components/sheets/approval-sheet";
import { ChoreSheet, isKidMember } from "@/components/sheets/chore-sheet";
import { InviteSheet } from "@/components/sheets/invite-sheet";
import { useRevSync } from "@/lib/rev-sync";

const isGrandparent = (m: MemberRec) => /grand(parent|ma|pa|mother|father)/i.test(m.relationship ?? "");

function SeeAll({ label = "See all", onPress }: { label?: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
      <T kind="subMedium" color={colors.ember}>{label}</T>
    </PressableScale>
  );
}

function approvalIcon(a: ApprovalRec): string {
  const k = `${a.toolId} ${a.category}`.toLowerCase();
  if (k.includes("mail") || k.includes("email")) return "envelope";
  if (k.includes("sms") || k.includes("text") || k.includes("message")) return "paperplane";
  if (k.includes("calendar") || k.includes("event")) return "calendar";
  return "checkmark.shield";
}

const KID_TINTS = ["coral", "sky", "amber", "lavender"] as const;

export default function TodayScreen() {
  const { colors, spacing } = useTheme();
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalRec[]>([]);
  const [events, setEvents] = useState<EventRec[]>([]);
  const [tasks, setTasks] = useState<TaskRec[]>([]);
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [openApproval, setOpenApproval] = useState<ApprovalRec | null>(null);
  const [choreOpen, setChoreOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [householdName, setHouseholdName] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [h, aps, evts, tks, mem, hh] = await Promise.all([
      api.health(), api.approvals(), api.events(), api.tasks(), api.members(), api.household(),
    ]);
    setOffline(!h);
    if (h) { setApprovals(aps); setEvents(evts); setTasks(tks); setMembers(mem); setHouseholdName(hh?.name ?? null); }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  useRevSync(useCallback(() => { void load(); }, [load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const now = new Date();
  const part = now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening";
  const first = (session?.actorName ?? "there").split(" ")[0];

  const pending = useMemo(() => approvals.filter((a) => a.status === "pending"), [approvals]);
  const isToday = (iso: string | null) => {
    if (!iso) return false;
    const d = new Date(iso);
    return d.toDateString() === now.toDateString();
  };
  const todayEvents = events.filter((e) => isToday(e.startAt)).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
  const upcoming = events
    .filter((e) => e.startAt && !isToday(e.startAt) && new Date(e.startAt).getTime() > now.getTime())
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
    .slice(0, 3);
  const bills = tasks.filter((t) => t.type === "bill" && t.status !== "done").slice(0, 4);
  const hasGroceries = tasks.some((t) => t.type === "list" && t.listName === "Groceries");

  // Meals and Tasks sit up front (not buried in Settings) — the two most-used
  // everyday surfaces after the calendar.
  const quickActions = [
    { title: "Meals", icon: "fork.knife", fg: colors.sage, bg: colors.sageBg, go: () => router.push("/meals") },
    { title: "Tasks & Lists", icon: "checklist", fg: colors.lavender, bg: colors.lavenderBg, go: () => router.push("/tasks") },
    { title: "Assign chore", icon: "checkmark", fg: colors.amber, bg: colors.amberBg, go: () => setChoreOpen(true) },
    { title: "New agent", icon: "plus", fg: colors.ember, bg: colors.emberBg, go: () => router.push("/(agents)?create=1") },
    { title: "Upload", icon: "square.and.arrow.up", fg: colors.sky, bg: colors.skyBg, go: () => router.push("/(library)?upload=1") },
    { title: "Connect", icon: "link", fg: colors.textMuted, bg: colors.surfaceSunken, go: () => router.push("/connections") },
  ];

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      {/* custom header: date eyebrow + activity button, serif greeting, approval line */}
      <Rise index={0}>
        <View style={{ paddingTop: insets.top > 0 ? 0 : spacing.md, gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <T kind="eyebrow" color={colors.ember}>
              {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </T>
            <PressableScale onPress={() => router.push("/activity")} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="Activity">
              <SymTile name="clock" color={colors.textSecondary} bg={colors.surfaceSunken} size={34} iconSize={16} />
            </PressableScale>
          </View>
          <T kind="h1" style={{ fontSize: 32, lineHeight: 38 }}>Good {part}, {first}</T>
          <T kind="body">
            {offline ? "Can't reach your household right now."
              : pending.length > 0 ? `${pending.length} thing${pending.length === 1 ? "" : "s"} need${pending.length === 1 ? "s" : ""} your approval today.`
              : "Nothing needs your approval right now."}
          </T>
        </View>
      </Rise>

      {loading ? (
        <SkeletonCards count={4} />
      ) : offline ? (
        <Rise index={1}>
          <ErrorState
            message={`Can't reach the backend at ${api.url}. Make sure the server is running and reachable.`}
            onRetry={() => { setLoading(true); void load(); }}
          />
        </Rise>
      ) : (
        <>
          {/* member strip */}
          {members.length > 0 && (
            <Rise index={1}>
              <View style={{ flexDirection: "row", gap: spacing.lg, flexWrap: "wrap" }}>
                {members.map((m, i) => {
                  const kid = isKidMember(m);
                  const gp = !kid && isGrandparent(m);
                  const tint = kid ? KID_TINTS[i % KID_TINTS.length] : gp ? "lavender" : "ember";
                  const fg = tint === "ember" ? colors.ember : colors[tint];
                  const bg = tint === "ember" ? colors.emberBg : colors[`${tint}Bg`];
                  const initials = m.displayName.split(" ").map((p) => p[0]).slice(0, 2).join("");
                  const dest = kid ? "/kid" : gp ? "/grandparent" : null;
                  return (
                    <PressableScale
                      key={m.actorId}
                      onPress={dest ? () => router.push({ pathname: dest, params: { id: m.actorId } }) : undefined}
                      disabled={!dest}
                      haptic={dest ? "select" : null}
                      style={{ alignItems: "center", gap: 5, width: 52 }}
                      accessibilityLabel={dest ? `Open ${m.displayName}'s view` : m.displayName}
                    >
                      <View style={[st.avatar, { backgroundColor: bg }]}>
                        <T kind="subMedium" color={fg} style={{ fontWeight: "600" }}>{initials}</T>
                      </View>
                      <T kind="detail" numberOfLines={1}>{m.displayName.split(" ")[0]}</T>
                    </PressableScale>
                  );
                })}
                <PressableScale
                  onPress={() => setInviteOpen(true)}
                  haptic="select"
                  style={{ alignItems: "center", gap: 5, width: 52 }}
                  accessibilityLabel="Invite someone"
                >
                  <View style={[st.avatar, { borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.textFaint }]}>
                    <Sym name="plus" size={18} color={colors.textMuted} />
                  </View>
                  <T kind="detail">Invite</T>
                </PressableScale>
              </View>
            </Rise>
          )}

          {/* Ask Famili hero */}
          <Rise index={2}>
            <PressableScale onPress={() => router.push("/(ask)")} accessibilityRole="button" accessibilityLabel="Ask Famili">
              <LinearGradient
                colors={[colors.hero1, colors.hero2]}
                start={{ x: 0.1, y: 0 }} end={{ x: 0.75, y: 1 }}
                style={{
                  borderRadius: 22, borderCurve: "continuous", padding: spacing.xl, gap: 10, overflow: "hidden",
                  boxShadow: "0 18px 40px -20px rgba(21,26,38,0.55)",
                }}
              >
                <View style={st.heroGlow} pointerEvents="none" />
                <T kind="eyebrow" color="rgba(245,241,233,0.55)">Ask Famili</T>
                <T kind="hero" color={colors.heroText}>What can I take off your plate today?</T>
                <View style={st.heroInput}>
                  <T kind="sub" color="rgba(245,241,233,0.5)" style={{ flex: 1 }} numberOfLines={1}>
                    Plan a birthday, draft an email…
                  </T>
                  <View style={[st.sendCircle, { backgroundColor: colors.ember }]}>
                    <Sym name="paperplane.fill" size={15} color={colors.onEmber} />
                  </View>
                </View>
              </LinearGradient>
            </PressableScale>
          </Rise>

          {/* quick actions — 2×3 grid; Meals + Tasks lead */}
          <Rise index={3}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {quickActions.map((a) => (
                <PressableCard key={a.title} onPress={a.go} padded={false} style={{ flexBasis: "30%", flexGrow: 1, alignItems: "center", paddingVertical: 12, gap: 7 }} accessibilityRole="button" accessibilityLabel={a.title}>
                  <SymTile name={a.icon} color={a.fg} bg={a.bg} size={40} iconSize={18} />
                  <T kind="detail" color={colors.textSecondary} numberOfLines={1} style={{ fontSize: 11.5 }}>{a.title}</T>
                </PressableCard>
              ))}
            </View>
          </Rise>

          {/* needs your attention */}
          <Rise index={4}>
            <SectionHeader
              title="Needs your attention"
              trailing={pending.length > 0
                ? <Badge label={String(pending.length)} fg={colors.onEmber} bg={colors.ember} />
                : <SeeAll onPress={() => router.push("/inbox")} />}
            />
            {pending.length === 0 ? (
              <Card><T kind="sub">All caught up — nothing waiting on you.</T></Card>
            ) : (
              <Card padded={false}>
                {pending.slice(0, 5).map((a, i) => {
                  const risk = riskColor(colors, a.risk);
                  const title = a.preview.split("\n").find((l) => l.trim()) ?? a.toolId;
                  return (
                    <PressableScale
                      key={a.id}
                      onPress={() => setOpenApproval(a)}
                      haptic="select"
                      accessibilityRole="button"
                      accessibilityLabel={`Review approval: ${title}`}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: spacing.md,
                        paddingHorizontal: spacing.lg, paddingVertical: 13,
                        borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator,
                      }}
                    >
                      <SymTile name={approvalIcon(a)} color={risk.fg} bg={risk.bg} size={36} iconSize={17} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <T kind="rowTitle" numberOfLines={1}>{title}</T>
                        <T kind="detail">{a.category || a.toolId} · {a.risk} risk</T>
                      </View>
                      <Sym name="chevron.right" size={13} color={colors.textFaint} />
                    </PressableScale>
                  );
                })}
                {pending.length > 5 && (
                  <PressableScale onPress={() => router.push("/inbox")} style={{ padding: spacing.md, alignItems: "center" }}>
                    <T kind="subMedium" color={colors.ember}>See all {pending.length}</T>
                  </PressableScale>
                )}
              </Card>
            )}
          </Rise>

          {/* today */}
          <Rise index={5}>
            <SectionHeader title="Today" trailing={<SeeAll label="Calendar" onPress={() => router.push("/calendar")} />} />
            {todayEvents.length === 0 ? (
              <Card><T kind="sub">Nothing on the calendar today.</T></Card>
            ) : (
              <Card padded={false}>
                {todayEvents.map((e, i) => {
                  const grocery = hasGroceries && /grocer/i.test(e.title);
                  return (
                    <PressableScale
                      key={e.id}
                      onPress={grocery ? () => router.push("/groceries") : undefined}
                      disabled={!grocery}
                      haptic={grocery ? "select" : null}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: spacing.md,
                        paddingHorizontal: spacing.lg, paddingVertical: 13,
                        borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator,
                      }}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <T kind="rowTitle" numberOfLines={2}>{e.title}</T>
                        {!!e.location && <T kind="detail" numberOfLines={1}>{e.location}</T>}
                      </View>
                      <T kind="subMedium" color={colors.textMuted}>
                        {e.startAt ? new Date(e.startAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "All day"}
                      </T>
                      {grocery && <Sym name="chevron.right" size={13} color={colors.textFaint} />}
                    </PressableScale>
                  );
                })}
              </Card>
            )}
          </Rise>

          {/* coming up */}
          {upcoming.length > 0 && (
            <Rise index={6}>
              <SectionHeader title="Coming up" />
              <Card padded={false}>
                {upcoming.map((e, i) => (
                  <View
                    key={e.id}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: spacing.md,
                      paddingHorizontal: spacing.lg, paddingVertical: 13,
                      borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator,
                    }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <T kind="rowTitle" numberOfLines={1}>{e.title}</T>
                      <T kind="detail" numberOfLines={1}>
                        {new Date(e.startAt!).toLocaleDateString(undefined, { weekday: "short" })}
                        {" · "}
                        {new Date(e.startAt!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        {e.location ? ` · ${e.location}` : ""}
                      </T>
                    </View>
                  </View>
                ))}
              </Card>
            </Rise>
          )}

          {/* bills due soon */}
          {bills.length > 0 && (
            <Rise index={7}>
              <SectionHeader title="Bills due soon" trailing={<SeeAll onPress={() => router.push("/tasks")} />} />
              <Card padded={false}>
                {bills.map((b, i) => (
                  <View
                    key={b.id}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: spacing.md,
                      paddingHorizontal: spacing.lg, paddingVertical: 13,
                      borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator,
                    }}
                  >
                    <SymTile name="tag" color={colors.amber} bg={colors.amberBg} size={36} iconSize={17} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T kind="rowTitle" numberOfLines={1}>{b.title}</T>
                      {!!b.dueAt && (
                        <T kind="detail">Due {new Date(b.dueAt).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</T>
                      )}
                    </View>
                    {b.amount != null && <T kind="rowTitle">${b.amount.toFixed(2)}</T>}
                  </View>
                ))}
              </Card>
            </Rise>
          )}
        </>
      )}

      <ApprovalSheet
        approval={openApproval}
        visible={!!openApproval}
        onClose={() => setOpenApproval(null)}
        onDecided={() => void load()}
      />
      <ChoreSheet visible={choreOpen} onClose={() => setChoreOpen(false)} members={members} onAssigned={() => void load()} />
      <InviteSheet visible={inviteOpen} onClose={() => setInviteOpen(false)} householdName={householdName} onInvited={() => void load()} />
    </HScreen>
  );
}

const st = StyleSheet.create({
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  heroGlow: {
    position: "absolute", right: -50, bottom: -50, width: 160, height: 160, borderRadius: 160,
    backgroundColor: "rgba(224,102,44,0.25)", boxShadow: "0 0 50px 35px rgba(224,102,44,0.25)",
  },
  heroInput: {
    flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4,
    backgroundColor: "rgba(245,241,233,0.08)", borderRadius: 999, paddingLeft: 16, padding: 5,
  },
  sendCircle: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
});
