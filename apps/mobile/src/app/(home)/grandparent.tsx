// Grandparent view — a calm, large-type day view for members like Grandma &
// Grandpa. It's both what a grandparent-role login sees as their home (Today
// renders GrandparentHome directly) and the parent-preview screen opened from
// the Today member strip (preview=1 shows the "Parent view" back pill).
// Emphasis: today's family day, the week ahead, gentle reminders, and the
// "Can you help?" requests the family sent them. Bigger text everywhere.
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type EventRec, type HelpRequestRec, type MemberRec, type TaskRec } from "@/lib/api";
import { coversDay, eventTimeLabel } from "@/lib/event-days";
import { eventFace } from "@/lib/event-face";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
import { T, Coach, Card, SectionHeader, SkeletonCards, Rise, HScreen, Sym, SymTile, PressableScale, Button } from "@/components/ui";
import { MemberAvatar } from "./profile";
import { CompactHiddenEvent } from "@/components/calendar/obscured-card";

const fmtEventTime = (e: EventRec) => {
  if (!e.startAt) return null;
  const d = new Date(e.startAt);
  if (isNaN(+d)) return null;
  return `${d.toLocaleDateString(undefined, { weekday: "long" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
};

// Accepted-help confirmations dismissed on THIS device (WP-001/ISS-009): the
// server keeps the records; dismissal is a local reading preference.
const DISMISSED_HELP_KEY = "familios_dismissed_help";
const ACCEPTED_CARD_MAX_AGE_MS = 14 * 86400000; // auto-expire confirmations after 14 days

/** "Can you help?" — pending help requests addressed to this member, with
 * Accept / Decline (decline takes a one-line note), plus recently accepted
 * ones shown as confirmations. Shared by the grandparent and sitter homes.
 * Accepted confirmations have a real lifecycle (ISS-009): one card per linked
 * item (duplicate-render guard), gone when the linked task completes, when
 * dismissed, or after 14 days. */
export function HelpRequestsSection({ memberId, requests, events, tasks = [], onChanged }: {
  memberId: string;
  requests: HelpRequestRec[];
  events: EventRec[];
  tasks?: TaskRec[];
  onChanged: () => void | Promise<void>;
}) {
  const { colors, spacing } = useTheme();
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    void SecureStore.getItemAsync(DISMISSED_HELP_KEY)
      .then((v) => { if (v) setDismissed(JSON.parse(v) as string[]); })
      .catch(() => { /* first run */ });
  }, []);
  const dismiss = (id: string) => {
    tapHaptic("select");
    setDismissed((prev) => {
      const next = [...prev.filter((x) => x !== id), id].slice(-100);
      void SecureStore.setItemAsync(DISMISSED_HELP_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  /* Deduplicated by REQUEST ID.
   *
   * From a TestFlight screenshot: "Can you help?" showed the same request as two identical
   * cards. The accepted list below has had a duplicate guard since ISS-009; the pending list
   * — the one people actually act on — never got one. Two rows with the same id are one
   * request that arrived twice, and rendering both also means two identical React keys. */
  const pending = useMemo(() => {
    const seen = new Set<string>();
    return requests
      .filter((r) => r.status === "pending" && r.toActorId === memberId)
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  }, [requests, memberId]);
  const accepted = useMemo(() => {
    const fresh = requests
      .filter((r) => r.status === "accepted" && r.toActorId === memberId)
      .filter((r) => !dismissed.includes(r.id))
      // Auto-expire: completed linked task, or older than the age cap.
      .filter((r) => {
        const linked = r.taskId ? tasks.find((t) => t.id === r.taskId) : null;
        if (linked && linked.status === "done") return false;
        const at = Date.parse(r.respondedAt ?? "");
        return !(Number.isFinite(at) && Date.now() - at > ACCEPTED_CARD_MAX_AGE_MS);
      })
      .sort((a, b) => String(b.respondedAt ?? "").localeCompare(String(a.respondedAt ?? "")));
    // Duplicate-render guard: one card per underlying item (newest wins).
    const seen = new Set<string>();
    const out: HelpRequestRec[] = [];
    for (const r of fresh) {
      const key = r.taskId ?? r.eventId ?? `${r.fromActorId}:${r.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out.slice(0, 3);
  }, [requests, memberId, dismissed, tasks]);
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
          const headline = r.kind === "offer" ? `${r.fromName} is helping you` : `You're helping ${r.fromName}`;
          const moved = r.kind !== "offer" && !!r.taskId; // ask + linked task = it moved to me
          return (
            <Card key={r.id} style={{ backgroundColor: colors.sageBg, borderColor: "transparent", gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Sym name="checkmark.circle.fill" size={15} color={colors.sage} />
                <T kind="subMedium" color={colors.text} style={{ flex: 1 }}>{headline}{moved ? " (task moved to you)" : ""}</T>
                <PressableScale onPress={() => dismiss(r.id)} haptic={null} hitSlop={14} accessibilityRole="button" accessibilityLabel={`Dismiss: ${headline}`}>
                  <Sym name="xmark" size={13} color={colors.textMuted} />
                </PressableScale>
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
  // Whose face goes on a hidden-time row (ADR-005).
  const [people, setPeople] = useState<MemberRec[]>([]);
  const [reminders, setReminders] = useState<TaskRec[]>([]);
  const [allTasks, setAllTasks] = useState<TaskRec[]>([]);
  const [helpRequests, setHelpRequests] = useState<HelpRequestRec[]>([]);
  const [householdName, setHouseholdName] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [members, evts, tasks, hh, hrs] = await Promise.all([api.members(), api.events(), api.tasks(), api.household(), api.helpRequests()]);
    setMember(members.find((m) => m.actorId === memberId) ?? null);
    setPeople(members);
    setEvents(evts.filter((e) => e.startAt).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))));
    setReminders(tasks.filter((t) => t.assignedMemberId === memberId && t.status !== "done"));
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

  const completeReminder = async (t: TaskRec) => {
    tapHaptic("success");
    setReminders((list) => list.filter((x) => x.id !== t.id));
    const r = await api.updateTask(t.id, { status: "done" });
    if (r.error) { setReminders((list) => [...list, t]); }
  };

  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "All day";

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh} keyboardAware>
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

          {reminders.length > 0 && (
            <Rise index={2}>
              <SectionHeader title={`For you, ${first}`} />
              <Coach id="scoped.mine"><Card padded={false}>
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
                      {/* Someone's hidden time: a frosted row with their face, never a title. */}
                      {eventFace(e).mode !== "full" ? (
                        <View style={{ flex: 1 }}><CompactHiddenEvent event={e} members={people} /></View>
                      ) : (
                      <View style={{ flex: 1, gap: 2 }}>
                        <T kind="rowTitle" style={{ fontSize: 17 }}>{e.title}{mine ? " — with you" : ""}</T>
                        {!!e.location && <T kind="sub" style={{ fontSize: 14 }}>{e.location}</T>}
                      </View>
                      )}
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
                    {eventFace(e).mode !== "full" ? (
                      <View style={{ flex: 1 }}><CompactHiddenEvent event={e} members={people} /></View>
                    ) : (
                      <T kind="rowTitle" style={{ flex: 1, fontSize: 16 }}>{e.title}</T>
                    )}
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
