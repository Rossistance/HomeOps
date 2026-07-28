// Tasks & Lists — the household to-do surface. Tasks group into lists (explicit
// listName, else a friendly group per type: chores / reminders / errands / bills /
// groceries), with a quick composer for the active list, tactile animated
// check-offs, and a collapsed Completed drawer. The server enforces roles and
// visibility; we only surface friendly messages when it says no.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { api, type HelpRequestRec, type MemberRec, type NestRec, type TaskRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useRevSync } from "@/lib/rev-sync";
import { useTheme, tapHaptic } from "@/theme";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { memberTone } from "@/lib/member-colors";
// "ui/index" (not "ui"): the legacy src/components/ui.tsx still shadows the ui/
// directory until the old screens are all ported — this resolves the new system.
import { Badge, Button, Card, CheckCircle, Chip, ChipRow, Coach, EmptyState, ErrorState, HScreen, Notice, PressableScale, Rise, ScreenTour, SectionHeader, SkeletonCards, Sym, T, VisibilityPicker, type Visibility, Well } from "@/components/ui";
import { titleCase } from "@/theme/categories";
import { TaskSheet } from "@/components/sheets/task-sheet";

/* ------------------------------ grouping ------------------------------ */
const TYPE_GROUP: Record<string, string> = {
  chore: "Chores", reminder: "Reminders", errand: "Errands", bill: "Bills", list: "Groceries", task: "Tasks",
};
// Inverse mapping for the composer: which {type, listName} a new task gets per group.
const GROUP_CREATE: Record<string, { type: string; listName?: string }> = {
  Chores: { type: "chore" }, Reminders: { type: "reminder" }, Errands: { type: "errand" },
  Bills: { type: "bill" }, Groceries: { type: "list", listName: "Groceries" }, Tasks: { type: "task" },
};
function groupOf(t: TaskRec): string {
  return t.listName?.trim() || TYPE_GROUP[t.type] || "Tasks";
}

/* ------------------------------- helpers ------------------------------ */
type QuickDue = "today" | "tomorrow" | "nextweek" | null | "custom";

function dueFromQuick(k: QuickDue): string | null {
  if (!k) return null;
  const d = new Date();
  if (k === "tomorrow") d.setDate(d.getDate() + 1);
  if (k === "nextweek") d.setDate(d.getDate() + 7);
  d.setHours(17, 0, 0, 0);
  return d.toISOString();
}

function fmtDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === new Date(now.getTime() + 86400000).toDateString()) return "Tomorrow";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function friendly(error?: string, message?: string): string {
  if (message) return message;
  switch (error) {
    case "insufficient_role": case "forbidden": return "You don't have permission for that — ask a household adult.";
    case "network": return "Couldn't reach FamiliOS — check your connection.";
    default: return `Something went wrong${error ? ` (${error})` : ""}.`;
  }
}

/* The check-off lives in the UI kit now (components/ui/check-circle), because Groceries
 * needed exactly this and had a plain colour flip instead. Same gesture, same feel. */

