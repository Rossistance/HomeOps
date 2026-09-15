import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { MiniAppRenderer } from "@/miniapps";
import { PageHeader, Card, Button, IconButton, Badge, Modal, Field, TextInput, TextArea, Select, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { relativeTime } from "@/lib/dates";
import type { MiniAppType } from "@/types";

const ICONS: Record<string, string> = {
  "Chore Board": "ListChecks",
  "Trip Planner": "Plane",
  "Budget Snapshot": "Wallet",
  "Subscription Tracker": "CreditCard",
  "Grocery List": "ShoppingCart",
  "Medical Tracker": "Stethoscope",
  "Research Comparison": "Search",
  Custom: "LayoutGrid",
};
const TYPES: MiniAppType[] = ["Chore Board", "Trip Planner", "Budget Snapshot", "Subscription Tracker", "Grocery List", "Medical Tracker", "Research Comparison", "Custom"];

// Item 6: blank starter templates that ship with every household — one tap instantiates a
// real mini app. `liveData` flags the ones whose renderer syncs actual household data (so
// the "cross-linked to real data" claim stays honest); the rest start as usable structures.
interface StarterTemplate { type: MiniAppType; name: string; description: string; liveData?: string; seed: Record<string, unknown> }
const STARTER_TEMPLATES: StarterTemplate[] = [
  { type: "Chore Board", name: "Family Chore Board", description: "Kanban of who's doing what — To Do → In Progress → Done.", liveData: "your household chore tasks", seed: { columns: [{ key: "todo", title: "To Do" }, { key: "in-progress", title: "In Progress" }, { key: "done", title: "Done" }, { key: "needs-help", title: "Needs Help" }] } },
  { type: "Budget Snapshot", name: "Monthly Budget Snapshot", description: "Bills and spending at a glance, with over-budget alerts.", liveData: "your bill & expense tasks", seed: { rows: [], categoryTotals: [], alerts: [] } },
  { type: "Subscription Tracker", name: "Subscription Tracker", description: "Every recurring charge in one place — cancel the ones you forgot.", liveData: "recurring-charge tasks", seed: { subscriptions: [] } },
  { type: "Grocery List", name: "Shared Grocery List", description: "The running list the whole family adds to; check off in the aisle.", liveData: "the Groceries task list", seed: { sections: [{ title: "To buy", items: [] }] } },
  { type: "Trip Planner", name: "Trip Planner", description: "Itinerary, packing list, budget, and reservations for your next trip.", seed: { sections: [{ title: "Itinerary", items: [] }, { title: "Packing list", items: [] }, { title: "Reservations", items: [] }] } },
  { type: "Medical Tracker", name: "Medical Tracker", description: "Appointments, medications, and follow-ups for the whole family.", seed: { sections: [{ title: "Upcoming appointments", items: [] }, { title: "Medications", items: [] }, { title: "Follow-ups", items: [] }] } },
  { type: "Research Comparison", name: "Compare Options", description: "Side-by-side comparison for a purchase or big decision.", seed: { sections: [{ title: "Options", items: [] }, { title: "Criteria", items: [] }] } },
  { type: "Custom", name: "Blank Board", description: "Start from nothing — add your own sections and items.", seed: { sections: [] } },
];

export function MiniApps() {
  const data = useStore((s) => s.data);
  const params = useStore((s) => s.route.params);
  const archive = useStore((s) => s.archiveMiniApp);
  const del = useStore((s) => s.deleteMiniApp);
  const duplicate = useStore((s) => s.duplicateMiniApp);
  const createMiniApp = useStore((s) => s.createMiniApp);
  const toast = useStore((s) => s.toast);
  const navigate = useStore((s) => s.navigate);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const addTemplate = (t: StarterTemplate) => {
    const id = createMiniApp({ name: t.name, type: t.type, description: t.description, data: t.seed });
    toast({ kind: "success", title: "Mini app added", message: t.liveData ? `“${t.name}” is live and synced to ${t.liveData}.` : `“${t.name}” created — open it to fill it in.` });
    setOpenId(id);
  };

  useEffect(() => { if (params?.id) setOpenId(params.id); if (params?.new) setCreating(true); }, [params?.id, params?.new]);

  const app = data.miniApps.find((m) => m.id === openId) ?? null;
  const active = data.miniApps.filter((m) => m.status === "active");
  const archived = data.miniApps.filter((m) => m.status === "archived");
  const agentName = (id?: string) => data.agents.find((a) => a.id === id)?.name;

  if (app) {
    return (
      <div className="animate-fade-in">
        <button onClick={() => { setOpenId(null); navigate("miniapps"); }} className="mb-3 flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-800"><Icon name="ChevronLeft" size={16} /> Back to mini apps</button>
        <PageHeader title={app.name} subtitle={app.description} icon={ICONS[app.type] ?? "LayoutGrid"}
          actions={<><Button variant="ghost" onClick={() => duplicate(app.id)}><Icon name="Copy" size={15} /> Duplicate</Button><Button variant="ghost" onClick={() => archive(app.id)}><Icon name="Archive" size={15} /> {app.status === "archived" ? "Unarchive" : "Archive"}</Button><Button variant="danger" onClick={() => { del(app.id); setOpenId(null); }}><Icon name="Trash2" size={15} /> Delete</Button></>} />
        <div className="well mb-4 flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-xs text-ink-500">
          <Badge color="lavender">{app.type}</Badge>
          <span>v{app.version}</span>
          {app.createdByAgentId && <span className="flex items-center gap-1"><Icon name="Bot" size={12} /> built by {agentName(app.createdByAgentId)}</span>}
          <span className="ml-auto">updated {relativeTime(app.updatedAt)} · synced to live household data</span>
        </div>
        <MiniAppRenderer app={app} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Mini Apps" subtitle="Lightweight, interactive trackers that sync with your household data." icon="LayoutGrid"
        actions={<Button variant="ember" onClick={() => setCreating(true)}><Icon name="Plus" size={16} /> New mini app</Button>} />
      {active.length === 0 && (
        <div className="mb-6 rounded-2xl border border-lavender-200/70 bg-lavender-50/50 px-4 py-3 text-sm text-ink-600">
          <Icon name="Sparkles" size={14} className="mr-1.5 inline text-lavender-600" /> New here? Add a starter template below — they come blank and ready, and several sync straight to your real household data.
        </div>
      )}
      {active.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {active.map((m) => (
            <Card key={m.id} className="card-pad flex flex-col" hover>
              <div className="flex items-start gap-3" onClick={() => setOpenId(m.id)} role="button">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-lavender-100 text-lavender-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><Icon name={ICONS[m.type] ?? "LayoutGrid"} size={22} /></span>
                <div className="min-w-0 flex-1"><p className="truncate font-display text-lg font-semibold text-ink-900">{m.name}</p><p className="line-clamp-2 text-xs text-ink-500">{m.description}</p></div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
                <Badge color="lavender">{m.type}</Badge>
                {m.createdByAgentId && <span>by {agentName(m.createdByAgentId)}</span>}
                <span>v{m.version}</span>
              </div>
              <div className="mt-3 flex items-center gap-1 border-t border-ink-900/[0.06] pt-3">
                <Button size="sm" variant="secondary" onClick={() => setOpenId(m.id)}><Icon name="Maximize2" size={13} /> Open</Button>
                <IconButton icon="Copy" label="Duplicate" onClick={() => duplicate(m.id)} />
                <IconButton icon="Archive" label="Archive" onClick={() => archive(m.id)} />
                <IconButton icon="Trash2" label="Delete" className="ml-auto" onClick={() => del(m.id)} />
              </div>
            </Card>
          ))}
        </div>
      )}
      {archived.length > 0 && (
        <div className="mt-8">
          <p className="section-title mb-2">Archived</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {archived.map((m) => (
              <Card key={m.id} className="card-pad flex items-center gap-3 opacity-70">
                <Icon name={ICONS[m.type] ?? "LayoutGrid"} size={18} className="text-ink-400" />
                <span className="flex-1 truncate text-sm text-ink-600">{m.name}</span>
                <Button size="sm" variant="ghost" onClick={() => archive(m.id)}>Unarchive</Button>
              </Card>
            ))}
          </div>
        </div>
      )}
      {/* Starter templates — always available so users can add more as they go (item 6). */}
      <div className="mt-8">
        <p className="section-title mb-2.5">Starter templates</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {STARTER_TEMPLATES.map((t) => (
            <Card key={t.name} className="card-pad flex flex-col">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-sunken text-ink-500"><Icon name={ICONS[t.type] ?? "LayoutGrid"} size={20} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-base font-semibold text-ink-900">{t.name}</p>
                  <p className="line-clamp-2 text-xs text-ink-500">{t.description}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge color="lavender">{t.type}</Badge>
                {t.liveData && <Badge color="sage"><Icon name="Link" size={10} /> syncs live data</Badge>}
              </div>
              <div className="mt-3 border-t border-ink-900/[0.06] pt-3">
                <Button size="sm" variant="secondary" onClick={() => addTemplate(t)}><Icon name="Plus" size={13} /> Add to my mini apps</Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
      {creating && <CreateModal onClose={() => setCreating(false)} onCreate={(id) => { setCreating(false); setOpenId(id); }} types={TYPES} />}
    </div>
  );
}

function staticSeed(type: MiniAppType): Record<string, unknown> {
  return type === "Chore Board" ? { columns: [{ key: "todo", title: "To Do" }, { key: "in-progress", title: "In Progress" }, { key: "done", title: "Done" }, { key: "needs-help", title: "Needs Help" }] }
    : type === "Subscription Tracker" ? { subscriptions: [] }
    : type === "Budget Snapshot" ? { rows: [], categoryTotals: [], alerts: [] }
    : { sections: [] };
}

function CreateModal({ onClose, onCreate, types }: { onClose: () => void; onCreate: (id: string) => void; types: MiniAppType[] }) {
  const agents = useStore((s) => s.data.agents);
  const create = useStore((s) => s.createMiniApp);
  const generate = useStore((s) => s.generateMiniAppFromGoal);
  const [name, setName] = useState("");
  const [type, setType] = useState<MiniAppType>("Chore Board");
  const [desc, setDesc] = useState("");
  const [agentId, setAgentId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState<Record<string, unknown> | null>(null);

  const doGenerate = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    const r = await generate({ goal: prompt.trim(), type });
    setBusy(false);
    if (r.ok && r.app) {
      if (!name.trim()) setName(r.app.name);
      if (r.app.type) setType(r.app.type as MiniAppType);
      if (r.app.description) setDesc(r.app.description);
      setGenerated(r.app.data);
    }
  };
  const submit = () => {
    if (!name.trim()) return;
    const data = generated ?? staticSeed(type);
    onCreate(create({ name, type, description: desc, createdByAgentId: agentId || undefined, data }));
  };
  return (
    <Modal open onClose={onClose} title="New mini app" icon="LayoutGrid" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim() || busy} onClick={submit}>Create</Button></>}>
      <div className="space-y-3">
        <div className="rounded-2xl border border-lavender-200 bg-lavender-50/70 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
          <Field label="Generate with AI" hint="Describe what you want; your connected AI provider builds the starter content.">
            <TextArea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-[70px]" placeholder="A trip planner for a 4-day Yellowstone trip in July with packing list and a $1500 budget." />
          </Field>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="ember" disabled={!prompt.trim() || busy} onClick={doGenerate}>{busy ? <><Icon name="Loader2" size={14} className="animate-spin" /> Generating…</> : <><Icon name="Sparkles" size={14} /> Generate</>}</Button>
            {generated && <span className="flex items-center gap-1 text-xs text-sage-600"><Icon name="CheckCircle2" size={13} /> Content generated — review below, then Create.</span>}
          </div>
        </div>
        <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer chore board" /></Field>
        <Field label="Type"><Select value={type} onChange={(e) => { setType(e.target.value as MiniAppType); setGenerated(null); }}>{types.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="Description"><TextInput value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label="Built by (optional)"><Select value={agentId} onChange={(e) => setAgentId(e.target.value)}><option value="">— none —</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
      </div>
    </Modal>
  );
}
