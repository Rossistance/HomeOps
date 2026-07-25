// Event form — create or edit a canonical FamiliOS event, presented as a form
// sheet. Native SwiftUI date/time pickers via @expo/ui (compact style inline on
// iOS; dialog presentation elsewhere). Edit mode (?id=) prefls from the server
// and adds a destructive delete. Synced (linked/public) events are read-only.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, Switch, TextInput, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { api, type ApprovalRec, type AttendeeRec, type EventRec, type MemberRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { loadDraft, saveDraft, clearDraft, isEmptyDraft, type EventDraft } from "@/lib/event-drafts";
import { useTheme, tapHaptic } from "@/theme";
import { AddressField } from "@/components/AddressField";
import { ActionBar, ACTION_BAR_HEIGHT } from "@/components/ui/action-bar";
// Deep imports (not the "@/components/ui" barrel): the legacy src/components/ui.tsx
// still shadows the ui/ directory until old screens are deleted centrally.
import { Badge, Chip, ChipRow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Well } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/list";
import { PressableScale } from "@/components/ui/pressable-scale";
import { HScreen } from "@/components/ui/screen";
import { SkeletonCards } from "@/components/ui/skeleton";
import { EmptyState, Notice } from "@/components/ui/states";
import { Sym } from "@/components/ui/symbol";
import { T } from "@/components/ui/text";

const MANAGE_ROLES = ["Owner", "Adult Admin", "Adult Member", "Limited Member"];
// Remembered "also update Google on save" consent (WP-004/ISS-008, DEC-06).
const ALSO_GOOGLE_KEY = "familios_save_also_google";

/** Merge a calendar day and a clock time into one local Date. */
function stamp(day: Date, time: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.getHours(), time.getMinutes(), 0, 0);
}

