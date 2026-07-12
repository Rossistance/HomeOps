// Ask for help — pick a family member (grandparent, sitter, anyone), optionally
// link a calendar event or task, write a short message (prefilled from the
// event), and send. When the picked member has a connected calendar we peek at
// their own events for a free/busy hint before you ask. Sending creates a real
// server help request that shows up on their home with Accept/Decline.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import { api, type CalendarSubscription, type EventRec, type MemberRec, type TaskRec } from "@/lib/api";
import { memberColor } from "@/lib/member-colors";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
import {
  T, Card, SectionHeader, SkeletonCards, Rise, HScreen, Sym, PressableScale, Button, Notice, Well,
} from "@/components/ui";
import { MemberAvatar } from "./profile";

const HOUR = 3600e3;
const fmtWhen = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
};

export default function HelpScreen() {
  const { colors, spacing } = useTheme();
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [events, setEvents] = useState<EventRec[]>([]);
  const [tasks, setTasks] = useState<TaskRec[]>([]);
  const [subs, setSubs] = useState<CalendarSubscription[]>([]);
  const [toActorId, setToActorId] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Only auto-prefill the message while the user hasn't typed their own.
  const messageTouched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [ms, evs, tks, ss] = await Promise.all([api.members(), api.events(), api.tasks(), api.calendarSubscriptions()]);
      if (cancelled) return;
      setMembers(ms); setEvents(evs); setTasks(tks); setSubs(ss);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const others = useMemo(() => members.filter((m) => m.actorId !== session?.actorId), [members, session?.actorId]);
  const toMember = useMemo(() => others.find((m) => m.actorId === toActorId) ?? null, [others, toActorId]);

  // Linkable events: dated, within the next 14 days.
  const upcoming = useMemo(() => {
    const now = Date.now();
    return events
      .filter((e) => e.startAt && !isNaN(+new Date(e.startAt)))
      .filter((e) => {
        const t = new Date(e.startAt!).getTime();
        return t >= now - 2 * HOUR && t <= now + 14 * 86400000;
      })
      .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
  }, [events]);
  const visibleEvents = showAllEvents ? upcoming : upcoming.slice(0, 6);
  const openTasks = useMemo(() => tasks.filter((t) => t.status !== "done").slice(0, 5), [tasks]);
  const selectedEvent = useMemo(() => (eventId ? upcoming.find((e) => e.id === eventId) ?? null : null), [eventId, upcoming]);
  const selectedTask = useMemo(() => (taskId ? openTasks.find((t) => t.id === taskId) ?? null : null), [taskId, openTasks]);

  const pickEvent = (e: EventRec) => {
    const next = eventId === e.id ? null : e.id;
    setEventId(next);
    if (next) setTaskId(null);
    if (!messageTouched.current) {
      setMessage(next ? `Can you help with ${e.title}${e.startAt ? ` (${fmtWhen(e.startAt)})` : ""}?` : "");
    }
  };
  const pickTask = (t: TaskRec) => {
    const next = taskId === t.id ? null : t.id;
    setTaskId(next);
    if (next) setEventId(null);
    if (!messageTouched.current) {
      setMessage(next ? `Can you take care of "${t.title}"?` : "");
    }
  };

  // Free/busy hint: only meaningful when the member has a connected calendar
  // (a subscription they own). Then any of THEIR events overlapping the picked
  // event's window is a conflict.
  const freeBusy = useMemo(() => {
    if (!toMember || !selectedEvent?.startAt) return null;
    const hasCalendar = subs.some((s) => s.ownerActorId === toMember.actorId);
    if (!hasCalendar) return null;
    const start = new Date(selectedEvent.startAt).getTime();
    const end = selectedEvent.endAt && !isNaN(+new Date(selectedEvent.endAt))
      ? new Date(selectedEvent.endAt).getTime()
      : start + HOUR;
    const conflict = events.find((ev) => {
      if (ev.id === selectedEvent.id || !ev.startAt || isNaN(+new Date(ev.startAt))) return false;
      const theirs = ev.ownerId === toMember.actorId || ev.participantIds?.includes(toMember.actorId);
      if (!theirs) return false;
      const s = new Date(ev.startAt).getTime();
      const e = ev.endAt && !isNaN(+new Date(ev.endAt)) ? new Date(ev.endAt).getTime() : s + HOUR;
      return s < end && e > start;
    });
    return conflict
      ? { free: false as const, text: `⚠ ${toMember.displayName.split(" ")[0]} has ${conflict.title} then` }
      : { free: true as const, text: `✓ ${toMember.displayName.split(" ")[0]} looks free then` };
  }, [toMember, selectedEvent, subs, events]);

  const send = useCallback(async () => {
    if (!toActorId || busy) return;
    const msg = message.trim();
    if (!msg) { setNote("Write a short message first."); return; }
    setBusy(true); setNote(null);
    const r = await api.createHelpRequest({
      toActorId,
      message: msg,
      eventId: eventId ?? undefined,
      taskId: taskId ?? undefined,
    });
    setBusy(false);
    if (!r.helpRequest) {
      setNote(`Couldn't send: ${r.message ?? r.error ?? "unknown error"}`);
      return;
    }
    tapHaptic("success");
    router.back();
  }, [toActorId, busy, message, eventId, taskId]);

  if (loading) {
    return <HScreen><SkeletonCards count={3} /></HScreen>;
  }

  return (
    <HScreen>
      {note ? <Notice text={note} ok={false} /> : null}

      {/* 1 — who */}
      <Rise index={0}>
        <SectionHeader title="Who can help?" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -spacing.lg }}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
        >
          {others.map((m) => {
            const accent = memberColor(colors, m) ?? colors.ember;
            const selected = toActorId === m.actorId;
            return (
              <PressableScale
                key={m.actorId}
                haptic="select"
                onPress={() => setToActorId(selected ? null : m.actorId)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Ask ${m.displayName}`}
                style={{
                  alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10,
                  borderRadius: 16, borderCurve: "continuous", minWidth: 76,
                  backgroundColor: selected ? colors.surface : "transparent",
                  borderWidth: 1.5, borderColor: selected ? accent : colors.border,
                }}
              >
                <MemberAvatar member={m} size={44} />
                <T kind="detail" color={selected ? colors.text : colors.textSecondary} numberOfLines={1}>
                  {m.displayName.split(" ")[0]}
                </T>
              </PressableScale>
            );
          })}
        </ScrollView>
      </Rise>

      {/* 2 — link a plan or task (optional) */}
      <Rise index={1}>
        <SectionHeader title="About a plan? (optional)" />
        {upcoming.length === 0 ? (
          <Card><T kind="sub">Nothing on the calendar in the next two weeks.</T></Card>
        ) : (
          <Card padded={false}>
            {visibleEvents.map((e, i) => {
              const selected = eventId === e.id;
              return (
                <PressableScale
                  key={e.id}
                  haptic="select"
                  onPress={() => pickEvent(e)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Link ${e.title}`}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: spacing.md,
                    paddingHorizontal: spacing.lg, paddingVertical: 11,
                    borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.separator,
                    backgroundColor: selected ? colors.emberBg : "transparent",
                  }}
                >
                  <Sym name={selected ? "checkmark.circle.fill" : "calendar"} size={16} color={selected ? colors.ember : colors.textFaint} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <T kind="subMedium" color={colors.text} numberOfLines={1}>{e.title}</T>
                    <T kind="detail" numberOfLines={1}>{fmtWhen(e.startAt)}{e.location ? ` · ${e.location}` : ""}</T>
                  </View>
                </PressableScale>
              );
            })}
            {upcoming.length > 6 && (
              <PressableScale onPress={() => setShowAllEvents((v) => !v)} haptic="select" style={{ padding: spacing.md, alignItems: "center" }}>
                <T kind="subMedium" color={colors.ember}>{showAllEvents ? "Show fewer" : `Show all ${upcoming.length}`}</T>
              </PressableScale>
            )}
          </Card>
        )}
        {openTasks.length > 0 && (
          <>
            <SectionHeader title="Or a task?" />
            <Card padded={false}>
              {openTasks.map((t, i) => {
                const selected = taskId === t.id;
                return (
                  <PressableScale
                    key={t.id}
                    haptic="select"
                    onPress={() => pickTask(t)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Link task ${t.title}`}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: spacing.md,
                      paddingHorizontal: spacing.lg, paddingVertical: 11,
                      borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.separator,
                      backgroundColor: selected ? colors.emberBg : "transparent",
                    }}
                  >
                    <Sym name={selected ? "checkmark.circle.fill" : "checklist"} size={16} color={selected ? colors.ember : colors.textFaint} />
                    <T kind="subMedium" color={colors.text} style={{ flex: 1 }} numberOfLines={1}>{t.title}</T>
                  </PressableScale>
                );
              })}
            </Card>
          </>
        )}
      </Rise>

      {/* 3 — message */}
      <Rise index={2}>
        <SectionHeader title="Your message" />
        <Well style={{ padding: 0 }}>
          <TextInput
            value={message}
            onChangeText={(t) => { messageTouched.current = t.length > 0; setMessage(t); }}
            placeholder={toMember ? `Ask ${toMember.displayName.split(" ")[0]} for a hand…` : "What do you need help with?"}
            placeholderTextColor={colors.textFaint}
            multiline
            style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text, minHeight: 76 }}
            accessibilityLabel="Help request message"
          />
        </Well>

        {/* free/busy hint — only when we actually know their calendar */}
        {freeBusy ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm }}>
            <T kind="subMedium" color={freeBusy.free ? colors.sage : colors.coral}>{freeBusy.text}</T>
          </View>
        ) : null}
        {selectedTask ? (
          <T kind="detail" style={{ marginTop: spacing.sm }}>Linked to task: {selectedTask.title}</T>
        ) : null}
      </Rise>

      <Rise index={3}>
        <Button
          title={busy ? "Sending…" : toMember ? `Ask ${toMember.displayName.split(" ")[0]}` : "Pick someone to ask"}
          variant="ember"
          full
          loading={busy}
          disabled={!toActorId || busy}
          onPress={() => void send()}
        />
      </Rise>
    </HScreen>
  );
}
