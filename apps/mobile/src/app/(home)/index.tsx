// Today — the FamiliOS front page. Role-scoped: a child, grandparent, or sitter
// login renders their calm scoped home directly (no admin dashboard); adults and
// owners get the full front page — greeting + approval count, the household
// member strip, the Ask Famili hero, the Calendar key card, the Ask-for-help
// card, quick actions, then the day at a glance: approvals needing you (and
// help requests to/from you), coming up, bills due. Server-truth via api.*.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Platform, StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type ApprovalRec, type EventRec, type EvolutionRec, type HelpRequestRec, type MemberRec, type MemoryRec, type RunRec, type TaskRec } from "@/lib/api";
import { memberColor } from "@/lib/member-colors";
import { isChild, isGrandparent, isHelper, viewModeFor } from "@/lib/roles";
import { useSession } from "@/lib/session";
import { useTheme, riskColor, tapHaptic } from "@/theme";
import {
  T, Card, Badge, SectionHeader, SkeletonCards, ErrorState, Rise, HScreen,
  Sym, SymTile, PressableScale, PressableCard, Button,
} from "@/components/ui";
import { ApprovalSheet } from "@/components/sheets/approval-sheet";
import { ChoreSheet } from "@/components/sheets/chore-sheet";
import { InviteSheet } from "@/components/sheets/invite-sheet";
import { useRevSync } from "@/lib/rev-sync";
import { KidHome } from "./kid";
import { GrandparentHome } from "./grandparent";
import { SitterHome } from "./sitter";
import { MemberAvatar } from "./profile";

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

// Role-scoped entry: resolve who is signed in FIRST, then render the home that
// matches their view mode. Children/grandparents/sitters never see the admin
// dashboard — they get their scoped experience as THE home screen.
export default function TodayScreen() {
  const { session } = useSession();
  const [me, setMe] = useState<MemberRec | null>(null);
  const [resolved, setResolved] = useState(false);
  const actorId = session?.actorId ?? null;

  useEffect(() => {
    if (!actorId) return;
    let cancelled = false;
    void api.members().then((ms) => {
      if (cancelled) return;
      setMe(ms.find((m) => m.isCurrentUser) ?? ms.find((m) => m.actorId === actorId) ?? null);
      setResolved(true);
    });
    return () => { cancelled = true; };
  }, [actorId]);

  if (!resolved || !actorId) {
    return <HScreen><SkeletonCards count={4} /></HScreen>;
  }
  const viewMode = viewModeFor(me);
  if (viewMode === "child") return <KidHome memberId={actorId} />;
  if (viewMode === "grandparent") return <GrandparentHome memberId={actorId} />;
  if (viewMode === "sitter") return <SitterHome memberId={actorId} />;
  return <AdminToday />;
}

