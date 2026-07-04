import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, type Meal, type TaskRec } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Badge, Body, Button, Card, Eyebrow, H1, Muted, Screen } from "@/components/ui";
import { Hearth } from "@/constants/hearth";

// Meals — the family meal plan on mobile: a rolling week, one-tap "send to
// groceries", and the shared grocery checklist (list-tasks named "Groceries").
const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export default function MealsScreen() {
  const { session } = useSession();
  const canManage = ["Owner", "Adult Admin", "Adult Member", "Limited Member"].includes(session?.role ?? "");
  const [meals, setMeals] = useState<Meal[]>([]);
  const [groceries, setGroceries] = useState<TaskRec[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  // Composer
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(dayKey(new Date()));
  const [slot, setSlot] = useState<(typeof SLOTS)[number]>("dinner");
  const [ingredients, setIngredients] = useState("");

  const load = useCallback(async () => {
    const [m, tasks] = await Promise.all([api.meals(), api.tasks()]);
    setMeals(m);
    setGroceries(tasks.filter((t) => t.type === "list" && (t.listName ?? "Groceries") === "Groceries"));
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; }), []);
  const byDay = useMemo(() => {
    const map: Record<string, Meal[]> = {};
    for (const m of meals) { const k = m.date ?? "unscheduled"; (map[k] ??= []).push(m); }
    return map;
  }, [meals]);

  const add = async () => {
    if (!title.trim()) return;
    setBusy("add"); setNotice(null);
    const ing = ingredients.split(",").map((s) => s.trim()).filter(Boolean);
    const r = await api.createMeal({ title: title.trim(), date: /^\d{4}-\d{2}-\d{2}$/.test(date.trim()) ? date.trim() : null, slot, ingredients: ing });
    setBusy(null);
    if (r.meal) {
      setTitle(""); setIngredients(""); setComposerOpen(false);
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
    if (r.ok) { setNotice({ text: `Added ${r.added ?? 0} item${r.added === 1 ? "" : "s"} to groceries.`, ok: true }); await load(); }
    else setNotice({ text: `Couldn't add to groceries: ${r.error ?? "unknown error"}`, ok: false });
  };

  const removeMeal = async (m: Meal) => {
    setBusy(`d:${m.id}`);
    const r = await api.deleteMeal(m.id);
    setBusy(null);
    if (r.error) setNotice({ text: r.error === "insufficient_role" ? "You can't remove this meal." : `Couldn't remove: ${r.error}`, ok: false });
    else {
      const n = r.unlinkedGroceries ?? 0;
      setNotice({ text: n > 0 ? `Meal removed. ${n} grocery item${n === 1 ? "" : "s"} stayed on your list, just unlinked.` : "Meal removed.", ok: true });
    }
    await load();
  };

  // Item 5: meal → canonical calendar event (idempotent — re-tap updates the same event).
  const toCalendar = async (m: Meal) => {
    setBusy(`c:${m.id}`); setNotice(null);
    const r = await api.mealToCalendar(m.id);
    setBusy(null);
    if (r.ok && r.event) setNotice({ text: `${r.action === "updated" ? "Updated" : "Added"} “${r.event.title}” on the calendar. Push it to Google from the web Calendar if you want it there too.`, ok: true });
    else setNotice({ text: r.error === "date_required" ? "Give the meal a date first." : `Couldn't add to calendar: ${r.message ?? r.error ?? "unknown error"}`, ok: false });
  };

  const toggleGrocery = async (t: TaskRec) => {
    const next = t.status === "done" ? "todo" : "done";
    setGroceries((g) => g.map((x) => (x.id === t.id ? { ...x, status: next } : x))); // optimistic
    const r = await api.updateTask(t.id, { status: next });
    if (r.error) { setGroceries((g) => g.map((x) => (x.id === t.id ? { ...x, status: t.status } : x))); setNotice({ text: `Couldn't update: ${r.error}`, ok: false }); }
  };
  const removeGrocery = async (t: TaskRec) => {
    setGroceries((g) => g.filter((x) => x.id !== t.id)); // optimistic
    const r = await api.deleteTask(t.id);
    if (r.error) { await load(); setNotice({ text: r.error === "insufficient_role" ? "Ask an adult to remove this item." : `Couldn't remove: ${r.error}`, ok: false }); }
  };

  const openCount = groceries.filter((g) => g.status !== "done").length;

  return (
    <Screen>
      <ScrollView contentContainerStyle={st.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Hearth.ember500} />}>
        <View style={st.headRow}>
          <View style={{ flex: 1 }}><H1>Meals</H1></View>
          {canManage && (
            <Pressable
              onPress={() => setComposerOpen((v) => !v)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={composerOpen ? "Close new meal form" : "Add a meal"}>
              <Ionicons name={composerOpen ? "close-circle-outline" : "add-circle-outline"} size={28} color={Hearth.ember500} />
            </Pressable>
          )}
        </View>
        <Muted style={{ marginTop: 4 }}>Plan the week and turn meals into a grocery list in one tap.</Muted>
        {!canManage && <Muted style={{ marginTop: 6, fontSize: 12 }}>You can see the plan; adding meals needs Limited Member or higher.</Muted>}

        {notice ? (
          <View style={[st.notice, { backgroundColor: notice.ok ? Hearth.sageBg : Hearth.coralBg, borderColor: notice.ok ? Hearth.sage500 : Hearth.coral500 }]}>
            <Body style={{ color: notice.ok ? Hearth.sage600 : Hearth.coral600, fontSize: 14 }}>{notice.text}</Body>
          </View>
        ) : null}

        {composerOpen && canManage && (
          <Card style={{ marginTop: 12, gap: 8 }}>
            <TextInput style={st.input} placeholder="Meal (e.g. Taco night)" placeholderTextColor={Hearth.ink400} value={title} onChangeText={setTitle} accessibilityLabel="Meal title" />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput style={[st.input, { flex: 1 }]} placeholder="YYYY-MM-DD" placeholderTextColor={Hearth.ink400} value={date} onChangeText={setDate} autoCapitalize="none" accessibilityLabel="Meal date" />
            </View>
            <View style={st.slotRow}>
              {SLOTS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setSlot(s)}
                  style={[st.slotChip, slot === s && st.slotChipActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Slot ${s}${slot === s ? ", selected" : ""}`}>
                  <Body style={{ fontSize: 13, fontWeight: "600", color: slot === s ? Hearth.white : Hearth.ink600 }}>{s}</Body>
                </Pressable>
              ))}
            </View>
            <TextInput style={st.input} placeholder="Ingredients, comma-separated" placeholderTextColor={Hearth.ink400} value={ingredients} onChangeText={setIngredients} accessibilityLabel="Ingredients" />
            <Button title="Add meal" variant="ember" loading={busy === "add"} disabled={!title.trim()} onPress={() => void add()} />
          </Card>
        )}

        {/* Grocery list first — it's the thing you check in the store aisle. */}
        <View style={{ marginTop: 16 }}>
          <Eyebrow>Groceries{openCount > 0 ? `  ·  ${openCount} open` : ""}</Eyebrow>
        </View>
        <Card style={{ marginTop: 8 }}>
          {groceries.length === 0 ? (
            <Muted>Empty. Add ingredients from a meal below.</Muted>
          ) : (
            groceries.map((t, i) => (
              <View key={t.id} style={[st.groceryRowWrap, i > 0 && st.divider]}>
                <Pressable
                  onPress={() => void toggleGrocery(t)}
                  style={st.groceryRow}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: t.status === "done" }}
                  accessibilityLabel={t.title}>
                  <Ionicons name={t.status === "done" ? "checkmark-circle" : "ellipse-outline"} size={20} color={t.status === "done" ? Hearth.sage500 : Hearth.ink400} />
                  <Body style={{ marginLeft: 10, flex: 1, color: t.status === "done" ? Hearth.ink400 : Hearth.ink800, textDecorationLine: t.status === "done" ? "line-through" : "none" }}>
                    {t.title}
                  </Body>
                </Pressable>
                <Pressable onPress={() => void removeGrocery(t)} hitSlop={8} style={st.groceryRemove} accessibilityRole="button" accessibilityLabel={`Remove ${t.title}`}>
                  <Ionicons name="close" size={16} color={Hearth.ink400} />
                </Pressable>
              </View>
            ))
          )}
        </Card>

        {/* Week plan */}
        {week.map((d) => {
          const k = dayKey(d);
          const dayMeals = (byDay[k] ?? []).slice().sort((a, b) => SLOTS.indexOf(a.slot as never) - SLOTS.indexOf(b.slot as never));
          const isToday = k === dayKey(new Date());
          return (
            <View key={k} style={{ marginTop: 16 }}>
              <Eyebrow>{d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}{isToday ? "  ·  Today" : ""}</Eyebrow>
              {dayMeals.length === 0 ? (
                <Card style={{ marginTop: 8 }}><Muted>No meals planned.</Muted></Card>
              ) : (
                dayMeals.map((m) => (
                  <Card key={m.id} style={{ marginTop: 8 }}>
                    <View style={st.between}>
                      <View style={{ flex: 1 }}>
                        <View style={st.row}>
                          <Body style={{ fontWeight: "600", flexShrink: 1 }}>{m.title}</Body>
                          <Badge label={m.slot} color={Hearth.ink500} bg={Hearth.surfaceSunken} />
                        </View>
                        {m.ingredients.length > 0 && (
                          <Muted style={{ fontSize: 12, marginTop: 2 }} >
                            {m.ingredients.map((i) => i.item).join(", ")}
                          </Muted>
                        )}
                      </View>
                    </View>
                    {canManage && (
                      <View style={st.btnRow}>
                        {m.ingredients.some((i) => !i.have) && (
                          <View style={{ flex: 1 }}>
                            <Button title="Send to groceries" variant="ghost" loading={busy === `g:${m.id}`} onPress={() => void toGrocery(m)} />
                          </View>
                        )}
                        {m.date && (
                          <View style={{ flex: 1 }}>
                            <Button title="Add to calendar" variant="ghost" loading={busy === `c:${m.id}`} onPress={() => void toCalendar(m)} />
                          </View>
                        )}
                        <Pressable
                          onPress={() => void removeMeal(m)}
                          style={st.trash}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${m.title}`}>
                          {busy === `d:${m.id}` ? <Ionicons name="hourglass-outline" size={18} color={Hearth.ink400} /> : <Ionicons name="trash-outline" size={18} color={Hearth.coral600} />}
                        </Pressable>
                      </View>
                    )}
                  </Card>
                ))
              )}
            </View>
          );
        })}

        {(byDay["unscheduled"]?.length ?? 0) > 0 && (
          <View style={{ marginTop: 16 }}>
            <Eyebrow>Unscheduled</Eyebrow>
            {byDay["unscheduled"].map((m) => (
              <Card key={m.id} style={{ marginTop: 8 }}>
                <View style={st.row}>
                  <Body style={{ fontWeight: "600", flexShrink: 1 }}>{m.title}</Body>
                  <Badge label={m.slot} color={Hearth.ink500} bg={Hearth.surfaceSunken} />
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const st = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  notice: { marginTop: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  input: {
    borderWidth: 1, borderColor: Hearth.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: Hearth.ink900, backgroundColor: Hearth.white,
  },
  slotRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  slotChip: { borderRadius: 999, borderWidth: 1, borderColor: Hearth.border, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Hearth.white },
  slotChipActive: { backgroundColor: Hearth.ink800, borderColor: Hearth.ink800 },
  groceryRowWrap: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  groceryRow: { flexDirection: "row", alignItems: "center", flex: 1, paddingVertical: 5 },
  groceryRemove: { padding: 8, marginLeft: 4 },
  divider: { borderTopWidth: 1, borderTopColor: Hearth.border },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  trash: { padding: 8 },
});
