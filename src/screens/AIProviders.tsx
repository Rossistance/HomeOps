import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { Button, Card, Field, TextInput, Badge, Select } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { backend, type AIProvider, type AIHealth } from "@/connectors/api";

/**
 * Real AI provider control panel. Cloud providers take a single secure key entry;
 * local providers (Ollama / LM Studio) discover models over their localhost APIs.
 * Health performs a real reachability check; "Send test message" makes a real call.
 */
export function AIProvidersPanel() {
  const toast = useStore((s) => s.toast);
  const canAdmin = useStore((s) => s.canAccess("settings"));
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [forms, setForms] = useState<Record<string, { apiKey: string; baseUrl: string; model: string }>>({});
  const [health, setHealth] = useState<Record<string, AIHealth>>({});
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [testOut, setTestOut] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const list = await backend.aiProviders();
    setProviders(list);
    setForms((prev) => {
      const next = { ...prev };
      for (const p of list) if (!next[p.id]) next[p.id] = { apiKey: "", baseUrl: p.baseUrl || p.defaultBaseUrl, model: p.model || p.defaultModel };
      return next;
    });
  };
  useEffect(() => { void load(); }, []);

  const save = async (p: AIProvider) => {
    setBusy(p.id);
    const f = forms[p.id];
    const r = await backend.aiSaveProvider(p.id, { apiKey: f.apiKey || undefined, baseUrl: f.baseUrl, model: f.model });
    setBusy(null);
    if (r.provider) { toast({ kind: "success", title: `${p.name} saved` }); setForms((s) => ({ ...s, [p.id]: { ...s[p.id], apiKey: "" } })); await load(); }
    else toast({ kind: "error", title: "Could not save", message: r.error === "insufficient_role" ? "Admins only." : r.error });
  };
  const check = async (p: AIProvider) => {
    setBusy(p.id);
    const h = await backend.aiHealth(p.id);
    setHealth((s) => ({ ...s, [p.id]: h }));
    if (h.ok && h.models) setModels((s) => ({ ...s, [p.id]: h.models! }));
    setBusy(null);
    // A keyOptional provider (LM Studio) that fails with an auth-shaped error carries a
    // `hint` naming the token requirement — lead with that over the raw provider message.
    toast({ kind: h.ok ? "success" : "warn", title: h.ok ? `${p.name} reachable` : `${p.name}: ${h.status ?? "unreachable"}`, message: h.ok ? `${h.modelCount ?? 0} models · ${h.latencyMs ?? 0}ms` : (h.hint || h.message) });
  };
  const discover = async (p: AIProvider) => {
    setBusy(p.id);
    const r = await backend.aiModels(p.id);
    setBusy(null);
    if (r.ok && r.models?.length) { setModels((s) => ({ ...s, [p.id]: r.models! })); toast({ kind: "success", title: `${r.models.length} models`, message: p.name }); }
    else toast({ kind: "warn", title: "No models found", message: r.error ?? "Is the local server running?" });
  };
  const test = async (p: AIProvider) => {
    setBusy(p.id);
    const r = await backend.aiChat({ providerId: p.id, messages: [{ role: "user", content: "Reply with a friendly 6-word hello for a family app." }], model: forms[p.id]?.model || undefined });
    setBusy(null);
    setTestOut((s) => ({ ...s, [p.id]: { ok: r.ok, text: r.ok ? r.text ?? "" : r.message ?? r.error ?? "error" } }));
  };
  const setActive = async (p: AIProvider) => { await backend.aiSetActive(p.id); await load(); toast({ kind: "success", title: `${p.name} is the active model` }); };
  const revoke = async (p: AIProvider) => { await backend.aiRevokeProvider(p.id); await load(); toast({ kind: "info", title: `${p.name} disconnected` }); };

  return (
    <div className="space-y-3.5">
      <p className="text-sm leading-relaxed text-ink-500">Connect a real model provider. Cloud keys are stored only in the backend vault. Local providers run on your machine and are discovered over their localhost APIs.</p>
      {!canAdmin && <p className="rounded-2xl border border-amber-200/70 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-700">Only an Adult Admin or Owner can change provider configuration.</p>}
      <div className="stagger space-y-3.5">
      {providers.map((p, i) => {
        const f = forms[p.id] ?? { apiKey: "", baseUrl: p.defaultBaseUrl, model: p.defaultModel };
        const h = health[p.id];
        const ms = models[p.id];
        const out = testOut[p.id];
        // Truthful readiness (P1.3): "configured" = set up; "healthy" = verified reachable;
        // both are usable/selectable. "unreachable" = set up but a probe failed;
        // "needs_health_check" = local default URL only; "not_configured" = missing key/URL.
        const usable = p.readiness === "configured" || p.readiness === "healthy";
        const rb = ({
          healthy: { color: "sage" as const, label: "Reachable" },
          configured: { color: "sage" as const, label: "Configured" },
          unreachable: { color: "amber" as const, label: "Unreachable" },
          needs_health_check: { color: "sky" as const, label: "Test to verify" },
          not_configured: { color: "amber" as const, label: "Not configured" },
        } as const)[p.readiness as string] ?? { color: "amber" as const, label: "Not configured" };
        const configuredish = usable || p.readiness === "unreachable"; // something is set → can disconnect
        return (
          <div key={p.id} style={{ ["--i" as string]: i }} className={`card card-pad ${p.active ? "border-ember-200" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-100 text-ink-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><Icon name={p.local ? "MonitorSmartphone" : "Sparkles"} size={16} /></span>
              <span className="font-display text-base font-semibold text-ink-900">{p.name}</span>
              <Badge color={p.local ? "sky" : "gray"}>{p.local ? "local" : "cloud"}</Badge>
              <Badge color={rb.color}>{rb.label}</Badge>
              {p.active && <Badge color="sage"><Icon name="Check" size={11} /> Active</Badge>}
              {h && <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${h.ok ? "text-sage-600" : "text-amber-600"}`}><span className={`h-1.5 w-1.5 rounded-full ${h.ok ? "bg-sage-500 animate-soft-pulse" : "bg-amber-500"}`} />{h.ok ? `reachable · ${h.modelCount ?? 0} models` : `${h.status ?? "unreachable"}`}</span>}
            </div>
            <p className="mt-2 text-xs text-ink-500">{p.docs}</p>

            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {(p.needsKey || p.keyOptional) && (
                <Field label={p.keyOptional ? `API token (optional)${p.keySet ? " — saved" : ""}` : `API key${p.keySet ? " (saved)" : ""}`} className="sm:col-span-2">
                  <TextInput
                    type="password"
                    value={f.apiKey}
                    disabled={!canAdmin}
                    placeholder={p.keySet ? "•••••••• saved — leave blank to keep" : p.keyOptional ? "Only needed if your local server requires one" : "Paste your API key"}
                    onChange={(e) => setForms((s) => ({ ...s, [p.id]: { ...f, apiKey: e.target.value } }))}
                  />
                  {/* keyOptional providers keep needsKey:false — a bare local server with
                      no auth must keep working with this field blank. The wording differs:
                      LM Studio's token lives in its own Developer menu; Ollama's key only
                      matters for ollama.com cloud or an auth-protected remote. */}
                  {p.keyOptional && (
                    <p className="mt-1 text-xs text-ink-400">
                      {p.id === "ollama"
                        ? "Only needed for ollama.com cloud or an auth-protected remote Ollama (keys: ollama.com/settings/keys). Leave blank for a plain local server."
                        : "Newer LM Studio builds require an API token (LM Studio → Developer → API token). Leave blank if yours doesn't ask for one."}
                    </p>
                  )}
                </Field>
              )}
              {(p.local || p.needsBaseUrl) && (
                <Field label="Base URL">
                  <TextInput value={f.baseUrl} disabled={!canAdmin} placeholder={p.defaultBaseUrl} onChange={(e) => setForms((s) => ({ ...s, [p.id]: { ...f, baseUrl: e.target.value } }))} />
                </Field>
              )}
              <Field label="Model">
                {ms && ms.length ? (
                  <Select value={f.model} disabled={!canAdmin} onChange={(e) => setForms((s) => ({ ...s, [p.id]: { ...f, model: e.target.value } }))}>
                    <option value="">(auto)</option>
                    {ms.map((m) => <option key={m} value={m}>{m}</option>)}
                  </Select>
                ) : (
                  <TextInput value={f.model} disabled={!canAdmin} placeholder={p.defaultModel || "model id"} onChange={(e) => setForms((s) => ({ ...s, [p.id]: { ...f, model: e.target.value } }))} />
                )}
              </Field>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {canAdmin && <Button size="sm" variant="primary" disabled={busy === p.id} onClick={() => save(p)}><Icon name="Save" size={13} /> Save</Button>}
              <Button size="sm" variant="secondary" disabled={busy === p.id} onClick={() => check(p)}><Icon name="Activity" size={13} /> Test connection</Button>
              {p.local && <Button size="sm" variant="secondary" disabled={busy === p.id} onClick={() => discover(p)}><Icon name="Search" size={13} /> Discover models</Button>}
              <Button size="sm" variant="ghost" disabled={busy === p.id || !usable} onClick={() => test(p)}><Icon name="MessageSquare" size={13} /> Send test message</Button>
              {!p.active && usable && canAdmin && <Button size="sm" variant="ember" onClick={() => setActive(p)}><Icon name="Star" size={13} /> Set active</Button>}
              {configuredish && canAdmin && <Button size="sm" variant="ghost" onClick={() => revoke(p)}><Icon name="Ban" size={13} /> Disconnect</Button>}
            </div>
            {/* Persists past the toast: a failed health check against a keyOptional local
                provider (LM Studio) that looks like a missing/invalid token names the
                fix explicitly instead of leaving "unreachable" to be guessed at. */}
            {h && !h.ok && h.hint && <p className="mt-3 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-700">{h.hint}</p>}
            {out && <p className={`mt-3 rounded-2xl px-3.5 py-2.5 text-xs ${out.ok ? "bg-sage-50 text-ink-700" : "bg-coral-50 text-coral-700"}`}>{out.ok ? `“${out.text}”` : `✗ ${out.text}`}</p>}
          </div>
        );
      })}
      </div>
    </div>
  );
}
