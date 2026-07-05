// Mobile API client for the HomeOps backend. Native can't use same-origin
// cookies, so it authenticates with a bearer token (issued by POST /api/session
// when the `x-homeops-bearer` header is set) stored in expo-secure-store. The
// backend still owns OAuth exchange, the AES token vault, and approvals.
import * as SecureStore from "expo-secure-store";

const RAW = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";
export const API_URL = RAW.replace(/\/+$/, "");
const TOKEN_KEY = "homeops_token";

let token: string | null = null;

export async function loadToken(): Promise<string | null> {
  try { token = await SecureStore.getItemAsync(TOKEN_KEY); } catch { token = null; }
  return token;
}
export async function setToken(t: string | null): Promise<void> {
  token = t;
  try {
    if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch { /* secure-store may be unavailable on web; keep in-memory */ }
}

export interface Session { actorId: string; actorName: string; role: string; csrf: string; householdId: string }
export interface ApprovalRec {
  id: string; connectorId: string | null; toolId: string; status: string; risk: string;
  category: string; preview: string; createdAt: number; expiresAt: number;
  decidedBy: string | null; decidedAt: number | null;
}
export interface PlanStep { toolId: string | null; title: string; detail: string; requiresApproval: boolean; risk: string; connectorName: string | null; connected: boolean }
export interface AgentPlan { title: string; summary: string; risk: string; steps: PlanStep[]; missing: string[]; approvalRequired: boolean; triggerType: string }
// Unified chat-builder: a proposed set of durable entities to stand up from a chat turn.
export interface ChatBuild {
  summary: string;
  skill?: { name: string; description?: string; planner_guidance?: string; risk_level?: string; steps?: { name: string; tool_id: string | null; approval_required: boolean }[] };
  agent?: { name: string; purpose?: string; instructions?: string } | null;
  automation?: { name: string; type: string; intervalMs?: number | null; runAt?: string | null } | null;
  edits?: { kind: "agent" | "skill"; id: string; summary?: string; patch: Record<string, unknown> }[];
}
export interface BuildResult {
  ok: boolean;
  created?: { skill?: { id: string; name: string }; agent?: { id: string; name: string }; automation?: { id: string; name: string } };
  updated?: { kind: string; id: string; name?: string; ok: boolean }[];
  notes?: string[]; error?: string; message?: string;
}
export interface AssistantResult { ok: boolean; kind?: "answer" | "plan" | "build"; answer?: string; plan?: AgentPlan; build?: ChatBuild; model?: string; error?: string; message?: string }
// Server-durable assistant conversations — same records the web client uses, so a chat
// started on the phone shows up on the web (and vice versa) and survives app restarts.
export interface ConversationMessage {
  role: "user" | "assistant"; text: string; at: string; kind?: string;
  plan?: AgentPlan | null; build?: ChatBuild | null; built?: boolean;
  builtIds?: { skillId?: string; agentId?: string; triggerId?: string };
}
export interface ConversationRec { id: string; title: string; messages: ConversationMessage[]; createdAt: string; updatedAt: string }
// Durable server runs (read-only view) — used to enrich approval previews with the
// gated step's REAL resolved input (the approval record itself only carries a hash).
export interface RunStepRec { index: number; toolId: string | null; title: string; detail: string; status: string; approvalId: string | null; input: Record<string, unknown> }
export interface EmailReviewMessageRec { id: string; subject: string; from: string; snippet: string; added: string[]; removed: string[] }
export interface RunRec { id: string; title: string; status: string; steps: RunStepRec[] }
// Risk-class overrides (item 9) — admin-set, server-enforced.
export interface RiskOverrideRec { id: string; toolId: string; riskClass: string | null; skipApproval: boolean; setBy: string; setAt: string }
export interface CatalogToolRec {
  toolId: string; name: string; action: string; risk: string; requiresApproval: boolean;
  connectorId: string; connectorName: string; connected: boolean;
  riskOverridden?: boolean; defaultRisk?: string; defaultRequiresApproval?: boolean;
}
export interface AuditEvent { id: string; at: string; type: string; ok: boolean; actorName?: string; toolId?: string; error?: string }
export interface ToolResult { ok: boolean; result?: unknown; error?: string; message?: string }
export interface OAuthStartResult { ok?: boolean; url?: string; error?: string; message?: string }
// Server-owned family data (mirrors the web client). The backend returns these already
// role/visibility-filtered for the bearer session's actor, so a child's device never
// receives adults-only items — no client-side hiding required.
export interface EventRec {
  id: string; title: string; startAt: string | null; endAt: string | null; location: string;
  driverId: string | null; participantIds: string[]; whatToBring: { item: string; memberId: string | null }[];
  checklist: { text: string; done: boolean }[]; visibility: string; layer: "canonical" | "linked" | "public"; category: string;
}
export interface TaskRec {
  id: string; title: string; type: string; status: string; dueAt: string | null;
  assignedMemberId: string | null; priority: string; amount: number | null; visibility: string;
  listName?: string;
}
// Meal plan + the read-only "linked" calendar layer (ICS/Google subscriptions) —
// same shapes as the web client (src/connectors/api.ts).
export interface MealIngredient { item: string; have?: boolean }
export interface Meal {
  id: string; householdId: string; date: string | null; time?: string | null; slot: string; title: string; notes: string;
  ingredients: MealIngredient[]; visibility: string; source: string; createdBy: string; createdAt: string; updatedAt: string;
}
export interface CalendarSubscription {
  id: string; name: string; url: string | null; source: string; lastSyncAt: number | null;
  lastResult: { imported?: number; updated?: number; removed?: number; error?: string } | null;
  eventCount: number; createdAt: number;
}
export interface CalendarSync { ok: boolean; imported?: number; updated?: number; removed?: number; total?: number; error?: string }
// Household files (server-owned library) + read-only knowledge (memory/artifacts).
export interface FileRec {
  id: string; householdId: string; name: string; mime: string; sizeBytes: number;
  tags: string[]; visibility: string; spaceId: string; uploadedBy: string; source: string; createdAt: string;
}
export interface MemoryRec { id: string; scope: string; type: string; text: string; createdAt: number; source?: { runId?: string; actorId?: string } }
export interface PlaybookRec {
  id: string; name: string; description: string; whenToUse: string; category: string;
  steps: string[]; requiredConnections: string[]; outputFormat: string; approvalRules: string[];
  archived: boolean; system: boolean; createdAt: string;
}
export interface ArtifactRec { id: string; runId?: string; kind: string; title: string; body?: string; createdAt: number }
export interface MemberRec { actorId: string; displayName: string; role: string; relationship: string | null; spaceIds: string[]; isCurrentUser: boolean }
// Contact methods — the server-owned delivery registry (per-member email/phone/in-app/
// dashboard entries with verified + opt-in state and a per-agent allowlist). Same
// records the web Contacts tab manages; the server enforces the role gates.
export type ContactMethodType = "Email" | "Phone/Text" | "In-App" | "Family Dashboard";
export interface ContactMethodRec {
  id: string; memberId: string; label: string; type: ContactMethodType; value: string;
  verified: boolean; optInStatus: "Opted In" | "Pending" | "Not Set";
  allowedAgentIds: string[]; createdAt?: string; updatedAt?: string;
}
// AI providers (server truth — readiness is verified, never assumed).
export interface AIProviderRec {
  id: string; name: string; kind: "cloud" | "local"; local: boolean; needsKey: boolean; needsBaseUrl: boolean;
  docs: string; defaultBaseUrl: string; defaultModel: string; baseUrl: string; model: string; keySet: boolean;
  readiness: "not_configured" | "configured" | "needs_health_check" | "healthy" | "unreachable";
  health: { ok: boolean; status: string; at: number | null; latencyMs: number | null } | null;
  active: boolean; updatedAt?: string;
}
export interface AIChatResult { ok: boolean; model?: string; text?: string; error?: string; message?: string }
export interface AIHealthResult { ok: boolean; status?: string; latencyMs?: number; models?: string[]; error?: string; message?: string }

interface Res<T> { status: number; ok: boolean; data: T }

async function req<T = unknown>(path: string, init?: RequestInit): Promise<Res<T>> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init?.headers as Record<string, string> | undefined) };
  if (token) headers["authorization"] = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { ...init, headers });
  } catch (e) {
    return { status: 0, ok: false, data: { error: "network", message: String((e as Error)?.message ?? e) } as unknown as T };
  }
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: "bad_json" }; }
  return { status: res.status, ok: res.ok, data: data as T };
}

