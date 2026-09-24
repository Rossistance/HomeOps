// Calendar — home for the three-layer household calendar, in two views:
// Agenda (default): a 14-day strip, then upcoming events as a timeline.
// Month: a paging grid to look any number of months out; tap a day for its plans.
// Canonical events and Google-linked events open the form sheet to edit (Google
// edits write back two-way); ICS-fed events are read-only mirrors that expand
// inline. Each subscribed calendar gets its own accent color on its cards.
// Calendar subscriptions with sync status sit beside the Sync control, folded behind an
// expander (feeds managed in Connections) — they used to trail every agenda day as a card.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { api, type NestRec, type CalendarSubscription, type EventRec, type MemberRec, type TaskRec } from "@/lib/api";
import { allDayDateKey, effectiveEndMs, weekStart } from "@/lib/event-days";
import { eventFace, eyeLabel } from "@/lib/event-face";
import { blockA11yLabel, hiddenCaption, showsHideEye, timeRangeLabel } from "@/lib/event-eye";
import { EyeButton, ObscuredCard } from "@/components/calendar/obscured-card";
import { LinearGradient } from "expo-linear-gradient";
import { fade, memberAccent, memberColor } from "@/lib/member-colors";
import * as SecureStore from "expo-secure-store";
import { useSession } from "@/lib/session";
import { isOpen } from "@/lib/task-state";
import { useTheme, tapHaptic } from "@/theme";
// Deep imports (not the "@/components/ui" barrel): the legacy src/components/ui.tsx
// still shadows the ui/ directory until old screens are deleted centrally.
import { Badge, Chip } from "@/components/ui/badge";
import { Coach } from "@/components/ui/coach";
import { Expander } from "@/components/ui/expander";
import { ScreenTour } from "@/components/ui/screen-tour";
import { Button } from "@/components/ui/button";
import { Card, PressableCard } from "@/components/ui/card";
import { Row, SectionHeader } from "@/components/ui/list";
import { PressableScale } from "@/components/ui/pressable-scale";
import { HScreen } from "@/components/ui/screen";
import { SkeletonCards } from "@/components/ui/skeleton";
import { Rise } from "@/components/ui/stagger";
import { EmptyState, ErrorState, Notice } from "@/components/ui/states";
import { Sym } from "@/components/ui/symbol";
import { T } from "@/components/ui/text";

// Calendar create/edit needs Limited Member or higher (server enforces; we gate the UI).
const MANAGE_ROLES = ["Owner", "Adult Admin", "Adult Member", "Limited Member"];
const STRIP_DAYS = 14;
const pad2 = (n: number) => String(n).padStart(2, "0");
/** Local (not UTC) YYYY-MM-DD — keeps late-evening events on the right day. */
const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function fmtTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(+d) ? null : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** WP-003/ISS-004: every local day an event spans (start day → end day inclusive),
 * so multi-day events render on each spanned day. Capped defensively at 60 days. */
function spanKeys(e: EventRec, householdTz?: string | null): string[] {
  if (!e.startAt || isNaN(+new Date(e.startAt))) return [];
  if (e.allDay) {
    // An all-day event lives on household DATES, whatever zone the phone is in.
    const ks = allDayDateKey(e.startAt, householdTz);
    if (!ks) return [];
    const ke = e.endAt ? allDayDateKey(e.endAt, householdTz) : null;
    const keys = [ks];
    if (ke && ke > ks) {
      const cur = new Date(`${ks}T12:00:00Z`);
      for (let i = 0; i < 60; i++) {
        cur.setUTCDate(cur.getUTCDate() + 1);
        const k = cur.toISOString().slice(0, 10);
        if (k > ke) break;
        keys.push(k);
      }
    }
    return keys;
  }
  const start = new Date(e.startAt);
  const keys = [dayKey(start)];
  const end = e.endAt ? new Date(e.endAt) : null;
  if (end && !isNaN(+end)) {
    const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    for (let i = 0; i < 60; i++) {
      cur.setDate(cur.getDate() + 1);
      if (dayKey(cur) > dayKey(end)) break;
      keys.push(dayKey(cur));
    }
  }
  return keys;
}

/** Full date+time for the conflict cards (falls back to "No date"). */
function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return "No date";
  const d = new Date(iso);
  return isNaN(+d) ? "No date" : d.toLocaleString();
}

/** A pull flagged this canonical event: both FamiliOS and Google changed it since
 * the last push/merge. The user picks which version to keep. */
const conflictOf = (e: EventRec) => e.provenance?.conflict ?? null;

