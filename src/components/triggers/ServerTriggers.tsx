import { useCallback, useEffect, useState } from "react";
import { backend, type ServerTrigger, type ServerAgent, type ServerSkill, type TriggerType } from "@/connectors/api";
import { Card, Button, IconButton, Badge, Modal, Field, TextInput, Select, Toggle, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/cn";
import { relativeTime, fmtDateTime } from "@/lib/dates";
import { useStore } from "@/store/useStore";

const TYPE_META: Record<TriggerType, { label: string; icon: string; blurb: string }> = {
  schedule: { label: "Schedule (once)", icon: "CalendarClock", blurb: "Fires once at a set time." },
  recurring: { label: "Recurring", icon: "Repeat", blurb: "Fires on a fixed interval." },
  webhook: { label: "Webhook", icon: "Webhook", blurb: "Fires on a validated inbound POST." },
  connector_event: { label: "Connector event", icon: "Rss", blurb: "Fires when a connector reports new data." },
  manual: { label: "Manual", icon: "Hand", blurb: "Fires only when you run it." },
};
const INTERVALS = [
  { label: "Every 5 minutes", ms: 5 * 60_000 },
  { label: "Every 15 minutes", ms: 15 * 60_000 },
  { label: "Hourly", ms: 60 * 60_000 },
  { label: "Daily", ms: 24 * 60 * 60_000 },
];

// Terminal outcomes only (ISS-009): the server now settles lastStatus to completed /
// failed / expired / waiting_for_approval instead of leaving a permanent "started".
function statusColor(s: string | null): "sage" | "amber" | "coral" | "sky" | "gray" {
  if (!s) return "gray";
  if (s.startsWith("error") || s === "failed" || s === "expired" || s === "cancelled") return "coral";
  if (s === "completed" || s === "succeeded") return "sage";
  if (s.startsWith("waiting")) return "amber";
  return "sky"; // an older/never-fired record — not "started" read as success anymore
}
function statusLabel(s: string): string {
  return s.replace(/^error:/, "").replace(/_/g, " ");
}

// The server now resolves a human schedule plus anchor/tzSource alongside the raw
// fields (WP-002/WP-006 — see server/triggers.mjs publicTrigger). The shared
// ServerTrigger type predates that addition, so it's widened defensively here
// rather than trusted blindly; a light client fallback covers any record an older
// server hasn't stamped yet. Never render raw intervalMs.
type ServerTriggerX = ServerTrigger & { scheduleText?: string; anchor?: string | null; tzSource?: "household" | "server" | null };
function fallbackScheduleText(t: ServerTriggerX): string {
  if (t.type === "recurring" && t.intervalMs) {
    const m = Math.round(t.intervalMs / 60_000);
    if (m % 1440 === 0) return m === 1440 ? "Daily" : `Every ${m / 1440} days`;
    if (m % 60 === 0) return m === 60 ? "Hourly" : `Every ${m / 60} hours`;
    return `Every ${m} min`;
  }
  if (t.type === "schedule" && t.nextRunAt) return `Once · ${new Date(t.nextRunAt).toLocaleString()}`;
  const labels: Record<string, string> = { webhook: "On webhook", connector_event: "On new data", manual: "Manual only" };
  return labels[t.type] ?? "Manual only";
}

export function ServerTriggersPanel() {
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);
  const [triggers, setTriggers] = useState<ServerTriggerX[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => { setTriggers(await backend.triggers()); setLoading(false); }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (t: ServerTrigger) => {
    setBusyId(t.id);
    const r = await backend.updateTrigger(t.id, { enabled: !t.enabled });
    if (r.trigger) setTriggers((prev) => prev.map((x) => x.id === t.id ? r.trigger! : x));
    setBusyId(null);
  };
  const fire = async (t: ServerTrigger) => {
    setBusyId(t.id);
    const r = await backend.fireTrigger(t.id);
    setBusyId(null);
    if (r.ok) { toast({ kind: "success", title: "Trigger fired", message: "Run started — opening the Live monitor." }); navigate("automations", { tab: "monitor" }); }
    else toast({ kind: "error", title: "Fire failed", message: r.message ?? r.error ?? "Could not fire trigger." });
    void load();
  };
  const del = async (t: ServerTrigger) => {
    setBusyId(t.id);
    await backend.deleteTrigger(t.id);
    setTriggers((prev) => prev.filter((x) => x.id !== t.id));
    setBusyId(null);
  };
  const copyWebhook = (t: ServerTrigger) => {
    const url = `${location.origin}${t.webhookPath}`;
    void navigator.clipboard?.writeText(url);
    toast({ kind: "success", title: "Webhook URL copied", message: url });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-500">Real server-side triggers — they fire durable runs through the canonical runtime with <strong>no browser open</strong>. Gated steps still pause for approval.</p>
        <Button size="sm" variant="ember" onClick={() => setShowNew(true)}><Icon name="Plus" size={14} /> New trigger</Button>
      </div>

      {loading && <div className="flex items-center gap-2 text-sm text-ink-400"><Icon name="Loader2" size={14} className="animate-spin" /> Loading…</div>}
      {!loading && !triggers.length && <EmptyState icon="Zap" title="No server triggers yet" message="Create a schedule, recurring, webhook, or connector-event trigger that runs an agent or skill automatically." action={<Button size="sm" variant="ember" onClick={() => setShowNew(true)}>New trigger</Button>} />}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {triggers.map((t) => (
          <Card key={t.id} className="card-pad">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink-800"><Icon name={TYPE_META[t.type]?.icon ?? "Zap"} size={14} /> {t.name}</p>
                <p className="text-[11px] text-ink-400">{TYPE_META[t.type]?.label ?? t.type} · → {t.target.kind === "skill" ? `skill ${t.target.skillId}` : `agent ${t.target.agentId ?? "default"}`}</p>
              </div>
              <Toggle checked={t.enabled} onChange={() => toggle(t)} ariaLabel="Enabled" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-400">
              {/* Human schedule text from the server — never the raw intervalMs. */}
              <span className="flex items-center gap-1"><Icon name="Clock" size={11} /> {t.scheduleText ?? fallbackScheduleText(t)}</span>
              {t.nextRunAt && t.enabled && <span className="flex items-center gap-1"><Icon name="ArrowRight" size={11} /> next {relativeTime(new Date(t.nextRunAt).toISOString())}</span>}
              {t.fireCount > 0 && <span className="flex items-center gap-1"><Icon name="Activity" size={11} /> fired {t.fireCount}×</span>}
              {t.lastStatus && <Badge color={statusColor(t.lastStatus)}>{statusLabel(t.lastStatus)}</Badge>}
            </div>
            {t.tzSource === "server" && (
              <p className="mt-1.5 flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                <Icon name="TriangleAlert" size={11} /> Household time zone isn't set — this schedule uses the server's time zone instead.
              </p>
            )}
            {t.lastFiredAt && (
              <p className="mt-1 text-[11px] text-ink-400">
                Last fired {fmtDateTime(new Date(t.lastFiredAt).toISOString())}
                {t.lastRunId && <button className="ml-1 font-medium text-ink-600 underline" onClick={() => navigate("automations", { tab: "monitor" })}>view run</button>}
              </p>
            )}
            <div className="mt-3 flex items-center gap-1 border-t border-ink-900/[0.06] pt-2.5">
              <Button size="sm" variant="secondary" disabled={busyId === t.id} onClick={() => fire(t)}><Icon name="Play" size={13} /> Fire now</Button>
              {t.type === "webhook" && <IconButton icon="Link" label="Copy webhook URL" onClick={() => copyWebhook(t)} />}
              <IconButton icon="Trash2" label="Delete trigger" className="ml-auto" onClick={() => del(t)} />
            </div>
          </Card>
        ))}
      </div>

      {showNew && <NewTriggerModal onClose={() => setShowNew(false)} onCreated={(t) => { setShowNew(false); setTriggers((prev) => [t, ...prev]); }} />}
    </div>
  );
}

function NewTriggerModal({ onClose, onCreated }: { onClose: () => void; onCreated: (t: ServerTrigger) => void }) {
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState("");
  const [type, setType] = useState<TriggerType>("recurring");
  const [intervalMs, setIntervalMs] = useState(INTERVALS[1].ms);
  const [fireSoon, setFireSoon] = useState(true);
  const [targetKind, setTargetKind] = useState<"agent" | "skill">("skill");
  const [agentId, setAgentId] = useState("");
  const [skillId, setSkillId] = useState("");
  const [connectorId, setConnectorId] = useState("rss");
  const [secret, setSecret] = useState("");
  const [agents, setAgents] = useState<ServerAgent[]>([]);
  const [skills, setSkills] = useState<ServerSkill[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [a, s] = await Promise.all([backend.agents(), backend.skills()]);
      setAgents(a); setSkills(s);
      if (s[0]) setSkillId(s[0].id);
      if (a[0]) setAgentId(a[0].id);
    })();
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const body: Parameters<typeof backend.createTrigger>[0] = {
      name: name.trim(), type,
      target: { kind: targetKind, agentId: targetKind === "agent" ? agentId : null, skillId: targetKind === "skill" ? skillId : null },
    };
    if (type === "recurring") { body.intervalMs = intervalMs; if (fireSoon) body.runAt = Date.now(); }
    if (type === "schedule") body.runAt = Date.now() + 60_000; // default: one minute out
    if (type === "connector_event") { body.connectorId = connectorId; body.event = "new_data"; }
    if (type === "webhook" && secret.trim()) body.secret = secret.trim();
    const r = await backend.createTrigger(body);
    setBusy(false);
    if (r.trigger) onCreated(r.trigger);
    else toast({ kind: "error", title: "Create failed", message: r.error ?? "Unknown error" });
  };

  const targetValid = targetKind === "skill" ? !!skillId : !!agentId;

  return (
    <Modal open onClose={onClose} title="New server trigger" icon="Zap" size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="ember" disabled={!name.trim() || !targetValid || busy} onClick={create}>{busy ? <><Icon name="Loader2" size={15} className="animate-spin" /> Creating…</> : <><Icon name="Plus" size={15} /> Create trigger</>}</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Morning briefing at 7am" /></Field>
        <Field label="Type" hint={TYPE_META[type]?.blurb}>
          <Select value={type} onChange={(e) => setType(e.target.value as TriggerType)}>
            {(Object.keys(TYPE_META) as TriggerType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
          </Select>
        </Field>

        {type === "recurring" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Interval"><Select value={String(intervalMs)} onChange={(e) => setIntervalMs(Number(e.target.value))}>{INTERVALS.map((i) => <option key={i.ms} value={i.ms}>{i.label}</option>)}</Select></Field>
            <label className="flex items-end gap-2 pb-2"><Toggle checked={fireSoon} onChange={setFireSoon} ariaLabel="Fire on next tick" /><span className="text-sm text-ink-700">Fire on the next tick</span></label>
          </div>
        )}
        {type === "connector_event" && (
          <Field label="Connector" hint="Fires when this connector's poll returns new data."><Select value={connectorId} onChange={(e) => setConnectorId(e.target.value)}><option value="rss">RSS / Feed</option><option value="weather">Weather</option></Select></Field>
        )}
        {type === "webhook" && (
          <Field label="Signing secret (recommended)" hint="HMAC-SHA256 verifies inbound POSTs. The webhook URL appears on the trigger card after creation."><TextInput type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="whsec_…" /></Field>
        )}

        <div className="rounded-2xl border border-ink-900/[0.08] bg-surface-rim p-3">
          <p className="mb-2 text-sm font-semibold text-ink-700">What runs</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target"><Select value={targetKind} onChange={(e) => setTargetKind(e.target.value as "agent" | "skill")}><option value="skill">Skill</option><option value="agent">Agent</option></Select></Field>
            {targetKind === "skill"
              ? <Field label="Skill"><Select value={skillId} onChange={(e) => setSkillId(e.target.value)}>{skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              : <Field label="Agent"><Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
          </div>
          <p className="mt-1 text-[11px] text-ink-400">Runs through the canonical executor — its approval gate and the agent's permitted∩available policy still apply.</p>
        </div>
      </div>
    </Modal>
  );
}
