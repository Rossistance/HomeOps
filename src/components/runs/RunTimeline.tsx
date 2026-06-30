import { useState } from "react";
import type { ServerRun } from "@/connectors/api";
import type { AccentColor } from "@/types";
import { Badge, Button } from "@/components/ui";
import { Icon } from "@/components/Icon";

/* Shared live run timeline — renders a durable SERVER run's steps with attribution,
   per-step status, timing, expandable input/output, and an inline approval gate.
   Reused by the Execution Monitor (and, later, the assistant + builders). */

type Color = AccentColor | "gray";

const RUN_STATUS_UI: Record<string, { label: string; color: Color }> = {
  queued: { label: "Queued", color: "sky" },
  routing: { label: "Routing", color: "sky" },
  selecting_agent: { label: "Selecting agent", color: "sky" },
  selecting_skills: { label: "Selecting skills", color: "sky" },
  selecting_tools: { label: "Selecting tools", color: "sky" },
  planning: { label: "Planning", color: "sky" },
  running: { label: "Running", color: "sky" },
  waiting_for_approval: { label: "Waiting for approval", color: "amber" },
  waiting_for_connector: { label: "Waiting for connection", color: "amber" },
  waiting_for_provider: { label: "Waiting for provider", color: "amber" },
  retrying: { label: "Retrying", color: "amber" },
  completed: { label: "Completed", color: "sage" },
  failed: { label: "Failed", color: "coral" },
  cancelled: { label: "Cancelled", color: "gray" },
  expired: { label: "Expired", color: "gray" },
};

export function RunStatusBadge({ status }: { status: string }) {
  const m = RUN_STATUS_UI[status] ?? { label: status, color: "gray" as Color };
  const live = ["running", "retrying", "routing", "planning", "selecting_agent", "selecting_skills", "selecting_tools"].includes(status);
  return (
    <Badge color={m.color}>
      {live && <Icon name="Loader2" size={12} className="animate-spin" />}
      {m.label}
    </Badge>
  );
}

const STEP_UI: Record<string, { icon: string; cls: string }> = {
  succeeded: { icon: "CircleCheck", cls: "text-sage-500" },
  approved: { icon: "CircleCheck", cls: "text-sage-500" },
  running: { icon: "Loader2", cls: "text-sky-500 animate-spin" },
  waiting_for_approval: { icon: "ShieldAlert", cls: "text-amber-500" },
  blocked: { icon: "PlugZap", cls: "text-amber-500" },
  failed: { icon: "OctagonAlert", cls: "text-coral-500" },
  skipped: { icon: "SkipForward", cls: "text-ink-300" },
  pending: { icon: "Circle", cls: "text-ink-300" },
  ready: { icon: "Circle", cls: "text-ink-300" },
};

const ATTR_LABEL: Record<string, string> = { internal: "Function", provider: "Tool", connector: "Tool", reasoning: "Reasoning" };

export function RunTimeline({
  run,
  onApprove,
  onDeny,
  busy,
}: {
  run: ServerRun;
  onApprove?: () => void;
  onDeny?: () => void;
  busy?: boolean;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (!run.steps.length) return <p className="text-sm text-ink-400">This run has no steps.</p>;
  return (
    <div className="space-y-1.5">
      {run.steps.map((s) => {
        const ui = STEP_UI[s.status] ?? STEP_UI.pending;
        const last = s.toolCalls?.[s.toolCalls.length - 1];
        const expandable = !!(s.result != null || last || s.detail);
        const open = openIdx === s.index;
        const isGate = s.status === "waiting_for_approval";
        return (
          <div key={s.index} className="well p-3">
            <button
              type="button"
              className="flex w-full items-center gap-2.5 text-left"
              onClick={() => expandable && setOpenIdx(open ? null : s.index)}
            >
              <Icon name={ui.icon} size={16} className={`shrink-0 ${ui.cls}`} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink-800">{s.title}</span>
                  {s.attribution && <Badge color="gray">{ATTR_LABEL[s.attribution] ?? s.attribution}</Badge>}
                  {s.requiresApproval && <Icon name="ShieldAlert" size={12} className="text-amber-500" />}
                </span>
                {(s.connectorName || s.toolId) && (
                  <span className="mt-0.5 block truncate text-xs text-ink-400">
                    {s.connectorName ?? ""}{s.connectorName && s.toolId ? " · " : ""}{s.toolId ?? ""}
                  </span>
                )}
              </span>
              {last?.durationMs ? <span className="shrink-0 text-xs text-ink-400">{last.durationMs}ms</span> : null}
              {expandable && <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} className="shrink-0 text-ink-400" />}
            </button>

            {isGate && (onApprove || onDeny) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-ink-900/[0.06] pt-2">
                <span className="text-xs text-amber-600">Needs your approval to continue.</span>
                <div className="ml-auto flex gap-1.5">
                  {onDeny && <Button size="sm" variant="ghost" disabled={busy} onClick={onDeny}><Icon name="X" size={13} /> Deny</Button>}
                  {onApprove && <Button size="sm" variant="ember" disabled={busy} onClick={onApprove}><Icon name="Check" size={13} /> Approve &amp; run</Button>}
                </div>
              </div>
            )}

            {open && (
              <div className="mt-2 space-y-1.5 border-t border-ink-900/[0.06] pt-2 text-xs">
                {s.detail && <p className="text-ink-500">{s.detail}</p>}
                {s.result != null && (
                  <pre className="overflow-x-auto rounded-lg bg-surface-sunken p-2 text-ink-600">
                    {typeof s.result === "string" ? s.result : JSON.stringify(s.result, null, 2)}
                  </pre>
                )}
                {last && <p className="text-ink-400">{last.ok ? "✓" : "✗"} {last.resultSummary}{last.approvalId ? " · approved" : ""}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
