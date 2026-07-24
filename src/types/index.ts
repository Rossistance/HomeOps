/**
 * FamiliOS AI — entity model.
 *
 * Mirrors 04_ARCHITECTURE_AND_DATA_MODEL.md, adapted into a normalized,
 * local-first shape. Collections are stored as arrays inside `AppData` and
 * persisted to IndexedDB. UI/session state lives in the store, not here.
 */
import type { AgentPlan, ChatBuild } from "@/connectors/api";

/* ----------------------------------------------------------------------- */
/* Enums / unions                                                          */
/* ----------------------------------------------------------------------- */

export type Role =
  | "Owner"
  | "Adult Admin"
  | "Adult Member"
  | "Limited Member"
  | "Child View"
  | "Guest/Helper";

export type SpaceType =
  | "Personal"
  | "Family"
  | "School"
  | "Bills"
  | "Medical"
  | "Travel"
  | "Home Maintenance"
  | "Caregiving"
  | "Pets"
  | "Custom";

export type AgentStatus = "Active" | "Paused" | "Needs Attention" | "Draft" | "Archived";

export type ConnectionCategory =
  | "Email & Calendar"
  | "Documents & Storage"
  | "Messaging"
  | "Tasks & Notes"
  | "Finance & Bills"
  | "Shopping & Groceries"
  | "Travel"
  | "Health & Caregiving"
  | "Smart Home"
  | "Custom APIs"
  | "Webhooks"
  | "Browser Sessions"
  | "Feeds";

export type ConnectionStatus = "Not Connected" | "Connected" | "Needs Reauth" | "Error";

export type SensitiveLevel = "Standard" | "Sensitive";

export type ActionType =
  | "Read"
  | "Write"
  | "Send"
  | "Delete"
  | "Upload"
  | "Download"
  | "Modify Calendar"
  | "Browser Action"
  | "Payment/Purchase";

export type RiskLevel = "Low" | "Medium" | "High" | "Sensitive";

export type TriggerType =
  | "Schedule"
  | "Webhook"
  | "RSS Feed"
  | "Email Received"
  | "Email Label Applied"
  | "Text Message Received"
  | "Email Reply Received"
  | "Calendar Event Created"
  | "Calendar Event Changed"
  | "Calendar Event Starting"
  | "Calendar Event Ended"
  | "File Changed"
  | "Note Updated"
  | "Shortcut/Siri Placeholder"
  | "Location Placeholder"
  | "Manual"
  | "Agent-to-Agent";

export type RunStatus =
  | "Queued"
  | "Running"
  | "Waiting for Approval"
  | "Completed"
  | "Failed"
  | "Cancelled"
  /** WP-101 (sibling slice): a run whose required steps all succeeded but at least
   *  one optional/soft-fail step didn't — terminal, and never presented as full
   *  success. See runStatusView / mapRunStatus in src/store/useStore.ts. */
  | "Partly Done";

/* ----------------------------------------------------------------------- */
/* One run world (WP-003 / ISS-005/009/011/016)                            */
/* Every run — from every source — is shown with ONE status vocabulary,     */
/* derived by a single total mapper (runStatusView, src/store/useStore.ts)  */
/* over the FULL server run-status enum. Chips render label + CTA from this  */
/* view, never a raw status string.                                         */
/* ----------------------------------------------------------------------- */
export type RunStatusTone = AccentColor | "gray";
/** A one-tap next step for a parked run — deep-links to where the human acts. */
export interface RunStatusCta {
  label: string;
  screen: ScreenId;
  params?: Record<string, string>;
}
export interface RunStatusView {
  /** Cause-specific human label, e.g. "Needs approval", "Needs a connection". */
  label: string;
  tone: RunStatusTone;
  /** Parked = actionable pause (approval / connector / provider). */
  parked: boolean;
  /** Terminal = the run will not change again on its own. */
  terminal: boolean;
  /** Active = queued / running / retrying. */
  active: boolean;
  /** Where the human goes to unblock or review the run. */
  cta?: RunStatusCta;
}

