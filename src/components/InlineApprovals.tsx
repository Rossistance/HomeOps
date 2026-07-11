import { useState } from "react";
import { useStore } from "@/store/useStore";
import { Button, RiskBadge, TextArea } from "@/components/ui";
import { Icon } from "@/components/Icon";

/**
 * Approve, deny, or ask-for-changes on a run's pending approvals inline — without
 * leaving the current surface. All three go through the exact same server-enforced
 * gate as the Approvals console (store `approveRequest`/`denyRequest`/
 * `askAgentForChanges` → backend consume-once execution / re-plan). Used in the
 * Assistant conversation and in Run History, so the full approval loop — including
 * "ask for changes" — is reachable right where the run is happening.
 */
export function InlineApprovals({ runId }: { runId: string }) {
  const approvals = useStore((s) => s.data.approvals);
  const approve = useStore((s) => s.approveRequest);
  const deny = useStore((s) => s.denyRequest);
  const askChanges = useStore((s) => s.askAgentForChanges);
  const [busy, setBusy] = useState<string | null>(null);
  const [askId, setAskId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const pending = approvals.filter((a) => a.relatedRunId === runId && a.status === "Pending");
  if (pending.length === 0) return null;
  const act = async (id: string, ok: boolean) => {
    setBusy(id);
    try { if (ok) await approve(id); else await deny(id); } finally { setBusy(null); }
  };
  const submitAsk = async (id: string) => {
    if (!note.trim()) return;
    setBusy(id);
    try { await askChanges(id, note.trim()); setAskId(null); setNote(""); } finally { setBusy(null); }
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
          {askId === a.id ? (
            <div className="space-y-2">
              <TextArea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should the agent change before you approve?" className="min-h-[64px] text-sm" />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="primary" disabled={!note.trim() || busy === a.id} onClick={() => submitAsk(a.id)}>
                  <Icon name={busy === a.id ? "Loader2" : "Send"} size={13} className={busy === a.id ? "animate-spin" : ""} /> Send &amp; re-plan
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setAskId(null); setNote(""); }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="success" disabled={busy === a.id} onClick={() => act(a.id, true)}>
                <Icon name={busy === a.id ? "Loader2" : "Check"} size={13} className={busy === a.id ? "animate-spin" : ""} /> Approve &amp; run
              </Button>
              <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => { setAskId(a.id); setNote(""); }}><Icon name="MessageCircleQuestion" size={13} /> Ask for changes</Button>
              <Button size="sm" variant="danger" disabled={busy === a.id} onClick={() => act(a.id, false)}><Icon name="X" size={13} /> Deny</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
