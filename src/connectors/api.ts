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
/** ISS-114: the entity ids below have ALWAYS been on the wire — the server stamps them
 *  on audit payloads — but this type never declared them, so the Activity feed had
 *  nothing to deep-link with and every entry that wasn't connector-related went nowhere.
 *  (Same shape of omission as the conversation-message fields noted in useStore.) */
export interface AuditEvent {
  id: string; at: string; type: string; ok: boolean;
  actorId?: string; actorName?: string; connectorId?: string; toolId?: string;
  error?: string; origin?: string;
  runId?: string; agentId?: string; triggerId?: string; approvalId?: string; eventId?: string;
  taskId?: string; fileId?: string; memoryId?: string; memberId?: string; subscriptionId?: string;
}
export interface Session { actorId: string; actorName: string; role: string; csrf: string; householdId: string }

/* ---- WP-010 session-scoped picker hint (ISS-012) ----
 * After signing into a signed-up (hh_*) household, the browser remembers WHICH
 * household it was — id only, never a secret — so the Lock screen can offer that
 * family's own members after sign-out (via /api/profiles?household=…) instead of
 * the resident household's roster. Kept across sign-out on purpose; the resident
 * household ("local") is never stored, so a fresh browser keeps its default. */
const HOUSEHOLD_HINT_KEY = "familios.householdHint.v1";
export interface HouseholdHint { id: string; name?: string | null }
export function saveHouseholdHint(id: string | null | undefined, name?: string | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (id && /^hh_[a-z0-9]+$/.test(id)) localStorage.setItem(HOUSEHOLD_HINT_KEY, JSON.stringify({ id, ...(name ? { name } : {}) }));
  } catch { /* storage unavailable — the picker just falls back to resident behavior */ }
}
export function getHouseholdHint(): HouseholdHint | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(HOUSEHOLD_HINT_KEY);
    if (!raw) return null;
    const h = JSON.parse(raw) as HouseholdHint;
    return h && typeof h.id === "string" && /^hh_[a-z0-9]+$/.test(h.id) ? h : null;
  } catch { return null; }
}
export function clearHouseholdHint(): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.removeItem(HOUSEHOLD_HINT_KEY); } catch { /* ignore */ }
}

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

/* ---- Planner brain (plain English → an executable plan, or a mini app) ---- */
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
export interface GeneratedMiniApp { type: string; name: string; description: string; data: Record<string, unknown> }
export interface MiniAppGenResult { ok: boolean; app?: GeneratedMiniApp; model?: string; error?: string; message?: string }
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
  params?: Record<string, unknown>; source?: string; sourceRef?: Record<string, unknown>;
}
/* ---- Helpers ----------------------------------------------------------------
 * ONE concept. A helper is a name, what it should do in plain English, when it runs,
 * and a single autonomy dial — which is why the Agent / Skill / Function / Playbook /
 * Automation / Trigger / Evolution types that used to live here are gone rather than
 * renamed. Running one is the same tool loop that answers a chat message.
 * -------------------------------------------------------------------------- */
export type HelperSchedule =
  | { kind: "manual" }
  | { kind: "hourly" }
  | { kind: "daily"; time: string }                    // "HH:MM", 24h, household clock
  | { kind: "weekly"; time: string; weekday: number }; // 0 = Sunday .. 6 = Saturday

export type HelperAutonomy = "ask" | "act" | "full";
export type HelperVisibility = "household" | "personal" | "nest";

/** The sentences a family actually reads. Every helper arrives with its own
 *  `autonomyText`; this copy exists for the EDITOR, where there is no helper yet — and
 *  it is the same wording the server sends, so the two can never describe the dial
 *  differently. */
export const AUTONOMY_TEXT: Record<HelperAutonomy, string> = {
  ask: "Asks before it does anything",
  act: "Does everyday things on its own, asks before sending or spending",
  full: "Does everything on its own, including sending and spending",
};

export interface HelperLastRun {
  at: number; finishedAt: number; ok: boolean; reason: string; summary: string;
  runIds: string[]; error: string | null;
}

