// Calendar — agenda-first home for the three-layer household calendar.
// Top: a 14-day strip (dots mark days with plans; tap a day to focus it).
// Middle: upcoming events as a timeline — time rail + card. Canonical
// (FamiliOS-layer) events open the form sheet to edit; synced (linked/public)
// events are read-only mirrors that expand inline instead.
// Bottom: calendar subscriptions with sync status (feeds managed in Connections).
import { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { api, type CalendarSubscription, type EventRec, type MemberRec } from "@/lib/api";
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

/** Full date+time for the conflict cards (falls back to "No date"). */
function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return "No date";
  const d = new Date(iso);
  return isNaN(+d) ? "No date" : d.toLocaleString();
}

/** A pull flagged this canonical event: both FamiliOS and Google changed it since
 * the last push/merge. The user picks which version to keep. */
const conflictOf = (e: EventRec) => e.provenance?.conflict ?? null;

/** Map a family member's color (accent name or hex) to a concrete theme color, so each
 * person's calendar items are color-coded consistently (matches the web app + avatars). */
function memberAccent(colors: ReturnType<typeof useTheme>["colors"], name?: string | null): string | null {
  if (!name) return null;
  if (name.startsWith("#")) return name;
  switch (name) {
    case "sage": return colors.sage;
    case "coral": return colors.coral;
    case "amber": return colors.amber;
    case "sky": return colors.sky;
    case "lavender": return colors.lavender;
    case "ember": return colors.ember;
    case "ink": return colors.textSecondary;
    default: return null;
  }
}

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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

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

  // Pull Google-side edits back into pushed canonical events (the merge-back half of
  // two-way sync). Clean edits merge; both-sides-changed flags a conflict to review.
  const pullEdits = useCallback(async () => {
    setPulling(true); setNotice(null);
    const r = await api.pullGoogleEdits();
    setPulling(false);
    if (r.ok) {
      await load();
      const bits = [
        r.merged ? `${r.merged} merged` : null,
        r.conflicts ? `${r.conflicts} conflict${r.conflicts === 1 ? "" : "s"} to review` : null,
        r.unlinked ? `${r.unlinked} unlinked` : null,
      ].filter(Boolean);
      setNotice({
        text: `Checked ${r.checked ?? 0} pushed event${(r.checked ?? 0) === 1 ? "" : "s"}. ${bits.length ? bits.join(" · ") : "Everything already matches Google."}`,
        ok: !r.conflicts,
      });
    } else {
      setNotice({
        text: r.error === "no_account"
          ? "Connect your Google account (with calendar access) in Connections first."
          : r.error === "insufficient_role"
            ? "Pulling Google edits needs Adult Member or higher."
            : `Couldn't pull Google edits: ${r.message ?? r.error ?? "unknown error"}`,
        ok: false,
      });
    }
  }, [load]);

  const nameOf = useCallback(
    (id: string | null) => (id ? members.find((m) => m.actorId === id)?.displayName ?? null : null),
    [members],
  );
  // Per-member calendar color: the server-set color if any, else a deterministic accent
  // hashed from the name — the SAME fallback the web app uses, so a member is the same color
  // on iOS and web even before anyone picks one.
  const colorOf = useCallback((id: string | null) => {
    const m = id ? members.find((x) => x.actorId === id) : null;
    if (!m) return null;
    if (m.color) return memberAccent(colors, m.color);
    const AV = ["ember", "sage", "sky", "lavender", "amber", "ink"];
    return memberAccent(colors, AV[[...m.displayName].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length]);
  }, [members, colors]);

  // Upcoming = anything undated or starting within the last 12h onward (ported).
  const upcoming = useMemo(() => [...events]
    .filter((e) => !e.startAt || new Date(e.startAt).getTime() >= Date.now() - 12 * 3600e3)
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))), [events]);
  const byDay = useMemo(() => {
    const map: Record<string, EventRec[]> = {};
    for (const e of upcoming) {
      const k = e.startAt && !isNaN(+new Date(e.startAt)) ? dayKey(new Date(e.startAt)) : "undated";
      (map[k] ??= []).push(e);
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

      {/* 14-day strip — dots mark days with plans; tap toggles a one-day focus. */}
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

      {/* Two-way Google sync: pull edits made on the Google side back into pushed events. */}
      {canManage ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
          <Button
            small
            variant="neutral"
            icon="arrow.down.circle"
            title={pulling ? "Checking…" : "Pull Google edits"}
            loading={pulling}
            onPress={() => void pullEdits()}
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
      ) : null}

      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

      {nothingAtAll ? (
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
            {subs.map((s, i) => (
              <Row
                key={s.id}
                icon="antenna.radiowaves.left.and.right"
                iconColor={colors.sky}
                iconBg={colors.skyBg}
                title={s.name}
                subtitle={syncLabel(s)}
                last={i === subs.length - 1}
                trailing={<Button small title="Sync" loading={syncing === s.id} onPress={() => void syncNow(s)} />}
              />
            ))}
          </Card>
        )}
      </Rise>
    </HScreen>
  );
}

/** One agenda entry: time rail on the left, event card on the right. */
function EventItem({ e, nameOf, colorOf, canManage, onChanged, expanded, onToggle }: {
  e: EventRec;
  nameOf: (id: string | null) => string | null;
  colorOf: (id: string | null) => string | null;
  canManage: boolean;
  onChanged: () => Promise<void> | void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { colors, spacing } = useTheme();
  const canonical = e.layer === "canonical";
  const start = fmtTime(e.startAt);
  const end = fmtTime(e.endAt);
  const driver = nameOf(e.driverId);
  const bring = e.whatToBring;
  const checklistDone = e.checklist.filter((c) => c.done).length;
  const conflict = conflictOf(e);
  // Per-member color coding: a left accent stripe in the first participant's color, and a
  // stacked colored dot per participant (uncolored members fall back to a neutral dot).
  const memberColors = e.participantIds.map((id) => colorOf(id)).filter(Boolean) as string[];
  const stripe = memberColors[0] ?? null;
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
        haptic={canonical ? "light" : "select"}
        onPress={canonical ? () => router.push({ pathname: "/event-form", params: { id: e.id } }) : onToggle}
        accessibilityRole="button"
        accessibilityLabel={canonical
          ? `${e.title}, ${start ?? "no time"}. Edit event`
          : `${e.title}, ${start ?? "no time"}. ${expanded ? "Collapse" : "Expand"} details`}
        style={stripe ? { borderLeftWidth: 3, borderLeftColor: stripe } : undefined}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <T kind="bodyMedium" color={colors.text} style={{ flex: 1 }} numberOfLines={2}>{e.title}</T>
          {conflict ? <Badge label="Sync conflict" fg={colors.coral} bg={colors.coralBg} icon="exclamationmark.triangle.fill" /> : null}
          {e.layer === "linked" ? <Badge label="Synced" fg={colors.sky} bg={colors.skyBg} icon="arrow.triangle.2.circlepath" /> : null}
          {e.layer === "public" ? <Badge label="Public" fg={colors.textMuted} bg={colors.surfaceSunken} icon="globe" /> : null}
          {canonical ? <Sym name="chevron.right" size={12} color={colors.textFaint} /> : null}
        </View>

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