export type MessageChannel = "In-App" | "Email Placeholder" | "Text Placeholder" | "Family Dashboard";
export type SenderType = "agent" | "user" | "member" | "system";
export type DeliveryStatus = "Draft" | "Sent" | "Delivered" | "Awaiting Approval" | "Failed";

export type KnowledgeType =
  | "Custom Instruction"
  | "Family Fact"
  | "Preference"
  | "Important Contact"
  | "Template"
  | "Rule"
  | "Saved Answer"
  | "Reference Note";

export type MiniAppType =
  | "Chore Board"
  | "Trip Planner"
  | "Budget Snapshot"
  | "Grocery List"
  | "Medical Tracker"
  | "Subscription Tracker"
  | "Research Comparison"
  | "Custom";

export type MemoryType =
  | "Fact"
  | "Preference"
  | "Routine"
  | "Rule"
  | "Contact"
  | "Insight";

export type ApprovalStatus =
  | "Pending"
  | "Executing"
  | "Approved"
  | "Execution Failed"
  | "Denied"
  | "Edited Before Approval"
  | "Changes Requested"
  | "Expired";

export type ActivityStatus = "success" | "warning" | "error" | "info" | "pending";

// WP-106/ISS-112: "list" was missing here even though the store has always held such
// tasks — useStore's mapTask CASTS the server's type through (`t.type as Task["type"]`),
// so grocery/packing items sat in `data.tasks` as a type the model claimed impossible.
// That is why counts and lists disagreed: a surface filtering by type couldn't reason
// about items the type system said were not there. The model now admits what it stores.
export type TaskType = "chore" | "reminder" | "task" | "errand" | "bill" | "list";
export type TaskStatus = "todo" | "in-progress" | "done" | "needs-help";
export type Priority = "low" | "medium" | "high";

export type BrowserStepAction =
  | "open"
  | "navigate"
  | "fill"
  | "click"
  | "extract"
  | "upload"
  | "download"
  | "screenshot"
  | "login-handoff"
  | "captcha"
  | "submit";

export type BrowserStatus =
  | "Idle"
  | "Running"
  | "Awaiting Login"
  | "Awaiting CAPTCHA"
  | "Awaiting Approval"
  | "Completed"
  | "Failed";

export type SandboxStatus = "Queued" | "Running" | "Needs Approval" | "Completed" | "Failed";
export type LogLevel = "info" | "warn" | "error" | "success";

export type FileType =
  | "PDF"
  | "DOCX"
  | "TXT"
  | "MD"
  | "CSV"
  | "XLSX"
  | "Image"
  | "Audio"
  | "Video"
  | "ZIP";

/* ----------------------------------------------------------------------- */
/* Entities                                                                */
/* ----------------------------------------------------------------------- */

export interface ContactMethod {
  id: string;
  memberId: string;
  label: string;
  type: "Email" | "Phone/Text" | "In-App" | "Family Dashboard";
  value: string;
  verified: boolean;
  optInStatus: "Opted In" | "Pending" | "Not Set";
  allowedAgentIds: string[];
}

