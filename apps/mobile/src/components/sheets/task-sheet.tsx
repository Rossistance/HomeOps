// A task, with everything the walkthrough said a task needs.
//
// From 2026-07-25, at the Tasks screen, in order:
//   [21:49] "It should have a start date and time and an end date and time, like a calendar
//           item — not just today, tomorrow, next week."
//   [22:04] "I should be able to assign it to somebody."
//   [22:09] "There's no notes or description field. You can't type all that into the title."
//   [22:19] "Reminders — 15 minutes before, 30 minutes before — producing a real notification."
//   [23:18] "When it has a date it should append to the calendar, and push to that person's
//           Google account."
//
// The reminder and the calendar push are both SERVER-side (server/reminders.mjs, and
// POST /api/tasks/:id/to-calendar), which is what makes "that person's" true: a task assigned
// to someone else has to reach their phone and their calendar, not the phone of whoever
// happened to type it.
import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, Switch, TextInput, View } from "react-native";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { api, type MemberRec, type NestRec, type TaskRec } from "@/lib/api";
import { useTheme, tapHaptic } from "@/theme";
import { Chip, ChipRow, HSheet, SheetCTA, Sym, T, VisibilityPicker, normalizeVisibility, type Visibility, Well, PressableScale } from "@/components/ui";
import { useShareToThread, localPreview } from "@/components/sheets/share-to-thread-sheet";

/** The offsets the server will accept (server/reminders.mjs REMINDER_CHOICES). */
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

function nextHalfHour(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
}

function Stamp({ label, value, onChange, disabled }: {
  label: string; value: Date; onChange: (d: Date) => void; disabled?: boolean;
}) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 40 }}>
      <T kind="bodyMedium" color={colors.textSecondary} style={{ flex: 1 }}>{label}</T>
      <DateTimePicker value={value} mode="date" display="compact" accentColor={colors.ember} disabled={disabled} onValueChange={(_e, d) => onChange(d)} />
      <DateTimePicker value={value} mode="time" display="compact" accentColor={colors.ember} disabled={disabled} onValueChange={(_e, d) => onChange(d)} />
    </View>
  );
}