function AdminToday() {
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
  const [memory, setMemory] = useState<MemoryRec[]>([]);
  const [evolutions, setEvolutions] = useState<EvolutionRec[]>([]);
  const [runs, setRuns] = useState<RunRec[]>([]);
  const [helpRequests, setHelpRequests] = useState<HelpRequestRec[]>([]);
  const [openApproval, setOpenApproval] = useState<ApprovalRec | null>(null);
  const [choreOpen, setChoreOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [helpBusyId, setHelpBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [h, aps, evts, tks, mem, hh, memries, evos, rns, hrs] = await Promise.all([
      api.health(), api.approvals(), api.events(), api.tasks(), api.members(), api.household(),
      api.memory(), api.evolutions(), api.runs(), api.helpRequests(),
    ]);
    setOffline(!h);
    if (h) {
      setApprovals(aps); setEvents(evts); setTasks(tks); setMembers(mem); setHouseholdName(hh?.name ?? null);
      setMemory(memries); setEvolutions(evos); setRuns(rns); setHelpRequests(hrs);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  useRevSync(useCallback(() => { void load(); }, [load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const now = new Date();
  const part = now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening";
  const first = (session?.actorName ?? "there").split(" ")[0];
  const meMember = useMemo(
    () => members.find((m) => m.isCurrentUser) ?? members.find((m) => m.actorId === session?.actorId) ?? null,
    [members, session?.actorId],
  );

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

  // Help requests to/from me — the "needs your attention" companions.
  const helpToMe = useMemo(
    () => helpRequests.filter((h) => h.status === "pending" && h.toActorId === session?.actorId),
    [helpRequests, session?.actorId],
  );
  const helpFromMe = useMemo(
    () => helpRequests.filter((h) => h.status === "pending" && h.fromActorId === session?.actorId),
    [helpRequests, session?.actorId],
  );

  const respondHelp = useCallback(async (h: HelpRequestRec, response: "accept" | "decline", note?: string) => {
    setHelpBusyId(h.id);
    const r = await api.respondHelpRequest(h.id, response, note);
    setHelpBusyId(null);
    if (r.helpRequest) { tapHaptic(response === "accept" ? "success" : "select"); void load(); }
  }, [load]);
  const declineHelp = useCallback((h: HelpRequestRec) => {
    if (Platform.OS === "ios") {
      Alert.prompt("Decline", `Add a note for ${h.fromName}? (optional)`, [
        { text: "Cancel", style: "cancel" },
        { text: "Decline", style: "destructive", onPress: (note?: string) => void respondHelp(h, "decline", note?.trim() || undefined) },
      ], "plain-text");
    } else {
      void respondHelp(h, "decline");
    }
  }, [respondHelp]);
  const cancelHelp = useCallback(async (h: HelpRequestRec) => {
    setHelpBusyId(h.id);
    await api.cancelHelpRequest(h.id);
    setHelpBusyId(null);
    void load();
  }, [load]);

  // "What I learned" — recent things Famili picked up: new memories, improvement
  // proposals waiting on review, and freshly completed runs. Newest, capped at 4.
  const learnings = useMemo(() => {
    const out: { key: string; icon: string; fg: string; bg: string; title: string; subtitle: string }[] = [];
    for (const m of [...memory].sort((a, b) => b.createdAt - a.createdAt).slice(0, 2)) {
      out.push({ key: `m-${m.id}`, icon: "lightbulb.fill", fg: colors.amber, bg: colors.amberBg, title: m.text, subtitle: `New memory · ${new Date(m.createdAt).toLocaleDateString()}` });
    }
    for (const e of evolutions.filter((e) => e.status === "pending").slice(0, 2)) {
      out.push({ key: `e-${e.id}`, icon: "wand.and.stars", fg: colors.lavender, bg: colors.lavenderBg, title: e.title || "Improvement proposal", subtitle: `Improvement proposal${e.risk ? ` · ${e.risk} risk` : ""}` });
    }
    for (const r of runs.filter((r) => ["completed", "succeeded"].includes(r.status)).slice(0, 2)) {
      const done = r.steps.filter((s) => ["done", "completed", "succeeded"].includes(s.status)).length;
      out.push({ key: `r-${r.id}`, icon: "checkmark.circle.fill", fg: colors.sage, bg: colors.sageBg, title: r.title || "Run completed", subtitle: `Completed · ${done}/${r.steps.length} step${r.steps.length === 1 ? "" : "s"}` });
    }
    return out.slice(0, 4);
  }, [memory, evolutions, runs, colors]);

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
      {/* custom header: date eyebrow + profile & activity buttons, serif greeting, approval line */}
      <Rise index={0}>
        <View style={{ paddingTop: insets.top > 0 ? 0 : spacing.md, gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <T kind="eyebrow" color={colors.ember}>
              {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </T>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <PressableScale onPress={() => router.push("/profile")} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="My profile">
                <MemberAvatar member={meMember} size={34} />
              </PressableScale>
              <PressableScale onPress={() => router.push("/activity")} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="Activity">
                <SymTile name="clock" color={colors.textSecondary} bg={colors.surfaceSunken} size={34} iconSize={16} />
              </PressableScale>
            </View>
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
          {/* member strip — everyone in their own color, photo/emoji avatars. Tapping a
              child/grandparent/sitter opens their scoped home in owner-preview mode. */}
          {members.length > 0 && (
            <Rise index={1}>
              <View style={{ flexDirection: "row", gap: spacing.lg, flexWrap: "wrap" }}>
                {members.map((m) => {
                  const dest = isChild(m) ? "/kid" : isGrandparent(m) ? "/grandparent" : isHelper(m) ? "/sitter" : null;
                  return (
                    <PressableScale
                      key={m.actorId}
                      onPress={dest ? () => router.push({ pathname: dest, params: { id: m.actorId, preview: "1" } }) : undefined}
                      disabled={!dest}
                      haptic={dest ? "select" : null}
                      style={{ alignItems: "center", gap: 5, width: 52 }}
                      accessibilityLabel={dest ? `Open ${m.displayName}'s view` : m.displayName}
                    >
                      <MemberAvatar member={m} size={48} />
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

          {/* Calendar key card — today's plans at a glance, color-coded per member,
              directly under the Ask hero. Tap anywhere to open the full calendar. */}
          <Rise index={3}>
            <PressableCard
              onPress={() => router.push("/calendar")}
              accessibilityRole="button"
              accessibilityLabel="Open calendar"
              style={{ gap: spacing.md }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <SymTile name="calendar" color={colors.ember} bg={colors.emberBg} size={36} iconSize={17} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T kind="rowTitle">Calendar</T>
                  <T kind="detail">
                    {todayEvents.length === 0
                      ? "Nothing on the calendar today"
                      : `${todayEvents.length} plan${todayEvents.length === 1 ? "" : "s"} today`}
                  </T>
                </View>
                <Sym name="chevron.right" size={13} color={colors.textFaint} />
              </View>
              {todayEvents.length === 0 ? (
                upcoming.length > 0 ? (
                  <T kind="sub">
                    Next: {upcoming[0].title} · {new Date(upcoming[0].startAt!).toLocaleDateString(undefined, { weekday: "short" })}{" "}
                    {new Date(upcoming[0].startAt!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </T>
                ) : null
              ) : (
                <View style={{ gap: 8 }}>
                  {todayEvents.slice(0, 3).map((e) => {
                    const stripe = memberColor(colors, members.find((m) => m.actorId === e.participantIds?.[0]))
                      ?? memberColor(colors, members.find((m) => m.actorId === e.ownerId))
                      ?? colors.textFaint;
                    return (
                      <View key={e.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                        <View style={{ width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: stripe }} />
                        <View style={{ flex: 1, gap: 1 }}>
                          <T kind="subMedium" color={colors.text} numberOfLines={1}>{e.title}</T>
                          {!!e.location && <T kind="detail" numberOfLines={1}>{e.location}</T>}
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          {(e.participantIds ?? []).slice(0, 4).map((pid) => {
                            const c = memberColor(colors, members.find((m) => m.actorId === pid));
                            return c ? <View key={pid} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} /> : null;
                          })}
                          <T kind="detail" color={colors.textMuted}>
                            {e.startAt ? new Date(e.startAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "All day"}
                          </T>
                        </View>
                      </View>
                    );
                  })}
                  {todayEvents.length > 3 && (
                    <T kind="detail" color={colors.ember}>+{todayEvents.length - 3} more today</T>
                  )}
                </View>
              )}
            </PressableCard>
          </Rise>

          {/* Ask for help — send a grandparent, sitter or family member a hand-off. */}
          <Rise index={4}>
            <PressableCard
              onPress={() => router.push("/help")}
              accessibilityRole="button"
              accessibilityLabel="Ask for help"
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
            >
              <SymTile name="hand.raised.fill" color={colors.lavender} bg={colors.lavenderBg} size={36} iconSize={17} />
              <View style={{ flex: 1, gap: 2 }}>
                <T kind="rowTitle">Ask for help</T>
                <T kind="detail">Ask a grandparent, sitter or family member for a hand</T>
              </View>
              <Sym name="chevron.right" size={13} color={colors.textFaint} />
            </PressableCard>
          </Rise>

          {/* quick actions — 2×3 grid; Meals + Tasks lead */}
          <Rise index={5}>
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
          <Rise index={6}>
            <SectionHeader
              title="Needs your attention"
              trailing={pending.length > 0
                ? <Badge label={String(pending.length)} fg={colors.onEmber} bg={colors.ember} />
                : <SeeAll onPress={() => router.push("/inbox")} />}
            />
            {pending.length === 0 && helpToMe.length === 0 && helpFromMe.length === 0 ? (
              <Card><T kind="sub">All caught up — nothing waiting on you.</T></Card>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {pending.length > 0 && (
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

                {/* help requests addressed to ME — accept/decline inline */}
                {helpToMe.map((h) => (
                  <Card key={h.id} style={{ gap: spacing.sm }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Sym name="hand.raised.fill" size={14} color={colors.lavender} />
                      <T kind="rowTitle" style={{ flex: 1 }} numberOfLines={1}>{h.fromName} asked for help</T>
                    </View>
                    <T kind="sub" numberOfLines={3}>{h.message}</T>
                    <View style={{ flexDirection: "row", gap: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <Button small variant="success" icon="checkmark" title="Accept" loading={helpBusyId === h.id} disabled={!!helpBusyId} onPress={() => void respondHelp(h, "accept")} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button small variant="neutral" title="Decline" disabled={!!helpBusyId} onPress={() => declineHelp(h)} />
                      </View>
                    </View>
                  </Card>
                ))}

                {/* my outgoing pending asks — waiting + cancel */}
                {helpFromMe.map((h) => (
                  <Card key={h.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                    <SymTile name="hourglass" color={colors.amber} bg={colors.amberBg} size={36} iconSize={16} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T kind="rowTitle" numberOfLines={1}>Waiting on {h.toName}…</T>
                      <T kind="detail" numberOfLines={2}>{h.message}</T>
                    </View>
                    <Button small variant="ghost" title="Cancel" loading={helpBusyId === h.id} onPress={() => void cancelHelp(h)} />
                  </Card>
                ))}
              </View>
            )}
          </Rise>

          {/* coming up */}
          {upcoming.length > 0 && (
            <Rise index={7}>
              <SectionHeader title="Coming up" />
              <Card padded={false}>
                {upcoming.map((e, i) => (
                  <PressableScale
                    key={e.id}
                    haptic="select"
                    onPress={() => router.push({ pathname: "/event-form", params: { id: e.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${e.title}`}
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
                    <Sym name="chevron.right" size={13} color={colors.textFaint} />
                  </PressableScale>
                ))}
              </Card>
            </Rise>
          )}

          {/* bills due soon */}
          {bills.length > 0 && (
            <Rise index={8}>
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

          {/* what I learned — recent memories, proposals, and completed runs */}
          {learnings.length > 0 && (
            <Rise index={9}>
              <SectionHeader title="What I learned" trailing={<SeeAll label="Activity" onPress={() => router.push("/activity")} />} />
              <Card padded={false}>
                {learnings.map((l, i) => (
                  <View
                    key={l.key}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: spacing.md,
                      paddingHorizontal: spacing.lg, paddingVertical: 13,
                      borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator,
                    }}
                  >
                    <SymTile name={l.icon} color={l.fg} bg={l.bg} size={36} iconSize={17} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T kind="rowTitle" numberOfLines={2}>{l.title}</T>
                      <T kind="detail" numberOfLines={1}>{l.subtitle}</T>
                    </View>
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
