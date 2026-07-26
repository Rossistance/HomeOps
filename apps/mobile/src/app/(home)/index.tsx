// Today — the FamiliOS front page. Role-scoped: a child, grandparent, or sitter
// login renders their calm scoped home directly (no admin dashboard); adults and
// owners get the full front page — greeting + approval count, the household
// member strip, the Ask Famili hero, the Calendar key card, the Ask-for-help
// card, quick actions, then the day at a glance: approvals needing you (and
// help requests to/from you), coming up, bills due. Server-truth via api.*.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type ApprovalRec, type EventRec, type EvolutionRec, type HelpRequestRec, type MemberRec, type MemoryRec, type RunRec, type TaskRec } from "@/lib/api";
import { coversDay, eventTimeLabel } from "@/lib/event-days";
import { fade, memberColor } from "@/lib/member-colors";
import { isChild, isGrandparent, isHelper, viewModeFor } from "@/lib/roles";
import { useSession } from "@/lib/session";
import { useAdvancedMode } from "@/lib/prefs";
import { pickPrompt } from "@/lib/ask-prompts";
import { AskShimmer } from "@/components/ask-shimmer";
import { useTheme, riskColor, tapHaptic } from "@/theme";
import {
  T, Bloom, Card, Badge, SectionHeader, SkeletonCards, ErrorState, Rise, HScreen,
  Sym, SymTile, PressableScale, PressableCard, Button,
} from "@/components/ui";
import { ApprovalSheet } from "@/components/sheets/approval-sheet";
import { ChoreSheet } from "@/components/sheets/chore-sheet";
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
  // Whose event is it: the first named participant, else whoever owns the record. An event
  // with neither belongs to the household, and gets the neutral edge rather than a stranger's
  // colour — guessing here would put someone's name on a thing that isn't theirs.
  const tone = memberColor(colors, members.find((m) => m.actorId === event.participantIds?.[0]))
    ?? memberColor(colors, members.find((m) => m.actorId === event.ownerId))
    ?? colors.textFaint;
  const day = event.startAt
    ? new Date(event.startAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : null;
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
        <View style={{ flex: 1, gap: 1 }}>
          <T kind="subMedium" color={colors.text} numberOfLines={1}>{event.title}</T>
          <T kind="detail" numberOfLines={1}>
            {[showDay ? day : null, eventTimeLabel(event), event.location || null].filter(Boolean).join(" · ")}
          </T>
        </View>
        {/* The people on it, in their own colours — the same dots as everywhere else. */}
        <View style={{ flexDirection: "row", gap: 4 }}>
          {(event.participantIds ?? []).slice(0, 4).map((pid) => {
            const c = memberColor(colors, members.find((m) => m.actorId === pid));
            return c ? <View key={pid} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} /> : null;
          })}
        </View>
        <Sym name="chevron.right" size={11} color={colors.textFaint} />
      </LinearGradient>
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
  const [evolutions, setEvolutions] = useState<EvolutionRec[]>([]);
  const [runs, setRuns] = useState<RunRec[]>([]);
  const [helpRequests, setHelpRequests] = useState<HelpRequestRec[]>([]);
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
    const [h, aps, evts, tks, mem, memries, evos, rns, hrs] = await Promise.all([
      api.health(), api.approvals(), api.events(), api.tasks(), api.members(),
      api.memory(), api.evolutions(), api.runs(), api.helpRequests(),
    ]);
    setOffline(!h);
    if (h) {
      setApprovals(aps); setEvents(evts); setTasks(tks); setMembers(mem);
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
  // Multi-day events (ISS-004) count as "today" on every spanned day.
  const todayEvents = events.filter((e) => coversDay(e, now)).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
  const upcoming = events
    .filter((e) => e.startAt && !isToday(e.startAt) && new Date(e.startAt).getTime() > now.getTime())
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
    .slice(0, 3);
  // What the Calendar card actually shows: today if there is a today, otherwise what's next.
  // Three either way — a card that shows one thing and calls it "Next" was the complaint.
  const cardEvents = todayEvents.length > 0 ? todayEvents.slice(0, 3) : upcoming.slice(0, 3);
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

  // Two honest ledgers, split so activities and learnings never blur into one list.
  // "What I learned" — new memories + improvement proposals waiting on review. Newest, capped at 4.
  const learned = useMemo(() => {
    const out: { key: string; icon: string; fg: string; bg: string; title: string; subtitle: string }[] = [];
    for (const m of [...memory].sort((a, b) => b.createdAt - a.createdAt).slice(0, 2)) {
      out.push({ key: `m-${m.id}`, icon: "lightbulb.fill", fg: colors.amber, bg: colors.amberBg, title: m.text, subtitle: `New memory · ${new Date(m.createdAt).toLocaleDateString()}` });
    }
    for (const e of evolutions.filter((e) => e.status === "pending").slice(0, 2)) {
      out.push({ key: `e-${e.id}`, icon: "wand.and.stars", fg: colors.lavender, bg: colors.lavenderBg, title: e.title || "Improvement proposal", subtitle: `Improvement proposal${e.risk ? ` · ${e.risk} risk` : ""}` });
    }
    return out.slice(0, 4);
  }, [memory, evolutions, colors]);
  // "What I did" — freshly completed runs (the activity ledger). Read-only on Home; only
  // Advanced Mode links it through to the full Activity log, which is hidden by default.
  const did = useMemo(() => {
    /* "Offer help for Melissa's car oil change" appeared twice, identically. Those ARE two
     * separate runs — the same thing really did happen twice — so silently collapsing them
     * would hide a double-execution, and listing both reads as a rendering bug. Grouped by
     * title with a count instead: one row, and it says it happened twice. */
    const byTitle = new Map<string, { title: string; done: number; steps: number; times: number }>();
    for (const r of runs.filter((r) => ["completed", "succeeded"].includes(r.status))) {
      const title = r.title || "Run completed";
      const done = r.steps.filter((s) => ["done", "completed", "succeeded"].includes(s.status)).length;
      const prev = byTitle.get(title);
      if (prev) { prev.times += 1; continue; }
      byTitle.set(title, { title, done, steps: r.steps.length, times: 1 });
    }
    return [...byTitle.values()].slice(0, 4).map((g) => ({
      key: `r-${g.title}`,
      icon: "checkmark.circle.fill", fg: colors.sage, bg: colors.sageBg,
      title: g.title,
      subtitle: `Completed · ${g.done}/${g.steps} step${g.steps === 1 ? "" : "s"}${g.times > 1 ? ` · ${g.times}×` : ""}`,
    }));
  }, [runs, colors]);

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
              {advanced ? (
                <PressableScale onPress={() => router.push("/activity")} haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="Activity">
                  <SymTile name="clock" color={colors.textSecondary} bg={colors.surfaceSunken} size={34} iconSize={16} />
                </PressableScale>
              ) : null}
            </View>
          </View>
          {/* The one moment on this screen worth marking: your own name, the first time you
              see it after opening the app. Bloom runs once per launch, not once per visit. */}
          <Bloom>
            <T kind="h1" style={{ fontSize: 32, lineHeight: 38 }}>Good {part}, {first}</T>
          </Bloom>
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
                {members.map((m) => {
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
            </Rise>
          )}

          {/* Ask Famili hero.
              Smaller than it was ("the Ask Famili card could be smaller, about the size of the
              Calendar card"): the padding drops from xl to lg and the question sets in h2
              rather than the display face, which is what was taking three lines. */}
          <Rise index={2}>
            <PressableScale onPress={() => router.push("/(ask)")} accessibilityRole="button" accessibilityLabel="Ask Famili">
              <LinearGradient
                colors={[colors.hero1, colors.hero2]}
                start={{ x: 0.1, y: 0 }} end={{ x: 0.75, y: 1 }}
                style={{
                  borderRadius: 22, borderCurve: "continuous", padding: spacing.lg, gap: 8, overflow: "hidden",
                  boxShadow: "0 18px 40px -20px rgba(21,26,38,0.55)",
                }}
                onLayout={(e) => setHeroH(e.nativeEvent.layout.height)}
              >
                <View style={st.heroGlow} pointerEvents="none" />
                {/* The living surface — see components/ask-shimmer. Behind the text, ahead of
                    the base gradient, and it stops on its own. */}
                {heroH > 0 ? <AskShimmer height={heroH} /> : null}
                <T kind="eyebrow" color="rgba(245,241,233,0.55)">Ask Famili</T>
                <T kind="h2" color={colors.heroText}>{prompt}</T>
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
          </Rise>

          {/* Ask OR offer help — hand a task off to, or pitch in for, a
              grandparent, sitter or family member. */}
          <Rise index={4}>
            <Card style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <SymTile name="hand.raised.fill" color={colors.lavender} bg={colors.lavenderBg} size={36} iconSize={17} />
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
                  <T kind="sub">Hand something off, or pitch in for someone else.</T>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button small variant="ember" icon="hand.raised.fill" title="Ask for help" onPress={() => router.push({ pathname: "/help", params: { mode: "ask" } })} />
                </View>
                <View style={{ flex: 1 }}>
                  {/* S6/the "Offer help" complaint — neutral read as unavailable, so the two
                      halves of one choice looked like an action and a dead control. Outlined
                      ember is its peer: same weight, opposite fill. */}
                  <Button small variant="emberOutline" icon="hand.thumbsup" title="Offer help" onPress={() => router.push({ pathname: "/help", params: { mode: "offer" } })} />
                </View>
              </View>
            </Card>
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
            {pending.length === 0 && helpToMe.length === 0 && helpFromMe.length === 0 && !justHelped ? (
              <Card><T kind="sub">All caught up — nothing waiting on you.</T></Card>
            ) : (
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
