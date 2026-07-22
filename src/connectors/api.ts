/**
 * Frontend client for the FamiliOS backend control plane (server/index.mjs,
 * proxied at /api). The backend owns sessions, secrets, OAuth, approvals, tool
 * execution, webhooks, jobs, AI providers, and audit. The frontend holds no
 * credentials, never bypasses approvals, and reflects exactly what the backend
 * reports. Mutations are sent same-origin with the session's CSRF token.
 */

export type Readiness =
  | "not_installed"
  | "not_configured"
  | "needs_auth"
  | "authorized_readonly"
  | "authorized_write"
  | "connected"
  | "degraded"
  | "error"
  | "revoked"
  | "local_only"
  | "runtime_unavailable";

export interface ConnectorToolInput {
  key: string;
  label: string;
  type?: "text" | "textarea" | "json";
  placeholder?: string;
  required?: boolean;
  default?: string;
}
export interface ConnectorTool {
  id: string;
  name: string;
  action: string;
  risk: "Low" | "Medium" | "High" | "Sensitive";
  requiresApproval: boolean;
  description: string;
  runtime?: string;
  inputs?: ConnectorToolInput[];
}
export interface ConnectorTrigger { id: string; name: string; type: string; description: string }
export interface ConnectorConfigField {
  key: string;
  label: string;
  type: "text" | "secret";
  required?: boolean;
  placeholder?: string;
  default?: string;
  env?: string;
}
export interface ConnectorHealth { ok: boolean; status: string; error: string | null; at: string; code: number | null }
export interface BackendConnector {
  id: string;
  name: string;
  provider: string;
  category: string;
  authType: "none" | "apiKey" | "oauth2" | "signature" | "runtime";
  runtime: "backend" | "client" | "browser-automation";
  risk: "Low" | "Medium" | "High" | "Sensitive";
  description: string;
  configSchema: ConnectorConfigField[];
  config: Record<string, string>;
  tools: ConnectorTool[];
  triggers: ConnectorTrigger[];
  endpoint: string | null;
  readiness: Readiness;
  health: ConnectorHealth | null;
  live: boolean;
  updatedAt: string | null;
}
export interface BackendHealth {
  ok: boolean;
  version: string;
  time: string;
  runtime: string;
  env: string;
  browserRuntime: boolean;
  externalActionsEnabled: boolean;
  webhookBaseUrl: string;
  authRequired: boolean;
}
export interface ExecResult { ok: boolean; result?: unknown; error?: string; message?: string; readiness?: Readiness }
export interface WebhookEvent { id: string; receivedAt: string; payload: Record<string, unknown>; source: string; verified: boolean }
export interface BackendJob { id: string; name: string; connectorId: string; intervalMs: number; lastRun: number | null; nextRun: number | null; lastStatus: string; enabled: boolean }
export interface AuditEvent { id: string; at: string; type: string; ok: boolean; actorId?: string; actorName?: string; connectorId?: string; toolId?: string; error?: string; origin?: string }
export interface Session { actorId: string; actorName: string; role: string; csrf: string; householdId: string }
/* ---- Connector platform (first-party OAuth providers + per-user accounts) ---- */
export interface ProviderScope { key: string; label: string; risk: string }
export interface ProviderTool { id: string; name: string; action: string; risk: "Low" | "Medium" | "High" | "Sensitive"; requiresApproval: boolean; scopes: string[]; inputs: ConnectorToolInput[] }
export interface ConnectedAccount {
  id: string; provider: string; displayName: string; scopes: string[];
  status: "connected" | "degraded" | "needs_reconnect" | "revoked";
  connectedByActorId: string; householdId: string;
  lastHealthAt: string | null; lastHealthOk: boolean | null; createdAt: string; updatedAt: string;
}
export interface ConnectorProvider {
  id: string; name: string; category: string; authType: string;
  readiness: "configured" | "not_configured_by_deployment";
  clientIdEnv: string; clientSecretEnv: string;
  scopes: ProviderScope[]; tools: ProviderTool[]; accounts: ConnectedAccount[];
}
export interface BackendApproval { id: string; connectorId: string; toolId: string; status: string; risk: string; category: string; preview: string; createdAt: number; expiresAt: number; decidedBy: string | null; decidedAt: number | null }
export interface AIProvider {
  id: string; name: string; kind: "cloud" | "local"; local: boolean; needsKey: boolean;
  // keyOptional: a local provider (e.g. LM Studio) that runs fine with no key but can
  // ALSO be gated behind a bearer token depending on the build — Settings offers the
  // field, but nothing requires it the way needsKey does.
  keyOptional: boolean; needsBaseUrl: boolean;
  docs: string; defaultBaseUrl: string; defaultModel: string; baseUrl: string; model: string; keySet: boolean;
  // Truthful readiness vocabulary (P1.3): a default URL/key alone is not proof of reachability.
  readiness: "not_configured" | "needs_health_check" | "configured" | "healthy" | "unreachable";
  health?: { ok: boolean; status: string; at: number | null; latencyMs: number | null } | null;
  active: boolean; updatedAt: string | null;
}
export interface AIHealth { ok: boolean; status?: string; message?: string; hint?: string; models?: string[]; modelCount?: number; latencyMs?: number }
export interface AIChatResult { ok: boolean; model?: string; text?: string; error?: string; message?: string }

/* ---- Planner brain (plain English → plan / mini app / playbook) ---- */
export interface PlanStep {
  toolId: string | null;
  title: string;
  detail: string;
  requiresApproval: boolean;
  risk: "Low" | "Medium" | "High" | "Sensitive";
  connectorId: string | null;
  connectorName: string | null;
  connected: boolean;
  input: Record<string, unknown>;
}
export interface RequiredConnector { id: string; name: string; connected: boolean }
export interface AgentPlan {
  title: string;
  summary: string;
  icon: string;
  spaceType: string;
  triggerType: string;
  triggerDetail: string;
  instructions: string;
  steps: PlanStep[];
  connectorIds: string[];
  requiredConnectors: RequiredConnector[];
  missing: string[];
  approvalGates: string[];
  risk: "Low" | "Medium" | "High" | "Sensitive";
  approvalRequired: boolean;
}
export interface PlanResult { ok: boolean; plan?: AgentPlan; model?: string; error?: string; message?: string }
export interface GeneratedMiniApp { type: string; name: string; description: string; data: Record<string, unknown> }
export interface MiniAppGenResult { ok: boolean; app?: GeneratedMiniApp; model?: string; error?: string; message?: string }
export interface GeneratedPlaybook { name: string; description: string; whenToUse: string; category: string; steps: string[]; requiredConnections: string[]; outputFormat: string; approvalRules: string[] }
export interface PlaybookGenResult { ok: boolean; playbook?: GeneratedPlaybook; model?: string; error?: string; message?: string }
/* ---- Durable server-side runs (the canonical runtime; browser observes only) ---- */
export interface RunToolCall { at: string; ok: boolean; error: string | null; durationMs: number; approvalId: string | null; resultSummary: string }
export interface RunStepView {
  index: number; toolId: string | null; functionId: string | null; title: string; detail: string;
  requiresApproval: boolean; risk: string; connectorId: string | null; connectorName: string | null;
  attribution: string; status: string; approvalId: string | null; attempts: number; input: Record<string, unknown>;
  result: unknown; toolCalls: RunToolCall[]; startedAt: number | null; finishedAt: number | null;
}
export interface ServerRun {
  id: string; householdId: string; actorId: string; source: string; sourceRef: Record<string, unknown>;
  title: string; summary: string; status: string; cursor: number; error: string | null;
  createdAt: number; updatedAt: number; startedAt: number | null; finishedAt: number | null;
  steps: RunStepView[];
}
export interface StartRunInput {
  plan?: { title?: string; summary?: string; steps: { toolId: string | null; title: string; detail?: string; input?: Record<string, unknown> }[] };
  skillId?: string; params?: Record<string, unknown>; source?: string; sourceRef?: Record<string, unknown>;
}
/* ---- Server-side skill registry ---- */
export interface SkillInputField { key: string; label: string; type: string; required: boolean; default?: string }
export interface SkillStep {
  step_id: string;
  name: string;
  description?: string;
  tool_id: string | null;
  input_mapping: Record<string, unknown>;
  approval_required: boolean;
  retry_policy?: { maxAttempts: number };
  timeout_ms?: number;
}
export interface ServerSkill {
  id: string;
  householdId: string;
  name: string;
  description: string;
  domain: string;
  type: string;
  mode: "deterministic" | "planner-assisted" | "hybrid";
  defaultAgentId: string | null;
  planner_guidance: string;
  input_schema: SkillInputField[];
  output_schema: { key: string; label: string; type: string }[];
  required_connectors: string[];
  required_tools: string[];
  required_functions: string[];
  optional_tools: string[];
  optional_functions: string[];
  steps: SkillStep[];
  approval_policy: { gates?: string[] };
  risk_level: "Low" | "Medium" | "High" | "Sensitive";
  memory_policy: { scope?: string };
  test_cases: { name?: string; params: Record<string, unknown> }[];
  version: number;
  status: "draft" | "available" | "needs_function" | "deprecated";
  system?: boolean;
  createdAt: number;
  updatedAt: string;
}
export interface SkillVersion extends ServerSkill { snapshotAt: string }

