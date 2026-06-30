import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { PageHeader, Card, Button, IconButton, Badge, Drawer, Modal, Field, TextInput, TextArea, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icon";
import type { Playbook } from "@/types";

export function Playbooks() {
  const data = useStore((s) => s.data);
  const params = useStore((s) => s.route.params);
  const duplicate = useStore((s) => s.duplicatePlaybook);
  const archive = useStore((s) => s.archivePlaybook);
  const del = useStore((s) => s.deletePlaybook);
  const runPlaybook = useStore((s) => s.runPlaybook);
  const [cat, setCat] = useState("All");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<Playbook | null>(null);
  const run = async (id: string) => { setRunningId(id); await runPlaybook(id); setRunningId(null); };

  useEffect(() => { if (params?.id) setSelected(params.id); }, [params?.id]);

  const cats = useMemo(() => ["All", ...Array.from(new Set(data.playbooks.map((p) => p.category)))], [data.playbooks]);
  const active = data.playbooks.filter((p) => !p.archived && (cat === "All" || p.category === cat));
  const archived = data.playbooks.filter((p) => p.archived);
  const sel = data.playbooks.find((p) => p.id === selected) ?? null;
  const agentNames = (p: Playbook) => data.agents.filter((a) => p.linkedAgentIds.includes(a.id)).map((a) => a.name);

  return (
    <div className="animate-fade-in">
      <PageHeader title="Playbooks" subtitle="Reusable, step-by-step instructions for recurring household workflows." icon="ScrollText"
        actions={<Button variant="ember" onClick={() => setCreating(true)}><Icon name="Plus" size={16} /> New playbook</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">{cats.map((c) => <button key={c} onClick={() => setCat(c)} className={`chip pressable transition-colors ${cat === c ? "bg-ink-800 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" : "border border-ink-900/10 bg-surface-raised text-ink-600 hover:bg-surface-overlay"}`}>{c}</button>)}</div>

      {active.length === 0 ? <EmptyState icon="ScrollText" title="No playbooks" message="Create a step-by-step playbook your agents can follow." /> : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {active.map((p, i) => (
            <Card key={p.id} className="card-pad flex flex-col" hover>
              <div style={{ ["--i" as string]: i }} className="flex flex-1 flex-col" onClick={() => setSelected(p.id)} role="button">
                <div className="mb-2 flex items-center justify-between"><Badge color="sky">{p.category}</Badge><span className="text-xs text-ink-400">{p.steps.length} steps</span></div>
                <p className="font-display text-lg font-semibold leading-snug text-ink-900">{p.name}</p>
                <p className="mt-1 line-clamp-2 text-xs text-ink-500">{p.description}</p>
                {agentNames(p).length > 0 && <p className="mt-2 text-xs text-ink-400">Used by {agentNames(p).join(", ")}</p>}
              </div>
              <div className="mt-3 flex items-center gap-1 border-t border-ink-900/[0.06] pt-3">
                <Button size="sm" variant="ember" disabled={runningId === p.id} onClick={() => run(p.id)}>{runningId === p.id ? <><Icon name="Loader2" size={13} className="animate-spin" /> Running</> : <><Icon name="Play" size={13} /> Run</>}</Button>
                <IconButton icon="Pencil" label="Edit" onClick={() => setEditing(p)} />
                <IconButton icon="Copy" label="Duplicate" onClick={() => duplicate(p.id)} />
                <IconButton icon="Archive" label="Archive" className="ml-auto" onClick={() => archive(p.id)} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div className="mt-8"><p className="section-title mb-2.5">Archived</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">{archived.map((p) => <div key={p.id} className="well flex items-center gap-3 px-4 py-3 opacity-80"><Icon name="ScrollText" size={16} className="text-ink-400" /><span className="flex-1 text-sm text-ink-700">{p.name}</span><Button size="sm" variant="ghost" onClick={() => archive(p.id)}>Unarchive</Button><IconButton icon="Trash2" label="Delete permanently" onClick={() => setConfirmDel(p)} /></div>)}</div>
        </div>
      )}

      {sel && <PlaybookDrawer playbook={sel} onClose={() => setSelected(null)} onEdit={() => { setEditing(sel); setSelected(null); }} onRun={() => run(sel.id)} running={runningId === sel.id} />}
      {(creating || editing) && <PlaybookModal item={editing} onClose={() => { setCreating(false); setEditing(null); }} />}

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Delete this playbook?" icon="Trash2"
        footer={<><Button variant="ghost" onClick={() => setConfirmDel(null)}>Cancel</Button><Button variant="danger" onClick={() => { if (confirmDel) del(confirmDel.id); setConfirmDel(null); }}><Icon name="Trash2" size={15} /> Delete permanently</Button></>}>
        <p className="text-sm text-ink-600">Permanently delete <strong>{confirmDel?.name}</strong>? This can't be undone.</p>
      </Modal>
    </div>
  );
}

function PlaybookDrawer({ playbook: p, onClose, onEdit, onRun, running }: { playbook: Playbook; onClose: () => void; onEdit: () => void; onRun: () => void; running: boolean }) {
  const data = useStore((s) => s.data);
  const navigate = useStore((s) => s.navigate);
  const agents = data.agents.filter((a) => p.linkedAgentIds.includes(a.id));
  const List = ({ title, items, icon }: { title: string; items: string[]; icon: string }) => items.length ? <div><p className="section-title mb-1.5 flex items-center gap-1.5"><Icon name={icon} size={12} />{title}</p><div className="flex flex-wrap gap-1.5">{items.map((i, k) => <span key={k} className="chip bg-surface-sunken text-ink-600">{i}</span>)}</div></div> : null;
  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={p.name} icon="ScrollText" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="ghost" onClick={onEdit}><Icon name="Pencil" size={15} /> Edit</Button><Button variant="primary" disabled={running} onClick={onRun}>{running ? <><Icon name="Loader2" size={15} className="animate-spin" /> Running…</> : <><Icon name="Play" size={15} /> Run playbook</>}</Button></>}>
      <div className="space-y-4">
        <Badge color="sky">{p.category}</Badge>
        <p className="text-sm text-ink-600">{p.description}</p>
        {p.whenToUse && <div className="well p-3.5"><p className="section-title">When to use</p><p className="mt-1 text-sm text-ink-700">{p.whenToUse}</p></div>}
        <div>
          <p className="section-title mb-2">Steps</p>
          <ol className="space-y-2">{[...p.steps].sort((a, b) => a.order - b.order).map((s) => <li key={s.order} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ink-700 to-ink-900 text-xs font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">{s.order}</span><span className="pt-0.5 text-sm text-ink-700">{s.text}</span></li>)}</ol>
        </div>
        <List title="Required connections" items={p.requiredConnections} icon="Plug" />
        <List title="Required file types" items={p.requiredFileTypes} icon="FileText" />
        {p.outputFormat && <div><p className="section-title mb-1">Output format</p><p className="text-sm text-ink-700">{p.outputFormat}</p></div>}
        <List title="Approval rules" items={p.approvalRules} icon="ShieldCheck" />
        {agents.length > 0 && <div><p className="section-title mb-1.5">Linked agents</p><div className="flex flex-wrap gap-2">{agents.map((a) => <button key={a.id} onClick={() => navigate("agents", { id: a.id })} className="chip pressable bg-surface-sunken text-ink-600 transition-colors hover:bg-surface-overlay"><Icon name={a.icon} size={12} /> {a.name}</button>)}</div></div>}
      </div>
    </Drawer>
  );
}

function PlaybookModal({ item, onClose }: { item: Playbook | null; onClose: () => void }) {
  const create = useStore((s) => s.createPlaybook);
  const update = useStore((s) => s.updatePlaybook);
  const generate = useStore((s) => s.generatePlaybookFromGoal);
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [whenToUse, setWhenToUse] = useState(item?.whenToUse ?? "");
  const [category, setCategory] = useState(item?.category ?? "Custom");
  const [outputFormat, setOutputFormat] = useState(item?.outputFormat ?? "");
  const [stepsText, setStepsText] = useState(item ? item.steps.map((s) => s.text).join("\n") : "");
  const [requiredConnections, setRequiredConnections] = useState((item?.requiredConnections ?? []).join(", "));
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const doGenerate = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    const r = await generate(prompt.trim());
    setBusy(false);
    if (r.ok && r.playbook) {
      const pb = r.playbook;
      if (!name.trim()) setName(pb.name);
      setDescription(pb.description);
      setWhenToUse(pb.whenToUse);
      setCategory(pb.category || "Custom");
      setOutputFormat(pb.outputFormat);
      setStepsText(pb.steps.join("\n"));
      setRequiredConnections(pb.requiredConnections.join(", "));
    }
  };
  const submit = () => {
    if (!name.trim()) return;
    const steps = stepsText.split("\n").map((t) => t.trim()).filter(Boolean).map((text, i) => ({ order: i + 1, text }));
    const reqConns = requiredConnections.split(",").map((s) => s.trim()).filter(Boolean);
    if (item) update(item.id, { name, description, whenToUse, category, outputFormat, steps, requiredConnections: reqConns });
    else create({ name, description, whenToUse, category, outputFormat, steps, requiredConnections: reqConns });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={item ? "Edit playbook" : "New playbook"} icon="ScrollText" size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim() || busy} onClick={submit}>Save</Button></>}>
      <div className="space-y-3">
        {!item && (
          <div className="rounded-2xl border border-lavender-200 bg-lavender-50 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <Field label="Generate with AI" hint="Describe the workflow; your AI provider drafts the steps and required connections.">
              <TextArea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-[60px]" placeholder="How we process a new medical bill: scan it, log the amount, flag anything over $200, and remind me to pay before the due date." />
            </Field>
            <Button size="sm" variant="ember" className="mt-2" disabled={!prompt.trim() || busy} onClick={doGenerate}>{busy ? <><Icon name="Loader2" size={14} className="animate-spin" /> Generating…</> : <><Icon name="Sparkles" size={14} /> Generate steps</>}</Button>
          </div>
        )}
        <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Category"><TextInput value={category} onChange={(e) => setCategory(e.target.value)} /></Field><Field label="Output format"><TextInput value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} /></Field></div>
        <Field label="Description"><TextArea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="When to use"><TextInput value={whenToUse} onChange={(e) => setWhenToUse(e.target.value)} /></Field>
        <Field label="Required connections (comma-separated)"><TextInput value={requiredConnections} onChange={(e) => setRequiredConnections(e.target.value)} placeholder="Gmail, Google Calendar, Local Files" /></Field>
        <Field label="Steps (one per line)"><TextArea value={stepsText} onChange={(e) => setStepsText(e.target.value)} className="min-h-[140px]" placeholder={"Read the source\nSummarize\nExtract dates\nCreate reminders"} /></Field>
      </div>
    </Modal>
  );
}