export interface PublicHelper {
  id: string; name: string; icon: string; purpose: string; instructions: string;
  visibility: HelperVisibility; nestId: string | null;
  status: "Active" | "Paused"; enabled: boolean;
  schedule: HelperSchedule;
  /** Already human ("Every day at 7:00 AM"), on the HOUSEHOLD's clock — re-deriving it
   *  from `schedule` in the browser would silently render it in the viewer's timezone. */
  scheduleText: string;
  autonomy: HelperAutonomy;
  autonomyText: string;
  /** Asked for "full" without the standing to grant it, so `act` is what actually
   *  applies. The UI says so quietly rather than showing a promise policy won't keep. */
  autonomyDowngraded: boolean;
  conversationId: string | null;
  lastRun: HelperLastRun | null;
  createdBy: string | null; isMine: boolean; system: boolean;
  version: number; updatedAt: string;
}

/** POST/PATCH body. All optional on PATCH; name + instructions are required on POST. */
export interface HelperInput {
  name?: string;
  purpose?: string;
  instructions?: string;
  schedule?: HelperSchedule;
  autonomy?: HelperAutonomy;
  visibility?: HelperVisibility;
  status?: "Active" | "Paused";
  enabled?: boolean;
  icon?: string;
  /** Household PIN. Required ONLY to set autonomy "full" (403 pin_required / pin_invalid
   *  otherwise). Passed per call and never held in client state — the server consumes it
   *  and never persists it. */
  pin?: string;
}

export interface HelperTemplate {
  id: string; name: string; icon: string; category: string; purpose: string;
  instructions: string; schedule: HelperSchedule; autonomy: HelperAutonomy;
  scheduleText: string; autonomyText: string;
}
export interface HelperTemplateSection { key: string; title: string; templates: HelperTemplate[] }

/** What a run produced. A failure (HTTP 422) uses the SAME envelope with ok:false plus a
 *  plain-language `message`, so one call site renders both outcomes. */
export interface HelperRunResult {
  ok: boolean;
  answer?: string;
  toolCalls?: AssistantToolCall[];
  runIds?: string[];
  conversationId?: string | null;
  lastRun?: HelperLastRun | null;
  error?: string;
  message?: string;
}

/** A helper's history IS its chat thread — every run appended the ask and what it did. */
export interface HelperHistory {
  conversationId: string | null;
  messages: ServerConversationMessage[];
  lastRun: HelperLastRun | null;
}

/** WP-105/ISS-107 — the effective approval policy for one capability, resolved
 *  server-side in a single place (server/policy.mjs) and delivered with the rule that
 *  produced it, so the UI can state not just WHAT the policy is but WHY. */
export interface EffectivePolicy {
  decision: "allowed" | "needs_approval" | "blocked";
  rule: string;
  reason: string;
  requiresApproval: boolean;
  risk: string;
  baseRequiresApproval: boolean;
  riskOverridden: boolean;
  /** Whether per-capability "run this without asking" can take effect at all. False for
   *  anything high-risk or delivering — policy.mjs rule 6 refuses it there. Answered up front
   *  so a control can be greyed with a reason instead of accepted and then ignored. */
  canAutoAllow?: boolean;
}

/** The household's autonomy stance — one question instead of a capability matrix.
 *  Enforced in server/policy.mjs rule 7, which is the only place that decides what it means. */
export type Autonomy = "Cautious" | "Balanced" | "Trusted";

/** One external iMessage group chat FamiliOS has been let into, or is waiting to be. */
export interface GroupChat {
  id: string;
  chatGuid: string;
  displayName: string;
  status: "pending" | "bound" | "declined" | "revoked";
  boundBy: string | null;
  boundAt: string | null;
  /** Which dial authorised Famili to speak here. A household can flip autonomy to Trusted
   *  without ever opening the helper, so the answer says which one applied. */
  speakGrant: "helper_unattended" | "household_trusted" | "risk_override" | null;
  lastMessageAt: string | null;
  lastSpokeAt: string | null;
  knownParticipants: Array<{ memberId: string; name: string | null }>;
  /** Pseudonymous, and the word is deliberate: a salted slow hash of a ten-digit number
   *  resists a casual read of a backup, not a determined attacker. Nothing identifying is
   *  kept about these people and none of their messages are stored. */
  unknownParticipantCount: number;
  messageCount: number;
}
export interface GroupChatsView {
  chats: GroupChat[];
  canSpeak: boolean;
  speakGrant: string | null;
  speakBlockedReason: string | null;
  /** Whether the passive listener has a usable triage model — a different question from
   *  canSpeak, and the only place a person can now learn the answer. */
  canListen: boolean;
  listenModel: string | null;
  listenBlockedReason: string | null;
  transcriptDays: number;
}