export function TaskSheet({ visible, task, members, canEdit, onClose, onSaved, onDeleted }: {
  visible: boolean;
  task: TaskRec | null;
  members: MemberRec[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: (t: TaskRec) => void;
  onDeleted: (id: string) => void;
}) {
  const { colors, spacing, radii, type } = useTheme();
  const shareTo = useShareToThread();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskRec["priority"]>("medium");
  const [scheduled, setScheduled] = useState(false);
  const [start, setStart] = useState<Date>(nextHalfHour);
  const [hasEnd, setHasEnd] = useState(false);
  const [end, setEnd] = useState<Date>(() => { const d = nextHalfHour(); d.setHours(d.getHours() + 1); return d; });
  /* Cluster N — "What if I want to be notified the day before AND one hour before? I can't
   * select both of them. I need to be able to select both — all of them if need be."
   * A set, not a single. "None" clears the set. */
  const [remindSet, setRemindSet] = useState<Set<number>>(new Set());
  /* "The privacy option needs to extend to tasks and lists for NEW OR PRE-EXISTING tasks."
   * A privacy control that only exists at creation is a privacy control you can't correct —
   * and the thing people most want to change afterwards is exactly who can see something. */
  const [scope, setScope] = useState<{ visibility: Visibility; nestId: string | null }>({ visibility: "household", nestId: null });
  const [nests, setNests] = useState<NestRec[]>([]);
  const [busy, setBusy] = useState<"save" | "calendar" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !task) return;
    setNotice(null);
    setTitle(task.title ?? "");
    setNotes(task.notes ?? "");
    setAssignee(task.assignedMemberId ?? null);
    setPriority(task.priority ?? "medium");
    const s = task.startAt ?? task.dueAt;
    const sd = s ? new Date(s) : null;
    if (sd && !Number.isNaN(+sd)) { setScheduled(true); setStart(sd); } else { setScheduled(false); setStart(nextHalfHour()); }
    const e = task.endAt ? new Date(task.endAt) : null;
    if (e && !Number.isNaN(+e)) { setHasEnd(true); setEnd(e); } else { setHasEnd(false); }
    setRemindSet(new Set(task.remindOffsets ?? (task.remindMinutesBefore != null ? [task.remindMinutesBefore] : [])));
    setScope({ visibility: normalizeVisibility(task.visibility), nestId: task.nestId ?? null });
    void api.nests().then((r) => setNests(r.nests ?? [])).catch(() => setNests([]));
  }, [visible, task]);

  const endInvalid = scheduled && hasEnd && +end <= +start;
  const canSave = canEdit && !!title.trim() && !endInvalid && busy === null;
  const onCalendar = !!task?.eventId;

  const save = async () => {
    if (!task || !canSave) return;
    setBusy("save"); setNotice(null);
    const startAt = scheduled ? start.toISOString() : null;
    const r = await api.updateTask(task.id, {
      title: title.trim(),
      notes,
      assignedMemberId: assignee,
      priority,
      startAt,
      endAt: scheduled && hasEnd ? end.toISOString() : null,
      // dueAt stays in step with the start so every existing list, sort and overdue badge
      // keeps working — this sheet adds a start/end, it doesn't replace the deadline model.
      dueAt: startAt,
      remindOffsets: [...remindSet],
      remindMinutesBefore: remindSet.size ? Math.min(...remindSet) : null,
      visibility: scope.visibility,
      nestId: scope.visibility === "nest" ? scope.nestId : null,
    });
    setBusy(null);
    if (!r.task) {
      setNotice(r.error === "forbidden" || r.error === "insufficient_role"
        ? "You don't have permission to change this task."
        : r.message ?? "Couldn't save that.");
      return;
    }
    tapHaptic("success");
    onSaved(r.task);
    onClose();
  };

  const addToCalendar = async () => {
    if (!task) return;
    setBusy("calendar"); setNotice(null);
    const r = await api.taskToCalendar(task.id);
    setBusy(null);
    if (!r.ok) {
      setNotice(r.error === "date_required"
        ? "Give it a date first — then it can go on the calendar."
        : r.message ?? "Couldn't add it to the calendar.");
      return;
    }
    tapHaptic("success");
    setNotice(r.action === "updated" ? "Calendar entry updated." : "Added to the calendar.");
    onSaved({ ...task, eventId: r.event?.id ?? null });
  };

  const confirmDelete = () => {
    if (!task) return;
    Alert.alert("Delete task?", `“${task.title}” will be removed for everyone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: () => void (async () => {
          const r = await api.deleteTask(task.id);
          if (r.ok) { tapHaptic("warning"); onDeleted(task.id); onClose(); }
          else setNotice("Couldn't delete that.");
        })(),
      },
    ]);
  };

  const inputStyle = useMemo(() => ([type.body, { color: colors.text, paddingVertical: 10 }]), [type, colors]);

  return (
    <>
    <HSheet
      visible={visible}
      onClose={onClose}
      title="Task"
      leftLabel="Close"
      heightPct={0.92}
      footer={canEdit ? <SheetCTA title={busy === "save" ? "Saving…" : "Save changes"} disabled={!canSave} onPress={() => void save()} /> : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.md }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {notice ? <T kind="sub" color={colors.ember}>{notice}</T> : null}

        <Well>
          <TextInput
            style={inputStyle}
            value={title}
            onChangeText={(t) => setTitle(t.replace(/[\r\n]+/g, " "))}
            placeholder="What needs doing?"
            placeholderTextColor={colors.textFaint}
            editable={canEdit}
            multiline
            accessibilityLabel="Task title"
          />
        </Well>

        {/* H4 — "you can't type that all into the task title." */}
        <View style={{ gap: 6 }}>
          <T kind="eyebrow">Notes</T>
          <Well>
            <TextInput
              style={[inputStyle, { minHeight: 84, textAlignVertical: "top" }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything else about it — where, what to bring, why."
              placeholderTextColor={colors.textFaint}
              editable={canEdit}
              multiline
              accessibilityLabel="Task notes"
            />
          </Well>
        </View>

        {/* H3 — assign to a member. */}
        {members.length > 0 ? (
          <View style={{ gap: 6 }}>
            <T kind="eyebrow">Assign to</T>
            <ChipRow>
              <Chip label="Nobody" selected={assignee === null} onPress={canEdit ? () => setAssignee(null) : undefined} />
              {members.map((m) => (
                <Chip
                  key={m.actorId}
                  label={m.displayName.split(" ")[0]}
                  icon={assignee === m.actorId ? "person.fill" : "person"}
                  selected={assignee === m.actorId}
                  onPress={canEdit ? () => setAssignee(assignee === m.actorId ? null : m.actorId) : undefined}
                />
              ))}
            </ChipRow>
          </View>
        ) : null}

        {/* H2 — a real start and end, like a calendar item. */}
        <View style={{ gap: 6 }}>
          <T kind="eyebrow">When</T>
          <Well style={{ gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40 }}>
              <T kind="bodyMedium" color={colors.textSecondary}>Has a date and time</T>
              <Switch
                value={scheduled}
                onValueChange={(v) => { tapHaptic("select"); setScheduled(v); }}
                trackColor={{ true: colors.ember }}
                disabled={!canEdit}
                accessibilityLabel="Task has a date and time"
              />
            </View>
            {scheduled ? (
              <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: 2 }}>
                <Stamp label="Starts" value={start} onChange={setStart} disabled={!canEdit} />
                {hasEnd ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <View style={{ flex: 1 }}><Stamp label="Ends" value={end} onChange={setEnd} disabled={!canEdit} /></View>
                    {canEdit ? (
                      <PressableScale haptic="select" hitSlop={8} onPress={() => setHasEnd(false)} accessibilityRole="button" accessibilityLabel="Remove end time">
                        <Sym name="xmark.circle.fill" size={18} color={colors.textFaint} />
                      </PressableScale>
                    ) : null}
                  </View>
                ) : canEdit ? (
                  <PressableScale
                    haptic="select"
                    onPress={() => { const d = new Date(start); d.setHours(d.getHours() + 1); setEnd(d); setHasEnd(true); }}
                    accessibilityRole="button" accessibilityLabel="Add end time"
                    style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 }}
                  >
                    <Sym name="plus.circle" size={15} color={colors.ember} />
                    <T kind="subMedium" color={colors.ember}>Add end time</T>
                  </PressableScale>
                ) : null}
                {endInvalid ? <T kind="sub" color={colors.coral}>The end has to be after the start.</T> : null}
              </View>
            ) : (
              <T kind="sub" color={colors.textFaint}>No date — it just sits on the list until someone does it.</T>
            )}
          </Well>
        </View>

        {/* H5 — a reminder that produces a real notification, on the assignee's phone. */}
        {scheduled ? (
          <View style={{ gap: 6 }}>
            <T kind="eyebrow">Remind</T>
            <ChipRow>
              {REMINDERS.map((r) => (
                <Chip
                  key={String(r.minutes)}
                  label={r.label}
                  icon={r.minutes !== null && remindSet.has(r.minutes) ? "bell.fill" : undefined}
                  selected={r.minutes === null ? remindSet.size === 0 : remindSet.has(r.minutes)}
                  onPress={canEdit ? () => setRemindSet((prev) => {
                    if (r.minutes === null) return new Set();
                    const next = new Set(prev);
                    if (next.has(r.minutes)) next.delete(r.minutes); else next.add(r.minutes);
                    return next;
                  }) : undefined}
                />
              ))}
            </ChipRow>
            {remindSet.size > 0 ? (
              <T kind="caption" color={colors.textFaint}>
                {`${remindSet.size === 1 ? "One nudge" : `${remindSet.size} nudges`} — ${assignee
                  ? `${members.find((m) => m.actorId === assignee)?.displayName.split(" ")[0] ?? "they"} gets them on their phone`
                  : "you'll get them on your phone"}, loud enough to matter.`}
              </T>
            ) : null}
          </View>
        ) : null}

        <View style={{ gap: 6 }}>
          <T kind="eyebrow">Priority</T>
          <ChipRow>
            {(["low", "medium", "high"] as const).map((p) => (
              <Chip key={p} label={p[0].toUpperCase() + p.slice(1)} selected={priority === p} onPress={canEdit ? () => setPriority(p) : undefined} />
            ))}
          </ChipRow>
        </View>

        {canEdit ? (
          <VisibilityPicker
            value={scope.visibility}
            nestId={scope.nestId}
            nests={nests.map((n) => ({ id: n.id, label: n.label }))}
            onChange={setScope}
          />
        ) : null}

        {/* H7 — onto the calendar, and from there into that person's Google. */}
        {canEdit ? (
          <View style={{ gap: 6, marginTop: spacing.sm }}>
            <T kind="eyebrow">Calendar</T>
            <PressableScale
              haptic="select"
              disabled={busy !== null || !scheduled}
              onPress={() => void addToCalendar()}
              accessibilityRole="button"
              accessibilityLabel={onCalendar ? "Update the calendar entry" : "Add to the calendar"}
              style={{
                flexDirection: "row", alignItems: "center", gap: spacing.md,
                backgroundColor: colors.surfaceSunken, borderRadius: radii.sm, borderCurve: "continuous",
                padding: spacing.md, opacity: busy !== null || !scheduled ? 0.5 : 1,
              }}
            >
              <Sym name={onCalendar ? "calendar.badge.checkmark" : "calendar.badge.plus"} size={17} color={colors.ember} />
              <View style={{ flex: 1 }}>
                <T kind="bodyMedium" color={colors.text}>
                  {busy === "calendar" ? "Adding…" : onCalendar ? "Update the calendar entry" : "Add to the calendar"}
                </T>
                <T kind="caption" color={colors.textFaint}>
                  {!scheduled ? "Give it a date and time first."
                    : assignee ? "It goes on the household calendar under their name — and into their Google, once you approve the push."
                    : "It goes on the household calendar — and into your Google, once you approve the push."}
                </T>
              </View>
            </PressableScale>
          </View>
        ) : null}

        {task ? (
          <PressableScale
            onPress={() => { onClose(); shareTo.share(localPreview("task", task.id, { title: task.title, when: task.dueAt ?? null, status: task.status })); }}
            haptic="select"
            accessibilityRole="button"
            accessibilityLabel="Share this task to a chat"
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.md, marginTop: spacing.sm }}
          >
            <Sym name="paperplane" size={14} color={colors.ember} />
            <T kind="subMedium" color={colors.ember}>Share to a chat</T>
          </PressableScale>
        ) : null}
        {canEdit ? (
          <PressableScale
            onPress={confirmDelete}
            haptic="warning"
            accessibilityRole="button"
            accessibilityLabel="Delete task"
            style={{ alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.sm }}
          >
            <T kind="subMedium" color={colors.coral}>Delete task</T>
          </PressableScale>
        ) : null}
      </ScrollView>
    </HSheet>
    {shareTo.sheet}
    </>
  );
}
