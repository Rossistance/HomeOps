import { useCallback, useEffect, useMemo, useState } from "react";
import {
  backend,
  type ServerFunction, type FunctionField, type FunctionState, type FunctionType,
  type FunctionVersion, type ToolCatalogEntry, type FunctionTestResult,
} from "@/connectors/api";
import {
  PageHeader, Card, Button, IconButton, Badge, Modal, Drawer,
  Field, TextInput, TextArea, Select, Toggle, EmptyState,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/dates";
import { useStore } from "@/store/useStore";

/* ============================================================
   STATE + TYPE METADATA (truthful, server-computed)
   ============================================================ */
const STATE_META: Record<FunctionState, { label: string; color: "sage" | "amber" | "sky" | "coral" | "lavender" | "gray"; icon: string }> = {
  available:       { label: "Available",       color: "sage",     icon: "CircleCheck" },
  untested:        { label: "Untested",        color: "sky",      icon: "CircleDashed" },
  testing:         { label: "Testing…",        color: "sky",      icon: "Loader2" },
  test_failed:     { label: "Test failed",     color: "coral",    icon: "CircleX" },
  draft:           { label: "Draft",           color: "amber",    icon: "PencilLine" },
  needs_schema:    { label: "Needs schema",    color: "amber",    icon: "Braces" },
  needs_connector: { label: "Needs connector", color: "amber",    icon: "Plug" },
  needs_secret:    { label: "Needs secret",    color: "amber",    icon: "KeyRound" },
  needs_runtime:   { label: "Needs runtime",   color: "amber",    icon: "ServerCog" },
  degraded:        { label: "Degraded",        color: "coral",    icon: "TriangleAlert" },
  deprecated:      { label: "Deprecated",      color: "lavender", icon: "Archive" },
};

const TYPE_META: Record<FunctionType, { label: string; icon: string; blurb: string }> = {
  connector_api:     { label: "Connector API",   icon: "Plug",          blurb: "Wrap a real provider/connector tool (Gmail, Calendar, Drive, Slack…)." },
  internal:          { label: "Internal",        icon: "House",         blurb: "Wrap a first-class FamiliOS handler (memory, artifact, sign-off)." },
  custom_http:       { label: "Custom HTTP",     icon: "Globe",         blurb: "Call an allowlisted HTTP API. Auth secret stays server-side." },
  ai_local:          { label: "Local AI",        icon: "Cpu",           blurb: "Ollama / LM Studio health, model discovery, or chat over loopback." },
  browser:           { label: "Browser",         icon: "MousePointer2", blurb: "Drive the real browser-automation runtime (only when healthy)." },
  sandbox_script:    { label: "Sandbox script",  icon: "SquareTerminal",blurb: "Reserved — unavailable until a sandbox runtime is wired in." },
  workflow_composed: { label: "Composed",        icon: "Workflow",      blurb: "Sequence other available functions into one capability." },
};

const RISK_LEVELS = ["Low", "Medium", "High", "Sensitive"];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const FIELD_TYPES = ["text", "textarea", "number", "boolean", "json"];
const INTERNAL_FUNCTIONS = [
  { id: "homeops.write_memory", label: "Write memory" },
  { id: "homeops.create_artifact", label: "Create artifact" },
  { id: "homeops.create_approval", label: "Request sign-off (gated)" },
];
const AI_LOCAL_PROVIDERS = [{ id: "ollama", label: "Ollama (local)" }, { id: "lmstudio", label: "LM Studio (local)" }];
const AI_LOCAL_OPS = [{ id: "health", label: "Health check" }, { id: "models", label: "Discover models" }, { id: "chat", label: "Chat" }];

function FunctionStateBadge({ state }: { state: FunctionState }) {
  const m = STATE_META[state] ?? STATE_META.draft;
  return <Badge color={m.color}><Icon name={m.icon} size={11} className={cn("mr-0.5 inline", state === "testing" && "animate-spin")} /> {m.label}</Badge>;
}

/* ============================================================
   FUNCTION LIST
   ============================================================ */
const STATE_FILTERS: { id: string; label: string; match: (s: FunctionState) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "available", label: "Available", match: (s) => s === "available" },
  { id: "draft", label: "In progress", match: (s) => ["draft", "untested", "needs_schema", "testing"].includes(s) },
  { id: "blocked", label: "Blocked", match: (s) => ["needs_connector", "needs_secret", "needs_runtime", "test_failed", "degraded"].includes(s) },
  { id: "deprecated", label: "Deprecated", match: (s) => s === "deprecated" },
];

