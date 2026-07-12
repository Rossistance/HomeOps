// Grandparent view — a calm, large-type day view for members like Grandma &
// Grandpa. It's both what a grandparent-role login sees as their home (Today
// renders GrandparentHome directly) and the parent-preview screen opened from
// the Today member strip (preview=1 shows the "Parent view" back pill).
// Emphasis: today's family day, the week ahead, gentle reminders, and the
// "Can you help?" requests the family sent them. Bigger text everywhere.
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type EventRec, type HelpRequestRec, type MemberRec, type TaskRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
import { T, Card, SectionHeader, SkeletonCards, Rise, HScreen, Sym, SymTile, PressableScale, Button } from "@/components/ui";
import { MemberAvatar } from "./profile";

const fmtEventTime = (e: EventRec) => {
  if (!e.startAt) return null;
  const d = new Date(e.startAt);
  if (isNaN(+d)) return null;
  return `${d.toLocaleDateString(undefined, { weekday: "long" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
};

/** "Can you help?" — pending help requests addressed to this member, with
 * Accept / Decline (decline takes a one-line note), plus recently accepted
 * ones shown as confirmations. Shared by the grandparent and sitter homes. */
export function HelpRequestsSection({ memberId, requests, events, onChanged }: {
  memberId: string;
  requests: HelpRequestRec[];
  events: EventRec[];
  onChanged: () => void | Promise<void>;
}) {
  const { colors, spacing } = useTheme();
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const pending = requests.filter((r) => r.status === "pending" && r.toActorId === memberId);
  const accepted = requests
    .filter((r) => r.status === "accepted" && r.toActorId === memberId)
    .sort((a, b) => String(b.respondedAt ?? "").localeCompare(String(a.respondedAt ?? "")))
    .slice(0, 3);
  if (pending.length === 0 && accepted.length === 0) return null;

  const eventOf = (id: string | null) => (id ? events.find((e) => e.id === id) ?? null : null);

  const respond = async (r: HelpRequestRec, response: "accept" | "decline", responseNote?: string) => {
    setBusyId(r.id);
    const res = await api.respondHelpRequest(r.id, response, responseNote?.trim() || undefined);
    setBusyId(null);
    if (res.helpRequest) {
      tapHaptic(response === "accept" ? "success" : "select");
      setDecliningId(null); setNote("");
      await onChanged();
    }
  };

  return (
    <>
      <SectionHeader title="Can you help?" />
      <View style={{ gap: spacing.sm }}>
        {pending.map((r) => {
          const ev = eventOf(r.eventId);
          const declining = decliningId === r.id;
          const item = ev?.title ?? null;
          const isOffer = r.kind === "offer";
          const headline = isOffer
            ? (item ? `${r.fromName} offered to help with ${item}` : `${r.fromName} offered to help`)
            : (item ? `${r.fromName} asked you to help with ${item}` : `${r.fromName} asked for your help`);
          return (
            <Card key={r.id} style={{ gap: spacing.sm }}>
              <T kind="rowTitle" style={{ fontSize: 17 }}>{headline}</T>
              <T kind="body" style={{ fontSize: 16, lineHeight: 23 }}>{r.message}</T>
              {ev ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Sym name="calendar" size={13} color={colors.textMuted} />
                  <T kind="sub" style={{ fontSize: 14 }}>{ev.title}{fmtEventTime(ev) ? ` · ${fmtEventTime(ev)}` : ""}</T>
                </View>
              ) : null}
              {declining ? (
                <View style={{ gap: spacing.sm }}>
                  <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, borderCurve: "continuous", backgroundColor: colors.surfaceSunken }}>
                    <TextInput
                      value={note}
                      onChangeText={setNote}
                      placeholder="Add a note (optional)"
                      placeholderTextColor={colors.textFaint}
                      style={{ paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text }}
                      accessibilityLabel="Decline note"
                    />
                  </View>
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Button small variant="neutral" title="Back" onPress={() => { setDecliningId(null); setNote(""); }} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button small variant="danger" title="Decline" loading={busyId === r.id} onPress={() => void respond(r, "decline", note)} />
                    </View>
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button variant="success" icon="checkmark" title={isOffer ? "Yes, thank you" : "I can help"} loading={busyId === r.id} disabled={!!busyId} onPress={() => void respond(r, "accept")} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button variant="neutral" title={isOffer ? "Maybe not now" : "Can't this time"} disabled={!!busyId} onPress={() => setDecliningId(r.id)} />
                  </View>
                </View>
              )}
            </Card>
          );
        })}
        {accepted.map((r) => {
          const ev = eventOf(r.eventId);
          return (
            <Card key={r.id} style={{ backgroundColor: colors.sageBg, borderColor: "transparent", gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Sym name="checkmark.circle.fill" size={15} color={colors.sage} />
                <T kind="subMedium" color={colors.text} style={{ flex: 1 }}>{r.kind === "offer" ? `${r.fromName} is helping you` : `You're helping ${r.fromName}`}</T>
              </View>
              <T kind="sub" style={{ fontSize: 14 }} numberOfLines={2}>
                {r.message}{ev ? ` · ${ev.title}` : ""}
              </T>
            </Card>
          );
        })}
      </View>
    </>
  );
}

export function GrandparentHome({ memberId, preview = false }: { memberId: string; preview?: boolean }) {
  const { colors, spacing } = useTheme();
  const { session, signOut } = useSession();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [member, setMember] = useState<MemberRec | null>(null);
  const [events, setEvents] = useState<EventRec[]>([]);
  const [reminders, setReminders] = useState<TaskRec[]>([]);
  const [helpRequests, setHelpRequests] = useState<HelpRequestRec[]>([]);
  const [householdName, setHouseholdName] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [members, evts, tasks, hh, hrs] = await Promise.all([api.members(), api.events(), api.tasks(), api.household(), api.helpRequests()]);
    setMember(members.find((m) => m.actorId === memberId) ?? null);
    setEvents(evts.filter((e) => e.startAt).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))));
    setReminders(tasks.filter((t) => t.assignedMemberId === memberId && t.status !== "done"));
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
            <HelpRequestsSection memberId={memberId} requests={helpRequests} events={events} onChanged={load} />
          </Rise>

          {reminders.length > 0 && (
            <Rise index={2}>
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
            <Rise index={4}>
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

          {!preview && (
            <PressableScale onPress={() => router.push("/help")} haptic="select" style={{ alignItems: "center", marginTop: spacing.sm }} accessibilityRole="button" accessibilityLabel="Ask or offer help">
              <T kind="subMedium" color={colors.ember}>Ask or offer help</T>
            </PressableScale>
          )}

          <T kind="detail" center style={{ marginTop: spacing.sm, fontSize: 13 }}>
            The family adds things here for you —{"\n"}nothing to set up, nothing to manage.
          </T>
        </>
      )}
    </HScreen>
  );
}

export default function GrandparentScreen() {
  const { session } = useSession();
  const { id, preview } = useLocalSearchParams<{ id?: string; preview?: string }>();
  // No id param = a real grandparent login landing here; default to the session actor.
  const memberId = id ?? session?.actorId ?? "";
  return <GrandparentHome memberId={memberId} preview={preview === "1"} />;
}
