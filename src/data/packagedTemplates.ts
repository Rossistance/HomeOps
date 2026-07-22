/**
 * WP-005 — Packaged Helper Agent catalog (redesign A).
 *
 * ONE catalog, merged from the three legacy sources so the unified "New agent"
 * flow offers agent *packages* (instructions + suggested skills + trigger +
 * tools + approval gates) instead of three parallel builder vocabularies:
 *
 *   • agentTemplates.ts   — 13 agent templates  (the primary packages)
 *   • workflowTemplates.ts — 23 automation templates
 *   • playbooksCatalog.ts  — 14 reusable playbooks
 *
 * DEDUPE STRATEGY (reported below and encoded here):
 *   1. Each of the 13 agent templates becomes a base package, carrying its
 *      agentTemplateId so "New agent" builds it through the full-fidelity
 *      createAgentFromTemplate path.
 *   2. A workflow template that names a recommendedAgentTemplateId is FOLDED into
 *      that base package (its prompt/trigger become an alternate preset; its name
 *      joins suggestedSkills) rather than becoming its own card — 8 of the 23.
 *   3. A playbook whose name appears in an agent template's suggestedPlaybooks is
 *      FOLDED into that base package's suggestedSkills.
 *   4. The remaining 15 workflow templates (no recommendedAgentTemplateId) become
 *      their own standalone packages, distilled from the workflow's own fields.
 *
 * This module derives everything from the source arrays at load, so the mapping
 * can never drift from the catalogs it merges.
 */

import type { PackagedTemplate, SpaceType, TriggerType, WorkflowTemplate } from "@/types";
import { agentTemplates } from "./agentTemplates";
import { workflowTemplates } from "./workflowTemplates";
import { playbookCatalog } from "./playbooksCatalog";

/** Best-effort map of a free-text trigger phrase → a real TriggerType. */
function parseTriggerType(text: string): TriggerType {
  const t = text.toLowerCase();
  if (/(schedule|every|daily|weekly|morning|evening|nightly|monthly|friday|sunday|saturday|monday|\bam\b|\bpm\b|:\d\d)/.test(t)) return "Schedule";
  if (/email\s+label|label\s+applied/.test(t)) return "Email Label Applied";
  if (/email\s+reply|reply\s+received/.test(t)) return "Email Reply Received";
  if (/email|inbox|gmail/.test(t)) return "Email Received";
  if (/text\s*message|sms/.test(t)) return "Text Message Received";
  if (/calendar\s+event\s+chang|event\s+chang/.test(t)) return "Calendar Event Changed";
  if (/calendar|appointment|booking|event\s+creat/.test(t)) return "Calendar Event Created";
  if (/rss|feed|podcast|blog/.test(t)) return "RSS Feed";
  if (/webhook/.test(t)) return "Webhook";
  if (/file|drive|folder|upload|document/.test(t)) return "File Changed";
  if (/agent-to-agent|another agent/.test(t)) return "Agent-to-Agent";
  return "Manual";
}

/** Sensible package icon for a standalone workflow package (workflows carry no icon). */
function iconForWorkflow(w: WorkflowTemplate): string {
  if (w.multiAgent?.length) return w.multiAgent[w.multiAgent.length - 1].icon;
  const c = w.category.toLowerCase();
  if (/finance|budget|receipt|money/.test(c)) return "Receipt";
  if (/calendar/.test(c)) return "CalendarDays";
  if (/email|communication|coordination/.test(c)) return "Inbox";
  if (/research|insight|monitor|feed|web/.test(c)) return "Search";
  if (/document|file|records|secure/.test(c)) return "FolderOpen";
  if (/home|smart|ambient/.test(c)) return "House";
  if (/relationship|personal/.test(c)) return "HeartHandshake";
  if (/note|follow-up|review/.test(c)) return "ListChecks";
  return "Workflow";
}

const AGENT_SPACE_FALLBACK: SpaceType = "Personal";

