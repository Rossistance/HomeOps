import { useState } from "react";
import { useStore } from "@/store/useStore";
import { Button, RiskBadge } from "@/components/ui";
import { Icon } from "@/components/Icon";

/**
 * Approve or deny a run's pending approvals inline — without leaving the current
 * surface. This goes through the exact same server-enforced approval gate as the
 * Approvals console (store `approveRequest`/`denyRequest` → backend consume-once
 * execution). Used in the Assistant conversation and in Run History.
 */
export function InlineApprovals({ runId }: { runId: string }) {
  const approvals = useStore((s) => s.data.approvals);
  const approve = useStore((s) => s.approveRequest);
  const deny = useStore((s) => s.denyRequest);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = approvals.filter((a) => a.relatedRunId === runId && a.status === "Pending");
  if (pending.length === 0) return null;
  const act = async (id: string, ok: boolean) => {
    setBusy(id);
    try { if (ok) await approve(id); else await deny(id); } finally { setBusy(null); }
  };
  return (
    <div className="mt-2 space-y-2">
      {pending.map((a) => (
        <div key={a.id} className="rounded-xl border border-amber-200/70 bg-amber-50/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
          <div className="mb-1 flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-ink-800">{a.title}</p>
            <RiskBadge level={a.riskLevel} />
          </div>
          {a.proposedAction && <p className="mb-2 text-xs text-ink-600">{a.proposedAction}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="success" disabled={busy === a.id} onClick={() => act(a.id, true)}>
              <Icon name={busy === a.id ? "Loader2" : "Check"} size={13} className={busy === a.id ? "animate-spin" : ""} /> Approve &amp; run
            </Button>
            <Button size="sm" variant="danger" disabled={busy === a.id} onClick={() => act(a.id, false)}><Icon name="X" size={13} /> Deny</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
