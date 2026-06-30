import { useCallback, useEffect, useRef, useState } from "react";
import { backend, type ServerRun } from "@/connectors/api";
import { Card, Button, EmptyState, Badge } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/cn";
import { fmtDateTime, relativeTime } from "@/lib/dates";
import { RunTimeline, RunStatusBadge } from "./RunTimeline";

/* Execution Monitor — the live view of the durable SERVER runtime. Lists runs from
   every entry point (chat, skill, agent, schedule, webhook, manual) and streams the
   selected run's timeline over SSE (with a getRun poll as the durable fallback).
   Approve/deny resumes the run server-side; cancel stops it. The browser observes —
   the server is the source of truth. */

const SOURCE_LABEL: Record<string, string> = {
  assistant: "Chat", skill: "Skill", agent: "Agent", schedule: "Schedule",
  webhook: "Webhook", rss: "RSS", manual: "Manual", automation: "Automation",
};
const TERMINAL = ["completed", "failed", "cancelled", "expired"];

export function ExecutionMonitor() {
  const [runs, setRuns] = useState<ServerRun[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [sel, setSel] = useState<ServerRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const unsubRef = useRef<(() => void) | null>(null);

  const loadList = useCallback(async () => {
    const list = await backend.runs("?limit=50");
    setRuns(list);
    setLoading(false);
    setSelId((cur) => cur ?? list[0]?.id ?? null);
  }, []);

  // Refresh the list on mount + on a slow interval (new runs from any source appear).
  useEffect(() => {
    loadList();
    const t = setInterval(loadList, 5000);
    return () => clearInterval(t);
  }, [loadList]);

  // Live subscription for the selected run (SSE), with a getRun poll as fallback.
  // A terminal run can never change again, so we fetch it once and open NO live
  // channel; a run that becomes terminal while watched tears its channel down.
  useEffect(() => {
    if (!selId) { setSel(null); return; }
    let alive = true;
    let poll: ReturnType<typeof setInterval> | null = null;
    const stopLive = () => { if (poll) { clearInterval(poll); poll = null; } unsubRef.current?.(); unsubRef.current = null; };
    const onUpdate = (r: ServerRun) => {
      if (!alive) return;
      setSel(r);
      if (TERMINAL.includes(r.status)) stopLive();
    };
    (async () => {
      const r = await backend.getRun(selId);
      if (!alive) return;
      if (r) setSel(r);
      if (r && TERMINAL.includes(r.status)) return; // frozen — no SSE, no poll
      unsubRef.current?.();
      unsubRef.current = backend.subscribeRun(selId, onUpdate);
      poll = setInterval(async () => { const x = await backend.getRun(selId); if (x) onUpdate(x); }, 3000);
    })();
    return () => { alive = false; stopLive(); };
  }, [selId]);

  // Keep the matching list row in sync with the live selected run.
  useEffect(() => {
    if (sel) setRuns((rs) => rs.map((r) => (r.id === sel.id ? sel : r)));
  }, [sel]);

  const gatedStep = sel?.steps.find((s) => s.status === "waiting_for_approval");
  const decide = async (approve: boolean) => {
    if (!sel || !gatedStep?.approvalId) return;
    setBusy(true);
    await backend.decideApproval(gatedStep.approvalId, approve);
    await backend.resumeRun(sel.id);
    const r = await backend.getRun(sel.id); if (r) setSel(r);
    setBusy(false);
  };
  const cancel = async () => {
    if (!sel) return;
    setBusy(true);
    await backend.cancelRun(sel.id);
    const r = await backend.getRun(sel.id); if (r) setSel(r);
    setBusy(false);
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-ink-500"><Icon name="Loader2" size={16} className="animate-spin" /> Loading runs…</div>;
  if (!runs.length) return <EmptyState icon="Activity" title="No runs yet" message="Run a skill, agent, or workflow — durable runs stream here live." />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <div className="space-y-2">
        {runs.map((r) => (
          <Card key={r.id} className={cn("card-pad", r.id === selId && "ring-2 ring-ember-400")} hover onClick={() => setSelId(r.id)} ariaLabel={`Open run ${r.title || r.id}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-ink-800">{r.title || "Run"}</p>
              <RunStatusBadge status={r.status} />
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-400">
              <Badge color="lavender">{SOURCE_LABEL[r.source] ?? r.source}</Badge>
              <span>{relativeTime(new Date(r.createdAt).toISOString())}</span>
            </div>
          </Card>
        ))}
      </div>
      <div>
        {sel ? (
          <Card className="card-pad">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-display text-base font-semibold text-ink-900">{sel.title || "Run"}</p>
                <p className="text-xs text-ink-400">{SOURCE_LABEL[sel.source] ?? sel.source} · started {sel.startedAt ? fmtDateTime(new Date(sel.startedAt).toISOString()) : "—"}</p>
              </div>
              <div className="flex items-center gap-2">
                <RunStatusBadge status={sel.status} />
                {!TERMINAL.includes(sel.status) && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={cancel}><Icon name="Ban" size={13} /> Cancel</Button>
                )}
              </div>
            </div>
            {sel.error && <p className="mb-2 text-sm text-coral-600">{sel.error}</p>}
            <RunTimeline
              run={sel}
              busy={busy}
              onApprove={gatedStep ? () => decide(true) : undefined}
              onDeny={gatedStep ? () => decide(false) : undefined}
            />
          </Card>
        ) : (
          <EmptyState icon="MousePointerClick" title="Select a run" message="Pick a run on the left to watch its live timeline." />
        )}
      </div>
    </div>
  );
}
