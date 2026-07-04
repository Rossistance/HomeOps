import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { PageHeader, Card, Button, Badge, Drawer, Field, TextInput, TextArea, EmptyState, RiskBadge, ReadinessBadge, HealthDot } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { backend, isExecutable, type BackendConnector, type ConnectorTool, type ConnectorProvider, type ConnectedAccount, type ProviderTool, type ExecResult, type WebhookEvent } from "@/connectors/api";
import { relativeTime } from "@/lib/dates";

const PROVIDER_ICON: Record<string, string> = { google: "Mail", microsoft: "Mail", slack: "MessageSquare", dropbox: "FolderOpen", notion: "FileText", todoist: "CircleCheck", ticktick: "CircleCheck" };

export function Connections() {
  const connectors = useStore((s) => s.connectors);
  const providers = useStore((s) => s.providers);
  const session = useStore((s) => s.session);
  const backendOnline = useStore((s) => s.backendOnline);
  const health = useStore((s) => s.backendHealth);
  const loadBackend = useStore((s) => s.loadBackend);
  const params = useStore((s) => s.route.params);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  useEffect(() => { void loadBackend(); }, [loadBackend]);
  useEffect(() => { if (params?.id) { if (providers.some((p) => p.id === params.id)) setSelectedProvider(params.id); else setSelected(params.id); } }, [params?.id, providers]);

  const live = connectors.filter((c) => c.live);
  const setup = connectors.filter((c) => !c.live);
  const sel = connectors.find((c) => c.id === selected) ?? null;
  const selProvider = providers.find((p) => p.id === selectedProvider) ?? null;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Connections" subtitle="Connect your own accounts in one click. Each profile signs in to their own apps — tokens stay in the backend vault, never in the browser." icon="Plug" />

      <Card className="card-pad mb-5 flex flex-wrap items-center gap-x-6 gap-y-2">
        <HealthDot ok={backendOnline} label={<span className="text-sm">{backendOnline ? "Backend runtime online" : "Backend runtime offline"}</span>} />
        {health && <span className="text-xs text-ink-500">v{health.version} · {health.runtime}</span>}
        {session && <span className="text-xs text-ink-500">Connecting as <strong className="text-ink-700">{session.actorName}</strong></span>}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-ink-500"><Icon name="ShieldCheck" size={14} className="text-sage-500" /> One-click OAuth — you never enter client IDs or secrets.</span>
        {!backendOnline && <span className="w-full text-xs text-amber-600">Start the runtime with <code className="rounded bg-surface-sunken px-1">npm run dev</code> to connect accounts.</span>}
      </Card>

      {/* First-party OAuth provider platform — per-user connected accounts */}
      <div className="mb-7">
        <div className="mb-3"><p className="section-title">Your apps & accounts</p><p className="mt-1 text-xs text-ink-400">Sign in to your own Google, Microsoft, Slack, and more. Connections are personal to {session?.actorName ?? "you"}.</p></div>
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((p, i) => <ProviderCard key={p.id} provider={p} onOpen={() => setSelectedProvider(p.id)} index={i} />)}
          {providers.length === 0 && <p className="text-sm text-ink-400">No providers available{backendOnline ? "." : " — backend offline."}</p>}
        </div>
      </div>

      {/* Calendar subscriptions — the read-only "linked" calendar layer (ICS feeds) */}
      <CalendarSubscriptions />

      {/* Household utilities (no per-user sign-in) */}
      {connectors.length > 0 && (
        <>
          <Group title="Household utilities · live" hint="Shared connectors whose tools can run now — verified healthy" items={live} onOpen={setSelected} />
          <Group title="Household utilities · needs setup or attention" hint="Configure credentials/runtime — or a connector whose last health check failed" items={setup} onOpen={setSelected} />
        </>
      )}

      {selProvider && <ProviderDrawer provider={selProvider} onClose={() => setSelectedProvider(null)} />}
      {sel && <ConnectorDrawer connector={sel} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* -------- Calendar subscriptions (ICS feeds → read-only linked layer) -------- */
function CalendarSubscriptions() {
  const toast = useStore((s) => s.toast);
  const role = useStore((s) => s.session?.role);
  const accounts = useStore((s) => s.accounts);
  const hydrate = useStore((s) => s.hydrateFromServer);
  const canManage = role === "Owner" || role === "Adult Admin" || role === "Adult Member";
  const googleAccount = accounts.find((a) => a.provider === "google" && a.status !== "revoked");
  const [subs, setSubs] = useState<import("@/connectors/api").CalendarSubscription[]>([]);
  const [mode, setMode] = useState<"none" | "url" | "paste">("none");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [ics, setIcs] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => setSubs(await backend.calendarSubscriptions());
  useEffect(() => { void load(); }, []);

  const afterChange = async (label: string, detail?: string) => { await load(); await hydrate(); toast({ kind: "success", title: label, message: detail }); };

  const addUrl = async () => {
    if (!url.trim()) return; setBusy(true);
    const r = await backend.subscribeCalendar({ name: name.trim() || undefined, url: url.trim() });
    setBusy(false);
    if (r.subscription) { setUrl(""); setName(""); setMode("none"); await afterChange("Calendar subscribed", `${r.sync?.imported ?? 0} events imported`); }
    else toast({ kind: "error", title: "Couldn't subscribe", message: r.error === "insufficient_role" ? "Adults only." : r.error });
  };
  const addPaste = async () => {
    if (!ics.trim()) return; setBusy(true);
    const r = await backend.importIcs({ name: name.trim() || undefined, ics });
    setBusy(false);
    if (r.subscription) { setIcs(""); setName(""); setMode("none"); await afterChange("Calendar imported", `${r.sync?.imported ?? 0} events imported`); }
    else toast({ kind: "error", title: "Import failed", message: r.message ?? (r.error === "insufficient_role" ? "Adults only." : r.error) });
  };
  const connectGoogle = async () => {
    setBusy(true);
    const r = await backend.connectGoogleCalendar();
    setBusy(false);
    if (r.subscription && r.sync?.ok) await afterChange("Google Calendar connected", `${r.sync.imported ?? 0} events imported`);
    else toast({ kind: "warn", title: "Couldn't connect Google Calendar", message: r.message ?? (r.error === "connect_google_first" ? "Connect Google in Your apps first." : r.error === "needs_reconnect" ? "Reconnect Google and grant calendar access." : r.error) });
  };
  const sync = async (id: string) => { setBusy(true); const r = await backend.syncCalendar(id); setBusy(false); if (r.sync?.ok) await afterChange("Synced", `${r.sync.updated ?? 0} updated · ${r.sync.imported ?? 0} new`); else toast({ kind: "warn", title: "Sync failed", message: r.error }); };
  const remove = async (id: string) => { setBusy(true); const r = await backend.deleteCalendarSubscription(id); setBusy(false); if (r.ok) await afterChange("Removed", `${r.removedEvents ?? 0} events removed`); };

  return (
    <div className="mb-7">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div><p className="section-title">Subscribed calendars</p><p className="mt-1 text-xs text-ink-400">Add a school, sports, or holidays feed (.ics). Events appear read-only on your calendar — copy one to edit it.</p></div>
        {canManage && mode === "none" && (
          <div className="flex flex-wrap gap-2">
            {googleAccount
              ? <Button size="sm" variant="ember" disabled={busy} onClick={connectGoogle}><Icon name="Calendar" size={13} /> Connect Google Calendar</Button>
              : <span className="self-center text-xs text-ink-400">Connect Google above to pull your Google Calendar.</span>}
            <Button size="sm" variant="secondary" onClick={() => setMode("url")}><Icon name="Link" size={13} /> Add feed URL</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("paste")}><Icon name="ClipboardPaste" size={13} /> Paste .ics</Button>
          </div>
        )}
      </div>

      {mode === "url" && (
        <Card className="card-pad mb-3">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Field label="Name (optional)"><TextInput value={name} placeholder="Riverside School" onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Feed URL (.ics / webcal)"><TextInput value={url} placeholder="https://…/calendar.ics" onChange={(e) => setUrl(e.target.value)} /></Field>
          </div>
          <div className="mt-3 flex gap-2"><Button size="sm" variant="ember" disabled={busy || !url.trim()} onClick={addUrl}>{busy ? <Icon name="Loader2" size={13} className="animate-spin" /> : <Icon name="Plus" size={13} />} Subscribe</Button><Button size="sm" variant="ghost" onClick={() => setMode("none")}>Cancel</Button></div>
        </Card>
      )}
      {mode === "paste" && (
        <Card className="card-pad mb-3">
          <Field label="Name (optional)"><TextInput value={name} placeholder="Imported calendar" onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Paste the contents of an .ics file" className="mt-2"><TextArea value={ics} rows={5} placeholder="BEGIN:VCALENDAR…" onChange={(e) => setIcs(e.target.value)} /></Field>
          <div className="mt-3 flex gap-2"><Button size="sm" variant="ember" disabled={busy || !ics.trim()} onClick={addPaste}>{busy ? <Icon name="Loader2" size={13} className="animate-spin" /> : <Icon name="Download" size={13} />} Import</Button><Button size="sm" variant="ghost" onClick={() => setMode("none")}>Cancel</Button></div>
        </Card>
      )}

      {subs.length === 0 ? (
        mode === "none" && <p className="text-sm text-ink-400">No subscribed calendars yet.</p>
      ) : (
        <div className="stagger grid grid-cols-1 gap-3 md:grid-cols-2">
          {subs.map((s) => (
            <Card key={s.id} className="card-pad flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><Icon name="CalendarDays" size={16} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-900">{s.name}</p>
                <p className="truncate text-xs text-ink-400">{s.url ?? "Pasted .ics"} · {s.eventCount} events{s.lastSyncAt ? ` · synced ${relativeTime(new Date(s.lastSyncAt).toISOString())}` : ""}</p>
                {s.lastResult?.error && <p className="mt-0.5 text-xs text-coral-600">Last sync: {s.lastResult.error}</p>}
                {canManage && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => sync(s.id)}><Icon name="RefreshCw" size={12} /> Sync</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(s.id)}><Icon name="Trash2" size={12} /> Remove</Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------- Provider platform UI ----------------------- */
function ProviderCard({ provider: p, onOpen, index = 0 }: { provider: ConnectorProvider; onOpen: () => void; index?: number }) {
  const acct = p.accounts[0];
  const connected = p.accounts.some((a) => a.status === "connected");
  return (
    <Card className="card-pad flex flex-col" hover ariaLabel={`Open ${p.name}`} onClick={onOpen}>
      <div style={{ ["--i" as string]: index }} className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-sunken text-ink-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><Icon name={PROVIDER_ICON[p.id] ?? "Plug"} size={20} /></span>
        <div className="min-w-0 flex-1"><p className="truncate font-semibold text-ink-900">{p.name}</p><p className="truncate text-xs text-ink-500">{p.category}</p></div>
        <ProviderStatusBadge provider={p} />
      </div>
      {p.readiness === "not_configured_by_deployment" ? (
        <p className="mt-2 text-xs text-amber-600">Not configured by deployment</p>
      ) : connected ? (
        <p className="mt-2 truncate text-xs text-sage-700"><Icon name="CheckCircle" size={12} className="mr-1 inline" /> {acct?.displayName}</p>
      ) : (
        <p className="mt-2 text-xs text-ink-500">Not connected — sign in to enable {p.tools.length} tools.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-ink-900/[0.06] pt-3 text-xs text-ink-500">
        <span className="flex items-center gap-1"><Icon name="Wrench" size={12} /> {p.tools.length} tools</span>
        {p.accounts.length > 0 && <span className="flex items-center gap-1"><Icon name="UserCircle" size={12} /> {p.accounts.length} account{p.accounts.length === 1 ? "" : "s"}</span>}
        <span className="ml-auto"><Badge color="gray">OAuth</Badge></span>
      </div>
    </Card>
  );
}

function ProviderStatusBadge({ provider: p }: { provider: ConnectorProvider }) {
  if (p.readiness === "not_configured_by_deployment") return <Badge color="amber">Setup by admin</Badge>;
  const a = p.accounts[0];
  if (!a) return <Badge color="gray">Not connected</Badge>;
  if (a.status === "connected") return <Badge color="sage"><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sage-500" />Connected</Badge>;
  if (a.status === "degraded") return <Badge color="amber">Degraded</Badge>;
  if (a.status === "needs_reconnect") return <Badge color="coral">Reconnect</Badge>;
  return <Badge color="gray">{a.status}</Badge>;
}

function ProviderDrawer({ provider: p, onClose }: { provider: ConnectorProvider; onClose: () => void }) {
  const connect = useStore((s) => s.connectProvider);
  const revoke = useStore((s) => s.revokeAccount);
  const checkHealth = useStore((s) => s.checkAccountHealth);
  const providersLive = useStore((s) => s.providers);
  const redirectHint = `${(useStore.getState().backendHealth?.webhookBaseUrl ?? "http://localhost:8787")}/api/oauth/callback`;
  // Always read the freshest provider record (accounts update after connect).
  const live = providersLive.find((x) => x.id === p.id) ?? p;
  const configured = live.readiness === "configured";
  const hasAccount = live.accounts.some((a) => a.status === "connected" || a.status === "degraded");

  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={<span className="flex items-center gap-2"><Icon name={PROVIDER_ICON[p.id] ?? "Plug"} size={20} /> {p.name}</span>}>
      <div className="space-y-5">
        <p className="text-sm text-ink-600">{p.category}. Connect your own {p.name} account — sign-in happens on {p.name}'s site; HomeOps only receives a token, stored in the backend vault.</p>

        {!configured ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-semibold">Not configured by deployment</p>
            <p className="mt-1 text-xs">An administrator must set these environment variables on the server, then register <code className="rounded bg-surface-raised px-1">{redirectHint}</code> as the OAuth redirect URI:</p>
            <ul className="mt-2 space-y-0.5 text-xs">
              <li><code className="rounded bg-surface-raised px-1">{p.clientIdEnv}</code></li>
              <li><code className="rounded bg-surface-raised px-1">{p.clientSecretEnv}</code></li>
            </ul>
          </div>
        ) : (
          <section>
            <p className="section-title mb-2">Your accounts</p>
            <div className="space-y-2">
              {live.accounts.map((a) => <AccountRow key={a.id} account={a} onHealth={() => checkHealth(a.id)} onRevoke={() => revoke(a.id)} onReconnect={() => connect(p.id)} />)}
              {live.accounts.length === 0 && <p className="text-xs text-ink-400">No accounts connected yet.</p>}
            </div>
            <Button className="mt-3" variant="ember" onClick={() => connect(p.id)}><Icon name="LogIn" size={15} /> Connect {p.name}{live.accounts.length ? " (another account)" : ""}</Button>
          </section>
        )}

        {/* Scopes */}
        <section>
          <p className="section-title mb-2">Permissions you'll grant</p>
          <div className="space-y-1.5">{p.scopes.map((s) => <div key={s.key} className="flex items-center gap-2 rounded-2xl border border-ink-900/[0.06] px-3 py-2 text-sm"><Icon name="ShieldCheck" size={14} className="text-ink-400" /><span className="flex-1 text-ink-700">{s.label}</span><RiskBadge level={s.risk as "Low" | "Medium" | "High" | "Sensitive"} /></div>)}</div>
        </section>

        {/* Tools */}
        <section>
          <p className="section-title mb-2">Tools</p>
          {!hasAccount && <p className="mb-2 rounded-2xl bg-surface-sunken/60 px-3 py-2 text-xs text-ink-500">Connect a {p.name} account to enable these tools.</p>}
          <div className="space-y-2">
            {p.tools.map((t) => <ProviderToolCard key={t.id} tool={t} provider={p.id} accountId={live.accounts[0]?.id} disabled={!hasAccount} />)}
          </div>
        </section>
      </div>
    </Drawer>
  );
}

function AccountRow({ account: a, onHealth, onRevoke, onReconnect }: { account: ConnectedAccount; onHealth: () => void; onRevoke: () => void; onReconnect: () => void }) {
  const ok = a.lastHealthOk;
  return (
    <div className="well flex flex-wrap items-center gap-2 p-3">
      <span className={`h-2 w-2 shrink-0 rounded-full ${a.status === "connected" ? "bg-sage-500" : a.status === "degraded" ? "bg-amber-500" : "bg-coral-500"}`} />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink-800">{a.displayName}</p><p className="text-xs text-ink-500">{a.status}{a.lastHealthAt ? ` · checked ${relativeTime(a.lastHealthAt)}${ok === false ? " · failed" : ""}` : ""}</p></div>
      {a.status === "needs_reconnect" ? <Button size="sm" variant="primary" onClick={onReconnect}><Icon name="RefreshCw" size={13} /> Reconnect</Button> : <Button size="sm" variant="secondary" onClick={onHealth}><Icon name="Activity" size={13} /> Check</Button>}
      <Button size="sm" variant="ghost" onClick={onRevoke}><Icon name="Ban" size={13} /> Disconnect</Button>
    </div>
  );
}

function ProviderToolCard({ tool, provider, accountId, disabled }: { tool: ProviderTool; provider: string; accountId?: string; disabled: boolean }) {
  const runTool = useStore((s) => s.runTool);
  const [vals, setVals] = useState<Record<string, string>>(() => { const i: Record<string, string> = {}; for (const f of tool.inputs ?? []) i[f.key] = f.default ?? ""; return i; });
  const [res, setRes] = useState<ExecResult | null>(null);
  const [busy, setBusy] = useState(false);
  const missing = (tool.inputs ?? []).filter((f) => f.required && !(vals[f.key] ?? "").trim()).map((f) => f.label);
  const run = async () => {
    setBusy(true);
    const input: Record<string, unknown> = {};
    for (const f of tool.inputs ?? []) { const v = (vals[f.key] ?? "").trim(); if (v) input[f.key] = v; }
    const r = await runTool(tool.id, input, { accountId });
    setRes(r); setBusy(false);
  };
  return (
    <div className="well p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="text-sm font-medium text-ink-800">{tool.name}</p><p className="text-xs text-ink-500">{tool.action} · scopes: {tool.scopes.join(", ") || "—"}</p></div>
        <div className="flex shrink-0 items-center gap-1.5"><RiskBadge level={tool.risk} />{tool.requiresApproval && <Badge color="coral"><Icon name="ShieldAlert" size={11} /> approval</Badge>}</div>
      </div>
      {!disabled && (tool.inputs?.length ?? 0) > 0 && (
        <div className="mt-3 space-y-2.5">
          {tool.inputs.map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
              {f.type === "textarea" ? <TextArea value={vals[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setVals((p) => ({ ...p, [f.key]: e.target.value }))} /> : <TextInput value={vals[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setVals((p) => ({ ...p, [f.key]: e.target.value }))} />}
            </Field>
          ))}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={tool.requiresApproval ? "secondary" : "primary"} disabled={disabled || busy || missing.length > 0} onClick={run}>
          <Icon name={busy ? "Loader" : tool.requiresApproval ? "ShieldCheck" : "Play"} size={13} className={busy ? "animate-spin" : ""} /> {disabled ? "Connect to run" : tool.requiresApproval ? "Request approval & run" : "Run"}
        </Button>
        {missing.length > 0 && !disabled && <span className="text-xs text-amber-600">Enter: {missing.join(", ")}</span>}
      </div>
      {res && <div className="mt-2.5"><ToolResult toolId={tool.id} res={res} /></div>}
    </div>
  );
}

function Group({ title, hint, items, onOpen }: { title: string; hint: string; items: BackendConnector[]; onOpen: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="mb-7">
      <div className="mb-3"><p className="section-title">{title}</p><p className="mt-1 text-xs text-ink-400">{hint}</p></div>
      <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((c, i) => (
          <Card key={c.id} className="card-pad flex flex-col" hover onClick={() => onOpen(c.id)}>
            <div style={{ ["--i" as string]: i }} className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-sunken text-ink-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><Icon name={connectorIcon(c)} size={20} /></span>
              <div className="min-w-0 flex-1"><p className="truncate font-semibold text-ink-900">{c.name}</p><p className="truncate text-xs text-ink-500">{c.provider} · {c.category}</p></div>
              <ReadinessBadge readiness={c.readiness} />
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-ink-500">{c.description}</p>
            {c.health && c.health.ok === false && isExecutable(c.readiness) && (
              <p className="mt-2 flex items-center gap-1 text-xs text-amber-600"><Icon name="AlertTriangle" size={12} /> Configured, but last health check failed ({c.health.status}{c.health.error ? ` · ${c.health.error}` : ""})</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-ink-900/[0.06] pt-3 text-xs text-ink-500">
              <span className="flex items-center gap-1"><Icon name="Wrench" size={12} /> {c.tools.length} tools</span>
              {c.triggers.length > 0 && <span className="flex items-center gap-1"><Icon name="Zap" size={12} /> {c.triggers.length} triggers</span>}
              {c.health && <span className={`flex items-center gap-1 ${c.health.ok ? "text-sage-600" : "text-amber-600"}`}><span className={`h-1.5 w-1.5 rounded-full ${c.health.ok ? "bg-sage-500" : "bg-amber-500"}`} /> {c.health.ok ? "healthy" : "check failed"}</span>}
              <span className="ml-auto"><RiskBadge level={c.risk} /></span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function connectorIcon(c: BackendConnector): string {
  const map: Record<string, string> = { weather: "CloudSun", rss: "Rss", http: "Globe", gmail: "Mail", gcal: "Calendar", webhook: "Webhook", "files-local": "FolderOpen", browser: "MonitorSmartphone", sms: "MessageSquare" };
  return map[c.id] ?? "Plug";
}

// Legacy household-utility connectors (weather/rss/http/webhook/files/browser/sms).
// OAuth providers live in the first-party connector platform (ProviderDrawer), so
// this drawer never shows an OAuth client-id/secret form.
function ConnectorDrawer({ connector: c, onClose }: { connector: BackendConnector; onClose: () => void }) {
  const configure = useStore((s) => s.configureConnector);
  const revoke = useStore((s) => s.revokeConnector);
  const checkHealth = useStore((s) => s.checkConnectorHealth);
  const sendWebhookTest = useStore((s) => s.sendWebhookTest);
  const health = useStore((s) => s.backendHealth);

  const [form, setForm] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of c.configSchema) init[f.key] = f.type === "secret" ? "" : (c.config[f.key] && c.config[f.key] !== "(from environment)" ? c.config[f.key] : "");
    return init;
  });
  const [healthResult, setHealthResult] = useState<string | null>(null);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (c.id === "webhook") backend.webhookEvents("webhook").then(setEvents); }, [c.id]);

  const save = async () => { setBusy(true); await configure(c.id, form); setBusy(false); };
  const doHealth = async () => { const h = await checkHealth(c.id); setHealthResult(h.ok ? `Healthy · ${h.latencyMs ?? 0}ms` : `Failed · ${h.error ?? h.status ?? "error"}`); };
  const backendBase = health?.webhookBaseUrl ?? "http://localhost:8787";
  const webhookUrl = `${backendBase}${c.endpoint ?? ""}`;
  const configured = isExecutable(c.readiness);

  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={<span className="flex items-center gap-2"><Icon name={connectorIcon(c)} size={20} /> {c.name}</span>}
      footer={configured && c.runtime !== "client" ? <Button variant="danger" onClick={() => { revoke(c.id); onClose(); }}><Icon name="Ban" size={15} /> Revoke</Button> : <span className="text-xs text-ink-400">{c.runtime === "client" ? "Local-only connector" : "Configure to enable"}</span>}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <ReadinessBadge readiness={c.readiness} /><RiskBadge level={c.risk} /><Badge color="gray">{c.authType}</Badge><Badge color="gray">{c.runtime}</Badge>
        </div>
        <p className="text-sm text-ink-600">{c.description}</p>

        {/* Configuration (one-screen API key / settings for utility connectors) */}
        {c.configSchema.length > 0 && (
          <section>
            <p className="section-title mb-2">Configuration</p>
            <div className="space-y-3">
              {c.configSchema.map((f) => {
                const fromEnv = c.config[f.key] === "(from environment)";
                const secretSet = f.type === "secret" && c.config[f.key] === "••••••••";
                return (
                  <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} hint={f.env ? `Env: ${f.env}${fromEnv ? " (set)" : ""}` : undefined}>
                    <TextInput type={f.type === "secret" ? "password" : "text"} value={form[f.key]} placeholder={secretSet ? "•••••••• (saved — leave blank to keep)" : fromEnv ? "(provided by environment)" : f.placeholder ?? ""} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} />
                  </Field>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="primary" onClick={save} disabled={busy}><Icon name="Save" size={15} /> Save configuration</Button>
            </div>
          </section>
        )}

        {/* Tools */}
        {c.tools.length > 0 && (
          <section>
            <p className="section-title mb-2">Tools</p>
            <p className="mb-2 text-xs text-ink-400">Read tools run when configured. Write/send tools always create an approval request first — approving it executes the real action.</p>
            <div className="space-y-2">
              {c.tools.map((t) => <ToolCard key={t.id} tool={t} disabled={!configured && t.runtime !== "client"} />)}
            </div>
          </section>
        )}

        {/* Health */}
        {c.runtime === "backend" && (
          <section>
            <p className="section-title mb-2">Health</p>
            <div className="flex items-center gap-3">
              <Button size="sm" variant="secondary" onClick={doHealth}><Icon name="Activity" size={14} /> Run health check</Button>
              {healthResult && <span className="text-sm text-ink-600">{healthResult}</span>}
            </div>
          </section>
        )}

        {/* Webhook endpoint */}
        {c.id === "webhook" && (
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Inbound endpoint (real)</p>
            <code className="block break-all rounded-xl bg-ink-900 px-3 py-2 text-xs text-sage-100">POST {webhookUrl}</code>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={async () => { await sendWebhookTest({ type: "order.confirmed", description: "Camp deposit", amount: 120, date: new Date().toISOString().slice(0, 10) }); setEvents(await backend.webhookEvents("webhook")); }}><Icon name="Send" size={14} /> Send test event</Button>
            </div>
            {events.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs text-ink-400">Recent events ({events.length})</p>
                {events.slice(0, 5).map((e) => (
                  <div key={e.id} className="rounded-xl border border-ink-900/[0.06] px-3 py-1.5 text-xs text-ink-600"><span className="font-medium">{(e.payload as { description?: string; type?: string }).description ?? (e.payload as { type?: string }).type ?? "event"}</span> · {e.source} · {relativeTime(e.receivedAt)} {e.verified && <span className="text-sage-600">✓ verified</span>}</div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Triggers */}
        {c.triggers.length > 0 && (
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Triggers</p>
            <div className="space-y-1.5">{c.triggers.map((t) => <div key={t.id} className="flex items-center gap-2 rounded-xl border border-ink-900/[0.06] px-3 py-2 text-sm"><Icon name="Zap" size={14} className="text-ink-400" /><span className="font-medium text-ink-800">{t.name}</span><span className="text-xs text-ink-500">· {t.type} · {t.description}</span></div>)}</div>
          </section>
        )}
      </div>
    </Drawer>
  );
}

/* Collect a tool's typed input values, parsing json fields. */
function buildToolInput(tool: ConnectorTool, raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of tool.inputs ?? []) {
    const v = (raw[f.key] ?? "").trim();
    if (!v) continue;
    if (f.type === "json") { try { out[f.key] = JSON.parse(v); } catch { out[f.key] = v; } }
    else out[f.key] = v;
  }
  return out;
}

/* A single tool with its own input form, run button, and result rendering. */
function ToolCard({ tool, disabled }: { tool: ConnectorTool; disabled: boolean }) {
  const runTool = useStore((s) => s.runTool);
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of tool.inputs ?? []) init[f.key] = f.default ?? "";
    return init;
  });
  const [res, setRes] = useState<ExecResult | null>(null);
  const [busy, setBusy] = useState(false);
  const missing = (tool.inputs ?? []).filter((f) => f.required && !(vals[f.key] ?? "").trim()).map((f) => f.label);
  const run = async () => {
    setBusy(true);
    const r = await runTool(tool.id, buildToolInput(tool, vals));
    setRes(r);
    setBusy(false);
  };
  return (
    <div className="rounded-xl border border-ink-900/[0.06] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="text-sm font-medium text-ink-800">{tool.name}</p><p className="text-xs text-ink-500">{tool.description}</p></div>
        <div className="flex shrink-0 items-center gap-1.5"><RiskBadge level={tool.risk} />{tool.requiresApproval && <Badge color="coral"><Icon name="ShieldAlert" size={11} /> approval</Badge>}</div>
      </div>
      {(tool.inputs?.length ?? 0) > 0 && (
        <div className="mt-3 space-y-2.5">
          {tool.inputs!.map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
              {f.type === "textarea" || f.type === "json"
                ? <TextArea value={vals[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setVals((p) => ({ ...p, [f.key]: e.target.value }))} />
                : <TextInput value={vals[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setVals((p) => ({ ...p, [f.key]: e.target.value }))} />}
            </Field>
          ))}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={tool.requiresApproval ? "secondary" : "primary"} disabled={disabled || busy || missing.length > 0} onClick={run}>
          <Icon name={busy ? "Loader" : tool.requiresApproval ? "ShieldCheck" : "Play"} size={13} className={busy ? "animate-spin" : ""} /> {tool.requiresApproval ? "Request approval & run" : "Run"}
        </Button>
        <span className="text-xs text-ink-400">{tool.action}</span>
        {missing.length > 0 && <span className="text-xs text-amber-600">Enter: {missing.join(", ")}</span>}
      </div>
      {res && <div className="mt-2.5"><ToolResult toolId={tool.id} res={res} /></div>}
    </div>
  );
}

/* Honest, readable rendering of a real execution result. */
function ToolResult({ toolId, res }: { toolId: string; res: ExecResult }) {
  if (!res.ok) {
    if (res.error === "approval_required")
      return <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"><Icon name="ShieldAlert" size={12} className="mr-1 inline" /> Approval requested — open <strong>Messages → Approvals</strong> to approve. Approving sends the real action.</p>;
    return <p className="rounded-xl border border-coral-200 bg-coral-50 px-3 py-2 text-xs text-coral-700"><Icon name="XCircle" size={12} className="mr-1 inline" /> {res.error}{res.message ? ` — ${res.message}` : ""}</p>;
  }
  const r = res.result as Record<string, unknown> | undefined;
  if (toolId === "gmail.search" && Array.isArray((r as { messages?: unknown[] })?.messages)) {
    const msgs = (r as { messages: { id: string; subject?: string; from?: string; snippet?: string }[] }).messages;
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-sage-700"><Icon name="CheckCircle" size={12} className="mr-1 inline" /> {msgs.length} message{msgs.length === 1 ? "" : "s"} found</p>
        {msgs.length === 0 && <p className="text-xs text-ink-400">No messages matched that query.</p>}
        {msgs.map((m) => (
          <div key={m.id} className="rounded-xl border border-ink-900/[0.06] bg-surface-raised px-3 py-2">
            <p className="truncate text-sm font-medium text-ink-800">{m.subject || "(no subject)"}</p>
            <p className="truncate text-xs text-ink-500">{m.from}</p>
            {m.snippet && <p className="mt-0.5 line-clamp-2 text-xs text-ink-400">{m.snippet}</p>}
          </div>
        ))}
      </div>
    );
  }
  if (toolId === "calendar.list" && Array.isArray((r as { events?: unknown[] })?.events)) {
    const events = (r as { events: { summary?: string; start?: string; location?: string }[] }).events;
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-sage-700"><Icon name="CheckCircle" size={12} className="mr-1 inline" /> {events.length} upcoming event{events.length === 1 ? "" : "s"}</p>
        {events.map((e, i) => (
          <div key={i} className="rounded-xl border border-ink-900/[0.06] bg-surface-raised px-3 py-2 text-sm text-ink-700"><span className="font-medium">{e.summary || "(untitled)"}</span>{e.start && <span className="text-xs text-ink-500"> · {e.start}</span>}{e.location && <span className="text-xs text-ink-400"> · {e.location}</span>}</div>
        ))}
      </div>
    );
  }
  return <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-sunken px-3 py-2 font-mono text-xs text-ink-600">{JSON.stringify(r, null, 2)}</pre>;
}

// (Gmail is now a first-party connector-platform provider — see ProviderDrawer.
//  The old connector-config Gmail workflow was removed with the gmail/gcal
//  legacy connectors; OAuth client IDs/secrets are deployment env vars only.)
