// Ask or offer help — one screen, two directions:
//  · Ask  (default): pick a family member, optionally link one of MY upcoming
//    events or open tasks, write a short message, and send. When the picked
//    member has a connected calendar we peek at their events for a free/busy
//    hint before you ask.
//  · Offer: pick a family member to help, then link one of THEIR upcoming events
//    or open tasks, and send an offer.
// The person picker never excludes children (a child can be asked/offered, and a
// child user can target other children). Sending creates a real server help
// request that shows up on the recipient's home with Accept/Decline.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { api, type CalendarSubscription, type EventRec, type MemberRec, type TaskRec } from "@/lib/api";
import { allDayDateKey } from "@/lib/event-days";
import { memberColor } from "@/lib/member-colors";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
import {
  T, Card, SectionHeader, SkeletonCards, Rise, HScreen, Sym, PressableScale, Button, Notice, Well,
} from "@/components/ui";
import { MemberAvatar } from "./profile";

const HOUR = 3600e3;
/** "Thu, Sep 17 · 4:30 PM" — or, for an all-day event, the household's DATE and "All day".
 *  An all-day start is stored as household midnight; read as an instant on a phone in
 *  another zone it becomes the evening before (cloud simulator, 2026-09-17: Sunday's
 *  Repatha listed here as "Sat, Sep 19 · 11:00 PM"). */
const fmtWhen = (e: Pick<EventRec, "startAt" | "allDay">) => {
  if (!e.startAt) return "";
  if (e.allDay) {
    const k = allDayDateKey(e.startAt);
    if (!k) return "";
    return `${new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · All day`;
  }
  const d = new Date(e.startAt);
  if (isNaN(+d)) return "";
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
};