/* -------------------------------- row ---------------------------------- */
function TaskRow({ t, members, last, showGroup, helping, onToggle, onLongPress, onOpen }: {
  t: TaskRec; members: MemberRec[]; last: boolean; showGroup: boolean;
  helping?: string | null; // helper's name when an accepted help request moved/covers this task (WP-001)
  onToggle: () => void; onLongPress: () => void; onOpen: () => void;
}) {
  const { colors, spacing } = useTheme();
  const done = t.status === "done";
  const overdue = !done && !!t.dueAt && Date.parse(t.dueAt) < Date.now();
  const pri = t.priority === "high" ? colors.coral : t.priority === "medium" ? colors.amber : colors.sage;
  const member = members.find((m) => m.actorId === t.assignedMemberId) ?? null;
  // L2 — the person's OWN colour, from the one resolver. This used to be a palette indexed by
  // the member's position in the array, which is why the initial here disagreed with the
  // avatar everywhere else.
  const av = memberTone(colors, member);
  return (
    <Pressable onPress={onOpen} onLongPress={onLongPress} delayLongPress={350} accessibilityLabel={t.title} accessibilityHint="Opens the task">
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
        <CheckCircle done={done} onPress={onToggle} />
        <View style={{ flex: 1, gap: 4 }}>
          <T
            kind="bodyMedium"
            numberOfLines={2}
            color={done ? colors.sage : colors.text}
            style={done ? { textDecorationLine: "line-through", opacity: 0.7 } : undefined}
          >
            {t.title}
          </T>
          {!done ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <View accessibilityLabel={`Priority ${t.priority}`} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: pri }} />
              {t.dueAt ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: overdue ? colors.coralBg : colors.surfaceSunken, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 }}>
                  <Sym name="calendar" size={10} color={overdue ? colors.coral : colors.textMuted} />
                  <T kind="caption" color={overdue ? colors.coral : colors.textMuted}>
                    {fmtDue(t.dueAt)}{overdue ? " · overdue" : ""}
                  </T>
                </View>
              ) : null}
              {helping ? (
                <View accessibilityLabel={`${helping} is helping with this`} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.lavenderBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 }}>
                  <Sym name="hand.raised.fill" size={10} color={colors.lavender} />
                  <T kind="caption" color={colors.lavender}>{helping} is helping</T>
                </View>
              ) : null}
              {t.remindMinutesBefore != null ? (
                <View accessibilityLabel="Has a reminder" style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Sym name="bell.fill" size={9} color={colors.textFaint} />
                  <T kind="caption" color={colors.textFaint}>
                    {t.remindMinutesBefore === 0 ? "on time" : t.remindMinutesBefore >= 1440 ? "1d" : t.remindMinutesBefore >= 60 ? `${t.remindMinutesBefore / 60}h` : `${t.remindMinutesBefore}m`}
                  </T>
                </View>
              ) : null}
              {t.eventId ? (
                <View accessibilityLabel="On the calendar" style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Sym name="calendar.badge.checkmark" size={9} color={colors.sage} />
                  <T kind="caption" color={colors.sage}>on calendar</T>
                </View>
              ) : null}
              {showGroup ? <T kind="caption" color={colors.textFaint}>{groupOf(t)}</T> : null}
            </View>
          ) : null}
        </View>
        {member ? (
          <View accessibilityLabel={`Assigned to ${member.displayName}`} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: av.bg, alignItems: "center", justifyContent: "center" }}>
            <T kind="caption" color={av.fg}>{member.displayName.trim().charAt(0).toUpperCase()}</T>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/* ------------------------------- screen -------------------------------- */
