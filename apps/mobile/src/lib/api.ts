// Mobile API client for the FamiliOS backend. Native can't use same-origin
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
export interface AssistantResult { ok: boolean; kind?: "answer" | "plan" | "build"; answer?: string; plan?: AgentPlan; build?: ChatBuild; run?: RunRec; model?: string; error?: string; message?: string }
// Server-durable assistant conversations — same records the web client uses, so a chat
// started on the phone shows up on the web (and vice versa) and survives app restarts.
// K2 — the rows a run actually fetched, as structure, so the chat can render real cards
// instead of prose ("still not returned in line, in chat, results as cards"). Built once on
// the server (server/assistant-runs.mjs rowCard/runResultGroups) so the text summary and the
// cards can never disagree about what was found. `when` arrives RAW so the device formats it
// in its own locale and timezone.
export interface ResultCardRec {
  title: string;
  when?: string;
  allDay?: boolean;
  where?: string;
  detail?: string;
  url?: string;
  refId?: string;
  meta?: { label: string; value: string }[];
}
export interface ResultGroupRec {
  title: string; connector?: string; toolId?: string; rows: ResultCardRec[]; more?: number;
}
export interface ConversationMessage {
  role: "user" | "assistant"; text: string; at: string; kind?: string;
  plan?: AgentPlan | null; build?: ChatBuild | null; built?: boolean;
  builtIds?: { skillId?: string; agentId?: string; triggerId?: string };
  runId?: string | null; status?: string;
  resultGroups?: ResultGroupRec[] | null;
  /** The same message with the row bullets removed — read this when rendering resultGroups. */
  textWithoutRows?: string | null;
}
export interface ConversationRec {
  id: string; title: string; messages: ConversationMessage[]; createdAt: string; updatedAt: string;
  /** Chat space: "personal" (private to its creator — the default) or "household" (family space, shared). */
  visibility?: "personal" | "household";
  actorId?: string;
}
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

