// Sitter view — what a Guest/Helper (babysitter, nanny, caregiver) sees as their
// home, and the parent-preview screen from the Today member strip (preview=1
// shows the back pill). Calm, large-type layout like the grandparent view:
// today's family schedule + the week ahead (read-only), the tasks the family
// assigned to them (with a complete button), and "Can you help?" requests.
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type EventRec, type HelpRequestRec, type MemberRec, type TaskRec } from "@/lib/api";
import { coversDay, eventTimeLabel } from "@/lib/event-days";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
import { T, Coach, Card, SectionHeader, SkeletonCards, Rise, HScreen, Sym, SymTile, PressableScale } from "@/components/ui";
import { HelpRequestsSection } from "./grandparent";
import { MemberAvatar } from "./profile";

export function SitterHome({ memberId, preview = false }: { memberId: string; preview?: boolean }) {
  const { colors, spacing } = useTheme();
  const { session, signOut } = useSession();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [member, setMember] = useState<MemberRec | null>(null);
  const [events, setEvents] = useState<EventRec[]>([]);
  const [assigned, setAssigned] = useState<TaskRec[]>([]);
  const [allTasks, setAllTasks] = useState<TaskRec[]>([]);
  const [helpRequests, setHelpRequests] = useState<HelpRequestRec[]>([]);
  const [householdName, setHouseholdName] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [members, evts, tasks, hh, hrs] = await Promise.all([api.members(), api.events(), api.tasks(), api.household(), api.helpRequests()]);
    setMember(members.find((m) => m.actorId === memberId) ?? null);
    setEvents(evts.filter((e) => e.startAt).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))));
    setAssigned(tasks.filter((t) => t.assignedMemberId === memberId && t.status !== "done"));
    setAllTasks(tasks);
    setHelpRequests(hrs);
    setHouseholdName(hh?.name ?? null);
    setLoading(false);
  }, [memberId]);
  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const first = member?.displayName.split(" ")[0] ?? "there";
  const now = new Date();
  const part = now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening";
  const todayStr = now.toDateString();
  // Multi-day events (ISS-004) count as "today" on every spanned day.
  const today = useMemo(() => events.filter((e) => coversDay(e, now)), [events, now]);
  const week = useMemo(() => events.filter((e) => {
    const d = new Date(e.startAt!);
    return d.toDateString() !== todayStr && d.getTime() > now.getTime() && d.getTime() < now.getTime() + 7 * 86400000;
  }).slice(0, 5), [events, todayStr, now]);

  // Status-only self-update — the server allows completing your own assigned tasks.
  const completeTask = async (t: TaskRec) => {
    tapHaptic("success");
    setAssigned((list) => list.filter((x) => x.id !== t.id));
    const r = await api.updateTask(t.id, { status: "done" });
    if (r.error) { setAssigned((list) => [...list, t]); }
  };

  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "All day";

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ paddingTop: insets.top > 0 ? 0 : spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        {preview ? (
          <PressableScale onPress={() => router.back()} haptic="select" style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 }} accessibilityRole="button" accessibilityLabel="Back to parent view">
            <Sym name="chevron.left" size={12} color={colors.textSecondary} />
            <T kind="subMedium" color={colors.textSecondary}>Parent view</T>
          </PressableScale>
        ) : (
          <PressableScale onPress={() => router.push("/profile")} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="My profile">
            <MemberAvatar member={member} size={40} />
          </PressableScale>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <T kind="eyebrow">{first}'s FamiliOS</T>
          {/* Real login (not parent preview) needs a way out — no Settings tab on
              scoped homes, so switch profile / sign out lives in the header. */}
          {!preview && (
            <PressableScale onPress={() => void signOut()} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="Switch profile">
              <SymTile name="rectangle.portrait.and.arrow.right" color={colors.textSecondary} bg={colors.surfaceSunken} size={34} iconSize={16} />
            </PressableScale>
          )}
        </View>
      </View>

      {loading || !member ? <SkeletonCards count={3} /> : (
        <>
          <Rise index={0}>
            <View style={{ alignItems: "center", gap: 8, marginTop: spacing.sm }}>
              <MemberAvatar member={member} size={56} ringWidth={2} />
              <T kind="h1" style={{ fontSize: 30 }} center>Good {part}, {first}</T>
              <T kind="body" style={{ fontSize: 17, lineHeight: 24 }} center>
                {today.length === 0
                  ? `A quiet day${householdName ? ` for ${householdName}` : ""} — nothing on the calendar.`
                  : `${today.length} thing${today.length === 1 ? "" : "s"} on the family calendar today.`}
              </T>
            </View>
          </Rise>

          <Rise index={1}>
            <HelpRequestsSection memberId={memberId} requests={helpRequests} events={events} tasks={allTasks} onChanged={load} />
          </Rise>

          {assigned.length > 0 && (
            <Rise index={2}>
              <SectionHeader title="Assigned to you" />
              <Coach id="scoped.mine"><Card padded={false}>
                {assigned.map((t, i) => (
                  <PressableScale
                    key={t.id}
                    onPress={() => void completeTask(t)}
                    haptic={null}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: false }}
                    accessibilityLabel={`Mark done: ${t.title}`}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64,
                      paddingHorizontal: spacing.lg, paddingVertical: 14,
                      borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator,
                    }}
                  >
                    <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: colors.textFaint }} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T kind="rowTitle" style={{ fontSize: 17 }}>{t.title}</T>
                      {!!t.dueAt && <T kind="sub">{new Date(t.dueAt).toLocaleDateString(undefined, { weekday: "long" })} · {time(t.dueAt)}</T>}
                    </View>
                    <T kind="detail" color={colors.textFaint}>Tap when done</T>
                  </PressableScale>
                ))}
              </Card></Coach>
            </Rise>
          )}

          <Rise index={3}>
            <SectionHeader title="Today" />
            {today.length === 0 ? (
              <Card><T kind="body" style={{ fontSize: 16 }}>Nothing on the calendar today.</T></Card>
            ) : (
              <Card padded={false}>
                {today.map((e, i) => {
                  const mine = e.participantIds?.includes(memberId);
                  return (
                    <View key={e.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60, paddingHorizontal: spacing.lg, paddingVertical: 13, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator }}>
                      <T kind="subMedium" color={mine ? colors.ember : colors.textMuted} style={{ width: 78, fontSize: 15 }}>{eventTimeLabel(e)}</T>
                      <View style={{ flex: 1, gap: 2 }}>
                        <T kind="rowTitle" style={{ fontSize: 17 }}>{e.title}{mine ? " — with you" : ""}</T>
                        {!!e.location && <T kind="sub" style={{ fontSize: 14 }}>{e.location}</T>}
                      </View>
                    </View>
                  );
                })}
              </Card>
            )}
          </Rise>

          {week.length > 0 && (
            <Rise index={4}>
              <SectionHeader title="This week" />
              <Card padded={false}>
                {week.map((e, i) => (
                  <View key={e.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.lg, paddingVertical: 12, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator }}>
                    <T kind="subMedium" color={colors.textMuted} style={{ width: 78, fontSize: 14 }}>
                      {new Date(e.startAt!).toLocaleDateString(undefined, { weekday: "short" })} {eventTimeLabel(e)}
                    </T>
                    <T kind="rowTitle" style={{ flex: 1, fontSize: 16 }}>{e.title}</T>
                  </View>
                ))}
              </Card>
            </Rise>
          )}

          {!preview && (
            <PressableScale onPress={() => router.push("/help")} haptic="select" style={{ alignItems: "center", marginTop: spacing.sm }} accessibilityRole="button" accessibilityLabel="Ask or offer help">
              <T kind="subMedium" color={colors.ember}>Ask or offer help</T>
            </PressableScale>
          )}

          <T kind="detail" center style={{ marginTop: spacing.sm, fontSize: 13 }}>
            The family shares today's plan with you —{"\n"}nothing to set up, nothing to manage.
          </T>
        </>
      )}
    </HScreen>
  );
}

export default function SitterScreen() {
  const { session } = useSession();
  const { id, preview } = useLocalSearchParams<{ id?: string; preview?: string }>();
  // No id param = a real sitter login landing here; default to the session actor.
  const memberId = id ?? session?.actorId ?? "";
  return <SitterHome memberId={memberId} preview={preview === "1"} />;
}