export default function TasksScreen() {
  const { session } = useSession();
  const { colors, spacing, fonts } = useTheme();
  const canAdd = ["Owner", "Adult Admin", "Adult Member", "Limited Member"].includes(session?.role ?? "");

  const [tasks, setTasks] = useState<TaskRec[]>([]);
  const [members, setMembers] = useState<MemberRec[]>([]);
  const [helpRequests, setHelpRequests] = useState<HelpRequestRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [activeList, setActiveList] = useState("All");
  /* T1 — "their own… task list, available between the two of them, and yet still isolated
   * from the broader family group." A second axis on the same screen: which SPACE, then
   * which list within it. Family is the default and never shows a nest's items. */
  /* Private by default — see the note at the "Who can see it" chips. A task is yours until you
   * say otherwise, which is the opposite of what it was. */
  /* A list created but still empty. It has no tasks yet, so nothing in the store knows about
   * it — this keeps it on screen and selected so the very next thing you type goes into it,
   * which is what "create a list" means to a person. */
  const [pendingList, setPendingList] = useState<string | null>(null);
  /* Was a boolean: shared or not. Nest scope existed on the server the whole time but was
   * inferred from which SPACE chip happened to be selected, so the one scope people most
   * want — "just the two of us" — wasn't in the privacy control at all. Now it's a real
   * three-way choice, narrowest first, and the space chip only seeds the default. */
  const [scope, setScope] = useState<{ visibility: Visibility; nestId: string | null }>({ visibility: "private", nestId: null });
  const [startAt, setStartAt] = useState<Date>(() => { const d = new Date(); d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0); return d; });
  const [dueAt, setDueAt] = useState<Date>(() => { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d; });
  const [nests, setNests] = useState<NestRec[]>([]);
  const [nestId, setNestId] = useState<string | null>(null);
  /* Cluster K — the third room. "It's family, your nest, and then just me… any tasks or
   * lists in that section would need to be visible only to me." Family used to mean
   * "everything that isn't a nest's", which quietly included your private tasks — so
   * private items sat in the shared-looking view and "just me" didn't exist as a place. */
  const [justMe, setJustMe] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  // H1 [21:31] — "group the tasks by person: mine, and everybody else's." A household list
  // that mixes everyone's chores together is a list nobody reads as theirs.
  const [who, setWho] = useState<"all" | "mine" | "others">("all");
  // The task sheet: everything a task needs that the row and composer can't hold (H2-H7).
  const [editing, setEditing] = useState<TaskRec | null>(null);
  // Composer
  const [title, setTitle] = useState("");
  const [quickDue, setQuickDue] = useState<QuickDue>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // C6 [21:45] — "the add-task input doesn't recenter when the keyboard comes up." The
  // composer sits under the filter chips, and the chip rows it reveals as you type push it
  // further down; the keyboard inset alone doesn't chase it.
  const scroller = useRef<ScrollView>(null);
  const composerY = useRef(0);

  const load = useCallback(async () => {
    const [tks, mems, hrs, ns] = await Promise.all([
      api.tasks(), api.members(), api.helpRequests(),
      api.nests().catch(() => ({ nests: [] as NestRec[], invitations: [] as NestRec[] })),
    ]);
    if (mems.length === 0 && !(await api.health())) {
      setError("The FamiliOS server didn't answer.");
    } else {
      setError(null);
      setNests(ns.nests);
      setTasks(tks);
      setMembers(mems);
      setHelpRequests(hrs);
    }
    setLoading(false);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  useRevSync(useCallback(() => { void load(); }, [load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  // WP-001 helping indicator: task id → helper's first name, from accepted help
  // requests linked to that task (ask → recipient helps; offer → offerer helps).
  const helperFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of helpRequests) {
      if (h.status !== "accepted" || !h.taskId) continue;
      const name = h.kind === "offer" ? h.fromName : h.toName;
      if (name) map.set(h.taskId, name.split(" ")[0]);
    }
    return map;
  }, [helpRequests]);

  // H1 — "mine" is what's assigned to me; "others" is everything assigned to someone else.
  // A task assigned to NOBODY belongs in both views: it's unclaimed household work, and
  // hiding it from "mine" is how it stays unclaimed.
  const me = session?.actorId ?? null;
  const mineFilter = useCallback((t: TaskRec) => {
    if (who === "all") return true;
    if (who === "mine") return !t.assignedMemberId || t.assignedMemberId === me;
    return !!t.assignedMemberId && t.assignedMemberId !== me;
  }, [who, me]);
  // The space comes first: Family never shows a nest's work, which is the whole promise.
  /* Picking a nest space seeds the default scope — creating a task inside "Mum & Dad" almost
   * always means it belongs to Mum & Dad, and making someone say so twice is the kind of
   * friction that gets a feature ignored. It's a DEFAULT, not a lock: the picker below still
   * has the final word, so a private note written inside a nest space stays private. */
  useEffect(() => {
    // A nest space seeds nest scope; Family and Just me BOTH seed private — "the default for
    // every task creation should always be just me… even though the list is created under
    // the family." Sharing is the explicit act, never the ambient one.
    setScope({ visibility: nestId ? "nest" : "private", nestId });
  }, [nestId, justMe]);

  const inSpace = useCallback(
    (t: TaskRec) => (justMe ? t.visibility === "private"
      : nestId ? t.nestId === nestId
      : t.visibility === "household"),
    [nestId, justMe],
  );
  const open = useMemo(() => tasks.filter((t) => t.status !== "done" && inSpace(t) && mineFilter(t)), [tasks, inSpace, mineFilter]);
  const done = useMemo(() => tasks.filter((t) => t.status === "done" && inSpace(t) && mineFilter(t)), [tasks, inSpace, mineFilter]);
  const listNames = useMemo(() => {
    const names = new Set(tasks.filter(inSpace).map(groupOf));
    // A just-created list has nothing in it yet; without this it would vanish the moment you
    // made it, which is a strange reward for creating something.
    if (pendingList) names.add(pendingList);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [tasks, inSpace, pendingList]);

  const byDue = (a: TaskRec, b: TaskRec) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || a.title.localeCompare(b.title);
  const groups = useMemo(() => {
    const map = new Map<string, TaskRec[]>();
    for (const t of open) { const g = groupOf(t); map.set(g, [...(map.get(g) ?? []), t]); }
    const entries = [...map.entries()].map(([name, items]) => [name, items.sort(byDue)] as const);
    return entries.sort((a, b) => a[0].localeCompare(b[0]));
  }, [open]);
  const visibleGroups = activeList === "All" ? groups : groups.filter(([name]) => name === activeList);
  const doneVisible = useMemo(
    () => (activeList === "All" ? done : done.filter((t) => groupOf(t) === activeList)).sort(byDue),
    [done, activeList],
  );

  /* ------------------------------ actions ------------------------------ */
  const toggle = async (t: TaskRec) => {
    const next = t.status === "done" ? "todo" : "done";
    tapHaptic(next === "done" ? "success" : "light");
    setTasks((arr) => arr.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    const r = await api.updateTask(t.id, { status: next });
    if (!r.task) {
      setTasks((arr) => arr.map((x) => (x.id === t.id ? { ...x, status: t.status } : x)));
      setNotice({ ok: false, text: friendly(r.error) });
    }
  };

  const doDelete = async (t: TaskRec) => {
    const r = await api.deleteTask(t.id);
    if (r.ok) {
      tapHaptic("warning");
      setTasks((arr) => arr.filter((x) => x.id !== t.id));
      setNotice({ ok: true, text: "Task deleted." });
    } else {
      setNotice({ ok: false, text: friendly(r.error) });
    }
  };

  const menuFor = (t: TaskRec) => {
    tapHaptic("select");
    Alert.alert(t.title, undefined, [
      { text: "Edit…", onPress: () => setEditing(t) },
      { text: t.status === "done" ? "Mark as open" : "Mark as done", onPress: () => void toggle(t) },
      {
        text: "Delete…", style: "destructive",
        onPress: () => Alert.alert("Delete task?", `"${t.title}" will be removed for everyone.`, [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => void doDelete(t) },
        ]),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const promptNewList = useCallback(() => {
    Alert.prompt?.(
      "New list",
      "What's it for? Summer camp, the move, a party — anything you'd keep a list about.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create",
          onPress: (name?: string) => {
            const n = titleCase((name ?? "").trim());
            if (!n) return;
            tapHaptic("success");
            setPendingList(n);
            setActiveList(n);
          },
        },
      ],
      "plain-text",
    );
  }, []);

  const add = async () => {
    const name = title.trim();
    if (!name || adding) return;
    setAdding(true); setNotice(null);
    const target = activeList === "All" ? { type: "task" } : (GROUP_CREATE[activeList] ?? { type: "list", listName: activeList });
    const r = await api.createTask({
      title: name, type: target.type,
      // A picked date beats a chip; a chip beats nothing.
      dueAt: quickDue === "custom" ? dueAt.toISOString() : dueFromQuick(quickDue),
      startAt: quickDue === "custom" ? startAt.toISOString() : undefined,
      assignedMemberId: assignee, listName: target.listName,
      // Whatever the picker says. Private is still the default it starts on: "not everybody
      // wants everyone in the family to see a task they have and offer help for it."
      visibility: scope.visibility,
      ...(scope.visibility === "nest" && scope.nestId ? { nestId: scope.nestId } : {}),
    });
    if (r.task) {
      let created = r.task;
      // POST /api/tasks doesn't persist listName — patch it on so the task lands in its list.
      if (target.listName && created.listName !== target.listName) {
        const p = await api.updateTask(created.id, { listName: target.listName });
        if (p.task) created = p.task;
      }
      setTasks((arr) => [created, ...arr]);
      /* Follow the task to wherever it actually landed.
       *
       * The space chips filter by nest, and the privacy picker can now disagree with them —
       * choosing "Just me" while standing in a nest space creates a task that belongs to no
       * nest, so the list you are looking at is precisely the list it is NOT in. It would
       * have been created, confirmed, and invisible: a success message about something you
       * can't see is the failure mode this app keeps producing, and adding a control was
       * about to add another one.
       *
       * Moving the view is the honest resolution — the task is real and this is where it is. */
      const landedIn = created.visibility === "nest" ? (created.nestId ?? null) : null;
      if (landedIn !== nestId) setNestId(landedIn);
      // "If I selected just me, it would actually disappear out of this family group and get
      // added underneath the just me." Followed, not vanished.
      setJustMe(created.visibility === "private");
      setTitle(""); setQuickDue(null); setAssignee(null);
      setScope({ visibility: landedIn ? "nest" : "private", nestId: landedIn });
      tapHaptic("success");
    } else {
      setNotice({ ok: false, text: r.error === "insufficient_role" ? "Adding tasks needs Limited Member or higher." : friendly(r.error) });
    }
    setAdding(false);
  };

  /* ------------------------------- render ------------------------------ */
  if (loading) return <HScreen keyboardAware><SkeletonCards count={4} /></HScreen>;
  if (error) return <HScreen refreshing={refreshing} onRefresh={onRefresh} keyboardAware><ErrorState message={error} onRetry={() => void load()} /></HScreen>;

  const composerTarget = activeList === "All" ? "Tasks" : activeList;
  let riseIdx = 0;

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh} scrollRef={scroller} keyboardAware>
      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

      {/* H1 — mine vs everybody else's. Shown only when there IS someone else in the
          household; a one-person list has nothing to split. */}
      {members.length > 1 ? (
        <Rise index={riseIdx++}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {/* R1 [04:12] — "instead of saying Mine, I think it should say Me." */}
            {([["all", "Everyone"], ["mine", "Me"], ["others", "Others"]] as const).map(([k, label]) => {
              const active = who === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => { tapHaptic("select"); setWho(k); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${label} tasks`}
                  style={{
                    flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 12, borderCurve: "continuous",
                    backgroundColor: active ? colors.ember : colors.surfaceSunken,
                  }}
                >
                  <T kind="subMedium" color={active ? colors.onEmber : colors.textSecondary} style={{ fontWeight: "600" }}>{label}</T>
                </Pressable>
              );
            })}
          </View>
        </Rise>
      ) : null}

      {/* R4/R5 — "we need to add an addition button at the top that allows me to create new
          lists from scratch… all Groceries, Reminders and Tasks are essentially the same, and I
          need to be able to create a new one — let's say Summer Camp."
          He's right that they're the same: a list IS a listName on a task. So making one is
          naming one, and it appears the moment something is in it. Nothing to migrate, nothing
          to configure — and every list gets identical options because they're the same thing. */}
      <Rise index={riseIdx++}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T kind="eyebrow">Lists</T>
          {canAdd ? (
            <PressableScale
              onPress={promptNewList}
              haptic="select"
              accessibilityRole="button"
              accessibilityLabel="Create a new list"
              style={{
                flexDirection: "row", alignItems: "center", gap: 5,
                paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
                backgroundColor: colors.emberBg,
              }}
            >
              <Sym name="plus" size={13} color={colors.ember} />
              <T kind="subMedium" color={colors.ember}>New list</T>
            </PressableScale>
          ) : null}
        </View>
      </Rise>

      {nests.length > 0 ? (
        <Rise index={riseIdx++}>
          <ScreenTour route="/tasks" />
          <Coach id="tasks.spaces"><ChipRow>
            <Chip label="Family" icon="house.fill" selected={nestId === null && !justMe} onPress={() => { setJustMe(false); setNestId(null); }} />
            {nests.map((n) => (
              <Chip key={n.id} label={n.label} icon="person.2.fill" selected={nestId === n.id} onPress={() => { setJustMe(false); setNestId(n.id); }} />
            ))}
            <Chip label="Just me" icon="lock" selected={justMe} onPress={() => { setNestId(null); setJustMe(true); }} />
          </ChipRow></Coach>
        </Rise>
      ) : null}

      {listNames.length > 0 ? (
        <Rise index={riseIdx++}>
          <ChipRow>
            <Chip label="All" icon="tray.full" selected={activeList === "All"} onPress={() => setActiveList("All")} />
            {listNames.map((n) => (
              <Chip key={n} label={n} selected={activeList === n} onPress={() => setActiveList(n)} />
            ))}
          </ChipRow>
        </Rise>
      ) : null}

      {canAdd ? (
        <Rise index={riseIdx++}>
          <Coach id="tasks.composer"><Card style={{ gap: spacing.md }}>
            <Well
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 }}
              onLayout={(e) => { composerY.current = e.nativeEvent.layout.y; }}
            >
              <Sym name="plus.circle.fill" size={18} color={colors.ember} />
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={`Add to ${composerTarget}…`}
                placeholderTextColor={colors.textFaint}
                style={{ flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 10 }}
                returnKeyType="done"
                onSubmitEditing={() => void add()}
                // C6 — bring the composer (and the Due/Assign chips it reveals) up above the
                // keyboard instead of leaving it wherever the page happened to be scrolled.
                onFocus={() => setTimeout(() => scroller.current?.scrollTo({ y: Math.max(0, composerY.current - 24), animated: true }), 180)}
                accessibilityLabel="New task title"
              />
              {title.trim() ? <Button title="Add" variant="ember" small loading={adding} onPress={() => void add()} /> : null}
            </Well>
            {title.trim() ? (
              <>
                <View style={{ gap: 6 }}>
                  <T kind="eyebrow">Due</T>
                  <ChipRow>
                    <Chip label="Today" icon="sun.max" selected={quickDue === "today"} onPress={() => setQuickDue(quickDue === "today" ? null : "today")} />
                    <Chip label="Tomorrow" icon="sunrise" selected={quickDue === "tomorrow"} onPress={() => setQuickDue(quickDue === "tomorrow" ? null : "tomorrow")} />
                    <Chip label="Next week" icon="calendar" selected={quickDue === "nextweek"} onPress={() => setQuickDue(quickDue === "nextweek" ? null : "nextweek")} />
                    <Chip label="Pick…" icon="clock" selected={quickDue === "custom"} onPress={() => setQuickDue(quickDue === "custom" ? null : "custom")} />
                  </ChipRow>
                </View>

                {/* R1 — "upon creating a new task, the start date and time, the due date and
                    time." Quick chips still cover the common case; this is for when the answer
                    is "Thursday at 4:15", which a chip can't say. */}
                {quickDue === "custom" ? (
                  <View style={{ gap: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <T kind="eyebrow">Starts</T>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <DateTimePicker value={startAt} mode="date" display="compact" accentColor={colors.ember} onValueChange={(_e: unknown, d: Date) => setStartAt(d)} />
                        <DateTimePicker value={startAt} mode="time" display="compact" accentColor={colors.ember} onValueChange={(_e: unknown, d: Date) => setStartAt(d)} />
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <T kind="eyebrow">Due</T>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <DateTimePicker value={dueAt} mode="date" display="compact" accentColor={colors.ember} onValueChange={(_e: unknown, d: Date) => setDueAt(d)} />
                        <DateTimePicker value={dueAt} mode="time" display="compact" accentColor={colors.ember} onValueChange={(_e: unknown, d: Date) => setDueAt(d)} />
                      </View>
                    </View>
                  </View>
                ) : null}

                {/* R2/R3 — "the standard should be that all tasks are for yourself and not
                    displayed to others in the family… they should automatically be private
                    unless indicated. That could be down here at the bottom somewhere in this
                    card, not after creation but during the initial creation."
                    Private is the default, and the choice is made here, before it exists. */}
                <VisibilityPicker
                  value={scope.visibility}
                  nestId={scope.nestId}
                  nests={nests.map((n) => ({ id: n.id, label: n.label }))}
                  onChange={setScope}
                />
                {members.length > 0 ? (
                  <View style={{ gap: 6 }}>
                    <T kind="eyebrow">Assign to</T>
                    <ChipRow>
                      {members.map((m) => (
                        <Chip
                          key={m.actorId}
                          label={m.displayName.split(" ")[0]}
                          icon={assignee === m.actorId ? "person.fill" : "person"}
                          selected={assignee === m.actorId}
                          onPress={() => setAssignee(assignee === m.actorId ? null : m.actorId)}
                        />
                      ))}
                    </ChipRow>
                  </View>
                ) : null}
              </>
            ) : null}
          </Card></Coach>
        </Rise>
      ) : null}

      {open.length === 0 && done.length === 0 ? (
        <EmptyState
          icon="checklist"
          title="No tasks yet"
          hint={canAdd ? "Add one above, or ask Famili to plan your week — chores, errands and groceries all land here." : "Tasks your household adds will show up here."}
        />
      ) : null}

      {visibleGroups.map(([name, items]) => (
        <Rise key={name} index={riseIdx++}>
          <SectionHeader title={`${name} · ${items.length}`} />
          <Card padded={false}>
            {items.map((t, i) => (
              <TaskRow
                key={t.id}
                t={t}
                members={members}
                last={i === items.length - 1}
                showGroup={false}
                helping={helperFor.get(t.id) ?? null}
                onToggle={() => void toggle(t)}
                onLongPress={() => menuFor(t)}
                onOpen={() => setEditing(t)}
              />
            ))}
          </Card>
        </Rise>
      ))}

      {activeList !== "All" && visibleGroups.length === 0 && doneVisible.length === 0 ? (
        <EmptyState icon="tray" title={`Nothing in ${activeList}`} hint={canAdd ? "Add the first item above." : undefined} />
      ) : null}

      {doneVisible.length > 0 ? (
        <Rise index={riseIdx++}>
          <SectionHeader title="Completed" />
          <Card padded={false}>
            <Pressable
              onPress={() => { tapHaptic("select"); setDoneOpen((v) => !v); }}
              accessibilityRole="button"
              accessibilityState={{ expanded: doneOpen }}
              accessibilityLabel={`Completed, ${doneVisible.length} tasks`}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: 13, borderBottomWidth: doneOpen ? 1 : 0, borderBottomColor: colors.border }}>
                <Sym name="checkmark.circle" size={16} color={colors.sage} />
                <T kind="bodyMedium" color={colors.textMuted} style={{ flex: 1 }}>Completed</T>
                <Badge label={String(doneVisible.length)} fg={colors.sage} bg={colors.sageBg} />
                <Sym name={doneOpen ? "chevron.up" : "chevron.down"} size={12} color={colors.textFaint} />
              </View>
            </Pressable>
            {doneOpen
              ? doneVisible.map((t, i) => (
                <TaskRow
                  key={t.id}
                  t={t}
                  members={members}
                  last={i === doneVisible.length - 1}
                  showGroup={activeList === "All"}
                  onToggle={() => void toggle(t)}
                  onLongPress={() => menuFor(t)}
                  onOpen={() => setEditing(t)}
                />
              ))
              : null}
          </Card>
        </Rise>
      ) : null}

      <TaskSheet
        visible={!!editing}
        task={editing}
        members={members}
        canEdit={canAdd}
        onClose={() => setEditing(null)}
        onSaved={(t) => setTasks((arr) => arr.map((x) => (x.id === t.id ? t : x)))}
        onDeleted={(tid) => setTasks((arr) => arr.filter((x) => x.id !== tid))}
      />
    </HScreen>
  );
}
