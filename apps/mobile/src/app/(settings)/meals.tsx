// Meals — the family meal plan: a rolling week strip (dots mark planned days),
// slot filter chips, meal cards with one-tap "→ groceries" / "→ calendar", and
// an add-meal composer (header +). The grocery checklist lives on its own
// Groceries screen; a link row here shows the open-item count.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeOut, LinearTransition, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Stack, router, useFocusEffect } from "expo-router";
import { api, type Meal, type TaskRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useRevSync } from "@/lib/rev-sync";
import { useTheme, tapHaptic, type HearthColors } from "@/theme";
// Deep imports (not the "@/components/ui" barrel): the legacy src/components/ui.tsx
// still shadows the ui/ directory until old screens are deleted centrally.
import { Badge, Chip, ChipRow } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, PressableCard, Well } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/list";
import { PressableScale } from "@/components/ui/pressable-scale";
import { HScreen } from "@/components/ui/screen";
import { HSheet, SheetCTA } from "@/components/ui/sheet";
import { SkeletonCards } from "@/components/ui/skeleton";
import { Rise } from "@/components/ui/stagger";
import { EmptyState, ErrorState, Notice } from "@/components/ui/states";
import { Sym, SymTile } from "@/components/ui/symbol";
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
  const [editing, setEditing] = useState<Meal | null>(null);

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
  useRevSync(useCallback(() => { void load(); }, [load]));
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
    const doDelete = async (deleteGroceries: boolean) => {
      setBusy(`d:${m.id}`);
      const r = await api.deleteMeal(m.id, { deleteGroceries });
      setBusy(null);
      if (r.error) setNotice({ text: r.error === "insufficient_role" ? "You can't remove this meal." : `Couldn't remove: ${r.error}`, ok: false });
      else {
        tapHaptic("success");
        const bits = [
          (r.removedEvents ?? 0) > 0 ? "calendar event removed" : null,
          (r.removedGroceries ?? 0) > 0 ? `${r.removedGroceries} ingredient${r.removedGroceries === 1 ? "" : "s"} off the grocery list` : null,
          (r.unlinkedGroceries ?? 0) > 0 ? `${r.unlinkedGroceries} grocery item${r.unlinkedGroceries === 1 ? "" : "s"} kept` : null,
        ].filter(Boolean);
        setNotice({ text: `Meal removed${bits.length ? ` — ${bits.join(", ")}` : ""}.`, ok: true });
      }
      await load();
    };
    Alert.alert(
      "Remove meal?",
      `“${m.title}” comes off the plan and its calendar event is deleted. Also remove the ingredients it added to the grocery list?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Keep ingredients", style: "destructive", onPress: () => void doDelete(false) },
        { text: "Remove ingredients too", style: "destructive", onPress: () => void doDelete(true) },
      ],
    );
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

      {/* The grocery list lives on its own screen — one link row keeps it a tap away. */}
      <Rise index={2}>
        <PressableCard
          onPress={() => router.push("/groceries")}
          accessibilityRole="button"
          accessibilityLabel="Open grocery list"
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
        >
          <SymTile name="cart" color={colors.sage} bg={colors.sageBg} size={36} iconSize={17} />
          <View style={{ flex: 1, gap: 2 }}>
            <T kind="rowTitle">Grocery list</T>
            <T kind="detail">{openCount > 0 ? `${openCount} item${openCount === 1 ? "" : "s"} to get` : "Nothing on the list"}</T>
          </View>
          <Sym name="chevron.right" size={13} color={colors.textFaint} />
        </PressableCard>
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
                        onEdit={() => setEditing(m)}
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
                    onEdit={() => setEditing(m)}
                    onRemove={() => removeMeal(m)}
                  />
                ))}
              </View>
            </Rise>
          ) : null}
        </>
      )}

      {/* Edit a meal in place — PATCHes the record, preserving mealId links. */}
      <MealEditSheet
        meal={editing}
        visible={!!editing}
        week={week}
        todayKey={todayKey}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void load(); }}
      />
    </HScreen>
  );
}

/** Edit-a-meal sheet: title/date/slot/time/servings/ingredients/recipe/notes.
 *  PATCHes the existing meal (mealId back-references stay intact server-side). */
function MealEditSheet({ meal, visible, week, todayKey, onClose, onSaved }: {
  meal: Meal | null;
  visible: boolean;
  week: Date[];
  todayKey: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors, spacing, type } = useTheme();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot>("dinner");
  const [time, setTime] = useState("");
  const [servings, setServings] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [recipeUrl, setRecipeUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!meal) return;
    setTitle(meal.title);
    setDate(meal.date);
    setSlot((SLOTS as readonly string[]).includes(meal.slot) ? (meal.slot as Slot) : "dinner");
    setTime(meal.time ?? "");
    setServings(meal.servings != null ? String(meal.servings) : "");
    setIngredients(meal.ingredients.map((i) => i.item).join(", "));
    setRecipeUrl(meal.recipeUrl ?? "");
    setNotes(meal.notes ?? "");
    setErr(null);
  }, [meal]);

  const inputStyle = [type.body, { color: colors.text, backgroundColor: colors.surfaceSunken, borderRadius: 12, borderCurve: "continuous" as const, paddingHorizontal: spacing.md, paddingVertical: 10 }];

  const save = async () => {
    if (!meal || !title.trim() || busy) return;
    setBusy(true); setErr(null);
    // Preserve `have` flags for ingredients whose names didn't change.
    const prev = new Map(meal.ingredients.map((i) => [i.item, !!i.have]));
    const names = ingredients.split(",").map((s) => s.trim()).filter(Boolean);
    const ing = names.map((item) => ({ item, have: prev.get(item) ?? false }));
    const t = time.trim();
    const s = parseInt(servings, 10);
    const r = await api.patchMeal(meal.id, {
      title: title.trim(),
      date,
      slot,
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null,
      servings: Number.isFinite(s) && s > 0 ? s : null,
      ingredients: ing,
      recipeUrl: recipeUrl.trim(),
      notes: notes.trim(),
      ifUpdatedAt: meal.updatedAt,
    });
    setBusy(false);
    if (r.meal) { tapHaptic("success"); onSaved(); }
    else if (r.error === "stale_write") setErr("This meal changed on another device — close and reopen to edit.");
    else setErr(r.error === "forbidden" ? "You can only edit meals you added." : `Couldn't save: ${r.message ?? r.error ?? "unknown error"}`);
  };

  return (
    <HSheet
      visible={visible}
      onClose={onClose}
      title="Edit meal"
      leftLabel="Cancel"
      heightPct={0.9}
      footer={<SheetCTA title={busy ? "Saving…" : "Save changes"} onPress={() => void save()} disabled={busy || !title.trim()} />}
    >
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
        {err ? <Notice text={err} ok={false} /> : null}
        <View style={{ gap: 6 }}>
          <T kind="eyebrow">Meal</T>
          <TextInput style={inputStyle} placeholder="Meal name" placeholderTextColor={colors.textFaint} value={title} onChangeText={setTitle} accessibilityLabel="Meal title" />
        </View>

        <View style={{ gap: 6 }}>
          <T kind="eyebrow">Day</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }} keyboardShouldPersistTaps="handled">
            <Chip label="No date" selected={date === null} onPress={() => setDate(null)} />
            {week.map((d) => {
              const k = dayKey(d);
              return (
                <Chip
                  key={k}
                  label={k === todayKey ? "Today" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                  selected={date === k}
                  onPress={() => setDate(k)}
                />
              );
            })}
          </ScrollView>
        </View>

        <View style={{ gap: 6 }}>
          <T kind="eyebrow">Slot</T>
          <ChipRow>
            {SLOTS.map((s) => <Chip key={s} label={s} selected={slot === s} onPress={() => setSlot(s)} />)}
          </ChipRow>
        </View>

        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1, gap: 6 }}>
            <T kind="eyebrow">Time (HH:MM)</T>
            <TextInput style={inputStyle} placeholder="18:00" placeholderTextColor={colors.textFaint} value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" accessibilityLabel="Meal time, 24-hour HH:MM" />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <T kind="eyebrow">Servings</T>
            <TextInput style={inputStyle} placeholder="4" placeholderTextColor={colors.textFaint} value={servings} onChangeText={setServings} keyboardType="number-pad" accessibilityLabel="Servings" />
          </View>
        </View>

        <View style={{ gap: 6 }}>
          <T kind="eyebrow">Ingredients</T>
          <TextInput style={inputStyle} placeholder="Comma-separated" placeholderTextColor={colors.textFaint} value={ingredients} onChangeText={setIngredients} accessibilityLabel="Ingredients, comma-separated" />
        </View>

        <View style={{ gap: 6 }}>
          <T kind="eyebrow">Recipe link</T>
          <TextInput style={inputStyle} placeholder="https://…" placeholderTextColor={colors.textFaint} value={recipeUrl} onChangeText={setRecipeUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Recipe URL" />
        </View>

        <View style={{ gap: 6 }}>
          <T kind="eyebrow">Notes</T>
          <TextInput style={[inputStyle, { minHeight: 72 }]} placeholder="Prep notes, sides, reminders…" placeholderTextColor={colors.textFaint} value={notes} onChangeText={setNotes} multiline accessibilityLabel="Meal notes" />
        </View>
      </ScrollView>
    </HSheet>
  );
}

/** One planned meal: slot badge, ingredient preview, and the action row. */
function MealCard({ m, canManage, busy, onGrocery, onCalendar, onEdit, onRemove }: {
  m: Meal;
  canManage: boolean;
  busy: string | null;
  onGrocery: () => void;
  onCalendar: () => void;
  onEdit: () => void;
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
            haptic="select"
            hitSlop={8}
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${m.title}`}
            style={{ padding: 8 }}
          >
            <Sym name="pencil" size={17} color={colors.textMuted} />
          </PressableScale>
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