/* ---- Server-side function/tool registry (Slice 4) ---- */
export type FunctionType =
  | "connector_api" | "internal" | "custom_http" | "ai_local"
  | "browser" | "sandbox_script" | "workflow_composed";
export type FunctionState =
  | "draft" | "needs_schema" | "needs_connector" | "needs_secret" | "needs_runtime"
  | "untested" | "testing" | "test_failed" | "available" | "degraded" | "deprecated";
export interface FunctionField { key: string; label: string; type: string; required?: boolean; default?: string }
export interface ServerFunction {
  id: string;
  householdId: string;
  name: string;
  description: string;
  type: FunctionType;
  action: string;
  risk: "Low" | "Medium" | "High" | "Sensitive";
  approval_required: boolean;
  input_schema: FunctionField[];
  output_schema: FunctionField[];
  config: Record<string, unknown>;
  status: "draft" | "available" | "deprecated";
  lastTest: { ok: boolean; at: number; summary?: string; error?: string; input?: unknown } | null;
  system?: boolean;
  version: number;
  createdAt: number;
  updatedAt: string;
  // server-computed, redacted view fields
  state: FunctionState;
  stateReason: string;
  requiresApproval: boolean;
  effectiveAction: string;
  effectiveRisk: string;
  connectorId: string | null;
  connectorName: string | null;
  hasSecret: boolean;
  executable: boolean;
}
export interface FunctionVersion extends Omit<ServerFunction, "state" | "stateReason" | "requiresApproval" | "effectiveAction" | "effectiveRisk" | "connectorId" | "connectorName" | "hasSecret" | "executable"> { snapshotAt: string }
// Item 13: a drafted (not-yet-created) function definition for the builder to pre-fill.
export interface DraftedFunction {
  name: string; description: string; type: FunctionType; action: string;
  risk: "Low" | "Medium" | "High" | "Sensitive"; approval_required: boolean;
  input_schema: FunctionField[]; output_schema: FunctionField[];
}
export interface ToolCatalogEntry {
  toolId: string; name: string; action: string; risk: string; requiresApproval: boolean;
  connectorId: string; connectorName: string; source: "provider" | "connector"; connected: boolean;
  readiness?: string; inputs: { key: string; label: string; type: string; required: boolean; default?: string }[];
}
export interface ToolCatalogResult { tools: ToolCatalogEntry[]; types: FunctionType[]; states: FunctionState[] }
export interface FunctionTestResult {
  ok: boolean; result?: unknown; error?: string; message?: string; needsConfirm?: boolean; function?: ServerFunction;
}

/* ---- Server-side agent registry (Slice 5) ---- */
export interface ServerAgent {
  id: string;
  householdId: string;
  name: string;
  icon: string;
  purpose: string;
  instructions: string;
  status: "Active" | "Paused" | "Draft" | "Needs Attention" | "Archived";
  spaceType: string;
  system?: boolean;
  skillIds: string[];
  allowedToolIds: string[];
  allowedFunctionIds: string[];
  deniedToolIds: string[];
  deniedFunctionIds: string[];
  approvalPolicy: { autoAllow: string[]; alwaysApprove: string[] };
  triggers: unknown[];
  version: number;
  createdAt: number;
  updatedAt: string;
}
export interface AgentVersion extends ServerAgent { snapshotAt: string }
export interface AgentContext {
  agentId: string;
  openAllowList: boolean;
  tools: { toolId: string; name: string; connectorName: string; action: string; requiresApproval: boolean; available: boolean; permitted: boolean; denied: boolean }[];
  functions: { id: string; name: string; type: string; requiresApproval: boolean; available: boolean; state: string; permitted: boolean; denied: boolean }[];
  executable: string[];
  permittedCount: number;
  executableCount: number;
}

/* ---- Server-side triggers (Slice 6) ---- */
export type TriggerType = "schedule" | "recurring" | "webhook" | "connector_event" | "manual";
export interface TriggerTarget { kind: "agent" | "skill"; agentId?: string | null; skillId?: string | null; goal?: string | null; params?: Record<string, unknown> }
export interface ServerTrigger {
  id: string;
  householdId: string;
  name: string;
  type: TriggerType;
  enabled: boolean;
  target: TriggerTarget;
  intervalMs: number | null;
  nextRunAt: number | null;
  connectorId: string | null;
  event: string | null;
  lastFiredAt: number | null;
  lastRunId: string | null;
  lastStatus: string | null;
  lastTriggerType: string | null;
  fireCount: number;
  webhookPath: string | null;
  hasSecret: boolean;
  createdAt: number;
  updatedAt: string;
}

export interface InferFunctionsResult {
  ok: boolean;
  model?: string;
  suggestedToolIds?: string[];
  missingCapabilities?: string[];
  suggestedSteps?: SkillStep[];
  error?: string;
  message?: string;
}

/* ---- Assistant (conversational NL → answer | plan, executed via a server run) ---- */
// Unified chat-builder: a proposed set of durable entities to stand up from one chat turn.
export interface ChatBuildStep { step_id?: string; name: string; tool_id: string | null; approval_required: boolean }
export interface ChatBuildEdit { kind: "agent" | "skill"; id: string; summary?: string; patch: Record<string, unknown> }
export interface ChatBuild {
  summary: string;
  skill?: { name: string; description?: string; domain?: string; planner_guidance?: string; risk_level?: string; steps?: ChatBuildStep[] };
  agent?: { name: string; purpose?: string; instructions?: string } | null;
  automation?: { name: string; type: string; intervalMs?: number | null; runAt?: string | null } | null;
  edits?: ChatBuildEdit[];
}
export interface BuildProgress { type: "progress"; entity: "skill" | "agent" | "automation"; action: string; id: string; name?: string; status?: string; version?: number; ok?: boolean }
export interface BuildResult {
  ok: boolean;
  created?: {
    skill?: { id: string; name: string; status: string };
    agent?: { id: string; name: string; status: string };
    automation?: { id: string; name: string; type: string; enabled: boolean };
  };
  updated?: { kind: string; id: string; name?: string; version?: number; ok: boolean; error?: string }[];
  notes?: string[]; error?: string; message?: string;
}
export interface AssistantResult { ok: boolean; kind?: "answer" | "plan" | "build"; answer?: string; plan?: AgentPlan; build?: ChatBuild; runId?: string | null; run?: ServerRun | null; model?: string; error?: string; message?: string }
/* ---- Evolution (LLM enrichment of a run-trace improvement proposal) ---- */
export interface EvolutionProposalResult { ok: boolean; proposal?: { title: string; reason: string; summary: string; after?: string; risk: "Low" | "Medium" | "High" }; model?: string; error?: string; message?: string }
export interface ServerEvolution {
  id: string;
  kind: "skill" | "agent" | "tool" | "function";
  householdId?: string;
  agentId?: string | null;
  agentName?: string | null;
  skillId?: string | null;
  functionId?: string | null;
  toolId?: string | null;
  runId: string;
  status: "pending" | "accepted" | "rejected";
  source: "trace" | "ai";
  title: string;
  reason: string;
  summary: string;
  before?: string;
  after?: string;
  risk?: "Low" | "Medium" | "High";
  /** Auto-approval (server-side, when settings.autoApproveImprovements is on and the
   *  proposal is low-risk): the change was applied without a human. `autoReason` explains why. */
  autoApproved?: boolean;
  autoReason?: string;
  model?: string;
  createdAt: number;
  updatedAt: string;
  reviewedAt?: number;
  reviewedBy?: string;
}

