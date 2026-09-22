// Event form — create or edit a canonical FamiliOS event, presented as a form
// sheet. Native SwiftUI date/time pickers via @expo/ui (compact style inline on
// iOS; dialog presentation elsewhere). Edit mode (?id=) prefls from the server
// and adds a destructive delete. Synced (linked/public) events are read-only.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard, ScrollView, Switch, TextInput, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { api, type ApprovalRec, type AttendeeRec, type EventRec, type MemberRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { loadDraft, saveDraft, clearDraft, isEmptyDraft, type EventDraft } from "@/lib/event-drafts";
import { useTheme, tapHaptic } from "@/theme";
import { depth, rimColor, rimGlow } from "@/theme/neumorph";
import { AddressField } from "@/components/AddressField";
import { useShareToThread, localPreview } from "@/components/sheets/share-to-thread-sheet";
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
/** The offsets the server accepts — the same list the task sheet offers (server/reminders.mjs
 * REMINDER_CHOICES). Events had no reminders while tasks did; now they share the menu. */
const REMINDERS: { minutes: number | null; label: string }[] = [
  { minutes: null, label: "None" },
  { minutes: 0, label: "At the time" },
  { minutes: 5, label: "5 min before" },
  { minutes: 10, label: "10 min before" },
  { minutes: 15, label: "15 min before" },
  { minutes: 30, label: "30 min before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 1440, label: "1 day before" },
];

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
  const { colors, dark, spacing, type } = useTheme();
  const canManage = MANAGE_ROLES.includes(session?.role ?? "");

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const shareTo = useShareToThread();
  /* Cluster D — whose event this IS decides what this form is. The household Owner got a
   * full edit surface on his father-in-law's event; the server now refuses those writes,
   * and a form that offers what the server refuses is a lie with input fields. */
  const [eventOwnerId, setEventOwnerId] = useState<string | null>(null);
  const [requests, setRequests] = useState<NonNullable<EventRec["requests"]>>({});
  const [myBring, setMyBring] = useState<{ item: string }[]>([]);
  const [askBusy, setAskBusy] = useState<string | null>(null);
  /* Q2 — "it says edit at the source or copy it on the web app. Let me append to it here
   * without syncing it back out." Read-only was answering the wrong question: the calendar
   * this event came from owns its title, time and place, but who's coming, what to bring, a
   * reminder and your own notes are FamiliOS's, and it can take those. So the form stops
   * being all-or-nothing — the source's half stays locked, the household's half opens up. */
  const [canAppend, setCanAppend] = useState(false);
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
  // Minutes-before nudges, multi-select like a task's ("the day before AND one hour before").
  const [remindSet, setRemindSet] = useState<Set<number>>(new Set());
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
  // Kept deliberately separate from `notes`: notes is the event's description and travels
  // to Google on a push, this never leaves FamiliOS. Same screen, different promise.
  const [localNotes, setLocalNotes] = useState("");

  const [busy, setBusy] = useState<"save" | "delete" | "push" | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [sourceInfoOpen, setSourceInfoOpen] = useState(false);
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
          // Q2 — a mirror you can't EDIT can still be added to. Two different questions.
          setCanAppend(e.appendable !== false);
          setGoogleEventId(e.provenance?.googleEventId ?? null);
          setTitle(e.title);
          setLocation(e.location ?? "");
          setNotes(e.notes ?? "");
          setEventOwnerId(e.ownerId ?? e.createdBy ?? null);
          setRequests(e.requests ?? {});
          // The viewer's own margin wins over the legacy shared field: localNotes is what
          // the OWNER wrote on a mirror, myNotes is what I wrote for me.
          setLocalNotes(e.myNotes?.note ?? (e.ownerId === session?.actorId ? (e.localNotes ?? "") : ""));
          setMyBring(e.myNotes?.bring ?? []);
          setRemindSet(new Set(e.remindOffsets ?? []));
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
    driverId, bring, bringInput, remindOffsets: [...remindSet].sort((a, b) => a - b), savedAt: new Date().toISOString(),
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
      setRemindSet(new Set(d.remindOffsets ?? []));
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
      hasEnd, day, start, end, endDay, driverId, bring, bringInput, remindSet]);

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
  // On a mirrored event there is nothing to validate — its title and times aren't ours to
  // change — so Save turns on as soon as there's something of ours to keep.
  const appendOnly = readOnly && canAppend;
  /* Creating → it's yours. Editing → only if it actually is. Everything the owner controls
   * (attendees, driver, the shared bring list) keys off THIS, not off role — the narrator
   * demonstrating the bug was the household Owner, the most privileged role there is. */
  /* Whose event is it — and the case the first pass at this missed.
   *
   * A MEMBER's event (GPop's ride, Melissa's dance) is theirs alone to change. But a
   * HOUSEHOLD FEED mirror — the school's early-dismissal ICS — has no member owner, and its
   * FamiliOS half (who from this family is going, what to bring) is collective. The server
   * already draws that line; the client didn't, so on exactly those events it locked
   * controls the server would have accepted, quietly removing the Q2 behaviour he asked for
   * and has been using. No member owner → an adult is the steward. */
  const isOwnerOfEvent = !isEdit
    || (eventOwnerId != null && eventOwnerId === session?.actorId)
    || (eventOwnerId == null && canManage);
  const ownerControls = canManage && isOwnerOfEvent;
  const canSave = canManage && busy === null && (appendOnly || !isOwnerOfEvent || (!readOnly && title.trim().length > 0 && !endInvalid));
  /** The household's half of the event — open even when the source owns the rest. */
  const localEditable = canManage && (!readOnly || canAppend);
  const iAmParticipant = attendees.some((a) => a.memberId === session?.actorId);
  const pendingAttend = (requests.attend ?? []).some((r) => r.actorId === session?.actorId);
  const pendingDrive = (requests.drive ?? []).some((r) => r.actorId === session?.actorId);

  const addBring = useCallback(() => {
    const items = bringInput.split(",").map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) return;
    setBring((b) => [...b, ...items.map((item) => ({ item, memberId: null }))]);
    setBringInput("");
  }, [bringInput]);

  const save = async () => {
    if (!canSave) return;
    /* BUG-03 — "the pop-up did not retract. We're going to do that again. It did not
     * retract." He tapped Save with the keyboard up; the form declined or failed, and the
     * only explanation rendered 1,500pt above the viewport. First: the keyboard goes, so
     * the bottom of the form — where the button and the notice now both live — is visible
     * for whatever happens next. */
    Keyboard.dismiss();
    setBusy("save"); setNotice(null);
    // All-day events anchor at local midnight and carry the explicit allDay flag;
    // timed events merge each calendar day with its clock time (end may cross days).
    const startAt = !scheduled ? null : allDay ? midnight(day).toISOString() : stamp(day, start).toISOString();
    const endAt = !scheduled || !hasEnd ? null : allDay ? midnight(endDay).toISOString() : stamp(endDay, end).toISOString();
    // Include anything still typed into the bring field so it isn't silently lost.
    const pendingBring = bringInput.split(",").map((s) => s.trim()).filter(Boolean).map((item) => ({ item, memberId: null as string | null }));
    const whatToBring = [...bring, ...pendingBring];
    // Reminders only mean something relative to a start; an unscheduled event sends none.
    const remindOffsets = scheduled ? [...remindSet].sort((a, b) => a - b) : [];
    const body = { title: title.trim(), startAt, endAt, allDay: scheduled && allDay, notes: notes.trim(), location: location.trim(), localNotes: localNotes.trim(), driverId, whatToBring, remindOffsets };
    /* Q2 — on a mirrored event, send only the half that's ours. Sending the title and times
     * back unchanged would be refused by the server (correctly — it can't tell "unchanged"
     * from "changed back"), and the append would go down with them. Attendees aren't here:
     * they save on their own as they're tapped, because adding someone notifies them. */
    const r = !isEdit
      ? await api.createEvent({ ...body, visibility: "household" })
      : await api.updateEvent(id, !isOwnerOfEvent
        // Someone else's event: the ONLY two fields that exist for us. Sending anything
        // more would be refused by name, and rightly.
        ? { localNotes: localNotes.trim(), myBring }
        : appendOnly ? { localNotes: localNotes.trim(), driverId, whatToBring } : body);
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
    const name = `“${title.trim() || "This event"}”`;
    Alert.alert(
      "Delete event?",
      linkedGoogle
        ? `${name} will be deleted from Google Calendar and the household calendar.`
        // A canonical event that was pushed has a Google copy too; deleting here removes
        // both, and the result below says so honestly if the Google half didn't go.
        : googleEventId
          ? `${name} will be removed from the household calendar and its copy in your Google Calendar.`
          : `${name} will be removed from the household calendar.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: () => void (async () => {
            setBusy("delete"); setNotice(null);
            const r = await api.deleteEvent(id);
            setBusy(null);
            if (r.ok) {
              tapHaptic("success");
              // The FamiliOS event is gone either way; say plainly when the Google copy
              // isn't, because the next sync will bring it back and that must not be a
              // surprise. "kept_external_actions_disabled" = the household turned off
              // external actions, so the server didn't touch Google at all.
              if (r.google === "failed" || r.google === "kept_external_actions_disabled") {
                Alert.alert(
                  "Removed here, but not from Google",
                  r.google === "failed"
                    ? "The Google Calendar copy couldn't be removed, so it may come back on the next sync. Delete it in Google Calendar to be sure."
                    : "External actions are off for this household, so the Google Calendar copy was left alone — it may come back on the next sync.",
                  [{ text: "OK", onPress: () => router.back() }],
                );
                return;
              }
              router.back();
            } else {
              setNotice({
                text: r.error === "insufficient_role" ? "Deleting events needs Limited Member or higher."
                  // 422 google_delete_failed: the server refused rather than leave a copy
                  // behind — its message says what to do.
                  : r.error === "google_delete_failed" ? (r.message ?? "The Google Calendar copy couldn't be removed, so the event was kept. Try again, or delete it in Google Calendar first.")
                  : `Couldn't delete: ${r.message ?? r.error ?? "unknown error"}`,
                ok: false,
              });
            }
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
      <HScreen keyboardAware>
        {header}
        <SkeletonCards count={3} lines={1} />
      </HScreen>
    );
  }

  if (notFound) {
    return (
      <HScreen keyboardAware>
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
      <HScreen bottomPad={ACTION_BAR_HEIGHT + 24} scrollRef={scroller} keyboardAware>
      {header}

      {!canManage ? (
        <Notice text="Viewing only — creating and editing events needs Limited Member or higher." ok={false} />
      ) : null}
      {readOnly ? (
        /* Q2 — the old copy sent him somewhere else ("edit it at the source, or copy it on
         * the web app"), which is a strange thing for the app to say about an event it is
         * already showing. Its time and place really do belong to the other calendar; the
         * rest is ours, so say which is which and let him get on with it. */
        /* Cluster E — "this does not need to be displayed on every single calendar… this
           just used to be a little i symbol for information, expandable if the user taps
           the i, with some sort of animation that makes it look like it's glowing." The
           paragraph earned its keep once; as furniture on every mirrored event it was
           real estate. Now it's a glowing dot that says everything only when asked. */
        <View style={{ alignItems: "flex-start", gap: spacing.sm }}>
          <PressableScale
            onPress={() => setSourceInfoOpen((v) => !v)}
            haptic="select"
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ expanded: sourceInfoOpen }}
            accessibilityLabel="About this synced event"
            style={{
              width: 26, height: 26, borderRadius: 13,
              alignItems: "center", justifyContent: "center",
              backgroundColor: colors.skyBg,
              borderWidth: 1, borderColor: rimColor(colors, dark),
              boxShadow: `${depth("raisedSm", colors, dark)}, ${rimGlow(colors, dark)}`,
            }}
          >
            <Sym name="info" size={12} color={colors.sky} />
          </PressableScale>
          {sourceInfoOpen ? (
            <Notice
              ok={canAppend}
              text={canAppend
                ? "From another calendar — its time, place and description change there. Everything below is yours: your notes, who's coming, what to bring. None of it syncs back out."
                : "Read-only — this is synced from another calendar (you can only edit your own). Edit it at the source."}
            />
          ) : null}
        </View>
      ) : null}
      {linkedGoogle ? (
        <Notice text="Synced from Google Calendar — changes you save here update it in Google too." ok />
      ) : null}
      {/* BUG-03: the notice moved next to the Save bar (see the ActionBar below) — an
          explanation rendered at the top of a long form is an explanation nobody saw. */}
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

      {/* Remind — the same menu as a task's, because "15 minutes before, producing a real
          notification" was never a tasks-only need. Only offered once there's a start to
          remind relative to; the server schedules the nudges (reminders.mjs). */}
      {scheduled ? (
        <>
          <SectionHeader title="Remind" />
          <ChipRow>
            {REMINDERS.map((r) => (
              <Chip
                key={String(r.minutes)}
                label={r.label}
                icon={r.minutes !== null && remindSet.has(r.minutes) ? "bell.fill" : undefined}
                selected={r.minutes === null ? remindSet.size === 0 : remindSet.has(r.minutes)}
                onPress={!readOnly && canManage ? () => setRemindSet((prev) => {
                  if (r.minutes === null) return new Set();
                  const next = new Set(prev);
                  if (next.has(r.minutes)) next.delete(r.minutes); else next.add(r.minutes);
                  return next;
                }) : undefined}
              />
            ))}
          </ChipRow>
        </>
      ) : null}

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

      {/* Q2 — "let me append to it here without syncing it back out." A second, separate
          field rather than unlocking the one above, because the one above IS the event's
          description: on a synced event it belongs to the other calendar, and on your own it
          travels to Google on a push. This one never leaves, on any event, which is the
          whole point — so it says so, and the promise is kept in the code (the Google body is
          composed from `notes` and the Bring list only). */}
      {isEdit && localEditable ? (
        <>
          {/* "It needs to be relabeled 'just for me'… these are just notes for me about
              G-pop's event and not for anybody else." Per-viewer on the server now, so the
              label finally tells the truth. */}
          <SectionHeader title="Just for me" />
          <Well style={{ gap: 6 }}>
            <TextInput
              style={[inputStyle, { minHeight: 60, textAlignVertical: "top" }]}
              placeholder={readOnly ? "Pickup is at the side gate…" : "Anything that stays in FamiliOS"}
              placeholderTextColor={colors.textFaint}
              value={localNotes}
              onChangeText={setLocalNotes}
              multiline
              accessibilityLabel="Your own notes, kept in FamiliOS"
            />
            <T kind="caption" color={colors.textFaint}>
              Only you see this — it never shows on anyone else&apos;s card, including the event&apos;s owner.
            </T>
          </Well>
        </>
      ) : null}

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
                    onPress={!ownerControls || attendeeBusy ? undefined : () => void (async () => {
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
                {ownerControls
                  ? <>Nobody added yet. Picking someone tells them they&apos;re on it, and they can answer.</>
                  : <>Who&apos;s coming is up to {members.find((m) => m.actorId === eventOwnerId)?.displayName.split(" ")[0] ?? "the event’s owner"}.</>}
              </T>
            )}
            {/* "All this should really say is… would like to tag along? — send a request to
                attend. And Melissa would get a notification… accept or decline." Wanting on
                someone else's event is a REQUEST, not a toggle. */}
            {!ownerControls && !iAmParticipant ? (
              <Well style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <T kind="sub" style={{ flex: 1 }}>Would like to tag along?</T>
                <Button
                  small
                  title={pendingAttend ? "Request sent" : "Request to attend"}
                  disabled={pendingAttend || askBusy === "attend"}
                  onPress={() => void (async () => {
                    setAskBusy("attend");
                    const r = await api.requestAttend(id!);
                    setAskBusy(null);
                    if (r.pending) {
                      tapHaptic("success");
                      setRequests((q) => ({ ...q, attend: [...(q.attend ?? []), { actorId: session!.actorId, at: new Date().toISOString() }] }));
                      setNotice({ text: "Request sent — they'll get a notification and can say yes or no.", ok: true });
                    } else setNotice({ text: r.message ?? "Couldn't send the request.", ok: false });
                  })()}
                />
              </Well>
            ) : null}
            {/* The owner's side of the doors: who's knocking, answered here. */}
            {ownerControls && ((requests.attend ?? []).length > 0 || (requests.drive ?? []).length > 0 || (requests.bring ?? []).length > 0) ? (
              <Well style={{ gap: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.ember }}>
                <T kind="rowTitle">Waiting on you</T>
                {(["attend", "drive", "bring"] as const).flatMap((kind) =>
                  (requests[kind] ?? []).map((q: { actorId: string; at: string; item?: string }) => {
                    const who = members.find((m) => m.actorId === q.actorId)?.displayName.split(" ")[0] ?? "Someone";
                    const line = kind === "attend" ? `${who} would like to come`
                      : kind === "drive" ? `${who} offered to drive`
                      : `${who} suggests bringing ${q.item}`;
                    return (
                      <View key={`${kind}:${q.actorId}:${q.item ?? ""}`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                        <T kind="sub" style={{ flex: 1 }}>{line}</T>
                        {([true, false] as const).map((accept) => (
                          <Button
                            key={String(accept)} small
                            variant={accept ? undefined : "danger"}
                            title={accept ? "Accept" : "Decline"}
                            disabled={askBusy === `${kind}:${q.actorId}`}
                            onPress={() => void (async () => {
                              setAskBusy(`${kind}:${q.actorId}`);
                              const r = await api.respondEventRequest(id!, { kind, actorId: q.actorId, item: q.item, accept });
                              setAskBusy(null);
                              if (r.event) {
                                tapHaptic(accept ? "success" : "light");
                                setRequests(r.event.requests ?? {});
                                setAttendees(r.event.attendees ?? []);
                                setDriverId(r.event.driverId ?? null);
                                setBring(r.event.whatToBring ?? []);
                              } else setNotice({ text: r.message ?? "Couldn't answer that request.", ok: false });
                            })()}
                          />
                        ))}
                      </View>
                    );
                  }))}
              </Well>
            ) : null}
          </View>
        </>
      ) : null}

      {/* Driver — kept alongside attendees, not replaced by them: "who's driving" is a
          different question from "who's coming", and a carpool needs both.

          "The option no driver is kind of redundant — there should just be a parentheses
          that says this is an optional thing." A blank optional field already says nobody's
          driving; a chip that says so is furniture. Tapping the chosen driver again clears
          them, which is what the chip toggle always did. */}
      <SectionHeader title="Driver (optional)" />
      {ownerControls ? (
        <ChipRow>
          {members.map((m) => (
            <Chip
              key={m.actorId}
              label={m.displayName}
              icon="car.fill"
              selected={driverId === m.actorId}
              onPress={() => setDriverId(driverId === m.actorId ? null : m.actorId)}
            />
          ))}
        </ChipRow>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <T kind="sub" color={driverId ? colors.text : colors.textFaint}>
            {driverId ? `${members.find((m) => m.actorId === driverId)?.displayName ?? "Someone"} is driving.` : "No driver yet."}
          </T>
          {/* "Want to give them a lift — offer transportation… and then at that point I
              would be assigned as the driver." Offering, with the owner's yes in between. */}
          {driverId !== session?.actorId ? (
            <Well style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <T kind="sub" style={{ flex: 1 }}>Want to give them a lift?</T>
              <Button
                small
                title={pendingDrive ? "Offer sent" : "Offer transportation"}
                disabled={pendingDrive || askBusy === "drive"}
                onPress={() => void (async () => {
                  setAskBusy("drive");
                  const r = await api.offerDrive(id!);
                  setAskBusy(null);
                  if (r.pending) {
                    tapHaptic("success");
                    setRequests((q) => ({ ...q, drive: [...(q.drive ?? []), { actorId: session!.actorId, at: new Date().toISOString() }] }));
                    setNotice({ text: "Offer sent — if they accept, you're the driver.", ok: true });
                  } else setNotice({ text: r.message ?? "Couldn't send the offer.", ok: false });
                })()}
              />
            </Well>
          ) : null}
        </View>
      )}

      {/* What to bring — the SHARED list belongs to the owner. "Anything that I add down
          here should only be things that are just for my notes… and if I did add it, there
          should be a button that says suggest to the owner of this event." */}
      <SectionHeader title={ownerControls ? "What to bring" : "What to bring (theirs)"} />
      {bring.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {bring.map((w, i) => (
            <PressableScale
              key={`${w.item}-${i}`}
              haptic="select"
              disabled={!ownerControls}
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
              {ownerControls ? <Sym name="xmark" size={10} color={colors.amber} /> : null}
            </PressableScale>
          ))}
        </View>
      ) : null}
      {!ownerControls ? (
        <View style={{ gap: spacing.sm }}>
          <SectionHeader title="Your list — just for you" />
          {myBring.map((w, i) => (
            <View key={`${w.item}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Sym name="bag" size={12} color={colors.textMuted} />
              <T kind="sub" style={{ flex: 1 }}>{w.item}</T>
              {/* The polite door: nothing lands on their card unless they say yes. */}
              <Button
                small
                title={(requests.bring ?? []).some((q) => q.actorId === session?.actorId && q.item === w.item) ? "Suggested" : "Suggest to owner"}
                disabled={(requests.bring ?? []).some((q) => q.actorId === session?.actorId && q.item === w.item) || askBusy === `bring:${w.item}`}
                onPress={() => void (async () => {
                  setAskBusy(`bring:${w.item}`);
                  const r = await api.suggestBring(id!, w.item);
                  setAskBusy(null);
                  if (r.pending) {
                    tapHaptic("success");
                    setRequests((q) => ({ ...q, bring: [...(q.bring ?? []), { actorId: session!.actorId, item: w.item, at: new Date().toISOString() }] }));
                  } else setNotice({ text: r.message ?? "Couldn't suggest that.", ok: false });
                })()}
              />
              <PressableScale haptic="select" hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${w.item}`}
                onPress={() => setMyBring((b) => b.filter((_, j) => j !== i))}>
                <Sym name="xmark" size={11} color={colors.textFaint} />
              </PressableScale>
            </View>
          ))}
          <Well style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <TextInput
              style={[inputStyle, { flex: 1 }]}
              placeholder="A note to self — sunscreen, his lunch…"
              placeholderTextColor={colors.textFaint}
              value={bringInput}
              onChangeText={setBringInput}
              onSubmitEditing={() => { const t = bringInput.trim(); if (t) { setMyBring((b) => [...b, { item: t }]); setBringInput(""); } }}
              accessibilityLabel="Add an item to your own list"
              returnKeyType="done"
            />
            <Button small title="Add" disabled={!bringInput.trim()} onPress={() => { const t = bringInput.trim(); if (t) { setMyBring((b) => [...b, { item: t }]); setBringInput(""); } }} />
          </Well>
        </View>
      ) : null}
      {ownerControls ? (
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
          {isEdit && id ? (
            <Button
              title="Share to a chat"
              icon="paperplane"
              full
              disabled={busy !== null}
              onPress={() => shareTo.share(localPreview("event", id, { title: title.trim() || "Event", when: start.toISOString(), allDay, where: location.trim() || null }))}
            />
          ) : null}
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
      {shareTo.sheet}

      {/* C4/C5 — [15:03] "Save is not visible at all… that's crucial", and [13:48] "Save
          changes should be closer to the text entry." Both are answered by taking the commit
          control out of the scrolling content: it's pinned, and it rides the keyboard up, so
          when a field is focused Save is directly above the keys. */}
      {localEditable ? (
        <ActionBar>
          {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}
          <Button
            title={!isOwnerOfEvent && isEdit ? "Save my notes" : appendOnly ? "Save to FamiliOS" : isEdit ? (alsoGoogle && !linkedGoogle ? "Save & update Google" : "Save changes") : "Add event"}
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
              {!title.trim() && isOwnerOfEvent && !appendOnly ? "Give it a title to save." : endInvalid ? "Fix the end time to save." : ""}
            </T>
          ) : null}
        </ActionBar>
      ) : null}
    </View>
  );
}
