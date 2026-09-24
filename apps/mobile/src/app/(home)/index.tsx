// Today — the FamiliOS front page. Role-scoped: a child, grandparent, or sitter
// login renders their calm scoped home directly (no admin dashboard); adults and
// owners get the full front page — greeting + approval count, the household
// member strip, the Ask Famili hero, the Calendar key card, the Ask-for-help
// card, quick actions, then the day at a glance: approvals needing you (and
// help requests to/from you), coming up, bills due. Server-truth via api.*.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type ApprovalRec, type EventRec, type HelpRequestRec, type MemberRec, type MemoryRec, type RunRec, type TaskRec, type ThreadRec } from "@/lib/api";
import { threadTitle } from "@/lib/messages";
import { AvatarStack } from "@/components/messages/thread-list";
import { coversDay, effectiveEndMs, eventTimeLabel } from "@/lib/event-days";
import { eventFace } from "@/lib/event-face";
import { blockA11yLabel, hiddenCaption, timeRangeLabel } from "@/lib/event-eye";
import { ObscuredCard } from "@/components/calendar/obscured-card";
import { fade, memberColor } from "@/lib/member-colors";
import { canOpenConnections, isChild, isGrandparent, isHelper, viewModeFor } from "@/lib/roles";
import { useSession } from "@/lib/session";
import { isOpen } from "@/lib/task-state";
import { useAdvancedMode } from "@/lib/prefs";
import { pickPrompt } from "@/lib/ask-prompts";
import { AskShimmer } from "@/components/ask-shimmer";
import { useTheme, riskColor, tapHaptic } from "@/theme";
import { depth, rimColor, rimGlow, softRadii } from "@/theme/neumorph";
import { categoryStyle, titleCase } from "@/theme/categories";
import {
  T, Bloom, Coach, Card, Badge, SectionHeader, SkeletonCards, ErrorState, Rise, HScreen,
  Sym, SymTile, PressableScale, PressableCard, Button, Expander, GoArrow,
} from "@/components/ui";
import { ApprovalSheet } from "@/components/sheets/approval-sheet";
import { ChoreSheet } from "@/components/sheets/chore-sheet";
import { useRevSync } from "@/lib/rev-sync";
import { KidHome } from "./kid";
import { GrandparentHome } from "./grandparent";
import { SitterHome } from "./sitter";
import { MemberAvatar } from "./profile";
import { SelfFold } from "@/components/SelfFold";

/* "See all has no button look to it, no neumorphism look to it — it needs to look clickable,
 * not just text." It was ember-coloured text, which relies on you already knowing that ember
 * means tappable in this app. A pill you can see is a smaller ask. */
function SeeAll({ label = "See all", onPress }: { label?: string; onPress: () => void }) {
  const { colors, dark } = useTheme();
  /* The pill is gone — he crossed it out and drew an arrow to the circled chevron on the
   * event row above it.
   *
   * "I asked for the see all and close buttons to be made into real buttons, however that
   *  removes swipe down to dismiss a pop-up menu and doesn't really align with the rest of
   *  the features in the app… use the arrow buttons with circles that are used for expand and
   *  retract in other places in the app."
   *
   * He's right, and the earlier fix over-corrected. "Make it look clickable" got answered with
   * a NEW shape — a labelled ember pill — when the app already had a shape that means "there
   * is more this way", on every event row and every expandable card. A second vocabulary for
   * the same idea is worse than the plain text was: now there are two things to learn.
   *
   * The words move to the accessibility label rather than disappearing. On screen the circle
   * is the affordance; to VoiceOver it is still "See all", because a bare chevron announced as
   * "button" tells you nothing about where it goes. */
  return (
    <PressableScale
      onPress={onPress} haptic="select" hitSlop={12}
      accessibilityRole="button" accessibilityLabel={label}
      style={{
        width: 30, height: 30, borderRadius: 15,
        alignItems: "center", justifyContent: "center",
        backgroundColor: dark ? colors.surfaceSunken : colors.bg,
        borderWidth: 1, borderColor: rimColor(colors, dark),
        boxShadow: depth("raisedSm", colors, dark),
      }}
    >
      <Sym name="chevron.right" size={15} color={colors.textSecondary} />
    </PressableScale>
  );
}

/**
 * One event, as a card inside the Calendar card.
 *
 * Reported: "the upcoming item reads like 'Next: …' in the same format as the card titles.
 * That section should be like a card within a card, like a button… using a faded gradient
 * version of the colour to whom that calendar item belongs, and is clickable to redirect
 * immediately to the actual event detail."
 *
 * The gradient runs from the owner's colour at the leading edge out to nothing, so the colour
 * reads as belonging to the event rather than as a decorative fill — and the solid bar at the
 * left is what your eye actually matches against the avatar strip above. Whose event it is is
 * the first thing you should be able to tell, at arm's length, without reading a word.
 */