/* ---- server-owned family data (P1/P4) ---- */
export interface ServerEvent {
  id: string; householdId: string; title: string; startAt: string | null; endAt: string | null;
  location: string; notes?: string; spaceId: string; participantIds: string[]; driverId: string | null;
  ownerId: string | null; backupOwnerId: string | null;
  /** May the CURRENT member edit this event? (canonical → adult/owner; linked Google →
   *  only the member who connected that account). Server-computed per session. */
  editable?: boolean;
  whatToBring: { item: string; memberId: string | null }[]; checklist: { text: string; done: boolean }[];
  travel: unknown; reminders: unknown[]; attachments: unknown[]; comments: unknown[]; mealImpact: unknown;
  visibility: string; category: string; layer: "canonical" | "linked" | "public"; status: string;
  source: string; provenance?: Record<string, unknown>; createdBy: string; createdAt: number; updatedAt: string;
}
export interface ServerTask {
  id: string; householdId: string; title: string; type: string; status: string; dueAt: string | null;
  assignedMemberId: string | null; spaceId: string; priority: string; amount: number | null;
  visibility: string; notes: string; listName?: string; source: string; createdBy: string;
  createdAt: string; updatedAt: string; mealId?: string | null;
}
export interface ServerMember { actorId: string; displayName: string; role: string; relationship: string | null; spaceIds: string[]; isCurrentUser: boolean; color?: string | null; photoFileId?: string | null; aiEnabled?: boolean }
export interface CalendarSubscription { id: string; name: string; url: string | null; source: string; lastSyncAt: number | null; lastResult: { imported?: number; updated?: number; removed?: number; error?: string } | null; eventCount: number; createdAt: number; accountId?: string | null; accountEmail?: string | null; ownerActorId?: string | null; ownerName?: string | null }
export interface CalendarSync { ok: boolean; imported?: number; updated?: number; removed?: number; total?: number; error?: string }
/** One-button calendar sync: re-syncs every subscription AND pulls Google-side edits. */
export interface CalendarSyncAllResult {
  ok?: boolean; synced?: number; imported?: number; updated?: number; removed?: number;
  pulled?: { checked?: number; merged?: number; conflicts?: number; unlinked?: number };
  errors?: number | string[]; error?: string; message?: string;
}
/* ---- help requests ("can you pick up the girls?" — human-to-human asks) ---- */
export interface HelpRequest {
  id: string; fromActorId: string; fromName: string; toActorId: string; toName: string;
  message: string; eventId: string | null; taskId: string | null;
  /** "ask" = from-actor asks the recipient to help with the from-actor's item;
   *  "offer" = from-actor offers to help with the recipient's item. Server default "ask". */
  kind?: "ask" | "offer";
  status: "pending" | "accepted" | "declined" | "cancelled";
  responseNote: string | null; createdAt: string; respondedAt: string | null;
}
export interface MealIngredient { item: string; have?: boolean }
export interface Meal { id: string; householdId: string; date: string | null; time?: string | null; slot: string; title: string; notes: string; ingredients: MealIngredient[]; instructions?: string[]; servings?: number | null; recipeUrl?: string; visibility: string; source: string; createdBy: string; createdAt: string; updatedAt: string }
export interface ServerConversationMessage { role: "user" | "assistant"; text: string; kind?: string; plan?: AgentPlan | null; build?: ChatBuild | null; built?: boolean; builtIds?: { skillId?: string; agentId?: string; triggerId?: string }; model?: string | null; at: string }
export interface ServerConversation { id: string; householdId: string; actorId: string; title: string; messages: ServerConversationMessage[]; createdAt: string; updatedAt: string }
export interface ServerMemory { id: string; householdId: string; scope: string; type: string; text: string; createdAt: number; source?: { runId?: string; actorId?: string } }
/* ---- WP-007 retrieval-quality memory (DEC-014: sqlite-FTS5 fallback, or a real
 * Supermemory sidecar when configured — see server/memory-provider.mjs) ---- */
export interface MemorySearchResult { id?: string; text: string; scope?: string; type?: string; createdAt?: number }
export interface MemoryProfileSummary { totalMemories: number; byType: Record<string, number>; byScope: Record<string, number>; highlights: MemorySearchResult[] }
export interface MemorySearchResponse { ok: boolean; degraded: boolean; results: MemorySearchResult[]; profile: MemoryProfileSummary | null }
/* ---- Risk-class overrides (item 9): household-set, server-enforced ---- */
export interface RiskOverride { id: string; householdId: string; toolId: string; riskClass: string | null; skipApproval: boolean; setBy: string; setAt: string }
export interface CatalogTool {
  toolId: string; name: string; action: string; risk: string; requiresApproval: boolean;
  connectorId: string; connectorName: string; source: string; connected: boolean;
  riskOverridden?: boolean; defaultRisk?: string; defaultRequiresApproval?: boolean;
}
export interface ServerArtifact { id: string; householdId: string; runId?: string; kind: string; title: string; body?: string; createdAt: number }
/* ---- Durable files (server-owned blobs; multi-page for front+back of IDs) ---- */
export interface ServerFile { id: string; householdId: string; name: string; mime: string; sizeBytes: number; pageCount?: number; pageBlobIds?: string[]; pageNames?: (string | null)[]; tags: string[]; visibility: string; spaceId: string; uploadedBy: string; source: string; createdAt: string }
/* ---- Server-owned Knowledge (user-authored, editable, durable) ---- */
export interface ServerKnowledge { id: string; householdId: string; title: string; type: string; content: string; tags: string[]; visibility: "household" | "personal"; sensitive: boolean; fileIds: string[]; createdBy: string; createdAt: string; updatedAt: string }
/* ---- Interactive email review (item 3): per-message label changes from a run ---- */
export interface EmailReviewMessage { id: string; subject: string; from: string; snippet: string; added: string[]; removed: string[] }
export interface EmailReviewLabel { id: string; name: string; type: string }
export interface EmailReview { runId: string; messages: EmailReviewMessage[]; labels: EmailReviewLabel[]; touchedGmail: boolean }
/* ---- Notifications (item 16b): delivered in-app records ---- */
export interface ServerNotification { id: string; householdId: string; actorId: string; channel: string; title: string; body: string; to: string | null; read: boolean; createdAt: number }
/* ---- Contact methods: the server-owned delivery registry ---- */
export interface ServerContactMethod {
  id: string; householdId: string; memberId: string; label: string;
  type: "Email" | "Phone/Text" | "In-App" | "Family Dashboard"; value: string;
  verified: boolean; optInStatus: "Opted In" | "Pending" | "Not Set";
  allowedAgentIds: string[]; createdBy?: string; createdAt?: string; updatedAt?: string;
}

// CSRF token for the current session (set on login / session bootstrap). Never persisted.
let csrfToken: string | null = null;
export function setCsrf(t: string | null) { csrfToken = t; }

async function req<T>(path: string, init?: RequestInit & { mutation?: boolean }): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init?.headers as Record<string, string> | undefined) };
  if (init?.mutation && csrfToken) headers["x-homeops-csrf"] = csrfToken;
  const res = await fetch(`/api${path}`, { credentials: "same-origin", ...init, headers });
  return (await res.json()) as T;
}

