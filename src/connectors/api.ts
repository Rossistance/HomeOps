/**
 * Frontend client for the HomeOps backend control plane (server/index.mjs,
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
  id: string; name: string; kind: "cloud" | "local"; local: boolean; needsKey: boolean; needsBaseUrl: boolean;
  docs: string; defaultBaseUrl: string; defaultModel: string; baseUrl: string; model: string; keySet: boolean;
  readiness: "not_configured" | "configured"; active: boolean; updatedAt: string | null;
}
export interface AIHealth { ok: boolean; status?: string; message?: string; models?: string[]; modelCount?: number; latencyMs?: number }
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
  attribution: string; status: string; approvalId: string | null; attempts: number;
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
export interface AssistantResult { ok: boolean; kind?: "answer" | "plan"; answer?: string; plan?: AgentPlan; runId?: string | null; run?: ServerRun | null; model?: string; error?: string; message?: string }
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
  model?: string;
  createdAt: number;
  updatedAt: string;
  reviewedAt?: number;
  reviewedBy?: string;
}

/* ---- server-owned family data (P1/P4) ---- */
export interface ServerEvent {
  id: string; householdId: string; title: string; startAt: string | null; endAt: string | null;
  location: string; spaceId: string; participantIds: string[]; driverId: string | null;
  ownerId: string | null; backupOwnerId: string | null;
  whatToBring: { item: string; memberId: string | null }[]; checklist: { text: string; done: boolean }[];
  travel: unknown; reminders: unknown[]; attachments: unknown[]; comments: unknown[]; mealImpact: unknown;
  visibility: string; category: string; layer: "canonical" | "linked" | "public"; status: string;
  source: string; provenance?: Record<string, unknown>; createdBy: string; createdAt: number; updatedAt: string;
}
export interface ServerTask {
  id: string; householdId: string; title: string; type: string; status: string; dueAt: string | null;
  assignedMemberId: string | null; spaceId: string; priority: string; amount: number | null;
  visibility: string; notes: string; listName?: string; source: string; createdBy: string;
  createdAt: string; updatedAt: string;
}
export interface ServerMember { actorId: string; displayName: string; role: string; relationship: string | null; spaceIds: string[]; isCurrentUser: boolean }
export interface ServerConversationMessage { role: "user" | "assistant"; text: string; kind?: string; plan?: AgentPlan | null; model?: string | null; at: string }
export interface ServerConversation { id: string; householdId: string; actorId: string; title: string; messages: ServerConversationMessage[]; createdAt: string; updatedAt: string }
export interface ServerMemory { id: string; householdId: string; scope: string; type: string; text: string; createdAt: number; source?: { runId?: string; actorId?: string } }
export interface ServerArtifact { id: string; householdId: string; runId?: string; kind: string; title: string; body?: string; createdAt: number }

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
  async login(input: { actorId: string; actorName: string; role: string; pin?: string }): Promise<{ session?: Session; error?: string }> {
    try {
      const r = await req<{ session?: Session; error?: string }>("/session", { method: "POST", body: JSON.stringify(input) });
      if (r.session) setCsrf(r.session.csrf);
      return r;
    } catch { return { error: "backend_unreachable" }; }
  },
  async logout(): Promise<void> {
    try { await req("/session", { method: "DELETE", mutation: true }); } catch { /* ignore */ } finally { setCsrf(null); }
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
  async getSettings(): Promise<{ externalActionsEnabled: boolean; ownerPinSet?: boolean; aiActiveProvider?: string | null }> {
    try { return (await req<{ settings: { externalActionsEnabled: boolean; ownerPinSet?: boolean; aiActiveProvider?: string | null } }>("/settings")).settings; } catch { return { externalActionsEnabled: true }; }
  },
  async setSettings(patch: Record<string, unknown>): Promise<{ externalActionsEnabled: boolean }> {
    try { return (await req<{ settings: { externalActionsEnabled: boolean } }>("/settings", { method: "POST", body: JSON.stringify(patch), mutation: true })).settings; } catch { return { externalActionsEnabled: true }; }
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
          if (!res.ok || !res.body) { resolve({ ok: false, error: "backend_unreachable", message: "Backend runtime is not reachable." }); return; }
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
  /* ---- household graph (server-owned member roster) ---- */
  async members(): Promise<ServerMember[]> {
    try { return (await req<{ members: ServerMember[] }>("/members")).members ?? []; } catch { return []; }
  },
  /* ---- server-durable assistant conversations (P1.1) ---- */
  async conversations(): Promise<ServerConversation[]> {
    try { return (await req<{ conversations: ServerConversation[] }>("/conversations")).conversations ?? []; } catch { return []; }
  },
  async getConversation(id: string): Promise<ServerConversation | null> {
    try { return (await req<{ conversation: ServerConversation }>(`/conversations/${id}`)).conversation ?? null; } catch { return null; }
  },
  async createConversation(title: string): Promise<{ conversation?: ServerConversation; error?: string }> {
    try { return await req("/conversations", { method: "POST", body: JSON.stringify({ title }), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async deleteConversationRemote(id: string): Promise<{ ok: boolean; error?: string }> {
    try { return await req(`/conversations/${id}`, { method: "DELETE", mutation: true }); } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  /* ---- memory & artifacts (read; written by runs) ---- */
  async memory(): Promise<ServerMemory[]> {
    try { return (await req<{ memory: ServerMemory[] }>("/memory")).memory ?? []; } catch { return []; }
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