/** Playbooks folded into a base package = those the agent template already suggests. */
function playbooksForAgentTemplate(suggested: string[]): { names: string[]; ids: string[] } {
  const matched = playbookCatalog.filter((p) => suggested.includes(p.name));
  return { names: matched.map((p) => p.name), ids: matched.map((p) => p.id) };
}

/* ---- 1 + 2 + 3: base packages (13 agent templates, folding workflows + playbooks) ---- */
const basePackages: PackagedTemplate[] = agentTemplates.map((at) => {
  const foldedWorkflows = workflowTemplates.filter((w) => w.recommendedAgentTemplateId === at.id);
  const { names: playbookNames, ids: playbookIds } = playbooksForAgentTemplate(at.suggestedPlaybooks);
  const primaryTriggerText = at.suggestedTriggers[0] ?? "Manual run";
  // Merge the agent template's own playbook suggestions with any folded workflow
  // names — de-duplicated — as the package's "suggested skills".
  const suggestedSkills = Array.from(new Set([...playbookNames, ...foldedWorkflows.map((w) => w.name)]));
  const suggestedConnections = Array.from(
    new Set([...at.suggestedConnections, ...foldedWorkflows.flatMap((w) => w.requiredConnections)]),
  );
  return {
    id: `pkg-${at.id}`,
    name: at.name,
    icon: at.icon,
    category: at.category,
    summary: at.purpose,
    description: at.description,
    instructions: at.defaultInstructions,
    defaultSpaceType: at.defaultSpaceType,
    trigger: { type: parseTriggerType(primaryTriggerText), detail: primaryTriggerText },
    suggestedSkills,
    suggestedConnections,
    approvalRules: at.defaultApprovalRules,
    autoAllow: at.defaultAutoAllow,
    agentTemplateId: at.id,
    sources: {
      agentTemplateIds: [at.id],
      workflowTemplateIds: foldedWorkflows.map((w) => w.id),
      playbookIds,
    },
  } satisfies PackagedTemplate;
});

/* ---- 4: standalone packages (workflow templates with no recommended agent template) ---- */
const standalonePackages: PackagedTemplate[] = workflowTemplates
  .filter((w) => !w.recommendedAgentTemplateId)
  .map((w) => {
    const instructions =
      `You are the ${w.recommendedAgent}. ${w.prompt} ` +
      (w.approvalRequirements.length
        ? `Approval rules: ${w.approvalRequirements.join(" ")} `
        : "") +
      "Do the low-risk preparation work on your own, but pause for approval before any external send, purchase, booking, or share.";
    return {
      id: `pkg-${w.id}`,
      name: w.recommendedAgent && !/assistant$/i.test(w.recommendedAgent) ? w.recommendedAgent : w.name,
      icon: iconForWorkflow(w),
      category: w.category,
      summary: w.prompt.length > 140 ? `${w.prompt.slice(0, 137)}…` : w.prompt,
      description: w.prompt,
      instructions,
      defaultSpaceType: AGENT_SPACE_FALLBACK,
      trigger: { type: w.triggerType, detail: `${w.triggerType}${w.setupChecklist[0] ? ` · ${w.setupChecklist[0]}` : ""}` },
      suggestedSkills: [w.name],
      suggestedConnections: Array.from(new Set([...w.requiredConnections, ...w.optionalConnections])),
      approvalRules: w.approvalRequirements,
      autoAllow: [],
      // No agentTemplateId — Agents.tsx builds these directly via createAgent().
      sources: { agentTemplateIds: [], workflowTemplateIds: [w.id], playbookIds: [] },
    } satisfies PackagedTemplate;
  });

/** The merged catalog: base agent packages first, then the distilled workflow packages. */
export const packagedTemplates: PackagedTemplate[] = [...basePackages, ...standalonePackages];

/** Distinct categories present in the catalog (for the New-agent filter chips). */
export const packagedCategories: string[] = Array.from(new Set(packagedTemplates.map((p) => p.category)));