function EventChip({ event, members, showDay }: { event: EventRec; members: MemberRec[]; showDay?: boolean }) {
  const { colors, spacing } = useTheme();
  /* Cluster G — the OWNER's colour, always. This used to read participantIds[0] first, so
   * the moment Ross joined Melissa's event it repainted green on BOTH profiles: "it's no
   * longer Melissa's… it's not even a shared event when in reality it is." Whose event it
   * is doesn't change when someone joins it. An event with no member owner belongs to the
   * household and keeps the neutral edge. */
  const tone = memberColor(colors, members.find((m) => m.actorId === event.ownerId))
    ?? memberColor(colors, members.find((m) => m.actorId === event.participantIds?.[0]))
    ?? colors.textFaint;
  const day = event.startAt
    ? new Date(event.startAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : null;
  /* ADR-005 — hidden time on Today. Someone else's is a compact frosted chip with their face
   * and "<Name> working"; it goes nowhere. My own hidden event is blurred with the eye-slash
   * (sharing happens on the Calendar, where the eye is big enough to mean it) and still opens. */
  const face = eventFace(event);
  if (face.mode !== "full") {
    const owner = members.find((m) => m.actorId === (face.mode === "block" ? face.ownerId : event.ownerId)) ?? null;
    const when = [showDay ? day : null, timeRangeLabel(event)].filter(Boolean).join(" · ");
    return face.mode === "block" ? (
      <ObscuredCard compact mode="block" owner={owner} label={face.label} sublabel={when}
        testID="event-block" accessibilityLabel={blockA11yLabel(face.label, event)} />
    ) : (
      <ObscuredCard compact mode="ownHidden" owner={owner} label={hiddenCaption(face)} sublabel={when}
        testID={`event-card-${event.id}`}
        accessibilityLabel={`${event.title}${day ? `, ${day}` : ""} ${eventTimeLabel(event)}. Hidden from the family. Open it`}
        onPress={() => router.push({ pathname: "/event-form", params: { id: event.id } })}>
        <T kind="subMedium" color={colors.text} numberOfLines={1}>{event.title}</T>
      </ObscuredCard>
    );
  }
  return (
    <PressableScale
      onPress={() => router.push({ pathname: "/event-form", params: { id: event.id } })}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={`${event.title}${day ? `, ${day}` : ""} ${eventTimeLabel(event)}. Open it`}
      style={{ borderRadius: 12, borderCurve: "continuous", overflow: "hidden" }}
    >
      <LinearGradient
        colors={[fade(tone, 0.22), fade(tone, 0.04)]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingRight: spacing.md, paddingVertical: 10 }}
      >
        <View style={{ width: 4, alignSelf: "stretch", backgroundColor: tone }} />
        {/* A3 — "all of the individual calendar items that are shown can be compressed down;
            there's no need to show so much information." Title and one line beneath it: when,
            and where if there is a where. The rest is a tap away. */}
        <View style={{ flex: 1, gap: 1 }}>
          <T kind="subMedium" color={colors.text} numberOfLines={1}>{event.title}</T>
          <T kind="detail" numberOfLines={1}>
            {[showDay ? day : null, eventTimeLabel(event), event.location || null].filter(Boolean).join(" · ")}
          </T>
        </View>
        {/* A4 — "in addition to just the name and the colour dot, there needs to be our profile
            photos, miniature versions of them, here inside of each calendar event, so it's
            easily visually identified." A face is recognised faster than a dot is decoded, and
            these are people you know. Overlapped slightly so four still fit on a narrow row;
            MemberAvatar already falls back to the emoji or the initial in their own colour, so
            somebody with no photo still reads as themselves. */}
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {/* Owner included — "we do not see her picture there" on her own event. */}
          {[...new Set([event.ownerId, ...(event.participantIds ?? [])])].filter((x): x is string => !!x).slice(0, 4).map((pid, i) => {
            const m = members.find((x) => x.actorId === pid);
            return m ? (
              <View key={pid} style={{ marginLeft: i === 0 ? 0 : -7 }}>
                <MemberAvatar member={m} size={22} />
              </View>
            ) : null;
          })}
          {[...new Set([event.ownerId, ...(event.participantIds ?? [])])].filter(Boolean).length > 4 ? (
            <T kind="caption" color={colors.textMuted} style={{ marginLeft: 4 }}>
              +{[...new Set([event.ownerId, ...(event.participantIds ?? [])])].filter(Boolean).length - 4}
            </T>
          ) : null}
        </View>
        <GoArrow tone={colors.textSecondary} size={24} />
      </LinearGradient>
    </PressableScale>
  );
}

/** One record per id, first occurrence wins. A list keyed by id must never render an id
 *  twice: React would warn about the duplicate key, and the reader sees the same card twice
 *  with no way to tell it is one thing. */