function dayTitle(k: string, todayKey: string): string {
  const label = new Date(`${k}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return k === todayKey ? `Today · ${label}` : label;
}

/** The Monday that starts a day key's ISO week — the agenda draws a rule where this changes. */
const weekOf = (k: string) => weekStart(new Date(`${k}T00:00:00`));

export default function CalendarScreen() {
  const { session } = useSession();
  const { colors, spacing } = useTheme();
  const canManage = MANAGE_ROLES.includes(session?.role ?? "");

  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [events, setEvents] = useState<EventRec[]>([]);
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [subs, setSubs] = useState<CalendarSubscription[]>([]);
  const [tasks, setTasks] = useState<TaskRec[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // Agenda (timeline) is the default; month is a paging grid so you can look a
  // few months out. The grid cursor always sits on the 1st of the shown month.
  const [view, setView] = useState<"agenda" | "month">("agenda");
  const [monthCursor, setMonthCursor] = useState<Date>(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  // Subscriptions fold shut by default: sync status is a glance, not a section you scroll past.
  const [subsOpen, setSubsOpen] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [nests, setNests] = useState<NestRec[]>([]);
  // The household's zone, for placing all-day events on the right DATE on a phone that is
  // somewhere else. Settings may be refused for a child session; the helper then falls back.
  const [householdTz, setHouseholdTz] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  // Guards the auto-sync interval against overlapping runs (a slow sync + a 60s tick).
  const syncBusyRef = useRef(false);

  /* Cluster H — "a filter right next to the sync button that allows me to select from
   * seeing the entire family's calendar, my nest's calendar, or just my calendar… that
   * setting should stick and always be what that calendar view comes back with every time
   * I access the app. Just me means events that are ONLY me — not ones that are shared."
   * Persisted per device: which lens you read the family through is a personal habit. */
  const [calScope, setCalScope] = useState<"family" | "nest" | "me">("family");
  useEffect(() => {
    void SecureStore.getItemAsync("familios_cal_scope").then((v) => {
      if (v === "nest" || v === "me") setCalScope(v);
    }).catch(() => {});
  }, []);
  const pickScope = (v: "family" | "nest" | "me") => {
    setCalScope(v);
    void SecureStore.setItemAsync("familios_cal_scope", v).catch(() => {});
  };

  const load = useCallback(async () => {
    // api.* swallow network errors into empty arrays, so probe /health for honesty.
    // H6 [23:06] — "tasks live separate from the schedule, but when they have a date they
    // should show up in a consolidated view." So dated tasks are fetched and shown under the
    // day they fall on, clearly as tasks — not converted into fake events, which is how a
    // checkbox ends up in an event editor that can't save it.
    const [health, ev, mem, s, tks, ns, st] = await Promise.all([
      api.health(), api.events(), api.members(), api.calendarSubscriptions(), api.tasks(),
      api.nests().catch(() => ({ nests: [] as NestRec[], invitations: [] as NestRec[] })),
      api.settings().catch(() => null),
    ]);
    if (!health) { setPhase("error"); return; }
    setEvents(ev); setMembers(mem); setSubs(s); setTasks(tks); setNests(ns.nests);
    if (st?.timezone) setHouseholdTz(st.timezone);
    setPhase("ready");
  }, []);

  // Reload on every focus so edits made in the form sheet show up immediately.
  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  /* The lens itself. Family: everything visible. My Nest: events involving a nest member
   * (owner or participant) — his example keeps Amelia's dance and drops GPop's ride. Just
   * me: events that are MINE ALONE — owned by me with nobody else on them — "only the
   * fully green events… not ones that are even shared." */
  const nestMemberIds = useMemo(() => {
    const ids = new Set<string>();
    for (const n of nests) for (const m of (n.members ?? [])) ids.add(typeof m === "string" ? m : m.actorId);
    if (session?.actorId) ids.add(session.actorId);
    return ids;
  }, [nests, session?.actorId]);
  const inLens = useCallback((e: EventRec) => {
    if (calScope === "family") return true;
    const people = [e.ownerId, ...(e.participantIds ?? [])].filter(Boolean) as string[];
    if (calScope === "nest") return people.some((id) => nestMemberIds.has(id));
    const me = session?.actorId;
    return e.ownerId === me && (e.participantIds ?? []).every((id) => id === me);
  }, [calScope, nestMemberIds, session?.actorId]);
  const lensedEvents = useMemo(() => events.filter(inLens), [events, inLens]);

  const conflictCount = useMemo(() => lensedEvents.filter((e) => conflictOf(e)).length, [lensedEvents]);

  // H6 — dated, still-open tasks, grouped by the day they land on.
  const tasksByDay = useMemo(() => {
    const map: Record<string, TaskRec[]> = {};
    for (const t of tasks) {
      if (!isOpen(t)) continue;   // archived tasks are filed away, not upcoming
      const at = t.startAt ?? t.dueAt;
      if (!at) continue;
      const d = new Date(at);
      if (Number.isNaN(+d)) continue;
      (map[dayKey(d)] ??= []).push(t);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => String(a.startAt ?? a.dueAt).localeCompare(String(b.startAt ?? b.dueAt)));
    return map;
  }, [tasks]);

  // ONE sync: every subscription syncs and Google-side edits pull back in a single
  // pass (POST /calendar/sync-all). Also runs silently every ~60s while the screen
  // is focused, so the calendar keeps itself fresh without any button-pressing.
  const syncAll = useCallback(async (opts?: { silent?: boolean }) => {
    if (syncBusyRef.current) return;
    syncBusyRef.current = true;
    if (!opts?.silent) { setSyncingAll(true); setNotice(null); }
    try {
      const r = await api.syncAllCalendars();
      if (r.ok) {
        setLastSyncedAt(new Date());
        await load();
        if (!opts?.silent) {
          const bits = [
            r.imported ? `${r.imported} new` : null,
            r.updated ? `${r.updated} updated` : null,
            r.removed ? `${r.removed} removed` : null,
            r.pulled?.merged ? `${r.pulled.merged} merged from Google` : null,
            r.pulled?.conflicts ? `${r.pulled.conflicts} conflict${r.pulled.conflicts === 1 ? "" : "s"} to review` : null,
            r.errors?.length ? `${r.errors.length} feed${r.errors.length === 1 ? "" : "s"} failed` : null,
          ].filter(Boolean);
          setNotice({
            text: `Synced ${r.synced ?? 0} calendar${(r.synced ?? 0) === 1 ? "" : "s"}. ${bits.length ? bits.join(" · ") : "Everything already up to date."}`,
            ok: !r.pulled?.conflicts && !r.errors?.length,
          });
        }
      } else if (!opts?.silent) {
        setNotice({
          text: r.error === "insufficient_role"
            ? "Syncing needs Adult Member or higher."
            : `Couldn't sync: ${r.message ?? r.error ?? "unknown error"}`,
          ok: false,
        });
      }
    } finally {
      syncBusyRef.current = false;
      setSyncingAll(false);
    }
  }, [load]);

  // Auto-sync: a silent sync-all every ~60s while this screen is focused.
  useFocusEffect(useCallback(() => {
    if (!canManage) return;
    const t = setInterval(() => { void syncAll({ silent: true }); }, 60_000);
    return () => clearInterval(t);
  }, [canManage, syncAll]));

  const nameOf = useCallback(
    (id: string | null) => (id ? members.find((m) => m.actorId === id)?.displayName ?? null : null),
    [members],
  );
  const colorOf = useCallback(
    (id: string | null) => memberColor(colors, id ? members.find((x) => x.actorId === id) : null),
    [members, colors],
  );
  // Per-calendar color coding: every subscription (each connected Google account's
  // calendar, each ICS feed) gets its own accent, so synced events read as distinctly
  // colored cards. Server-assigned color wins; a deterministic id-hash fills gaps.
  const SUB_AV = ["sky", "sage", "amber", "lavender", "coral", "ember"];
  const subColorForId = useCallback((subId: string) => {
    const sub = subs.find((s) => s.id === subId);
    // Prefer the OWNING MEMBER's profile color (a connected Google calendar belongs
    // to a person) so Ross's synced events match Ross's accent on the Today strip.
    const ownerColor = sub?.ownerActorId ? colorOf(sub.ownerActorId) : null;
    if (ownerColor) return ownerColor;
    if (sub?.color) return memberAccent(colors, sub.color);
    return memberAccent(colors, SUB_AV[[...subId].reduce((a, c) => a + c.charCodeAt(0), 0) % SUB_AV.length]);
  }, [subs, colors, colorOf]);
  /** Every source calendar this synced event appears on (a shared event carries the
   * owning subscription plus any alsoSubscriptionIds) — one color per calendar. */
  const subColorsOf = useCallback((e: EventRec) => {
    const p = e.provenance ?? {};
    const ids = [p.subscriptionId, ...((p.alsoSubscriptionIds as string[] | undefined) ?? [])]
      .filter((x): x is string => typeof x === "string");
    return ids.map(subColorForId).filter(Boolean) as string[];
  }, [subColorForId]);
  /** Whose event this is, for the card label: first participant for FamiliOS events,
   * the calendar owner(s) for synced ones ("Ross" out of "Google Calendar (Ross)"). */
  const ownerNameOf = useCallback((e: EventRec) => {
    const member = e.participantIds.map((id) => nameOf(id)).find(Boolean);
    if (member) return member;
    const p = e.provenance ?? {};
    const ids = [p.subscriptionId, ...((p.alsoSubscriptionIds as string[] | undefined) ?? [])]
      .filter((x): x is string => typeof x === "string");
    /* Q3 [10:42] — "Spike the speech therapy says wrhixin@gmail.com. It needs to say my name,
     * Ross." The subscription's NAME is the Google account's email, so falling back to it put
     * an address where a person belongs. The server already resolves which MEMBER connected
     * each calendar (ownerName); use that, and keep the email only as the last resort for an
     * ICS feed that has no member behind it at all. */
    const names = ids
      .map((id) => subs.find((s) => s.id === id))
      .filter((sub): sub is NonNullable<typeof sub> => !!sub)
      .map((sub) => sub.ownerName ?? (/\(([^)]+)\)/.exec(sub.name)?.[1] ?? sub.name));
    return names.length ? [...new Set(names)].join(" · ") : null;
  }, [nameOf, subs]);
  /** The single accent a whole event card keys off: the OWNER's colour first — Cluster G:
   * this used to lead with participantIds[0], so the moment someone joined an event it
   * repainted as theirs on every profile ("it's no longer Melissa's… when in reality it is
   * a shared event"). Whose event it is doesn't change when someone joins. */
  const accentOf = useCallback(
    (e: EventRec) =>
      colorOf(e.ownerId ?? null)
      ?? e.participantIds.map((id) => colorOf(id)).find(Boolean)
      ?? subColorsOf(e)[0]
      ?? null,
    [colorOf, subColorsOf],
  );

  // Upcoming = anything undated, or anything whose EFFECTIVE end is within the last 12h
  // onward — an all-day event runs to the end of its last day (the server stores endAt:null
  // for a single-day one, which is how today's all-day event used to vanish at noon).
  // Upcoming = anything undated, or anything whose EFFECTIVE end is today or later. The old
  // "12 hours of grace" kept yesterday evening's event on the list until this morning — an
  // event on the 12th was still showing on the 13th. Today's midnight is the line.
  const upcoming = useMemo(() => {
    const t = new Date(); const startOfToday = +new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return [...lensedEvents]
      .filter((e) => { const end = effectiveEndMs(e); return end === null || end >= startOfToday; })
      .sort((a, b) => +new Date(a.startAt ?? 0) - +new Date(b.startAt ?? 0));
  }, [lensedEvents]);
  // ISS-121: events whose source account can no longer refresh (server-derived flag).
  const staleEvents = useMemo(() => events.filter((e) => e.staleSource), [events]);
  const todayKey = dayKey(new Date());
  const byDay = useMemo(() => {
    const map: Record<string, EventRec[]> = {};
    for (const e of upcoming) {
      const keys = spanKeys(e, householdTz);
      if (keys.length === 0) { (map["undated"] ??= []).push(e); continue; }
      // A multi-day span that began before today shows under today, not under a past day.
      for (const k of [...new Set(keys.map((x) => (x < todayKey ? todayKey : x)))]) (map[k] ??= []).push(e);
    }
    return map;
  }, [upcoming, todayKey, householdTz]);
  /* H6, the half that was missing. The day list came from EVENTS alone, so a dated task on a
   * day with no event rendered nowhere: the agenda said "Nothing on the calendar" over three
   * tasks due that morning, and "tasks only show on the calendar if tied to an event" got
   * offered as an explanation (2026-09-22). A day that holds only tasks is a day with plans. */
  const dayKeys = useMemo(() => {
    const keys = new Set(Object.keys(byDay).filter((k) => k !== "undated"));
    for (const k of Object.keys(tasksByDay)) if (k >= todayKey) keys.add(k);
    return [...keys].sort();
  }, [byDay, tasksByDay, todayKey]);
  const strip = useMemo(() => Array.from({ length: STRIP_DAYS }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i); return d;
  }), []);

  const visibleDays = selectedDay ? dayKeys.filter((k) => k === selectedDay) : dayKeys;
  const showUndated = !selectedDay && (byDay["undated"]?.length ?? 0) > 0;
  const nothingAtAll = dayKeys.length === 0 && !byDay["undated"];

  // Month grid wants EVERY dated event (including ones earlier in the shown month),
  // not just the upcoming window the agenda uses — but still only the events the chosen
  // lens admits. This used to read `events`, so the dots, the day counts and the tapped
  // day's list all ignored Family / My Nest / Just me while the agenda honoured it
  // (cloud simulator, 2026-09-17: "Just me" still listed Melissa's day).
  const byDayAll = useMemo(() => {
    const map: Record<string, EventRec[]> = {};
    for (const e of lensedEvents) {
      for (const k of spanKeys(e, householdTz)) (map[k] ??= []).push(e);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
    return map;
  }, [lensedEvents, householdTz]);
  // 6 fixed weeks (42 cells) starting on Sunday — nulls pad days outside the month.
  const monthCells = useMemo(() => {
    const first = new Date(monthCursor);
    const cells: (Date | null)[] = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(null);
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= days; d++) cells.push(new Date(first.getFullYear(), first.getMonth(), d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [monthCursor]);
  const shiftMonth = useCallback((delta: number) => {
    tapHaptic("select");
    setMonthCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
    setSelectedDay(null);
  }, []);

  const openCreate = useCallback((date?: string) => {
    router.push(date ? { pathname: "/event-form", params: { date } } : "/event-form");
  }, []);

  const syncLabel = (s: CalendarSubscription) => {
    if (s.lastResult?.error) return `Sync failed: ${s.lastResult.error}`;
    if (s.lastSyncAt) return `Synced ${new Date(s.lastSyncAt).toLocaleString()} · ${s.eventCount} event${s.eventCount === 1 ? "" : "s"}`;
    return "Not synced yet";
  };

  const syncNow = async (s: CalendarSubscription) => {
    setSyncing(s.id); setNotice(null);
    const r = await api.syncCalendar(s.id);
    setSyncing(null);
    if (r.sync?.ok) setNotice({ text: `${s.name}: ${r.sync.imported ?? 0} new, ${r.sync.updated ?? 0} updated, ${r.sync.removed ?? 0} removed.`, ok: true });
    else setNotice({ text: `Sync failed: ${r.sync?.error ?? r.error ?? "unknown error"}`, ok: false });
    await load();
  };

  const header = (
    <Stack.Screen
      options={{
        headerRight: canManage
          ? () => (
            <PressableScale
              onPress={() => openCreate(selectedDay ?? undefined)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="New event"
              style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.emberBg, alignItems: "center", justifyContent: "center" }}
            >
              <Sym name="plus" size={16} color={colors.ember} />
            </PressableScale>
          )
          : undefined,
      }}
    />
  );

  if (phase === "loading") {
    return (
      <HScreen>
        {header}
        <SkeletonCards count={4} lines={2} />
      </HScreen>
    );
  }
  if (phase === "error") {
    return (
      <HScreen refreshing={refreshing} onRefresh={() => void onRefresh()}>
        {header}
        <ErrorState onRetry={() => { setPhase("loading"); void load(); }} />
      </HScreen>
    );
  }

  return (
    <HScreen refreshing={refreshing} onRefresh={() => void onRefresh()}>
      {header}

      {/* Agenda ⇄ Month view toggle — always on screen once loaded, so it carries the
          screen's testID for the device flows. */}
      <Rise index={0}>
        <View testID="calendar-screen" style={{ flexDirection: "row", gap: spacing.sm }}>
          {(["agenda", "month"] as const).map((v) => (
            <PressableScale
              key={v}
              haptic="select"
              onPress={() => { setView(v); setSelectedDay(null); }}
              accessibilityRole="button"
              accessibilityState={{ selected: view === v }}
              accessibilityLabel={`${v} view`}
              style={{
                paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
                backgroundColor: view === v ? colors.ember : colors.surface,
                borderWidth: 1, borderColor: view === v ? "transparent" : colors.border,
              }}
            >
              <T kind="subMedium" color={view === v ? colors.onEmber : colors.textSecondary}>
                {v === "agenda" ? "Agenda" : "Month"}
              </T>
            </PressableScale>
          ))}
        </View>
      </Rise>

      {/* Month grid — page any number of months out; tap a day to see its plans. */}
      {view === "month" ? (
        <Rise index={0}>
          <Card style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <PressableScale haptic="select" hitSlop={10} onPress={() => shiftMonth(-1)} accessibilityRole="button" accessibilityLabel="Previous month">
                <Sym name="chevron.left" size={16} color={colors.ember} />
              </PressableScale>
              <T kind="bodyMedium">{monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</T>
              <PressableScale haptic="select" hitSlop={10} onPress={() => shiftMonth(1)} accessibilityRole="button" accessibilityLabel="Next month">
                <Sym name="chevron.right" size={16} color={colors.ember} />
              </PressableScale>
            </View>
            <View style={{ flexDirection: "row" }}>
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <T key={i} kind="caption" color={colors.textFaint} style={{ flex: 1, textAlign: "center" }}>{d}</T>
              ))}
            </View>
            {/* Explicit rows of seven, each cell flex:1. Percentage widths (100/7) rounded up
                past 100% and pushed the seventh cell onto the next line, so a whole weekday
                column went missing and every date sat under the wrong weekday. */}
            {Array.from({ length: monthCells.length / 7 }, (_, r) => monthCells.slice(r * 7, r * 7 + 7)).map((row, r) => (
            <View key={r} style={{ flexDirection: "row" }}>
              {row.map((d, i) => {
                if (!d) return <View key={i} style={{ flex: 1, height: 44 }} />;
                const k = dayKey(d);
                const dayEvents = byDayAll[k] ?? [];
                const isToday = k === todayKey;
                const isSelected = k === selectedDay;
                return (
                  <PressableScale
                    key={i}
                    haptic="select"
                    onPress={() => setSelectedDay(isSelected ? null : k)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${dayTitle(k, todayKey)}${dayEvents.length ? `, ${dayEvents.length} events` : ""}`}
                    style={{ flex: 1, height: 44, alignItems: "center", justifyContent: "center", gap: 2 }}
                  >
                    <View style={{
                      width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center",
                      backgroundColor: isSelected ? colors.ember : isToday ? colors.emberBg : "transparent",
                    }}>
                      <T kind="subMedium" color={isSelected ? colors.onEmber : isToday ? colors.ember : colors.textSecondary}>{d.getDate()}</T>
                    </View>
                    <View style={{ flexDirection: "row", gap: 2, height: 4 }}>
                      {/* A block's dot is its owner's colour, dimmed: someone's busy there, and
                          that is all the grid says about it. */}
                      {dayEvents.slice(0, 3).map((e, j) => (
                        <View key={j} style={{
                          width: 4, height: 4, borderRadius: 2,
                          backgroundColor: eventFace(e).mode === "block"
                            ? fade(colorOf(e.ownerId ?? null) ?? colors.textFaint, 0.45)
                            : accentOf(e) ?? colors.ember,
                        }} />
                      ))}
                    </View>
                  </PressableScale>
                );
              })}
            </View>
            ))}
          </Card>
        </Rise>
      ) : null}

      {/* 14-day strip — dots mark days with plans; tap toggles a one-day focus. */}
      {view === "agenda" ? (
      <Rise index={0}>
        <ScreenTour route="/calendar" />
        <Coach id="calendar.strip">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -spacing.lg }}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
        >
          {strip.map((d) => {
            const k = dayKey(d);
            const isToday = k === todayKey;
            const isSelected = k === selectedDay;
            const hasEvents = (byDay[k]?.length ?? 0) > 0 || (tasksByDay[k]?.length ?? 0) > 0;
            const bg = isSelected ? colors.ember : isToday ? colors.emberBg : colors.surface;
            const fg = isSelected ? colors.onEmber : isToday ? colors.ember : colors.textSecondary;
            return (
              <PressableScale
                key={k}
                haptic="select"
                onPress={() => setSelectedDay(isSelected ? null : k)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${dayTitle(k, todayKey)}${hasEvents ? ", has events" : ""}`}
                style={{
                  width: 52, paddingVertical: 10, borderRadius: 16, borderCurve: "continuous",
                  alignItems: "center", gap: 2,
                  backgroundColor: bg,
                  borderWidth: 1,
                  borderColor: isSelected || isToday ? "transparent" : colors.border,
                }}
              >
                <T kind="caption" color={isSelected ? colors.onEmber : isToday ? colors.ember : colors.textFaint}>
                  {d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}
                </T>
                <T kind="h3" color={fg}>{d.getDate()}</T>
                <View style={{
                  width: 5, height: 5, borderRadius: 3,
                  backgroundColor: hasEvents ? (isSelected ? colors.onEmber : colors.ember) : "transparent",
                }} />
              </PressableScale>
            );
          })}
        </ScrollView>
        </Coach>
      </Rise>
      ) : null}

      {/* One Sync: every subscription + Google-edit pull in a single pass (and it
          re-runs silently every minute while this screen is open). */}
      {canManage ? (
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
            <Button
              small
              variant="neutral"
              icon="arrow.triangle.2.circlepath"
              title={syncingAll ? "Syncing…" : "Sync"}
              loading={syncingAll}
              onPress={() => void syncAll()}
            />
            {/* Cluster H — the lens, in his order, remembered across launches. My Nest only
                offers itself when a nest exists to mean something by it. */}
            <Chip label="Family" icon="house.fill" selected={calScope === "family"} onPress={() => pickScope("family")} />
            {nests.length > 0 ? <Chip label="My Nest" icon="person.2.fill" selected={calScope === "nest"} onPress={() => pickScope("nest")} /> : null}
            <Chip label="Just me" icon="lock" selected={calScope === "me"} onPress={() => pickScope("me")} />
            {conflictCount > 0 ? (
              <Badge
                label={`${conflictCount} conflict${conflictCount === 1 ? "" : "s"} to review`}
                fg={colors.coral}
                bg={colors.coralBg}
                icon="exclamationmark.triangle.fill"
              />
            ) : null}
          </View>
          {lastSyncedAt ? (
            <T kind="caption" color={colors.textFaint}>
              Last synced {lastSyncedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </T>
          ) : null}
        </View>
      ) : null}

      {/* Synced feeds — the read-only "linked" layer, next to the Sync that drives them and
          folded shut. Feeds are added/removed in Connections. */}
      <View>
        <PressableScale
          haptic="select"
          onPress={() => setSubsOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: subsOpen }}
          accessibilityLabel={`Subscriptions, ${subs.length} synced calendar${subs.length === 1 ? "" : "s"}`}
        >
          <SectionHeader
            title={`Subscriptions${subs.length ? ` · ${subs.length}` : ""}`}
            trailing={<Expander open={subsOpen} size={26} />}
          />
        </PressableScale>
        {subsOpen ? (
          subs.length === 0 ? (
            <Card>
              <T kind="sub">No synced calendars yet. Subscribe to school or team feeds in More → Connections.</T>
            </Card>
          ) : (
            <Card padded={false}>
              {subs.map((s, i) => {
                // Whose calendar this is: "Ross · wrhixon@gmail.com" when the server
                // knows the owning account; otherwise fall back to the source label.
                const owner = [s.ownerName, s.accountEmail].filter(Boolean).join(" · ") || s.source;
                return (
                  <Row
                    key={s.id}
                    icon="antenna.radiowaves.left.and.right"
                    iconColor={subColorForId(s.id) ?? colors.sky}
                    iconBg={colors.skyBg}
                    title={s.name}
                    subtitle={`${owner}\n${syncLabel(s)}`}
                    last={i === subs.length - 1}
                    trailing={<Button small title="Sync" loading={syncing === s.id} onPress={() => void syncNow(s)} />}
                  />
                );
              })}
            </Card>
          )
        ) : null}
      </View>

      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

      {/* ISS-121: a connected calendar that can no longer refresh must never contribute
          SILENTLY. Its events stay visible — hiding a family's events would be the worse
          lie — but say plainly that they can't refresh, with the action that fixes it.
          Server-derived, so this clears itself the moment the account reconnects. */}
      {staleEvents.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Notice
            text={`${staleEvents.length} event${staleEvents.length === 1 ? "" : "s"} here ${staleEvents.length === 1 ? "comes" : "come"} from a calendar that can't refresh — ${staleEvents.length === 1 ? "it" : "they"} may be out of date until it's reconnected.`}
            ok={false}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            {/* F2/F4 — say WHICH provider needs attention and WHERE we came from, so
                Connections can scroll to that card, ring it, and give Back a real
                destination. The provider comes from the stale event itself; guessing
                "google" would ring the wrong card for an ICS feed. */}
            <PressableScale
              onPress={() => router.push({
                pathname: "/connections",
                params: { focus: staleEvents[0]?.staleSource?.provider ?? "google", from: "/(home)/calendar" },
              })}
              haptic="select" hitSlop={8} accessibilityRole="button" accessibilityLabel="Reconnect the calendar"
            >
              <T kind="subMedium" color={colors.ember}>Reconnect</T>
            </PressableScale>
          </View>
        </View>
      ) : null}

      {view === "month" ? (
        !selectedDay ? (
          <T kind="sub" color={colors.textFaint} style={{ textAlign: "center" }}>Tap a day to see its plans.</T>
        ) : (byDayAll[selectedDay]?.length ?? 0) === 0 ? (
          <EmptyState
            icon="calendar"
            title="Nothing planned this day"
            action={canManage ? { title: "Add event", onPress: () => openCreate(selectedDay) } : undefined}
          />
        ) : (
          <Rise index={1}>
            <Coach id="calendar.list">
            <SectionHeader title={dayTitle(selectedDay, todayKey)} />
            </Coach>
            <View style={{ gap: spacing.sm }}>
              {byDayAll[selectedDay].map((e) => (
                <EventItem
                  key={e.id}
                  e={e}
                  nameOf={nameOf}
                  colorOf={colorOf}
                  subColors={subColorsOf(e)}
                  ownerName={ownerNameOf(e)} members={members} hideEye={showsHideEye(eventFace(e), e, subs)}
                  canManage={canManage}
                  onChanged={load}
                  expanded={expanded === e.id}
                  onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
                />
              ))}
            </View>
          </Rise>
        )
      ) : nothingAtAll ? (
        <EmptyState
          icon="calendar"
          title="Nothing on the calendar yet"
          hint={canManage
            ? "Add an event with the + button, subscribe to a school or team feed in Connections, or ask Famili to plan something."
            : "Subscribe to a school or team feed in Connections, or ask Famili to plan something."}
          action={canManage ? { title: "New event", onPress: () => openCreate() } : undefined}
        />
      ) : selectedDay && visibleDays.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="Nothing planned this day"
          hint="Tap the day again to see the whole agenda."
          action={canManage
            ? { title: "Add event", onPress: () => openCreate(selectedDay) }
            : { title: "Show all days", onPress: () => setSelectedDay(null) }}
        />
      ) : (
        <>
          {visibleDays.map((k, di) => (
            <Rise key={k} index={di + 1}>
              {/* A hairline where the ISO week turns over, so "next week" reads as a place
                  in the list and not just a change of weekday name. */}
              {di > 0 && +weekOf(k) !== +weekOf(visibleDays[di - 1]) ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg }} accessibilityRole="header">
                  <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
                  <T kind="caption" color={colors.textFaint}>
                    Week of {weekOf(k).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </T>
                  <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
                </View>
              ) : null}
              <SectionHeader title={dayTitle(k, todayKey)} />
              <View style={{ gap: spacing.sm }}>
                {(byDay[k] ?? []).map((e) => (
                  <EventItem
                    key={e.id}
                    e={e}
                    nameOf={nameOf}
                    colorOf={colorOf}
                    subColors={subColorsOf(e)}
                    ownerName={ownerNameOf(e)} members={members} hideEye={showsHideEye(eventFace(e), e, subs)}
                    canManage={canManage}
                    onChanged={load}
                    expanded={expanded === e.id}
                    onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
                  />
                ))}
                {/* The consolidated part of H6: the day's tasks, under the day's events,
                    visibly a different kind of thing. Tapping opens Tasks, where it can
                    actually be edited and checked off. */}
                {(tasksByDay[k] ?? []).map((t) => (
                  <DayTask key={t.id} t={t} name={t.assignedMemberId ? nameOf(t.assignedMemberId) : null}
                    tone={colorOf(t.assignedMemberId ?? t.createdBy ?? null)} />
                ))}
              </View>
            </Rise>
          ))}
          {showUndated ? (
            <Rise index={visibleDays.length + 1}>
              <SectionHeader title="No date set" />
              <View style={{ gap: spacing.sm }}>
                {byDay["undated"].map((e) => (
                  <EventItem
                    key={e.id}
                    e={e}
                    nameOf={nameOf}
                    colorOf={colorOf}
                    subColors={subColorsOf(e)}
                    ownerName={ownerNameOf(e)} members={members} hideEye={showsHideEye(eventFace(e), e, subs)}
                    canManage={canManage}
                    onChanged={load}
                    expanded={expanded === e.id}
                    onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
                  />
                ))}
              </View>
            </Rise>
          ) : null}
        </>
      )}
    </HScreen>
  );
}