// OAuth connector providers (Google, Microsoft, Amazon Alexa, …) — the public,
// secret-free view: scope catalog (what the consent screen grants, e.g. Google
// Home devices on the Google provider) plus the actor's connected accounts.
export interface ProviderScope { key: string; label: string; risk: string }
export interface ProviderAccountRec { id: string; displayName?: string | null; status?: string }
export interface ProviderRec {
  id: string; name: string; category?: string; readiness: string;
  clientIdEnv?: string; clientSecretEnv?: string;
  scopes?: ProviderScope[];
  accounts: ProviderAccountRec[];
}
// Server-owned family data (mirrors the web client). The backend returns these already
// role/visibility-filtered for the bearer session's actor, so a child's device never
// receives adults-only items — no client-side hiding required.
// A pull flagged this event: both FamiliOS and Google changed it since the last push/merge.
export interface SyncConflict {
  at: number; googleUpdated: string | null;
  google: { title?: string; startAt?: string | null; endAt?: string | null; location?: string };
}
// Sync bookkeeping carried on a canonical event (mirrors the web's event.provenance).
export interface EventProvenance { googleEventId?: string; subscriptionId?: string; alsoSubscriptionIds?: string[]; conflict?: SyncConflict; [k: string]: unknown }
export interface EventRec {
  id: string; title: string; startAt: string | null; endAt: string | null; location: string;
  driverId: string | null; participantIds: string[]; whatToBring: { item: string; memberId: string | null }[];
  checklist: { text: string; done: boolean }[]; visibility: string; layer: "canonical" | "linked" | "public"; category: string;
  notes?: string; source?: string; provenance?: EventProvenance;
  /** WP-003/ISS-005: all-day events — no times shown; Google push uses the `date` form.
   *  startAt/endAt stay local-midnight ISO timestamps so existing sort/render paths hold. */
  allDay?: boolean;
  /** Linked Google events: the member who connected that calendar (colors + free/busy). */
  ownerId?: string | null;
  /** Server-computed: may the current member edit this event? Canonical → adult/owner;
   *  linked Google → only the member who connected that account (edit-own-calendar-only). */
  editable?: boolean;
  /** ISS-121: set when this event came from a connected account that can no longer refresh
   *  (needs_reconnect / revoked / expired), so a disconnected calendar can never contribute
   *  silently. Server-derived per request — it clears itself once the account reconnects. */
  staleSource?: { accountId: string; status: string; provider: string; connectedByActorId: string | null };
}
export interface TaskRec {
  id: string; title: string; type: string; status: string; dueAt: string | null;
  assignedMemberId: string | null; priority: string; amount: number | null; visibility: string;
  listName?: string;
  // H2/H4/H5/H7 — a task is a scheduled item: it has a start and an end like a calendar
  // entry, a description that doesn't have to fit in the title, a reminder that produces a
  // real notification, and (once dated) a place on the calendar.
  startAt?: string | null;
  endAt?: string | null;
  notes?: string;
  /** 0 = at the time, 15, 30, 60, 1440. null = no reminder. */
  remindMinutesBefore?: number | null;
  reminderSentAt?: string | null;
  /** Set once the task has been added to the calendar. */
  eventId?: string | null;
  createdBy?: string | null;
}
// Meal plan + the read-only "linked" calendar layer (ICS/Google subscriptions) —
// same shapes as the web client (src/connectors/api.ts).
export interface MealIngredient { item: string; have?: boolean }
export interface Meal {
  id: string; householdId: string; date: string | null; time?: string | null; slot: string; title: string; notes: string;
  ingredients: MealIngredient[]; visibility: string; source: string; createdBy: string; createdAt: string; updatedAt: string;
  servings?: number | null; recipeUrl?: string; instructions?: string[];
}
export interface CalendarSubscription {
  id: string; name: string; url: string | null; source: string;
  /** Per-calendar accent (name or hex) — each connected calendar's events render as distinctly colored cards. */
  color?: string | null;
  /** Owning connected account (Google) — which member's calendar this is. All possibly null (ICS feeds). */
  accountId?: string | null;
  accountEmail?: string | null;
  ownerActorId?: string | null;
  ownerName?: string | null;
  lastSyncAt: number | null;
  lastResult: { imported?: number; updated?: number; removed?: number; error?: string } | null;
  eventCount: number; createdAt: number;
}
export interface CalendarSync { ok: boolean; imported?: number; updated?: number; removed?: number; total?: number; error?: string }
// Household files (server-owned library) + read-only knowledge (memory/artifacts).
export interface FileRec {
  id: string; householdId: string; name: string; mime: string; sizeBytes: number;
  tags: string[]; visibility: string; spaceId: string; uploadedBy: string; source: string; createdAt: string;
  // Multi-page uploads (front/back of an ID, etc.) — one logical file, N page blobs.
  pageBlobIds?: string[]; pageCount?: number;
}
// Server-durable knowledge items (household memory the user writes + curates).
export interface KnowledgeRec {
  id: string; householdId: string; title: string; type: string; content: string;
  tags: string[]; visibility: "household" | "personal"; sensitive: boolean; fileIds: string[];
  createdBy: string; createdAt: string; updatedAt: string;
}
// Server evolution registry — improvement proposals mined from real run traces
// (mirror of the web's ServerEvolution; read-only on the Today "what I learned" card).
export interface EvolutionRec {
  id: string; kind: "skill" | "agent" | "tool" | "function"; householdId?: string;
  agentId?: string | null; agentName?: string | null; skillId?: string | null; runId?: string;
  status: "pending" | "accepted" | "rejected"; source: string;
  title: string; reason: string; summary: string; after?: string; risk?: "Low" | "Medium" | "High";
  createdAt: number;
}
export interface MemoryRec { id: string; scope: string; type: string; text: string; createdAt: number; source?: { runId?: string; actorId?: string } }
export interface PlaybookRec {
  id: string; name: string; description: string; whenToUse: string; category: string;
  steps: string[]; requiredConnections: string[]; outputFormat: string; approvalRules: string[];
  archived: boolean; system: boolean; createdAt: string;
}
export interface ArtifactRec { id: string; runId?: string; kind: string; title: string; body?: string; createdAt: number }
export interface MemberRec { actorId: string; displayName: string; role: string; relationship: string | null; spaceIds: string[]; isCurrentUser: boolean; color?: string | null; photoFileId?: string | null; aiEnabled?: boolean }
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

/** "Ask for help" — a lightweight request from one member to another (grandparent,
 * sitter, …), optionally linked to a calendar event or task. Server-owned. */
