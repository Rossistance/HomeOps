import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";
import { backend, isExecutable, type BackendJob, type AuditEvent } from "@/connectors/api";
import { Button, Card, Badge, EmptyState, RiskBadge, ReadinessBadge } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { relativeTime } from "@/lib/dates";
import { cn } from "@/lib/cn";

/** Real browser-automation boundary. Honest runtime status only — the backend
 *  reports an honest runtime status and a login-required handoff state. */
export function BrowserWorkflowsPanel() {
  const connectors = useStore((s) => s.connectors);
  const runTool = useStore((s) => s.runTool);
  const c = connectors.find((x) => x.id === "browser");
  const [session, setSession] = useState<{ ok: boolean; status?: string; message?: string } | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

  const start = async () => setSession(await backend.browserSession());
  const run = async (toolId: string) => {
    const r = await runTool(toolId, { url: "https://provider.example/portal" });
    setResults((p) => ({ ...p, [toolId]: r.ok ? "✓ executed" : `✗ ${r.error}: ${r.message ?? ""}` }));
  };

  if (!c) return <EmptyState icon="MonitorSmartphone" title="Browser connector unavailable" message="Backend runtime is offline." />;

  return (
    <div className="space-y-4">
      <Card className="card-pad">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-semibold text-ink-900">Browser automation</p>
          <ReadinessBadge readiness={c.readiness} />
        </div>
        <p className="text-sm text-ink-600">{c.description}</p>
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-600"><Icon name="ShieldAlert" size={14} className="mr-1 inline" /> We never ask for your password. Sign-in happens in the real runtime via a login handoff. High-risk steps (downloads, form submits) require approval.</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={start}><Icon name="PlayCircle" size={15} /> Start a session</Button>
          {c.configSchema[0]?.env && <span className="text-xs text-ink-400">Set <code className="rounded bg-sand-100 px-1">{c.configSchema[0].env}</code> to connect a runtime.</span>}
        </div>
        {session && (
          <div className={cn("mt-3 rounded-xl border px-3 py-2.5 text-sm", session.ok ? "border-sage-200 bg-sage-50 text-sage-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
            <p className="font-semibold">{session.ok ? "Session ready — login handoff" : "Runtime not connected"}</p>
            <p className="text-xs">{session.message}</p>
          </div>
        )}
      </Card>

      <Card className="card-pad">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Browser tools</p>
        <div className="space-y-2">
          {c.tools.map((t) => (
            <div key={t.id} className="rounded-xl border border-sand-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div><p className="text-sm font-medium text-ink-800">{t.name}</p><p className="text-xs text-ink-500">{t.description}</p></div>
                <div className="flex items-center gap-1.5"><RiskBadge level={t.risk} />{t.requiresApproval && <Badge color="coral">approval</Badge>}</div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant={t.requiresApproval ? "secondary" : "primary"} onClick={() => run(t.id)}><Icon name="Play" size={13} /> {t.requiresApproval ? "Request & run" : "Run"}</Button>
                {results[t.id] && <span className="font-mono text-xs text-ink-500">{results[t.id]}</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** Real background-job scheduler + audit boundary (server-side timers). */
export function BackgroundJobsPanel() {
  const [jobs, setJobs] = useState<BackendJob[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const connectors = useStore((s) => s.connectors);
  const refresh = async () => { setJobs(await backend.jobs()); setAudit(await backend.audit(30)); };
  useEffect(() => { void refresh(); }, []);

  const runNow = async (id: string) => { await backend.runJob(id); await refresh(); };
  const connName = (cid: string) => connectors.find((c) => c.id === cid)?.name ?? cid;

  return (
    <div className="space-y-4">
      <Card className="card-pad">
        <div className="mb-3 flex items-center justify-between"><p className="font-semibold text-ink-900">Scheduled background jobs</p><Button size="sm" variant="ghost" onClick={refresh}><Icon name="RefreshCw" size={14} /> Refresh</Button></div>
        {jobs.length === 0 ? <EmptyState icon="Clock" title="No jobs" message="Backend runtime is offline or has no scheduled jobs." /> : (
          <div className="space-y-2">
            {jobs.map((j) => {
              const c = connectors.find((x) => x.id === j.connectorId);
              const live = c ? isExecutable(c.readiness) : false;
              return (
                <div key={j.id} className="flex items-center justify-between gap-3 rounded-xl border border-sand-200 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-800">{j.name}</p>
                    <p className="text-xs text-ink-500">{connName(j.connectorId)} · every {Math.round(j.intervalMs / 60000)}m · {j.lastRun ? `last ${relativeTime(new Date(j.lastRun).toISOString())}` : "not yet run"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {c && <ReadinessBadge readiness={c.readiness} />}
                    <Button size="sm" variant="secondary" disabled={!live} onClick={() => runNow(j.id)} title={live ? "Run now" : "Connector not configured"}><Icon name="Play" size={13} /> Run</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="card-pad">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Backend audit log (real tool attempts)</p>
        {audit.length === 0 ? <p className="text-sm text-ink-400">No backend events yet.</p> : (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {audit.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-sand-50">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", e.ok ? "bg-sage-500" : "bg-coral-500")} />
                <span className="font-mono text-ink-600">{e.type}</span>
                {e.toolId && <span className="text-ink-500">{e.toolId}</span>}
                {e.error && <span className="text-coral-600">{e.error}</span>}
                <span className="ml-auto text-ink-400">{relativeTime(e.at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// Back-compat alias for the Automations screen tab.
export const SandboxRunsPanel = BackgroundJobsPanel;