export const backend = {
  /* ---- session ---- */
  async session(): Promise<Session | null> {
    try {
      const r = await req<{ session: Session | null }>("/session");
      setCsrf(r.session?.csrf ?? null);
      return r.session;
    } catch {
      setCsrf(null);
      return null;
    }
  },
  async login(input: { actorId: string; actorName: string; role: string; pin?: string }): Promise<{ session?: Session; error?: string; message?: string }> {
    try {
      const r = await req<{ session?: Session; error?: string; message?: string }>("/session", { method: "POST", body: JSON.stringify(input) });
      if (r.session) setCsrf(r.session.csrf);
      return r;
    } catch { return { error: "backend_unreachable" }; }
  },
  async logout(): Promise<void> {
    try { await req("/session", { method: "DELETE", mutation: true }); } catch { /* ignore */ } finally { setCsrf(null); }
  },

  /* ---- self-serve identity (C1.4): stranger households ---- */
  async loginEmail(email: string, password: string): Promise<{ session?: Session; error?: string; message?: string }> {
    try {
      const r = await req<{ session?: Session; error?: string; message?: string }>("/login", { method: "POST", body: JSON.stringify({ email, password }) });
      if (r.session) setCsrf(r.session.csrf);
      return r;
    } catch { return { error: "backend_unreachable" }; }
  },
  async signup(input: { email: string; password: string; ownerName: string; householdName?: string; inviteToken?: string }): Promise<{ session?: Session; error?: string; message?: string }> {
    try {
      const r = await req<{ session?: Session; error?: string; message?: string }>("/signup", { method: "POST", body: JSON.stringify(input) });
      if (r.session) setCsrf(r.session.csrf);
      return r;
    } catch { return { error: "backend_unreachable" }; }
  },
  async invitePreview(token: string): Promise<{ householdName: string | null; displayName: string; role: string } | null> {
    try { return (await req<{ invite: { householdName: string | null; displayName: string; role: string } }>(`/invites/${encodeURIComponent(token)}/preview`)).invite ?? null; } catch { return null; }
  },
  async createInvite(input: { displayName: string; role: string }): Promise<{ invite?: { token: string; displayName: string; role: string; expiresAt: number }; error?: string }> {
    try { return await req(`/invites`, { method: "POST", body: JSON.stringify(input), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async listInvites(): Promise<{ token: string; displayName: string; role: string; expiresAt: number }[]> {
    try { return (await req<{ invites: { token: string; displayName: string; role: string; expiresAt: number }[] }>(`/invites`)).invites ?? []; } catch { return []; }
  },
  async revokeInvite(token: string): Promise<boolean> {
    try { await req(`/invites/${encodeURIComponent(token)}`, { method: "DELETE", mutation: true }); return true; } catch { return false; }
  },

  async health(): Promise<BackendHealth | null> {
    try { return await req<BackendHealth>("/health"); } catch { return null; }
  },
  async connectors(): Promise<BackendConnector[]> {
    try { return (await req<{ connectors: BackendConnector[] }>("/connectors")).connectors ?? []; } catch { return []; }
  },
  async saveConfig(id: string, values: Record<string, string>): Promise<{ connector?: BackendConnector; error?: string }> {
    try { return await req<{ connector?: BackendConnector; error?: string }>(`/connectors/${id}/config`, { method: "POST", body: JSON.stringify(values), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async revoke(id: string): Promise<BackendConnector | null> {
    try { return (await req<{ connector: BackendConnector }>(`/connectors/${id}/config`, { method: "DELETE", mutation: true })).connector ?? null; } catch { return null; }
  },
  async checkHealth(id: string): Promise<{ ok: boolean; status?: string; latencyMs?: number; error?: string; code?: number }> {
    try { return await req(`/connectors/${id}/health`, { method: "POST", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },

  /* ---- approvals (server-side records) ---- */
  // WP-001: the server-truth feed for Messages » Approvals. Returns every approval this
  // actor may observe (requested by them, or theirs to decide) — including one parked by
  // a durable run that THIS session never started or polled (another device, a scheduled
  // trigger, a prior session). This is the call that was missing; the client previously
  // only ever learned about an approval by mirroring one it happened to be watching.
  async listApprovals(): Promise<BackendApproval[]> {
    try { return (await req<{ approvals: BackendApproval[] }>("/approvals")).approvals ?? []; } catch { return []; }
  },
  async createApproval(input: { toolId: string; connectorId?: string; input: Record<string, unknown>; category?: string; preview?: string }): Promise<{ approval?: BackendApproval; error?: string }> {
    try { return await req("/approvals", { method: "POST", body: JSON.stringify(input), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async decideApproval(id: string, approve: boolean): Promise<{ approval?: BackendApproval; error?: string }> {
    try { return await req(`/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision: approve ? "approve" : "deny" }), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },

  /* ---- tool execution (requires a valid approvalId for gated tools) ---- */
  async execute(toolId: string, input: Record<string, unknown> = {}, opts: { approvalId?: string; accountId?: string } = {}): Promise<ExecResult> {
    try { return await req<ExecResult>(`/tools/${toolId}/execute`, { method: "POST", body: JSON.stringify({ input, approvalId: opts.approvalId, accountId: opts.accountId }), mutation: true }); } catch { return { ok: false, error: "backend_unreachable", message: "Backend runtime is not reachable." }; }
  },

  /* ---- connector platform: providers + per-user connected accounts ---- */
  async providers(): Promise<{ providers: ConnectorProvider[]; redirectUri: string }> {
    try { return await req("/providers"); } catch { return { providers: [], redirectUri: "" }; }
  },
  async accounts(): Promise<ConnectedAccount[]> {
    try { return (await req<{ accounts: ConnectedAccount[] }>("/accounts")).accounts ?? []; } catch { return []; }
  },
  async accountHealth(id: string): Promise<{ ok: boolean; status?: string; detail?: string; latencyMs?: number }> {
    try { return await req(`/accounts/${id}/health`, { method: "POST", mutation: true }); } catch { return { ok: false, status: "backend_unreachable" }; }
  },
  async revokeAccount(id: string): Promise<{ ok: boolean }> {
    try { return await req(`/accounts/${id}`, { method: "DELETE", mutation: true }); } catch { return { ok: false }; }
  },

  async oauthStart(id: string): Promise<{ ok: boolean; url?: string; error?: string; message?: string }> {
    try { return await req(`/oauth/${id}/start`); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  async sendWebhook(id: string, payload: Record<string, unknown>, test = true): Promise<{ ok: boolean; event?: WebhookEvent; verified?: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/webhooks/${id}`, { method: "POST", headers: { "content-type": "application/json", ...(test ? { "x-homeops-test": "1" } : {}) }, body: JSON.stringify(payload) });
      return await res.json();
    } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  async webhookEvents(id: string): Promise<WebhookEvent[]> {
    try { return (await req<{ events: WebhookEvent[] }>(`/webhooks/${id}`)).events ?? []; } catch { return []; }
  },
  async jobs(): Promise<BackendJob[]> {
    try { return (await req<{ jobs: BackendJob[] }>("/jobs")).jobs ?? []; } catch { return []; }
  },
  async runJob(id: string): Promise<{ ok: boolean; error?: string }> {
    try { const r = await req<{ result?: ExecResult; error?: string }>(`/jobs/${id}/run`, { method: "POST", mutation: true }); return { ok: !!r.result?.ok, error: r.error ?? r.result?.error }; } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  async browserSession(): Promise<{ ok: boolean; status?: string; message?: string }> {
    try { return await req("/browser/session", { method: "POST", mutation: true }); } catch { return { ok: false, status: "backend_unreachable" }; }
  },
  async audit(limit = 50): Promise<AuditEvent[]> {
    try { return (await req<{ events: AuditEvent[] }>(`/audit?limit=${limit}`)).events ?? []; } catch { return []; }
  },
  async getSettings(): Promise<{ externalActionsEnabled: boolean; ownerPinSet?: boolean; aiActiveProvider?: string | null; calendarAutoSync?: boolean; autoApproveImprovements?: boolean; timezone?: string | null }> {
    try { return (await req<{ settings: { externalActionsEnabled: boolean; ownerPinSet?: boolean; aiActiveProvider?: string | null; calendarAutoSync?: boolean; autoApproveImprovements?: boolean; timezone?: string | null } }>("/settings")).settings; } catch { return { externalActionsEnabled: true }; }
  },
  async setSettings(patch: Record<string, unknown>): Promise<{ externalActionsEnabled: boolean; calendarAutoSync?: boolean; autoApproveImprovements?: boolean; timezone?: string | null }> {
    try { return (await req<{ settings: { externalActionsEnabled: boolean; calendarAutoSync?: boolean; autoApproveImprovements?: boolean; timezone?: string | null } }>("/settings", { method: "POST", body: JSON.stringify(patch), mutation: true })).settings; } catch { return { externalActionsEnabled: true }; }
  },

  /* ---- AI providers ---- */
  async aiProviders(): Promise<AIProvider[]> {
    try { return (await req<{ providers: AIProvider[] }>("/ai/providers")).providers ?? []; } catch { return []; }
  },
  async aiSaveProvider(id: string, values: { apiKey?: string; baseUrl?: string; model?: string }): Promise<{ provider?: AIProvider; error?: string }> {
    try { return await req(`/ai/providers/${id}/config`, { method: "POST", body: JSON.stringify(values), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async aiRevokeProvider(id: string): Promise<{ provider?: AIProvider }> {
    try { return await req(`/ai/providers/${id}/config`, { method: "DELETE", mutation: true }); } catch { return {}; }
  },
  async aiHealth(id: string): Promise<AIHealth> {
    try { return await req(`/ai/providers/${id}/health`, { method: "POST", mutation: true }); } catch { return { ok: false, status: "backend_unreachable" }; }
  },
  async aiModels(id: string): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    try { return await req(`/ai/providers/${id}/models`); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  async aiSetActive(providerId: string | null): Promise<void> {
    try { await req("/ai/active", { method: "POST", body: JSON.stringify({ providerId }), mutation: true }); } catch { /* ignore */ }
  },
  async aiChat(input: { providerId?: string; messages: { role: string; content: string }[]; model?: string }): Promise<AIChatResult> {
    try { return await req("/ai/chat", { method: "POST", body: JSON.stringify(input), mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },

  /* ---- planner brain ---- */
  async plan(goal: string, providerId?: string): Promise<PlanResult> {
    try { return await req("/agent/plan", { method: "POST", body: JSON.stringify({ goal, providerId }), mutation: true }); } catch { return { ok: false, error: "backend_unreachable", message: "Backend runtime is not reachable." }; }
  },
  async generateMiniApp(input: { goal: string; type?: string; providerId?: string }): Promise<MiniAppGenResult> {
    try { return await req("/miniapps/generate", { method: "POST", body: JSON.stringify(input), mutation: true }); } catch { return { ok: false, error: "backend_unreachable", message: "Backend runtime is not reachable." }; }
  },
  async generatePlaybook(goal: string, providerId?: string): Promise<PlaybookGenResult> {
    try { return await req("/playbooks/generate", { method: "POST", body: JSON.stringify({ goal, providerId }), mutation: true }); } catch { return { ok: false, error: "backend_unreachable", message: "Backend runtime is not reachable." }; }
  },

  /* ---- assistant (the conversational loop; a PLAN starts a durable server run) ---- */
  async assistant(message: string, context?: Record<string, unknown>, providerId?: string, conversationId?: string): Promise<AssistantResult> {
    try { return await req("/assistant", { method: "POST", body: JSON.stringify({ message, context, providerId, conversationId }), mutation: true }); } catch { return { ok: false, error: "backend_unreachable", message: "Backend runtime is not reachable." }; }
  },
  // SSE streaming assistant — fires onProgress with a token count while the AI is
  // generating, then resolves with the final parsed AssistantResult.
  streamAssistant(body: { message: string; context?: Record<string, unknown>; providerId?: string; conversationId?: string }, onProgress?: (tokens: number) => void): Promise<AssistantResult> {
    return new Promise((resolve) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (csrfToken) headers["x-homeops-csrf"] = csrfToken;
      const es = new EventSource("/api/assistant/stream"); // fallback path — actually use fetch+ReadableStream below
      es.close(); // not used; EventSource doesn't support POST — use fetch instead
      fetch("/api/assistant/stream", { method: "POST", credentials: "same-origin", headers, body: JSON.stringify(body) })
        .then(async (res) => {
          if (!res.ok || !res.body) {
            // Surface the server's real error (e.g. 403 ai_disabled for children) instead
            // of a generic "unreachable" — the body is a small JSON error envelope.
            let error = "backend_unreachable"; let message: string | undefined = "Backend runtime is not reachable.";
            try { const j = (await res.json()) as { error?: string; message?: string }; if (j.error) { error = j.error; message = j.message; } } catch { /* not JSON */ }
            resolve({ ok: false, error, message });
            return;
          }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === "progress" && onProgress) onProgress(ev.tokens as number);
                if (ev.type === "done") { resolve(ev.result as AssistantResult); return; }
              } catch {}
            }
          }
          resolve({ ok: false, error: "stream_incomplete" });
        })
        .catch(() => resolve({ ok: false, error: "backend_unreachable", message: "Backend runtime is not reachable." }));
    });
  },
  /* ---- server evolution registry ---- */
  async evolutions(): Promise<ServerEvolution[]> {
    try { return (await req<{ evolutions: ServerEvolution[] }>("/evolution")).evolutions ?? []; } catch { return []; }
  },
  async reviewEvolution(id: string, accept: boolean): Promise<{ ok: boolean; applied?: boolean; applyError?: string | null; evolution?: ServerEvolution; error?: string }> {
    try { return await req(`/evolution/${id}/review`, { method: "POST", body: JSON.stringify({ accept }), mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },

  /* ---- family data: server-owned events & tasks (P1.2 / P4.1) ---- */
  async events(): Promise<ServerEvent[]> {
    try { return (await req<{ events: ServerEvent[] }>("/events")).events ?? []; } catch { return []; }
  },
  async createEvent(body: Partial<ServerEvent>): Promise<{ event?: ServerEvent; error?: string }> {
    try { return await req("/events", { method: "POST", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async updateEvent(id: string, patch: Partial<ServerEvent>): Promise<{ event?: ServerEvent; error?: string }> {
    try { return await req(`/events/${id}`, { method: "PATCH", body: JSON.stringify(patch), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async deleteEvent(id: string): Promise<{ ok: boolean; error?: string }> {
    try { return await req(`/events/${id}`, { method: "DELETE", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  // Push a FamiliOS canonical event to Google. With no approvalId it returns {needsApproval,
  // approval} (writing to your real calendar needs sign-off); pass the approved id to execute.
  async pushEventToGoogle(id: string, approvalId?: string): Promise<{ ok?: boolean; needsApproval?: boolean; approval?: BackendApproval; googleEventId?: string; action?: string; error?: string; message?: string }> {
    try { return await req(`/calendar/push/${id}`, { method: "POST", body: JSON.stringify(approvalId ? { approvalId } : {}), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  // Pull Google-side edits back into pushed events. Clean edits merge; both-sides-changed
  // flags provenance.conflict for review; Google deletions unlink (FamiliOS stays canonical).
  async pullGoogleEdits(): Promise<{ ok?: boolean; checked?: number; merged?: number; conflicts?: number; unlinked?: number; errors?: number; error?: string; message?: string }> {
    try { return await req("/calendar/pull-google-edits", { method: "POST", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  // Resolve a flagged pull conflict: adopt Google's version or keep the FamiliOS one.
  async resolveEventConflict(id: string, choice: "google" | "local"): Promise<{ ok?: boolean; event?: ServerEvent; error?: string; message?: string }> {
    try { return await req(`/events/${id}/resolve-conflict`, { method: "POST", body: JSON.stringify({ choice }), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async tasks(): Promise<ServerTask[]> {
    try { return (await req<{ tasks: ServerTask[] }>("/tasks")).tasks ?? []; } catch { return []; }
  },
  async createTaskRemote(body: Partial<ServerTask>): Promise<{ task?: ServerTask; error?: string }> {
    try { return await req("/tasks", { method: "POST", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async updateTaskRemote(id: string, patch: Partial<ServerTask>): Promise<{ task?: ServerTask; error?: string }> {
    try { return await req(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async deleteTaskRemote(id: string): Promise<{ ok: boolean; error?: string }> {
    try { return await req(`/tasks/${id}`, { method: "DELETE", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  /* ---- unified chat-builder: materialize a proposed build into durable entities ---- */
  // conversationId (optional) lets the server durably mark the originating build message
  // built and append the confirmation — so the card's state survives a refresh.
  async buildFromChat(build: ChatBuild, conversationId?: string): Promise<BuildResult> {
    try { return await req("/assistant/build", { method: "POST", body: JSON.stringify({ build, conversationId }), mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  // Streaming build — fires onProgress per entity as it's created/updated, then resolves
  // with the final BuildResult. Falls back to a non-streaming error shape on transport failure.
  streamBuild(build: ChatBuild, onProgress?: (ev: BuildProgress) => void, conversationId?: string): Promise<BuildResult> {
    return new Promise((resolve) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (csrfToken) headers["x-homeops-csrf"] = csrfToken;
      fetch("/api/assistant/build/stream", { method: "POST", credentials: "same-origin", headers, body: JSON.stringify({ build, conversationId }) })
        .then(async (res) => {
          if (!res.ok || !res.body) { resolve({ ok: false, error: res.status === 403 ? "insufficient_role" : "backend_unreachable" }); return; }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === "progress" && onProgress) onProgress(ev as BuildProgress);
                if (ev.type === "done") { resolve(ev.result as BuildResult); return; }
              } catch { /* partial line */ }
            }
          }
          resolve({ ok: false, error: "stream_incomplete" });
        })
        .catch(() => resolve({ ok: false, error: "backend_unreachable" }));
    });
  },
  /* ---- risk-class overrides (item 9) — admin-only; server enforces in the engine ---- */
  async riskOverrides(): Promise<{ overrides: RiskOverride[]; catalog: CatalogTool[] } | null> {
    try { return await req("/risk-overrides"); } catch { return null; }
  },
  async setRiskOverride(toolId: string, patch: { riskClass?: string | null; skipApproval?: boolean }): Promise<{ override?: RiskOverride; error?: string }> {
    try { return await req("/risk-overrides", { method: "PUT", body: JSON.stringify({ toolId, ...patch }), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async clearRiskOverride(toolId: string): Promise<{ ok: boolean; error?: string }> {
    try { return await req(`/risk-overrides/${encodeURIComponent(toolId)}`, { method: "DELETE", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  /* ---- household graph (server-owned member roster) ---- */
  async members(): Promise<ServerMember[]> {
    try { return (await req<{ members: ServerMember[] }>("/members")).members ?? []; } catch { return []; }
  },
  // Pre-auth profile picker + one-time household claim (demo roster → your family).
  async profiles(): Promise<{ profiles: { actorId: string; displayName: string; role: string; pinRequired: boolean }[]; claimed: boolean; householdName?: string | null } | null> {
    try { return await req("/profiles"); } catch { return null; }
  },
  async appendConversationMessage(id: string, body: { text: string; kind?: string; runId?: string }): Promise<{ conversation?: ServerConversation; error?: string }> {
    try { return await req(`/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async household(): Promise<{ id: string; name: string | null } | null> {
    try { return (await req<{ household: { id: string; name: string | null } }>("/household")).household ?? null; } catch { return null; }
  },
  async rev(): Promise<number | null> {
    try { return (await req<{ rev: number }>("/rev")).rev ?? null; } catch { return null; }
  },
  async renameHousehold(name: string): Promise<{ household?: { id: string; name: string | null }; error?: string; message?: string }> {
    try { return await req("/household", { method: "PATCH", body: JSON.stringify({ name }), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async claimHousehold(body: { ownerName: string; actorId?: string }): Promise<{ member?: { actorId: string; displayName: string; role: string }; session?: Session; error?: string; message?: string }> {
    try {
      const r = await req<{ member?: { actorId: string; displayName: string; role: string }; session?: Session; error?: string; message?: string }>("/household/claim", { method: "POST", body: JSON.stringify(body) });
      if (r.session) setCsrf(r.session.csrf);
      return r;
    } catch { return { error: "backend_unreachable" }; }
  },
  async createMemberRemote(body: { displayName: string; role: string; relationship?: string | null; actorId?: string }): Promise<{ member?: { actorId: string; displayName: string; role: string; relationship: string | null }; error?: string; message?: string }> {
    try { return await req("/members", { method: "POST", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async updateMemberRemote(actorId: string, patch: { displayName?: string; role?: string; relationship?: string | null; color?: string | null; photoFileId?: string | null; aiEnabled?: boolean }): Promise<{ member?: { actorId: string; displayName: string; role: string; relationship: string | null; color?: string | null; photoFileId?: string | null; aiEnabled?: boolean }; error?: string; message?: string }> {
    try { return await req(`/members/${encodeURIComponent(actorId)}`, { method: "PATCH", body: JSON.stringify(patch), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async archiveMemberRemote(actorId: string): Promise<{ ok?: boolean; error?: string; message?: string }> {
    try { return await req(`/members/${encodeURIComponent(actorId)}`, { method: "DELETE", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  /* ---- meal plan ---- */
  async meals(): Promise<Meal[]> {
    try { return (await req<{ meals: Meal[] }>("/meals")).meals ?? []; } catch { return []; }
  },
  async createMeal(body: Omit<Partial<Meal>, "ingredients"> & { title: string; ingredients?: (string | MealIngredient)[] }): Promise<{ meal?: Meal; error?: string }> {
    try { return await req("/meals", { method: "POST", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async updateMeal(id: string, patch: Partial<Meal>): Promise<{ meal?: Meal; error?: string }> {
    try { return await req(`/meals/${id}`, { method: "PATCH", body: JSON.stringify(patch), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async deleteMeal(id: string): Promise<{ ok: boolean; unlinkedGroceries?: number; removedEvents?: number; removedGroceries?: number; error?: string }> {
    try { return await req(`/meals/${id}`, { method: "DELETE", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  async mealToGrocery(id: string): Promise<{ ok: boolean; added?: number; error?: string }> {
    try { return await req(`/meals/${id}/to-grocery`, { method: "POST", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  // Item 5: put the meal on the household calendar as a canonical, mealId-linked event
  // (idempotent — re-pushing updates). Google push then goes through the existing
  // approval-gated calendar push route from the Calendar screen.
  async mealToCalendar(id: string): Promise<{ ok: boolean; event?: ServerEvent; action?: "created" | "updated"; error?: string; message?: string }> {
    try { return await req(`/meals/${id}/to-calendar`, { method: "POST", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  /* ---- durable files (server blobs; supports multi-page front+back uploads) ---- */
  async files(): Promise<ServerFile[]> {
    try { return (await req<{ files: ServerFile[] }>("/files")).files ?? []; } catch { return []; }
  },
  async uploadFile(body: { name: string; mime?: string; contentBase64?: string; pages?: { name?: string; base64: string }[]; tags?: string[]; visibility?: string; spaceId?: string; source?: string }): Promise<{ file?: ServerFile; error?: string; message?: string }> {
    try { return await req("/files", { method: "POST", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async fileContent(id: string, page = 0): Promise<{ name?: string; mime?: string; page?: number; pageCount?: number; contentBase64?: string; error?: string }> {
    try { return await req(`/files/${id}/content?page=${page}`); } catch { return { error: "backend_unreachable" }; }
  },
  async deleteFileRemote(id: string): Promise<{ ok?: boolean; error?: string }> {
    try { return await req(`/files/${id}`, { method: "DELETE", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  /* ---- server-owned Knowledge (durable, editable, visibility-scoped) ---- */
  async knowledge(): Promise<ServerKnowledge[]> {
    try { return (await req<{ items: ServerKnowledge[] }>("/knowledge")).items ?? []; } catch { return []; }
  },
  async createKnowledge(body: { title: string; type?: string; content?: string; tags?: string[]; visibility?: string; sensitive?: boolean; fileIds?: string[] }): Promise<{ item?: ServerKnowledge; error?: string }> {
    try { return await req("/knowledge", { method: "POST", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async patchKnowledge(id: string, patch: Partial<ServerKnowledge>): Promise<{ item?: ServerKnowledge; error?: string }> {
    try { return await req(`/knowledge/${id}`, { method: "PATCH", body: JSON.stringify(patch), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async deleteKnowledge(id: string): Promise<{ ok?: boolean; error?: string }> {
    try { return await req(`/knowledge/${id}`, { method: "DELETE", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  /* ---- calendar subscriptions (the read-only "linked" calendar layer) ---- */
  async calendarSubscriptions(): Promise<CalendarSubscription[]> {
    try { return (await req<{ subscriptions: CalendarSubscription[] }>("/calendar/subscriptions")).subscriptions ?? []; } catch { return []; }
  },
  async subscribeCalendar(body: { name?: string; url: string }): Promise<{ subscription?: CalendarSubscription; sync?: CalendarSync; error?: string }> {
    try { return await req("/calendar/subscriptions", { method: "POST", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async connectGoogleCalendar(): Promise<{ subscription?: CalendarSubscription; sync?: CalendarSync; error?: string; message?: string }> {
    try { return await req("/calendar/connect-google", { method: "POST", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async importIcs(body: { name?: string; ics: string }): Promise<{ subscription?: CalendarSubscription; sync?: CalendarSync; error?: string; message?: string }> {
    try { return await req("/calendar/import-ics", { method: "POST", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async syncCalendar(id: string): Promise<{ subscription?: CalendarSubscription; sync?: CalendarSync; error?: string }> {
    try { return await req(`/calendar/subscriptions/${id}/sync`, { method: "POST", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async deleteCalendarSubscription(id: string): Promise<{ ok: boolean; removedEvents?: number; error?: string }> {
    try { return await req(`/calendar/subscriptions/${id}`, { method: "DELETE", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  // One "Sync" button: re-sync every subscription and pull Google-side edits in one call.
  async syncAllCalendars(): Promise<CalendarSyncAllResult> {
    try { return await req("/calendar/sync-all", { method: "POST", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  /* ---- help requests (human-to-human asks, e.g. "can you drive pickup?") ---- */
  async helpRequests(): Promise<HelpRequest[]> {
    try { return (await req<{ helpRequests: HelpRequest[] }>("/help-requests")).helpRequests ?? []; } catch { return []; }
  },
  async createHelpRequest(input: { toActorId: string; message: string; eventId?: string; taskId?: string; kind?: "ask" | "offer" }): Promise<{ helpRequest?: HelpRequest; error?: string; message?: string }> {
    try { return await req("/help-requests", { method: "POST", body: JSON.stringify(input), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async respondHelpRequest(id: string, response: "accept" | "decline", note?: string): Promise<{ helpRequest?: HelpRequest; error?: string; message?: string }> {
    try { return await req(`/help-requests/${encodeURIComponent(id)}/respond`, { method: "POST", body: JSON.stringify({ response, note }), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async cancelHelpRequest(id: string): Promise<{ helpRequest?: HelpRequest; ok?: boolean; error?: string; message?: string }> {
    try { return await req(`/help-requests/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  /* ---- server-durable assistant conversations (P1.1) ---- */
  async conversations(): Promise<ServerConversation[]> {
    try { return (await req<{ conversations: ServerConversation[] }>("/conversations")).conversations ?? []; } catch { return []; }
  },
  async getConversation(id: string): Promise<ServerConversation | null> {
    try { return (await req<{ conversation: ServerConversation }>(`/conversations/${id}`)).conversation ?? null; } catch { return null; }
  },
  async createConversation(title: string, visibility?: "household" | "personal"): Promise<{ conversation?: ServerConversation; error?: string }> {
    try { return await req("/conversations", { method: "POST", body: JSON.stringify(visibility ? { title, visibility } : { title }), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async deleteConversationRemote(id: string): Promise<{ ok: boolean; error?: string }> {
    try { return await req(`/conversations/${id}`, { method: "DELETE", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  /* ---- memory & artifacts (read; written by runs) ---- */
  async memory(): Promise<ServerMemory[]> {
    try { return (await req<{ memory: ServerMemory[] }>("/memory")).memory ?? []; } catch { return []; }
  },
  async deleteMemoryRemote(id: string): Promise<{ ok: boolean; error?: string }> {
    try { return await req(`/memory/${id}`, { method: "DELETE", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  // WP-007 s5 — retrieval-quality search + profile for the Memory tab's search box.
  // Scoped server-side to the session's own household; `degraded:true` means the
  // provider (sidecar or its sqlite-FTS5 fallback) couldn't answer — the caller shows
  // honest fallback copy rather than pretending the empty result set is complete.
  async memorySearch(q: string): Promise<MemorySearchResponse> {
    try { return await req<MemorySearchResponse>(`/memory/search?q=${encodeURIComponent(q)}`); } catch { return { ok: false, degraded: true, results: [], profile: null }; }
  },
  async artifacts(query = ""): Promise<ServerArtifact[]> {
    try { return (await req<{ artifacts: ServerArtifact[] }>(`/artifacts${query}`)).artifacts ?? []; } catch { return []; }
  },

  /* ---- durable runs (server is the source of truth; client observes/drives) ---- */
  async startRun(input: StartRunInput): Promise<{ run?: ServerRun; error?: string }> {
    try { return await req("/runs/start", { method: "POST", body: JSON.stringify(input), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async getRun(id: string): Promise<ServerRun | null> {
    try { return (await req<{ run: ServerRun }>(`/runs/${id}`)).run ?? null; } catch { return null; }
  },
  // Item 3: correlated per-message label changes for a completed run (for the chat review card).
  async emailReview(runId: string): Promise<EmailReview | null> {
    try { return await req<EmailReview>(`/runs/${runId}/email-review`); } catch { return null; }
  },
  // Item 16b: deliver a notification to a contact method's channel (honest availability).
  // methodId resolves channel + address from the server-owned registry (verified/opt-in
  // enforced there); methodType/to remains for ad-hoc sends.
  async notify(input: { methodId?: string; methodType?: string; to?: string | null; title: string; body: string; agentId?: string }): Promise<{ ok: boolean; channel?: string; delivered?: boolean; needsSetup?: string; message?: string; error?: string }> {
    try { return await req(`/notify`, { method: "POST", body: JSON.stringify(input), mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  /* ---- contact methods (server-owned delivery registry) ---- */
  async contactMethods(): Promise<ServerContactMethod[]> {
    try { return (await req<{ contactMethods: ServerContactMethod[] }>(`/contact-methods`)).contactMethods ?? []; } catch { return []; }
  },
  async createContactMethod(input: { id?: string; memberId?: string; label: string; type: string; value?: string; verified?: boolean; optInStatus?: string; allowedAgentIds?: string[] }): Promise<{ contactMethod?: ServerContactMethod; error?: string; message?: string }> {
    try { return await req(`/contact-methods`, { method: "POST", body: JSON.stringify(input), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async patchContactMethod(id: string, patch: { label?: string; value?: string; verified?: boolean; optInStatus?: string; allowedAgentIds?: string[] }): Promise<{ contactMethod?: ServerContactMethod; error?: string; message?: string }> {
    try { return await req(`/contact-methods/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async deleteContactMethod(id: string): Promise<{ ok?: boolean; error?: string }> {
    try { return await req(`/contact-methods/${encodeURIComponent(id)}`, { method: "DELETE", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  // The true verification loop: a 6-digit code goes out through the method's real
  // channel; entering it (verify) proves control of the address.
  async sendContactVerification(id: string): Promise<{ ok?: boolean; channel?: string; needsSetup?: string; retryInMs?: number; message?: string; error?: string }> {
    try { return await req(`/contact-methods/${encodeURIComponent(id)}/send-verification`, { method: "POST", body: "{}", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  async confirmContactVerification(id: string, code: string): Promise<{ ok?: boolean; alreadyVerified?: boolean; contactMethod?: ServerContactMethod; attemptsLeft?: number; message?: string; error?: string }> {
    try { return await req(`/contact-methods/${encodeURIComponent(id)}/verify`, { method: "POST", body: JSON.stringify({ code }), mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  async notifications(): Promise<ServerNotification[]> {
    try { return (await req<{ notifications: ServerNotification[] }>(`/notifications`)).notifications ?? []; } catch { return []; }
  },
  async markNotificationRead(id: string): Promise<{ ok: boolean }> {
    try { return await req(`/notifications/${id}/read`, { method: "POST", mutation: true }); } catch { return { ok: false }; }
  },
  async runs(query = ""): Promise<ServerRun[]> {
    try { return (await req<{ runs: ServerRun[] }>(`/runs${query}`)).runs ?? []; } catch { return []; }
  },
  async resumeRun(id: string): Promise<ServerRun | null> {
    try { return (await req<{ run: ServerRun }>(`/runs/${id}/resume`, { method: "POST", mutation: true })).run ?? null; } catch { return null; }
  },
  async cancelRun(id: string): Promise<ServerRun | null> {
    try { return (await req<{ run: ServerRun }>(`/runs/${id}/cancel`, { method: "POST", mutation: true })).run ?? null; } catch { return null; }
  },
  // Live run progress via Server-Sent Events. Returns an unsubscribe fn. The caller
  // keeps polling getRun as a durable fallback (SSE is advisory; runs.json is truth).
  subscribeRun(id: string, onRun: (run: ServerRun) => void): () => void {
    try {
      const es = new EventSource(`/api/runs/${id}/events`, { withCredentials: true });
      es.onmessage = (e) => { try { onRun(JSON.parse(e.data) as ServerRun); } catch { /* heartbeat / non-JSON */ } };
      return () => { try { es.close(); } catch { /* ignore */ } };
    } catch { return () => {}; }
  },

  /* ---- skill registry ---- */
  async skills(query = ""): Promise<ServerSkill[]> {
    try { return (await req<{ skills: ServerSkill[] }>(`/skills${query}`)).skills ?? []; } catch { return []; }
  },
  async getSkill(id: string): Promise<ServerSkill | null> {
    try { return (await req<{ skill: ServerSkill }>(`/skills/${id}`)).skill ?? null; } catch { return null; }
  },
  async createSkill(body: Partial<ServerSkill>): Promise<{ skill?: ServerSkill; error?: string }> {
    try { return await req(`/skills`, { method: "POST", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async updateSkill(id: string, body: Partial<ServerSkill>): Promise<{ skill?: ServerSkill; error?: string }> {
    try { return await req(`/skills/${id}`, { method: "PUT", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async patchSkill(id: string, patch: Partial<ServerSkill>): Promise<{ skill?: ServerSkill; error?: string }> {
    try { return await req(`/skills/${id}`, { method: "PATCH", body: JSON.stringify(patch), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async deleteSkill(id: string): Promise<{ ok: boolean; error?: string }> {
    try { return await req(`/skills/${id}`, { method: "DELETE", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  async runSkill(id: string, params: Record<string, unknown> = {}): Promise<{ run?: ServerRun; error?: string }> {
    try { return await req(`/skills/${id}/run`, { method: "POST", body: JSON.stringify({ params }), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async testSkill(id: string, params: Record<string, unknown> = {}): Promise<{ run?: ServerRun; error?: string }> {
    try { return await req(`/skills/${id}/test`, { method: "POST", body: JSON.stringify({ params }), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async duplicateSkill(id: string): Promise<{ skill?: ServerSkill; error?: string }> {
    try { return await req(`/skills/${id}/duplicate`, { method: "POST", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async promoteSkill(id: string): Promise<{ skill?: ServerSkill; error?: string }> {
    try { return await req(`/skills/${id}/promote`, { method: "POST", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async rollbackSkill(id: string, targetVersion?: number): Promise<{ skill?: ServerSkill; error?: string }> {
    try { return await req(`/skills/${id}/rollback`, { method: "POST", body: JSON.stringify({ targetVersion }), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async skillVersions(id: string): Promise<SkillVersion[]> {
    try { return (await req<{ versions: SkillVersion[] }>(`/skills/${id}/versions`)).versions ?? []; } catch { return []; }
  },
  async inferFunctions(description: string, providerId?: string): Promise<InferFunctionsResult> {
    try { return await req(`/skills/infer-functions`, { method: "POST", body: JSON.stringify({ description, providerId }), mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  // Item 13: draft a candidate function definition from a capability description (shape
  // only — nothing is created). Always returns a usable draft (skeleton fallback).
  async draftFunction(description: string, providerId?: string): Promise<{ ok: boolean; draft?: DraftedFunction; fallback?: boolean; message?: string; error?: string }> {
    try { return await req(`/functions/draft`, { method: "POST", body: JSON.stringify({ description, providerId }), mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },

  /* ---- function/tool registry ---- */
  async functions(query = ""): Promise<ServerFunction[]> {
    try { return (await req<{ functions: ServerFunction[] }>(`/functions${query}`)).functions ?? []; } catch { return []; }
  },
  async getFunction(id: string): Promise<ServerFunction | null> {
    try { return (await req<{ function: ServerFunction }>(`/functions/${id}`)).function ?? null; } catch { return null; }
  },
  async toolCatalog(): Promise<ToolCatalogResult> {
    try { return await req<ToolCatalogResult>(`/functions/tool-catalog`); } catch { return { tools: [], types: [], states: [] }; }
  },
  async createFunction(body: Partial<ServerFunction> & { config?: Record<string, unknown> }): Promise<{ function?: ServerFunction; error?: string }> {
    try { return await req(`/functions`, { method: "POST", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async updateFunction(id: string, body: Partial<ServerFunction> & { config?: Record<string, unknown> }): Promise<{ function?: ServerFunction; error?: string }> {
    try { return await req(`/functions/${id}`, { method: "PUT", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async patchFunction(id: string, patch: Partial<ServerFunction> & { config?: Record<string, unknown> }): Promise<{ function?: ServerFunction; error?: string }> {
    try { return await req(`/functions/${id}`, { method: "PATCH", body: JSON.stringify(patch), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async deleteFunction(id: string): Promise<{ ok: boolean; error?: string }> {
    try { return await req(`/functions/${id}`, { method: "DELETE", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  async testFunction(id: string, input?: Record<string, unknown>, confirm = false): Promise<FunctionTestResult> {
    try { return await req(`/functions/${id}/test`, { method: "POST", body: JSON.stringify({ input, confirm }), mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  async duplicateFunction(id: string): Promise<{ function?: ServerFunction; error?: string }> {
    try { return await req(`/functions/${id}/duplicate`, { method: "POST", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async promoteFunction(id: string): Promise<{ function?: ServerFunction; error?: string; state?: string; message?: string }> {
    try { return await req(`/functions/${id}/promote`, { method: "POST", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async deprecateFunction(id: string): Promise<{ function?: ServerFunction; error?: string }> {
    try { return await req(`/functions/${id}/deprecate`, { method: "POST", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async rollbackFunction(id: string, targetVersion?: number): Promise<{ function?: ServerFunction; error?: string }> {
    try { return await req(`/functions/${id}/rollback`, { method: "POST", body: JSON.stringify({ targetVersion }), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async functionVersions(id: string): Promise<FunctionVersion[]> {
    try { return (await req<{ versions: FunctionVersion[] }>(`/functions/${id}/versions`)).versions ?? []; } catch { return []; }
  },

  /* ---- agent registry ---- */
  async agents(query = ""): Promise<ServerAgent[]> {
    try { return (await req<{ agents: ServerAgent[] }>(`/agents${query}`)).agents ?? []; } catch { return []; }
  },
  async getAgent(id: string): Promise<ServerAgent | null> {
    try { return (await req<{ agent: ServerAgent }>(`/agents/${id}`)).agent ?? null; } catch { return null; }
  },
  async createAgent(body: Partial<ServerAgent>): Promise<{ agent?: ServerAgent; error?: string }> {
    try { return await req(`/agents`, { method: "POST", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async updateAgent(id: string, body: Partial<ServerAgent>): Promise<{ agent?: ServerAgent; error?: string }> {
    try { return await req(`/agents/${id}`, { method: "PUT", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async patchAgent(id: string, patch: Partial<ServerAgent>): Promise<{ agent?: ServerAgent; error?: string }> {
    try { return await req(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(patch), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async deleteAgent(id: string): Promise<{ ok: boolean; error?: string }> {
    try { return await req(`/agents/${id}`, { method: "DELETE", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  async runAgentServer(id: string, opts: { goal?: string; skillId?: string; params?: Record<string, unknown> } = {}): Promise<{ run?: ServerRun; droppedSteps?: number; error?: string; message?: string }> {
    try { return await req(`/agents/${id}/run`, { method: "POST", body: JSON.stringify(opts), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async duplicateAgentServer(id: string): Promise<{ agent?: ServerAgent; error?: string }> {
    try { return await req(`/agents/${id}/duplicate`, { method: "POST", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async rollbackAgent(id: string, targetVersion?: number): Promise<{ agent?: ServerAgent; error?: string }> {
    try { return await req(`/agents/${id}/rollback`, { method: "POST", body: JSON.stringify({ targetVersion }), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async agentVersions(id: string): Promise<AgentVersion[]> {
    try { return (await req<{ versions: AgentVersion[] }>(`/agents/${id}/versions`)).versions ?? []; } catch { return []; }
  },
  async agentContext(id: string): Promise<AgentContext | null> {
    try { return (await req<{ context: AgentContext }>(`/agents/${id}/context`)).context ?? null; } catch { return null; }
  },

  /* ---- trigger registry ---- */
  async triggers(query = ""): Promise<ServerTrigger[]> {
    try { return (await req<{ triggers: ServerTrigger[] }>(`/triggers${query}`)).triggers ?? []; } catch { return []; }
  },
  async getTrigger(id: string): Promise<ServerTrigger | null> {
    try { return (await req<{ trigger: ServerTrigger }>(`/triggers/${id}`)).trigger ?? null; } catch { return null; }
  },
  async createTrigger(body: Partial<ServerTrigger> & { secret?: string; runAt?: number | string }): Promise<{ trigger?: ServerTrigger; error?: string }> {
    try { return await req(`/triggers`, { method: "POST", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async updateTrigger(id: string, patch: Partial<ServerTrigger> & { secret?: string; runAt?: number | string }): Promise<{ trigger?: ServerTrigger; error?: string }> {
    try { return await req(`/triggers/${id}`, { method: "PATCH", body: JSON.stringify(patch), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async deleteTrigger(id: string): Promise<{ ok: boolean; error?: string }> {
    try { return await req(`/triggers/${id}`, { method: "DELETE", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  async fireTrigger(id: string, payload?: Record<string, unknown>): Promise<{ ok: boolean; runId?: string; error?: string; message?: string }> {
    try { return await req(`/triggers/${id}/fire`, { method: "POST", body: JSON.stringify({ payload }), mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },

  /* ---- evolution (optional LLM enrichment of a trace-derived proposal) ---- */
  async proposeEvolution(trace: Record<string, unknown>, providerId?: string): Promise<EvolutionProposalResult> {
    try { return await req("/evolution/propose", { method: "POST", body: JSON.stringify({ trace, providerId }), mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
};

/* ----- Presentation helpers (shared by screens) ----- */
export const READINESS_META: Record<Readiness, { label: string; color: "sage" | "amber" | "coral" | "sky" | "lavender" | "gray"; dot: boolean }> = {
  connected: { label: "Connected · Healthy", color: "sage", dot: true },
  authorized_write: { label: "Authorized · Write", color: "sage", dot: true },
  authorized_readonly: { label: "Authorized · Read-only", color: "sky", dot: true },
  local_only: { label: "Local-only", color: "sky", dot: true },
  needs_auth: { label: "Needs authorization", color: "amber", dot: false },
  not_configured: { label: "Setup required", color: "amber", dot: false },
  not_installed: { label: "Not installed", color: "gray", dot: false },
  runtime_unavailable: { label: "Runtime not connected", color: "amber", dot: false },
  degraded: { label: "Degraded", color: "amber", dot: false },
  error: { label: "Error", color: "coral", dot: false },
  revoked: { label: "Revoked", color: "coral", dot: false },
};

export function isExecutable(r: Readiness): boolean {
  return ["connected", "authorized_write", "authorized_readonly", "local_only"].includes(r);
}
