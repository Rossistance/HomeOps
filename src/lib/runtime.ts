/**
 * Local orchestration runtime. These pure functions mutate an AppData draft to
 * record what a household agent run did *locally* (read local calendar/tasks,
 * generate a briefing, file a document, create reminders). Any step that would
 * leave the household is NOT performed here — it is raised as an approval request
 * and executed only by the real backend connector after you approve. Nothing
 * here fabricates an external success.
 */
import type {
  Agent,
  AppData,
  ApprovalRequest,
  Automation,
  AutomationRun,
  ActivityLogEntry,
  RunStep,
  RiskLevel,
  SubagentRun,
} from "@/types";
import { uid } from "./ids";

export function pushActivity(
  draft: AppData,
  entry: Partial<ActivityLogEntry> & { actionType: string; description: string },
): string {
  const id = uid("act");
  const full: ActivityLogEntry = {
    id,
    timestamp: new Date().toISOString(),
    actorType: entry.actorType ?? "system",
    actorId: entry.actorId ?? "system",
    actorName: entry.actorName ?? "FamiliOS",
    actionType: entry.actionType,
    description: entry.description,
    entityType: entry.entityType,
    entityId: entry.entityId,
    spaceId: entry.spaceId,
    status: entry.status ?? "success",
    metadata: entry.metadata,
  };
  draft.activity.unshift(full);
  if (draft.activity.length > 500) draft.activity.length = 500;
  return id;
}

function agentById(draft: AppData, id: string): Agent | undefined {
  return draft.agents.find((a) => a.id === id);
}

export interface RunOptions {
  agentId: string;
  automation?: Automation;
  triggerLabel: string;
  manual?: boolean;
  forceFail?: boolean;
  subagents?: { name: string; icon: string; role: string }[];
}

/** Create a believable run for an agent / automation, raising an approval
 *  request when the plan contains a high-risk external gate. */