export interface BackendSettings {
  externalActionsEnabled: boolean;
  ownerPinSet?: boolean;
  aiActiveProvider?: string | null;
  calendarAutoSync?: boolean;
  autoApproveImprovements?: boolean;
  autoApproveImprovementsDefaulted?: boolean;
  timezone?: string | null;
  hideProfilesPreAuth?: boolean;
  autonomy?: Autonomy;
  /** True until a person actually chooses — so the UI can invite a decision rather than
   *  present an unanswered default as though someone had made it. */
  autonomyDefaulted?: boolean;
  autonomySetByRole?: string | null;
  autonomySetAt?: string | null;
  /** The cheap tier the passive group-chat listener runs on. Separate from
   *  aiActiveProvider because they are two decisions: a household that has not made the
   *  second one should see that it has not, rather than see a blank. */
  aiTriageProvider?: string | null;
  aiTriageModel?: string | null;
  aiTriageDailyBudget?: number;
  /** Shadow mode is the default: the classifier records its verdicts from the moment a
   *  chat is bound and proposes nothing until this is on. */
  chatProposalsEnabled?: boolean;
  /** Keep messages from people outside the household in joined group chats. Default false. */
  storeAllChatParticipants?: boolean;
  /** 0 means the external chat transcript is ephemeral, which is the default. */
  chatTranscriptDays?: number;
  /** Daily AI call cap — metered and enforced server-side since C1.3, settable since 2.8.
   *  null means unmetered, which is the default. `aiCallsToday` is the count it measures. */
  aiDailyCallBudget?: number | null;
  aiCallsToday?: number;
  /** Whether this profile signs in with an email account. Only those can be deleted — a
   *  resident-household PIN profile has no identity behind it, so the control is omitted
   *  rather than shown refusing. */
  hasIdentity?: boolean;
}

/* ---- Assistant (conversational NL → answer | plan, executed via a server run) ---- */
/** What the assistant engine actually DID this turn, one entry per tool call. A step that
 *  was approval-gated becomes a durable run (`runId`) parked on `approvalId`. `status:
 *  "running"` is client-only: a live `tool` stream frame mirrored into the message until
 *  the final `toolCalls` list on `done` replaces it. */
export interface AssistantToolCall {
  tool: string;
  label: string;
  status: "done" | "failed" | "blocked" | "awaiting_approval" | "running";
  ok?: boolean;
  summary?: string;
  runId?: string;
  approvalId?: string;
}
/** A `tool` frame on /api/assistant/stream — the tool the engine is on right now. */
export interface AssistantToolEvent { tool: string; label?: string; status: "running" | "called" | "error"; message?: string }
export interface AssistantResult {
  ok: boolean;
  /** Always "answer" from the current engine. "plan" is still accepted because older
   *  conversations were persisted with it and are replayed from the server verbatim. */
  kind?: "answer" | "plan";
  answer?: string; plan?: AgentPlan;
  toolCalls?: AssistantToolCall[];
  /** Present when a step was approval-gated and became a durable run — with ANY kind. */
  runId?: string | null; run?: ServerRun | null; runIds?: string[];
  model?: string; degraded?: boolean; fellBackFrom?: string;
  error?: string; message?: string;
}
/* ---- server-owned family data (P1/P4) ---- */
/* The event record is GENERATED from the server's own declaration
 * (server/actions/schemas/event.mjs → src/generated/actions.ts): one shape for the web
 * client, the mobile client and the API, kept equal by CI. The hand-written interface this
 * replaces lacked appendable / myNotes / remindOffsets — fields GET /api/events had been
 * returning all along — and typed provenance as an opaque record. Alias, not rename, so
 * no screen import changes. */
import type { EventRecord } from "@/generated/actions";
export type ServerEvent = EventRecord;
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
export interface ServerConversationMessage {
  role: "user" | "assistant"; text: string; kind?: string; plan?: AgentPlan | null; model?: string | null; at: string;
  /** New engine: what the turn did, and the durable run(s) an approval gate parked. */
  toolCalls?: AssistantToolCall[] | null; runIds?: string[] | null; runId?: string | null;
}
export interface ServerConversation { id: string; householdId: string; actorId: string; title: string; messages: ServerConversationMessage[]; createdAt: string; updatedAt: string }
/** `agentId` (top-level or in `source`) is the run's agent when the server attributes it;
 *  absent for memories written outside an agent run. */
