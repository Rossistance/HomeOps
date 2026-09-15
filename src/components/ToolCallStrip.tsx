import { useStore } from "@/store/useStore";
import { Icon } from "./Icon";
import type { AssistantToolCall } from "@/connectors/api";

/**
 * The receipts: one chip per tool the engine actually called this turn.
 *
 * Shared by the Assistant thread AND by a helper's history, because a helper run IS a
 * chat turn — same engine, same tool loop, same approval chain. Two separate renderings
 * would eventually disagree about what "done" or "waiting" looks like, and a family
 * comparing the two would have no way to tell which one was lying.
 */
export function ToolCallStrip({ calls }: { calls?: AssistantToolCall[] | null }) {
  const navigate = useStore((s) => s.navigate);
  if (!calls?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="What it did">
      {calls.map((c, i) => {
        const key = `${c.tool}-${i}`;
        if (c.status === "awaiting_approval") {
          return (
            <button key={key} onClick={() => navigate("messages", { tab: "approvals", ...(c.approvalId ? { approval: c.approvalId } : {}) })}
              className="chip bg-amber-50 text-[11px] text-amber-700 transition-colors hover:bg-amber-100" title={c.label}>
              ⏳ Waiting for approval · {c.label}
            </button>
          );
        }
        if (c.status === "failed" || c.status === "blocked") {
          return <span key={key} className="chip bg-coral-50 text-[11px] text-coral-700" title={c.summary}>⚠ {c.label}{c.summary ? ` — ${c.summary}` : ""}</span>;
        }
        if (c.status === "running") {
          return <span key={key} className="chip bg-surface-sunken text-[11px] text-ink-500"><Icon name="Loader2" size={10} className="animate-spin" /> {c.label}</span>;
        }
        return <span key={key} className="chip bg-surface-sunken text-[11px] text-ink-500" title={c.summary}>✓ {c.label}</span>;
      })}
    </div>
  );
}
