import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { PageHeader, Card, Button, Badge, Field, TextInput, Select } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { backend, type Meal, type ServerTask } from "@/connectors/api";

const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Family meal plan: a rolling week of meals, one-click "send to groceries", and the
 *  shared grocery list (reusing list-tasks). Meals are household-visible; writing needs
 *  Limited Member+. */
export function Meals() {
  const toast = useStore((s) => s.toast);
  const role = useStore((s) => s.session?.role);
  const canManage = ["Owner", "Adult Admin", "Adult Member", "Limited Member"].includes(role ?? "");
  const [meals, setMeals] = useState<Meal[]>([]);
  const [groceries, setGroceries] = useState<ServerTask[]>([]);
  const [busy, setBusy] = useState(false);
  // Composer
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(dayKey(new Date()));
  const [slot, setSlot] = useState<(typeof SLOTS)[number]>("dinner");
  const [time, setTime] = useState(""); // optional HH:MM; slot default applies when empty
  const [ingredients, setIngredients] = useState("");
  const [servings, setServings] = useState("");
  const [recipeUrl, setRecipeUrl] = useState("");

  const load = async () => {
    const [m, tasks] = await Promise.all([backend.meals(), backend.tasks()]);
    setMeals(m);
    setGroceries(tasks.filter((t) => t.type === "list" && (t.listName ?? "Groceries") === "Groceries"));
  };
  useEffect(() => { void load(); }, []);

  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; }), []);
  const byDay = useMemo(() => {
    const map: Record<string, Meal[]> = {};
    for (const m of meals) { const k = m.date ?? "unscheduled"; (map[k] ??= []).push(m); }
    return map;
  }, [meals]);

  const add = async () => {
    if (!title.trim()) return; setBusy(true);
    const ing = ingredients.split(",").map((s) => s.trim()).filter(Boolean);
    const n = parseInt(servings, 10);
    const r = await backend.createMeal({ title: title.trim(), date, slot, time: time || null, ingredients: ing, servings: Number.isFinite(n) && n > 0 ? n : null, recipeUrl: recipeUrl.trim() });
    setBusy(false);
    if (r.meal) { setTitle(""); setIngredients(""); setServings(""); setRecipeUrl(""); setTime(""); await load(); toast({ kind: "success", title: "Meal added" }); }
    else toast({ kind: "error", title: "Couldn't add meal", message: r.error === "insufficient_role" ? "Adults only." : r.error });
  };
  const toGrocery = async (m: Meal) => { setBusy(true); const r = await backend.mealToGrocery(m.id); setBusy(false); if (r.ok) { await load(); toast({ kind: "success", title: "Added to groceries", message: `${r.added ?? 0} item${r.added === 1 ? "" : "s"}` }); } };
  const toCalendar = async (m: Meal) => {
    setBusy(true); const r = await backend.mealToCalendar(m.id); setBusy(false);
    if (r.ok && r.event) toast({ kind: "success", title: r.action === "updated" ? "Calendar event updated" : "Added to calendar", message: `“${r.event.title}” — push it to Google from the Calendar screen if you want it there too.` });
    else toast({ kind: "error", title: "Couldn't add to calendar", message: r.error === "date_required" ? "Give the meal a date first." : (r.message ?? r.error) });
  };
  const removeMeal = async (m: Meal) => {
    setBusy(true); const r = await backend.deleteMeal(m.id); setBusy(false); await load();
    const n = r.unlinkedGroceries ?? 0;
    toast({ kind: "info", title: "Meal removed", message: n > 0 ? `${n} grocery item${n === 1 ? "" : "s"} from this meal stayed on your list, just unlinked.` : undefined });
  };
  const toggleGrocery = async (t: ServerTask) => { const next = t.status === "done" ? "todo" : "done"; setGroceries((g) => g.map((x) => x.id === t.id ? { ...x, status: next } : x)); await backend.updateTaskRemote(t.id, { status: next }); };
  const removeGrocery = async (t: ServerTask) => {
    setGroceries((g) => g.filter((x) => x.id !== t.id)); // optimistic
    const r = await backend.deleteTaskRemote(t.id);
    if (!r.ok) { await load(); toast({ kind: "error", title: "Couldn't remove", message: r.error === "insufficient_role" ? "Ask an adult to remove this item." : r.error }); }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Meals" subtitle="Plan the week's meals and turn them into a grocery list in one tap." icon="UtensilsCrossed" />

      {canManage && (
        <Card className="card-pad mb-5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
            <Field label="Meal" className="sm:col-span-2"><TextInput value={title} placeholder="Taco night" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} /></Field>
            <Field label="Day"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Slot"><Select value={slot} onChange={(e) => setSlot(e.target.value as (typeof SLOTS)[number])}>{SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
            <Field label="Ingredients (comma-separated)" className="sm:col-span-4"><TextInput value={ingredients} placeholder="tortillas, cheese, salsa, ground beef" onChange={(e) => setIngredients(e.target.value)} /></Field>
            <Field label="Time" hint="Optional — slot default applies"><TextInput type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
            <Field label="Servings"><TextInput type="number" min={1} value={servings} placeholder="4" onChange={(e) => setServings(e.target.value)} /></Field>
            <Field label="Recipe link" className="sm:col-span-2"><TextInput type="url" value={recipeUrl} placeholder="https://…" onChange={(e) => setRecipeUrl(e.target.value)} /></Field>
          </div>
          <div className="mt-3"><Button variant="ember" disabled={busy || !title.trim()} onClick={add}><Icon name="Plus" size={15} /> Add meal</Button></div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_20rem]">
        {/* Week plan */}
        <div className="space-y-3">
          {week.map((d) => {
            const k = dayKey(d);
            const dayMeals = (byDay[k] ?? []).slice().sort((a, b) => SLOTS.indexOf(a.slot as never) - SLOTS.indexOf(b.slot as never));
            const isToday = k === dayKey(new Date());
            return (
              <Card key={k} className="card-pad">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-display text-sm font-semibold text-ink-900">{d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}{isToday && <span className="ml-2 text-xs font-normal text-ember-600">Today</span>}</p>
                </div>
                {dayMeals.length === 0 ? (
                  <p className="text-sm text-ink-400">No meals planned.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {dayMeals.map((m) => <MealRow key={m.id} meal={m} canManage={canManage} busy={busy} onGrocery={() => toGrocery(m)} onCalendar={() => toCalendar(m)} onRemove={() => removeMeal(m)} />)}
                  </ul>
                )}
              </Card>
            );
          })}
          {(byDay["unscheduled"]?.length ?? 0) > 0 && (
            <Card className="card-pad">
              <p className="mb-2 font-display text-sm font-semibold text-ink-900">Unscheduled</p>
              <ul className="space-y-1.5">{byDay["unscheduled"].map((m) => <MealRow key={m.id} meal={m} canManage={canManage} busy={busy} onGrocery={() => toGrocery(m)} onCalendar={() => toCalendar(m)} onRemove={() => removeMeal(m)} />)}</ul>
            </Card>
          )}
        </div>

        {/* Grocery list */}
        <Card className="card-pad h-fit">
          <div className="mb-2 flex items-center gap-2"><Icon name="ShoppingCart" size={16} className="text-ink-500" /><p className="font-display text-sm font-semibold text-ink-900">Groceries</p><Badge color="gray">{groceries.filter((g) => g.status !== "done").length}</Badge></div>
          {groceries.length === 0 ? (
            <p className="text-sm text-ink-400">Empty. Add ingredients from a meal.</p>
          ) : (
            <ul className="space-y-1">
              {groceries.map((t) => (
                <li key={t.id} className="group flex items-center">
                  <button onClick={() => toggleGrocery(t)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-sm hover:bg-surface-sunken/60" aria-label={`Toggle ${t.title}`}>
                    <Icon name={t.status === "done" ? "CheckCircle2" : "Circle"} size={15} className={`shrink-0 ${t.status === "done" ? "text-sage-500" : "text-ink-300"}`} />
                    <span className={`truncate ${t.status === "done" ? "text-ink-400 line-through" : "text-ink-700"}`}>{t.title}</span>
                  </button>
                  <button onClick={() => removeGrocery(t)} aria-label={`Remove ${t.title}`} className="shrink-0 rounded-lg p-1.5 text-ink-300 opacity-0 transition-opacity hover:bg-coral-50 hover:text-coral-600 group-hover:opacity-100 focus-visible:opacity-100">
                    <Icon name="X" size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function MealRow({ meal, canManage, busy, onGrocery, onCalendar, onRemove }: { meal: Meal; canManage: boolean; busy: boolean; onGrocery: () => void; onCalendar: () => void; onRemove: () => void }) {
  return (
    <li className="flex items-start gap-2.5 rounded-xl border border-ink-900/[0.05] bg-surface-sunken/50 px-3 py-2">
      <Icon name="UtensilsCrossed" size={14} className="mt-0.5 shrink-0 text-ink-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-800">
          {meal.title} <Badge color="gray">{meal.slot}{meal.time ? ` · ${meal.time}` : ""}</Badge>
          {meal.servings ? <Badge color="sage" className="ml-1"><Icon name="Users" size={10} /> {meal.servings}</Badge> : null}
        </p>
        {meal.ingredients.length > 0 && <p className="mt-0.5 truncate text-xs text-ink-500">{meal.ingredients.map((i) => i.item).join(", ")}</p>}
        {meal.recipeUrl ? <a href={meal.recipeUrl} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline"><Icon name="ExternalLink" size={11} /> Recipe</a> : null}
        {canManage && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {meal.ingredients.some((i) => !i.have) && <Button size="sm" variant="secondary" disabled={busy} onClick={onGrocery}><Icon name="ShoppingCart" size={12} /> Send to groceries</Button>}
            {meal.date && <Button size="sm" variant="secondary" disabled={busy} onClick={onCalendar}><Icon name="CalendarPlus" size={12} /> Add to calendar</Button>}
            <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}><Icon name="Trash2" size={12} /></Button>
          </div>
        )}
      </div>
    </li>
  );
}
