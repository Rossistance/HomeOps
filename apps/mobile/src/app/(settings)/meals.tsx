// Meals — the family meal plan: a rolling week strip (dots mark planned days),
// slot filter chips, meal cards with one-tap "→ groceries" / "→ calendar",
// an add-meal composer (header +), and the shared grocery checklist
// (list-tasks named "Groceries") with an animated strikethrough on check-off.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeOut, LinearTransition, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Stack, useFocusEffect } from "expo-router";
import { api, type Meal, type TaskRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme, tapHaptic, type HearthColors } from "@/theme";
// Deep imports (not the "@/components/ui" barrel): the legacy src/components/ui.tsx
// still shadows the ui/ directory until old screens are deleted centrally.
import { Badge, Chip, ChipRow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, Well } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/list";
import { PressableScale } from "@/components/ui/pressable-scale";
import { HScreen } from "@/components/ui/screen";
import { SkeletonCards } from "@/components/ui/skeleton";
import { Rise } from "@/components/ui/stagger";
import { EmptyState, ErrorState, Notice } from "@/components/ui/states";
import { Sym } from "@/components/ui/symbol";
import { T } from "@/components/ui/text";

const MANAGE_ROLES = ["Owner", "Adult Admin", "Adult Member", "Limited Member"];
const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
type Slot = (typeof SLOTS)[number];
const pad2 = (n: number) => String(n).padStart(2, "0");
/** Local (not UTC) YYYY-MM-DD — meal dates are literal day strings. */
const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function slotTint(c: HearthColors, slot: string): { fg: string; bg: string } {
  switch (slot) {
    case "breakfast": return { fg: c.amber, bg: c.amberBg };
    case "lunch": return { fg: c.sage, bg: c.sageBg };
    case "dinner": return { fg: c.ember, bg: c.emberBg };
    case "snack": return { fg: c.lavender, bg: c.lavenderBg };
    default: return { fg: c.textMuted, bg: c.surfaceSunken };
  }
}

