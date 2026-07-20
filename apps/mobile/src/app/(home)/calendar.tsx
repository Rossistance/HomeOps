// Calendar — home for the three-layer household calendar, in two views:
// Agenda (default): a 14-day strip, then upcoming events as a timeline.
// Month: a paging grid to look any number of months out; tap a day for its plans.
// Canonical events and Google-linked events open the form sheet to edit (Google
// edits write back two-way); ICS-fed events are read-only mirrors that expand
// inline. Each subscribed calendar gets its own accent color on its cards.
// Bottom: calendar subscriptions with sync status (feeds managed in Connections).
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { api, type CalendarSubscription, type EventRec, type MemberRec } from "@/lib/api";
import { LinearGradient } from "expo-linear-gradient";
import { fade, memberAccent, memberColor } from "@/lib/member-colors";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
// Deep imports (not the "@/components/ui" barrel): the legacy src/components/ui.tsx
// still shadows the ui/ directory until old screens are deleted centrally.
import { Badge } from "@/components/ui/badge";
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
function spanKeys(e: EventRec): string[] {
  if (!e.startAt || isNaN(+new Date(e.startAt))) return [];
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

export default function CalendarScreen() {
  const { session } = useSession();
  const { colors, spacing } = useTheme();
  const canManage = MANAGE_ROLES.includes(session?.role ?? "");

  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [events, setEvents] = useState<EventRec[]>([]);
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [subs, setSubs] = useState<CalendarSubscription[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // Agenda (timeline) is the default; month is a paging grid so you can look a
  // few months out. The grid cursor always sits on the 1st of the shown month.
  const [view, setView] = useState<"agenda" | "month">("agenda");
  const [monthCursor, setMonthCursor] = useState<Date>(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  // Guards the auto-sync interval against overlapping runs (a slow sync + a 60s tick).
  const syncBusyRef = useRef(false);

  const load = useCallback(async () => {
    // api.* swallow network errors into empty arrays, so probe /health for honesty.
    const [health, ev, mem, s] = await Promise.all([api.health(), api.events(), api.members(), api.calendarSubscriptions()]);
    if (!health) { setPhase("error"); return; }
    setEvents(ev); setMembers(mem); setSubs(s);
    setPhase("ready");
  }, []);

  // Reload on every focus so edits made in the form sheet show up immediately.
  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const conflictCount = useMemo(() => events.filter((e) => conflictOf(e)).length, [events]);

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
    const names = ids
      .map((id) => subs.find((s) => s.id === id)?.name)
      .filter((n): n is string => !!n)
      .map((n) => /\(([^)]+)\)/.exec(n)?.[1] ?? n);
    return names.length ? names.join(" · ") : null;
  }, [nameOf, subs]);
  /** The single accent a whole event card keys off: first participant's color →
   * the event owner's member color (linked Google events carry the member who
   * connected that calendar) → the source calendar's color as the last resort. */
  const accentOf = useCallback(
    (e: EventRec) =>
      e.participantIds.map((id) => colorOf(id)).find(Boolean)
      ?? colorOf(e.ownerId ?? null)
      ?? subColorsOf(e)[0]
      ?? null,
    [colorOf, subColorsOf],
  );

  // Upcoming = anything undated, starting within the last 12h onward, or a
  // multi-day event still running (its END hasn't passed the window).
  const upcoming = useMemo(() => [...events]
    .filter((e) => !e.startAt
      || new Date(e.startAt).getTime() >= Date.now() - 12 * 3600e3
      || (e.endAt ? new Date(e.endAt).getTime() >= Date.now() - 12 * 3600e3 : false))
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))), [events]);
  const byDay = useMemo(() => {
    const map: Record<string, EventRec[]> = {};
    for (const e of upcoming) {
      const keys = spanKeys(e);
      if (keys.length === 0) { (map["undated"] ??= []).push(e); continue; }
      for (const k of keys) (map[k] ??= []).push(e);
    }
    return map;
  }, [upcoming]);
  const dayKeys = useMemo(() => Object.keys(byDay).filter((k) => k !== "undated").sort(), [byDay]);
  const todayKey = dayKey(new Date());
  const strip = useMemo(() => Array.from({ length: STRIP_DAYS }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i); return d;
  }), []);

  const visibleDays = selectedDay ? dayKeys.filter((k) => k === selectedDay) : dayKeys;
  const showUndated = !selectedDay && (byDay["undated"]?.length ?? 0) > 0;
  const nothingAtAll = dayKeys.length === 0 && !byDay["undated"];

  // Month grid wants EVERY dated event (including ones earlier in the shown month),
  // not just the upcoming window the agenda uses.
  const byDayAll = useMemo(() => {
    const map: Record<string, EventRec[]> = {};
    for (const e of events) {
      for (const k of spanKeys(e)) (map[k] ??= []).push(e);
    }
    for (const k of Object.keys(map)) map[k].sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
    return map;
  }, [events]);
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

      {/* Agenda ⇄ Month view toggle */}
      <Rise index={0}>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
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
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {monthCells.map((d, i) => {
                if (!d) return <View key={i} style={{ width: `${100 / 7}%`, height: 44 }} />;
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
                    style={{ width: `${100 / 7}%`, height: 44, alignItems: "center", justifyContent: "center", gap: 2 }}
                  >
                    <View style={{
                      width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center",
                      backgroundColor: isSelected ? colors.ember : isToday ? colors.emberBg : "transparent",
                    }}>
                      <T kind="subMedium" color={isSelected ? colors.onEmber : isToday ? colors.ember : colors.textSecondary}>{d.getDate()}</T>
                    </View>
                    <View style={{ flexDirection: "row", gap: 2, height: 4 }}>
                      {dayEvents.slice(0, 3).map((e, j) => (
                        <View key={j} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: accentOf(e) ?? colors.ember }} />
                      ))}
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          </Card>
        </Rise>
      ) : null}

      {/* 14-day strip — dots mark days with plans; tap toggles a one-day focus. */}
      {view === "agenda" ? (
      <Rise index={0}>
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
            const hasEvents = (byDay[k]?.length ?? 0) > 0;
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

      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

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
            <SectionHeader title={dayTitle(selectedDay, todayKey)} />
            <View style={{ gap: spacing.sm }}>
              {byDayAll[selectedDay].map((e) => (
                <EventItem
                  key={e.id}
                  e={e}
                  nameOf={nameOf}
                  colorOf={colorOf}
                  subColors={subColorsOf(e)}
                  ownerName={ownerNameOf(e)}
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
              <SectionHeader title={dayTitle(k, todayKey)} />
              <View style={{ gap: spacing.sm }}>
                {byDay[k].map((e) => (
                  <EventItem
                    key={e.id}
                    e={e}
                    nameOf={nameOf}
                    colorOf={colorOf}
                    subColors={subColorsOf(e)}
                    ownerName={ownerNameOf(e)}
                    canManage={canManage}
                    onChanged={load}
                    expanded={expanded === e.id}
                    onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
                  />
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
                    ownerName={ownerNameOf(e)}
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

      {/* Synced feeds — the read-only "linked" layer. Feeds are added/removed in Connections. */}
      <Rise index={visibleDays.length + 2}>
        <SectionHeader title="Subscriptions" />
        {subs.length === 0 ? (
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
        )}
      </Rise>
    </HScreen>
  );
}

/** One agenda entry: time rail on the left, event card on the right. */
function EventItem({ e, nameOf, colorOf, subColors, ownerName, canManage, onChanged, expanded, onToggle }: {
  e: EventRec;
  nameOf: (id: string | null) => string | null;
  colorOf: (id: string | null) => string | null;
  /** One accent per source calendar this event appears on (shared events carry several). */
  subColors: string[];
  /** Whose event this is — a member's name or the source calendar owner(s). */
  ownerName: string | null;
  canManage: boolean;
  onChanged: () => Promise<void> | void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { colors, spacing } = useTheme();
  const canonical = e.layer === "canonical";
  // Google-originated linked events are editable two-way (server writes to Google
  // first) — they open the form like canonical ones. ICS/public stay expand-only.
  const editable = canonical || (e.layer === "linked" && !!e.provenance?.googleEventId);
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
  const memberColors = [...new Set(e.participantIds.map((id) => colorOf(id)).filter(Boolean))] as string[];
  const ownerColor = colorOf(e.ownerId ?? null);
  const distinctSubColors = [...new Set(subColors)];
  const stripe = memberColors[0] ?? ownerColor ?? subColors[0] ?? null;
  // ≥2 sources (owning subscription + alsoSubscriptionIds) or ≥2 member colors → blend.
  const multiSource = ((e.provenance?.alsoSubscriptionIds as string[] | undefined)?.length ?? 0) > 0;
  const blendColors: string[] = memberColors.length >= 2
    ? memberColors.slice(0, 3)
    : multiSource && distinctSubColors.length >= 2
      ? distinctSubColors.slice(0, 3)
      : [];
  const blended = blendColors.length >= 2;
  const dots = e.participantIds.map((id) => colorOf(id) ?? colors.textFaint);
  const [resolving, setResolving] = useState<"google" | "local" | null>(null);

  // Both sides changed since the last sync — the user picks the version to keep.
  const resolve = async (choice: "google" | "local") => {
    setResolving(choice);
    const r = await api.resolveEventConflict(e.id, choice);
    setResolving(null);
    if (r.ok) { tapHaptic("success"); await onChanged(); }
    else Alert.alert("Couldn't resolve", r.message ?? (r.error === "insufficient_role" ? "Adults only." : r.error ?? "Try again."));
  };

  return (
    <View style={{ flexDirection: "row", gap: spacing.md }}>
      {/* Time rail */}
      <View style={{ width: 58, alignItems: "flex-end", paddingTop: 14 }}>
        <T kind="subMedium" color={colors.textSecondary}>{start ?? "Any"}</T>
        {end ? <T kind="caption" color={colors.textFaint}>{end}</T> : null}
      </View>

      <View style={{ flex: 1, gap: spacing.sm }}>
      <PressableCard
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <T kind="bodyMedium" color={colors.text} style={{ flex: 1 }} numberOfLines={2}>{e.title}</T>
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
            <T kind="sub" numberOfLines={1} style={{ flex: 1 }}>{e.location}</T>
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

        {/* Read-only layers expand inline with full detail (they have no edit sheet). */}
        {!canonical && expanded ? (
          <View style={{ marginTop: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
            <T kind="sub" color={colors.textFaint}>
              Synced from an external calendar — read-only here. Edit it at the source or copy it on the web app.
            </T>
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
          </View>
        ) : null}
      </PressableCard>

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