/** One agenda entry: time rail on the left, event card on the right. */
/** H6 — a dated task, shown under its day but never dressed up as an event. Tapping goes to
 *  Tasks, which is where it can be edited and checked off; an event editor can do neither. */
function DayTask({ t, name, tone }: { t: TaskRec; name: string | null; tone?: string | null }) {
  const { colors, spacing, radii } = useTheme();
  const at = t.startAt ?? t.dueAt;
  const d = at ? new Date(at) : null;
  const overdue = !!at && Date.parse(at) < Date.now();
  const time = d && !Number.isNaN(+d) ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null;
  /* Q1 — "these are my tasks… they should share my color. They're blue right here." Whose
   * task it is tints it; the generic sky only remains for a task nobody holds. Overdue
   * still shouts coral — lateness outranks identity. */
  const accent = overdue ? colors.coral : (tone ?? colors.sky);
  return (
    <PressableScale
      haptic="select"
      /* BUG-04 follow-through: the group-qualified path died when /tasks moved to the home
         stack; the bare path resolves wherever it lives. */
      onPress={() => router.push("/tasks")}
      accessibilityRole="button"
      accessibilityLabel={`Task: ${t.title}${time ? ` at ${time}` : ""}`}
      accessibilityHint="Opens Tasks"
      style={{
        flexDirection: "row", alignItems: "center", gap: spacing.sm,
        backgroundColor: colors.surfaceSunken, borderRadius: radii.sm, borderCurve: "continuous",
        paddingHorizontal: spacing.md, paddingVertical: 10,
        borderLeftWidth: 3, borderLeftColor: accent,
      }}
    >
      <Sym name="checklist" size={14} color={accent} />
      <View style={{ flex: 1 }}>
        {/* Never clamped — "people need to be able to read their entire name… this happens
            throughout the application." */}
        <T kind="subMedium" color={colors.text}>{t.title}</T>
        <T kind="caption" color={overdue ? colors.coral : colors.textFaint}>
          Task{time ? ` · ${time}` : ""}{name ? ` · ${name.split(" ")[0]}` : ""}{overdue ? " · overdue" : ""}
        </T>
      </View>
      <Sym name="chevron.right" size={12} color={colors.textFaint} />
    </PressableScale>
  );
}

