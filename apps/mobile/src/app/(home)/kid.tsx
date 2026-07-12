// Kid view — a simplified, big-target chore checklist for one child. It's both
// what a child-role login sees as their home (Today renders KidHome directly)
// and the parent-preview screen opened from the Today avatar strip (preview=1
// shows the "Parent view" back pill). Real chores, the family's real schedule
// for today, and who's helping (accepted help requests linked to today's plans).
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useSharedValue, withTiming, ZoomIn } from "react-native-reanimated";
import { api, type EventRec, type HelpRequestRec, type MemberRec, type TaskRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic, motion } from "@/theme";
import { T, Card, SectionHeader, SkeletonCards, Rise, HScreen, Sym, SymTile, PressableScale } from "@/components/ui";
import { MemberAvatar } from "./profile";

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

export function KidHome({ memberId, preview = false }: { memberId: string; preview?: boolean }) {
  const { colors, spacing } = useTheme();
  const { session, signOut } = useSession();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [kid, setKid] = useState<MemberRec | null>(null);
  const [chores, setChores] = useState<TaskRec[]>([]);
  const [events, setEvents] = useState<EventRec[]>([]);
  const [helpRequests, setHelpRequests] = useState<HelpRequestRec[]>([]);

  const load = useCallback(async () => {
    const [members, tasks, evts, hrs] = await Promise.all([api.members(), api.tasks(), api.events(), api.helpRequests()]);
    setKid(members.find((m) => m.actorId === memberId) ?? null);
    setChores(tasks.filter((t) => t.assignedMemberId === memberId && t.type !== "bill"));
    // The whole family's day (read-only) — the kid sees where everyone is going.
    const today = new Date().toDateString();
    setEvents(evts.filter((e) => e.startAt && new Date(e.startAt).toDateString() === today)
      .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))));
    setHelpRequests(hrs);
    setLoading(false);
  }, [memberId]);
  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const first = kid?.displayName.split(" ")[0] ?? "there";
  const doneCount = useMemo(() => chores.filter((c) => c.status === "done").length, [chores]);
  const allDone = chores.length > 0 && doneCount === chores.length;
  const weekday = new Date().toLocaleDateString(undefined, { weekday: "long" });

  // "Who's helping you" — accepted help requests linked to one of today's events
  // (e.g. "Grandma is helping — Soccer practice").
  const helpers = useMemo(() => {
    const byId = new Map(events.map((e) => [e.id, e]));
    return helpRequests
      .filter((h) => h.status === "accepted" && h.eventId && byId.has(h.eventId))
      // Name the party actually helping: for an offer that's the sender, for an
      // ask it's the person who was asked.
      .map((h) => ({ id: h.id, name: h.kind === "offer" ? h.fromName : h.toName, event: byId.get(h.eventId!)! }));
  }, [helpRequests, events]);

  const toggle = async (t: TaskRec) => {
    tapHaptic(t.status === "done" ? "select" : "success");
    const next = t.status === "done" ? "todo" : "done";
    setChores((list) => list.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    const r = await api.updateTask(t.id, { status: next });
    if (r.error) setChores((list) => list.map((x) => (x.id === t.id ? { ...x, status: t.status } : x)));
  };

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      {/* custom header: exit pill (parent preview) OR my-profile button (real login) */}
      <View style={{ paddingTop: insets.top > 0 ? 0 : spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        {preview ? (
          <PressableScale onPress={() => router.back()} haptic="select" style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 }} accessibilityRole="button" accessibilityLabel="Back to parent view">
            <Sym name="chevron.left" size={12} color={colors.textSecondary} />
            <T kind="subMedium" color={colors.textSecondary}>Parent view</T>
          </PressableScale>
        ) : (
          <PressableScale onPress={() => router.push("/profile")} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="My profile">
            <MemberAvatar member={kid} size={40} />
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

      {loading || !kid ? <SkeletonCards count={3} /> : (
        <>
          <Rise index={0}>
            <View style={{ alignItems: "center", gap: 8, marginTop: spacing.sm }}>
              <MemberAvatar member={kid} size={56} ringWidth={2} />
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

          {/* Who's helping — accepted help requests tied to one of today's plans. */}
          {helpers.length > 0 && (
            <Rise index={3}>
              <Card style={{ backgroundColor: colors.lavenderBg, borderColor: "transparent", gap: 8 }}>
                {helpers.map((h) => (
                  <View key={h.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Sym name="heart.fill" size={14} color={colors.lavender} />
                    <T kind="subMedium" color={colors.text} style={{ flex: 1 }} numberOfLines={2}>
                      {h.name} is helping — {h.event.title}
                    </T>
                  </View>
                ))}
              </Card>
            </Rise>
          )}

          {/* The family's day — read-only schedule of everyone's plans today. */}
          {events.length > 0 && (
            <Rise index={4}>
              <SectionHeader title="Today" />
              <Card padded={false}>
                {events.map((e, i) => {
                  const mine = e.participantIds?.includes(memberId);
                  return (
                    <View key={e.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 13, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator }}>
                      <T kind="subMedium" color={mine ? colors.ember : colors.textMuted} style={{ width: 70 }}>
                        {new Date(e.startAt!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </T>
                      <View style={{ flex: 1, gap: 2 }}>
                        <T kind="rowTitle">{e.title}{mine ? " — you" : ""}</T>
                        {!!e.location && <T kind="detail">{e.location}</T>}
                      </View>
                    </View>
                  );
                })}
              </Card>
            </Rise>
          )}

          {/* A child can ask for a hand or offer to help — including other kids. */}
          {!preview && (
            <PressableScale onPress={() => router.push("/help")} haptic="select" style={{ alignItems: "center", marginTop: spacing.sm }} accessibilityRole="button" accessibilityLabel="Ask or offer help">
              <T kind="subMedium" color={colors.ember}>Ask or offer help</T>
            </PressableScale>
          )}
        </>
      )}
    </HScreen>
  );
}

export default function KidScreen() {
  const { session } = useSession();
  const { id, preview } = useLocalSearchParams<{ id?: string; preview?: string }>();
  // No id param = a real child login landing here; default to the session actor.
  const memberId = id ?? session?.actorId ?? "";
  return <KidHome memberId={memberId} preview={preview === "1"} />;
}

const st = StyleSheet.create({
  doneCheck: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
});
