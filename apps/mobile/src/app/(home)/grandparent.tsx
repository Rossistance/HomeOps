// Grandparent view — a calm, large-type day view for members like Grandma &
// Grandpa (parent preview from the Today member strip, and what a grandparent
// role sees as their home). Emphasis: today's family day, the week ahead, and
// their own gentle reminders. No chore gamification, bigger text everywhere.
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type EventRec, type MemberRec, type TaskRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
import { T, Card, SectionHeader, SkeletonCards, Rise, HScreen, Sym, PressableScale } from "@/components/ui";

export default function GrandparentScreen() {
  const { colors, spacing } = useTheme();
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [member, setMember] = useState<MemberRec | null>(null);
  const [events, setEvents] = useState<EventRec[]>([]);
  const [reminders, setReminders] = useState<TaskRec[]>([]);
  const [householdName, setHouseholdName] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [members, evts, tasks, hh] = await Promise.all([api.members(), api.events(), api.tasks(), api.household()]);
    setMember(members.find((m) => m.actorId === id) ?? null);
    setEvents(evts.filter((e) => e.startAt).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))));
    setReminders(tasks.filter((t) => t.assignedMemberId === id && t.status !== "done"));
    setHouseholdName(hh?.name ?? null);
    setLoading(false);
  }, [id]);
  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const first = member?.displayName.split(" ")[0] ?? "there";
  const now = new Date();
  const part = now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening";
  const todayStr = now.toDateString();
  const today = useMemo(() => events.filter((e) => new Date(e.startAt!).toDateString() === todayStr), [events, todayStr]);
  const week = useMemo(() => events.filter((e) => {
    const d = new Date(e.startAt!);
    return d.toDateString() !== todayStr && d.getTime() > now.getTime() && d.getTime() < now.getTime() + 7 * 86400000;
  }).slice(0, 5), [events, todayStr, now]);

  const completeReminder = async (t: TaskRec) => {
    tapHaptic("success");
    setReminders((list) => list.filter((x) => x.id !== t.id));
    const r = await api.updateTask(t.id, { status: "done" });
    if (r.error) { setReminders((list) => [...list, t]); }
  };

  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "All day";

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ paddingTop: insets.top > 0 ? 0 : spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <PressableScale onPress={() => router.back()} haptic="select" style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 }} accessibilityRole="button" accessibilityLabel="Back to parent view">
          <Sym name="chevron.left" size={12} color={colors.textSecondary} />
          <T kind="subMedium" color={colors.textSecondary}>Parent view</T>
        </PressableScale>
        <T kind="eyebrow">{first}'s FamiliOS</T>
      </View>

      {loading || !member ? <SkeletonCards count={3} /> : (
        <>
          <Rise index={0}>
            <View style={{ alignItems: "center", gap: 8, marginTop: spacing.sm }}>
              <View style={[st.bigAvatar, { backgroundColor: colors.lavenderBg }]}>
                <T kind="h2" color={colors.lavender}>{member.displayName.split(" ").map((p) => p[0]).slice(0, 2).join("")}</T>
              </View>
              <T kind="h1" style={{ fontSize: 30 }} center>Good {part}, {first}</T>
              <T kind="body" style={{ fontSize: 17, lineHeight: 24 }} center>
                {today.length === 0
                  ? `A quiet day${householdName ? ` for ${householdName}` : ""} — nothing on the calendar.`
                  : `${today.length} thing${today.length === 1 ? "" : "s"} on the family calendar today.`}
              </T>
            </View>
          </Rise>

          {reminders.length > 0 && (
            <Rise index={1}>
              <SectionHeader title={`For you, ${first}`} />
              <Card padded={false}>
                {reminders.map((t, i) => (
                  <PressableScale
                    key={t.id}
                    onPress={() => void completeReminder(t)}
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
                  </PressableScale>
                ))}
              </Card>
            </Rise>
          )}

          <Rise index={2}>
            <SectionHeader title="Today" />
            {today.length === 0 ? (
              <Card><T kind="body" style={{ fontSize: 16 }}>Nothing on the calendar today.</T></Card>
            ) : (
              <Card padded={false}>
                {today.map((e, i) => {
                  const mine = e.participantIds?.includes(id ?? "");
                  return (
                    <View key={e.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60, paddingHorizontal: spacing.lg, paddingVertical: 13, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator }}>
                      <T kind="subMedium" color={mine ? colors.ember : colors.textMuted} style={{ width: 78, fontSize: 15 }}>{time(e.startAt)}</T>
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
            <Rise index={3}>
              <SectionHeader title="This week" />
              <Card padded={false}>
                {week.map((e, i) => (
                  <View key={e.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.lg, paddingVertical: 12, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator }}>
                    <T kind="subMedium" color={colors.textMuted} style={{ width: 78, fontSize: 14 }}>
                      {new Date(e.startAt!).toLocaleDateString(undefined, { weekday: "short" })} {time(e.startAt)}
                    </T>
                    <T kind="rowTitle" style={{ flex: 1, fontSize: 16 }} numberOfLines={1}>{e.title}</T>
                  </View>
                ))}
              </Card>
            </Rise>
          )}

          <T kind="detail" center style={{ marginTop: spacing.sm, fontSize: 13 }}>
            The family adds things here for you —{"\n"}nothing to set up, nothing to manage.
          </T>
        </>
      )}
    </HScreen>
  );
}

const st = StyleSheet.create({
  bigAvatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
});
