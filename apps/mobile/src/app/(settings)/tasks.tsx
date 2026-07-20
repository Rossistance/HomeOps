// Tasks & Lists — the household to-do surface. Tasks group into lists (explicit
// listName, else a friendly group per type: chores / reminders / errands / bills /
// groceries), with a quick composer for the active list, tactile animated
// check-offs, and a collapsed Completed drawer. The server enforces roles and
// visibility; we only surface friendly messages when it says no.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSequence, withSpring } from "react-native-reanimated";
import { api, type HelpRequestRec, type MemberRec, type TaskRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useRevSync } from "@/lib/rev-sync";
import { useTheme, tapHaptic, type HearthColors } from "@/theme";
// "ui/index" (not "ui"): the legacy src/components/ui.tsx still shadows the ui/
// directory until the old screens are all ported — this resolves the new system.
import { Badge, Button, Card, Chip, ChipRow, EmptyState, ErrorState, HScreen, Notice, Rise, SectionHeader, SkeletonCards, Sym, T, Well } from "@/components/ui";

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
type QuickDue = "today" | "tomorrow" | "nextweek" | null;

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

const AVATAR_TONES: ((c: HearthColors) => { fg: string; bg: string })[] = [
  (c) => ({ fg: c.sky, bg: c.skyBg }),
  (c) => ({ fg: c.sage, bg: c.sageBg }),
  (c) => ({ fg: c.amber, bg: c.amberBg }),
  (c) => ({ fg: c.lavender, bg: c.lavenderBg }),
  (c) => ({ fg: c.coral, bg: c.coralBg }),
];

/* --------------------------- animated checkbox ------------------------- */
function TaskCheck({ done, onPress }: { done: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    scale.value = withSequence(
      withSpring(1.2, { damping: 12, stiffness: 420, reduceMotion: ReduceMotion.System }),
      withSpring(1, { damping: 15, stiffness: 320, reduceMotion: ReduceMotion.System }),
    );
  }, [done, scale]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={done ? "Mark as open" : "Mark as done"}>
      <Animated.View
        style={[{
          width: 24, height: 24, borderRadius: 12, borderWidth: 2,
          borderColor: done ? colors.sage : colors.textFaint,
          backgroundColor: done ? colors.sage : "transparent",
          alignItems: "center", justifyContent: "center",
        }, a]}
      >
        {done ? <Sym name="checkmark" size={13} color={colors.surface} /> : null}
      </Animated.View>
    </Pressable>
  );
}

/* -------------------------------- row ---------------------------------- */
function TaskRow({ t, members, last, showGroup, helping, onToggle, onLongPress }: {
  t: TaskRec; members: MemberRec[]; last: boolean; showGroup: boolean;
  helping?: string | null; // helper's name when an accepted help request moved/covers this task (WP-001)
  onToggle: () => void; onLongPress: () => void;
}) {
  const { colors, spacing } = useTheme();
  const done = t.status === "done";
  const overdue = !done && !!t.dueAt && Date.parse(t.dueAt) < Date.now();
  const pri = t.priority === "high" ? colors.coral : t.priority === "medium" ? colors.amber : colors.sage;
  const mi = members.findIndex((m) => m.actorId === t.assignedMemberId);
  const member = mi >= 0 ? members[mi] : null;
  const av = AVATAR_TONES[Math.max(mi, 0) % AVATAR_TONES.length](colors);
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={350} accessibilityLabel={t.title}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
        <TaskCheck done={done} onPress={onToggle} />
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
  const [doneOpen, setDoneOpen] = useState(false);
  // Composer
  const [title, setTitle] = useState("");
  const [quickDue, setQuickDue] = useState<QuickDue>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const [tks, mems, hrs] = await Promise.all([api.tasks(), api.members(), api.helpRequests()]);
    if (mems.length === 0 && !(await api.health())) {
      setError("The FamiliOS server didn't answer.");
    } else {
      setError(null);
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

  const open = useMemo(() => tasks.filter((t) => t.status !== "done"), [tasks]);
  const done = useMemo(() => tasks.filter((t) => t.status === "done"), [tasks]);
  const listNames = useMemo(() => [...new Set(tasks.map(groupOf))].sort((a, b) => a.localeCompare(b)), [tasks]);

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

  const add = async () => {
    const name = title.trim();
    if (!name || adding) return;
    setAdding(true); setNotice(null);
    const target = activeList === "All" ? { type: "task" } : (GROUP_CREATE[activeList] ?? { type: "list", listName: activeList });
    const r = await api.createTask({
      title: name, type: target.type, dueAt: dueFromQuick(quickDue),
      assignedMemberId: assignee, listName: target.listName,
    });
    if (r.task) {
      let created = r.task;
      // POST /api/tasks doesn't persist listName — patch it on so the task lands in its list.
      if (target.listName && created.listName !== target.listName) {
        const p = await api.updateTask(created.id, { listName: target.listName });
        if (p.task) created = p.task;
      }
      setTasks((arr) => [created, ...arr]);
      setTitle(""); setQuickDue(null); setAssignee(null);
      tapHaptic("success");
    } else {
      setNotice({ ok: false, text: r.error === "insufficient_role" ? "Adding tasks needs Limited Member or higher." : friendly(r.error) });
    }
    setAdding(false);
  };

  /* ------------------------------- render ------------------------------ */
  if (loading) return <HScreen><SkeletonCards count={4} /></HScreen>;
  if (error) return <HScreen refreshing={refreshing} onRefresh={onRefresh}><ErrorState message={error} onRetry={() => void load()} /></HScreen>;

  const composerTarget = activeList === "All" ? "Tasks" : activeList;
  let riseIdx = 0;

  return (
    <HScreen refreshing={refreshing} onRefresh={onRefresh}>
      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

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
          <Card style={{ gap: spacing.md }}>
            <Well style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 }}>
              <Sym name="plus.circle.fill" size={18} color={colors.ember} />
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={`Add to ${composerTarget}…`}
                placeholderTextColor={colors.textFaint}
                style={{ flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 10 }}
                returnKeyType="done"
                onSubmitEditing={() => void add()}
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
                  </ChipRow>
                </View>
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
          </Card>
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
                />
              ))
              : null}
          </Card>
        </Rise>
      ) : null}
    </HScreen>
  );
}
