import { useState } from "react";
import type { MiniApp, Task, TaskStatus } from "@/types";
import { useStore } from "@/store/useStore";
import { Button, Card, Badge, Avatar, Checkbox, EmptyState, TextInput, Select, ACCENT_SOLID } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { fmtDate, relativeTime } from "@/lib/dates";
import { cn } from "@/lib/cn";

export function MiniAppRenderer({ app }: { app: MiniApp }) {
  switch (app.type) {
    case "Chore Board":
      return <ChoreBoard app={app} />;
    case "Trip Planner":
      return <TripPlanner app={app} />;
    case "Budget Snapshot":
      return <BudgetSnapshot app={app} />;
    case "Subscription Tracker":
      return <SubscriptionReview app={app} />;
    default:
      return <GenericApp app={app} />;
  }
}

/* ------------------------------ Chore Board ----------------------------- */

const CHORE_COLS: { key: TaskStatus; title: string; accent: string }[] = [
  { key: "todo", title: "To Do", accent: "sky" },
  { key: "in-progress", title: "In Progress", accent: "amber" },
  { key: "done", title: "Done", accent: "sage" },
  { key: "needs-help", title: "Needs Help", accent: "coral" },
];

// WP-004 (ISS-008, FEAT-019/005): the Chore Board is the household's general task
// surface, not just chores — a task an agent run creates (homeops.create_task
// defaults to type:"task") must be reachable here too, or it has no home anywhere.
// Bills keep their own Budget Snapshot view and list items (type:"list") keep their
// own grocery/packing views, so both are excluded here to avoid duplicate homes.
export const BOARD_TASK_TYPES = new Set(["chore", "task", "reminder", "errand"]);

