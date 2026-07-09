import { useCallback, useEffect, useState } from "react";
import { backend, type ServerSkill, type SkillStep, type SkillVersion, type InferFunctionsResult } from "@/connectors/api";
import {
  PageHeader, Card, Button, IconButton, Badge, Tabs, Modal, Drawer,
  Field, TextInput, TextArea, Select, Toggle, EmptyState,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/dates";
import { useStore } from "@/store/useStore";
import type { Playbook } from "@/types";

/* ---- Status display ---- */
const STATUS_COLOR: Record<string, "sage" | "amber" | "sky" | "coral" | "lavender"> = {
  available: "sage",
  draft: "amber",
  needs_function: "coral",
  deprecated: "lavender",
};
const MODE_LABEL: Record<string, string> = {
  deterministic: "Deterministic",
  "planner-assisted": "Planner-assisted",
  hybrid: "Hybrid",
};
const DOMAINS = ["General", "Family", "School", "Bills", "Medical", "Travel", "Home Maintenance", "Caregiving", "Pets", "Custom"];
const RISK_LEVELS = ["Low", "Medium", "High", "Sensitive"];
const MODES: ServerSkill["mode"][] = ["deterministic", "planner-assisted", "hybrid"];

function SkillStatusBadge({ status }: { status: string }) {
  return <Badge color={STATUS_COLOR[status] ?? "sky"}>{status}</Badge>;
}

/* ============================================================
   SKILL LIST PANEL
   ============================================================ */
function SkillList({
  skills, selId, onSelect, onNew, loading,
}: {
  skills: ServerSkill[]; selId: string | null;
  onSelect: (id: string) => void; onNew: () => void; loading: boolean;
}) {
  const [filter, setFilter] = useState<string>("all");
  const filtered = filter === "all" ? skills : skills.filter((s) => s.status === filter);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-ink-700">Skills</h2>
        <Button size="sm" variant="ember" onClick={onNew}><Icon name="Plus" size={13} /> New</Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {["all", "available", "draft", "needs_function"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("chip transition-colors pressable text-xs",
              filter === f ? "bg-gradient-to-b from-ink-700 to-ink-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                : "border border-ink-900/10 bg-surface-raised text-ink-600 hover:border-ink-900/20 hover:bg-surface-overlay"
            )}>
            {f === "all" ? "All" : f === "needs_function" ? "Needs function" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {loading && <div className="flex items-center gap-2 text-sm text-ink-400"><Icon name="Loader2" size={14} className="animate-spin" /> Loading…</div>}
      {!loading && !filtered.length && (
        <EmptyState icon="Layers" title="No skills" message={filter === "all" ? "Create your first skill to automate a household routine." : `No ${filter} skills yet.`} />
      )}
      <div className="space-y-2">
        {filtered.map((s) => (
          <Card key={s.id} className={cn("card-pad cursor-pointer", selId === s.id && "ring-2 ring-ember-400")} hover onClick={() => onSelect(s.id)}>
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-semibold text-ink-800">{s.name}</p>
              <SkillStatusBadge status={s.status} />
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs text-ink-400">{s.description || "No description."}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
              <span className="flex items-center gap-1"><Icon name="Layers" size={11} /> {s.steps.length} step{s.steps.length !== 1 ? "s" : ""}</span>
              <span className="flex items-center gap-1"><Icon name="Tag" size={11} /> {s.domain}</span>
              <span className="flex items-center gap-1"><Icon name="Cpu" size={11} /> {MODE_LABEL[s.mode] ?? s.mode}</span>
              {s.system && <span className="flex items-center gap-1 text-sky-600"><Icon name="Shield" size={11} /> System</span>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   STEP EDITOR ROW
   ============================================================ */
function StepRow({
  step, index, total,
  onChange, onRemove, onMoveUp, onMoveDown,
}: {
  step: SkillStep; index: number; total: number;
  onChange: (patch: Partial<SkillStep>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [inputJson, setInputJson] = useState(() => JSON.stringify(step.input_mapping ?? {}, null, 2));
  const [jsonErr, setJsonErr] = useState("");

  const applyJson = () => {
    try { onChange({ input_mapping: JSON.parse(inputJson) }); setJsonErr(""); }
    catch { setJsonErr("Invalid JSON"); }
  };

  return (
    <div className="rounded-2xl border border-ink-900/[0.08] bg-surface-rim shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-800 text-[10px] font-bold text-white">{index + 1}</span>
        <div className="flex-1 min-w-0">
          <input value={step.name} onChange={(e) => onChange({ name: e.target.value })}
            className="w-full bg-transparent text-sm font-medium text-ink-800 outline-none placeholder:text-ink-300"
            placeholder="Step name" />
          {!expanded && <p className="truncate text-xs text-ink-400">{step.tool_id ?? "No tool"}</p>}
        </div>
        <div className="flex items-center gap-0.5">
          {step.approval_required && <Icon name="ShieldAlert" size={13} className="text-coral-500" />}
          <IconButton icon={expanded ? "ChevronUp" : "ChevronDown"} label="Expand" onClick={() => setExpanded((v) => !v)} />
          <IconButton icon="ArrowUp" label="Move up" onClick={onMoveUp} disabled={index === 0} />
          <IconButton icon="ArrowDown" label="Move down" onClick={onMoveDown} disabled={index === total - 1} />
          <IconButton icon="Trash2" label="Remove step" onClick={onRemove} />
        </div>
      </div>
      {expanded && (
        <div className="space-y-3 border-t border-ink-900/[0.06] px-3 pb-3 pt-2">
          <Field label="Description">
            <TextInput value={step.description ?? ""} onChange={(e) => onChange({ description: e.target.value })} placeholder="What this step does" />
          </Field>
          <Field label="Tool / Function ID" hint="e.g. homeops.write_memory, weather.current">
            <TextInput value={step.tool_id ?? ""} onChange={(e) => onChange({ tool_id: e.target.value || null })} placeholder="homeops.create_artifact" />
          </Field>
          <Field label="Input mapping (JSON)" hint="Keys injected into the tool at run time. Use {{param}} for skill inputs.">
            <TextArea value={inputJson}
              onChange={(e) => { setInputJson(e.target.value); setJsonErr(""); }}
              onBlur={applyJson}
              className="font-mono text-xs min-h-[80px]" />
            {jsonErr && <p className="mt-0.5 text-xs text-coral-600">{jsonErr}</p>}
          </Field>
          <label className="flex items-center gap-2">
            <Toggle checked={!!step.approval_required} onChange={(v) => onChange({ approval_required: v })} aria-label="Requires approval" />
            <span className="text-sm text-ink-700">Requires human approval before executing</span>
          </label>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   INFER CAPABILITIES PANEL
   ============================================================ */
function InferPanel({
  onApply, onClose, onCreateMissing,
}: {
  onApply: (result: InferFunctionsResult) => void;
  onClose: () => void;
  onCreateMissing: (capability: string) => void;
}) {
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InferFunctionsResult | null>(null);

  const run = async () => {
    if (!description.trim()) return;
    setBusy(true);
    const r = await backend.inferFunctions(description.trim());
    setBusy(false);
    setResult(r);
  };

  return (
    <div className="space-y-4">
      <Field label="Describe what this skill should do" hint="The AI will suggest tools and a step sequence from your live tool catalog.">
        <TextArea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[100px]" placeholder="Every morning, check the weather, list today's calendar events, and draft a family briefing." />
      </Field>
      <Button variant="ember" disabled={!description.trim() || busy} onClick={run}>
        {busy ? <><Icon name="Loader2" size={15} className="animate-spin" /> Inferring…</> : <><Icon name="Sparkles" size={15} /> Infer capabilities</>}
      </Button>
      {result && !result.ok && <p className="text-sm text-coral-600">{result.message ?? result.error}</p>}
      {result?.ok && (
        <div className="space-y-3">
          {result.suggestedToolIds && result.suggestedToolIds.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Suggested tools</p>
              <div className="flex flex-wrap gap-1.5">{result.suggestedToolIds.map((t) => <Badge key={t} color="sky">{t}</Badge>)}</div>
            </div>
          )}
          {result.missingCapabilities && result.missingCapabilities.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
              <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-amber-700"><Icon name="TriangleAlert" size={12} /> Missing capabilities</p>
              <ul className="space-y-1">{result.missingCapabilities.map((c, i) => (
                <li key={i} className="flex items-start justify-between gap-2 text-xs text-amber-700">
                  <span>• {c}</span>
                  <button onClick={() => onCreateMissing(c)} className="shrink-0 rounded-lg border border-amber-300 bg-white/60 px-2 py-0.5 font-medium text-amber-700 hover:bg-white">Create function</button>
                </li>
              ))}</ul>
              <p className="mt-2 text-xs text-amber-600">Create custom functions in the <strong>Function Builder</strong> to cover these gaps. The skill will stay in <em>needs_function</em> status until all required capabilities are available.</p>
            </div>
          )}
          {result.suggestedSteps && result.suggestedSteps.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">{result.suggestedSteps.length} suggested steps</p>
              <ol className="space-y-1">{result.suggestedSteps.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm"><span className="text-ink-400">{i + 1}.</span><span className="text-ink-700">{s.name}{s.tool_id && <span className="ml-1 text-xs text-ink-400">— {s.tool_id}</span>}</span></li>
              ))}</ol>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="primary" onClick={() => { onApply(result); onClose(); }}>Apply these steps</Button>
            <Button variant="ghost" onClick={onClose}>Discard</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   VERSIONS DRAWER
   ============================================================ */
function VersionsDrawer({ skillId, currentVersion, onRollback, onClose }: {
  skillId: string; currentVersion: number; onRollback: () => void; onClose: () => void;
}) {
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    backend.skillVersions(skillId).then((v) => { setVersions([...v].reverse()); setLoading(false); });
  }, [skillId]);

  const rollback = async (v: number) => {
    setBusy(true);
    await backend.rollbackSkill(skillId, v);
    setBusy(false);
    onRollback();
    onClose();
  };

  return (
    <Drawer open onClose={onClose} title="Version history" icon="History" width="max-w-lg">
      {loading && <div className="flex items-center gap-2 text-sm text-ink-400"><Icon name="Loader2" size={14} className="animate-spin" /> Loading…</div>}
      {!loading && !versions.length && <EmptyState icon="History" title="No versions yet" message="Versions are saved automatically when you edit a skill." />}
      <div className="space-y-2">
        {versions.map((v) => (
          <Card key={v.version} className="card-pad">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink-800">v{v.version} <span className="font-normal text-ink-400">— {v.name}</span></p>
                <p className="text-xs text-ink-400">{relativeTime(v.snapshotAt)} · {v.steps.length} steps · {v.status}</p>
              </div>
              {v.version !== currentVersion && (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => rollback(v.version)}>
                  <Icon name="RotateCcw" size={13} /> Restore
                </Button>
              )}
              {v.version === currentVersion && <Badge color="sage">Current</Badge>}
            </div>
          </Card>
        ))}
      </div>
    </Drawer>
  );
}

/* ============================================================
   SKILL EDITOR PANEL
   ============================================================ */
function SkillEditor({
  skill, onSaved, onDeleted, onNavigateToRun,
}: {
  skill: ServerSkill;
  onSaved: (updated: ServerSkill) => void;
  onDeleted: () => void;
  onNavigateToRun: (runId: string) => void;
}) {
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);

  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [domain, setDomain] = useState(skill.domain);
  const [mode, setMode] = useState<ServerSkill["mode"]>(skill.mode);
  const [riskLevel, setRiskLevel] = useState(skill.risk_level);
  const [plannerGuidance, setPlannerGuidance] = useState(skill.planner_guidance);
  const [steps, setSteps] = useState<SkillStep[]>(skill.steps ?? []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showInfer, setShowInfer] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset local state when selected skill changes
  useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setDomain(skill.domain);
    setMode(skill.mode);
    setRiskLevel(skill.risk_level);
    setPlannerGuidance(skill.planner_guidance);
    setSteps(skill.steps ?? []);
    setDirty(false);
  }, [skill.id]);

  const markDirty = () => setDirty(true);

  const save = async () => {
    setSaving(true);
    const r = await backend.updateSkill(skill.id, {
      ...skill, name, description, domain, mode, risk_level: riskLevel,
      planner_guidance: plannerGuidance, steps,
    });
    setSaving(false);
    if (r.skill) { setDirty(false); onSaved(r.skill); toast({ kind: "success", title: "Skill saved", message: `v${r.skill.version} saved.` }); }
    else toast({ kind: "error", title: "Save failed", message: r.error ?? "Unknown error" });
  };

  const promote = async () => {
    const r = await backend.promoteSkill(skill.id);
    if (r.skill) { onSaved(r.skill); toast({ kind: "success", title: "Promoted", message: "Skill is now available." }); }
    else toast({ kind: "error", title: "Promote failed", message: r.error ?? "Unknown error" });
  };

  const testRun = async () => {
    if (dirty) { toast({ kind: "warn", title: "Unsaved changes", message: "Save the skill before testing." }); return; }
    setTesting(true);
    const r = await backend.testSkill(skill.id);
    setTesting(false);
    if (r.run) {
      toast({ kind: "success", title: "Test started", message: "Run created — opening Live monitor." });
      onNavigateToRun(r.run.id);
    } else {
      toast({ kind: "error", title: "Test failed", message: r.error ?? "Could not start test run" });
    }
  };

  const duplicate = async () => {
    const r = await backend.duplicateSkill(skill.id);
    if (r.skill) { onSaved(r.skill); toast({ kind: "success", title: "Duplicated", message: `Created "${r.skill.name}".` }); }
    else toast({ kind: "error", title: "Duplicate failed", message: r.error ?? "Unknown error" });
  };

  const del = async () => {
    const r = await backend.deleteSkill(skill.id);
    if (r.ok) { setConfirmDelete(false); onDeleted(); toast({ kind: "success", title: "Deleted", message: "Skill removed." }); }
    else toast({ kind: "error", title: "Delete failed", message: r.error ?? "Unknown error" });
  };

  const addStep = () => {
    const newStep: SkillStep = { step_id: `s${steps.length + 1}`, name: "New step", description: "", tool_id: null, input_mapping: {}, approval_required: false };
    setSteps((prev) => [...prev, newStep]);
    markDirty();
  };

  const updateStep = (i: number, patch: Partial<SkillStep>) => {
    setSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
    markDirty();
  };
  const removeStep = (i: number) => { setSteps((prev) => prev.filter((_, idx) => idx !== i)); markDirty(); };
  const moveStep = (i: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const arr = [...prev];
      const tmp = arr[i]; arr[i] = arr[i + dir]; arr[i + dir] = tmp;
      return arr;
    });
    markDirty();
  };

  const applyInferred = (result: InferFunctionsResult) => {
    if (result.suggestedSteps?.length) {
      setSteps(result.suggestedSteps);
      markDirty();
    }
    // Mark skill needs_function if missing capabilities exist
    if (result.missingCapabilities?.length) {
      backend.patchSkill(skill.id, { status: "needs_function" }).then((r) => { if (r.skill) onSaved(r.skill); });
    }
  };

  return (
    <Card className="card-pad">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-display text-base font-semibold text-ink-900">{name || "Untitled Skill"}</p>
            <SkillStatusBadge status={skill.status} />
            {skill.system && <Badge color="sky">System</Badge>}
            {dirty && <Badge color="amber">Unsaved</Badge>}
          </div>
          <p className="text-xs text-ink-400">v{skill.version} · {skill.id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setShowVersions(true)}><Icon name="History" size={13} /> Versions</Button>
          <Button size="sm" variant="ghost" onClick={duplicate}><Icon name="Copy" size={13} /> Duplicate</Button>
          {!skill.system && <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}><Icon name="Trash2" size={13} /> Delete</Button>}
          {skill.status !== "available" && !skill.system && (
            <Button size="sm" variant="secondary" onClick={promote}><Icon name="CheckCircle2" size={13} /> Promote</Button>
          )}
          <Button size="sm" variant="secondary" disabled={testing} onClick={testRun}>
            {testing ? <><Icon name="Loader2" size={13} className="animate-spin" /> Testing…</> : <><Icon name="Play" size={13} /> Test run</>}
          </Button>
          <Button size="sm" variant="ember" disabled={!dirty || saving} onClick={save}>
            {saving ? <><Icon name="Loader2" size={13} className="animate-spin" /> Saving…</> : <><Icon name="Save" size={13} /> Save</>}
          </Button>
        </div>
      </div>

      {/* Basic info */}
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <TextInput value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} />
          </Field>
          <Field label="Domain">
            <Select value={domain} onChange={(e) => { setDomain(e.target.value); markDirty(); }}>
              {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Description">
          <TextArea value={description} onChange={(e) => { setDescription(e.target.value); markDirty(); }} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Execution mode">
            <Select value={mode} onChange={(e) => { setMode(e.target.value as ServerSkill["mode"]); markDirty(); }}>
              {MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </Select>
          </Field>
          <Field label="Risk level">
            <Select value={riskLevel} onChange={(e) => { setRiskLevel(e.target.value as ServerSkill["risk_level"]); markDirty(); }}>
              {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
        </div>
        {(mode === "planner-assisted" || mode === "hybrid") && (
          <Field label="Planner guidance" hint="Instructions for the AI planner when generating a concrete plan from this skill.">
            <TextArea value={plannerGuidance} onChange={(e) => { setPlannerGuidance(e.target.value); markDirty(); }} className="min-h-[80px]" placeholder="Summarize the day for the family — be concise and warm." />
          </Field>
        )}
      </div>

      {/* Steps */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink-700">{steps.length} Step{steps.length !== 1 ? "s" : ""}</p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setShowInfer(true)}><Icon name="Sparkles" size={13} /> Infer capabilities</Button>
            <Button size="sm" variant="secondary" onClick={addStep}><Icon name="Plus" size={13} /> Add step</Button>
          </div>
        </div>
        {!steps.length && (
          <div className="rounded-2xl border border-dashed border-ink-200 py-6 text-center text-sm text-ink-400">
            No steps yet — add one manually or use <strong>Infer capabilities</strong> to generate them from a description.
          </div>
        )}
        <div className="space-y-2">
          {steps.map((s, i) => (
            <StepRow key={s.step_id + i} step={s} index={i} total={steps.length}
              onChange={(p) => updateStep(i, p)}
              onRemove={() => removeStep(i)}
              onMoveUp={() => moveStep(i, -1)}
              onMoveDown={() => moveStep(i, 1)} />
          ))}
        </div>
      </div>

      {/* Infer panel */}
      {showInfer && (
        <Modal open onClose={() => setShowInfer(false)} title="Infer capabilities" icon="Sparkles" size="lg">
          <InferPanel onApply={applyInferred} onClose={() => setShowInfer(false)}
            onCreateMissing={(cap) => { setShowInfer(false); navigate("functions", { create: "1", name: cap.slice(0, 48), description: cap }); }} />
        </Modal>
      )}

      {/* Confirm delete */}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete skill?" icon="Trash2"
        footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={del}><Icon name="Trash2" size={15} /> Delete</Button></>}>
        <p className="text-sm text-ink-600">Permanently delete <strong>{name}</strong>? This cannot be undone. Run history is preserved in the activity log.</p>
      </Modal>

      {/* Versions drawer */}
      {showVersions && (
        <VersionsDrawer skillId={skill.id} currentVersion={skill.version}
          onRollback={() => { /* parent reload handles this */ }}
          onClose={() => setShowVersions(false)} />
      )}
    </Card>
  );
}

/* ============================================================
   NEW SKILL FORM
   ============================================================ */
function NewSkillForm({ onCreate, onCancel }: { onCreate: (skill: ServerSkill) => void; onCancel: () => void }) {
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState("General");
  const [mode, setMode] = useState<ServerSkill["mode"]>("deterministic");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await backend.createSkill({ name, description, domain, mode });
    setBusy(false);
    if (r.skill) onCreate(r.skill);
    else toast({ kind: "error", title: "Create failed", message: r.error ?? "Unknown error" });
  };

  return (
    <Modal open onClose={onCancel} title="New skill" icon="Layers"
      footer={<><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button variant="ember" disabled={!name.trim() || busy} onClick={create}>{busy ? <><Icon name="Loader2" size={15} className="animate-spin" /> Creating…</> : <><Icon name="Plus" size={15} /> Create</>}</Button></>}>
      <div className="space-y-3">
        <Field label="Name" hint="A short, action-oriented name — e.g. 'Morning Family Briefing'">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Morning Family Briefing" />
        </Field>
        <Field label="Description">
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this skill does and when it should run." />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Domain">
            <Select value={domain} onChange={(e) => setDomain(e.target.value)}>
              {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Field>
          <Field label="Mode">
            <Select value={mode} onChange={(e) => setMode(e.target.value as ServerSkill["mode"])}>
              {MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* ============================================================
   RECIPES PANEL (read-only Playbooks view, folded into Skills)
   ============================================================ */
function RecipeCard({ p, onOpen, running, onRun }: { p: Playbook; onOpen: () => void; running: boolean; onRun: () => void }) {
  return (
    <Card className="card-pad flex flex-col" hover>
      <div className="flex flex-1 flex-col" onClick={onOpen} role="button">
        <div className="mb-2 flex items-center justify-between"><Badge color="sky">{p.category}</Badge><span className="text-xs text-ink-400">{p.steps.length} steps</span></div>
        <p className="font-display text-base font-semibold leading-snug text-ink-900">{p.name}</p>
        <p className="mt-1 line-clamp-2 text-xs text-ink-500">{p.description}</p>
      </div>
      <div className="mt-3 flex items-center gap-1 border-t border-ink-900/[0.06] pt-3">
        <Button size="sm" variant="ember" disabled={running} onClick={onRun}>{running ? <><Icon name="Loader2" size={13} className="animate-spin" /> Running</> : <><Icon name="Play" size={13} /> Run</>}</Button>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onOpen}>View steps</Button>
      </div>
    </Card>
  );
}

function RecipeDrawer({ playbook: p, onClose, onRun, running }: { playbook: Playbook; onClose: () => void; onRun: () => void; running: boolean }) {
  const data = useStore((s) => s.data);
  const navigate = useStore((s) => s.navigate);
  const agents = data.agents.filter((a) => p.linkedAgentIds.includes(a.id));
  const List = ({ title, items, icon }: { title: string; items: string[]; icon: string }) => items.length ? <div><p className="section-title mb-1.5 flex items-center gap-1.5"><Icon name={icon} size={12} />{title}</p><div className="flex flex-wrap gap-1.5">{items.map((i, k) => <span key={k} className="chip bg-surface-sunken text-ink-600">{i}</span>)}</div></div> : null;
  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={p.name} icon="ScrollText" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" disabled={running} onClick={onRun}>{running ? <><Icon name="Loader2" size={15} className="animate-spin" /> Running…</> : <><Icon name="Play" size={15} /> Run recipe</>}</Button></>}>
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

function RecipesPanel({ initialId }: { initialId?: string | null }) {
  const data = useStore((s) => s.data);
  const runPlaybook = useStore((s) => s.runPlaybook);
  const [cat, setCat] = useState("All");
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => { if (initialId) setSelected(initialId); }, [initialId]);

  const run = async (id: string) => { setRunningId(id); await runPlaybook(id); setRunningId(null); };
  const cats = ["All", ...Array.from(new Set(data.playbooks.map((p) => p.category)))];
  const active = data.playbooks.filter((p) => !p.archived && (cat === "All" || p.category === cat));
  const sel = data.playbooks.find((p) => p.id === selected) ?? null;

  return (
    <div>
      <p className="mb-3 text-sm text-ink-500">Reusable, step-by-step instructions for recurring household workflows — a read-only reference view. Run one directly, or ask FamiliOS to follow it.</p>
      <div className="mb-4 flex flex-wrap gap-2">{cats.map((c) => <button key={c} onClick={() => setCat(c)} className={`chip pressable transition-colors ${cat === c ? "bg-ink-800 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" : "border border-ink-900/10 bg-surface-raised text-ink-600 hover:bg-surface-overlay"}`}>{c}</button>)}</div>
      {active.length === 0 ? <EmptyState icon="ScrollText" title="No recipes yet" message="Recipes are created by your agents and automations as they learn recurring workflows." /> : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {active.map((p) => <RecipeCard key={p.id} p={p} onOpen={() => setSelected(p.id)} running={runningId === p.id} onRun={() => run(p.id)} />)}
        </div>
      )}
      {sel && <RecipeDrawer playbook={sel} onClose={() => setSelected(null)} onRun={() => run(sel.id)} running={runningId === sel.id} />}
    </div>
  );
}

/* ============================================================
   ROOT SCREEN
   ============================================================ */
const TABS = [
  { id: "skills", label: "Skills", icon: "Layers" },
  { id: "recipes", label: "Recipes", icon: "ScrollText" },
];

export function SkillBuilder() {
  const navigate = useStore((s) => s.navigate);
  const routeScreen = useStore((s) => s.route.screen);
  const params = useStore((s) => s.route.params);
  const [tab, setTab] = useState<string>(routeScreen === "playbooks" ? "recipes" : "skills");
  const [recipeId, setRecipeId] = useState<string | null>(routeScreen === "playbooks" ? (params?.id ?? null) : null);
  const [skills, setSkills] = useState<ServerSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  // Old "playbooks" deep links (search results, agent detail chips) land here on the
  // Recipes tab — Playbooks is no longer a separate top-level concept.
  useEffect(() => {
    if (routeScreen === "playbooks") { setTab("recipes"); if (params?.id) setRecipeId(params.id); }
  }, [routeScreen, params?.id]);

  const load = useCallback(async () => {
    const list = await backend.skills();
    setSkills(list);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const sel = skills.find((s) => s.id === selId) ?? null;

  const handleSaved = (updated: ServerSkill) => {
    setSkills((prev) => prev.map((s) => s.id === updated.id ? updated : s).concat(
      prev.some((s) => s.id === updated.id) ? [] : [updated]
    ));
    setSelId(updated.id);
  };
  const handleDeleted = () => { setSelId(null); load(); };
  const handleNew = (skill: ServerSkill) => { setShowNew(false); setSkills((prev) => [skill, ...prev]); setSelId(skill.id); };
  const handleNavigateToRun = (_runId: string) => {
    navigate("automations" as any, { tab: "monitor" });
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Skills" subtitle="Reusable, hybrid routines that the orchestrator selects and executes as durable server runs." icon="Layers" />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="pt-5">
        {tab === "skills" && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,22rem)_1fr]">
            <SkillList skills={skills} selId={selId} onSelect={setSelId} onNew={() => setShowNew(true)} loading={loading} />
            <div>
              {sel ? (
                <SkillEditor skill={sel} onSaved={handleSaved} onDeleted={handleDeleted} onNavigateToRun={handleNavigateToRun} />
              ) : (
                <EmptyState icon="Layers" title="Select a skill" message="Pick a skill to view and edit it, or create a new one." />
              )}
            </div>
          </div>
        )}
        {tab === "recipes" && <RecipesPanel initialId={recipeId} />}
      </div>
      {showNew && <NewSkillForm onCreate={handleNew} onCancel={() => setShowNew(false)} />}
    </div>
  );
}