function EventItem({ e, nameOf, colorOf, subColors, ownerName, members, hideEye, canManage, onChanged, expanded, onToggle }: {
  e: EventRec;
  nameOf: (id: string | null) => string | null;
  colorOf: (id: string | null) => string | null;
  /** One accent per source calendar this event appears on (shared events carry several). */
  subColors: string[];
  /** Whose event this is — a member's name or the source calendar owner(s). */
  ownerName: string | null;
  /** For the owner's photo on hidden time. */
  members: MemberRec[];
  /** My own shared event from a Work calendar: wears a small open eye to hide it again. */
  hideEye: boolean;
  canManage: boolean;
  onChanged: () => Promise<void> | void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { colors, spacing } = useTheme();
  // ADR-005: full, the owner's own hidden event, or someone else's hidden time (a block).
  const face = eventFace(e);
  const canonical = e.layer === "canonical";
  // The server says, per viewer, whether this event opens the editor (a Google-linked event
  // only for whoever connected it, a block never). ICS/public mirrors stay expand-only.
  const editable = e.editable === true;
  // All-day events show "All day" on the rail — never a faked midnight (ISS-005).
  const start = e.allDay ? "All day" : fmtTime(e.startAt);
  const end = e.allDay ? null : fmtTime(e.endAt);
  const driver = nameOf(e.driverId);
  const bring = e.whatToBring;
  const checklistDone = e.checklist.filter((c) => c.done).length;
  const conflict = conflictOf(e);
  // Color coding: a bold left stripe + a gradient wash of the accent fading
  // left→right into the card, in the first participant's color (FamiliOS events),
  // the owner's member color (linked events), or the source calendar's color.
  // Shared events (several source calendars, or several members) blend 2+ colors
  // in both the stripe and the wash. One dot per calendar/member either way.
  const ownerColor = colorOf(e.ownerId ?? null);
  /* Owner leads, participants follow — two people on it is what "shared, two colours" means. */
  const memberColors = [...new Set([ownerColor, ...e.participantIds.map((id) => colorOf(id))].filter(Boolean))] as string[];
  const distinctSubColors = [...new Set(subColors)];
  const stripe = ownerColor ?? memberColors[0] ?? subColors[0] ?? null;
  // ≥2 sources (owning subscription + alsoSubscriptionIds) or ≥2 member colors → blend.
  const multiSource = ((e.provenance?.alsoSubscriptionIds as string[] | undefined)?.length ?? 0) > 0;
  const blendColors: string[] = memberColors.length >= 2
    ? memberColors.slice(0, 3)
    : multiSource && distinctSubColors.length >= 2
      ? distinctSubColors.slice(0, 3)
      : [];
  const blended = blendColors.length >= 2;
  const dots = [...new Set([e.ownerId, ...e.participantIds])].filter(Boolean).map((id) => colorOf(id as string) ?? colors.textFaint);
  const [resolving, setResolving] = useState<"google" | "local" | null>(null);

  // Both sides changed since the last sync — the user picks the version to keep.
  const resolve = async (choice: "google" | "local") => {
    setResolving(choice);
    const r = await api.resolveEventConflict(e.id, choice);
    setResolving(null);
    if (r.ok) { tapHaptic("success"); await onChanged(); }
    else Alert.alert("Couldn't resolve", r.message ?? (r.error === "insufficient_role" ? "Adults only." : r.error ?? "Try again."));
  };

  // The eye: share (hidden=false) or hide again (hidden=true). The server's own sentence
  // comes back on a refusal; it is the one to show.
  const [sharing, setSharing] = useState(false);
  const setHidden = async (hidden: boolean) => {
    setSharing(true);
    const r = await api.setEventSharing(e.id, hidden);
    setSharing(false);
    if (r.error) {
      Alert.alert(hidden ? "Couldn't hide it" : "Couldn't share it", r.message ?? (r.error === "network" ? "Check your connection and try again." : "Try again."));
      return;
    }
    tapHaptic("success");
    await onChanged();
  };

  const timeRail = (
    <View style={{ width: 58, alignItems: "flex-end", paddingTop: 14 }}>
      <T kind="subMedium" color={colors.textSecondary}>{start ?? "Any"}</T>
      {end ? <T kind="caption" color={colors.textFaint}>{end}</T> : null}
    </View>
  );

  // Someone else's hidden time: frosted, their photo and "<Name> working" above the glass.
  // Not an event — nothing opens, nothing expands, nothing to edit.
  if (face.mode === "block") {
    const owner = members.find((m) => m.actorId === face.ownerId) ?? null;
    return (
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        {timeRail}
        <View style={{ flex: 1 }}>
          <ObscuredCard
            mode="block"
            owner={owner}
            label={face.label}
            sublabel={timeRangeLabel(e)}
            testID="event-block"
            accessibilityLabel={blockA11yLabel(face.label, e)}
          />
        </View>
      </View>
    );
  }

  // My own hidden event: the real card under the glass; the body still opens it for me, the
  // eye-slash shares it with everyone.
  if (face.mode === "ownHidden") {
    const me = members.find((m) => m.actorId === e.ownerId) ?? null;
    return (
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        {timeRail}
        <View style={{ flex: 1 }}>
          <ObscuredCard
            mode="ownHidden"
            owner={me}
            label={hiddenCaption(face)}
            sublabel={timeRangeLabel(e)}
            testID={`event-card-${e.id}`}
            accessibilityLabel={`${e.title}, ${start ?? "no time"}. Hidden from the family. Open event`}
            onPress={() => router.push({ pathname: "/event-form", params: { id: e.id } })}
            onToggle={() => void setHidden(false)}
            toggling={sharing}
            eyeTestID={`eye-toggle-${e.id}`}
            eyeLabel={eyeLabel(face)}
          >
            <View style={{ gap: 3 }}>
              <T kind="bodyMedium" color={colors.text} numberOfLines={2}>{e.title}</T>
              {ownerName ? <T kind="caption" color={stripe ?? colors.textMuted}>{ownerName}</T> : null}
              {e.location ? <T kind="sub" numberOfLines={1}>{e.location}</T> : null}
            </View>
          </ObscuredCard>
        </View>
      </View>
    );
  }

  /* A3 [14:16] — "for a long address or notes I want a DOWN-ARROW under the time, to peek at
   * it at a glance, in ADDITION to the right-arrow that fully opens the event."
   *
   * Editable rows tap straight through to the editor, which meant there was no way to just
   * LOOK at the address without leaving the calendar. The peek is only offered when there is
   * genuinely something clipped or hidden to see — a chevron that reveals nothing is its own
   * small lie. */
  const hasMoreToSee = (e.location?.length ?? 0) > 28
    || !!e.notes?.trim()
    || (e.whatToBring?.length ?? 0) > 0
    || (e.checklist?.length ?? 0) > 0
    || (e.title?.length ?? 0) > 46;

  return (
    <View style={{ flexDirection: "row", gap: spacing.md }}>
      {/* Time rail */}
      <View style={{ width: 58, alignItems: "flex-end", paddingTop: 14 }}>
        <T kind="subMedium" color={colors.textSecondary}>{start ?? "Any"}</T>
        {end ? <T kind="caption" color={colors.textFaint}>{end}</T> : null}
        {/* A3 — the peek. Under the time, exactly where he asked for it. */}
        {hasMoreToSee && editable ? (
          <PressableScale
            haptic="select"
            onPress={onToggle}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={expanded ? `Hide details of ${e.title}` : `Peek at details of ${e.title}`}
            style={{ marginTop: 6, padding: 3 }}
          >
            <Sym name={expanded ? "chevron.up" : "chevron.down"} size={13} color={colors.textFaint} />
          </PressableScale>
        ) : null}
      </View>

      <View style={{ flex: 1, gap: spacing.sm }}>
      <View>
      <PressableCard
        testID={`event-card-${e.id}`}
        haptic={editable ? "light" : "select"}
        onPress={editable ? () => router.push({ pathname: "/event-form", params: { id: e.id } }) : onToggle}
        accessibilityRole="button"
        accessibilityLabel={editable
          ? `${e.title}, ${start ?? "no time"}. Edit event`
          : `${e.title}, ${start ?? "no time"}. ${expanded ? "Collapse" : "Expand"} details`}
        style={stripe
          ? blended
            ? { overflow: "hidden" }
            : { borderLeftWidth: 5, borderLeftColor: stripe, overflow: "hidden" }
          : undefined}
      >
        {/* wash: one accent fading into the card; shared events blend their colors */}
        {stripe ? (
          <LinearGradient
            colors={blended
              ? ([...blendColors.map((c) => fade(c, 0.18)), fade(blendColors[blendColors.length - 1], 0)] as unknown as [string, string, ...string[]])
              : [fade(stripe, 0.22), fade(stripe, 0)]}
            start={{ x: 0, y: 0.5 }} end={{ x: 0.8, y: 0.5 }}
            style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}
            pointerEvents="none"
          />
        ) : null}
        {/* shared events: the left stripe is a vertical two-color gradient */}
        {blended ? (
          <LinearGradient
            colors={blendColors as [string, string, ...string[]]}
            start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
            style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 5 }}
            pointerEvents="none"
          />
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingRight: hideEye ? 30 : 0 }}>
          {/* ISS-109: clamped to 2 lines while collapsed, but a long title is never left
              unreadable — expanding the row (the affordance already here) shows all of it. */}
          <T kind="bodyMedium" color={colors.text} style={{ flex: 1 }} numberOfLines={expanded ? undefined : 2}>{e.title}</T>
          {conflict ? <Badge label="Sync conflict" fg={colors.coral} bg={colors.coralBg} icon="exclamationmark.triangle.fill" /> : null}
          {e.layer === "public" ? <Badge label="Public" fg={colors.textMuted} bg={colors.surfaceSunken} icon="globe" /> : null}
          {editable ? <Sym name="chevron.right" size={12} color={colors.textFaint} /> : null}
        </View>

        {/* Whose event this is — member name or source calendar owner(s), one dot per calendar. */}
        {ownerName ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
            {(memberColors.length ? memberColors : subColors).slice(0, 4).map((c, i) => (
              <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c, marginLeft: i === 0 ? 0 : -3, borderWidth: 1, borderColor: colors.surface }} />
            ))}
            <T kind="caption" color={stripe ?? colors.textMuted} style={{ fontWeight: "600" }} numberOfLines={1}>{ownerName}</T>
          </View>
        ) : null}

        {e.location ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 }}>
            <Sym name="mappin.and.ellipse" size={12} color={colors.textFaint} />
            {/* ISS-109: addresses are long — show the whole thing once expanded. */}
            <T kind="sub" numberOfLines={expanded ? undefined : 1} style={{ flex: 1 }}>{e.location}</T>
          </View>
        ) : null}

        {(driver || e.participantIds.length > 0 || bring.length > 0 || e.checklist.length > 0) ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.sm }}>
            {driver ? <Badge label={driver} fg={colors.textMuted} bg={colors.surfaceSunken} icon="car.fill" /> : null}
            {e.participantIds.length > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center" }} accessibilityLabel={`${e.participantIds.length} ${e.participantIds.length === 1 ? "person" : "people"}`}>
                {dots.slice(0, 5).map((c, i) => (
                  <View key={i} style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: c, borderWidth: 1.5, borderColor: colors.surface, marginLeft: i === 0 ? 0 : -4 }} />
                ))}
                {e.participantIds.length > 5 ? <T kind="caption" color={colors.textFaint} style={{ marginLeft: 4 }}>+{e.participantIds.length - 5}</T> : null}
              </View>
            ) : null}
            {bring.slice(0, 2).map((w, i) => (
              <Badge key={`${w.item}-${i}`} label={w.item} fg={colors.amber} bg={colors.amberBg} icon="bag.fill" />
            ))}
            {bring.length > 2 ? <Badge label={`+${bring.length - 2}`} fg={colors.amber} bg={colors.amberBg} /> : null}
            {e.checklist.length > 0 ? (
              <Badge label={`${checklistDone}/${e.checklist.length}`} fg={colors.sage} bg={colors.sageBg} icon="checklist" />
            ) : null}
          </View>
        ) : null}

        {/* Our own events: the peek shows exactly what the chevron promised — the notes, the
            whole bring list and the checklist. Until 2026-09-17 `expanded` only unclamped the
            title and address, so an event whose only extra was a note opened to nothing
            (cloud simulator: "Peek at details of TEST — delete me" → no change on screen). */}
        {canonical && expanded ? (
          <View style={{ marginTop: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
            {e.notes?.trim() ? (
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Sym name="text.alignleft" size={12} color={colors.textFaint} />
                <T kind="sub" style={{ flex: 1 }}>{e.notes.trim()}</T>
              </View>
            ) : null}
            {e.participantIds.length > 0 ? (
              <T kind="sub">With: {e.participantIds.map((id) => nameOf(id) ?? id).join(", ")}</T>
            ) : null}
            {bring.length > 0 ? (
              <T kind="sub">Bring: {bring.map((w) => `${w.item}${w.memberId ? ` — ${nameOf(w.memberId) ?? ""}` : ""}`).join(", ")}</T>
            ) : null}
            {e.checklist.length > 0 ? (
              <T kind="sub">{e.checklist.map((c) => `${c.done ? "☑" : "☐"} ${c.text}`).join("\n")}</T>
            ) : null}
          </View>
        ) : null}

        {/* Read-only layers expand inline with full detail (they have no edit sheet). */}
        {!canonical && expanded ? (
          <View style={{ marginTop: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
            {/* Q2 — this used to end the conversation ("edit it at the source or copy it on
                the web app"). Its time and place genuinely aren't ours; everything else is,
                so offer that instead of a dead end. */}
            <T kind="sub" color={colors.textFaint}>
              From {e.source || "another calendar"} — its time and place change there. You can still add your own details here.
            </T>
            {e.localNotes ? (
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Sym name="text.bubble" size={12} color={colors.lavender} />
                <T kind="sub" style={{ flex: 1 }}>{e.localNotes}</T>
              </View>
            ) : null}
            {e.participantIds.length > 0 ? (
              <T kind="sub">Participants: {e.participantIds.map((id) => nameOf(id) ?? id).join(", ")}</T>
            ) : null}
            {bring.length > 0 ? (
              <T kind="sub">Bring: {bring.map((w) => `${w.item}${w.memberId ? ` — ${nameOf(w.memberId) ?? ""}` : ""}`).join(", ")}</T>
            ) : null}
            {e.checklist.length > 0 ? (
              <T kind="sub">{e.checklist.map((c) => `${c.done ? "☑" : "☐"} ${c.text}`).join("\n")}</T>
            ) : null}
            <T kind="caption" color={colors.textFaint}>{e.layer} layer · {e.category || "event"}</T>
            {e.appendable !== false && canManage ? (
              <Button
                small variant="neutral" icon="square.and.pencil"
                title={e.localNotes || (e.whatToBring ?? []).length > 0 ? "Edit your details" : "Add your details"}
                onPress={() => router.push({ pathname: "/event-form", params: { id: e.id } })}
              />
            ) : null}
          </View>
        ) : null}
      </PressableCard>
      {/* My shared Work event: a small open eye hides it from the family again. A sibling of
          the card, not inside it, so it is its own control and not part of the card's press. */}
      {hideEye ? (
        <View pointerEvents="box-none" style={{ position: "absolute", top: 10, right: 10 }}>
          <EyeButton
            hidden={false}
            small
            busy={sharing}
            onPress={() => void setHidden(true)}
            testID={`eye-toggle-${e.id}`}
            accessibilityLabel={eyeLabel(face)}
          />
        </View>
      ) : null}
      </View>

      {/* Sync conflict: both sides changed — pick the version to keep (mirrors web's
          EventDrawer conflict handling). Nothing is overwritten until you choose. */}
      {conflict ? (
        <View style={{ gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.coral, borderRadius: 16, borderCurve: "continuous", borderLeftWidth: 3, padding: spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Sym name="exclamationmark.triangle.fill" size={13} color={colors.coral} />
            <T kind="subMedium" color={colors.text} style={{ flex: 1 }}>This event changed in two places</T>
          </View>
          <T kind="detail">
            Edited here and in Google Calendar since the last sync. Pick the version to keep.
          </T>
          <View style={{ gap: 4 }}>
            <T kind="caption" color={colors.textFaint}>FAMILIOS VERSION</T>
            <T kind="sub" color={colors.textSecondary}>{e.title} · {fmtStamp(e.startAt)}{e.location ? ` · ${e.location}` : ""}</T>
            <T kind="caption" color={colors.textFaint} style={{ marginTop: 4 }}>GOOGLE VERSION</T>
            <T kind="sub" color={colors.textSecondary}>{conflict.google.title ?? e.title} · {fmtStamp(conflict.google.startAt)}{conflict.google.location ? ` · ${conflict.google.location}` : ""}</T>
          </View>
          {canManage ? (
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button small variant="ember" icon="house.fill" title="Keep ours" loading={resolving === "local"} disabled={!!resolving} onPress={() => void resolve("local")} />
              </View>
              <View style={{ flex: 1 }}>
                <Button small variant="neutral" icon="arrow.down.circle" title="Use Google" loading={resolving === "google"} disabled={!!resolving} onPress={() => void resolve("google")} />
              </View>
            </View>
          ) : (
            <T kind="detail">An adult can resolve this conflict.</T>
          )}
        </View>
      ) : null}
      </View>
    </View>
  );
}