function nextFullHour(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** Labeled date/time field. iOS renders the native compact SwiftUI picker inline;
 * other platforms show the value and open the native dialog picker on tap. */
function PickerField({ label, value, mode, onChange, disabled }: {
  label: string;
  value: Date;
  mode: "date" | "time";
  onChange: (d: Date) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const [dialogOpen, setDialogOpen] = useState(false);
  const ios = process.env.EXPO_OS === "ios";
  const text = mode === "date"
    ? value.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : value.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40, gap: 12 }}>
      <T kind="bodyMedium" color={colors.textSecondary}>{label}</T>
      {ios ? (
        <DateTimePicker
          value={value}
          mode={mode}
          display="compact"
          accentColor={colors.ember}
          disabled={disabled}
          onValueChange={(_e, d) => onChange(d)}
        />
      ) : (
        <>
          <PressableScale
            haptic="select"
            disabled={disabled}
            onPress={() => setDialogOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${text}. Change`}
            style={{ backgroundColor: colors.surface, borderRadius: 10, borderCurve: "continuous", paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.border }}
          >
            <T kind="bodyMedium" color={colors.ember}>{text}</T>
          </PressableScale>
          {dialogOpen ? (
            <DateTimePicker
              value={value}
              mode={mode}
              presentation="dialog"
              accentColor={colors.ember}
              onValueChange={(_e, d) => { setDialogOpen(false); onChange(d); }}
              onDismiss={() => setDialogOpen(false)}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

export default function EventFormScreen() {
  const params = useLocalSearchParams<{ id?: string; date?: string }>();
  const id = typeof params.id === "string" && params.id ? params.id : null;
  const isEdit = !!id;
  const { session } = useSession();
  const { colors, spacing, type } = useTheme();
  const canManage = MANAGE_ROLES.includes(session?.role ?? "");

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  // Google-originated linked events are editable TWO-WAY: the server writes the
  // edit to Google first, then mirrors it locally. ICS-fed events stay read-only.
  const [linkedGoogle, setLinkedGoogle] = useState(false);
  const [members, setMembers] = useState<MemberRec[]>([]);

  // Fields
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [scheduled, setScheduled] = useState(true);
  const [day, setDay] = useState<Date>(() => {
    // "+ on a focused strip day" pre-picks that day.
    if (typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
      const d = new Date(`${params.date}T00:00:00`);
      if (!isNaN(+d)) return d;
    }
    return new Date();
  });
  const [start, setStart] = useState<Date>(nextFullHour);
  const [hasEnd, setHasEnd] = useState(false);
  const [end, setEnd] = useState<Date>(() => { const d = nextFullHour(); d.setHours(d.getHours() + 1); return d; });
  // WP-003/ISS-004: the end has its own DAY — camps, trips, and overnights span days.
  const [endDay, setEndDay] = useState<Date>(() => new Date());
  // WP-003/ISS-005: all-day events — real model concept, not a faked time.
  const [allDay, setAllDay] = useState(false);
  const [driverId, setDriverId] = useState<string | null>(null);
  /* E5 [12:26] — "replace or augment the note-for-driver with WHO'S ATTENDING: let me pick
   * GPop, Beannie, Melissa." Attendees are saved through their own endpoint rather than the
   * event PATCH, because setting them has a side effect the PATCH must not have: it NOTIFIES
   * the people added (E6), and it has to preserve answers people already gave (E7). */
  const [attendees, setAttendees] = useState<AttendeeRec[]>([]);
  const [attendeeBusy, setAttendeeBusy] = useState(false);
  const [bring, setBring] = useState<{ item: string; memberId: string | null }[]>([]);
  const [bringInput, setBringInput] = useState("");
  // WP-003/ISS-006: general notes — the server has stored EventRec.notes all
  // along (and Google description mirrors it); the editor finally exposes it.
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState<"save" | "delete" | "push" | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  // Google push (canonical events only) — approval-gated exactly as web does it.
  const [googleEventId, setGoogleEventId] = useState<string | null>(null);
  const [pushApproval, setPushApproval] = useState<ApprovalRec | null>(null);
  // WP-004/ISS-008 (DEC-06): ONE primary Save with an inline, remembered
  // "also update Google" consent — the approval gate stays; nothing external
  // happens silently. Remembered per device.
  const [alsoGoogle, setAlsoGoogle] = useState(false);
  useEffect(() => {
    void SecureStore.getItemAsync(ALSO_GOOGLE_KEY)
      .then((v) => { if (v === "1") setAlsoGoogle(true); })
      .catch(() => { /* first run */ });
  }, []);
  const setAlsoGoogleRemembered = (v: boolean) => {
    setAlsoGoogle(v);
    void SecureStore.setItemAsync(ALSO_GOOGLE_KEY, v ? "1" : "0").catch(() => {});
  };

  useEffect(() => {
    void (async () => {
      const [mem, evs] = await Promise.all([api.members(), id ? api.events() : Promise.resolve([] as EventRec[])]);
      setMembers(mem);
      if (id) {
        const e = evs.find((x) => x.id === id);
        if (!e) {
          setNotFound(true);
        } else {
          // Edit-own-only: the server tells us whether THIS member may edit this event
          // (a linked Google event is editable only by the member who connected it).
          const canEdit = e.editable !== false;
          const lg = e.layer === "linked" && !!e.provenance?.googleEventId && canEdit;
          setLinkedGoogle(lg);
          setReadOnly(!canEdit || (e.layer !== "canonical" && !lg));
          setGoogleEventId(e.provenance?.googleEventId ?? null);
          setTitle(e.title);
          setLocation(e.location ?? "");
          setNotes(e.notes ?? "");
          setDriverId(e.driverId);
          // An event from before this feature has participantIds but no answers. Reading that
          // as "everyone accepted" would show a card claiming three people said yes when
          // nobody was ever asked.
          setAttendees(e.attendees ?? (e.participantIds ?? []).map((m) => ({ memberId: m, status: "invited" as const, respondedAt: null })));
          setBring(e.whatToBring.map((w) => ({ item: w.item, memberId: w.memberId })));
          const s = e.startAt ? new Date(e.startAt) : null;
          if (s && !isNaN(+s)) {
            setScheduled(true); setDay(s); setStart(s); setEndDay(s);
            setAllDay(e.allDay === true);
            const en = e.endAt ? new Date(e.endAt) : null;
            if (en && !isNaN(+en)) { setHasEnd(true); setEnd(en); setEndDay(en); }
          } else {
            setScheduled(false);
          }
        }
      }
      setLoading(false);
    })();
  }, [id]);

  /* ISS-123 — unsaved drafts survive dismissal and backgrounding.
   * Keyed per household + draft id ("new" when creating, the event id when editing), so
   * two half-finished edits never overwrite each other. Restored AFTER the server prefill
   * above, because a draft is by definition the newer, unsaved state. Cleared ONLY by a
   * successful save or an explicit discard — dismissing the sheet is not a discard. */
  // C3 — [13:37] "the 'what to bring' field is at the bottom of the screen; when I tap it
  // the keyboard covers it and it doesn't scroll up." The keyboard inset alone can't fix that
  // now: the pinned Save bar sits over the last ~76pt of content, and the inset knows nothing
  // about it. So this screen scrolls that field into view itself.
  const scroller = useRef<ScrollView>(null);
  const bringY = useRef(0);
  const householdId = session?.householdId ?? null;
  const draftId = id ?? "new";
  const [draftRestored, setDraftRestored] = useState(false);
  const restoreTried = useRef(false);
  // Snapshot of the form as it was loaded (server prefill for an edit, empty for a
  // create). Without it, opening an existing event would immediately "draft" its own
  // unchanged contents, and the next open would announce a restore that never happened.
  const baselineRef = useRef<string | null>(null);
  const buildDraft = (): EventDraft => ({
    title, location, notes, scheduled, allDay, hasEnd,
    day: day.toISOString(), start: start.toISOString(), end: end.toISOString(), endDay: endDay.toISOString(),
    driverId, bring, bringInput, savedAt: new Date().toISOString(),
  });
  // Content signature — the timestamp is deliberately excluded so an untouched form
  // never looks "changed" just because time passed.
  const draftSignature = (d: EventDraft) => JSON.stringify({ ...d, savedAt: "" });

  useEffect(() => {
    if (loading || !householdId || restoreTried.current) return;
    restoreTried.current = true;
    baselineRef.current = draftSignature(buildDraft()); // what "unchanged" looks like
    void (async () => {
      const d = await loadDraft(householdId, draftId);
      if (!d) return;
      // A draft identical to what's already on screen isn't a restore — say nothing.
      if (draftSignature(d) === baselineRef.current) return;
      const revive = (iso: string, fallback: Date) => { const x = new Date(iso); return isNaN(+x) ? fallback : x; };
      setTitle(d.title); setLocation(d.location); setNotes(d.notes);
      setScheduled(d.scheduled); setAllDay(d.allDay); setHasEnd(d.hasEnd);
      setDay(revive(d.day, new Date()));
      setStart(revive(d.start, nextFullHour()));
      setEnd(revive(d.end, nextFullHour()));
      setEndDay(revive(d.endDay, new Date()));
      setDriverId(d.driverId); setBring(d.bring ?? []); setBringInput(d.bringInput ?? "");
      setDraftRestored(true);
    })();
  }, [loading, householdId, draftId]);

  // Write the draft as it's typed (debounced), so dismissal and backgrounding are both
  // already covered — there is no unmount handler to miss. An untouched blank editor
  // leaves nothing behind, or every cancelled "+" would resurrect an empty form.
  useEffect(() => {
    if (loading || readOnly || !householdId || baselineRef.current === null) return;
    const draft = buildDraft();
    // Nothing typed, or nothing changed from what was loaded ⇒ no draft to keep, and
    // clear any stale one so a saved edit can't leave a ghost behind.
    if (isEmptyDraft(draft) || draftSignature(draft) === baselineRef.current) { void clearDraft(householdId, draftId); return; }
    const t = setTimeout(() => { void saveDraft(householdId, draftId, draft); }, 400);
    return () => clearTimeout(t);
  }, [loading, readOnly, householdId, draftId, title, location, notes, scheduled, allDay,
      hasEnd, day, start, end, endDay, driverId, bring, bringInput]);

  const discardDraft = useCallback(() => {
    if (householdId) void clearDraft(householdId, draftId);
    setDraftRestored(false);
    tapHaptic("select");
    router.back();
  }, [householdId, draftId]);

  /** Local midnight of a calendar day — the all-day anchor (keeps ISO timestamps
   * so every existing sort/render path holds; renderers key off `allDay`). */
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  // Cross-day validation (ISS-004): the end may be a later DAY; same-day timed
  // ends must still be after the start; all-day ends may share the start day.
  const endInvalid = scheduled && hasEnd && (allDay
    ? +midnight(endDay) < +midnight(day)
    : +stamp(endDay, end) <= +stamp(day, start));
  const canSave = canManage && !readOnly && title.trim().length > 0 && !endInvalid && busy === null;

  const addBring = useCallback(() => {
    const items = bringInput.split(",").map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) return;
    setBring((b) => [...b, ...items.map((item) => ({ item, memberId: null }))]);
    setBringInput("");
  }, [bringInput]);

  const save = async () => {
    if (!canSave) return;
    setBusy("save"); setNotice(null);
    // All-day events anchor at local midnight and carry the explicit allDay flag;
    // timed events merge each calendar day with its clock time (end may cross days).
    const startAt = !scheduled ? null : allDay ? midnight(day).toISOString() : stamp(day, start).toISOString();
    const endAt = !scheduled || !hasEnd ? null : allDay ? midnight(endDay).toISOString() : stamp(endDay, end).toISOString();
    // Include anything still typed into the bring field so it isn't silently lost.
    const pendingBring = bringInput.split(",").map((s) => s.trim()).filter(Boolean).map((item) => ({ item, memberId: null as string | null }));
    const whatToBring = [...bring, ...pendingBring];
    const body = { title: title.trim(), startAt, endAt, allDay: scheduled && allDay, notes: notes.trim(), location: location.trim(), driverId, whatToBring };
    const r = isEdit
      ? await api.updateEvent(id, body)
      : await api.createEvent({ ...body, visibility: "household" });
    setBusy(null);
    if (r.event) {
      tapHaptic("success");
      // Saved ⇒ the draft has done its job and must not resurrect later (ISS-123).
      if (householdId) void clearDraft(householdId, draftId);
      // One-save (DEC-06): with the remembered consent ON, saving also updates
      // Google — through the SAME approval gate (first push surfaces the inline
      // approval panel; nothing external happens silently).
      if (alsoGoogle && isEdit && !linkedGoogle) {
        const pushed = await push();
        if (pushed?.ok) router.back();
        // needsApproval or error: stay on the form — the approval panel/notice shows.
        return;
      }
      router.back();
    } else {
      setNotice({
        text: r.error === "insufficient_role"
          ? "Saving events needs Limited Member or higher."
          : r.error === "needs_reconnect"
            ? "Your Google account needs reconnecting in Connections before this event can be edited."
            : `Couldn't save: ${r.message ?? r.error ?? "unknown error"}`,
        ok: false,
      });
    }
  };

  const confirmDelete = () => {
    if (!isEdit) return;
    Alert.alert(
      "Delete event?",
      linkedGoogle
        ? `“${title.trim() || "This event"}” will be deleted from Google Calendar and the household calendar.`
        : `“${title.trim() || "This event"}” will be removed from the household calendar.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: () => void (async () => {
            setBusy("delete"); setNotice(null);
            const r = await api.deleteEvent(id);
            setBusy(null);
            if (r.ok) { tapHaptic("success"); router.back(); }
            else setNotice({ text: r.error === "insufficient_role" ? "Deleting events needs Limited Member or higher." : `Couldn't delete: ${r.error ?? "unknown error"}`, ok: false });
          })(),
        },
      ],
    );
  };

  // Push this canonical event TO Google. Approval-first: the first call returns a
  // pending approval; approving it and pushing again (with the id) does the write.
  const push = async (approvalId?: string) => {
    if (!id) return undefined;
    setBusy("push"); setNotice(null);
    const r = await api.pushEventToGoogle(id, approvalId);
    setBusy(null);
    if (r.ok) {
      setPushApproval(null);
      if (r.googleEventId) setGoogleEventId(r.googleEventId);
      tapHaptic("success");
      setNotice({ text: `Google Calendar ${r.action ?? "updated"}.`, ok: true });
    } else if (r.needsApproval && r.approval) {
      setPushApproval(r.approval);
    } else {
      setNotice({
        text: r.error === "insufficient_role"
          ? "Pushing to Google needs Adult Member or higher."
          : r.error === "connect_google_first" || r.error === "calendar_scope_missing"
            ? (r.message ?? "Connect your Google account with calendar access in Connections first.")
            : r.error === "no_start"
              ? "Give the event a start time before pushing it to Google."
              : `Couldn't push: ${r.message ?? r.error ?? "unknown error"}`,
        ok: false,
      });
    }
    return r;
  };
  // One tap once the panel is shown: approve through the same server gate, then
  // immediately execute the push with the consumed approval.
  const approveAndPush = async () => {
    if (!pushApproval) return;
    setBusy("push");
    const d = await api.decideApproval(pushApproval.id, true);
    if (d.error || !d.approval) {
      setBusy(null);
      setNotice({ text: `Couldn't approve: ${d.error === "insufficient_role" ? "adults only" : d.error ?? "approval failed"}.`, ok: false });
      return;
    }
    await push(pushApproval.id);
  };
  const denyPush = async () => {
    if (!pushApproval) return;
    setBusy("push");
    await api.decideApproval(pushApproval.id, false);
    setBusy(null);
    setPushApproval(null);
    setNotice({ text: "Push cancelled.", ok: true });
  };

  const inputStyle = useMemo(() => ([
    type.body,
    { color: colors.text, paddingVertical: 10, paddingHorizontal: 0 },
  ]), [type, colors]);

  const header = <Stack.Screen options={{ title: isEdit ? (readOnly ? "Event" : "Edit event") : "New event" }} />;

  if (loading) {
    return (
      <HScreen>
        {header}
        <SkeletonCards count={3} lines={1} />
      </HScreen>
    );
  }

  if (notFound) {
    return (
      <HScreen>
        {header}
        <EmptyState
          icon="calendar.badge.exclamationmark"
          title="Event not found"
          hint="It may have been removed or synced away."
          action={{ title: "Close", onPress: () => router.back() }}
        />
      </HScreen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <HScreen bottomPad={ACTION_BAR_HEIGHT + 24} scrollRef={scroller}>
      {header}

      {!canManage ? (
        <Notice text="Viewing only — creating and editing events needs Limited Member or higher." ok={false} />
      ) : null}
      {readOnly ? (
        <Notice text="Read-only — this is synced from another calendar (you can only edit your own). Edit it at the source." ok={false} />
      ) : null}
      {linkedGoogle ? (
        <Notice text="Synced from Google Calendar — changes you save here update it in Google too." ok />
      ) : null}
      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}
      {/* ISS-123: say plainly that the draft came back, and give the ONLY other way to
          clear it besides saving — dismissing deliberately keeps it. */}
      {draftRestored ? (
        <View style={{ gap: spacing.sm }}>
          <Notice text="Restored your unsaved draft — it was kept when you closed the editor." ok />
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <PressableScale onPress={discardDraft} haptic={null} hitSlop={8} accessibilityRole="button" accessibilityLabel="Discard this draft">
              <T kind="subMedium" color={colors.coral}>Discard draft</T>
            </PressableScale>
          </View>
        </View>
      ) : null}

      {/* Title */}
      <Well>
        <TextInput
          style={inputStyle}
          placeholder="Event title (e.g. Soccer practice)"
          placeholderTextColor={colors.textFaint}
          value={title}
          // ISS-109: a one-line field scrolled a long title out of view as you typed it —
          // "I can't read any of it". Multiline lets it WRAP and grow (inputStyle sets no
          // fixed height). It stays a single-value field: newlines are stripped, and
          // submitBehavior overrides multiline's default of inserting one, so Return moves
          // to Location instead (the Next/Done navigation this slice calls for).
          multiline
          submitBehavior="blurAndSubmit"
          onChangeText={(t) => setTitle(t.replace(/[\r\n]+/g, " "))}
          editable={!readOnly && canManage}
          accessibilityLabel="Event title"
          returnKeyType="done"
        />
      </Well>

      {/* Schedule */}
      <SectionHeader title="Schedule" />
      <Well style={{ gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40 }}>
          <T kind="bodyMedium" color={colors.textSecondary}>Scheduled</T>
          <Switch
            value={scheduled}
            onValueChange={(v) => { tapHaptic("select"); setScheduled(v); }}
            trackColor={{ true: colors.ember }}
            disabled={readOnly || !canManage}
            accessibilityLabel="Event has a date and time"
          />
        </View>
        {scheduled ? (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.xs }}>
            {/* All-day (ISS-005): a real model flag — time pickers disappear, no fake times */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40 }}>
              <T kind="bodyMedium" color={colors.textSecondary}>All-day</T>
              <Switch
                value={allDay}
                onValueChange={(v) => { tapHaptic("select"); setAllDay(v); }}
                trackColor={{ true: colors.ember }}
                disabled={readOnly || !canManage}
                accessibilityLabel="All-day event"
              />
            </View>
            <PickerField label={hasEnd ? "Start date" : "Date"} value={day} mode="date" onChange={setDay} disabled={readOnly || !canManage} />
            {!allDay ? <PickerField label="Starts" value={start} mode="time" onChange={setStart} disabled={readOnly || !canManage} /> : null}
            {hasEnd ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  {/* End DAY picker (ISS-004): camps and overnights span days */}
                  <PickerField label="End date" value={endDay} mode="date" onChange={setEndDay} disabled={readOnly || !canManage} />
                  {!allDay ? <PickerField label="Ends" value={end} mode="time" onChange={setEnd} disabled={readOnly || !canManage} /> : null}
                </View>
                {!readOnly && canManage ? (
                  <PressableScale haptic="select" hitSlop={8} onPress={() => setHasEnd(false)} accessibilityRole="button" accessibilityLabel="Remove end time">
                    <Sym name="xmark.circle.fill" size={18} color={colors.textFaint} />
                  </PressableScale>
                ) : null}
              </View>
            ) : !readOnly && canManage ? (
              <PressableScale
                haptic="select"
                onPress={() => {
                  const d = stamp(day, start); d.setHours(d.getHours() + 1);
                  setEnd(d); setEndDay(day); setHasEnd(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Add end time"
                style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 }}
              >
                <Sym name="plus.circle" size={15} color={colors.ember} />
                <T kind="subMedium" color={colors.ember}>{allDay ? "Add end date" : "Add end time"}</T>
              </PressableScale>
            ) : null}
            {endInvalid ? (
              <T kind="sub" color={colors.coral}>{allDay ? "The end date can't be before the start date." : "The end must be after the start (use End date for overnights)."}</T>
            ) : null}
          </View>
        ) : (
          <T kind="sub" color={colors.textFaint}>No date — the event shows under “No date set”.</T>
        )}
      </Well>

      {/* Location — E1 autocomplete, E2 tap-to-navigate, E3 an edit button (AddressField). */}
      <SectionHeader title="Location" />
      <AddressField
        value={location}
        onChange={setLocation}
        editable={!readOnly && canManage}
        inputStyle={inputStyle}
      />

      {/* Notes (ISS-006 — carried into the Google description on push) */}
      <SectionHeader title="Notes" />
      <Well>
        <TextInput
          style={[inputStyle, { minHeight: 72, textAlignVertical: "top" }]}
          placeholder="Anything the family should know (optional)"
          placeholderTextColor={colors.textFaint}
          value={notes}
          onChangeText={setNotes}
          editable={!readOnly && canManage}
          multiline
          accessibilityLabel="Event notes"
        />
      </Well>

      {/* E5/E6/E7 — who's attending, whether they've been told, and what they said. */}
      {isEdit ? (
        <>
          <SectionHeader title="Who's coming" />
          <View style={{ gap: spacing.sm }}>
            <ChipRow>
              {members.map((m) => {
                const row = attendees.find((a) => a.memberId === m.actorId);
                return (
                  <Chip
                    key={m.actorId}
                    label={m.displayName.split(" ")[0]}
                    icon={row?.status === "accepted" ? "checkmark.circle.fill" : row?.status === "declined" ? "xmark.circle.fill" : row ? "person.fill" : "person"}
                    selected={!!row}
                    onPress={readOnly || !canManage || attendeeBusy ? undefined : () => void (async () => {
                      const next = row
                        ? attendees.filter((a) => a.memberId !== m.actorId).map((a) => a.memberId)
                        : [...attendees.map((a) => a.memberId), m.actorId];
                      setAttendeeBusy(true);
                      const r = await api.setEventAttendees(id!, next);
                      setAttendeeBusy(false);
                      if (!r.event) {
                        setNotice({ text: r.message ?? "Couldn't change who's coming.", ok: false });
                        return;
                      }
                      tapHaptic("success");
                      setAttendees(r.event.attendees ?? []);
                      // Say what actually happened. "Added" without "and told them" is the
                      // kind of half-truth this app has been rooting out.
                      if (r.notified) setNotice({ text: `${m.displayName.split(" ")[0]} has been told they're on this.`, ok: true });
                    })()}
                  />
                );
              })}
            </ChipRow>
            {attendees.length > 0 ? (
              <View style={{ gap: 4 }}>
                {attendees.map((a) => {
                  const m = members.find((x) => x.actorId === a.memberId);
                  const mine = a.memberId === session?.actorId;
                  const tone = a.status === "accepted" ? colors.sage : a.status === "declined" ? colors.coral : colors.textFaint;
                  return (
                    <View key={a.memberId} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 34 }}>
                      <Sym
                        name={a.status === "accepted" ? "checkmark.circle.fill" : a.status === "declined" ? "xmark.circle.fill" : "clock"}
                        size={14} color={tone}
                      />
                      <T kind="sub" color={colors.text} style={{ flex: 1 }}>
                        {m?.displayName ?? a.memberId}
                        <T kind="sub" color={tone}>
                          {a.status === "accepted" ? " · coming" : a.status === "declined" ? " · can't make it" : " · hasn't answered"}
                        </T>
                      </T>
                      {/* E7 — the accept/decline pair, and only for your OWN row: the server
                          refuses answering for anyone else unless you're an adult. */}
                      {mine ? (
                        <View style={{ flexDirection: "row", gap: 6 }}>
                          {(["accepted", "declined"] as const).map((want) => (
                            <PressableScale
                              key={want}
                              haptic="select"
                              disabled={attendeeBusy || a.status === want}
                              onPress={() => void (async () => {
                                setAttendeeBusy(true);
                                const r = await api.rsvpEvent(id!, want);
                                setAttendeeBusy(false);
                                if (!r.event) { setNotice({ text: r.message ?? "Couldn't send your answer.", ok: false }); return; }
                                tapHaptic(want === "accepted" ? "success" : "light");
                                setAttendees(r.event.attendees ?? []);
                              })()}
                              accessibilityRole="button"
                              accessibilityLabel={want === "accepted" ? "I'm coming" : "I can't make it"}
                              style={{
                                paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999,
                                backgroundColor: a.status === want ? (want === "accepted" ? colors.sageBg : colors.coralBg) : colors.surfaceSunken,
                                opacity: attendeeBusy ? 0.6 : 1,
                              }}
                            >
                              <T kind="caption" color={want === "accepted" ? colors.sage : colors.coral} style={{ fontWeight: "600" }}>
                                {want === "accepted" ? "I'm in" : "Can't"}
                              </T>
                            </PressableScale>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : (
              <T kind="caption" color={colors.textFaint}>
                Nobody added yet. Picking someone tells them they&apos;re on it, and they can answer.
              </T>
            )}
          </View>
        </>
      ) : null}

      {/* Driver — kept alongside attendees, not replaced by them: "who's driving" is a
          different question from "who's coming", and a carpool needs both. */}
      <SectionHeader title="Driver" />
      <ChipRow>
        <Chip label="No driver" selected={driverId === null} onPress={readOnly || !canManage ? undefined : () => setDriverId(null)} />
        {members.map((m) => (
          <Chip
            key={m.actorId}
            label={m.displayName}
            icon="car.fill"
            selected={driverId === m.actorId}
            onPress={readOnly || !canManage ? undefined : () => setDriverId(driverId === m.actorId ? null : m.actorId)}
          />
        ))}
      </ChipRow>

      {/* What to bring */}
      <SectionHeader title="What to bring" />
      {bring.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {bring.map((w, i) => (
            <PressableScale
              key={`${w.item}-${i}`}
              haptic="select"
              disabled={readOnly || !canManage}
              onPress={() => setBring((b) => b.filter((_, j) => j !== i))}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${w.item}`}
              style={{
                flexDirection: "row", alignItems: "center", gap: 6,
                backgroundColor: colors.amberBg, borderRadius: 999,
                paddingHorizontal: 12, paddingVertical: 7,
              }}
            >
              <Sym name="bag.fill" size={12} color={colors.amber} />
              <T kind="subMedium" color={colors.amber}>{w.item}</T>
              {!readOnly && canManage ? <Sym name="xmark" size={10} color={colors.amber} /> : null}
            </PressableScale>
          ))}
        </View>
      ) : null}
      {!readOnly && canManage ? (
        <Well
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
          onLayout={(e) => { bringY.current = e.nativeEvent.layout.y; }}
        >
          <TextInput
            style={[inputStyle, { flex: 1 }]}
            placeholder="Cleats, water bottle, snacks…"
            placeholderTextColor={colors.textFaint}
            value={bringInput}
            onChangeText={setBringInput}
            onSubmitEditing={addBring}
            // Scroll it clear of both the keyboard and the pinned Save bar. Delayed so the
            // keyboard's own inset animation has already been applied.
            onFocus={() => setTimeout(() => scroller.current?.scrollTo({ y: Math.max(0, bringY.current - 90), animated: true }), 180)}
            accessibilityLabel="Add items to bring, comma-separated"
            returnKeyType="done"
          />
          <Button small title="Add" onPress={addBring} disabled={!bringInput.trim()} />
        </Well>
      ) : null}

      {/* Actions */}
      {!readOnly && canManage ? (
        <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
          {/* Inline Google-push approval (mirrors web's one-step approve & push). */}
          {pushApproval ? (
            <Well style={{ gap: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.amber }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <T kind="rowTitle" style={{ flex: 1 }}>Push “{title.trim() || "this event"}” to your Google Calendar?</T>
                <Badge label={`${pushApproval.risk} risk`} fg={colors.amber} bg={colors.amberBg} />
              </View>
              {pushApproval.preview ? <T kind="sub" color={colors.textSecondary}>{pushApproval.preview}</T> : null}
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button title="Approve & push" small variant="success" icon="checkmark" loading={busy === "push"} onPress={() => void approveAndPush()} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Deny" small variant="danger" icon="xmark" disabled={busy === "push"} onPress={() => void denyPush()} />
                </View>
              </View>
            </Well>
          ) : null}
          {/* One-save (ISS-008/DEC-06): the separate "Update in Google" button is
              gone — a remembered inline consent rides along with the primary Save.
              The first push still goes through the approval gate (panel above). */}
          {isEdit && !linkedGoogle ? (
            <Well style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Sym name="arrow.up.circle" size={16} color={colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <T kind="bodyMedium" color={colors.textSecondary}>
                  {googleEventId ? "Also update in Google Calendar" : "Also add to my Google Calendar"}
                </T>
                <T kind="sub" color={colors.textFaint}>
                  {alsoGoogle ? "Saving syncs Google too — you approve the first push." : "Off — saving changes FamiliOS only."}
                </T>
              </View>
              <Switch
                value={alsoGoogle}
                onValueChange={(v) => { tapHaptic("select"); setAlsoGoogleRemembered(v); }}
                trackColor={{ true: colors.ember }}
                disabled={busy !== null}
                accessibilityLabel="Also update Google Calendar when saving"
              />
            </Well>
          ) : null}
          {/* Save has left the scroll — see the ActionBar below. Delete stays down here on
              purpose: a destructive action should take a deliberate scroll to reach. */}
          {isEdit ? (
            <Button
              title="Delete event"
              variant="danger"
              full
              loading={busy === "delete"}
              disabled={busy !== null}
              onPress={confirmDelete}
            />
          ) : null}
        </View>
      ) : null}
      </HScreen>

      {/* C4/C5 — [15:03] "Save is not visible at all… that's crucial", and [13:48] "Save
          changes should be closer to the text entry." Both are answered by taking the commit
          control out of the scrolling content: it's pinned, and it rides the keyboard up, so
          when a field is focused Save is directly above the keys. */}
      {!readOnly && canManage ? (
        <ActionBar>
          <Button
            title={isEdit ? (alsoGoogle && !linkedGoogle ? "Save & update Google" : "Save changes") : "Add event"}
            variant="ember"
            full
            loading={busy === "save" || (busy === "push" && !pushApproval)}
            disabled={!canSave}
            onPress={() => void save()}
          />
          {/* Why Save is unavailable, at the moment it's unavailable — rather than a dead
              button and no explanation. */}
          {!canSave && busy === null ? (
            <T kind="caption" center color={colors.textFaint}>
              {!title.trim() ? "Give it a title to save." : endInvalid ? "Fix the end time to save." : ""}
            </T>
          ) : null}
        </ActionBar>
      ) : null}
    </View>
  );
}