export interface Member {
  id: string;
  displayName: string;
  role: Role;
  avatarColor: string;
  initials: string;
  relationship: string; // "Parent", "Child", "Grandparent / caregiving contact"...
  spaceIds: string[];
  isCurrentUser?: boolean;
  email?: string;
  /** Server-owned avatar: an uploaded file id OR an `emoji:🦊` curated avatar. */
  photoFileId?: string | null;
  /** Child View only: whether AI chat is enabled for this member (server-enforced). */
  aiEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Space {
  id: string;
  name: string;
  type: SpaceType;
  description: string;
  icon: string; // lucide icon name
  accent: AccentColor;
  memberIds: string[];
  agentIds: string[];
  connectionIds: string[];
  sensitive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AccentColor = "ink" | "sage" | "coral" | "amber" | "sky" | "lavender";

export interface Household {
  id: string;
  name: string;
  ownerMemberId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunRef {
  runId: string;
  at: string;
  status: RunStatus;
  summary: string;
}

export interface Agent {
  id: string;
  /** Present when this agent exists in the durable server registry (hydrated or migrated). */
  serverId?: string;
  name: string;
  icon: string; // lucide icon name
  purpose: string;
  status: AgentStatus;
  spaceId: string;
  ownerMemberId: string;
  templateId?: string;
  instructions: string;
  connectionIds: string[];
  allowedToolIds: string[];
  playbookIds: string[];
  memoryIds: string[];
  knowledgeItemIds: string[];
  fileIds: string[];
  approvalPolicy: ApprovalPolicy;
  safetyLimits: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalPolicy {
  // Low-risk actions that may run without approval
  autoAllow: string[];
  // Actions that always require approval
  alwaysApprove: string[];
}

export interface ConnectionTool {
  id: string;
  name: string;
  description: string;
  actionType: ActionType;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  enabled: boolean;
}

export interface Connection {
  id: string;
  name: string;
  provider: string;
  category: ConnectionCategory;
  status: ConnectionStatus;
  isShared: boolean;
  spaceId?: string;
  ownerMemberId: string;
  description: string;
  icon: string;
  scopes: ConnectionScope[];
  tools: ConnectionTool[];
  sensitiveLevel: SensitiveLevel;
  lastSyncAt?: string;
  futureNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionScope {
  id: string;
  label: string;
  riskTier: "Read-only" | "Low-risk write" | "Medium-risk write" | "High-risk write" | "Sensitive";
  granted: boolean;
}

export interface WorkflowStep {
  id: string;
  order: number;
  label: string;
  detail: string;
  tool?: string;
  needsApproval?: boolean;
  agentName?: string;
}

export interface WorkflowPlan {
  trigger: string;
  inputSources: string[];
  agentId: string;
  agentName: string;
  steps: WorkflowStep[];
  toolsActions: string[];
  approvalGates: string[];
  output: string;
  notifications: string[];
  errorHandling: string;
  activityLogging: string;
}

export interface Automation {
  id: string;
  name: string;
  description: string;
  category: string;
  templateId?: string;
  agentId: string;
  spaceId: string;
  triggerType: TriggerType;
  triggerConfig: {
    schedule?: string;
    frequency?: string;
    filters?: string[];
    sourceConnectionId?: string;
  };
  secondaryTriggers?: { type: TriggerType; detail: string }[];
  enabled: boolean;
  status: "active" | "paused" | "draft" | "error";
  approvalRequired: boolean;
  plan: WorkflowPlan;
  lastRunAt?: string;
  nextRunAt?: string;
  failureCount: number;
  runIds: string[];
  createdAt: string;
  updatedAt: string;
  /** WP-101 s5 (ISS-102/103/110) — result of the server-side activation preflight.
   *  Absent means "never validated" (pre-existing automations, or a validator that
   *  hasn't run yet). "blocked_configuration" must never render or behave as Active. */
  lifecycleState?: "ready" | "blocked_configuration";
  /** Opaque version tag for the compiled manifest the validator checked against. */
  compiledManifestVersion?: string;
  /** Present when lifecycleState is "blocked_configuration" — one entry per unresolved
   *  dependency, in plain language, with an optional screen to fix it on. */
  blockedErrors?: { node: string; kind: string; message: string; repairSurface?: string }[];
  /** WP-102 s1 (ISS-111) — deterministic idempotency key for template instantiation
   *  (templateId + household + a semantic key, never a random uid). Used to detect a
   *  repeat instantiation instead of blindly appending a duplicate. Absent on
   *  automations not created from a template. */
  idempotencyKey?: string;
}

export interface RunStep {
  label: string;
  status: "done" | "running" | "pending" | "blocked" | "skipped";
  detail?: string;
  timestamp?: string;
  agentName?: string;
}

export interface AutomationRun {
  id: string;
  automationId?: string;
  agentId: string;
  triggerLabel: string;
  status: RunStatus;
  /** Raw server run status (the FULL enum) carried through so chips can render a
   *  cause-specific label + CTA via runStatusView. Absent on purely-local/seed runs
   *  (the mapper falls back to the collapsed `status`). */
  serverStatus?: string;
  startedAt: string;
  completedAt?: string;
  inputSummary: string;
  outputSummary: string;
  actionsTaken: string[];
  steps: RunStep[];
  approvalRequestIds: string[];
  subagentRunIds: string[];
  error?: string;
  activityEntryIds: string[];
}

export interface SubagentRun {
  id: string;
  parentRunId: string;
  name: string;
  icon: string;
  taskScope: string;
  status: RunStatus;
  inputSummary: string;
  outputSummary: string;
  resultMerged: boolean;
  effortEstimate: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  senderType: SenderType;
  senderId: string; // agentId / memberId / "system"
  senderName: string;
  body: string;
  channel: MessageChannel;
  deliveryStatus: DeliveryStatus;
  requiresReply: boolean;
  approvalRequestId?: string;
  createdAt: string;
}

export interface MessageThread {
  id: string;
  title: string;
  participantIds: string[]; // member + agent ids
  agentIds: string[];
  spaceId: string;
  status: "open" | "resolved" | "escalated";
  preview: string;
  unread: boolean;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DetectedReceipt {
  vendor: string;
  amount: number;
  date: string;
  category: string;
  needsReview?: boolean;
}

export interface FileAsset {
  id: string;
  name: string;
  type: FileType;
  sizeBytes: number;
  tags: string[];
  ownerMemberId: string;
  spaceId: string;
  uploadedAt: string;
  linkedAgentIds: string[];
  linkedWorkflowIds: string[];
  summary: string;
  detectedDates: string[];
  detectedTasks: string[];
  detectedReceipts?: DetectedReceipt[];
  sourceConnectionId?: string;
  sensitive: boolean;
  searchIndexed: boolean;
  previewContent?: string; // text/CSV/MD content for preview
  dataUrl?: string; // for genuinely uploaded files
  folder: string; // Uploads, Reports, Exports, Reference, Generated...
  createdByAgentId?: string;
  /** Present when this file is backed by a durable server blob (POST /api/files). */
  serverId?: string;
  /** Number of pages/sides stored on the server (e.g. front+back of an ID card). */
  pageCount?: number;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  type: KnowledgeType;
  content: string;
  fileAssetIds: string[];
  tags: string[];
  spaceId: string;
  createdBy: string;
  sensitive: boolean;
  agentReadable: boolean;
  agentEditableRequiresApproval: boolean;
  createdAt: string;
  updatedAt: string;
  /** Present when this item is backed by the durable server Knowledge collection. */
  serverId?: string;
  /** "household" | "personal" — server visibility scope. */
  visibility?: string;
}

export interface PlaybookStep {
  order: number;
  text: string;
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  whenToUse: string;
  steps: PlaybookStep[];
  requiredConnections: string[];
  requiredFileTypes: string[];
  outputFormat: string;
  approvalRules: string[];
  supportingFileIds: string[];
  linkedAgentIds: string[];
  category: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MiniApp {
  id: string;
  name: string;
  type: MiniAppType;
  description: string;
  spaceId: string;
  createdByAgentId?: string;
  data: Record<string, unknown>;
  linkedEntityIds: string[];
  linkedAutomationIds: string[];
  version: number;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEntry {
  id: string;
  agentId: string;
  spaceId: string;
  type: MemoryType;
  title: string;
  content: string;
  tags: string[];
  source: string;
  confidence: number; // 0-1
  userApproved: boolean;
  sensitive: boolean;
  createdAt: string;
  updatedAt: string;
  serverId?: string; // present when this entry is a real, server-owned memory record
}

export interface WebhookEvent {
  id: string;
  webhookId: string;
  receivedAt: string;
  payload: Record<string, unknown>;
  status: "processed" | "failed" | "queued";
  resultSummary: string;
}

export interface Webhook {
  id: string;
  name: string;
  urlPlaceholder: string;
  secretPlaceholder: string;
  agentId: string;
  automationId?: string;
  enabled: boolean;
  schemaDescription: string;
  samplePayload: Record<string, unknown>;
  events: WebhookEvent[];
  targetMiniAppId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  id: string;
  title: string;
  description: string;
  riskLevel: RiskLevel;
  requestedByAgentId: string;
  spaceId: string;
  proposedAction: string;
  dataUsedSummary: string;
  recipientSummary: string;
  previewContent: string;
  status: ApprovalStatus;
  decisionByMemberId?: string;
  decisionAt?: string;
  relatedRunId?: string;
  relatedThreadId?: string;
  category: "Email" | "Calendar" | "Subscription" | "Browser" | "File" | "Message" | "Form" | "Purchase";
  /** When this approval gates a real backend tool, it is bound to a server-side
   * approval record; approving decides + executes that record (consume-once). */
  toolId?: string;
  toolInput?: Record<string, unknown>;
  connectorId?: string;
  backendApprovalId?: string;
  /** True when this approval gates a step inside a durable SERVER run. The server
   * resumes + executes the step on approval — the client must NOT re-execute it. */
  serverManaged?: boolean;
  /** Real result recorded after an approved tool executes (or its failure reason). */
  executionResult?: string;
  executionOk?: boolean;
  executionStartedAt?: string;
  executionEndedAt?: string;
  executionMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  actorType: "agent" | "user" | "automation" | "system" | "webhook";
  actorId: string;
  actorName: string;
  actionType: string;
  description: string;
  entityType?: string;
  entityId?: string;
  spaceId?: string;
  status: ActivityStatus;
  metadata?: Record<string, unknown>;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt?: string;
  location?: string;
  spaceId: string;
  memberIds: string[];
  category: string;
  movable: boolean;
  source: string;
  notes?: string;
  /** Server-owned rich family-event fields (P4.1) + calendar layer (P4.2). Optional so
   *  local/demo events without them still typecheck; populated when hydrated from the server. */
  serverId?: string;
  layer?: "canonical" | "linked" | "public";
  visibility?: string;
  ownerId?: string | null;
  /** Server verdict: may the CURRENT member edit this event? */
  editable?: boolean;
  driverId?: string | null;
  whatToBring?: { item: string; memberId: string | null }[];
  checklist?: { text: string; done: boolean }[];
  /** Sync provenance (Google push/merge state). `conflict` present = both sides changed
   *  since the last push/merge and a human must pick a version (Calendar drawer). */
  provenance?: {
    googleEventId?: string | null;
    conflict?: { at: number; googleUpdated: string | null; google: { title?: string; startAt?: string | null; endAt?: string | null; location?: string } } | null;
    [k: string]: unknown;
  } | null;
}

export interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  dueAt?: string;
  assignedMemberId?: string;
  spaceId: string;
  priority: Priority;
  amount?: number; // for bills
  source: "user" | "agent" | "automation";
  createdByAgentId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  /** Server-owned fields (P1.2). Optional for local/demo tasks. */
  serverId?: string;
  visibility?: string;
  listName?: string;
}

export interface BrowserStep {
  id: string;
  order: number;
  action: BrowserStepAction;
  label: string;
  status: "pending" | "running" | "done" | "skipped" | "blocked";
  detail?: string;
  needsApproval?: boolean;
  timestamp?: string;
}

export interface BrowserWorkflow {
  id: string;
  name: string;
  agentId: string;
  spaceId: string;
  status: BrowserStatus;
  startUrl: string;
  currentUrl: string;
  steps: BrowserStep[];
  requiresLogin: boolean;
  sessionSaved: boolean;
  credentialsWarning: string;
  approvalRequestId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SandboxLog {
  time: string;
  level: LogLevel;
  message: string;
}

export interface SandboxOutput {
  name: string;
  type: FileType;
  sizeBytes: number;
}

export interface SandboxRun {
  id: string;
  name: string;
  agentId: string;
  spaceId: string;
  status: SandboxStatus;
  description: string;
  inputFileIds: string[];
  outputs: SandboxOutput[];
  logs: SandboxLog[];
  summary: string;
  progress: number; // 0-100
  scriptSaved: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ----------------------------------------------------------------------- */
/* Catalog (static-ish) entities                                           */
/* ----------------------------------------------------------------------- */

export interface WorkflowTemplate {
  id: string;
  name: string;
  category: string;
  prompt: string;
  recommendedAgent: string;
  recommendedAgentTemplateId?: string;
  requiredConnections: string[];
  optionalConnections: string[];
  triggerType: TriggerType;
  approvalRequirements: string[];
  fileProcessingNeeds: string[];
  browserNeeds: string;
  outputFormat: string[];
  exampleOutput: string[];
  activityLogEvents: string[];
  failureStates: string[];
  setupChecklist: string[];
  multiAgent?: { name: string; icon: string; role: string }[];
}

export interface AgentTemplate {
  id: string;
  name: string;
  icon: string;
  category: string;
  purpose: string;
  description: string;
  defaultSpaceType: SpaceType;
  suggestedTriggers: string[];
  suggestedConnections: string[];
  suggestedPlaybooks: string[];
  sampleOutputs: string[];
  defaultApprovalRules: string[];
  defaultInstructions: string;
  defaultAutoAllow: string[];
}

/**
 * WP-005 — a packaged Helper Agent template.
 *
 * The unified surface treats an agent as ONE package: instructions + suggested
 * skills + a trigger/schedule + tools + approval gates. This is the merged shape
 * of the three legacy catalogs (agentTemplates + workflowTemplates + playbooks),
 * built in src/data/packagedTemplates.ts. Additive — the legacy AgentTemplate /
 * WorkflowTemplate types are unchanged and still power the flag-off flows.
 */
export interface PackagedTemplate {
  id: string;
  name: string;
  icon: string;
  category: string;
  /** One-line purpose shown on the catalog card. */
  summary: string;
  description: string;
  /** Agent instructions the package seeds. */
  instructions: string;
  defaultSpaceType: SpaceType;
  /** Primary trigger/schedule the package suggests. */
  trigger: { type: TriggerType; detail: string };
  /** Bundled skills/playbooks/workflows, by display name. */
  suggestedSkills: string[];
  /** Connectors / tools the package wants attached. */
  suggestedConnections: string[];
  approvalRules: string[];
  autoAllow: string[];
  /**
   * When set, "New agent" builds from this legacy AgentTemplate id (full-fidelity
   * path). Absent for packages distilled purely from a workflow template — those
   * are built directly from the fields above.
   */
  agentTemplateId?: string;
  /** Provenance — which legacy catalog entries this package folds in (dedupe map). */
  sources: {
    agentTemplateIds: string[];
    workflowTemplateIds: string[];
    playbookIds: string[];
  };
}

/* ----------------------------------------------------------------------- */
/* Settings & meta                                                         */
/* ----------------------------------------------------------------------- */

export interface AIProviderConfig {
  activeProvider: "local" | "openai" | "anthropic" | "gemini";
  providers: {
    id: "local" | "openai" | "anthropic" | "gemini";
    label: string;
    enabled: boolean;
    apiKeyPlaceholder: string;
    note: string;
  }[];
}

export interface AppSettings {
  theme: "warm" | "warm-contrast";
  notifications: {
    inApp: boolean;
    emailDigest: boolean;
    textAlerts: boolean;
  };
  privacy: {
    sensitiveMemoryStaysInSpace: boolean;
    requireApprovalForExternal: boolean;
  };
  ai: AIProviderConfig;
  soloProfessionalMode: boolean;
}

/* ----------------------------------------------------------------------- */
/* Aggregate persisted data                                                */
/* ----------------------------------------------------------------------- */

/* ----------------------------------------------------------------------- */
/* Assistant — the conversational NL → plan → approval → execution loop     */
/* ----------------------------------------------------------------------- */

export type AssistantMessageStatus = "thinking" | "streaming" | "answered" | "planned" | "running" | "done" | "error" | "built";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  /** Present when the assistant proposed an executable plan. */
  plan?: AgentPlan;
  /** Present when the assistant proposed durable entities to build (unified chat-builder). */
  build?: ChatBuild;
  /** IDs created when a build proposal was approved (so the card can show "built"). */
  builtIds?: { skillId?: string; agentId?: string; triggerId?: string };
  /** Live per-entity progress while a build is materializing (entity keys done so far). */
  buildProgress?: string[];
  /** Set once the plan has been dispatched — links to an AutomationRun in `runs`. */
  runId?: string;
  status?: AssistantMessageStatus;
  error?: string;
  model?: string;
  /** Server message kind carried through hydration: "status" | "run_result" | "error" | … */
  kind?: string;
  /** WP-002: a run_result that drafted an artifact carries its id + link so the thread
   *  can render a real "Review draft" action instead of sending the family to Activity. */
  artifactId?: string;
  artifactLink?: string;
  /** Set on a run_result whose outcome created/updated a task (→ "View task"). */
  taskId?: string;
  /** Set on a parked "status" message so the thread can deep-link to the approval. */
  approvalId?: string;
  /** WP-004/WP-003 bonus: every created task/list-item/artifact a run_result produced,
   *  each a one-tap deep link (kind:"task" → mini-apps/tasks, kind:"artifact" →
   *  Files & Knowledge). Additive alongside the legacy artifactId/artifactLink above. */
  links?: { kind: "task" | "artifact"; id: string; label: string }[];
}

export interface AssistantConversation {
  id: string;
  serverId?: string; // set when the thread is server-owned (durable); absent for offline-only threads
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AssistantMessage[];
}

/* ----------------------------------------------------------------------- */
/* Evolution — evidence-backed skill/agent improvement proposals from runs  */
/* ----------------------------------------------------------------------- */

export interface EvolutionProposal {
  id: string;
  kind: "skill" | "agent" | "tool" | "function";
  agentId?: string;
  agentName?: string;
  skillId?: string;
  skillName?: string;
  functionId?: string;
  toolId?: string;
  runId: string;
  title: string;
  reason: string;   // evidence: what in the run trace prompted this
  summary: string;  // the proposed improvement, in plain language
  before?: string;  // current instructions (when kind === "agent" | "skill")
  after?: string;   // proposed instructions / tool-usage tip
  risk: "Low" | "Medium" | "High";
  source: "trace" | "ai"; // deterministic trace analysis vs. LLM-enriched
  status: "pending" | "accepted" | "rejected";
  createdAt: string | number;
  reviewedAt?: number;
  reviewedBy?: string;
  model?: string;
}

export interface AppData {
  schemaVersion: number;
  seededAt: string;
  household: Household;
  members: Member[];
  contactMethods: ContactMethod[];
  spaces: Space[];
  agents: Agent[];
  automations: Automation[];
  runs: AutomationRun[];
  subagentRuns: SubagentRun[];
  threads: MessageThread[];
  messages: Message[];
  files: FileAsset[];
  knowledge: KnowledgeItem[];
  playbooks: Playbook[];
  miniApps: MiniApp[];
  memories: MemoryEntry[];
  approvals: ApprovalRequest[];
  activity: ActivityLogEntry[];
  events: CalendarEvent[];
  tasks: Task[];
  settings: AppSettings;
  /** Assistant conversations (optional — defaults to [] for pre-existing stores). */
  conversations?: AssistantConversation[];
  /** Evolution proposals from run traces (optional — defaults to []). */
  evolutions?: EvolutionProposal[];
}

/* ----------------------------------------------------------------------- */
/* Navigation / search                                                     */
/* ----------------------------------------------------------------------- */

export type ScreenId =
  | "dashboard"
  | "assistant"
  | "agents"
  | "automations"
  | "skills"
  | "functions"
  | "connections"
  | "messages"
  | "files"
  | "miniapps"
  | "spaces"
  | "meals"
  | "calendar"
  | "playbooks"
  | "activity"
  | "settings";

export interface Route {
  screen: ScreenId;
  params?: Record<string, string>;
}

export interface SearchResult {
  id: string;
  title: string;
  type: string;
  summary: string;
  tags: string[];
  spaceId?: string;
  agentId?: string;
  updatedAt?: string;
  route: Route;
  icon: string;
}