export default function MealsScreen() {
  const { session } = useSession();
  const { colors, spacing, type } = useTheme();
  const canManage = MANAGE_ROLES.includes(session?.role ?? "");

  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [meals, setMeals] = useState<Meal[]>([]);
  const [groceries, setGroceries] = useState<TaskRec[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [slotFilter, setSlotFilter] = useState<Slot | null>(null);

  // Composer (opened from the header +)
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [mDate, setMDate] = useState<string | null>(dayKey(new Date()));
  const [slot, setSlot] = useState<Slot>("dinner");
  const [ingredients, setIngredients] = useState("");

  const load = useCallback(async () => {
    // api.* swallow network errors into empty arrays, so probe /health for honesty.
    const [health, m, tasks] = await Promise.all([api.health(), api.meals(), api.tasks()]);
    if (!health) { setPhase("error"); return; }
    setMeals(m);
    setGroceries(tasks.filter((t) => t.type === "list" && (t.listName ?? "Groceries") === "Groceries"));
    setPhase("ready");
  }, []);
  useFocusEffect(useCallback(() => { if (session) void load(); }, [session, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i); return d;
  }), []);
  const todayKey = dayKey(new Date());
  const byDay = useMemo(() => {
    const map: Record<string, Meal[]> = {};
    for (const m of meals) { const k = m.date ?? "unscheduled"; (map[k] ??= []).push(m); }
    return map;
  }, [meals]);

  const mealsFor = useCallback((k: string) => {
    const list = (byDay[k] ?? [])
      .slice()
      .sort((a, b) => SLOTS.indexOf(a.slot as Slot) - SLOTS.indexOf(b.slot as Slot));
    return slotFilter ? list.filter((m) => m.slot === slotFilter) : list;
  }, [byDay, slotFilter]);

  /* ---- actions (ported from the old Meals screen) ---- */

  const add = async () => {
    if (!title.trim()) return;
    setBusy("add"); setNotice(null);
    const ing = ingredients.split(",").map((s) => s.trim()).filter(Boolean);
    const r = await api.createMeal({ title: title.trim(), date: mDate, slot, ingredients: ing });
    setBusy(null);
    if (r.meal) {
      setTitle(""); setIngredients(""); setComposerOpen(false);
      tapHaptic("success");
      setNotice({ text: "Meal added.", ok: true });
      await load();
    } else {
      setNotice({ text: r.error === "insufficient_role" ? "Adding meals needs Limited Member or higher." : `Couldn't add: ${r.error ?? "unknown error"}`, ok: false });
    }
  };

  const toGrocery = async (m: Meal) => {
    setBusy(`g:${m.id}`); setNotice(null);
    const r = await api.mealToGrocery(m.id);
    setBusy(null);
    if (r.ok) { tapHaptic("success"); setNotice({ text: `Added ${r.added ?? 0} item${r.added === 1 ? "" : "s"} to groceries.`, ok: true }); await load(); }
    else setNotice({ text: `Couldn't add to groceries: ${r.error ?? "unknown error"}`, ok: false });
  };

  // Meal → canonical calendar event (idempotent — re-tap updates the same event).
  const toCalendar = async (m: Meal) => {
    setBusy(`c:${m.id}`); setNotice(null);
    const r = await api.mealToCalendar(m.id);
    setBusy(null);
    if (r.ok && r.event) { tapHaptic("success"); setNotice({ text: `${r.action === "updated" ? "Updated" : "Added"} “${r.event.title}” on the calendar. Push it to Google from the web Calendar if you want it there too.`, ok: true }); }
    else setNotice({ text: r.error === "date_required" ? "Give the meal a date first." : `Couldn't add to calendar: ${r.message ?? r.error ?? "unknown error"}`, ok: false });
  };

  const removeMeal = (m: Meal) => {
    Alert.alert(
      "Remove meal?",
      `“${m.title}” comes off the plan. Grocery items it added stay on your list.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove", style: "destructive",
          onPress: () => void (async () => {
            setBusy(`d:${m.id}`);
            const r = await api.deleteMeal(m.id);
            setBusy(null);
            if (r.error) setNotice({ text: r.error === "insufficient_role" ? "You can't remove this meal." : `Couldn't remove: ${r.error}`, ok: false });
            else {
              tapHaptic("success");
              const n = r.unlinkedGroceries ?? 0;
              setNotice({ text: n > 0 ? `Meal removed. ${n} grocery item${n === 1 ? "" : "s"} stayed on your list, just unlinked.` : "Meal removed.", ok: true });
            }
            await load();
          })(),
        },
      ],
    );
  };

  const toggleGrocery = async (t: TaskRec) => {
    const next = t.status === "done" ? "todo" : "done";
    tapHaptic("select");
    setGroceries((g) => g.map((x) => (x.id === t.id ? { ...x, status: next } : x))); // optimistic
    const r = await api.updateTask(t.id, { status: next });
    if (r.error) {
      setGroceries((g) => g.map((x) => (x.id === t.id ? { ...x, status: t.status } : x)));
      setNotice({ text: `Couldn't update: ${r.error}`, ok: false });
    }
  };

  const removeGrocery = async (t: TaskRec) => {
    setGroceries((g) => g.filter((x) => x.id !== t.id)); // optimistic
    const r = await api.deleteTask(t.id);
    if (r.error) {
      await load();
      setNotice({ text: r.error === "insufficient_role" ? "Ask an adult to remove this item." : `Couldn't remove: ${r.error}`, ok: false });
    }
  };

  const openCount = groceries.filter((g) => g.status !== "done").length;
  const visibleDayKeys = selectedDay ? week.map(dayKey).filter((k) => k === selectedDay) : week.map(dayKey);
  const anyVisibleMeals = visibleDayKeys.some((k) => mealsFor(k).length > 0);
  const unscheduled = slotFilter ? (byDay["unscheduled"] ?? []).filter((m) => m.slot === slotFilter) : byDay["unscheduled"] ?? [];

  const header = (
    <Stack.Screen
      options={{
        headerRight: canManage
          ? () => (
            <PressableScale
              onPress={() => setComposerOpen((v) => !v)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={composerOpen ? "Close new meal form" : "Add a meal"}
              style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.emberBg, alignItems: "center", justifyContent: "center" }}
            >
              <Sym name={composerOpen ? "xmark" : "plus"} size={15} color={colors.ember} />
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

      {/* Week strip — dots mark days with meals; tap toggles a one-day focus. */}
      <Rise index={0}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -spacing.lg }}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
        >
          {week.map((d) => {
            const k = dayKey(d);
            const isToday = k === todayKey;
            const isSelected = k === selectedDay;
            const hasMeals = (byDay[k]?.length ?? 0) > 0;
            return (
              <PressableScale
                key={k}
                haptic="select"
                onPress={() => setSelectedDay(isSelected ? null : k)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}${hasMeals ? ", has meals" : ""}`}
                style={{
                  width: 52, paddingVertical: 10, borderRadius: 16, borderCurve: "continuous",
                  alignItems: "center", gap: 2,
                  backgroundColor: isSelected ? colors.ember : isToday ? colors.emberBg : colors.surface,
                  borderWidth: 1,
                  borderColor: isSelected || isToday ? "transparent" : colors.border,
                }}
              >
                <T kind="caption" color={isSelected ? colors.onEmber : isToday ? colors.ember : colors.textFaint}>
                  {d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}
                </T>
                <T kind="h3" color={isSelected ? colors.onEmber : isToday ? colors.ember : colors.textSecondary}>{d.getDate()}</T>
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: hasMeals ? (isSelected ? colors.onEmber : colors.ember) : "transparent" }} />
              </PressableScale>
            );
          })}
        </ScrollView>
      </Rise>

      {/* Slot filter */}
      <Rise index={1}>
        <ChipRow>
          {SLOTS.map((s) => (
            <Chip key={s} label={s} selected={slotFilter === s} onPress={() => setSlotFilter(slotFilter === s ? null : s)} />
          ))}
        </ChipRow>
      </Rise>

      {!canManage ? (
        <T kind="sub" color={colors.textFaint}>You can see the plan; adding meals needs Limited Member or higher.</T>
      ) : null}
      {notice ? <Notice text={notice.text} ok={notice.ok} /> : null}

      {/* Add-meal composer */}
      {composerOpen && canManage ? (
        <Rise index={0}>
          <Well style={{ gap: spacing.md }}>
            <TextInput
              style={[type.body, { color: colors.text, backgroundColor: colors.surface, borderRadius: 12, borderCurve: "continuous", paddingHorizontal: spacing.md, paddingVertical: 10 }]}
              placeholder="Meal (e.g. Taco night)"
              placeholderTextColor={colors.textFaint}
              value={title}
              onChangeText={setTitle}
              accessibilityLabel="Meal title"
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              <Chip label="No date" selected={mDate === null} onPress={() => setMDate(null)} />
              {week.map((d) => {
                const k = dayKey(d);
                return (
                  <Chip
                    key={k}
                    label={k === todayKey ? "Today" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                    selected={mDate === k}
                    onPress={() => setMDate(k)}
                  />
                );
              })}
            </ScrollView>
            <ChipRow>
              {SLOTS.map((s) => (
                <Chip key={s} label={s} selected={slot === s} onPress={() => setSlot(s)} />
              ))}
            </ChipRow>
            <TextInput
              style={[type.body, { color: colors.text, backgroundColor: colors.surface, borderRadius: 12, borderCurve: "continuous", paddingHorizontal: spacing.md, paddingVertical: 10 }]}
              placeholder="Ingredients, comma-separated"
              placeholderTextColor={colors.textFaint}
              value={ingredients}
              onChangeText={setIngredients}
              accessibilityLabel="Ingredients"
            />
            <Button title="Add meal" variant="ember" full loading={busy === "add"} disabled={!title.trim()} onPress={() => void add()} />
          </Well>
        </Rise>
      ) : null}

      {/* Grocery checklist first — it's the thing you check in the store aisle. */}
      <Rise index={2}>
        <SectionHeader title={`Groceries${openCount > 0 ? ` · ${openCount} open` : ""}`} />
        {groceries.length === 0 ? (
          <Card>
            <T kind="sub">Empty. Add ingredients from a meal below.</T>
          </Card>
        ) : (
          <Card padded={false} style={{ paddingVertical: 4 }}>
            {groceries.map((t, i) => (
              <GroceryRow
                key={t.id}
                task={t}
                divider={i > 0}
                onToggle={() => void toggleGrocery(t)}
                onRemove={() => void removeGrocery(t)}
              />
            ))}
          </Card>
        )}
      </Rise>

      {/* Week plan */}
      {!anyVisibleMeals && unscheduled.length === 0 ? (
        <EmptyState
          icon="fork.knife"
          title={slotFilter ? `No ${slotFilter} planned` : selectedDay ? "Nothing planned this day" : "No meals planned yet"}
          hint={canManage ? "Plan the week and turn meals into a grocery list in one tap." : "Nothing on the plan for this view yet."}
          action={canManage ? { title: "Plan a meal", onPress: () => setComposerOpen(true) } : undefined}
        />
      ) : (
        <>
          {visibleDayKeys.map((k, di) => {
            const dayMeals = mealsFor(k);
            if (dayMeals.length === 0 && (slotFilter || selectedDay === null)) {
              // With a filter on, silently skip empty days; unfiltered full-week
              // view keeps quiet gaps too — headers only where meals exist.
              return null;
            }
            const d = new Date(`${k}T00:00:00`);
            return (
              <Rise key={k} index={di + 3}>
                <SectionHeader title={`${k === todayKey ? "Today · " : ""}${d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}`} />
                {dayMeals.length === 0 ? (
                  <Card><T kind="sub">No meals planned.</T></Card>
                ) : (
                  <View style={{ gap: spacing.sm }}>
                    {dayMeals.map((m) => (
                      <MealCard
                        key={m.id}
                        m={m}
                        canManage={canManage}
                        busy={busy}
                        onGrocery={() => void toGrocery(m)}
                        onCalendar={() => void toCalendar(m)}
                        onRemove={() => removeMeal(m)}
                      />
                    ))}
                  </View>
                )}
              </Rise>
            );
          })}

          {unscheduled.length > 0 && !selectedDay ? (
            <Rise index={visibleDayKeys.length + 3}>
              <SectionHeader title="Unscheduled" />
              <View style={{ gap: spacing.sm }}>
                {unscheduled.map((m) => (
                  <MealCard
                    key={m.id}
                    m={m}
                    canManage={canManage}
                    busy={busy}
                    onGrocery={() => void toGrocery(m)}
                    onCalendar={() => void toCalendar(m)}
                    onRemove={() => removeMeal(m)}
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

/** One planned meal: slot badge, ingredient preview, and the action row. */
function MealCard({ m, canManage, busy, onGrocery, onCalendar, onRemove }: {
  m: Meal;
  canManage: boolean;
  busy: string | null;
  onGrocery: () => void;
  onCalendar: () => void;
  onRemove: () => void;
}) {
  const { colors, spacing } = useTheme();
  const tint = slotTint(colors, m.slot);
  const needs = m.ingredients.filter((i) => !i.have).length;
  const [open, setOpen] = useState(false);
  const recipeUrl = (m as Meal & { recipeUrl?: string }).recipeUrl;
  const instructions = ((m as Meal & { instructions?: string[] }).instructions ?? []).filter(Boolean);
  return (
    <Card>
      {/* Tap the header to expand: full ingredients, instructions, recipe link. */}
      <PressableScale onPress={() => setOpen(!open)} haptic="select" accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <T kind="bodyMedium" color={colors.text} style={{ flex: 1 }} numberOfLines={2}>{m.title}</T>
          <Badge label={m.slot} fg={tint.fg} bg={tint.bg} />
          <Sym name={open ? "chevron.up" : "chevron.down"} size={12} color={colors.textFaint} />
        </View>
      </PressableScale>
      {!open && m.ingredients.length > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
          <Sym name="cart" size={12} color={colors.textFaint} />
          <T kind="sub" numberOfLines={2} style={{ flex: 1 }}>
            {m.ingredients.length} ingredient{m.ingredients.length === 1 ? "" : "s"}
            {needs > 0 ? ` · ${needs} needed` : ""} — {m.ingredients.map((i) => i.item).join(", ")}
          </T>
        </View>
      ) : null}
      {open ? (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {m.ingredients.length > 0 ? (
            <>
              <T kind="eyebrow">Ingredients</T>
              {m.ingredients.map((i, idx) => (
                <T key={idx} kind="sub" color={i.have ? colors.textFaint : colors.textSecondary}>
                  {i.have ? "✓ " : "• "}{i.item}
                </T>
              ))}
            </>
          ) : (
            <T kind="sub">No ingredients recorded — ask Famili to plan this meal again to fill them in.</T>
          )}
          {instructions.length > 0 ? (
            <>
              <T kind="eyebrow" style={{ marginTop: 4 }}>Instructions</T>
              {instructions.slice(0, 12).map((s, idx) => (
                <T key={idx} kind="sub" color={colors.textSecondary}>{idx + 1}. {s}</T>
              ))}
            </>
          ) : null}
          {recipeUrl ? (
            <PressableScale onPress={() => { void Linking.openURL(recipeUrl); }} haptic="select" accessibilityRole="link" style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
              <Sym name="link" size={13} color={colors.ember} />
              <T kind="subMedium" color={colors.ember} numberOfLines={1} style={{ flex: 1 }}>Open recipe</T>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
      {canManage ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md }}>
          {m.ingredients.some((i) => !i.have) ? (
            <Button small title="Groceries" icon="cart.badge.plus" loading={busy === `g:${m.id}`} onPress={onGrocery} />
          ) : null}
          {m.date ? (
            <Button small title="Calendar" icon="calendar.badge.plus" loading={busy === `c:${m.id}`} onPress={onCalendar} />
          ) : null}
          <View style={{ flex: 1 }} />
          <PressableScale
            haptic="warning"
            hitSlop={8}
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${m.title}`}
            style={{ padding: 8 }}
          >
            <Sym name={busy === `d:${m.id}` ? "hourglass" : "trash"} size={17} color={colors.coral} />
          </PressableScale>
        </View>
      ) : null}
    </Card>
  );
}