function ChoreBoard({ app }: { app: MiniApp }) {
  const tasks = useStore((s) => s.data.tasks).filter((t) => BOARD_TASK_TYPES.has(t.type));
  const members = useStore((s) => s.data.members);
  const setTaskStatus = useStore((s) => s.setTaskStatus);
  const createTask = useStore((s) => s.createTask);
  const [adding, setAdding] = useState("");

  const memberOf = (id?: string) => members.find((m) => m.id === id);
  const add = () => {
    if (!adding.trim()) return;
    createTask({ title: adding.trim(), type: "chore", status: "todo", spaceId: app.spaceId, source: "user", priority: "medium" });
    setAdding("");
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <TextInput placeholder="Add a chore…" value={adding} onChange={(e) => setAdding(e.target.value)} className="sm:max-w-xs" onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button variant="primary" size="sm" disabled={!adding.trim()} onClick={add}>
          <Icon name="Plus" size={15} /> Add chore
        </Button>
        <span className="text-xs text-ink-400 sm:ml-auto">Moving a card syncs to the household task list.</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {CHORE_COLS.map((col) => {
          const items = tasks.filter((t) => t.status === col.key);
          return (
            <div key={col.key} className="well p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-ink-700">
                  <span className={cn("h-2 w-2 rounded-full", ACCENT_SOLID[col.accent])} />
                  {col.title}
                </span>
                <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-ink-500">{items.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {items.map((t) => (
                  <ChoreCard key={t.id} task={t} member={memberOf(t.assignedMemberId)} onMove={(s) => setTaskStatus(t.id, s)} />
                ))}
                {items.length === 0 && <p className="px-1 py-3 text-center text-xs text-ink-400">Nothing here</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChoreCard({ task, member, onMove }: { task: Task; member?: { initials: string; avatarColor: string; displayName: string }; onMove: (s: TaskStatus) => void }) {
  return (
    <div className="card rounded-2xl px-3 py-2.5">
      <p className="text-sm font-medium text-ink-800">{task.title}</p>
      {task.dueAt && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-400">
          <Icon name="Clock" size={11} /> Due {relativeTime(task.dueAt)}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between">
        {member ? (
          <span className="flex items-center gap-1.5 text-xs text-ink-500">
            <Avatar initials={member.initials} color={member.avatarColor} size={20} /> {member.displayName.split(" ")[0]}
          </span>
        ) : (
          <span className="text-xs text-ink-400">Unassigned</span>
        )}
        <Select value={task.status} onChange={(e) => onMove(e.target.value as TaskStatus)} className="!w-auto !py-1 text-xs">
          {CHORE_COLS.map((c) => (
            <option key={c.key} value={c.key}>{c.title}</option>
          ))}
        </Select>
      </div>
    </div>
  );
}

/* ------------------------------ Trip Planner ---------------------------- */

interface TripData {
  destination?: string;
  dates?: string;
  itinerary?: { day: string; items: string[] }[];
  packing?: { id: string; text: string; done: boolean }[];
  documents?: string[];
  reservations?: { name: string; detail: string }[];
  budget?: { label: string; amount: number }[];
  todos?: { id: string; text: string; done: boolean }[];
}

function TripPlanner({ app }: { app: MiniApp }) {
  const updateMiniAppData = useStore((s) => s.updateMiniAppData);
  const d = app.data as TripData;
  const save = (patch: Partial<TripData>) => updateMiniAppData(app.id, { ...d, ...patch });
  const [newBudget, setNewBudget] = useState({ label: "", amount: "" });

  const toggle = (key: "packing" | "todos", id: string) => {
    const list = (d[key] ?? []).map((i) => (i.id === id ? { ...i, done: !i.done } : i));
    save({ [key]: list } as Partial<TripData>);
  };
  const budgetTotal = (d.budget ?? []).reduce((a, b) => a + b.amount, 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="card-pad">
        <h4 className="font-display mb-1 text-lg font-semibold text-ink-900">{d.destination ?? "Trip"}</h4>
        <p className="mb-3 text-xs text-ink-400">{d.dates}</p>
        <p className="section-title mb-2">Itinerary</p>
        <div className="space-y-2">
          {(d.itinerary ?? []).map((day) => (
            <div key={day.day}>
              <p className="text-sm font-semibold text-ink-800">{day.day}</p>
              <ul className="ml-4 list-disc text-sm text-ink-600">{day.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
            </div>
          ))}
        </div>
      </Card>

      <Card className="card-pad">
        <p className="section-title mb-2">Packing</p>
        <div className="space-y-1.5">
          {(d.packing ?? []).map((p) => (
            <Checkbox key={p.id} checked={p.done} onChange={() => toggle("packing", p.id)} label={<span className={p.done ? "text-ink-400 line-through" : ""}>{p.text}</span>} />
          ))}
        </div>
        <p className="section-title mb-2 mt-4">To-do</p>
        <div className="space-y-1.5">
          {(d.todos ?? []).map((p) => (
            <Checkbox key={p.id} checked={p.done} onChange={() => toggle("todos", p.id)} label={<span className={p.done ? "text-ink-400 line-through" : ""}>{p.text}</span>} />
          ))}
        </div>
      </Card>

      <Card className="card-pad">
        <p className="section-title mb-2">Reservations & Documents</p>
        <div className="space-y-2">
          {(d.reservations ?? []).map((r, i) => (
            <div key={i} className="well px-3 py-2">
              <p className="text-sm font-medium text-ink-800">{r.name}</p>
              <p className="text-xs text-ink-500">{r.detail}</p>
            </div>
          ))}
          {(d.documents ?? []).map((doc, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-ink-600"><Icon name="FileText" size={14} /> {doc}</div>
          ))}
        </div>
      </Card>

      <Card className="card-pad">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Budget</p>
          <span className="text-sm font-bold text-ink-800">${budgetTotal.toFixed(0)}</span>
        </div>
        <div className="space-y-1.5">
          {(d.budget ?? []).map((b, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-ink-700">{b.label}</span>
              <span className="flex items-center gap-2">
                <span className="text-ink-600">${b.amount}</span>
                <button className="text-ink-300 hover:text-coral-500" onClick={() => save({ budget: (d.budget ?? []).filter((_, j) => j !== i) })}><Icon name="X" size={13} /></button>
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <TextInput placeholder="Item" value={newBudget.label} onChange={(e) => setNewBudget({ ...newBudget, label: e.target.value })} className="!py-1.5 text-sm" />
          <TextInput placeholder="$" type="number" value={newBudget.amount} onChange={(e) => setNewBudget({ ...newBudget, amount: e.target.value })} className="!w-20 !py-1.5 text-sm" />
          <Button size="sm" variant="secondary" disabled={!newBudget.label || !newBudget.amount} onClick={() => { save({ budget: [...(d.budget ?? []), { label: newBudget.label, amount: Number(newBudget.amount) }] }); setNewBudget({ label: "", amount: "" }); }}>Add</Button>
        </div>
      </Card>
    </div>
  );
}

/* ---------------------------- Budget Snapshot --------------------------- */

interface BudgetData {
  rows?: { id: string; label: string; amount: number | string; date: string; source: string }[];
  categoryTotals?: { label: string; amount: number }[];
  alerts?: string[];
}

function BudgetSnapshot({ app }: { app: MiniApp }) {
  const tasks = useStore((s) => s.data.tasks);
  const subs = useStore((s) => s.data.miniApps).find((m) => m.type === "Subscription Tracker");
  const setTaskStatus = useStore((s) => s.setTaskStatus);
  const updateMiniAppData = useStore((s) => s.updateMiniAppData);
  const d = app.data as BudgetData;
  const bills = tasks.filter((t) => t.type === "bill");
  const maxCat = Math.max(1, ...(d.categoryTotals ?? []).map((c) => c.amount));
  const [row, setRow] = useState({ label: "", amount: "" });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="card-pad">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Bills due</p>
        <div className="space-y-2">
          {bills.map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-xl border border-ink-900/[0.06] px-3 py-2">
              <div>
                <p className="text-sm font-medium text-ink-800">{b.title}</p>
                <p className="text-xs text-ink-400">{b.dueAt ? `Due ${relativeTime(b.dueAt)}` : ""}{b.amount ? ` · $${b.amount}` : ""}</p>
              </div>
              {b.status === "done" ? <Badge color="sage">Paid</Badge> : <Button size="sm" variant="secondary" onClick={() => setTaskStatus(b.id, "done")}>Mark paid</Button>}
            </div>
          ))}
          {bills.length === 0 && <p className="text-sm text-ink-400">No bills tracked.</p>}
        </div>
      </Card>

      <Card className="card-pad">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500">Category totals</p>
        <div className="space-y-2">
          {(d.categoryTotals ?? []).map((c) => (
            <div key={c.label}>
              <div className="mb-0.5 flex justify-between text-xs text-ink-600"><span>{c.label}</span><span>${c.amount}</span></div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken"><div className="h-full rounded-full bg-amber-500" style={{ width: `${(c.amount / maxCat) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="card-pad">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Recent receipts</p>
        <div className="space-y-1.5">
          {(d.rows ?? []).map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm">
              <span className="text-ink-700">{r.label} <span className="text-xs text-ink-400">· {fmtDate(r.date)} · {r.source}</span></span>
              <span className="flex items-center gap-2 text-ink-600">${r.amount}
                <button className="text-ink-300 hover:text-coral-500" onClick={() => updateMiniAppData(app.id, { ...d, rows: (d.rows ?? []).filter((x) => x.id !== r.id) })}><Icon name="X" size={13} /></button>
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <TextInput placeholder="Vendor" value={row.label} onChange={(e) => setRow({ ...row, label: e.target.value })} className="!py-1.5 text-sm" />
          <TextInput placeholder="$" type="number" value={row.amount} onChange={(e) => setRow({ ...row, amount: e.target.value })} className="!w-20 !py-1.5 text-sm" />
          <Button size="sm" variant="secondary" disabled={!row.label} onClick={() => { updateMiniAppData(app.id, { ...d, rows: [{ id: `r${Date.now()}`, label: row.label, amount: Number(row.amount) || 0, date: new Date().toISOString(), source: "Manual" }, ...(d.rows ?? [])] }); setRow({ label: "", amount: "" }); }}>Add</Button>
        </div>
      </Card>

      <Card className="card-pad">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Alerts</p>
        <div className="space-y-2">
          {(d.alerts ?? []).map((a, i) => (
            <div key={i} className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-600"><Icon name="TriangleAlert" size={15} className="mt-0.5 shrink-0" />{a}</div>
          ))}
          {subs && <div className="flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-600"><Icon name="CreditCard" size={15} className="mt-0.5 shrink-0" />{((subs.data as { subscriptions?: unknown[] }).subscriptions?.length ?? 0)} subscriptions tracked</div>}
        </div>
      </Card>
    </div>
  );
}

/* -------------------------- Subscription Review ------------------------- */

interface SubData {
  subscriptions?: { id: string; name: string; monthly: number; lastCharge: string; usage: string; recommendation: string }[];
}

function SubscriptionReview({ app }: { app: MiniApp }) {
  const d = app.data as SubData;
  const subs = d.subscriptions ?? [];
  const requestApproval = useStore((s) => s.requestApproval);
  const monthly = subs.reduce((a, b) => a + b.monthly, 0);
  const cancelable = subs.filter((s) => /cancel/i.test(s.recommendation));
  const savings = cancelable.reduce((a, b) => a + b.monthly * 12, 0);

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card className="card-pad"><p className="text-xs text-ink-400">Monthly total</p><p className="font-display text-2xl font-semibold text-ink-900">${monthly.toFixed(2)}</p></Card>
        <Card className="card-pad"><p className="text-xs text-ink-400">Subscriptions</p><p className="font-display text-2xl font-semibold text-ink-900">{subs.length}</p></Card>
        <Card className="card-pad"><p className="text-xs text-ink-400">Potential savings/yr</p><p className="font-display text-2xl font-semibold text-sage-600">${savings.toFixed(0)}</p></Card>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-ink-900/[0.06] text-left text-xs uppercase tracking-wide text-ink-400">
            <th className="px-4 py-2.5">Subscription</th><th className="px-4 py-2.5">Monthly</th><th className="px-4 py-2.5">Last charge</th><th className="px-4 py-2.5">Usage</th><th className="px-4 py-2.5">Recommendation</th><th className="px-4 py-2.5"></th>
          </tr></thead>
          <tbody>
            {subs.map((s) => {
              const cancel = /cancel/i.test(s.recommendation);
              return (
                <tr key={s.id} className="border-b border-ink-900/[0.06]">
                  <td className="px-4 py-2.5 font-medium text-ink-800">{s.name}</td>
                  <td className="px-4 py-2.5 text-ink-600">${s.monthly}</td>
                  <td className="px-4 py-2.5 text-ink-500">{relativeTime(s.lastCharge)}</td>
                  <td className="px-4 py-2.5 text-ink-500">{s.usage}</td>
                  <td className="px-4 py-2.5"><Badge color={cancel ? "coral" : s.recommendation.includes("Consider") ? "amber" : "sage"}>{s.recommendation}</Badge></td>
                  <td className="px-4 py-2.5">{cancel && <Button size="sm" variant="secondary" onClick={() => requestApproval({ title: `Cancel ${s.name}`, proposedAction: `Cancel subscription ${s.name}`, riskLevel: "High", category: "Subscription", agentId: app.createdByAgentId, spaceId: app.spaceId, previewContent: `Estimated annual savings: $${(s.monthly * 12).toFixed(2)}. Cancellation runs as a browser workflow that requires your approval and a connected runtime.` })}>Request cancel</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* -------------------------------- Generic ------------------------------- */

interface Section { title?: string; items?: unknown[] }

function GenericApp({ app }: { app: MiniApp }) {
  const data = (app.data ?? {}) as Record<string, unknown>;
  const keys = Object.keys(data);
  if (!keys.length) return <EmptyState icon="LayoutGrid" title={app.name} message="This mini app has no data yet." />;

  // Preferred shape produced by AI generation: { sections: [{ title, items: [...] }] }
  const sections = Array.isArray(data.sections) ? (data.sections as Section[]) : null;
  if (sections) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {sections.map((s, i) => (
          <Card key={i} className="card-pad">
            {s.title && <p className="font-display mb-2.5 text-base font-semibold text-ink-900">{s.title}</p>}
            <ItemList items={s.items ?? []} />
          </Card>
        ))}
      </div>
    );
  }

  // Otherwise render each top-level key as its own section (lists, tables, key/values).
  return (
    <div className="space-y-4">
      {keys.map((k) => (
        <Card key={k} className="card-pad">
          <p className="section-title mb-3">{humanize(k)}</p>
          <ValueView value={data[k]} />
        </Card>
      ))}
    </div>
  );
}

function ItemList({ items }: { items: unknown[] }) {
  if (!items.length) return <p className="text-sm text-ink-400">Nothing here yet.</p>;
  return (
    <ul className="space-y-1">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2.5 rounded-2xl px-2 py-1.5 text-sm text-ink-700 transition-colors hover:bg-surface-overlay"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-300" />{typeof it === "object" && it ? <span>{Object.values(it as Record<string, unknown>).map(String).join(" · ")}</span> : <span>{String(it)}</span>}</li>
      ))}
    </ul>
  );
}

function ValueView({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    const objs = value.filter((v) => v && typeof v === "object") as Record<string, unknown>[];
    if (objs.length === value.length && value.length > 0) {
      const cols = Array.from(new Set(objs.flatMap((o) => Object.keys(o)))).slice(0, 6);
      return (
        <div className="well overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-ink-900/[0.06] bg-surface-sunken/60 text-left text-xs uppercase tracking-wide text-ink-500">{cols.map((c) => <th key={c} className="px-3 py-2.5 font-semibold">{humanize(c)}</th>)}</tr></thead>
            <tbody>{objs.map((o, i) => <tr key={i} className="border-b border-ink-900/[0.06] last:border-0 transition-colors hover:bg-surface-overlay">{cols.map((c) => <td key={c} className="px-3 py-2.5 text-ink-700">{o[c] !== undefined && o[c] !== null ? String(o[c]) : "—"}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    return <ItemList items={value} />;
  }
  if (value && typeof value === "object") {
    return <div className="space-y-1.5">{Object.entries(value as Record<string, unknown>).map(([k, v]) => <div key={k} className="well flex justify-between gap-3 px-3 py-2 text-sm"><span className="text-ink-500">{humanize(k)}</span><span className="font-medium text-ink-800">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span></div>)}</div>;
  }
  return <p className="text-sm text-ink-700">{String(value)}</p>;
}

function humanize(k: string): string {
  return k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