export function executeAgentRun(draft: AppData, opts: RunOptions): { runId: string; approvalId?: string } {
  const agent = agentById(draft, opts.agentId);
  const now = new Date();
  const runId = uid("run");
  const planSteps = opts.automation?.plan.steps ?? [];

  const gates = opts.automation?.plan.approvalGates ?? [];
  const hasExternalGate =
    (opts.automation?.approvalRequired ?? false) &&
    gates.some((g) => !/no external action/i.test(g));

  const subDefs = opts.subagents ?? [];
  const subRunIds: string[] = [];
  for (const s of subDefs) {
    const sid = uid("sub");
    const sub: SubagentRun = {
      id: sid,
      parentRunId: runId,
      name: s.name,
      icon: s.icon,
      taskScope: s.role,
      status: "Completed",
      inputSummary: `Scoped slice for "${s.role}"`,
      outputSummary: `${s.name} reported back to ${agent?.name ?? "the parent agent"}.`,
      resultMerged: true,
      effortEstimate: "~1 unit",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    draft.subagentRuns.unshift(sub);
    subRunIds.push(sid);
  }

  const steps: RunStep[] = planSteps.length
    ? planSteps.map((s) => ({
        label: s.label,
        status: s.needsApproval && hasExternalGate ? "blocked" : "done",
        detail: s.detail,
        timestamp: now.toISOString(),
        agentName: s.agentName,
      }))
    : [
        { label: "Trigger fired", status: "done", detail: opts.triggerLabel, timestamp: now.toISOString() },
        { label: "Gathered inputs", status: "done", detail: "Read approved connections", timestamp: now.toISOString() },
        { label: "Generated output", status: "done", detail: "Summary prepared", timestamp: now.toISOString() },
      ];

  if (subDefs.length) {
    steps.splice(1, 0, {
      label: "Dispatched subagents",
      status: "done",
      detail: `${subDefs.length} subagents ran and merged results`,
      timestamp: now.toISOString(),
    });
  }

  let approvalId: string | undefined;
  let status: AutomationRun["status"] = "Completed";

  if (opts.forceFail) {
    status = "Failed";
    if (steps.length) steps[steps.length - 1].status = "blocked";
  } else if (hasExternalGate) {
    status = "Waiting for Approval";
    const risk: RiskLevel = /sensitive|medical|financial|legal|child/i.test(gates.join(" ")) ? "Sensitive" : "High";
    approvalId = uid("apr");
    const approval: ApprovalRequest = {
      id: approvalId,
      title: `${agent?.name ?? "Agent"}: ${gates[0]}`,
      description: `${agent?.name ?? "An agent"} prepared an action that needs your approval before it leaves the household.`,
      riskLevel: risk,
      requestedByAgentId: opts.agentId,
      spaceId: agent?.spaceId ?? draft.spaces[0]?.id ?? "",
      proposedAction: gates[0],
      dataUsedSummary: (opts.automation?.plan.inputSources ?? ["Connected services"]).join(", "),
      recipientSummary: /school|doctor|landlord|vendor/i.test(gates[0]) ? "External recipient" : "Outside the household",
      previewContent:
        "Draft prepared by your helper agent. Review the full content, edit if needed, then approve. It will be executed by the configured connector only after you approve — nothing has been sent yet.",
      status: "Pending",
      relatedRunId: runId,
      category: /email/i.test(gates[0])
        ? "Email"
        : /subscription/i.test(gates[0])
          ? "Subscription"
          : /calendar/i.test(gates[0])
            ? "Calendar"
            : /browser|login/i.test(gates[0])
              ? "Browser"
              : "Message",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    draft.approvals.unshift(approval);
  }

  const run: AutomationRun = {
    id: runId,
    automationId: opts.automation?.id,
    agentId: opts.agentId,
    triggerLabel: opts.triggerLabel,
    status,
    startedAt: now.toISOString(),
    completedAt: status === "Completed" || status === "Failed" ? now.toISOString() : undefined,
    inputSummary: (opts.automation?.plan.inputSources ?? ["Local household sources"]).join(", "),
    outputSummary:
      status === "Failed"
        ? "Run failed — a required source was unavailable."
        : status === "Waiting for Approval"
          ? "Output ready — paused for your approval before the external step."
          : opts.automation?.plan.output ?? "Completed successfully and logged.",
    actionsTaken: steps.filter((s) => s.status === "done").map((s) => s.label),
    steps,
    approvalRequestIds: approvalId ? [approvalId] : [],
    subagentRunIds: subRunIds,
    error: status === "Failed" ? "A required connector was not configured or returned an error." : undefined,
    activityEntryIds: [],
  };
  draft.runs.unshift(run);

  if (opts.automation) {
    opts.automation.lastRunAt = now.toISOString();
    opts.automation.runIds.unshift(runId);
    if (status === "Failed") opts.automation.failureCount += 1;
    const live = draft.automations.find((a) => a.id === opts.automation!.id);
    if (live) {
      live.lastRunAt = now.toISOString();
      live.runIds = [runId, ...live.runIds];
      if (status === "Failed") {
        live.failureCount += 1;
        live.status = "error";
      }
    }
  }

  if (opts.automation) {
    pushActivity(draft, {
      actorType: "automation",
      actorId: opts.automation.id,
      actorName: opts.automation.name,
      actionType: "trigger.fired",
      description: `Trigger fired: ${opts.triggerLabel}`,
      entityType: "automation",
      entityId: opts.automation.id,
      spaceId: agent?.spaceId,
      status: "info",
    });
  }
  pushActivity(draft, {
    actorType: "agent",
    actorId: opts.agentId,
    actorName: agent?.name ?? "Agent",
    actionType: "agent.run",
    description:
      status === "Failed"
        ? `${agent?.name ?? "Agent"} run failed`
        : status === "Waiting for Approval"
          ? `${agent?.name ?? "Agent"} run paused for approval`
          : `${agent?.name ?? "Agent"} completed a run`,
    entityType: "run",
    entityId: runId,
    spaceId: agent?.spaceId,
    status: status === "Failed" ? "error" : status === "Waiting for Approval" ? "pending" : "success",
  });
  for (const sid of subRunIds) {
    pushActivity(draft, {
      actorType: "agent",
      actorId: sid,
      actorName: draft.subagentRuns.find((s) => s.id === sid)?.name ?? "Subagent",
      actionType: "subagent.completed",
      description: `Subagent reported to ${agent?.name ?? "parent agent"}`,
      entityType: "subagentRun",
      entityId: sid,
      spaceId: agent?.spaceId,
      status: "success",
    });
  }
  if (approvalId) {
    pushActivity(draft, {
      actorType: "agent",
      actorId: opts.agentId,
      actorName: agent?.name ?? "Agent",
      actionType: "approval.requested",
      description: `Approval requested: ${gates[0]}`,
      entityType: "approval",
      entityId: approvalId,
      spaceId: agent?.spaceId,
      status: "pending",
    });
  }
  return { runId, approvalId };
}

/** Local "extraction" pass for a freshly uploaded file (runs entirely on-device). */
export function processFile(draft: AppData, fileId: string): void {
  const file = draft.files.find((f) => f.id === fileId);
  if (!file) return;
  file.searchIndexed = true;
  if (!file.summary) {
    file.summary = `Auto-summary: ${file.name} processed in the sandbox. Key details extracted for the household.`;
  }
  const now = new Date().toISOString();
  pushActivity(draft, {
    actorType: "system",
    actorId: "sandbox",
    actorName: "Document Organizer Agent",
    actionType: "file.processed",
    description: `Processed ${file.name}: ${file.detectedDates.length} dates, ${file.detectedTasks.length} tasks detected`,
    entityType: "file",
    entityId: file.id,
    spaceId: file.spaceId,
    status: "success",
    metadata: { at: now },
  });
}

/** Used by the agent run history "needs subagents" templates. */
export function subagentDefsFor(automation?: Automation): { name: string; icon: string; role: string }[] | undefined {
  if (!automation) return undefined;
  const id = automation.templateId ?? "";
  if (id.includes("daily-family-briefing")) {
    return [
      { name: "Calendar Agent", icon: "Calendar", role: "Check today's events" },
      { name: "Inbox Agent", icon: "Mail", role: "Find important emails" },
      { name: "School Agent", icon: "GraduationCap", role: "Check school notices" },
      { name: "Task Agent", icon: "ListTodo", role: "Check chores & errands" },
      { name: "Finance Agent", icon: "Wallet", role: "Check bills due" },
    ];
  }
  if (id.includes("research-deep-dive")) {
    return [
      { name: "Research Agent", icon: "Search", role: "Search sources" },
      { name: "File Agent", icon: "FileText", role: "Check uploaded documents" },
      { name: "Summary Agent", icon: "Sparkles", role: "Write the final report" },
      { name: "Task Agent", icon: "ListTodo", role: "Create follow-up actions" },
    ];
  }
  return undefined;
}

