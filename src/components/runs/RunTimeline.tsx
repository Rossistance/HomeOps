import { useState } from "react";
import type { ServerRun, RunStepView } from "@/connectors/api";
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
  // WP-004: an expired run sent nothing — that's a caution, not a neutral outcome
  // like a deliberate cancel, so it gets the same amber treatment as a parked wait.
  expired: { label: "Expired", color: "amber" },
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
  // WP-004 — these three used to have no entry here, so they fell to the `pending`
  // default below: a neutral gray dot, exactly the "reads as unknown-or-done" bug
  // this fix exists for. A step that claimed an effect but had no delivery tool is
  // NOT a success and gets the same visual weight as a real status, not a fade-out.
  skipped_no_tool: { icon: "MailX", cls: "text-amber-500" },
  expired: { icon: "Hourglass", cls: "text-amber-500" },
  pending: { icon: "Circle", cls: "text-ink-300" },
  ready: { icon: "Circle", cls: "text-ink-300" },
};

// Truth badges for the WP-004 non-delivery statuses — always visible next to the
// step title (never gated behind the expand toggle), so the caveat can't be missed.
type ClampedOut = { reason: string; message: string } | null;
function truthLabel(status: string, clampedOut: ClampedOut): string | null {
  if (status === "skipped_no_tool") return "Not sent";
  if (status === "expired") return "Expired — nothing sent";
  if (status === "skipped" && clampedOut) return "Skipped — not permitted";
  return null;
}

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
        // clampedOut/effectClaimed travel from the server (server/index.mjs publicRun)
        // but aren't on the shared RunStepView type — read them defensively.
        const clampedOut = (s as RunStepView & { clampedOut?: ClampedOut }).clampedOut ?? null;
        const label = truthLabel(s.status, clampedOut);
        const isNonDelivery = label != null;
        const expandable = !!(s.result != null || last || (s.detail && !isNonDelivery));
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
                  {label && <Badge color="amber">{label}</Badge>}
                  {s.requiresApproval && <Icon name="ShieldAlert" size={12} className="text-amber-500" />}
                </span>
                {(s.connectorName || s.toolId) && (
                  <span className="mt-0.5 block truncate text-xs text-ink-400">
                    {s.connectorName ?? ""}{s.connectorName && s.toolId ? " · " : ""}{s.toolId ?? ""}
                  </span>
                )}
                {/* Never bury the caveat behind the expand toggle — name the
                    consequence right where the step already sits. */}
                {isNonDelivery && s.detail && (
                  <span className="mt-0.5 block text-xs text-amber-700">{s.detail}</span>
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
                {!isNonDelivery && s.detail && <p className="text-ink-500">{s.detail}</p>}
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