export interface ServerMemory { id: string; householdId: string; scope: string; type: string; text: string; createdAt: number; agentId?: string | null; source?: { runId?: string; actorId?: string; agentId?: string | null } }
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
  verified: boolean; optInStatus: "Opted In" | "Pending" | "Not Set" | "Opted Out";
  allowedAgentIds: string[]; createdBy?: string; createdAt?: string; updatedAt?: string;
}

// CSRF token for the current session (set on login / session bootstrap). Never persisted.
let csrfToken: string | null = null;
export function setCsrf(t: string | null) { csrfToken = t; }

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
async function req<T>(path: string, init?: RequestInit & { mutation?: boolean }): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init?.headers as Record<string, string> | undefined) };
  // Derived from the method, not a per-call flag: a forgotten `mutation: true` used to ship
  // an unprotected POST/PATCH/DELETE that the server then refused. The flag can only widen.
  const mutation = init?.mutation ?? !SAFE_METHODS.has((init?.method ?? "GET").toUpperCase());
  if (mutation && csrfToken) headers["x-homeops-csrf"] = csrfToken;
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
  async login(input: { actorId: string; actorName: string; role: string; pin?: string; household?: string }): Promise<{ session?: Session; error?: string; message?: string }> {
    try {
      const r = await req<{ session?: Session; error?: string; message?: string }>("/session", { method: "POST", body: JSON.stringify(input) });
      if (r.session) { setCsrf(r.session.csrf); saveHouseholdHint(r.session.householdId); }
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
      if (r.session) { setCsrf(r.session.csrf); saveHouseholdHint(r.session.householdId); }
      return r;
    } catch { return { error: "backend_unreachable" }; }
  },
  async signup(input: { email: string; password: string; ownerName: string; householdName?: string; inviteToken?: string }): Promise<{ session?: Session; error?: string; message?: string }> {
    try {
      const r = await req<{ session?: Session; error?: string; message?: string }>("/signup", { method: "POST", body: JSON.stringify(input) });
      if (r.session) { setCsrf(r.session.csrf); saveHouseholdHint(r.session.householdId, input.householdName ?? null); }
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
  /* Fetched rather than linked, so a failure is a message instead of a browser tab showing raw
   * JSON or an error page. The blob is handed to a synthetic <a download> because that is the
   * only way to name a file the browser will save. */
  async exportHousehold(): Promise<{ ok: boolean; error?: string; message?: string }> {
    try {
      const res = await fetch("/api/export", { credentials: "same-origin" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error ?? `http_${res.status}`, message: body.message };
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "familios-export.json";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      return { ok: true };
    } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  /* Delete the SIGNED-IN PERSON's FamiliOS account — not `revokeAccount`, which disconnects a
   * connected provider. The names are close and the consequences are not.
   *
   * The blast radius is decided server-side from the caller's role and is NOT symmetric: an
   * Owner deletes the ENTIRE household (tenant, identities, sessions, backups — everyone's
   * data), anyone else deletes only themselves. `deleted` says which happened, so the UI can
   * confirm what actually occurred instead of guessing. */
  async deleteMyAccount(password: string): Promise<{ ok?: boolean; deleted?: "household" | "account"; error?: string; message?: string }> {
    try { return await req("/account", { method: "DELETE", body: JSON.stringify({ password }), mutation: true }); }
    catch { return { error: "backend_unreachable" }; }
  },
  async getSettings(): Promise<BackendSettings> {
    try { return (await req<{ settings: BackendSettings }>("/settings")).settings; } catch { return { externalActionsEnabled: true }; }
  },
  /* The autonomy stance gets its own writer because it is the one settings change that can be
   * REFUSED for a reason the person can fix. setSettings swallows everything into a default
   * object, so a `pin_required` on the way up to Trusted would have surfaced as a silent
   * no-op — the same shape of failure as the risk-override card that couldn't save. */
  async setAutonomy(autonomy: Autonomy, pin?: string): Promise<{ ok: boolean; settings?: BackendSettings; error?: string; message?: string }> {
    try {
      const r = await req<{ settings?: BackendSettings; error?: string; message?: string }>("/settings", { method: "POST", body: JSON.stringify({ autonomy, ...(pin ? { pin } : {}) }), mutation: true });
      if (r.settings) return { ok: true, settings: r.settings };
      return { ok: false, error: r.error ?? "unknown", message: r.message };
    } catch { return { ok: false, error: "backend_unreachable" }; }
  },
  async setSettings(patch: Record<string, unknown>): Promise<{ externalActionsEnabled: boolean; calendarAutoSync?: boolean; autoApproveImprovements?: boolean; autoApproveImprovementsDefaulted?: boolean; timezone?: string | null; hideProfilesPreAuth?: boolean }> {
    try { return (await req<{ settings: { externalActionsEnabled: boolean; calendarAutoSync?: boolean; autoApproveImprovements?: boolean; autoApproveImprovementsDefaulted?: boolean; timezone?: string | null; hideProfilesPreAuth?: boolean } }>("/settings", { method: "POST", body: JSON.stringify(patch), mutation: true })).settings; } catch { return { externalActionsEnabled: true }; }
  },

  /* ---- External group chats (the passive listener) ----
   * A chat only appears here once a verified member of this household has spoken in it;
   * until then FamiliOS does not know the thread exists. Binding takes an adult and
   * requires the speak grant to already exist, because the first thing a bind does is
   * introduce Famili in the thread. Revoking is open to anyone in the chat, which is
   * handled over the bridge rather than here. */
  async groupChats(): Promise<GroupChatsView> {
    try {
      return await req<GroupChatsView>("/group-chats");
    } catch { return { chats: [], canSpeak: false, speakGrant: null, speakBlockedReason: "FamiliOS is unreachable.", canListen: false, listenModel: null, listenBlockedReason: "FamiliOS is unreachable.", transcriptDays: 0 }; }
  },
  async bindGroupChat(chatId: string, displayName?: string): Promise<{ ok?: boolean; error?: string; message?: string }> {
    try { return await req("/group-chats", { method: "POST", body: JSON.stringify({ chatId, displayName }), mutation: true }); }
    catch { return { error: "backend_unreachable" }; }
  },
  async revokeGroupChat(chatId: string): Promise<{ ok?: boolean; messagesDeleted?: number; error?: string; message?: string }> {
    try { return await req(`/group-chats/${encodeURIComponent(chatId)}`, { method: "DELETE", mutation: true }); }
    catch { return { error: "backend_unreachable" }; }
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

  /* ---- mini-app generator (the one planner-brain route that survived) ---- */
  async generateMiniApp(input: { goal: string; type?: string; providerId?: string }): Promise<MiniAppGenResult> {
    try { return await req("/miniapps/generate", { method: "POST", body: JSON.stringify(input), mutation: true }); } catch { return { ok: false, error: "backend_unreachable", message: "Backend runtime is not reachable." }; }
  },
  /* ---- assistant (the conversational loop; a PLAN starts a durable server run) ---- */
  // clientTurnId names the turn so the server runs it at most once, however many times the
  // request reaches it (a retry after a dropped stream must not execute the tools twice).
  async assistant(message: string, context?: Record<string, unknown>, providerId?: string, conversationId?: string, clientTurnId?: string): Promise<AssistantResult> {
    try { return await req("/assistant", { method: "POST", body: JSON.stringify({ message, context, providerId, conversationId, clientTurnId }), mutation: true }); } catch { return { ok: false, error: "backend_unreachable", message: "Backend runtime is not reachable." }; }
  },
  // SSE streaming assistant — fires onProgress with a token count while the AI is
  // generating, onDelta with each slice of reply text, onTool as the engine starts /
  // finishes each tool, then resolves with the final parsed AssistantResult.
  streamAssistant(
    body: { message: string; context?: Record<string, unknown>; providerId?: string; conversationId?: string; clientTurnId?: string },
    onProgress?: (tokens: number) => void,
    onPhase?: (phase: string) => void,
    onDelta?: (text: string) => void,
    onTool?: (ev: AssistantToolEvent) => void,
  ): Promise<AssistantResult> {
    return new Promise((resolve) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (csrfToken) headers["x-homeops-csrf"] = csrfToken;
      // (Removed: an `new EventSource("/api/assistant/stream")` immediately followed by
      // .close(). EventSource cannot POST, so it was never the transport — but it DID fire a
      // real GET at the streaming endpoint on every single chat turn before aborting it.)
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
                // The server has always emitted `phase` ("searching" / "creating"), it is
                // covered end-to-end by server/test/assistant-phase.test.mjs, and MOBILE has
                // shown it for a while — the web client just dropped it on the floor. So a
                // web user watching a live web lookup read "Generating…" through the slowest
                // part of the request, with nothing saying the assistant was out searching.
                if (ev.type === "phase" && onPhase && typeof ev.phase === "string") onPhase(ev.phase);
                if (ev.type === "delta" && onDelta && typeof ev.text === "string") onDelta(ev.text);
                if (ev.type === "tool" && onTool && typeof ev.tool === "string") onTool(ev as AssistantToolEvent);
                if (ev.type === "done") { resolve(ev.result as AssistantResult); return; }
              } catch {}
            }
          }
          resolve({ ok: false, error: "stream_incomplete" });
        })
        .catch(() => resolve({ ok: false, error: "backend_unreachable", message: "Backend runtime is not reachable." }));
    });
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
  /* ---- risk-class overrides (item 9) — admin-only; server enforces in the engine ---- */
  async riskOverrides(): Promise<{ overrides: RiskOverride[]; catalog: CatalogTool[] } | null> {
    try { return await req("/risk-overrides"); } catch { return null; }
  },
  /* `pin` is not optional in practice: the server requires the household PIN for this write
   * whenever one is set. Omitting it returned `pin_required`, which the UI showed as a plain
   * failure — so the card looked broken rather than gated. Caller collects and retries. */
  async setRiskOverride(toolId: string, patch: { riskClass?: string | null; skipApproval?: boolean; pin?: string }): Promise<{ override?: RiskOverride; error?: string; message?: string }> {
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
  async profiles(householdHint?: string | null): Promise<{ profiles: { actorId: string; displayName: string; role: string; pinRequired: boolean }[]; claimed: boolean; householdName?: string | null; hidden?: boolean } | null> {
    const q = householdHint && /^hh_[a-z0-9]+$/.test(householdHint) ? `?household=${encodeURIComponent(householdHint)}` : "";
    try { return await req(`/profiles${q}`); } catch { return null; }
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

  /* ---- helpers -----------------------------------------------------------
   * The whole agent system. `scheduleText` / `autonomyText` arrive already written, so
   * nothing here re-phrases them; `pin` is only ever sent on the call that raises
   * autonomy to "full".
   * ----------------------------------------------------------------------- */
  async helpers(): Promise<PublicHelper[]> {
    try { return (await req<{ helpers: PublicHelper[] }>("/helpers")).helpers ?? []; } catch { return []; }
  },
  async getHelper(id: string): Promise<PublicHelper | null> {
    try { return (await req<{ helper: PublicHelper }>(`/helpers/${id}`)).helper ?? null; } catch { return null; }
  },
  async createHelper(body: HelperInput): Promise<{ helper?: PublicHelper; error?: string; message?: string }> {
    try { return await req(`/helpers`, { method: "POST", body: JSON.stringify(body), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async updateHelper(id: string, patch: HelperInput): Promise<{ helper?: PublicHelper; error?: string; message?: string }> {
    try { return await req(`/helpers/${id}`, { method: "PATCH", body: JSON.stringify(patch), mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  async deleteHelper(id: string): Promise<{ ok?: boolean; error?: string; message?: string }> {
    try { return await req(`/helpers/${id}`, { method: "DELETE", mutation: true }); } catch { return { error: "backend_unreachable" }; }
  },
  // A run IS a full tool loop and routinely takes 30s+. A 422 carries the real reason in
  // `message`, and req() resolves (never throws) on it — so the refusal is returned as-is
  // instead of being flattened into "unreachable", which is a different and untrue thing.
  async runHelper(id: string): Promise<HelperRunResult> {
    try { return await req<HelperRunResult>(`/helpers/${id}/run`, { method: "POST", mutation: true }); }
    catch { return { ok: false, error: "backend_unreachable", message: "Backend runtime is not reachable." }; }
  },
  async helperHistory(id: string): Promise<HelperHistory> {
    const empty: HelperHistory = { conversationId: null, messages: [], lastRun: null };
    try {
      const r = await req<Partial<HelperHistory>>(`/helpers/${id}/history`);
      // req() resolves on 404/401 too, so an error envelope would otherwise be spread in
      // as if it were a thread. Only an actual message list counts as history.
      return Array.isArray(r?.messages) ? { conversationId: r.conversationId ?? null, messages: r.messages, lastRun: r.lastRun ?? null } : empty;
    } catch { return empty; }
  },
  async helperTemplates(): Promise<HelperTemplateSection[]> {
    try { return (await req<{ sections: HelperTemplateSection[] }>("/helper-templates")).sections ?? []; } catch { return []; }
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
