// Kid view — a simplified, big-target chore checklist for one child, opened
// from their avatar on Today (parent preview). Real chores (tasks assigned to
// them) and their real events for the day.
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useSharedValue, withTiming, ZoomIn } from "react-native-reanimated";
import { api, type EventRec, type MemberRec, type TaskRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic, motion } from "@/theme";
import { T, Card, SectionHeader, SkeletonCards, Rise, HScreen, Sym, SymTile, PressableScale } from "@/components/ui";

const CHORE_ICONS: [RegExp, string][] = [
  [/pet|dog|cat|feed|fish/i, "pawprint"],
  [/dish|table|dinner|kitchen/i, "fork.knife"],
  [/school|backpack|homework|read/i, "graduationcap"],
  [/plant|water|yard/i, "sun.max"],
  [/teeth|brush|bath/i, "sparkles"],
  [/room|toy|tidy|clean|bed/i, "house"],
];
const choreIcon = (title: string) => CHORE_ICONS.find(([re]) => re.test(title))?.[1] ?? "checkmark";

function Progress({ pct }: { pct: number }) {
  const { colors } = useTheme();
  const w = useSharedValue(0);
  w.value = withTiming(pct, { duration: 400, easing: motion.easing });
  const a = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height: 10, borderRadius: 6, backgroundColor: colors.surfaceSunken, overflow: "hidden" }}>
      <Animated.View style={[{ height: 10, borderRadius: 6, backgroundColor: colors.ember }, a]} />
    </View>
  );
}

export default function KidScreen() {
  const { colors, spacing } = useTheme();
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [kid, setKid] = useState<MemberRec | null>(null);
  const [chores, setChores] = useState<TaskRec[]>([]);
  const [events, setEvents] = useState<EventRec[]>([]);

  const load = useCallback(async () => {
    const [members, tasks, evts] = await Promise.all([api.members(), api.tasks(), api.events()]);
    setKid(members.find((m) => m.actorId === id) ?? null);
    setChores(tasks.filter((t) => t.assignedMemberId === id && t.type !== "bill"));
    const today = new Date().toDateString();
    setEvents(evts.filter((e) =>
      e.startAt && new Date(e.startAt).toDateString() === today && e.participantIds?.includes(id ?? "")
    ).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))));
    setLoading(false);
  }, [id]);
  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const first = kid?.displayName.split(" ")[0] ?? "there";
  const doneCount = useMemo(() => chores.filter((c) => c.status === "done").length, [chores]);
  const allDone = chores.length > 0 && doneCount === chores.length;
  const weekday = new Date().toLocaleDateString(undefined, { weekday: "long" });

  const toggle = async (t: TaskRec) => {
    tapHaptic(t.status === "done" ? "select" : "success");
    const next = t.status === "done" ? "todo" : "done";
    setChores((list) => list.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    const r = await api.updateTask(t.id, { status: next });
    if (r.error) setChores((list) => list.map((x) => (x.id === t.id ? { ...x, status: t.status } : x)));
  };

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      {/* custom header: exit pill + kid label */}
      <View style={{ paddingTop: insets.top > 0 ? 0 : spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <PressableScale onPress={() => router.back()} haptic="select" style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 }} accessibilityRole="button" accessibilityLabel="Back to parent view">
          <Sym name="chevron.left" size={12} color={colors.textSecondary} />
          <T kind="subMedium" color={colors.textSecondary}>Parent view</T>
        </PressableScale>
        <T kind="eyebrow">{first}'s FamiliOS</T>
      </View>

      {loading || !kid ? <SkeletonCards count={3} /> : (
        <>
          <Rise index={0}>
            <View style={{ alignItems: "center", gap: 8, marginTop: spacing.sm }}>
              <View style={[st.bigAvatar, { backgroundColor: colors.emberBg }]}>
                <T kind="h2" color={colors.ember}>{kid.displayName.split(" ").map((p) => p[0]).slice(0, 2).join("")}</T>
              </View>
              <T kind="h1" style={{ fontSize: 28 }}>Hi, {first}!</T>
              <T kind="body">
                {weekday} · {allDone ? "all chores done!" : `${chores.length - doneCount} chore${chores.length - doneCount === 1 ? "" : "s"} to go`}
              </T>
            </View>
          </Rise>

          <Rise index={1}>
            {allDone ? (
              <Animated.View entering={ZoomIn.duration(450)}>
                <Card style={{ backgroundColor: colors.sageBg, borderColor: "transparent", alignItems: "center", gap: 8 }}>
                  <View style={[st.doneCheck, { backgroundColor: colors.sage }]}>
                    <Sym name="checkmark" size={26} color="#FFFFFF" />
                  </View>
                  <T kind="h2" color={colors.sage}>All done, {first}!</T>
                  <T kind="sub" center color={colors.textSecondary}>Every chore done — high five!</T>
                </Card>
              </Animated.View>
            ) : (
              <Card style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <T kind="rowTitle">Today's chores</T>
                  <T kind="subMedium" color={colors.textMuted}>{doneCount} of {chores.length} done</T>
                </View>
                <Progress pct={chores.length ? doneCount / chores.length : 0} />
              </Card>
            )}
          </Rise>

          <Rise index={2}>
            {chores.length === 0 ? (
              <Card><T kind="sub">No chores on {first}'s list yet.</T></Card>
            ) : (
              <Card padded={false}>
                {chores.map((c, i) => {
                  const isDone = c.status === "done";
                  return (
                    <PressableScale
                      key={c.id}
                      onPress={() => void toggle(c)}
                      haptic={null}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isDone }}
                      accessibilityLabel={c.title}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56,
                        paddingHorizontal: spacing.lg, paddingVertical: 12, opacity: isDone ? 0.62 : 1,
                        borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator,
                      }}
                    >
                      <View style={{
                        width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center",
                        borderWidth: isDone ? 0 : 2, borderColor: colors.textFaint,
                        backgroundColor: isDone ? colors.sage : "transparent",
                      }}>
                        {isDone && <Sym name="checkmark" size={15} color="#FFFFFF" />}
                      </View>
                      <SymTile name={choreIcon(c.title)} color={colors.ember} bg={colors.emberBg} size={40} iconSize={18} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <T kind="rowTitle" style={[{ fontSize: 15.5 }, isDone && { textDecorationLine: "line-through" }]}>{c.title}</T>
                        {!!c.dueAt && (
                          <T kind="detail">
                            {new Date(c.dueAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                          </T>
                        )}
                      </View>
                    </PressableScale>
                  );
                })}
              </Card>
            )}
          </Rise>

          {events.length > 0 && (
            <Rise index={3}>
              <SectionHeader title="Your day" />
              <Card padded={false}>
                {events.map((e, i) => (
                  <View key={e.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 13, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator }}>
                    <T kind="subMedium" color={colors.ember} style={{ width: 70 }}>
                      {new Date(e.startAt!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </T>
                    <View style={{ flex: 1, gap: 2 }}>
                      <T kind="rowTitle">{e.title}</T>
                      {!!e.location && <T kind="detail">{e.location}</T>}
                    </View>
                  </View>
                ))}
              </Card>
            </Rise>
          )}
        </>
      )}
    </HScreen>
  );
}

const st = StyleSheet.create({
  bigAvatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  doneCheck: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
});