function byId<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
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
  const { colors, spacing, dark } = useTheme();
  const { session } = useSession();
  const { advanced } = useAdvancedMode();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalRec[]>([]);
  const [events, setEvents] = useState<EventRec[]>([]);
  const [tasks, setTasks] = useState<TaskRec[]>([]);
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [memory, setMemory] = useState<MemoryRec[]>([]);
  const [runs, setRuns] = useState<RunRec[]>([]);
  const [helpRequests, setHelpRequests] = useState<HelpRequestRec[]>([]);
  const [threads, setThreads] = useState<ThreadRec[]>([]);
  const [openApproval, setOpenApproval] = useState<ApprovalRec | null>(null);
  const [choreOpen, setChoreOpen] = useState(false);
  /* One of twenty questions, a different one each time you open the app. The card is a text
   * field, so every one of them is answerable — see lib/ask-prompts. Picked once per mount:
   * re-rolling on every render would change the question under your thumb mid-read. */
  const [prompt] = useState(() => pickPrompt());
  // The shimmer needs the card's real height to know how far to travel; it draws nothing until
  // it has one, rather than guessing and jumping on the first layout pass.
  const [heroH, setHeroH] = useState(0);
  /* The member strip scrolls; these three tell us whether there is anything left to scroll
   * TO, so the edge fade only appears when it means something. A permanent fade would be
   * decoration; one that comes and goes is a readable answer to "is that everyone?". */
  const [stripW, setStripW] = useState(0);
  const [stripContentW, setStripContentW] = useState(0);
  const [stripX, setStripX] = useState(0);
  const stripOverflow = stripContentW > stripW + 4 && stripX < stripContentW - stripW - 4;
  const [helpBusyId, setHelpBusyId] = useState<string | null>(null);
  // WP-001: calm confirmation after accepting help that transferred a task to me.
  const [justHelped, setJustHelped] = useState<{ name: string; taskTitle: string | null } | null>(null);

  const load = useCallback(async () => {
    // api.household() went with the invite sheet — Today never showed the household's name,
    // it only needed it to caption an invite that now lives in Settings. One fewer request
    // on the first screen after login.
    const [h, aps, evts, tks, mem, memries, rns, hrs, ths] = await Promise.all([
      api.health(), api.approvals(), api.events(), api.tasks(), api.members(),
      api.memory(), api.runs(), api.helpRequests(), api.threads(),
    ]);
    setOffline(!h);
    if (h) {
      setApprovals(aps); setEvents(evts); setTasks(tks); setMembers(mem);
      setMemory(memries); setRuns(rns); setHelpRequests(hrs); setThreads(ths);
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

  /* Cluster R — the hero's own draft. Send hands the text to the Ask screen as a param,
   * which fires it on arrival; an empty send just opens the chat, which is still one tap
   * fewer than the old facade. */
  const [heroDraft, setHeroDraft] = useState("");
  const sendHeroAsk = useCallback(() => {
    const q = heroDraft.trim();
    setHeroDraft("");
    if (q) router.push({ pathname: "/(ask)", params: { q } });
    else router.push("/(ask)");
  }, [heroDraft]);

  const pending = useMemo(() => approvals.filter((a) => a.status === "pending"), [approvals]);
  /* Approvals + unread updates in one number — "both approvals and updates". Loaded with the
   * same refresh cycle as everything else on Today, and cheap: it's a count, not a feed. */
  const [unreadNotices, setUnreadNotices] = useState(0);
  useEffect(() => {
    let live = true;
    void api.notifications().then((ns) => { if (live) setUnreadNotices(ns.filter((n) => !n.read && n.channel === "in_app").length); }).catch(() => {});
    return () => { live = false; };
  }, [now]);
  const inboxCount = pending.length + unreadNotices;
  // Multi-day events (ISS-004) count as "today" on every spanned day.
  const todayEvents = events.filter((e) => coversDay(e, now)).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));

  /* A1 — "There is a calendar event, Serving as Eucharistic Minister, shown at 8:30am. However
   * it's 11:54am, so this event should no longer be showing. It is either complete or was
   * missed." An event whose time has passed is not a plan; leaving it at the top of Today is
   * the app telling you to go do something you already did.
   *
   * A2 — "The calendar should not just show one plan, it should show the plans for the next
   * three days." So the window is three DAYS from now, not "today, or else the next thing" —
   * which is a different question and produced a card that went blank at 6pm.
   *
   * All-day events are kept for their whole day rather than being dropped at midnight: an
   * all-day event at 2pm is still today's news. */
  /* THE CALENDAR CARD — the FAMILY's day. Everyone's plans, next three days.
   *
   * This card and "Coming up" below answer different questions, and a previous pass put
   * Coming-up's answer here: it filtered this to just my events over seven days, which
   * emptied the household's at-a-glance view and undid A2 ("the calendar should not just
   * show one plan, it should show the plans for the next three days") from the earlier
   * review. Whose events: EVERYONE'S. Window: three days. What's mine belongs downstairs. */
  const cardEvents = useMemo(() => {
    const nowMs = now.getTime();
    const horizon = nowMs + 3 * 24 * 60 * 60 * 1000;
    return events
      .filter((e) => {
        if (!e.startAt) return false;
        const start = new Date(e.startAt).getTime();
        if (isNaN(start)) return false;
        // Still "live" until its effective end — the end of its LAST day when it's all-day
        // (this used to clamp to the start day, so a 3-day trip fell off after day one
        // while coversDay still said it covered today).
        const endsAt = effectiveEndMs(e) ?? start;
        return endsAt >= nowMs && start <= horizon;
      })
      .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
      .slice(0, 3);
  }, [events, now]);

  /* COMING UP — MY week. The other half of the same distinction.
   *
   * "The coming up should not act like the calendar does and more be a quick view of just
   *  the tasks that I'm on or events that I'm on… the next four or five events that I'm on
   *  and the next three upcoming tasks that I'm on, within the next five to seven days.
   *  Not other people's events that are on the calendar."
   *
   * It was "nearly an exact copy" of the card above because it read the same unfiltered
   * list. Mine = I own it or I'm on it; tasks = assigned to me, or mine and unassigned. */
  const mineSoon = useMemo(() => {
    const me = session?.actorId;
    if (!me) return [];
    const nowMs = now.getTime();
    const horizon = nowMs + 7 * 24 * 60 * 60 * 1000;
    return events
      .filter((e) => e.ownerId === me || (e.participantIds ?? []).includes(me))
      .filter((e) => {
        if (!e.startAt) return false;
        const start = new Date(e.startAt).getTime();
        if (isNaN(start)) return false;
        const endsAt = effectiveEndMs(e) ?? start;
        return endsAt >= nowMs && start <= horizon;
      })
      .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
      .slice(0, 5);
  }, [events, now, session?.actorId]);
  const comingTasks = useMemo(() => {
    const me = session?.actorId;
    const nowMs = now.getTime();
    const horizon = nowMs + 7 * 24 * 60 * 60 * 1000;
    return tasks
      .filter((t) => (t.assignedMemberId ?? t.createdBy) === me && isOpen(t))
      .filter((t) => {
        const at = Date.parse(t.startAt ?? t.dueAt ?? "");
        return !Number.isNaN(at) && at >= nowMs - 12 * 3600e3 && at <= horizon;
      })
      .sort((a, b) => String(a.dueAt ?? a.startAt).localeCompare(String(b.dueAt ?? b.startAt)))
      .slice(0, 3);
  }, [tasks, now, session?.actorId]);
  const bills = tasks.filter((t) => t.type === "bill" && t.status !== "done").slice(0, 4);

  /* Help requests to/from me — the "needs your attention" companions.
   *
   * Deduplicated by REQUEST ID, because a TestFlight screenshot showed the same request
   * rendered twice as two byte-identical cards. Two cards with the same id are one request
   * that reached the list twice — a refresh landing while a load was in flight, the same
   * record arriving from two paths — and there is no reading of that which means anything to
   * the family. (Contrast the runs ledger below, which groups by title and shows a COUNT:
   * two runs with different ids really are two things that happened, and collapsing those
   * would hide a double-execution.) */
  const helpToMe = useMemo(
    () => byId(helpRequests.filter((h) => h.status === "pending" && h.toActorId === session?.actorId)),
    [helpRequests, session?.actorId],
  );
  const helpFromMe = useMemo(
    () => byId(helpRequests.filter((h) => h.status === "pending" && h.fromActorId === session?.actorId)),
    [helpRequests, session?.actorId],
  );
  // Unread family messages — a muted chat stays quiet here too.
  const unreadThreads = useMemo(() => threads.filter((t) => t.unreadCount > 0 && !t.muted && !t.archived), [threads]);
  // The linked plan/task title, for wording help requests ("…help with {item}").
  const itemName = useCallback((h: HelpRequestRec): string | null => {
    if (h.eventId) return events.find((e) => e.id === h.eventId)?.title ?? null;
    if (h.taskId) return tasks.find((t) => t.id === h.taskId)?.title ?? null;
    return null;
  }, [events, tasks]);

  const respondHelp = useCallback(async (h: HelpRequestRec, response: "accept" | "decline", note?: string) => {
    setHelpBusyId(h.id);
    const r = await api.respondHelpRequest(h.id, response, note);
    setHelpBusyId(null);
    if (r.helpRequest) {
      tapHaptic(response === "accept" ? "success" : "select");
      // Server says the linked task moved to me — confirm it in card language.
      if (response === "accept" && r.reassigned && h.kind !== "offer") {
        setJustHelped({ name: h.fromName, taskTitle: r.task?.title ?? null });
      }
      void load();
    }
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

  /* Two honest ledgers, split so activities and learnings never blur into one list.
   * "What I learned" — the newest memories, capped at four.
   *
   * Improvement proposals used to share this list: a separate registry mined from run traces
   * that asked an adult to accept a change to an agent's configuration. It went with the
   * seven-concept model. A helper's behaviour is now one editable paragraph on its own
   * screen, so the honest way to change one is to open it and change the words. */
  const learned = useMemo(
    () => [...memory]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 4)
      .map((m) => ({
        key: `m-${m.id}`, icon: "lightbulb.fill", fg: colors.amber, bg: colors.amberBg,
        title: m.text, subtitle: `New memory · ${new Date(m.createdAt).toLocaleDateString()}`,
      })),
    [memory, colors],
  );
  // "What I did" — freshly completed runs (the activity ledger). Read-only on Home; only
  // Advanced Mode links it through to the full Activity log, which is hidden by default.
  const did = useMemo(() => {
    /* "Offer help for Melissa's car oil change" appeared twice, identically. Those ARE two
     * separate runs — the same thing really did happen twice — so silently collapsing them
     * would hide a double-execution, and listing both reads as a rendering bug. Grouped by
     * title with a count instead: one row, and it says it happened twice. */
    const byTitle = new Map<string, { title: string; done: number; steps: number; times: number; who: string; what: string }>();
    for (const r of runs.filter((r) => ["completed", "succeeded"].includes(r.status))) {
      const title = r.title || "Run completed";
      const done = r.steps.filter((s) => ["done", "completed", "succeeded"].includes(s.status)).length;
      /* Cluster T — "is this what I did? Is this what the helper did? What really happened?"
       * WHO: the helper's name when a helper ran it, "You asked" when it came from chat.
       * WHAT: the last completed step's own title — the closest thing a run has to an
       * outcome sentence without inventing one. */
      const who = r.agentName ? r.agentName : r.actorId === session?.actorId ? "You asked" : r.agentId ? "A helper" : "Famili";
      const lastStep = [...r.steps].reverse().find((st) => ["done", "completed", "succeeded"].includes(st.status));
      const what = (lastStep?.title ?? "").slice(0, 60);
      const prev = byTitle.get(title);
      if (prev) { prev.times += 1; continue; }
      byTitle.set(title, { title, done, steps: r.steps.length, times: 1, who, what });
    }
    return [...byTitle.values()].slice(0, 4).map((g) => ({
      key: `r-${g.title}`,
      icon: "checkmark.circle.fill", fg: colors.sage, bg: colors.sageBg,
      title: g.title,
      subtitle: `${g.who} · ${g.what ? `${g.what} · ` : ""}${g.done}/${g.steps} step${g.steps === 1 ? "" : "s"}${g.times > 1 ? ` · ${g.times}×` : ""}`,
    }));
  }, [runs, colors, session?.actorId]);

  // Meals and Tasks sit up front (not buried in Settings) — the two most-used
  // everyday surfaces after the calendar.
  /* C3 — "these tags are titles, they need to be capitalised, both words. 'Assign' and 'chore'
   * needs to be capitalised; same thing here, 'New' and 'agent'." These are the two he pointed
   * at. Written out rather than passed through titleCase() because they're fixed labels, not
   * data — running a transform over a constant hides the intent from whoever edits it next.
   *
   * Their colours come from the category table too, so the Meals tile here is the same teal as
   * a Meals helper and a Meals section in the Library. */
  const quickActions = [
    { title: "Meals", ...categoryStyle(colors, "Meals"), go: () => router.push("/meals") },
    { title: "Tasks & Lists", ...categoryStyle(colors, "Tasks"), go: () => router.push("/tasks") },
    { title: "Assign Chore", ...categoryStyle(colors, "Chores"), go: () => setChoreOpen(true) },
    { title: "New Helper", icon: "sparkle", fg: colors.ember, bg: colors.emberBg, go: () => router.push("/(agents)?create=1") },
    { title: "Upload", ...categoryStyle(colors, "Documents"), go: () => router.push("/(library)?upload=1") },
    // A Child View never reaches Connections (ADR-005), so it gets no door to it either.
    ...(canOpenConnections(session?.role)
      ? [{ title: "Connect", icon: "link", fg: colors.textMuted, bg: colors.surfaceSunken, go: () => router.push("/connections") }]
      : []),
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
              {/* Cluster I — "a small inbox mail icon up here at the top that represents
                  incoming family chatter… with notification badges for those events, both
                  approvals and updates." Persistent, so a missed push still has a place
                  that visibly owes you something. */}
              <PressableScale onPress={() => router.push("/inbox")} haptic="select" hitSlop={8} accessibilityRole="button"
                accessibilityLabel={inboxCount > 0 ? `Inbox, ${inboxCount} waiting` : "Inbox"}>
                <View>
                  <SymTile name="envelope" color={inboxCount > 0 ? colors.ember : colors.textSecondary} bg={inboxCount > 0 ? colors.emberBg : colors.surfaceSunken} size={34} iconSize={16} />
                  {inboxCount > 0 ? (
                    <View style={{
                      position: "absolute", top: -4, right: -4, minWidth: 17, height: 17, borderRadius: 9,
                      backgroundColor: colors.ember, alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
                    }}>
                      <T kind="caption" color={colors.onEmber} style={{ fontSize: 10, fontWeight: "700" }}>{inboxCount > 99 ? "99+" : String(inboxCount)}</T>
                    </View>
                  ) : null}
                </View>
              </PressableScale>
              {/* Cluster B's remaining half — the fold. Your face starts where it used to
                  sit in the line and settles into the corner, once per launch, so the
                  rearrangement is watched rather than inferred. */}
              <SelfFold size={34}>
                <PressableScale onPress={() => router.push("/profile")} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="My profile">
                  <MemberAvatar member={meMember} size={34} />
                </PressableScale>
              </SelfFold>
              {advanced ? (
                <PressableScale onPress={() => router.push("/activity")} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="Activity">
                  <SymTile name="clock" color={colors.textSecondary} bg={colors.surfaceSunken} size={34} iconSize={16} />
                </PressableScale>
              ) : null}
            </View>
          </View>
          {/* Two beats: the greeting opens, then your name lands — later, larger, springier,
              because that's the word you're actually being shown. A quarter-second apart
              doesn't read as sequence, it reads as emphasis. Wrapped in a row so they stay on
              one line and can still be animated separately. */}
          <Coach id="today.greeting">
          <View style={{ flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap" }}>
            <Bloom>
              <T kind="h1" style={{ fontSize: 32, lineHeight: 40 }}>Good {part}, </T>
            </Bloom>
            <Bloom big delay={360}>
              <T kind="h1" style={{ fontSize: 32, lineHeight: 40 }}>{first}</T>
            </Bloom>
          </View>
          </Coach>
          {/* F1 — "I removed the 'nothing needs your approval right now', because that's not
              where it goes and it's just a text sign. The actual approval card needs to go
              here." So the sentence is gone entirely and the Needs-your-attention CARD moved up
              under Calendar (see below). Only the offline case still speaks here, because a
              household you can't reach has no cards to show at all. */}
          {offline ? <T kind="body">Can&apos;t reach your household right now.</T> : null}
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
              {/* L1 [00:23] — "Melissa is still truncated. Beannie is still truncated… somehow
                  we need to put these all together to where the whole name shows — whether
                  that means offsetting them or zigzagging them up top across horizontally.
                  Something inventive."

                  Widening the cells was a patch, not a fix: any fixed width eventually meets a
                  longer name, and a wrapping grid of fixed cells goes ragged as the roster
                  grows. The strip scrolls horizontally instead and each cell is sized by its
                  own name, so the name is never the thing that has to give. Six members fit on
                  screen; a seventh scrolls rather than truncating anyone. */}
              {/* No invite control here any more.
                  It was inside the strip (cut off), then pinned beside it — and pinned still
                  didn't look right, because a dashed placeholder cell sitting among five
                  photographs of actual people reads as a missing face rather than as a button.
                  There was never a good spot for it in a row whose subject is who's already
                  here. Adding someone lives in Settings, next to the roster and the roles it
                  belongs with ("Invite someone — add a family member or helper"), which is
                  also where you'd go looking for it. */}
              <Coach id="today.members">
              <View style={{ marginHorizontal: -spacing.lg }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                onLayout={(e) => setStripW(e.nativeEvent.layout.width)}
                onContentSizeChange={(w) => setStripContentW(w)}
                onScroll={(e) => setStripX(e.nativeEvent.contentOffset.x)}
                scrollEventThrottle={32}
                contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.lg, alignItems: "flex-start" }}
              >
                {/* Cluster B — "I would not be pictured here as this does not do anything on
                    click… then what's left would be my family members. That gives a better
                    indication: I'm all good as me, these are the people in my family." You
                    live in the top-right corner (tap = your profile); the strip is THEM. */}
                {members.filter((m) => m.actorId !== session?.actorId).map((m) => {
                  const dest = isChild(m) ? "/kid" : isGrandparent(m) ? "/grandparent" : isHelper(m) ? "/sitter" : null;
                  return (
                    <PressableScale
                      key={m.actorId}
                      onPress={dest ? () => router.push({ pathname: dest, params: { id: m.actorId, preview: "1" } }) : undefined}
                      disabled={!dest}
                      haptic={dest ? "select" : null}
                      style={{ alignItems: "center", gap: 5, minWidth: 56, paddingHorizontal: 2 }}
                      accessibilityLabel={dest ? `Open ${m.displayName}'s view` : m.displayName}
                    >
                      <MemberAvatar member={m} size={48} />
                      {/* No clamp and no fixed width — the cell grows to the name. */}
                      <T kind="detail" center>{m.displayName.split(" ")[0]}</T>
                    </PressableScale>
                  );
                })}
                {/* A big roster gets a way out of the strip rather than a longer swipe.
                    Nobody is hidden — this is a shortcut to the full list, not a truncation. */}
                {members.length > 8 ? (
                  <PressableScale
                    onPress={() => router.push("/household")}
                    haptic="select"
                    style={{ alignItems: "center", gap: 5, minWidth: 56, paddingHorizontal: 2 }}
                    accessibilityLabel={`See all ${members.length} members`}
                  >
                    <View style={[st.avatar, { backgroundColor: colors.surfaceSunken }]}>
                      <T kind="subMedium" color={colors.textSecondary}>{members.length}</T>
                    </View>
                    <T kind="detail">All</T>
                  </PressableScale>
                ) : null}
              </ScrollView>
              {/* The fade still earns its place: it's the only thing that says a roster wider
                  than the screen keeps going, rather than stopping at the last visible face. */}
              {stripOverflow ? (
                <LinearGradient
                  pointerEvents="none"
                  colors={[fade(colors.bg, 0), colors.bg]}
                  start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
                  style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 28 }}
                />
              ) : null}
              </View>
              </Coach>
            </Rise>
          )}

          {/* Ask Famili hero.
              Smaller than it was ("the Ask Famili card could be smaller, about the size of the
              Calendar card"): the padding drops from xl to lg and the question sets in h2
              rather than the display face, which is what was taking three lines. */}
          <Rise index={2}>
            <Coach id="today.ask">
            <PressableScale onPress={() => router.push("/(ask)")} accessibilityRole="button" accessibilityLabel="Ask Famili">
              <LinearGradient
                colors={[colors.hero1, colors.hero2]}
                start={{ x: 0.1, y: 0 }} end={{ x: 0.75, y: 1 }}
                style={{
                  /* G1 — "even though this Ask Famili card has animation and I like it, it does
                     not have the offsets that the other cards do to give it the neumorphism
                     look." It had one flat drop shadow. Now it carries the same dual-shadow
                     depth and ember rim as every other card, over its own gradient.
                     G2 — "it also needs to be shrunk down a bit." Padding md, tighter radius. */
                  borderRadius: softRadii.card, borderCurve: "continuous",
                  padding: spacing.md, gap: 6, overflow: "hidden",
                  borderWidth: 1, borderColor: rimColor(colors, dark),
                  boxShadow: `${rimGlow(colors, dark)}, ${depth("raised", colors, dark)}`,
                }}
                onLayout={(e) => setHeroH(e.nativeEvent.layout.height)}
              >
                <View style={dark ? st.heroGlowDark : st.heroGlow} pointerEvents="none" />
                {/* The living surface — see components/ask-shimmer. Behind the text, ahead of
                    the base gradient, and it stops on its own. */}
                {heroH > 0 ? <AskShimmer height={heroH} /> : null}
                <T kind="eyebrow" color="rgba(245,241,233,0.55)">Ask Famili</T>
                <T kind="h3" color={colors.heroText} style={{ fontSize: 20, lineHeight: 26 }}>{prompt}</T>
                {/* Cluster R — "this needs to be an actual functional interface, a mini
                    version of the full ask page. I need to be able to click here and it
                    allow me to type and dictate and send from here. Right now this is just
                    a facade redirect: I click it, it redirects me, and then I have to click
                    it AGAIN." A real TextInput now. Typing happens here; SEND is the moment
                    the chat takes over, carrying the question with it so it fires on
                    arrival — one tap total, not three. */}
                <View style={st.heroInput}>
                  <TextInput
                    value={heroDraft}
                    onChangeText={setHeroDraft}
                    placeholder="Plan a birthday, draft an email…"
                    placeholderTextColor="rgba(245,241,233,0.5)"
                    style={{ flex: 1, color: colors.heroText, fontSize: 14, paddingVertical: 2 }}
                    returnKeyType="send"
                    onSubmitEditing={sendHeroAsk}
                    accessibilityLabel="Ask Famili anything"
                  />
                  {/* E1 — dictation on every chat input: the mic opens the chat listening. */}
                  <PressableScale
                    onPress={() => router.push({ pathname: "/(ask)", params: { dictate: "1" } })}
                    haptic="light"
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Ask by voice"
                    style={[st.sendCircle, { backgroundColor: "rgba(245,241,233,0.14)" }]}
                  >
                    <Sym name="mic" size={15} color={colors.heroText} />
                  </PressableScale>
                  <PressableScale
                    onPress={sendHeroAsk}
                    haptic="select"
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Send to Famili"
                    style={[st.sendCircle, { backgroundColor: colors.ember, opacity: heroDraft.trim() ? 1 : 0.55 }]}
                  >
                    <Sym name="paperplane.fill" size={15} color={colors.onEmber} />
                  </PressableScale>
                </View>
              </LinearGradient>
            </PressableScale>
            </Coach>
          </Rise>

          {/* Calendar key card — today's plans at a glance, color-coded per member,
              directly under the Ask hero. Tap anywhere to open the full calendar. */}
          <Rise index={3}>
            <Coach id="today.calendar">
            <PressableCard
              onPress={() => router.push("/calendar")}
              accessibilityRole="button"
              accessibilityLabel="Open calendar"
              style={{ gap: spacing.md }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <SymTile name="calendar" color={colors.ember} bg={colors.emberBg} size={36} iconSize={17} />
                <View style={{ flex: 1, gap: 2 }}>
                  {/* "The calendar font is smaller than the Ask or offer help font. Why is
                      that?" No reason — one was rowTitle and the other h3. Both are h3. */}
                  <T kind="h3" color={colors.text}>Calendar</T>
                  <T kind="detail">
                    {cardEvents.length === 0
                      ? "Nothing coming up in the next three days"
                      : todayEvents.length > 0
                        ? `${todayEvents.length} plan${todayEvents.length === 1 ? "" : "s"} today`
                        : `Next ${cardEvents.length === 1 ? "plan" : `${cardEvents.length} plans`}`}
                  </T>
                </View>
                <GoArrow tone={colors.textSecondary} size={26} />
              </View>
              {/* Reported: the next event read as "Next: …" in the same type as the card
                  titles, so a real appointment looked like a heading. It's a THING now — a card
                  inside the card, in the colour of whoever it belongs to, that opens the event
                  when you tap it. Today's plans if there are any; otherwise what's coming. */}
              {cardEvents.length > 0 ? (
                <View style={{ gap: 6 }}>
                  {cardEvents.map((e) => (
                    <EventChip key={e.id} event={e} members={members} showDay={todayEvents.length === 0} />
                  ))}
                  {todayEvents.length > 3 ? (
                    <T kind="detail" color={colors.ember}>+{todayEvents.length - 3} more today</T>
                  ) : null}
                </View>
              ) : null}
            </PressableCard>
            </Coach>
          </Rise>

          {/* F3/F4/F5 — "The needs-your-attention card should move up, right underneath
              Calendar. It should also display however many events are necessary there… the
              title is inside of a card, the information is inside of a card within that card."
              Moved, and rebuilt to that grammar: one card, its heading inside it, and each
              waiting thing as a card within — exactly what Calendar does with its events. */}
          <Rise index={3}>
            <Card style={{ gap: spacing.md }}>
              {/* The heading lives INSIDE the card now — "the title is inside of a card, the
                  information is inside of a card within that card", which is the grammar
                  Calendar and Ask-for-help already use and this one didn't. */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <SymTile name="bell" color={colors.ember} bg={colors.emberBg} size={36} iconSize={17} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T kind="h3" color={colors.text}>Needs your attention</T>
                  <T kind="detail">
                    {pending.length + helpToMe.length + helpFromMe.length + unreadThreads.length === 0
                      ? "Nothing waiting on you"
                      : `${pending.length + helpToMe.length + helpFromMe.length + unreadThreads.length} waiting`}
                  </T>
                </View>
                {pending.length > 0
                  ? <Badge label={String(pending.length)} fg={colors.onEmber} bg={colors.ember} />
                  : <SeeAll onPress={() => router.push("/inbox")} />}
              </View>
            {pending.length === 0 && helpToMe.length === 0 && helpFromMe.length === 0 && unreadThreads.length === 0 && !justHelped ? null : (
              <View style={{ gap: spacing.sm }}>
                {/* confirmation: accepting moved the linked task to me (WP-001) */}
                {justHelped && (
                  <Card style={{ backgroundColor: colors.sageBg, borderColor: "transparent", flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Sym name="checkmark.circle.fill" size={16} color={colors.sage} />
                    <T kind="subMedium" style={{ flex: 1 }} numberOfLines={2}>
                      You're helping {justHelped.name}{justHelped.taskTitle ? ` — ${justHelped.taskTitle}` : ""} (task moved to you)
                    </T>
                    <PressableScale onPress={() => setJustHelped(null)} haptic={null} hitSlop={14} accessibilityRole="button" accessibilityLabel="Dismiss helping confirmation">
                      <Sym name="xmark" size={13} color={colors.textMuted} />
                    </PressableScale>
                  </Card>
                )}
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
                            <T kind="rowTitle">{title}</T>
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

                {/* unread family messages — one row per chat, straight into the thread */}
                {unreadThreads.length > 0 && (
                  <Card padded={false}>
                    {unreadThreads.slice(0, 4).map((t, i) => (
                      <PressableScale
                        key={t.id}
                        onPress={() => router.push({ pathname: "/messages/[id]", params: { id: t.id } } as never)}
                        haptic="select"
                        accessibilityRole="button"
                        accessibilityLabel={`${t.unreadCount} unread from ${threadTitle(t, session?.actorId)}`}
                        style={{
                          flexDirection: "row", alignItems: "center", gap: spacing.md,
                          paddingHorizontal: spacing.lg, paddingVertical: 12,
                          borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator,
                        }}
                      >
                        <AvatarStack t={t} meActorId={session?.actorId} size={36} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <T kind="rowTitle">{threadTitle(t, session?.actorId)}</T>
                          <T kind="detail" numberOfLines={1}>{t.lastPreview ? `${t.lastPreview.from.split(" ")[0]}: ${t.lastPreview.text}` : "New messages"}</T>
                        </View>
                        <Badge label={String(t.unreadCount)} fg={colors.onEmber} bg={colors.ember} />
                      </PressableScale>
                    ))}
                  </Card>
                )}

                {/* help requests addressed to ME — worded by direction; accept/decline inline */}
                {helpToMe.map((h) => {
                  const item = itemName(h);
                  const isOffer = h.kind === "offer";
                  const headline = isOffer
                    ? (item ? `${h.fromName} offered to help with ${item}` : `${h.fromName} offered to help`)
                    : (item ? `${h.fromName} asked you to help with ${item}` : `${h.fromName} asked for your help`);
                  return (
                    <Card key={h.id} style={{ gap: spacing.sm }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Sym name={isOffer ? "hand.thumbsup.fill" : "hand.raised.fill"} size={14} color={colors.lavender} />
                        <T kind="rowTitle" style={{ flex: 1 }} numberOfLines={2}>{headline}</T>
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
                  );
                })}

                {/* my outgoing pending asks — waiting + cancel */}
                {helpFromMe.map((h) => (
                  <Card key={h.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                    <SymTile name="hourglass" color={colors.amber} bg={colors.amberBg} size={36} iconSize={16} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T kind="rowTitle">{h.kind === "offer" ? `Offered to help ${h.toName}` : `Waiting on ${h.toName}…`}</T>
                      <T kind="detail" numberOfLines={2}>{h.message}</T>
                    </View>
                    <Button small variant="ghost" title="Cancel" loading={helpBusyId === h.id} onPress={() => void cancelHelp(h)} />
                  </Card>
                ))}
              </View>
            )}
            </Card>
          </Rise>


          {/* Ask OR offer help — hand a task off to, or pitch in for, a
              grandparent, sitter or family member. */}
          <Rise index={4}>
            <Coach id="today.help">
            <Card style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <SymTile name="hand.wave" color={colors.lavender} bg={colors.lavenderBg} size={36} iconSize={17} />
                <View style={{ flex: 1, gap: 2 }}>
                  {/* [v2 01:37] "this text on here, ask or offer for help, it's very
                      inconspicuous. Too small. You can't actually tell what's going on there."
                      It was a row title over a caption; on a grandparent's home it was the
                      main thing on screen and read as fine print. */}
                  <T kind="h3" color={colors.text}>Ask or offer help</T>
                  {/* Reported: too long, and it broke badly — the em-dash landed at the start of
                      a line and "member" was left stranded on its own below. Em-dash pairs are
                      the problem: they can't be hyphenated or kept with their clause, so they
                      go wherever the wrap falls. Two short lines that can't break wrong. */}
                  {/* "The tagline underneath Ask or offer help should be 'Hand off or pitch
                      in' — that simple. Remove the 'for' and 'something' and 'someone else'." */}
                  <T kind="sub">Hand off or pitch in.</T>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button small variant="ember" icon="hand.wave" title="Ask for help" onPress={() => router.push({ pathname: "/help", params: { mode: "ask" } })} />
                </View>
                <View style={{ flex: 1 }}>
                  {/* S6/the "Offer help" complaint — neutral read as unavailable, so the two
                      halves of one choice looked like an action and a dead control. Outlined
                      ember is its peer: same weight, opposite fill. */}
                  <Button small variant="emberOutline" icon="hand.offer" title="Offer help" onPress={() => router.push({ pathname: "/help", params: { mode: "offer" } })} />
                </View>
              </View>
            </Card>
            </Coach>
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

          {/* Coming up — MINE, events then tasks, in the flat list style of the Ask-for-help
              screen he pointed at ("it should look like these items… the ones that I really
              do have coming up that I may need a plan with or help with"). */}
          {(mineSoon.length > 0 || comingTasks.length > 0) && (
            <Rise index={7}>
              <SectionHeader title="Coming up" />
              <Card padded={false}>
                {mineSoon.map((e, i) => eventFace(e).mode !== "full" ? (
                  /* ADR-005 — my own hidden event stays blurred here too (eye-slash, no toggle;
                     sharing lives on the Calendar), and a block never opens. */
                  <View
                    key={e.id}
                    style={{
                      paddingHorizontal: spacing.lg, paddingVertical: 9,
                      borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator,
                    }}
                  >
                    <EventChip event={e} members={members} showDay />
                  </View>
                ) : (
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
                      <T kind="rowTitle">{e.title}</T>
                      <T kind="detail" numberOfLines={1}>
                        {new Date(e.startAt!).toLocaleDateString(undefined, { weekday: "short" })}
                        {" · "}
                        {eventTimeLabel(e)}
                        {e.location ? ` · ${e.location}` : ""}
                      </T>
                    </View>
                    <Sym name="chevron.right" size={13} color={colors.textFaint} />
                  </PressableScale>
                ))}
                {/* "…and the next three upcoming tasks that I'm on." Same list, same rows —
                    a plan and a to-do are both things I have coming, and separating them
                    into two cards would be the copy problem again in miniature. Tinted my
                    colour (Q1) and routed to Tasks, whose Back returns here. */}
                {comingTasks.map((t, i) => {
                  const mine = memberColor(colors, members.find((m) => m.actorId === (t.assignedMemberId ?? t.createdBy))) ?? colors.sky;
                  const at = new Date(t.dueAt ?? t.startAt ?? "");
                  return (
                    <PressableScale
                      key={t.id}
                      haptic="select"
                      onPress={() => router.push("/tasks")}
                      accessibilityRole="button"
                      accessibilityLabel={`Task: ${t.title}. Opens Tasks`}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: spacing.md,
                        paddingHorizontal: spacing.lg, paddingVertical: 13,
                        borderTopWidth: (i > 0 || mineSoon.length > 0) ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.separator,
                      }}
                    >
                      <Sym name="checkmark.circle" size={15} color={mine} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <T kind="rowTitle">{t.title}</T>
                        <T kind="detail" numberOfLines={1}>
                          {!Number.isNaN(+at)
                            ? `${at.toLocaleDateString(undefined, { weekday: "short" })} · ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                            : "No date"}
                        </T>
                      </View>
                      <Sym name="chevron.right" size={13} color={colors.textFaint} />
                    </PressableScale>
                  );
                })}
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
                      <T kind="rowTitle">{b.title}</T>
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

          {/* What I did — completed runs (the activity ledger). Rows are read-only; only
              Advanced Mode links through to the full Activity log, hidden by default. */}
          {did.length > 0 && (
            <Rise index={9}>
              <SectionHeader title="What I did" trailing={advanced ? <SeeAll label="Activity" onPress={() => router.push("/activity")} /> : undefined} />
              <Card padded={false}>
                {did.map((l, i) => (
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

          {/* What I learned — new memories + improvement proposals. Links to the learned
              surface (memory + improvements), which stays visible without Advanced Mode. */}
          {learned.length > 0 && (
            <Rise index={10}>
              <SectionHeader title="What I learned" trailing={<SeeAll label="All" onPress={() => router.push("/activity")} />} />
              <Card padded={false}>
                {learned.map((l, i) => (
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
    </HScreen>
  );
}

const st = StyleSheet.create({
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  /* The ember bloom in the hero's bottom-right corner. It was one fixed value for both
   * themes, which is why it looked wrong in the dark: 25% ember plus a 35px spread reads as a
   * soft warmth against a light page and as a lamp switched on against a near-black one.
   * Dark mode gets roughly half of it and a tighter spread — see heroGlowDark. */
  heroGlow: {
    position: "absolute", right: -50, bottom: -50, width: 160, height: 160, borderRadius: 160,
    backgroundColor: "rgba(224,102,44,0.22)", boxShadow: "0 0 50px 32px rgba(224,102,44,0.22)",
  },
  heroGlowDark: {
    position: "absolute", right: -56, bottom: -56, width: 150, height: 150, borderRadius: 150,
    backgroundColor: "rgba(224,102,44,0.10)", boxShadow: "0 0 44px 18px rgba(224,102,44,0.09)",
  },
  heroInput: {
    flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4,
    backgroundColor: "rgba(245,241,233,0.08)", borderRadius: 999, paddingLeft: 16, padding: 5,
  },
  sendCircle: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
});