export interface ProfileRec { actorId: string; displayName: string; role: string; relationship: string | null; pinRequired: boolean }

export const api = {
  url: API_URL,
  async getSession(): Promise<Session | null> {
    const r = await req<{ session: Session | null }>("/session");
    return r.data?.session ?? null;
  },
  // Pre-auth profile picker — who can sign in on this household's backend.
  async profiles(): Promise<{ profiles: ProfileRec[]; claimed: boolean } | null> {
    const r = await req<{ profiles: ProfileRec[]; claimed: boolean }>("/profiles");
    return r.ok ? r.data : null;
  },
  async login(input: { actorId: string; actorName: string; role: string; pin?: string }): Promise<{ session?: Session; token?: string; error?: string }> {
    const r = await req<{ session?: Session; token?: string; error?: string }>("/session", {
      method: "POST", headers: { "x-homeops-bearer": "1" }, body: JSON.stringify(input),
    });
    if (r.data?.token) await setToken(r.data.token);
    return r.data ?? { error: "unknown" };
  },
  async logout(): Promise<void> {
    try { await req("/session", { method: "DELETE" }); } finally { await setToken(null); }
  },
  async health(): Promise<{ ok: boolean; version?: string; runtime?: string; externalActionsEnabled?: boolean } | null> {
    const r = await req<{ ok: boolean; version?: string; runtime?: string; externalActionsEnabled?: boolean }>("/health");
    return r.ok ? r.data : null;
  },
  async approvals(): Promise<ApprovalRec[]> {
    const r = await req<{ approvals: ApprovalRec[] }>("/approvals");
    return r.data?.approvals ?? [];
  },
  async decideApproval(id: string, approve: boolean): Promise<{ approval?: ApprovalRec; error?: string }> {
    const r = await req<{ approval?: ApprovalRec; error?: string }>(`/approvals/${id}/decide`, {
      method: "POST", body: JSON.stringify({ decision: approve ? "approve" : "deny" }),
    });
    return r.data ?? {};
  },
  async connectors(): Promise<Array<{ id: string; name: string; readiness: string; live: boolean; category: string }>> {
    const r = await req<{ connectors: Array<{ id: string; name: string; readiness: string; live: boolean; category: string }> }>("/connectors");
    return r.data?.connectors ?? [];
  },
  async providers(): Promise<Array<{ id: string; name: string; readiness: string; accounts: unknown[] }>> {
    const r = await req<{ providers: Array<{ id: string; name: string; readiness: string; accounts: unknown[] }> }>("/providers");
    return r.data?.providers ?? [];
  },
  // conversationId (optional) makes the turn server-durable: both messages persist on
  // the conversation, so history survives app restarts and shows up on the web too.
  async assistant(message: string, opts?: { context?: Record<string, unknown>; conversationId?: string }): Promise<AssistantResult> {
    const r = await req<AssistantResult>("/assistant", { method: "POST", body: JSON.stringify({ message, context: opts?.context, conversationId: opts?.conversationId }) });
    return r.data ?? { ok: false, error: "network" };
  },
  /* ---- server-durable conversations (mirror of the web chat history) ---- */
  async conversations(): Promise<ConversationRec[]> {
    const r = await req<{ conversations: ConversationRec[] }>("/conversations");
    return r.data?.conversations ?? [];
  },
  async createConversation(title: string): Promise<ConversationRec | null> {
    const r = await req<{ conversation?: ConversationRec }>("/conversations", { method: "POST", body: JSON.stringify({ title }) });
    return r.data?.conversation ?? null;
  },
  async conversation(id: string): Promise<ConversationRec | null> {
    const r = await req<{ conversation?: ConversationRec }>(`/conversations/${encodeURIComponent(id)}`);
    return r.data?.conversation ?? null;
  },
  async deleteConversation(id: string): Promise<{ ok?: boolean; error?: string }> {
    const r = await req<{ ok?: boolean; error?: string }>(`/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
    return r.data ?? { error: "network" };
  },
  /* ---- durable runs (read-only; enriches approval previews with real step input) ---- */
  async runs(status?: string): Promise<RunRec[]> {
    const r = await req<{ runs: RunRec[] }>(`/runs${status ? `?status=${encodeURIComponent(status)}` : ""}`);
    return r.data?.runs ?? [];
  },
  // Item 3: correlated per-message label changes for a completed run. Available for
  // parity; the mobile review UI lands once mobile plan dispatch moves to the durable
  // server engine (today mobile orchestrates plans client-side, so there's no server
  // runId to review — see the iteration log).
  async emailReview(runId: string): Promise<{ runId: string; messages: EmailReviewMessageRec[]; labels: { id: string; name: string; type: string }[]; touchedGmail: boolean } | null> {
    const r = await req<{ runId: string; messages: EmailReviewMessageRec[]; labels: { id: string; name: string; type: string }[]; touchedGmail: boolean }>(`/runs/${encodeURIComponent(runId)}/email-review`);
    return r.ok ? r.data : null;
  },
  /* ---- memory delete (item 11 mirror; server enforces visibility) ---- */
  async deleteMemory(id: string): Promise<{ ok?: boolean; error?: string }> {
    const r = await req<{ ok?: boolean; error?: string }>(`/memory/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  /* ---- notifications (item 16b mirror; real channel routing, honest availability) ----
   * methodId resolves channel + address from the server-owned contact-method registry
   * (verified/opt-in enforced server-side); methodType/to stays for ad-hoc sends. */
  async notify(input: { methodId?: string; methodType?: string; to?: string | null; title: string; body: string }): Promise<{ ok?: boolean; channel?: string; delivered?: boolean; needsSetup?: string; message?: string; error?: string }> {
    const r = await req<{ ok?: boolean; channel?: string; delivered?: boolean; needsSetup?: string; message?: string; error?: string }>("/notify", { method: "POST", body: JSON.stringify(input) });
    return r.data ?? { error: "network" };
  },
  /* ---- contact methods (server-owned delivery registry; adults manage anyone,
   * everyone else manages their own — the server enforces it) ---- */
  async contactMethods(): Promise<ContactMethodRec[]> {
    const r = await req<{ contactMethods: ContactMethodRec[] }>("/contact-methods");
    return r.data?.contactMethods ?? [];
  },
  async createContactMethod(body: { memberId?: string; label: string; type: ContactMethodType; value?: string }): Promise<{ contactMethod?: ContactMethodRec; error?: string; message?: string }> {
    const r = await req<{ contactMethod?: ContactMethodRec; error?: string; message?: string }>("/contact-methods", { method: "POST", body: JSON.stringify(body) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async patchContactMethod(id: string, patch: { label?: string; value?: string; verified?: boolean; optInStatus?: string; allowedAgentIds?: string[] }): Promise<{ contactMethod?: ContactMethodRec; error?: string; message?: string }> {
    const r = await req<{ contactMethod?: ContactMethodRec; error?: string; message?: string }>(`/contact-methods/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async deleteContactMethod(id: string): Promise<{ ok?: boolean; error?: string }> {
    const r = await req<{ ok?: boolean; error?: string }>(`/contact-methods/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  // The true verification loop: a 6-digit code through the method's real channel,
  // then confirm it to prove control of the address (verified + opted-in).
  async sendContactVerification(id: string): Promise<{ ok?: boolean; channel?: string; needsSetup?: string; retryInMs?: number; message?: string; error?: string }> {
    const r = await req<{ ok?: boolean; channel?: string; needsSetup?: string; retryInMs?: number; message?: string; error?: string }>(`/contact-methods/${encodeURIComponent(id)}/send-verification`, { method: "POST", body: "{}" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async confirmContactVerification(id: string, code: string): Promise<{ ok?: boolean; alreadyVerified?: boolean; contactMethod?: ContactMethodRec; attemptsLeft?: number; message?: string; error?: string }> {
    const r = await req<{ ok?: boolean; alreadyVerified?: boolean; contactMethod?: ContactMethodRec; attemptsLeft?: number; message?: string; error?: string }>(`/contact-methods/${encodeURIComponent(id)}/verify`, { method: "POST", body: JSON.stringify({ code }) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async notifications(): Promise<{ id: string; channel: string; title: string; body: string; read: boolean; createdAt: number }[]> {
    const r = await req<{ notifications: { id: string; channel: string; title: string; body: string; read: boolean; createdAt: number }[] }>("/notifications");
    return r.data?.notifications ?? [];
  },
  async markNotificationRead(id: string): Promise<{ ok?: boolean }> {
    const r = await req<{ ok?: boolean }>(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST", body: "{}" });
    return r.data ?? {};
  },
  /* ---- risk-class overrides (item 9 mirror; Adult Admin only, server-enforced) ---- */
  async riskOverrides(): Promise<{ overrides: RiskOverrideRec[]; catalog: CatalogToolRec[] } | null> {
    const r = await req<{ overrides: RiskOverrideRec[]; catalog: CatalogToolRec[] }>("/risk-overrides");
    return r.ok ? r.data : null;
  },
  async setRiskOverride(toolId: string, patch: { riskClass?: string | null; skipApproval?: boolean }): Promise<{ override?: RiskOverrideRec; error?: string }> {
    const r = await req<{ override?: RiskOverrideRec; error?: string }>("/risk-overrides", { method: "PUT", body: JSON.stringify({ toolId, ...patch }) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async clearRiskOverride(toolId: string): Promise<{ ok?: boolean; error?: string }> {
    const r = await req<{ ok?: boolean; error?: string }>(`/risk-overrides/${encodeURIComponent(toolId)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async audit(limit = 40): Promise<AuditEvent[]> {
    const r = await req<{ events: AuditEvent[] }>(`/audit?limit=${limit}`);
    return r.data?.events ?? [];
  },
  // Server-owned family data (role/visibility-filtered server-side for this actor).
  async events(): Promise<EventRec[]> {
    const r = await req<{ events: EventRec[] }>("/events");
    return r.data?.events ?? [];
  },
  async createEvent(body: Partial<EventRec> & { title: string }): Promise<{ event?: EventRec; error?: string }> {
    const r = await req<{ event?: EventRec; error?: string }>("/events", { method: "POST", body: JSON.stringify(body) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async tasks(): Promise<TaskRec[]> {
    const r = await req<{ tasks: TaskRec[] }>("/tasks");
    return r.data?.tasks ?? [];
  },
  async members(): Promise<MemberRec[]> {
    const r = await req<{ members: MemberRec[] }>("/members");
    return r.data?.members ?? [];
  },
  async updateTask(id: string, patch: Partial<TaskRec>): Promise<{ task?: TaskRec; error?: string }> {
    const r = await req<{ task?: TaskRec; error?: string }>(`/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  // Meal plan (server-owned; Limited Member+ writes — the server enforces it).
  async meals(): Promise<Meal[]> {
    const r = await req<{ meals: Meal[] }>("/meals");
    return r.data?.meals ?? [];
  },
  async createMeal(body: { title: string; date?: string | null; slot?: string; ingredients?: (string | MealIngredient)[]; notes?: string }): Promise<{ meal?: Meal; error?: string }> {
    const r = await req<{ meal?: Meal; error?: string }>("/meals", { method: "POST", body: JSON.stringify(body) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async deleteMeal(id: string): Promise<{ ok?: boolean; unlinkedGroceries?: number; error?: string }> {
    const r = await req<{ ok?: boolean; unlinkedGroceries?: number; error?: string }>(`/meals/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async mealToGrocery(id: string): Promise<{ ok?: boolean; added?: number; error?: string }> {
    const r = await req<{ ok?: boolean; added?: number; error?: string }>(`/meals/${encodeURIComponent(id)}/to-grocery`, { method: "POST", body: "{}" });
    return r.data ?? { error: "network" };
  },
  // Item 5: meal → canonical calendar event (mealId-linked, idempotent). Google push
  // stays behind the existing approval-gated calendar push.
  async mealToCalendar(id: string): Promise<{ ok?: boolean; event?: EventRec; action?: string; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; event?: EventRec; action?: string; error?: string; message?: string }>(`/meals/${encodeURIComponent(id)}/to-calendar`, { method: "POST", body: "{}" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async deleteTask(id: string): Promise<{ ok?: boolean; error?: string }> {
    const r = await req<{ ok?: boolean; error?: string }>(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  // Household files — the server-owned library (metadata list, base64 upload/content).
  async files(): Promise<FileRec[]> {
    const r = await req<{ files: FileRec[] }>("/files");
    return r.data?.files ?? [];
  },
  async uploadFile(body: { name: string; contentBase64: string; mime?: string; tags?: string[]; visibility?: string }): Promise<{ file?: FileRec; error?: string; message?: string }> {
    const r = await req<{ file?: FileRec; error?: string; message?: string }>("/files", { method: "POST", body: JSON.stringify(body) });
    if (r.status === 403) return { error: "insufficient_role" };
    if (r.status === 413) return { error: "too_large" };
    return r.data ?? { error: "network" };
  },
  async fileContent(id: string): Promise<{ name?: string; mime?: string; contentBase64?: string; error?: string }> {
    const r = await req<{ name?: string; mime?: string; contentBase64?: string; error?: string }>(`/files/${encodeURIComponent(id)}/content`);
    return r.data ?? { error: "network" };
  },
  async deleteFile(id: string): Promise<{ ok?: boolean; error?: string }> {
    const r = await req<{ ok?: boolean; error?: string }>(`/files/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "forbidden" };
    return r.data ?? { error: "network" };
  },
  // Playbooks — server-owned workflow library (browse-only on mobile).
  async playbooks(): Promise<PlaybookRec[]> {
    const r = await req<{ playbooks: PlaybookRec[] }>("/playbooks");
    return r.data?.playbooks ?? [];
  },
  // Knowledge — household memory + run artifacts (read-only, written by runs).
  async memory(): Promise<MemoryRec[]> {
    const r = await req<{ memory: MemoryRec[] }>("/memory");
    return r.data?.memory ?? [];
  },
  async artifacts(): Promise<ArtifactRec[]> {
    const r = await req<{ artifacts: ArtifactRec[] }>("/artifacts");
    return r.data?.artifacts ?? [];
  },
  // Calendar subscriptions — the read-only "linked" layer (ICS feeds, pasted .ics, Google).
  async calendarSubscriptions(): Promise<CalendarSubscription[]> {
    const r = await req<{ subscriptions: CalendarSubscription[] }>("/calendar/subscriptions");
    return r.data?.subscriptions ?? [];
  },
  async subscribeCalendar(body: { name?: string; url: string }): Promise<{ subscription?: CalendarSubscription; sync?: CalendarSync; error?: string; message?: string }> {
    const r = await req<{ subscription?: CalendarSubscription; sync?: CalendarSync; error?: string; message?: string }>("/calendar/subscriptions", { method: "POST", body: JSON.stringify(body) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async importIcs(body: { name?: string; ics: string }): Promise<{ subscription?: CalendarSubscription; sync?: CalendarSync; error?: string; message?: string }> {
    const r = await req<{ subscription?: CalendarSubscription; sync?: CalendarSync; error?: string; message?: string }>("/calendar/import-ics", { method: "POST", body: JSON.stringify(body) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async connectGoogleCalendar(): Promise<{ subscription?: CalendarSubscription; sync?: CalendarSync; error?: string; message?: string }> {
    const r = await req<{ subscription?: CalendarSubscription; sync?: CalendarSync; error?: string; message?: string }>("/calendar/connect-google", { method: "POST", body: "{}" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async syncCalendar(id: string): Promise<{ subscription?: CalendarSubscription; sync?: CalendarSync; error?: string }> {
    const r = await req<{ subscription?: CalendarSubscription; sync?: CalendarSync; error?: string }>(`/calendar/subscriptions/${encodeURIComponent(id)}/sync`, { method: "POST", body: "{}" });
    return r.data ?? { error: "network" };
  },
  async deleteCalendarSubscription(id: string): Promise<{ ok?: boolean; removedEvents?: number; error?: string }> {
    const r = await req<{ ok?: boolean; removedEvents?: number; error?: string }>(`/calendar/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  // Unified chat-builder: materialize a proposed build into durable entities (Adult Admin).
  // conversationId makes the outcome durable on the thread (built flag + confirmation).
  async buildFromChat(build: ChatBuild, conversationId?: string): Promise<BuildResult> {
    const r = await req<BuildResult>("/assistant/build", { method: "POST", body: JSON.stringify({ build, conversationId }) });
    if (r.status === 403) return { ok: false, error: "insufficient_role" };
    return r.data ?? { ok: false, error: "network" };
  },
  async runStep(toolId: string, input: Record<string, unknown>, approvalId?: string): Promise<ToolResult> {
    const body: Record<string, unknown> = { input: input ?? {} };
    if (approvalId) body.approvalId = approvalId;
    const r = await req<ToolResult>(`/tools/${encodeURIComponent(toolId)}/execute`, {
      method: "POST", body: JSON.stringify(body),
    });
    return r.data ?? { ok: false, error: "network" };
  },
  async createApproval(toolId: string, input: Record<string, unknown>, opts: { category?: string; preview?: string }): Promise<{ approval?: ApprovalRec; error?: string }> {
    const r = await req<{ approval?: ApprovalRec; error?: string }>("/approvals", {
      method: "POST", body: JSON.stringify({ toolId, input, category: opts.category ?? "plan", preview: opts.preview ?? "" }),
    });
    return r.data ?? { error: "network" };
  },
  async registerPushToken(token: string): Promise<void> {
    await req("/push-tokens", { method: "POST", body: JSON.stringify({ token }) });
  },
  async unregisterPushToken(token: string): Promise<void> {
    await req("/push-tokens", { method: "DELETE", body: JSON.stringify({ token }) });
  },
  // AI providers — mirror the web AIProviders surface: truthful readiness, verify
  // by real probes, config/activate are Adult Admin (the server enforces it).
  async aiProviders(): Promise<AIProviderRec[]> {
    const r = await req<{ providers: AIProviderRec[] }>("/ai/providers");
    return r.data?.providers ?? [];
  },
  async aiConfigure(id: string, cfg: { apiKey?: string; baseUrl?: string; model?: string }): Promise<{ provider?: AIProviderRec; error?: string }> {
    const r = await req<{ provider?: AIProviderRec; error?: string }>(`/ai/providers/${encodeURIComponent(id)}/config`, {
      method: "POST", body: JSON.stringify(cfg),
    });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async aiRevoke(id: string): Promise<{ provider?: AIProviderRec; error?: string }> {
    const r = await req<{ provider?: AIProviderRec; error?: string }>(`/ai/providers/${encodeURIComponent(id)}/config`, { method: "DELETE" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async aiHealth(id: string): Promise<AIHealthResult> {
    const r = await req<AIHealthResult>(`/ai/providers/${encodeURIComponent(id)}/health`, { method: "POST" });
    return r.data ?? { ok: false, error: "network" };
  },
  async aiSetActive(providerId: string | null): Promise<{ activeProvider?: string | null; error?: string }> {
    const r = await req<{ activeProvider?: string | null; error?: string }>("/ai/active", {
      method: "POST", body: JSON.stringify({ providerId }),
    });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async aiChat(message: string, providerId?: string): Promise<AIChatResult> {
    const r = await req<AIChatResult>("/ai/chat", {
      method: "POST", body: JSON.stringify({ providerId, messages: [{ role: "user", content: message }] }),
    });
    return r.data ?? { ok: false, error: "network" };
  },
  async oauthStart(provider: string): Promise<OAuthStartResult> {
    const r = await req<OAuthStartResult>(`/oauth/${encodeURIComponent(provider)}/start`, {
      headers: { "x-homeops-mobile": "1" },
    });
    return r.data ?? { error: "network" };
  },

  /* ---- Durable server runs (canonical runtime; resolves step inputs itself) ---- */
  async startRunPlan(plan: AgentPlan): Promise<{ run?: RunRec; error?: string; message?: string }> {
    const r = await req<{ run?: RunRec; error?: string; message?: string }>("/runs/start", {
      method: "POST", body: JSON.stringify({ plan, source: "manual" }),
    });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async getRun(id: string): Promise<{ run?: RunRec; error?: string }> {
    const r = await req<{ run?: RunRec; error?: string }>(`/runs/${encodeURIComponent(id)}`);
    return r.data ?? { error: "network" };
  },

  /* ---- Tasks (create/edit come to mobile with the redesign) ---- */
  async createTask(body: { title: string; type?: string; dueAt?: string | null; assignedMemberId?: string | null; priority?: string; listName?: string }): Promise<{ task?: TaskRec; error?: string }> {
    const r = await req<{ task?: TaskRec; error?: string }>("/tasks", { method: "POST", body: JSON.stringify(body) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },

  /* ---- Events (edit/delete) ---- */
  async updateEvent(id: string, patch: Record<string, unknown>): Promise<{ event?: EventRec; error?: string }> {
    const r = await req<{ event?: EventRec; error?: string }>(`/events/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async deleteEvent(id: string): Promise<{ ok?: boolean; error?: string }> {
    const r = await req<{ ok?: boolean; error?: string }>(`/events/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },

  /* ---- Agents (list / run / pause / duplicate / delete) ---- */
  async agents(): Promise<AgentRec[]> {
    const r = await req<{ agents: AgentRec[] }>("/agents");
    return r.data?.agents ?? [];
  },
  async patchAgent(id: string, patch: Record<string, unknown>): Promise<{ agent?: AgentRec; error?: string }> {
    const r = await req<{ agent?: AgentRec; error?: string }>(`/agents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async runAgent(id: string): Promise<{ ok?: boolean; run?: RunRec; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; run?: RunRec; error?: string; message?: string }>(`/agents/${encodeURIComponent(id)}/run`, { method: "POST", body: "{}" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async duplicateAgent(id: string): Promise<{ agent?: AgentRec; error?: string }> {
    const r = await req<{ agent?: AgentRec; error?: string }>(`/agents/${encodeURIComponent(id)}/duplicate`, { method: "POST", body: "{}" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async deleteAgent(id: string): Promise<{ ok?: boolean; error?: string }> {
    const r = await req<{ ok?: boolean; error?: string }>(`/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },

  /* ---- Automations (server "triggers": schedules, webhooks, watchers) ---- */
  async triggers(): Promise<TriggerRec[]> {
    const r = await req<{ triggers: TriggerRec[] }>("/triggers");
    return r.data?.triggers ?? [];
  },
  async patchTrigger(id: string, patch: Record<string, unknown>): Promise<{ trigger?: TriggerRec; error?: string }> {
    const r = await req<{ trigger?: TriggerRec; error?: string }>(`/triggers/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async fireTrigger(id: string): Promise<{ ok?: boolean; runId?: string; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; runId?: string; error?: string; message?: string }>(`/triggers/${encodeURIComponent(id)}/fire`, { method: "POST", body: "{}" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async deleteTrigger(id: string): Promise<{ ok?: boolean; error?: string }> {
    const r = await req<{ ok?: boolean; error?: string }>(`/triggers/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
};

/* ---- Records for the agents/automations surfaces (mirrors server publicAgent/publicTrigger) ---- */
export interface AgentRec {
  id: string; name: string; purpose?: string; status: string; instructions?: string;
  lastRunAt?: string | null; runCount?: number; toolIds?: string[]; createdAt?: string; updatedAt?: string;
}
export interface TriggerRec {
  id: string; name: string; type: string; enabled: boolean; agentId?: string | null;
  intervalMs?: number | null; runAt?: string | null; lastFiredAt?: string | null;
  lastResult?: { ok?: boolean; error?: string } | null; createdAt?: string; updatedAt?: string;
}