export interface HelpRequestRec {
  id: string; householdId: string;
  fromActorId: string; fromName: string;
  toActorId: string; toName: string;
  message: string;
  eventId: string | null; taskId: string | null;
  /** "ask" = I'm asking you to help with MY item; "offer" = I'm offering to help with YOUR item. */
  kind?: "ask" | "offer";
  status: "pending" | "accepted" | "declined" | "cancelled";
  responseNote: string | null;
  createdAt: string; respondedAt: string | null;
}
/** Server evolution/improvement proposals (mined from real run traces). Adult Admins
 * accept/reject; low-risk ones the AI is confident about are auto-applied server-side. */
export interface EvolutionReviewRec {
  id: string; kind: "skill" | "agent" | "tool" | "function";
  status: "pending" | "accepted" | "rejected"; source: string;
  title: string; reason: string; summary: string; after?: string;
  risk?: "Low" | "Medium" | "High"; agentId?: string | null; agentName?: string | null;
  autoApproved?: boolean; autoReason?: string | null; createdAt: number;
}
/** Household settings the mobile client can read/toggle. */
export interface AppSettingsRec {
  externalActionsEnabled: boolean; ownerPinSet: boolean;
  aiActiveProvider: string | null; calendarAutoSync: boolean;
  autoApproveImprovements: boolean;
}
/** Result of POST /api/calendar/sync-all — one button syncs every subscription
 * and pulls Google-side edits in the same pass. */
export interface SyncAllResult {
  ok: boolean; synced?: number; imported?: number; updated?: number; removed?: number;
  pulled?: { checked?: number; merged?: number; conflicts?: number; unlinked?: number };
  errors?: { id: string; error: string }[];
  error?: string; message?: string;
}

interface Res<T> { status: number; ok: boolean; data: T }

// Mutations safe to queue offline and replay later: quick idempotent-ish
// family writes where losing the tap is worse than a late apply.
const OFFLINE_QUEUEABLE = (path: string, method?: string) =>
  (method === "PATCH" && /^\/tasks\//.test(path)) || (method === "POST" && path === "/tasks");

async function req<T = unknown>(path: string, init?: RequestInit): Promise<Res<T>> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init?.headers as Record<string, string> | undefined) };
  if (token) headers["authorization"] = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { ...init, headers });
  } catch (e) {
    if (OFFLINE_QUEUEABLE(path, init?.method)) {
      // Fire-and-remember: the tap is preserved and replays when back online.
      const { enqueue } = await import("@/lib/offline-queue");
      let body: unknown; try { body = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { body = undefined; }
      void enqueue({ path, method: init?.method ?? "POST", body });
      return { status: 0, ok: false, data: { error: "queued_offline", message: "You're offline — this change is saved and will sync automatically." } as unknown as T };
    }
    return { status: 0, ok: false, data: { error: "network", message: String((e as Error)?.message ?? e) } as unknown as T };
  }
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: "bad_json" }; }
  return { status: res.status, ok: res.ok, data: data as T };
}