/** Grocery checklist row — the strike line sweeps across as an item is checked. */
function GroceryRow({ task, divider, onToggle, onRemove }: {
  task: TaskRec;
  divider: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { colors, spacing } = useTheme();
  const done = task.status === "done";
  const strike = useSharedValue(done ? 1 : 0);
  useEffect(() => {
    strike.value = withTiming(done ? 1 : 0, { duration: 240, reduceMotion: ReduceMotion.System });
  }, [done, strike]);
  const strikeStyle = useAnimatedStyle(() => ({ width: `${strike.value * 100}%` }));

  return (
    <Animated.View
      layout={LinearTransition.duration(200).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(160).reduceMotion(ReduceMotion.System)}
      style={{
        flexDirection: "row", alignItems: "center",
        paddingHorizontal: spacing.lg,
        borderTopWidth: divider ? 1 : 0, borderTopColor: colors.border,
      }}
    >
      <PressableScale
        haptic={null}
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={task.title}
        style={{ flexDirection: "row", alignItems: "center", flex: 1, paddingVertical: 11, gap: spacing.md }}
      >
        <Sym name={done ? "checkmark.circle.fill" : "circle"} size={20} color={done ? colors.sage : colors.textFaint} />
        <View style={{ flex: 1, justifyContent: "center" }}>
          <T kind="body" color={done ? colors.textFaint : colors.text}>{task.title}</T>
          <Animated.View
            pointerEvents="none"
            style={[
              { position: "absolute", left: 0, top: "50%", height: 1.5, borderRadius: 1, backgroundColor: colors.textFaint },
              strikeStyle,
            ]}
          />
        </View>
      </PressableScale>
      <PressableScale
        haptic="select"
        hitSlop={8}
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${task.title}`}
        style={{ padding: 8, marginLeft: 4 }}
      >
        <Sym name="xmark" size={13} color={colors.textFaint} />
      </PressableScale>
    </Animated.View>
  );
}
