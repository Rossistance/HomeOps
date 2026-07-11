// Event form — create or edit a canonical FamiliOS event, presented as a form
// sheet. Native SwiftUI date/time pickers via @expo/ui (compact style inline on
// iOS; dialog presentation elsewhere). Edit mode (?id=) prefls from the server
// and adds a destructive delete. Synced (linked/public) events are read-only.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Switch, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { api, type ApprovalRec, type EventRec, type MemberRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic } from "@/theme";
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
  const [driverId, setDriverId] = useState<string | null>(null);
  const [bring, setBring] = useState<{ item: string; memberId: string | null }[]>([]);
  const [bringInput, setBringInput] = useState("");

  const [busy, setBusy] = useState<"save" | "delete" | "push" | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  // Google push (canonical events only) — approval-gated exactly as web does it.
  const [googleEventId, setGoogleEventId] = useState<string | null>(null);
  const [pushApproval, setPushApproval] = useState<ApprovalRec | null>(null);

  useEffect(() => {
    void (async () => {
      const [mem, evs] = await Promise.all([api.members(), id ? api.events() : Promise.resolve([] as EventRec[])]);
      setMembers(mem);
      if (id) {
        const e = evs.find((x) => x.id === id);
        if (!e) {
          setNotFound(true);
        } else {
          setReadOnly(e.layer !== "canonical");
          setGoogleEventId(e.provenance?.googleEventId ?? null);
          setTitle(e.title);
          setLocation(e.location ?? "");
          setDriverId(e.driverId);
          setBring(e.whatToBring.map((w) => ({ item: w.item, memberId: w.memberId })));
          const s = e.startAt ? new Date(e.startAt) : null;
          if (s && !isNaN(+s)) {
            setScheduled(true); setDay(s); setStart(s);
            const en = e.endAt ? new Date(e.endAt) : null;
            if (en && !isNaN(+en)) { setHasEnd(true); setEnd(en); }
          } else {
            setScheduled(false);
          }
        }
      }
      setLoading(false);
    })();
  }, [id]);

  const endInvalid = scheduled && hasEnd && +stamp(day, end) <= +stamp(day, start);
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
    const startAt = scheduled ? stamp(day, start).toISOString() : null;
    const endAt = scheduled && hasEnd ? stamp(day, end).toISOString() : null;
    // Include anything still typed into the bring field so it isn't silently lost.
    const pendingBring = bringInput.split(",").map((s) => s.trim()).filter(Boolean).map((item) => ({ item, memberId: null as string | null }));
    const whatToBring = [...bring, ...pendingBring];
    const body = { title: title.trim(), startAt, endAt, location: location.trim(), driverId, whatToBring };
    const r = isEdit
      ? await api.updateEvent(id, body)
      : await api.createEvent({ ...body, visibility: "household" });
    setBusy(null);
    if (r.event) {
      tapHaptic("success");
      router.back();
    } else {
      setNotice({
        text: r.error === "insufficient_role"
          ? "Saving events needs Limited Member or higher."
          : `Couldn't save: ${r.error ?? "unknown error"}`,
        ok: false,
      });
    }
  };

  const confirmDelete = () => {
    if (!isEdit) return;
    Alert.alert(
      "Delete event?",
      `“${title.trim() || "This event"}” will be removed from the household calendar.`,
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
    if (!id) return;
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
    <HScreen bottomPad={56}>
      {header}

      {!canManage ? (
        <Notice text="Viewing only — creating and editing events needs Limited Member or higher." ok={false} />
      ) : null}
      {readOnly ? (
        <Notice text="Synced from an external calendar — read-only here. Edit it at the source." ok={false} />
      ) : null}
      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

      {/* Title */}
      <Well>
        <TextInput
          style={inputStyle}
          placeholder="Event title (e.g. Soccer practice)"
          placeholderTextColor={colors.textFaint}
          value={title}
          onChangeText={setTitle}
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
            <PickerField label="Date" value={day} mode="date" onChange={setDay} disabled={readOnly || !canManage} />
            <PickerField label="Starts" value={start} mode="time" onChange={setStart} disabled={readOnly || !canManage} />
            {hasEnd ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <PickerField label="Ends" value={end} mode="time" onChange={setEnd} disabled={readOnly || !canManage} />
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
                  setEnd(d); setHasEnd(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Add end time"
                style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 }}
              >
                <Sym name="plus.circle" size={15} color={colors.ember} />
                <T kind="subMedium" color={colors.ember}>Add end time</T>
              </PressableScale>
            ) : null}
            {endInvalid ? (
              <T kind="sub" color={colors.coral}>End time must be after the start.</T>
            ) : null}
          </View>
        ) : (
          <T kind="sub" color={colors.textFaint}>No date — the event shows under “No date set”.</T>
        )}
      </Well>

      {/* Location */}
      <SectionHeader title="Location" />
      <Well style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Sym name="mappin.and.ellipse" size={16} color={colors.textFaint} />
        <TextInput
          style={[inputStyle, { flex: 1 }]}
          placeholder="Where is it? (optional)"
          placeholderTextColor={colors.textFaint}
          value={location}
          onChangeText={setLocation}
          editable={!readOnly && canManage}
          accessibilityLabel="Event location"
          returnKeyType="done"
        />
      </Well>

      {/* Driver */}
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
        <Well style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <TextInput
            style={[inputStyle, { flex: 1 }]}
            placeholder="Cleats, water bottle, snacks…"
            placeholderTextColor={colors.textFaint}
            value={bringInput}
            onChangeText={setBringInput}
            onSubmitEditing={addBring}
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
          <Button
            title={isEdit ? "Save changes" : "Add event"}
            variant="ember"
            full
            loading={busy === "save"}
            disabled={!canSave}
            onPress={() => void save()}
          />
          {isEdit ? (
            <Button
              title={googleEventId ? "Update in Google" : "Push to Google"}
              variant="neutral"
              icon="arrow.up.circle"
              full
              loading={busy === "push" && !pushApproval}
              disabled={busy !== null || !!pushApproval}
              onPress={() => void push()}
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
  );
}