export default function HelpScreen() {
  const { colors, spacing } = useTheme();
  const { session } = useSession();
  const params = useLocalSearchParams<{ mode?: string }>();
  // Direction: "ask" (hand one of MY things off) or "offer" (pitch in on one of
  // THEIRS). Seeded from the route param, then owned by the segmented toggle.
  const [mode, setMode] = useState<"ask" | "offer">(params.mode === "offer" ? "offer" : "ask");
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

  /* Cluster Z — a child asks UP, and only up: "she should only be able to ask for help
   * from a full adult member, an adult admin, or an owner — she would not be able to offer
   * help to anybody." Adults keep the full roster, children included, because a child can
   * be asked or offered BY an adult; the restriction is on who a child can reach, not on
   * who can reach a child. */
  const iAmChild = session?.role === "Child View";
  const others = useMemo(() => members.filter((m) => m.actorId !== session?.actorId)
    .filter((m) => !iAmChild || ["Owner", "Adult Admin", "Adult Member"].includes(m.role)),
  [members, session?.actorId, iAmChild]);
  // A child can't offer — collapse to ask no matter what the route param said.
  useEffect(() => { if (iAmChild && mode === "offer") setMode("ask"); }, [iAmChild, mode]);
  const toMember = useMemo(() => others.find((m) => m.actorId === toActorId) ?? null, [others, toActorId]);

  // Whose items fill the "link a plan/task" list:
  //  · Ask   → MINE (I'm handing one of my things off).
  //  · Offer → the SELECTED person's (I'm pitching in on one of theirs).
  const itemsOwnerId = mode === "ask" ? (session?.actorId ?? null) : toActorId;

  // Linkable events: dated, within the next 14 days, where itemsOwnerId is the
  // owner or a participant.
  const upcoming = useMemo(() => {
    if (!itemsOwnerId) return [];
    const now = Date.now();
    return events
      .filter((e) => e.startAt && !isNaN(+new Date(e.startAt)))
      .filter((e) => {
        const t = new Date(e.startAt!).getTime();
        return t >= now - 2 * HOUR && t <= now + 14 * 86400000;
      })
      .filter((e) => e.ownerId === itemsOwnerId || e.participantIds?.includes(itemsOwnerId))
      .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
  }, [events, itemsOwnerId]);
  const visibleEvents = showAllEvents ? upcoming : upcoming.slice(0, 6);
  const openTasks = useMemo(
    () => (itemsOwnerId ? tasks.filter((t) => t.status !== "done" && t.assignedMemberId === itemsOwnerId).slice(0, 5) : []),
    [tasks, itemsOwnerId],
  );
  const selectedEvent = useMemo(() => (eventId ? upcoming.find((e) => e.id === eventId) ?? null : null), [eventId, upcoming]);
  const selectedTask = useMemo(() => (taskId ? openTasks.find((t) => t.id === taskId) ?? null : null), [taskId, openTasks]);

  // Prefill differs by direction: "Can you…?" when asking, "I can help…" when offering.
  const prefillForEvent = (e: EventRec) =>
    mode === "offer"
      ? `I can help with ${e.title}${e.startAt ? ` (${fmtWhen(e)})` : ""}.`
      : `Can you help with ${e.title}${e.startAt ? ` (${fmtWhen(e)})` : ""}?`;
  const prefillForTask = (t: TaskRec) =>
    mode === "offer" ? `I can help with "${t.title}".` : `Can you take care of "${t.title}"?`;

  const pickEvent = (e: EventRec) => {
    const next = eventId === e.id ? null : e.id;
    setEventId(next);
    if (next) setTaskId(null);
    if (!messageTouched.current) setMessage(next ? prefillForEvent(e) : "");
  };
  const pickTask = (t: TaskRec) => {
    const next = taskId === t.id ? null : t.id;
    setTaskId(next);
    if (next) setEventId(null);
    if (!messageTouched.current) setMessage(next ? prefillForTask(t) : "");
  };

  // Switching direction resets the linked item + prefill (the item lists differ).
  const switchMode = (next: "ask" | "offer") => {
    if (next === mode) return;
    setMode(next);
    setEventId(null); setTaskId(null); setShowAllEvents(false);
    messageTouched.current = false;
    setMessage("");
  };

  // In offer mode the shown items belong to the chosen person, so changing who
  // clears the linked item + prefill.
  const selectPerson = (actorId: string) => {
    const next = toActorId === actorId ? null : actorId;
    setToActorId(next);
    if (mode === "offer") {
      setEventId(null); setTaskId(null); setShowAllEvents(false);
      if (!messageTouched.current) setMessage("");
    }
  };

  // Free/busy hint: ask mode only. In offer mode the events ARE the target's own,
  // so an overlap check against themselves is meaningless. Needs a connected calendar.
  const freeBusy = useMemo(() => {
    if (mode !== "ask" || !toMember || !selectedEvent?.startAt) return null;
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
  }, [mode, toMember, selectedEvent, subs, events]);

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
      kind: mode,
    });
    setBusy(false);
    // A 409 duplicate_request carries the EXISTING record alongside the error —
    // check the error first so "already asked" is never presented as a new send.
    if (r.error || !r.helpRequest) {
      setNote(`Couldn't send: ${r.message ?? r.error ?? "unknown error"}`);
      return;
    }
    tapHaptic("success");
    router.back();
  }, [toActorId, busy, message, eventId, taskId, mode]);

  if (loading) {
    return <HScreen keyboardAware><SkeletonCards count={3} /></HScreen>;
  }

  const offer = mode === "offer";
  const firstName = toMember?.displayName.split(" ")[0] ?? "";

  return (
    <HScreen keyboardAware>
      {note ? <Notice text={note} ok={false} /> : null}

      {/* direction toggle — Ask ↔ Offer */}
      <Rise index={0}>
        <View style={{ flexDirection: "row", backgroundColor: colors.surfaceSunken, borderRadius: 14, borderCurve: "continuous", padding: 3, gap: 3 }}>
          {([["ask", "Ask for help"], ["offer", "Offer help"]] as const).map(([key, label]) => {
            const active = mode === key;
            // Cluster Z — greyed for a child, not hidden: "these would be greyed out."
            // A vanished option looks like a bug; a dimmed one reads as a rule.
            const locked = iAmChild && key === "offer";
            return (
              <PressableScale
                key={key}
                haptic={locked ? null : "select"}
                onPress={locked ? undefined : () => switchMode(key)}
                accessibilityState={{ disabled: locked, selected: active }}
                accessibilityRole="button"
                accessibilityLabel={locked ? `${label} — grown-ups only` : label}
                style={{
                  flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 11, borderCurve: "continuous",
                  backgroundColor: active ? colors.surface : "transparent",
                  borderWidth: 1, borderColor: active ? colors.border : "transparent",
                  opacity: locked ? 0.4 : 1,
                }}
              >
                <T kind="subMedium" color={active ? colors.text : colors.textMuted}>{label}</T>
              </PressableScale>
            );
          })}
        </View>
      </Rise>

      {/* 1 — who */}
      <Rise index={1}>
        <SectionHeader title={offer ? "Who do you want to help?" : "Who can help?"} />
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
                onPress={() => selectPerson(m.actorId)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${offer ? "Help" : "Ask"} ${m.displayName}`}
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

      {/* 2 — link a plan or task */}
      <Rise index={2}>
        {offer && !toActorId ? (
          <Card><T kind="sub">Pick someone above to see what you can help with.</T></Card>
        ) : (
          <>
            <SectionHeader title={offer ? (firstName ? `What can you help ${firstName} with?` : "What can you help with?") : "About a plan? (optional)"} />
            {upcoming.length === 0 ? (
              <Card><T kind="sub">{offer ? `Nothing on ${firstName || "their"} calendar in the next two weeks.` : "Nothing on the calendar in the next two weeks."}</T></Card>
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
                        <T kind="detail" numberOfLines={1}>{fmtWhen(e)}{e.location ? ` · ${e.location}` : ""}</T>
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
          </>
        )}
      </Rise>

      {/* 3 — message */}
      <Rise index={3}>
        <SectionHeader title="Your message" />
        <Well style={{ padding: 0 }}>
          <TextInput
            value={message}
            onChangeText={(t) => { messageTouched.current = t.length > 0; setMessage(t); }}
            placeholder={toMember ? (offer ? `Offer ${firstName} a hand…` : `Ask ${firstName} for a hand…`) : (offer ? "What can you help with?" : "What do you need help with?")}
            placeholderTextColor={colors.textFaint}
            multiline
            style={{ paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.text, minHeight: 76 }}
            accessibilityLabel="Help request message"
          />
        </Well>

        {/* free/busy hint — only when we actually know their calendar (ask mode) */}
        {freeBusy ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm }}>
            <T kind="subMedium" color={freeBusy.free ? colors.sage : colors.coral}>{freeBusy.text}</T>
          </View>
        ) : null}
        {selectedTask ? (
          <T kind="detail" style={{ marginTop: spacing.sm }}>Linked to task: {selectedTask.title}</T>
        ) : null}
      </Rise>

      <Rise index={4}>
        <Button
          title={busy ? "Sending…" : toMember ? (offer ? `Offer to help ${firstName}` : `Ask ${firstName}`) : (offer ? "Pick someone to help" : "Pick someone to ask")}
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