function FunctionList({
  functions, selId, onSelect, onNew, loading,
}: {
  functions: ServerFunction[]; selId: string | null;
  onSelect: (id: string) => void; onNew: () => void; loading: boolean;
}) {
  const [filter, setFilter] = useState("all");
  const f = STATE_FILTERS.find((x) => x.id === filter) ?? STATE_FILTERS[0];
  const filtered = functions.filter((fn) => f.match(fn.state));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-ink-700">Functions</h2>
        <Button size="sm" variant="ember" onClick={onNew}><Icon name="Plus" size={13} /> New</Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {STATE_FILTERS.map((x) => (
          <button key={x.id} onClick={() => setFilter(x.id)}
            className={cn("chip transition-colors pressable text-xs",
              filter === x.id ? "bg-gradient-to-b from-ink-700 to-ink-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                : "border border-ink-900/10 bg-surface-raised text-ink-600 hover:border-ink-900/20 hover:bg-surface-overlay"
            )}>
            {x.label}
          </button>
        ))}
      </div>
      {loading && <div className="flex items-center gap-2 text-sm text-ink-400"><Icon name="Loader2" size={14} className="animate-spin" /> Loading…</div>}
      {!loading && !filtered.length && (
        <EmptyState icon="FunctionSquare" title="No functions" message={filter === "all" ? "Create your first executable function — a tool your agents and skills can call." : "Nothing in this view yet."} />
      )}
      <div className="space-y-2">
        {filtered.map((fn) => (
          <Card key={fn.id} className={cn("card-pad cursor-pointer", selId === fn.id && "ring-2 ring-ember-400")} hover onClick={() => onSelect(fn.id)}>
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-semibold text-ink-800">{fn.name}</p>
              <FunctionStateBadge state={fn.state} />
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs text-ink-400">{fn.description || "No description."}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
              <span className="flex items-center gap-1"><Icon name={TYPE_META[fn.type]?.icon ?? "Box"} size={11} /> {TYPE_META[fn.type]?.label ?? fn.type}</span>
              <span className="flex items-center gap-1"><Icon name="Activity" size={11} /> {fn.effectiveAction}</span>
              {fn.requiresApproval && <span className="flex items-center gap-1 text-coral-500"><Icon name="ShieldAlert" size={11} /> Approval</span>}
              {fn.system && <span className="flex items-center gap-1 text-sky-600"><Icon name="Shield" size={11} /> System</span>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   SCHEMA EDITOR (input / output field rows)
   ============================================================ */
function SchemaEditor({ title, fields, onChange }: { title: string; fields: FunctionField[]; onChange: (f: FunctionField[]) => void }) {
  const update = (i: number, patch: Partial<FunctionField>) => onChange(fields.map((f, idx) => idx === i ? { ...f, ...patch } : f));
  const remove = (i: number) => onChange(fields.filter((_, idx) => idx !== i));
  const add = () => onChange([...fields, { key: "", label: "", type: "text", required: false }]);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-700">{title}</p>
        <Button size="sm" variant="ghost" onClick={add}><Icon name="Plus" size={12} /> Field</Button>
      </div>
      {!fields.length && <p className="rounded-xl border border-dashed border-ink-200 px-3 py-2 text-xs text-ink-400">No fields.</p>}
      <div className="space-y-1.5">
        {fields.map((f, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-xl border border-ink-900/[0.07] bg-surface-rim px-2 py-1.5">
            <input value={f.key} onChange={(e) => update(i, { key: e.target.value })} placeholder="key" className="w-24 bg-transparent text-xs font-mono text-ink-800 outline-none placeholder:text-ink-300" />
            <input value={f.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="Label" className="min-w-0 flex-1 bg-transparent text-xs text-ink-700 outline-none placeholder:text-ink-300" />
            <select value={f.type} onChange={(e) => update(i, { type: e.target.value })} className="rounded-lg border border-ink-900/10 bg-white px-1.5 py-0.5 text-xs text-ink-600">
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs text-ink-500"><input type="checkbox" checked={!!f.required} onChange={(e) => update(i, { required: e.target.checked })} /> req</label>
            <input value={f.default ?? ""} onChange={(e) => update(i, { default: e.target.value })} placeholder="default" className="w-20 bg-transparent text-xs text-ink-600 outline-none placeholder:text-ink-300" />
            <IconButton icon="X" label="Remove field" onClick={() => remove(i)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   TYPE-SPECIFIC CONFIG EDITOR
   ============================================================ */
function ConfigEditor({
  type, config, hasSecret, catalog, functions, onChange, onSecretChange,
}: {
  type: FunctionType;
  config: Record<string, unknown>;
  hasSecret: boolean;
  catalog: ToolCatalogEntry[];
  functions: ServerFunction[];
  onChange: (patch: Record<string, unknown>) => void;
  onSecretChange: (v: string) => void;
}) {
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });

  if (type === "connector_api") {
    const tools = catalog;
    return (
      <Field label="Wrapped tool" hint="The real provider/connector tool this function calls. Approval & risk are inherited.">
        <Select value={String(config.toolId ?? "")} onChange={(e) => set("toolId", e.target.value)}>
          <option value="">— choose a tool —</option>
          {tools.map((t) => (
            <option key={t.toolId} value={t.toolId}>{t.connectorName} · {t.name} ({t.action}){t.connected ? "" : " — not connected"}</option>
          ))}
        </Select>
      </Field>
    );
  }
  if (type === "browser") {
    const tools = catalog.filter((t) => t.connectorId === "browser");
    return (
      <Field label="Browser action" hint="Runs only when the browser-automation runtime is healthy.">
        <Select value={String(config.toolId ?? "")} onChange={(e) => set("toolId", e.target.value)}>
          <option value="">— choose an action —</option>
          {tools.map((t) => <option key={t.toolId} value={t.toolId}>{t.name} ({t.action})</option>)}
        </Select>
      </Field>
    );
  }
  if (type === "internal") {
    return (
      <Field label="Internal handler" hint="A first-class FamiliOS function. create_approval is gated by a real human approval.">
        <Select value={String(config.functionId ?? "")} onChange={(e) => set("functionId", e.target.value)}>
          <option value="">— choose a handler —</option>
          {INTERNAL_FUNCTIONS.map((f) => <option key={f.id} value={f.id}>{f.label} — {f.id}</option>)}
        </Select>
      </Field>
    );
  }
  if (type === "custom_http") {
    let headersJson = "{}";
    try { headersJson = JSON.stringify(config.headers ?? {}, null, 2); } catch { /* ignore */ }
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <Field label="Method">
            <Select value={String(config.method ?? "GET")} onChange={(e) => set("method", e.target.value)}>
              {HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label="URL" hint="The host is allowlisted at save time. Private/loopback targets are blocked (SSRF).">
            <TextInput value={String(config.url ?? "")} onChange={(e) => set("url", e.target.value)} placeholder="https://api.example.com/v1/status" />
          </Field>
        </div>
        <Field label="Static headers (JSON)">
          <TextArea defaultValue={headersJson} onBlur={(e) => { try { set("headers", JSON.parse(e.target.value || "{}")); } catch { /* keep */ } }} className="font-mono text-xs min-h-[60px]" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Auth header name" hint="Optional. e.g. Authorization">
            <TextInput value={String(config.secretHeaderName ?? "")} onChange={(e) => set("secretHeaderName", e.target.value)} placeholder="Authorization" />
          </Field>
          <Field label="Secret value" hint={hasSecret ? "A secret is set. Leave blank to keep it." : "Stored server-side only — never returned."}>
            <TextInput type="password" placeholder={hasSecret ? "•••••••• (unchanged)" : "Bearer …"} onChange={(e) => onSecretChange(e.target.value)} />
          </Field>
        </div>
        {WRITE_HINT(String(config.method ?? "GET"))}
      </div>
    );
  }
  if (type === "ai_local") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Provider">
          <Select value={String(config.providerId ?? "")} onChange={(e) => set("providerId", e.target.value)}>
            <option value="">— choose —</option>
            {AI_LOCAL_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>
        <Field label="Operation">
          <Select value={String(config.op ?? "")} onChange={(e) => set("op", e.target.value)}>
            <option value="">— choose —</option>
            {AI_LOCAL_OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
        </Field>
      </div>
    );
  }
  if (type === "workflow_composed") {
    const steps = (config.steps as { functionId: string; input_mapping?: Record<string, unknown> }[]) ?? [];
    const available = functions.filter((fn) => fn.state === "available");
    const setSteps = (s: typeof steps) => set("steps", s);
    return (
      <div className="space-y-2">
        <p className="text-xs text-ink-400">Sequence available functions. Each step's output is merged into the next step's input.</p>
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 rounded-xl border border-ink-900/[0.07] bg-surface-rim px-2 py-1.5">
            <span className="text-xs text-ink-400">{i + 1}.</span>
            <select value={s.functionId} onChange={(e) => setSteps(steps.map((x, idx) => idx === i ? { ...x, functionId: e.target.value } : x))} className="min-w-0 flex-1 rounded-lg border border-ink-900/10 bg-white px-1.5 py-1 text-xs text-ink-700">
              <option value="">— choose function —</option>
              {available.map((fn) => <option key={fn.id} value={fn.id}>{fn.name}</option>)}
            </select>
            <IconButton icon="X" label="Remove step" onClick={() => setSteps(steps.filter((_, idx) => idx !== i))} />
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setSteps([...steps, { functionId: "", input_mapping: {} }])}><Icon name="Plus" size={12} /> Add step</Button>
        {!available.length && <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">No available functions yet — promote some functions first.</p>}
      </div>
    );
  }
  if (type === "sandbox_script") {
    return <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700"><Icon name="TriangleAlert" size={13} className="mr-1 inline" /> No sandbox runtime is wired into this deployment, so a sandbox function can never become available. This type is reserved for honesty — it will not fabricate success.</p>;
  }
  return null;
}
function WRITE_HINT(method: string) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return null;
  return <p className="rounded-xl bg-coral-50 border border-coral-200 px-3 py-2 text-xs text-coral-700"><Icon name="ShieldAlert" size={12} className="mr-1 inline" /> A {method} request is a write action — it requires approval in runs, and testing it performs the real request.</p>;
}

/* ============================================================
   TEST PANEL (real handler; no mock)
   ============================================================ */
function TestFunctionPanel({ fn, onTested }: { fn: ServerFunction; onTested: (updated: ServerFunction) => void }) {
  const toast = useStore((s) => s.toast);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of fn.input_schema ?? []) init[f.key] = f.default ?? "";
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FunctionTestResult | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  useEffect(() => {
    const init: Record<string, string> = {};
    for (const f of fn.input_schema ?? []) init[f.key] = f.default ?? "";
    setValues(init); setResult(null); setNeedsConfirm(false);
  }, [fn.id]);

  const buildInput = () => {
    const out: Record<string, unknown> = {};
    for (const f of fn.input_schema ?? []) {
      const raw = values[f.key];
      if (raw == null || raw === "") continue;
      if (f.type === "json") { try { out[f.key] = JSON.parse(raw); } catch { out[f.key] = raw; } }
      else if (f.type === "number") out[f.key] = Number(raw);
      else if (f.type === "boolean") out[f.key] = raw === "true";
      else out[f.key] = raw;
    }
    return out;
  };

  const run = async (confirm = false) => {
    setBusy(true);
    const r = await backend.testFunction(fn.id, buildInput(), confirm);
    setBusy(false);
    setResult(r);
    if (r.needsConfirm) { setNeedsConfirm(true); return; }
    setNeedsConfirm(false);
    if (r.function) onTested(r.function);
    if (r.ok) toast({ kind: "success", title: "Test passed", message: "Real execution succeeded — function can be promoted." });
    else toast({ kind: "error", title: "Test failed", message: r.message ?? r.error ?? "Unknown error" });
  };

  return (
    <div className="space-y-3">
      {(fn.input_schema ?? []).length > 0 ? (
        <div className="space-y-2">
          {fn.input_schema.map((f) => (
            <Field key={f.key} label={`${f.label || f.key}${f.required ? " *" : ""}`} hint={f.type === "json" ? "JSON value" : undefined}>
              {f.type === "textarea" || f.type === "json"
                ? <TextArea value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={cn(f.type === "json" && "font-mono text-xs")} />
                : <TextInput value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />}
            </Field>
          ))}
        </div>
      ) : <p className="text-xs text-ink-400">This function takes no declared inputs.</p>}

      <div className="flex items-center gap-2">
        <Button variant="ember" disabled={busy} onClick={() => run(false)}>
          {busy ? <><Icon name="Loader2" size={15} className="animate-spin" /> Running real test…</> : <><Icon name="Play" size={15} /> Run real test</>}
        </Button>
        <span className="text-xs text-ink-400">Hits the real handler — no mock.</span>
      </div>

      {needsConfirm && (
        <div className="rounded-xl bg-coral-50 border border-coral-200 p-3">
          <p className="text-sm text-coral-700">{result?.message}</p>
          <Button size="sm" variant="danger" className="mt-2" disabled={busy} onClick={() => run(true)}><Icon name="ShieldAlert" size={13} /> Confirm & perform the real action</Button>
        </div>
      )}

      {result && !result.needsConfirm && (
        <div className={cn("rounded-xl border p-3", result.ok ? "bg-sage-50 border-sage-200" : "bg-coral-50 border-coral-200")}>
          <p className={cn("mb-1 flex items-center gap-1.5 text-sm font-semibold", result.ok ? "text-sage-700" : "text-coral-700")}>
            <Icon name={result.ok ? "CircleCheck" : "CircleX"} size={14} /> {result.ok ? "Passed" : "Failed"}
          </p>
          {!result.ok && <p className="text-xs text-coral-700">{result.message ?? result.error}</p>}
          {result.ok && <pre className="max-h-48 overflow-auto rounded-lg bg-white/70 p-2 text-[11px] text-ink-700">{JSON.stringify(result.result, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   VERSIONS DRAWER
   ============================================================ */
function VersionsDrawer({ fnId, currentVersion, onRollback, onClose }: { fnId: string; currentVersion: number; onRollback: () => void; onClose: () => void }) {
  const [versions, setVersions] = useState<FunctionVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { backend.functionVersions(fnId).then((v) => { setVersions([...v].reverse()); setLoading(false); }); }, [fnId]);
  const rollback = async (v: number) => { setBusy(true); await backend.rollbackFunction(fnId, v); setBusy(false); onRollback(); onClose(); };
  return (
    <Drawer open onClose={onClose} title="Version history" icon="History" width="max-w-lg">
      {loading && <div className="flex items-center gap-2 text-sm text-ink-400"><Icon name="Loader2" size={14} className="animate-spin" /> Loading…</div>}
      {!loading && !versions.length && <EmptyState icon="History" title="No versions yet" message="Versions are saved automatically when you edit a function." />}
      <div className="space-y-2">
        {versions.map((v) => (
          <Card key={v.version} className="card-pad">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink-800">v{v.version} <span className="font-normal text-ink-400">— {v.name}</span></p>
                <p className="text-xs text-ink-400">{relativeTime(v.snapshotAt)} · {TYPE_META[v.type]?.label ?? v.type} · {v.status}</p>
              </div>
              {v.version !== currentVersion
                ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => rollback(v.version)}><Icon name="RotateCcw" size={13} /> Restore</Button>
                : <Badge color="sage">Current</Badge>}
            </div>
          </Card>
        ))}
      </div>
    </Drawer>
  );
}

/* ============================================================
   FUNCTION EDITOR
   ============================================================ */
function FunctionEditor({
  fn, catalog, functions, onSaved, onDeleted,
}: {
  fn: ServerFunction; catalog: ToolCatalogEntry[]; functions: ServerFunction[];
  onSaved: (updated: ServerFunction) => void; onDeleted: () => void;
}) {
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(fn.name);
  const [description, setDescription] = useState(fn.description);
  const [type, setType] = useState<FunctionType>(fn.type);
  const [risk, setRisk] = useState(fn.risk);
  const [approval, setApproval] = useState(fn.approval_required);
  const [config, setConfig] = useState<Record<string, unknown>>(fn.config ?? {});
  const [secretValue, setSecretValue] = useState("");
  const [inputSchema, setInputSchema] = useState<FunctionField[]>(fn.input_schema ?? []);
  const [outputSchema, setOutputSchema] = useState<FunctionField[]>(fn.output_schema ?? []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(fn.name); setDescription(fn.description); setType(fn.type); setRisk(fn.risk);
    setApproval(fn.approval_required); setConfig(fn.config ?? {}); setSecretValue("");
    setInputSchema(fn.input_schema ?? []); setOutputSchema(fn.output_schema ?? []);
    setDirty(false);
  }, [fn.id]);

  const markDirty = () => setDirty(true);

  const save = async () => {
    setSaving(true);
    const body: Partial<ServerFunction> & { config?: Record<string, unknown> } = {
      name, description, type, risk, approval_required: approval,
      input_schema: inputSchema, output_schema: outputSchema,
      config: { ...config, ...(secretValue ? { secretValue } : {}) },
    };
    const r = await backend.updateFunction(fn.id, body);
    setSaving(false);
    if (r.function) { setDirty(false); setSecretValue(""); onSaved(r.function); toast({ kind: "success", title: "Saved", message: `v${r.function.version} saved.` }); }
    else toast({ kind: "error", title: "Save failed", message: r.error ?? "Unknown error" });
  };

  const promote = async () => {
    const r = await backend.promoteFunction(fn.id);
    if (r.function) { onSaved(r.function); toast({ kind: "success", title: "Promoted", message: "Function is now available." }); }
    else toast({ kind: "error", title: "Cannot promote", message: r.message ?? r.error ?? "A passing test is required first." });
  };
  const deprecate = async () => {
    const r = await backend.deprecateFunction(fn.id);
    if (r.function) { onSaved(r.function); toast({ kind: "success", title: "Deprecated", message: "Function retired." }); }
    else toast({ kind: "error", title: "Failed", message: r.error ?? "Unknown error" });
  };
  const duplicate = async () => {
    const r = await backend.duplicateFunction(fn.id);
    if (r.function) { onSaved(r.function); toast({ kind: "success", title: "Duplicated", message: `Created "${r.function.name}".` }); }
    else toast({ kind: "error", title: "Failed", message: r.error ?? "Unknown error" });
  };
  const del = async () => {
    const r = await backend.deleteFunction(fn.id);
    if (r.ok) { setConfirmDelete(false); onDeleted(); toast({ kind: "success", title: "Deleted", message: "Function removed." }); }
    else toast({ kind: "error", title: "Delete failed", message: r.error ?? "Unknown error" });
  };

  return (
    <Card className="card-pad">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-base font-semibold text-ink-900">{name || "Untitled function"}</p>
            <FunctionStateBadge state={fn.state} />
            {fn.requiresApproval && <Badge color="coral"><Icon name="ShieldAlert" size={11} className="mr-0.5 inline" /> Approval</Badge>}
            {fn.system && <Badge color="sky">System</Badge>}
            {dirty && <Badge color="amber">Unsaved</Badge>}
          </div>
          <p className="text-xs text-ink-400">v{fn.version} · {fn.id} · {fn.effectiveAction} · {fn.effectiveRisk} risk</p>
          <p className="mt-0.5 text-xs text-ink-400">{fn.stateReason}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setShowVersions(true)}><Icon name="History" size={13} /> Versions</Button>
          <Button size="sm" variant="ghost" onClick={duplicate}><Icon name="Copy" size={13} /> Duplicate</Button>
          {!fn.system && fn.status !== "deprecated" && <Button size="sm" variant="ghost" onClick={deprecate}><Icon name="Archive" size={13} /> Deprecate</Button>}
          {!fn.system && <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}><Icon name="Trash2" size={13} /> Delete</Button>}
          {fn.state === "available" && fn.status !== "available"
            ? <Button size="sm" variant="secondary" onClick={promote}><Icon name="CircleCheck" size={13} /> Promote</Button>
            : fn.status !== "available" && <Button size="sm" variant="secondary" disabled title="Pass a real test first">Promote</Button>}
          <Button size="sm" variant="secondary" onClick={() => setShowTest(true)} disabled={dirty} title={dirty ? "Save before testing" : undefined}><Icon name="Play" size={13} /> Test</Button>
          <Button size="sm" variant="ember" disabled={!dirty || saving} onClick={save}>
            {saving ? <><Icon name="Loader2" size={13} className="animate-spin" /> Saving…</> : <><Icon name="Save" size={13} /> Save</>}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name"><TextInput value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} /></Field>
          <Field label="Type" hint={TYPE_META[type]?.blurb}>
            <Select value={type} onChange={(e) => { setType(e.target.value as FunctionType); setConfig({}); markDirty(); }}>
              {(Object.keys(TYPE_META) as FunctionType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Description"><TextArea value={description} onChange={(e) => { setDescription(e.target.value); markDirty(); }} /></Field>

        <div className="rounded-2xl border border-ink-900/[0.08] bg-surface-rim p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-700"><Icon name={TYPE_META[type]?.icon ?? "Box"} size={14} /> Handler configuration</p>
          <ConfigEditor type={type} config={config} hasSecret={fn.hasSecret} catalog={catalog} functions={functions}
            onChange={(c) => { setConfig(c); markDirty(); }} onSecretChange={(v) => { setSecretValue(v); markDirty(); }} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Risk level">
            <Select value={risk} onChange={(e) => { setRisk(e.target.value as ServerFunction["risk"]); markDirty(); }}>
              {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <label className="flex items-end gap-2 pb-2">
            <Toggle checked={approval} onChange={(v) => { setApproval(v); markDirty(); }} ariaLabel="Require approval" />
            <span className="text-sm text-ink-700">Require human approval{fn.requiresApproval && !approval ? " (inherited from wrapped tool)" : ""}</span>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SchemaEditor title="Input schema" fields={inputSchema} onChange={(f) => { setInputSchema(f); markDirty(); }} />
          <SchemaEditor title="Output schema" fields={outputSchema} onChange={(f) => { setOutputSchema(f); markDirty(); }} />
        </div>

        {fn.lastTest && (
          <div className={cn("rounded-xl border px-3 py-2 text-xs", fn.lastTest.ok ? "bg-sage-50 border-sage-200 text-sage-700" : "bg-coral-50 border-coral-200 text-coral-700")}>
            <Icon name={fn.lastTest.ok ? "CircleCheck" : "CircleX"} size={12} className="mr-1 inline" />
            Last test {fn.lastTest.ok ? "passed" : "failed"} {relativeTime(new Date(fn.lastTest.at).toISOString())}
            {!fn.lastTest.ok && fn.lastTest.error ? ` — ${fn.lastTest.error}` : ""}
          </div>
        )}
      </div>

      {showTest && (
        <Modal open onClose={() => setShowTest(false)} title={`Test — ${fn.name}`} icon="Play" size="lg">
          <TestFunctionPanel fn={fn} onTested={(u) => onSaved(u)} />
        </Modal>
      )}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete function?" icon="Trash2"
        footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={del}><Icon name="Trash2" size={15} /> Delete</Button></>}>
        <p className="text-sm text-ink-600">Permanently delete <strong>{name}</strong>? Skills/agents that reference it will lose this capability. This cannot be undone.</p>
      </Modal>
      {showVersions && <VersionsDrawer fnId={fn.id} currentVersion={fn.version} onRollback={() => { /* parent reload */ }} onClose={() => setShowVersions(false)} />}
    </Card>
  );
}

/* ============================================================
   NEW FUNCTION FORM (supports prefill from a skill's missing capability)
   ============================================================ */
function NewFunctionForm({ prefill, onCreate, onCancel }: {
  prefill?: { name?: string; description?: string; type?: FunctionType };
  onCreate: (fn: ServerFunction) => void; onCancel: () => void;
}) {
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(prefill?.name ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [type, setType] = useState<FunctionType>(prefill?.type ?? "connector_api");
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  // Item 13: an AI-drafted schema captured here and passed straight through on create,
  // so the new function starts pre-populated (still a draft awaiting a real test), not blank.
  const [draftedSchema, setDraftedSchema] = useState<{ input_schema?: unknown[]; output_schema?: unknown[]; action?: string; risk?: string; approval_required?: boolean } | null>(null);

  // Auto-draft when opened from a missing-capability prompt (there's a real description).
  useEffect(() => {
    if (!prefill?.description) return;
    let alive = true;
    setDrafting(true);
    void backend.draftFunction(prefill.description).then((r) => {
      if (!alive) return;
      if (r.ok && r.draft) {
        setName((n) => n || r.draft!.name);
        setDescription(r.draft.description);
        setType(r.draft.type);
        setDraftedSchema({ input_schema: r.draft.input_schema, output_schema: r.draft.output_schema, action: r.draft.action, risk: r.draft.risk, approval_required: r.draft.approval_required });
      }
      setDrafting(false);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draftFromDescription = async () => {
    if (!description.trim()) return;
    setDrafting(true);
    const r = await backend.draftFunction(description.trim());
    setDrafting(false);
    if (r.ok && r.draft) {
      setName(r.draft.name);
      setDescription(r.draft.description);
      setType(r.draft.type);
      setDraftedSchema({ input_schema: r.draft.input_schema, output_schema: r.draft.output_schema, action: r.draft.action, risk: r.draft.risk, approval_required: r.draft.approval_required });
      toast({ kind: r.fallback ? "info" : "success", title: r.fallback ? "Skeleton drafted" : "Draft ready", message: r.fallback ? (r.message ?? "Refine it below.") : "Fields pre-filled — review, then create." });
    } else toast({ kind: "error", title: "Couldn't draft", message: r.error ?? "Unknown error" });
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await backend.createFunction({ name, description, type, ...(draftedSchema ?? {}) } as Parameters<typeof backend.createFunction>[0]);
    setBusy(false);
    if (r.function) onCreate(r.function);
    else toast({ kind: "error", title: "Create failed", message: r.error ?? "Unknown error" });
  };

  return (
    <Modal open onClose={onCancel} title="New function" icon="FunctionSquare"
      footer={<><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button variant="ember" disabled={!name.trim() || busy} onClick={create}>{busy ? <><Icon name="Loader2" size={15} className="animate-spin" /> Creating…</> : <><Icon name="Plus" size={15} /> Create</>}</Button></>}>
      <div className="space-y-3">
        {prefill?.description && <div className="rounded-xl bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-700"><Icon name="Sparkles" size={12} className="mr-1 inline" /> {drafting ? "Drafting a starting definition from the missing capability…" : "Pre-filled from a skill's missing capability. Review the drafted type + schema, then test it to make it available."}</div>}
        <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Recent inbox digest" /></Field>
        <Field label="Description"><TextArea value={description} onChange={(e) => { setDescription(e.target.value); setDraftedSchema(null); }} placeholder="What this function does and what it calls." /></Field>
        <Button size="sm" variant="secondary" disabled={!description.trim() || drafting} onClick={draftFromDescription}>
          {drafting ? <><Icon name="Loader2" size={13} className="animate-spin" /> Drafting…</> : <><Icon name="Sparkles" size={13} /> Draft schema with AI</>}
        </Button>
        {draftedSchema && (
          <div className="rounded-xl border border-sage-200 bg-sage-50 px-3 py-2 text-xs text-sage-700">
            <Icon name="CheckCircle2" size={12} className="mr-1 inline" /> Drafted: {draftedSchema.action} · {draftedSchema.risk} risk{draftedSchema.approval_required ? " · asks approval" : ""} · {(draftedSchema.input_schema ?? []).length} input field(s). You can adjust everything after creating.
          </div>
        )}
        <Field label="Type" hint={TYPE_META[type]?.blurb}>
          <Select value={type} onChange={(e) => setType(e.target.value as FunctionType)}>
            {(Object.keys(TYPE_META) as FunctionType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

/* ============================================================
   ROOT SCREEN
   ============================================================ */
export function FunctionBuilder() {
  const params = useStore((s) => s.route.params);
  const navigate = useStore((s) => s.navigate);
  const [functions, setFunctions] = useState<ServerFunction[]>([]);
  const [catalog, setCatalog] = useState<ToolCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [prefill, setPrefill] = useState<{ name?: string; description?: string } | undefined>(undefined);

  const load = useCallback(async () => {
    const [fns, cat] = await Promise.all([backend.functions(), backend.toolCatalog()]);
    setFunctions(fns);
    setCatalog(cat.tools);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Deep-link from a skill's "create missing function" flow → open prefilled form.
  useEffect(() => {
    if (params?.create === "1") {
      setPrefill({ name: params.name, description: params.description });
      setShowNew(true);
      navigate("functions"); // clear params so it doesn't re-open on re-render
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.create]);

  const sel = useMemo(() => functions.find((f) => f.id === selId) ?? null, [functions, selId]);

  const handleSaved = (updated: ServerFunction) => {
    setFunctions((prev) => (prev.some((f) => f.id === updated.id) ? prev.map((f) => f.id === updated.id ? updated : f) : [updated, ...prev]));
    setSelId(updated.id);
  };
  const handleDeleted = () => { setSelId(null); load(); };
  const handleNew = (fn: ServerFunction) => { setShowNew(false); setPrefill(undefined); setFunctions((prev) => [fn, ...prev]); setSelId(fn.id); };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Functions" subtitle="Executable capabilities your agents and skills call. A function only becomes available after a real passing test — no mock success." icon="FunctionSquare" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <FunctionList functions={functions} selId={selId} onSelect={setSelId} onNew={() => { setPrefill(undefined); setShowNew(true); }} loading={loading} />
        <div>
          {sel
            ? <FunctionEditor fn={sel} catalog={catalog} functions={functions} onSaved={handleSaved} onDeleted={handleDeleted} />
            : <EmptyState icon="FunctionSquare" title="Select a function" message="Pick a function to configure and test it, or create a new one." />}
        </div>
      </div>
      {showNew && <NewFunctionForm prefill={prefill} onCreate={handleNew} onCancel={() => { setShowNew(false); setPrefill(undefined); }} />}
    </div>
  );
}