export interface ProfileRec {
  actorId: string; displayName: string; role: string; relationship: string | null; pinRequired: boolean;
  /** Lock-screen identity (owner walkthrough 00:27 / 03:45): the accent the member picked,
   *  and their photo id. Bytes come from GET /api/profiles/:actorId/avatar, which sits
   *  behind the same pre-auth privacy gate as this roster. */
  color?: string | null;
  photoFileId?: string | null;
}

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
  /* ---- self-serve identity (C1.4): email sign-in, household create/join ---- */
  async loginEmail(email: string, password: string): Promise<{ session?: Session; token?: string; error?: string; message?: string }> {
    const r = await req<{ session?: Session; token?: string; error?: string; message?: string }>("/login", {
      method: "POST", headers: { "x-homeops-bearer": "1" }, body: JSON.stringify({ email, password }),
    });
    if (r.data?.token) await setToken(r.data.token);
    return r.data ?? { error: "network" };
  },
  async signup(input: { email: string; password: string; ownerName: string; householdName?: string; inviteToken?: string }): Promise<{ session?: Session; token?: string; error?: string; message?: string }> {
    const r = await req<{ session?: Session; token?: string; error?: string; message?: string }>("/signup", {
      method: "POST", headers: { "x-homeops-bearer": "1" }, body: JSON.stringify(input),
    });
    if (r.data?.token) await setToken(r.data.token);
    return r.data ?? { error: "network" };
  },
  async invitePreview(token: string): Promise<{ householdName: string | null; displayName: string; role: string } | null> {
    const r = await req<{ invite: { householdName: string | null; displayName: string; role: string } }>(`/invites/${encodeURIComponent(token)}/preview`);
    return r.ok ? (r.data?.invite ?? null) : null;
  },
  async createInvite(input: { displayName: string; role: string }): Promise<{ invite?: { token: string; role: string; expiresAt: number }; error?: string }> {
    const r = await req<{ invite?: { token: string; role: string; expiresAt: number }; error?: string }>("/invites", { method: "POST", body: JSON.stringify(input) });
    return r.data ?? { error: "network" };
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
  async providers(): Promise<ProviderRec[]> {
    const r = await req<{ providers: ProviderRec[] }>("/providers");
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
  async createConversation(title: string, visibility?: "personal" | "household"): Promise<ConversationRec | null> {
    const r = await req<{ conversation?: ConversationRec }>("/conversations", { method: "POST", body: JSON.stringify({ title, visibility }) });
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
  async createEvent(body: Partial<EventRec> & { title: string }): Promise<{ event?: EventRec; error?: string; message?: string }> {
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
  /* ---- household roster + identity (invites are real member records; roles are
   * server-resolved at sign-in, never client-minted) ---- */
  async createMember(body: { displayName: string; role: string; relationship?: string | null }): Promise<{ member?: { actorId: string; displayName: string; role: string; relationship: string | null }; error?: string; message?: string }> {
    const r = await req<{ member?: { actorId: string; displayName: string; role: string; relationship: string | null }; error?: string; message?: string }>("/members", { method: "POST", body: JSON.stringify(body) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async rev(): Promise<number | null> {
    const r = await req<{ rev?: number }>("/rev");
    return r.data?.rev ?? null;
  },
  async household(): Promise<{ id: string; name: string | null } | null> {
    const r = await req<{ household?: { id: string; name: string | null } }>("/household");
    return r.data?.household ?? null;
  },
  async appendConversationMessage(id: string, body: { text: string; kind?: string; runId?: string }): Promise<{ conversation?: ConversationRec; error?: string }> {
    const r = await req<{ conversation?: ConversationRec; error?: string }>(`/conversations/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify(body) });
    return r.data ?? { error: "network" };
  },
  async deleteMember(actorId: string): Promise<{ ok?: boolean; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; error?: string; message?: string }>(`/members/${encodeURIComponent(actorId)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  // Update a member's profile / role. Members edit their own name/photo/color; an Owner or
  // Adult Admin may also change relationship, role, and a child's aiEnabled. The server
  // enforces the role floor + last-owner guard; a self-edit of own name/photo is allowed.
  async patchMember(actorId: string, patch: { displayName?: string; relationship?: string | null; role?: string; color?: string | null; photoFileId?: string | null; aiEnabled?: boolean }): Promise<{ member?: MemberRec; error?: string; message?: string }> {
    const r = await req<{ member?: MemberRec; error?: string; message?: string }>(`/members/${encodeURIComponent(actorId)}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (r.status === 403) return { error: "insufficient_role" };
    if (r.status === 409) return r.data ?? { error: "conflict" };
    return r.data ?? { error: "network" };
  },
  async renameHousehold(name: string): Promise<{ household?: { id: string; name: string | null }; error?: string; message?: string }> {
    const r = await req<{ household?: { id: string; name: string | null }; error?: string; message?: string }>("/household", { method: "PATCH", body: JSON.stringify({ name }) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  // `message` rides along because the server explains a refused edit in plain words
  // (bad_timestamp, bad_reminder, stale_write) and the sheet shows that rather than a code.
  async updateTask(id: string, patch: Partial<TaskRec>): Promise<{ task?: TaskRec; error?: string; message?: string }> {
    const r = await req<{ task?: TaskRec; error?: string; message?: string }>(`/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
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
  // Edit an existing meal (title/date/slot/time/servings/ingredients/recipe/notes). The
  // server preserves mealId back-references (groceries/calendar stay linked). 403 => forbidden;
  // 409 => stale_write (another device won) when ifUpdatedAt is supplied.
  async patchMeal(id: string, patch: Partial<Pick<Meal, "title" | "date" | "slot" | "time" | "notes" | "visibility" | "servings" | "recipeUrl" | "instructions">> & { ingredients?: (string | MealIngredient)[]; ifUpdatedAt?: string }): Promise<{ meal?: Meal; error?: string; message?: string; current?: Meal }> {
    const r = await req<{ meal?: Meal; error?: string; message?: string; current?: Meal }>(`/meals/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (r.status === 403) return { error: "forbidden" };
    return r.data ?? { error: "network" };
  },
  /** Deleting a meal removes its calendar event too; pass deleteGroceries to
   *  also drop the ingredients it added to the grocery list. */
  async deleteMeal(id: string, opts?: { deleteGroceries?: boolean }): Promise<{ ok?: boolean; removedEvents?: number; removedGroceries?: number; unlinkedGroceries?: number; error?: string }> {
    const qs = opts?.deleteGroceries ? "?groceries=delete" : "";
    const r = await req<{ ok?: boolean; removedEvents?: number; removedGroceries?: number; unlinkedGroceries?: number; error?: string }>(`/meals/${encodeURIComponent(id)}${qs}`, { method: "DELETE" });
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
  // H7 — put a dated task on the household calendar, owned by the person it's assigned to,
  // so the existing approval-gated Google push sends it to THEIR account.
  async taskToCalendar(id: string): Promise<{ ok?: boolean; event?: EventRec; action?: string; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; event?: EventRec; action?: string; error?: string; message?: string }>(`/tasks/${encodeURIComponent(id)}/to-calendar`, { method: "POST", body: "{}" });
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
  // `pages` (optional) uploads a multi-page logical file (e.g. front + back of an ID) —
  // contentBase64 stays the primary/first-page blob for back-compat; the server files
  // the extra pages and returns pageBlobIds[]/pageCount on the record.
  async uploadFile(body: { name: string; contentBase64: string; mime?: string; tags?: string[]; visibility?: string; pages?: { name?: string; base64: string }[] }): Promise<{ file?: FileRec; error?: string; message?: string }> {
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
  // Server evolution registry — improvement proposals mined from run traces (route is
  // singular /evolution; mirrors the web backend). Read-only surfacing on Today.
  async evolutions(): Promise<EvolutionRec[]> {
    const r = await req<{ evolutions: EvolutionRec[] }>("/evolution");
    return r.data?.evolutions ?? [];
  },
  /* ---- Knowledge — server-durable household knowledge items (create/edit/delete) ---- */
  async knowledge(): Promise<KnowledgeRec[]> {
    const r = await req<{ items: KnowledgeRec[] }>("/knowledge");
    return r.data?.items ?? [];
  },
  async createKnowledge(body: { title: string; type: string; content: string; tags?: string[]; visibility?: "household" | "personal"; sensitive?: boolean; fileIds?: string[] }): Promise<{ item?: KnowledgeRec; error?: string; message?: string }> {
    const r = await req<{ item?: KnowledgeRec; error?: string; message?: string }>("/knowledge", { method: "POST", body: JSON.stringify(body) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async patchKnowledge(id: string, patch: Partial<Pick<KnowledgeRec, "title" | "type" | "content" | "tags" | "visibility" | "sensitive" | "fileIds">> & { ifUpdatedAt?: string }): Promise<{ item?: KnowledgeRec; error?: string; message?: string; current?: KnowledgeRec }> {
    const r = await req<{ item?: KnowledgeRec; error?: string; message?: string; current?: KnowledgeRec }>(`/knowledge/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async deleteKnowledge(id: string): Promise<{ ok?: boolean; error?: string }> {
    const r = await req<{ ok?: boolean; error?: string }>(`/knowledge/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
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
  /* ---- Two-way Google Calendar sync (canonical events only; approval-gated push) ---- */
  // Push a FamiliOS canonical event TO Google. Approval-first: with no approvalId the
  // server returns { needsApproval, approval } — decide it, then call again WITH the id.
  // A stored provenance.googleEventId turns re-pushes into updates.
  async pushEventToGoogle(id: string, approvalId?: string): Promise<{ ok?: boolean; needsApproval?: boolean; approval?: ApprovalRec; googleEventId?: string; action?: string; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; needsApproval?: boolean; approval?: ApprovalRec; googleEventId?: string; action?: string; error?: string; message?: string }>(`/calendar/push/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(approvalId ? { approvalId } : {}) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  // Pull Google-side edits back into pushed events. Clean edits merge; both-sides-changed
  // flags provenance.conflict for review; Google deletions unlink (FamiliOS stays canonical).
  async pullGoogleEdits(): Promise<{ ok?: boolean; checked?: number; merged?: number; conflicts?: number; unlinked?: number; errors?: number; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; checked?: number; merged?: number; conflicts?: number; unlinked?: number; errors?: number; error?: string; message?: string }>("/calendar/pull-google-edits", { method: "POST", body: "{}" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  // Resolve a flagged pull conflict: adopt Google's version ("google") or keep the
  // FamiliOS one ("local", then re-push to update Google). Clears the flag either way.
  async resolveEventConflict(id: string, choice: "google" | "local"): Promise<{ ok?: boolean; event?: EventRec; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; event?: EventRec; error?: string; message?: string }>(`/events/${encodeURIComponent(id)}/resolve-conflict`, { method: "POST", body: JSON.stringify({ choice }) });
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
  /**
   * Delete the SIGNED-IN PERSON's FamiliOS account. Not to be confused with
   * deleteAccount(id) below, which revokes a connected OAuth account — the names are
   * close and the consequences are not.
   *
   * Apple requires in-app account deletion for any app that lets you create an account
   * (App Store Review 5.1.1(v)); this had no mobile entry point at all.
   *
   * The server decides the blast radius from the caller's role, and it is NOT symmetric:
   * an Owner deletes the ENTIRE household (tenant, identities, sessions — everyone's
   * data), anyone else deletes only their own account. `deleted` says which happened, so
   * the UI can confirm honestly rather than guess.
   */
  async deleteMyAccount(password: string): Promise<{ ok?: boolean; deleted?: "household" | "account"; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; deleted?: "household" | "account"; error?: string; message?: string }>(
      "/account", { method: "DELETE", body: JSON.stringify({ password }) },
    );
    return r.data ?? { error: "network" };
  },
  /** Revoke a connected OAuth account (server deletes tokens; ownership-checked). */
  async deleteAccount(id: string): Promise<{ ok?: boolean; error?: string }> {
    const r = await req<{ ok?: boolean; error?: string }>(`/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "forbidden" };
    return r.data ?? { error: "network" };
  },
  async oauthStart(provider: string): Promise<OAuthStartResult> {
    const r = await req<OAuthStartResult>(`/oauth/${encodeURIComponent(provider)}/start`, {
      headers: { "x-homeops-mobile": "1" },
    });
    return r.data ?? { error: "network" };
  },

  /* ---- Durable server runs (canonical runtime; resolves step inputs itself) ---- */
  // `conversationId` makes the run's outcome the SERVER's message: the run-finished hook
  // appends a durable run_result carrying the fetched rows as cards (K2), which the local
  // client-built summary could never do — it only ever had stringified step output. It also
  // means the result survives an app restart and shows up on the web. Authority-bearing
  // sourceRef fields are stripped server-side (clientSourceRef); conversationId is not one.
  async startRunPlan(plan: AgentPlan, opts?: { conversationId?: string }): Promise<{ run?: RunRec; error?: string; message?: string }> {
    const r = await req<{ run?: RunRec; error?: string; message?: string }>("/runs/start", {
      method: "POST",
      body: JSON.stringify({
        plan, source: "manual",
        ...(opts?.conversationId ? { sourceRef: { conversationId: opts.conversationId } } : {}),
      }),
    });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async getRun(id: string): Promise<{ run?: RunRec; error?: string }> {
    const r = await req<{ run?: RunRec; error?: string }>(`/runs/${encodeURIComponent(id)}`);
    return r.data ?? { error: "network" };
  },
  // Cancel a run in place (used by "Ask for changes": the stale run is stopped before
  // its revised replacement is dispatched). Terminal runs return unchanged (idempotent).
  async cancelRun(id: string): Promise<{ run?: RunRec; error?: string }> {
    const r = await req<{ run?: RunRec; error?: string }>(`/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" });
    return r.data ?? { error: "network" };
  },

  /* ---- Tasks (create/edit come to mobile with the redesign) ---- */
  async createTask(body: { title: string; type?: string; dueAt?: string | null; assignedMemberId?: string | null; priority?: string; listName?: string }): Promise<{ task?: TaskRec; error?: string }> {
    const r = await req<{ task?: TaskRec; error?: string }>("/tasks", { method: "POST", body: JSON.stringify(body) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },

  /* ---- Events (edit/delete) ---- */
  async updateEvent(id: string, patch: Record<string, unknown>): Promise<{ event?: EventRec; error?: string; message?: string }> {
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
  // E1 — address autocomplete for the event location field. Never throws and never surfaces
  // an error: this runs while someone is typing, and a lookup that can't answer must not
  // interrupt them.
  async suggestAddresses(q: string, at?: { latitude: number; longitude: number } | null): Promise<AddressSuggestionRec[]> {
    const p = new URLSearchParams({ q });
    if (at) { p.set("lat", String(at.latitude)); p.set("lng", String(at.longitude)); }
    const r = await req<{ suggestions?: AddressSuggestionRec[] }>(`/places/suggest?${p}`).catch(() => null);
    return r?.data?.suggestions ?? [];
  },
  // G6 — the starter-helper catalog, grouped, from the server. Mobile used to carry four
  // hand-written entries of its own while the web read thirteen from a different file.
  async agentTemplates(): Promise<AgentTemplateSectionRec[]> {
    const r = await req<{ sections: AgentTemplateSectionRec[] }>("/agent-templates");
    return r.data?.sections ?? [];
  },
  // G2/G3/G4 — the one server computation behind "what does this helper actually use, what
  // is it allowed to do, and will it run without me?" (server/agents.mjs agentContext).
  async agentContext(id: string): Promise<AgentContextRec | null> {
    const r = await req<{ context?: AgentContextRec }>(`/agents/${encodeURIComponent(id)}/context`);
    return r.data?.context ?? null;
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

  /* ---- One-button calendar sync: every subscription + pull Google edits ---- */
  async syncAllCalendars(): Promise<SyncAllResult> {
    const r = await req<SyncAllResult>("/calendar/sync-all", { method: "POST", body: "{}" });
    if (r.status === 403) return { ok: false, error: "insufficient_role" };
    return r.data ?? { ok: false, error: "network" };
  },

  /* ---- Help requests ("Ask for help from a family member") ---- */
  async helpRequests(): Promise<HelpRequestRec[]> {
    const r = await req<{ helpRequests: HelpRequestRec[] }>("/help-requests");
    return r.data?.helpRequests ?? [];
  },
  async createHelpRequest(body: { toActorId: string; message: string; eventId?: string; taskId?: string; kind?: "ask" | "offer" }): Promise<{ helpRequest?: HelpRequestRec; error?: string; message?: string }> {
    const r = await req<{ helpRequest?: HelpRequestRec; error?: string; message?: string }>("/help-requests", { method: "POST", body: JSON.stringify(body) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  // WP-001: accepting a help request with a linked task transfers the task —
  // the server reports the transfer as {reassigned, task} so UIs can say so.
  async respondHelpRequest(id: string, response: "accept" | "decline", note?: string): Promise<{ helpRequest?: HelpRequestRec; reassigned?: boolean; task?: TaskRec; error?: string; message?: string }> {
    const r = await req<{ helpRequest?: HelpRequestRec; reassigned?: boolean; task?: TaskRec; error?: string; message?: string }>(`/help-requests/${encodeURIComponent(id)}/respond`, { method: "POST", body: JSON.stringify({ response, note }) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async cancelHelpRequest(id: string): Promise<{ helpRequest?: HelpRequestRec; ok?: boolean; error?: string }> {
    const r = await req<{ helpRequest?: HelpRequestRec; ok?: boolean; error?: string }>(`/help-requests/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },

  /* ---- Evolution / improvement proposals (mirror of the web "what I learned") ---- */
  async evolutionReviews(): Promise<EvolutionReviewRec[]> {
    const r = await req<{ evolutions: EvolutionReviewRec[] }>("/evolution");
    return r.data?.evolutions ?? [];
  },
  // Accept applies the improvement (versions the agent/skill); reject dismisses it. Adult Admin+.
  async reviewEvolution(id: string, accept: boolean): Promise<{ ok?: boolean; applied?: boolean; applyError?: string | null; evolution?: EvolutionReviewRec; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; applied?: boolean; applyError?: string | null; evolution?: EvolutionReviewRec; error?: string; message?: string }>(`/evolution/${encodeURIComponent(id)}/review`, { method: "POST", body: JSON.stringify({ accept }) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },

  /* ---- Household settings (read + toggle) ---- */
  async settings(): Promise<AppSettingsRec | null> {
    const r = await req<{ settings: AppSettingsRec }>("/settings");
    return r.data?.settings ?? null;
  },
  async updateSettings(patch: Partial<Pick<AppSettingsRec, "externalActionsEnabled" | "calendarAutoSync" | "autoApproveImprovements">>): Promise<{ settings?: AppSettingsRec; error?: string }> {
    const r = await req<{ settings?: AppSettingsRec; error?: string }>("/settings", { method: "POST", body: JSON.stringify(patch) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
};

/* ---- Records for the agents/automations surfaces (mirrors server publicAgent/publicTrigger) ---- */
export interface AgentRec {
  id: string; name: string; purpose?: string; status: string; instructions?: string;
  /** Agent space: "household" (family — shared, the default) or "personal" (only its creator sees/uses it). */
  visibility?: "household" | "personal";
  createdBy?: string | null;
  lastRunAt?: string | null; runCount?: number; toolIds?: string[]; createdAt?: string; updatedAt?: string;
  approvalPolicy?: {
    autoAllow?: string[]; alwaysApprove?: string[];
    unattended?: { enabled?: boolean; includeHighRisk?: boolean; setByRole?: string | null; setAt?: string | null };
  };
  skillIds?: string[];
}
// E1 — one address suggestion: the name a family recognises, the address under it, and the
// full string that goes INTO the field (a label alone won't navigate anywhere).
export interface AddressSuggestionRec { label: string; detail: string; value: string; placeId: string | null }
// G6 — starter helpers, grouped into navigable sections (server/agent-templates.mjs).
// A template is an opening sentence, not a pre-built agent: `prompt` goes to the planner,
// which drafts against THIS household's real connections, and the family approves it.
export interface AgentTemplateRec { id: string; name: string; category: string; icon: string; desc: string; prompt: string }
export interface AgentTemplateSectionRec { key: string; title: string; blurb?: string; templates: AgentTemplateRec[] }
// The effective-policy view, computed server-side in ONE pass (server/agents.mjs
// agentContext) so a row and a count can never tell different stories.
export interface EffectivePolicyRec {
  decision: "allowed" | "needs_approval" | "blocked";
  rule: string; reason: string; requiresApproval: boolean;
  risk: string; baseRequiresApproval: boolean; riskOverridden: boolean;
}
export interface AgentContextRec {
  agentId: string;
  openAllowList: boolean;
  openToolAllowList: boolean;
  openFunctionAllowList: boolean;
  tools: { toolId: string; name: string; connectorName: string; action: string; requiresApproval: boolean; available: boolean; permitted: boolean; denied: boolean; policy: EffectivePolicyRec }[];
  functions: { id: string; name: string; type: string; requiresApproval: boolean; available: boolean; state: string; permitted: boolean; denied: boolean; policy: EffectivePolicyRec }[];
  executable: string[];
  availableCount: number; permittedCount: number; executableCount: number;
  /** G2 — [18:06] "it says it runs the assigned use case skill. Well, what IS that skill?" */
  skills: { id: string; name: string; description?: string; stepCount: number; stepNames?: string[]; ready: boolean; blockedReason?: string | null }[];
  /** G4 — the grant that actually applies, refused tiers included. */
  unattended: { enabled: boolean; includeHighRisk: boolean; setByRole: string | null; setAt: string | null };
  /** G3 — "will it run unattended?" answered from the policy, not from a label. */
  runsUnattended: boolean;
  gatedCapabilityNames: string[];
  gatedCount: number;
}
export interface TriggerRec {
  id: string; name: string; type: string; enabled: boolean; agentId?: string | null;
  intervalMs?: number | null; runAt?: string | null; lastFiredAt?: string | null;
  lastResult?: { ok?: boolean; error?: string } | null; createdAt?: string; updatedAt?: string;
}
