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
/* A SIGNED-IN PHONE WHOSE SESSION HAS ENDED MUST SAY SO. The server refuses an expired token
 * with 401 authentication_required; this app used to check its session only on a cold start,
 * so a phone left running kept its signed-in screens and every request failed — Ask showed
 * "couldn't reach the AI provider", read as an API-key problem (2026-09-24). Now the session
 * provider is told, and the profile picker comes back. */
let sessionExpiredHandler: (() => void) | null = null;
export function onSessionExpired(handler: (() => void) | null): void { sessionExpiredHandler = handler; }

export async function setToken(t: string | null): Promise<void> {
  token = t;
  try {
    if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch { /* secure-store may be unavailable on web; keep in-memory */ }
}

export interface Session {
  actorId: string; actorName: string; role: string; csrf: string; householdId: string;
  /** D5 — the platform operator, derived server-side from a deployment env plus this
   *  session's own registered email. Read-only: no client can assert it. */
  isOperator?: boolean;
}
// D5 — the operator's cross-household view. Only ever populated for an operator session;
// every other caller gets a 404 from these routes.
export interface AdminHouseholdRec { id: string; name: string | null; memberCount: number; createdAt: number | null }
export interface InviteRec { token: string; householdId: string; householdName: string | null; displayName: string; role: string; expiresAt: number }
export interface ApprovalRec {
  id: string; connectorId: string | null; toolId: string; status: string; risk: string;
  category: string; preview: string; createdAt: number; expiresAt: number;
  decidedBy: string | null; decidedAt: number | null;
  /** Also sent by the server (publicApproval in server/index.mjs); optional so an older server
   *  that omits them still parses. `consumedBy` is set once the approved step has run. */
  requestedBy?: string; source?: string; allowedApproverRoles?: string[]; consumedBy?: string | null;
}
export interface PlanStep { toolId: string | null; title: string; detail: string; requiresApproval: boolean; risk: string; connectorName: string | null; connected: boolean }
export interface AgentPlan { title: string; summary: string; risk: string; steps: PlanStep[]; missing: string[]; approvalRequired: boolean; triggerType: string }

/* ---- Helpers ------------------------------------------------------------------------
 *
 * ONE concept. Agent, Skill, Function, Playbook, Automation, Trigger and Evolution were
 * seven records, seven screens and seven vocabularies for the same idea, and the family
 * could never tell which one was in charge of what: "overly complicated and cumbersome
 * with what happens where, what gates approve what."
 *
 * A Helper is a name, what it does in plain words, when it runs, and how much it may do
 * without asking. Nothing else. The server owns every piece of human wording it carries —
 * `scheduleText`, `autonomyText` — so the phone can never describe a schedule differently
 * from the machine that keeps it.
 */
export type HelperSchedule =
  | { kind: "manual" }
  | { kind: "hourly" }
  /** "HH:MM", 24h, on the HOUSEHOLD's clock — not the phone's. */
  | { kind: "daily"; time: string }
  /** weekday: 0 = Sunday … 6 = Saturday. */
  | { kind: "weekly"; time: string; weekday: number };

/** What a helper may do on its own. `full` is the send-and-spend grant and needs the PIN. */
export type HelperAutonomy = "ask" | "act" | "full";

/** The last time it ran, as the server recorded it. `ok: false` carries the real `error`. */
export interface HelperRunRec {
  at: number; finishedAt: number; ok: boolean; reason: string; summary: string;
  runIds: string[]; error: string | null;
}

export interface PublicHelper {
  id: string; name: string; icon: string; purpose: string; instructions: string;
  visibility: "household" | "personal" | "nest"; nestId: string | null;
  status: "Active" | "Paused"; enabled: boolean;
  schedule: HelperSchedule;
  /** "Every day at 7:00 AM" — already human. Never re-derive it on the device. */
  scheduleText: string;
  autonomy: HelperAutonomy;
  /** Already human. The three sentences live on the server. */
  autonomyText: string;
  /** True when the household's own stance is stricter than this helper asked for, so what
   *  it will actually do is less than what its own setting says. Worth one quiet line. */
  autonomyDowngraded: boolean;
  conversationId: string | null;
  lastRun: HelperRunRec | null;
  createdBy: string | null; isMine: boolean; system: boolean; version: number; updatedAt: string;
}

/** A starter helper. It is real, editable text — never saved without someone reading it. */
export interface HelperTemplate {
  id: string; name: string; icon: string; category: string; purpose: string;
  instructions: string; schedule: HelperSchedule; autonomy: HelperAutonomy;
  scheduleText: string; autonomyText: string;
}
export interface HelperTemplateSection { key: string; title: string; templates: HelperTemplate[] }

/** What a helper's turn produced. 422 means it ran and failed: `error` + `message` say why. */
export interface HelperRunResult {
  ok?: boolean; answer?: string; toolCalls?: AssistantToolCall[];
  runIds?: string[]; conversationId?: string; lastRun?: HelperRunRec | null;
  error?: string; message?: string;
}
export interface HelperHistory {
  conversationId: string | null; messages: ConversationMessage[]; lastRun: HelperRunRec | null;
}
/** Fields a create or edit may send. All optional on PATCH; `instructions` is required on POST. */
export interface HelperInput {
  name?: string; purpose?: string; instructions?: string;
  schedule?: HelperSchedule; autonomy?: HelperAutonomy;
  visibility?: "household" | "personal" | "nest"; nestId?: string | null;
  status?: "Active" | "Paused"; enabled?: boolean;
  /** Required by the server ONLY when asking for `autonomy: "full"`. Never stored. */
  pin?: string;
}
/** Every refusal the helper routes can return. `message` is always safe to show verbatim. */
export interface HelperError { error?: string; message?: string }
/** One tool the Ask Famili engine called during a turn — shown as a quiet receipt under the
 *  reply. `awaiting_approval` carries the approval to answer; `runId` the run it ran in. */
export interface AssistantToolCall {
  tool: string; label: string;
  status: "done" | "failed" | "blocked" | "awaiting_approval";
  ok?: boolean; summary?: string; runId?: string; approvalId?: string;
}
/* Every successful turn is kind "answer" now. The engine that returned "plan" and "build"
 * proposals is gone with the seven-concept model: the assistant creates a Helper itself and
 * says so in prose, rather than handing back a card for someone to approve. A `run` may
 * arrive WITH kind "answer" when a step was queued for approval, so run-watching must never
 * be gated on kind. `plan` survives only on OLD persisted messages (ConversationMessage). */
export interface AssistantResult {
  ok: boolean; kind?: "answer"; answer?: string; run?: RunRec; model?: string; error?: string; message?: string;
  toolCalls?: AssistantToolCall[]; runId?: string; runIds?: string[];
  /** True when the server answered from an earlier execution of this same named turn. */
  replayed?: boolean;
}
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
  /* Set when this row came out of a FILE the assistant read — a photo of a schedule, a
   * permission slip, a class list. It is a PROPOSAL: nothing has been created. The card gets
   * an Add button, and the family picks. `when` is the source document's own wording ("Tuesday
   * 4:15pm"), deliberately not parsed into a timestamp — see server/file-extract.mjs. */
  candidate?: {
    type: "event" | "task" | "list_item";
    title: string;
    when?: string | null;
    where?: string | null;
    notes?: string | null;
    who?: string | null;
    source?: string | null;
  };
}
export interface ResultGroupRec {
  title: string; connector?: string; toolId?: string; rows: ResultCardRec[]; more?: number;
}
export interface ConversationMessage {
  role: "user" | "assistant"; text: string; at: string; kind?: string;
  /** Legacy only — a plan drafted by the engine that came before Helpers. New turns never
   *  carry one; the field stays so an old thread still renders its runnable card. */
  plan?: AgentPlan | null;
  runId?: string | null; status?: string;
  resultGroups?: ResultGroupRec[] | null;
  /** The same message with the row bullets removed — read this when rendering resultGroups. */
  textWithoutRows?: string | null;
  /** The tools this turn called, persisted with the reply so a reopened chat shows them too. */
  toolCalls?: AssistantToolCall[] | null;
}
export interface ConversationRec {
  id: string; title: string; messages: ConversationMessage[]; createdAt: string; updatedAt: string;
  /** Chat space: "personal" (private to its creator — the default), "household" (the family),
   *  or "nest" (a small group inside the household — see NestRec). */
  visibility?: "personal" | "household" | "nest";
  nestId?: string | null;
  actorId?: string;
}
// Durable server runs (read-only view) — used to enrich approval previews with the
// gated step's REAL resolved input (the approval record itself only carries a hash).
export interface RunStepRec { index: number; toolId: string | null; title: string; detail: string; status: string; approvalId: string | null; input: Record<string, unknown> }
export interface EmailReviewMessageRec { id: string; subject: string; from: string; snippet: string; added: string[]; removed: string[] }
export interface RunRec {
  id: string; title: string; status: string; steps: RunStepRec[];
  /* Cluster T — "is this what I did, or what the agent did?" The ledger can only answer if
   * the record says. agentName when an agent ran it; actorId when a person asked. */
  agentId?: string | null; agentName?: string | null; actorId?: string | null; source?: string | null;
}
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
export interface ProviderAccountRec {
  id: string; displayName?: string | null; status?: string;
  /** B4 — the HOUSEHOLD MEMBER who connected it. "Our family identifies each other by name,
   *  not by email address." Server-resolved from connectedByActorId. */
  memberName?: string | null;
  connectedByActorId?: string | null;
  scopes?: string[];
}
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
/* EventRec is GENERATED from the server's own declaration
 * (server/actions/schemas/event.mjs → src/generated/actions.ts): the same shape the web
 * client and the API use, kept equal by CI. The hand-written interface this replaces
 * lacked spaceId (household.tsx cast around it) while the web's lacked appendable /
 * myNotes / remindOffsets — neither was what GET /api/events returned. The field-level
 * notes that lived here (what `appendable` means, why `localNotes` never reaches Google)
 * are the schema's descriptions now, and arrive as JSDoc. Alias, not rename, so no screen
 * import changes. */
import type { EventRecord } from "@/generated/actions";
export type EventRec = EventRecord;
export interface AttendeeRec { memberId: string; status: "invited" | "accepted" | "declined"; respondedAt: string | null }
/* Generated from server/actions/schemas/task.mjs, like EventRec. The field notes that lived
 * here (what remindOffsets is, when eventId is set) are the schema's descriptions now. */
import type { TaskRecord } from "@/generated/actions";
export type TaskRec = TaskRecord;
// Meal plan + the read-only "linked" calendar layer (ICS/Google subscriptions) —
// same shapes as the web client (src/connectors/api.ts).
export interface MealIngredient { item: string; have?: boolean }
/* Generated from server/actions/schemas/meal.mjs, like EventRec and TaskRec. */
import type { MealRecord } from "@/generated/actions";
export type Meal = MealRecord;
/** What the SIGNED-IN member may do with one calendar — the server's answer (ADR-005,
 *  server/calendar-permissions.mjs). Draw buttons from this; never re-derive it from roles. */
export interface CalendarCan { view: boolean; sync: boolean; edit: boolean; markWork: boolean; assign: boolean; remove: boolean; scope: boolean }
/** What the Add button may offer: self = may add for themselves now; limitReached = a Limited
 *  Member who already added their one; forMembers = who the Owner may add a calendar for. */
export interface CalendarCanAdd { self: boolean; limitReached: boolean; forMembers: string[] }
/** The Owner's narrowing of what a Limited Member's calendar shows, per other member:
 *  everything, nothing, or chosen calendars ("app" = events made in FamiliOS). */
export type CalendarScopeRule = "all" | "none" | { calendars: string[] };
export interface CalendarScope { members: Record<string, CalendarScopeRule> }
/** A connected calendar. Every member gets the legend fields (id, name, source, colour, owner,
 *  isWork). The management fields — url, sync status, counts, can — come only on calendars the
 *  viewer may manage (can.view); on everyone else's they are absent. */
export interface CalendarSubscription {
  id: string; name: string; url?: string | null; source: string;
  /** A Work calendar: its events are hidden from everyone but its owner until shared. */
  isWork?: boolean;
  can?: CalendarCan;
  /** Per-calendar accent (name or hex) — each connected calendar's events render as distinctly colored cards. */
  color?: string | null;
  /** Owning connected account (Google) — which member's calendar this is. All possibly null (ICS feeds). */
  accountId?: string | null;
  accountEmail?: string | null;
  ownerActorId?: string | null;
  ownerName?: string | null;
  /** True when a member assigned this calendar by hand (vs. inferred from the connecting account). */
  assigned?: boolean;
  createdBy?: string | null;
  lastSyncAt?: number | null;
  lastResult?: { imported?: number; updated?: number; removed?: number; error?: string; via?: string } | null;
  eventCount?: number; createdAt?: number;
}
/** A server refusal carries its own sentence (who CAN do it) — show it rather than a generic one. */
export interface CalendarRefusal { error?: string; message?: string }
export interface CalendarSync { ok: boolean; imported?: number; updated?: number; removed?: number; total?: number; error?: string }
// Household files (server-owned library) + read-only knowledge (memory/artifacts).
/** One in-app delivery. `source` says who sent it (a helper, a person, a family thread);
 *  `conversationId` is the helper's own thread when the source is a helper, so the Inbox
 *  can open the chat behind an update; `data` is the deep-link target. */
export interface NotificationSource { kind: "helper" | "assistant" | "system" | "member" | "thread"; id?: string | null; name?: string | null }
export interface NotificationRec {
  id: string; channel: string; title: string; body: string; read: boolean; createdAt: number;
  data?: { type?: string; id?: string; messageId?: string } | null;
  source?: NotificationSource | null;
  conversationId?: string | null;
  threadId?: string | null;
}

/* ---- Family Messages: threads between members (server/family-messages.mjs) ---- */
export type ShareType = "event" | "task" | "file" | "meal" | "list_item" | "help_request" | "notification";
export interface SharePreview {
  hidden?: boolean; type?: ShareType; id?: string; title?: string; subtitle?: string | null; when?: string | null; allDay?: boolean;
  where?: string | null; who?: string | null; to?: string | null; status?: string | null; mime?: string | null; sizeBytes?: number | null;
  slot?: string | null; body?: string | null; conversationId?: string | null; route?: { pathname: string; params?: Record<string, string> } | null;
  /** help_request only: can THIS reader answer it, and what a yes does. */
  canRespond?: boolean; fromActorId?: string; toActorId?: string; does?: string | null; event?: { id: string; title: string; when: string | null } | null;
}
export type MessageAttachment =
  | { kind: "file"; fileId: string; name?: string | null; mime?: string | null; audio?: { durationMs: number } | null; transcript?: string | null }
  | { kind: "ref"; type: ShareType; id: string; preview?: SharePreview | null };
export interface SuggestionRec {
  id: string; kind: "create" | "update"; type: "event" | "task" | "help"; title: string; summary: string;
  patch: Record<string, unknown>; targetId?: string | null; ownerActorId?: string | null;
  /** Members who should not see this one (the person being asked, for a yes/no ask). */
  hideFrom?: string[];
  status: "open" | "applied" | "dismissed"; by?: string | null; at?: string | null;
  result?: { created?: { type: string; id: string }; requested?: { toActorId: string }; duplicateOf?: string; note?: string } | null;
}
export interface MessageRec {
  id: string; threadId: string; fromActorId: string; at: string; kind: "text" | "system" | "share";
  text: string; attachments: MessageAttachment[]; reactions: Record<string, string[]>; suggestions: SuggestionRec[];
  editedAt: string | null; deletedAt: string | null;
}
export interface ThreadMemberRec { actorId: string; displayName: string; color?: string | null; role: string | null; joinedAt: string; leftAt: string | null; lastReadAt: string | null; mutedUntil: string | null }
export interface ThreadRec {
  id: string; kind: "direct" | "group"; title: string | null; participantIds: string[]; createdBy: string;
  createdAt: string; updatedAt: string; lastMessageAt: string | null; lastPreview: { from: string; actorId?: string; text: string } | null;
  members: ThreadMemberRec[]; unreadCount: number; muted: boolean; left: boolean; archived: boolean;
}
export interface ThreadView { thread: ThreadRec; messages: MessageRec[]; readBy: Record<string, string | null>; typing: string[] }

export interface FileRec {
  id: string; householdId: string; name: string; mime: string; sizeBytes: number;
  tags: string[]; visibility: string; spaceId: string; uploadedBy: string; source: string; createdAt: string;
  // Multi-page uploads (front/back of an ID, etc.) — one logical file, N page blobs.
  pageBlobIds?: string[]; pageCount?: number;
  /** O3 — the uploader's real name, resolved server-side. The record stores an actor id. */
  uploadedByName?: string | null;
  kind?: "avatar" | "document" | "message";
}
// Server-durable knowledge items (household memory the user writes + curates).
export interface KnowledgeRec {
  id: string; householdId: string; title: string; type: string; content: string;
  /* "personal" is the OLD spelling of "private" — records written before the vocabularies
   * were merged still carry it, so readers must run it through normalizeVisibility rather
   * than compare it directly. New writes always send private | nest | household. */
  tags: string[]; visibility: "household" | "personal" | "private" | "nest"; nestId?: string | null; sensitive: boolean; fileIds: string[];
  createdBy: string; createdAt: string; updatedAt: string;
}
export interface MemoryRec { id: string; scope: string; type: string; text: string; createdAt: number; source?: { runId?: string; actorId?: string } }
export interface ArtifactRec { id: string; runId?: string; kind: string; title: string; body?: string; createdAt: number }
export interface MemberRec { actorId: string; displayName: string; role: string; relationship: string | null; spaceIds: string[]; isCurrentUser: boolean; color?: string | null; photoFileId?: string | null; aiEnabled?: boolean;
  /** Only returned to the Owner, only meaningful on a Limited Member: null = sees everything. */
  calendarScope?: CalendarScope | null }
// Contact methods — the server-owned delivery registry (per-member email/phone/in-app/
// dashboard entries with verified + opt-in state and a per-agent allowlist). Same
// records the web Contacts tab manages; the server enforces the role gates.
export type ContactMethodType = "Email" | "Phone/Text" | "In-App" | "Family Dashboard";
export interface ContactMethodRec {
  id: string; memberId: string; label: string; type: ContactMethodType; value: string;
  verified: boolean; optInStatus: "Opted In" | "Pending" | "Not Set" | "Opted Out";
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
/** Household settings the mobile client can read/toggle. */
export interface AppSettingsRec {
  externalActionsEnabled: boolean; ownerPinSet: boolean;
  /** True when a PIN set in the deployment's ENVIRONMENT is also being accepted for
   *  elevated sign-in — a single shared secret that opens every Owner and Adult Admin
   *  account. Surfaced so a household can see it rather than be told about it. */
  breakGlassActive?: boolean;
  /** "google" once a Places key is configured, "nominatim" on the keyless fallback (addresses
   *  only — no ratings, prices or opening hours). */
  placesProvider?: "google" | "nominatim";
  aiActiveProvider: string | null; calendarAutoSync: boolean;
  /** IANA zone the household keeps its clock in — all-day events are dated in it. */
  timezone?: string;
  autoApproveImprovements: boolean;
  /** The household's autonomy stance — one answer instead of a capability matrix. Enforced in
   *  server/policy.mjs rule 7, which is the only place that decides what it means. */
  autonomy?: Autonomy;
  /** True until a person actually chooses, so the UI can invite a decision rather than present
   *  an unanswered default as though someone had made it. */
  autonomyDefaulted?: boolean;
  autonomySetByRole?: string | null;
  autonomySetAt?: string | null;
}
export type Autonomy = "Cautious" | "Balanced" | "Trusted";
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
  (method === "PATCH" && /^\/tasks\//.test(path)) || (method === "POST" && path === "/tasks")
  // A message typed from the lock screen or on a dead connection is kept, not lost.
  || (method === "POST" && /^\/threads\/[^/]+\/messages$/.test(path));

/** A refusal keeps the server's own sentence ("Only Casey or the Owner can remove this
 *  calendar."); a missing body is a network failure. */
function refusalOr<T extends CalendarRefusal>(r: Res<T>): T {
  if (r.data && typeof r.data === "object") return r.data;
  return { error: r.status === 403 ? "insufficient_role" : "network" } as T;
}

async function req<T = unknown>(path: string, init?: RequestInit): Promise<Res<T>> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init?.headers as Record<string, string> | undefined) };
  // The token this request is sent with — compared on the way back, so a late answer about an
  // OLD session can never touch the one signed in since.
  const sentWith = token;
  if (sentWith) headers["authorization"] = `Bearer ${sentWith}`;
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
  // Only a request that carried THE CURRENT token can report it ended: a /rev poll still in
  // flight from the previous profile must not sign out the person who just signed in.
  if (res.status === 401 && sentWith && sentWith === token && (data as { error?: string })?.error === "authentication_required") {
    try { sessionExpiredHandler?.(); } catch { /* never let the handler break the caller */ }
  }
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
  /** The session as the server sees it — and whether the server answered at all, so that
   *  opening the app with no signal never signs anyone out (only a real "no session" does). */
  async sessionStatus(): Promise<{ answered: boolean; session: Session | null }> {
    const sentWith = token;
    const r = await req<{ session: Session | null }>("/session");
    // Answered means the server itself said who is signed in: a 200 carrying a "session" key,
    // about the token still in use. A 404, a 429, a captive-portal page or an answer about a
    // token replaced meanwhile is not an answer and changes nothing.
    const answered = r.status === 200 && !!r.data && typeof r.data === "object" && "session" in r.data && sentWith === token;
    return { answered, session: answered ? (r.data.session ?? null) : null };
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
  /** Re-probe every connected account in the household right now. Any adult may run it: a
   *  stale "needs reconnect" on someone ELSE's account was previously unfixable from the
   *  screen that showed it. Read-only — it can clear or confirm a status, never grant access. */
  async checkConnections(): Promise<{ ok?: boolean; checked?: number; healed?: number; marked?: number; error?: string }> {
    const r = await req<{ ok?: boolean; checked?: number; healed?: number; marked?: number; error?: string }>("/accounts/health-check", { method: "POST", body: "{}" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },

  /* ---- Nests ---------------------------------------------------------------------- */
  async nests(): Promise<{ nests: NestRec[]; invitations: NestRec[] }> {
    const r = await req<{ nests?: NestRec[]; invitations?: NestRec[] }>("/nests");
    return { nests: r.data?.nests ?? [], invitations: r.data?.invitations ?? [] };
  },
  async createNest(inviteActorIds: string[], name?: string): Promise<{ nest?: NestRec; error?: string; message?: string }> {
    const r = await req<{ nest?: NestRec; error?: string; message?: string }>("/nests", {
      method: "POST", body: JSON.stringify({ inviteActorIds, name }),
    });
    return r.data ?? { error: "network" };
  },
  /** accept | decline | leave — always for YOURSELF; the server refuses anything else. */
  async nestAction(id: string, action: "accept" | "decline" | "leave"): Promise<{ nest?: NestRec; archived?: boolean; error?: string; message?: string }> {
    const r = await req<{ nest?: NestRec; archived?: boolean; error?: string; message?: string }>(`/nests/${encodeURIComponent(id)}/${action}`, { method: "POST", body: "{}" });
    return r.data ?? { error: "network" };
  },

  /* ---- D5: operator-only, cross-household ------------------------------------------ */
  async adminHouseholds(): Promise<AdminHouseholdRec[]> {
    const r = await req<{ households?: AdminHouseholdRec[] }>("/admin/households");
    return r.data?.households ?? [];
  },
  async adminCreateInvite(householdId: string, displayName: string, role: string): Promise<{ invite?: InviteRec; error?: string }> {
    const r = await req<{ invite?: InviteRec; error?: string }>("/admin/invites", {
      method: "POST", body: JSON.stringify({ householdId, displayName, role }),
    });
    return r.data ?? { error: "network" };
  },

  /* ---- D1/D2: recovery, before anyone is signed in ---------------------------------
   * The responses are deliberately uninformative about whether an account exists — that
   * would be account enumeration. So these never report "no such account"; the UI says what
   * WILL happen if the address is real. */
  async requestPasswordReset(email: string): Promise<{ ok?: boolean; message?: string; error?: string }> {
    const r = await req<{ ok?: boolean; message?: string; error?: string }>("/password-reset/request", { method: "POST", body: JSON.stringify({ email }) });
    return r.data ?? { error: "network" };
  },
  async verifyResetCode(email: string, code: string): Promise<{ ok?: boolean; token?: string; error?: string; message?: string; attemptsLeft?: number }> {
    const r = await req<{ ok?: boolean; token?: string; error?: string; message?: string; attemptsLeft?: number }>("/password-reset/verify-code", { method: "POST", body: JSON.stringify({ email, code }) });
    return r.data ?? { error: "network" };
  },
  async completePasswordReset(token: string, password: string): Promise<{ ok?: boolean; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; error?: string; message?: string }>("/password-reset/complete", { method: "POST", body: JSON.stringify({ token, password }) });
    return r.data ?? { error: "network" };
  },
  async recoverEmail(inviteCode: string, displayName: string): Promise<{ ok?: boolean; message?: string; error?: string }> {
    const r = await req<{ ok?: boolean; message?: string; error?: string }>("/email-recovery/request", { method: "POST", body: JSON.stringify({ inviteCode, displayName }) });
    return r.data ?? { error: "network" };
  },
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
  // clientTurnId names the turn: the server runs a named turn at most once, so this call
  // is safe to make AFTER a stream of the same turn failed — it returns that stream's
  // answer instead of executing the tools a second time.
  async assistant(message: string, opts?: { context?: Record<string, unknown>; conversationId?: string; clientTurnId?: string }): Promise<AssistantResult> {
    const r = await req<AssistantResult>("/assistant", { method: "POST", body: JSON.stringify({ message, context: opts?.context, conversationId: opts?.conversationId, clientTurnId: opts?.clientTurnId }) });
    return r.data ?? { ok: false, error: "network" };
  },
  /* ---- Family Messages ---- */
  async threads(actorId?: string): Promise<ThreadRec[]> {
    const r = await req<{ threads: ThreadRec[] }>(`/threads${actorId ? `?actorId=${encodeURIComponent(actorId)}` : ""}`);
    return r.data?.threads ?? [];
  },
  async createThread(participantIds: string[], title?: string): Promise<{ thread?: ThreadRec; existed?: boolean; error?: string; reason?: string; whoName?: string }> {
    const r = await req<{ thread?: ThreadRec; existed?: boolean; error?: string; reason?: string; whoName?: string }>("/threads", { method: "POST", body: JSON.stringify({ participantIds, title }) });
    return r.data ?? { error: "network" };
  },
  async thread(id: string, before?: string): Promise<ThreadView | null> {
    const r = await req<ThreadView>(`/threads/${encodeURIComponent(id)}${before ? `?before=${encodeURIComponent(before)}` : ""}`);
    return r.ok && r.data?.thread ? r.data : null;
  },
  async sendMessage(id: string, body: { text?: string; attachments?: MessageAttachment[] }): Promise<{ message?: MessageRec; error?: string; message_?: string }> {
    const r = await req<{ message?: MessageRec; error?: string }>(`/threads/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify(body) });
    return r.data ?? { error: "network" };
  },
  /** Delete on my side only: the chat and its history vanish for me; the others keep everything. */
  async deleteThread(id: string): Promise<{ ok?: boolean; error?: string }> {
    const r = await req<{ ok?: boolean; error?: string }>(`/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
    return r.data ?? { error: "network" };
  },
  /** Start fresh in the Inbox (Adult Admin+): clear delivered updates and/or decided approvals. */
  async clearInbox(collections: ("notifications.json" | "approvals.json")[]): Promise<{ ok?: boolean; cleared?: Record<string, number>; error?: string }> {
    const r = await req<{ ok?: boolean; cleared?: Record<string, number>; error?: string }>("/household/clear-inbox", { method: "POST", body: JSON.stringify({ collections }) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async markThreadRead(id: string): Promise<void> { await req(`/threads/${encodeURIComponent(id)}/read`, { method: "POST", body: "{}" }); },
  async typing(id: string): Promise<void> { await req(`/threads/${encodeURIComponent(id)}/typing`, { method: "POST", body: "{}" }); },
  /** `until`: ISO string, "forever", or null to unmute. */
  async muteThread(id: string, until: string | null): Promise<ThreadRec | null> {
    const r = await req<{ thread?: ThreadRec }>(`/threads/${encodeURIComponent(id)}/mute`, { method: "POST", body: JSON.stringify({ until }) });
    return r.data?.thread ?? null;
  },
  async addThreadMember(id: string, actorId: string): Promise<{ thread?: ThreadRec; error?: string; reason?: string; whoName?: string; message?: string }> {
    const r = await req<{ thread?: ThreadRec; error?: string; reason?: string; whoName?: string; message?: string }>(`/threads/${encodeURIComponent(id)}/members`, { method: "POST", body: JSON.stringify({ actorId }) });
    return r.data ?? { error: "network" };
  },
  async removeThreadMember(id: string, actorId: string): Promise<{ thread?: ThreadRec; error?: string; message?: string }> {
    const r = await req<{ thread?: ThreadRec; error?: string; message?: string }>(`/threads/${encodeURIComponent(id)}/members/${encodeURIComponent(actorId)}`, { method: "DELETE" });
    return r.data ?? { error: "network" };
  },
  async leaveThread(id: string): Promise<{ thread?: ThreadRec; error?: string }> {
    const r = await req<{ thread?: ThreadRec; error?: string }>(`/threads/${encodeURIComponent(id)}/leave`, { method: "POST", body: "{}" });
    return r.data ?? { error: "network" };
  },
  async renameThread(id: string, title: string): Promise<{ thread?: ThreadRec; error?: string }> {
    const r = await req<{ thread?: ThreadRec; error?: string }>(`/threads/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ title }) });
    return r.data ?? { error: "network" };
  },
  async editMessage(id: string, mid: string, text: string): Promise<{ message?: MessageRec; error?: string }> {
    const r = await req<{ message?: MessageRec; error?: string }>(`/threads/${encodeURIComponent(id)}/messages/${encodeURIComponent(mid)}`, { method: "PATCH", body: JSON.stringify({ text }) });
    return r.data ?? { error: "network" };
  },
  async deleteMessage(id: string, mid: string): Promise<{ message?: MessageRec; error?: string }> {
    const r = await req<{ message?: MessageRec; error?: string }>(`/threads/${encodeURIComponent(id)}/messages/${encodeURIComponent(mid)}`, { method: "DELETE" });
    return r.data ?? { error: "network" };
  },
  async reactToMessage(id: string, mid: string, emoji: string): Promise<{ message?: MessageRec; error?: string }> {
    const r = await req<{ message?: MessageRec; error?: string }>(`/threads/${encodeURIComponent(id)}/messages/${encodeURIComponent(mid)}/reactions`, { method: "POST", body: JSON.stringify({ emoji }) });
    return r.data ?? { error: "network" };
  },
  async searchMessages(q: string): Promise<{ hits: { threadId: string; message: MessageRec }[]; threads: Record<string, ThreadRec> }> {
    const r = await req<{ hits: { threadId: string; message: MessageRec }[]; threads: Record<string, ThreadRec> }>(`/threads/search?q=${encodeURIComponent(q)}`);
    return r.data?.hits ? r.data : { hits: [], threads: {} };
  },
  async actOnSuggestion(id: string, mid: string, sid: string, action: "apply" | "dismiss"): Promise<{ ok?: boolean; suggestion?: SuggestionRec; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; suggestion?: SuggestionRec; error?: string; message?: string }>(`/threads/${encodeURIComponent(id)}/messages/${encodeURIComponent(mid)}/suggestions/${encodeURIComponent(sid)}`, { method: "POST", body: JSON.stringify({ action }) });
    return r.data ?? { error: "network" };
  },
  /* ---- server-durable conversations (mirror of the web chat history) ---- */
  async conversations(): Promise<ConversationRec[]> {
    const r = await req<{ conversations: ConversationRec[] }>("/conversations");
    return r.data?.conversations ?? [];
  },
  /** `nestId` is required when visibility is "nest" — the server verifies membership, so
   *  naming a nest you are not in falls back to a private chat rather than sharing it. */
  async createConversation(title: string, visibility?: "personal" | "household" | "nest", nestId?: string): Promise<ConversationRec | null> {
    const r = await req<{ conversation?: ConversationRec }>("/conversations", { method: "POST", body: JSON.stringify({ title, visibility, nestId }) });
    return r.data?.conversation ?? null;
  },
  async conversation(id: string): Promise<ConversationRec | null> {
    const r = await req<{ conversation?: ConversationRec }>(`/conversations/${encodeURIComponent(id)}`);
    return r.data?.conversation ?? null;
  },
  /* I1/I3 — rename a thread (which pins the name against the auto-namer), or move it between
   * Personal and Family. The server allows the move only for the thread's own author: making
   * a personal chat family-visible publishes everything already in it. */
  async patchConversation(id: string, patch: { title?: string; visibility?: "personal" | "household" }): Promise<{ conversation?: ConversationRec; error?: string; message?: string }> {
    const r = await req<{ conversation?: ConversationRec; error?: string; message?: string }>(`/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH", body: JSON.stringify(patch),
    });
    return r.data ?? { error: "network" };
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
  async notifications(): Promise<NotificationRec[]> {
    const r = await req<{ notifications: NotificationRec[] }>("/notifications");
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
  /* `pin` — the household PIN, re-entered at the moment of a dangerous change (Cluster W).
   * Optional in the type because a household with no PIN set isn't gated by one. */
  async setRiskOverride(toolId: string, patch: { riskClass?: string | null; skipApproval?: boolean; pin?: string }): Promise<{ override?: RiskOverrideRec; error?: string; message?: string }> {
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
  /* Create one thing the assistant found inside a file. Deliberately one call per card: the
   * family taps Add on the ones they want, and the ones they don't are simply never created. */
  async addExtracted(c: NonNullable<ResultCardRec["candidate"]>): Promise<{ ok?: boolean; error?: string; message?: string }> {
    if (c.type === "event") {
      const r = await req<{ event?: EventRec; error?: string; message?: string }>("/events", {
        method: "POST",
        body: JSON.stringify({
          title: c.title,
          // No startAt: the source said "Tuesday 4:15pm" and guessing a year and a timezone
          // from that is how a confident card becomes a wrong appointment. It lands under
          // "No date set" with the original wording in the notes, ready to be given a real time.
          startAt: null,
          location: c.where ?? "",
          notes: [c.when ? `From the file: ${c.when}` : null, c.notes, c.source ? `Source: ${c.source}` : null].filter(Boolean).join("\n"),
          visibility: "household",
        }),
      });
      return r.data?.event ? { ok: true } : { error: r.data?.error ?? "network", message: r.data?.message };
    }
    const r = await req<{ task?: TaskRec; error?: string; message?: string }>("/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: c.title,
        type: c.type === "list_item" ? "list" : "task",
        ...(c.type === "list_item" ? { listName: "Groceries" } : {}),
        notes: [c.when ? `From the file: ${c.when}` : null, c.notes, c.source ? `Source: ${c.source}` : null].filter(Boolean).join("\n"),
      }),
    });
    return r.data?.task ? { ok: true } : { error: r.data?.error ?? "network", message: r.data?.message };
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
  /** `kind: "avatar"` keeps a profile picture out of the family document library — the blob
   *  is stored the same way, but the Library lists documents. Omitted means document. */
  async uploadFile(body: { name: string; contentBase64: string; mime?: string; tags?: string[]; visibility?: string; kind?: "avatar" | "document" | "message"; participantIds?: string[]; pages?: { name?: string; base64: string }[]; autoFile?: boolean }): Promise<{ file?: FileRec; error?: string; message?: string; autoFiled?: string }> {
    const r = await req<{ file?: FileRec; error?: string; message?: string; autoFiled?: string }>("/files", { method: "POST", body: JSON.stringify(body) });
    if (r.status === 403) return { error: "insufficient_role" };
    if (r.status === 413) return { error: "too_large" };
    return r.data ?? { error: "network" };
  },
  async fileContent(id: string): Promise<{ name?: string; mime?: string; contentBase64?: string; error?: string }> {
    const r = await req<{ name?: string; mime?: string; contentBase64?: string; error?: string }>(`/files/${encodeURIComponent(id)}/content`);
    return r.data ?? { error: "network" };
  },
  /* O2 — a readable preview for anything the phone can't render inline (a PDF becomes its
   * text; a photo becomes a description). Returns the honest reason when a file genuinely
   * can't be read, rather than "no inline preview". */
  async filePreview(id: string): Promise<{ ok?: boolean; kind?: string; text?: string; truncated?: boolean; message?: string }> {
    const r = await req<{ ok?: boolean; kind?: string; text?: string; truncated?: boolean; message?: string }>(`/files/${encodeURIComponent(id)}/preview`);
    return r.data ?? { ok: false, message: "Couldn't reach the server." };
  },
  async deleteFile(id: string): Promise<{ ok?: boolean; error?: string }> {
    const r = await req<{ ok?: boolean; error?: string }>(`/files/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "forbidden" };
    return r.data ?? { error: "network" };
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
  /* ---- Knowledge — server-durable household knowledge items (create/edit/delete) ---- */
  async knowledge(): Promise<KnowledgeRec[]> {
    const r = await req<{ items: KnowledgeRec[] }>("/knowledge");
    return r.data?.items ?? [];
  },
  async createKnowledge(body: { title: string; type: string; content: string; tags?: string[]; visibility?: "household" | "private" | "nest"; nestId?: string | null; sensitive?: boolean; fileIds?: string[] }): Promise<{ item?: KnowledgeRec; error?: string; message?: string }> {
    const r = await req<{ item?: KnowledgeRec; error?: string; message?: string }>("/knowledge", { method: "POST", body: JSON.stringify(body) });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  async patchKnowledge(id: string, patch: Partial<Pick<KnowledgeRec, "title" | "type" | "content" | "tags" | "visibility" | "nestId" | "sensitive" | "fileIds">> & { ifUpdatedAt?: string }): Promise<{ item?: KnowledgeRec; error?: string; message?: string; current?: KnowledgeRec }> {
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
  /** The Connections view: every calendar (legend rows for ones the viewer can't manage) plus
   *  what the Add button may offer. */
  async calendarConnections(): Promise<{ subscriptions: CalendarSubscription[]; canAdd: CalendarCanAdd }> {
    const r = await req<{ subscriptions: CalendarSubscription[]; canAdd?: CalendarCanAdd }>("/calendar/subscriptions");
    return { subscriptions: r.data?.subscriptions ?? [], canAdd: r.data?.canAdd ?? { self: false, limitReached: false, forMembers: [] } };
  },
  /** forMemberId: the Owner adding a calendar for someone else (the server refuses anyone else). */
  async subscribeCalendar(body: { name?: string; url: string; forMemberId?: string }): Promise<{ subscription?: CalendarSubscription; sync?: CalendarSync } & CalendarRefusal> {
    const r = await req<{ subscription?: CalendarSubscription; sync?: CalendarSync } & CalendarRefusal>("/calendar/subscriptions", { method: "POST", body: JSON.stringify(body) });
    return refusalOr(r);
  },
  async importIcs(body: { name?: string; ics: string; forMemberId?: string }): Promise<{ subscription?: CalendarSubscription; sync?: CalendarSync } & CalendarRefusal> {
    const r = await req<{ subscription?: CalendarSubscription; sync?: CalendarSync } & CalendarRefusal>("/calendar/import-ics", { method: "POST", body: JSON.stringify(body) });
    return refusalOr(r);
  },
  /** accountId picks one of the signed-in member's own Google accounts (default: the first). */
  async connectGoogleCalendar(body: { forMemberId?: string; accountId?: string } = {}): Promise<{ subscription?: CalendarSubscription; sync?: CalendarSync } & CalendarRefusal> {
    const r = await req<{ subscription?: CalendarSubscription; sync?: CalendarSync } & CalendarRefusal>("/calendar/connect-google", { method: "POST", body: JSON.stringify(body) });
    return refusalOr(r);
  },
  /** Refresh every calendar in the household (any member may; the server runs one at a time and
   *  at most once a minute). wait:true answers when it is done (or after ~8 s with pending). */
  async refreshCalendars(reason: string, wait = false): Promise<{ ok?: boolean; pending?: boolean; skipped?: string; at?: number; error?: string }> {
    const r = await req<{ ok?: boolean; pending?: boolean; skipped?: string; at?: number; error?: string }>("/calendar/refresh", { method: "POST", body: JSON.stringify({ reason, wait }) });
    return r.data ?? { error: "network" };
  },
  /** The eye toggle: hide (true) or share (false) one of YOUR events; secret = "Keep it a
   *  surprise" (null = let the words decide). Only the event's owner, an adult, may. */
  async setEventSharing(id: string, hidden: boolean, secret?: boolean | null): Promise<{ event?: EventRec } & CalendarRefusal> {
    const r = await req<{ event?: EventRec } & CalendarRefusal>("/events/sharing", { method: "POST", body: JSON.stringify(secret === undefined ? { id, hidden } : { id, hidden, secret }) });
    return refusalOr(r);
  },
  /** Owner only: what a Limited Member's calendar shows (null = everything). */
  async setCalendarScope(memberId: string, scope: CalendarScope | null): Promise<{ member?: MemberRec; ok?: boolean } & CalendarRefusal> {
    const r = await req<{ member?: MemberRec; ok?: boolean } & CalendarRefusal>(`/members/${encodeURIComponent(memberId)}/calendar-scope`, { method: "PUT", body: JSON.stringify({ scope }) });
    return refusalOr(r);
  },
  async syncCalendar(id: string): Promise<{ subscription?: CalendarSubscription; sync?: CalendarSync; error?: string }> {
    const r = await req<{ subscription?: CalendarSubscription; sync?: CalendarSync; error?: string }>(`/calendar/subscriptions/${encodeURIComponent(id)}/sync`, { method: "POST", body: "{}" });
    return r.data ?? { error: "network" };
  },
  /** Rename a feed and/or say whose calendar it is; its imported events take the owner at once. */
  /** Rename, recolour, mark as Work, or (Owner only) reassign. Send only what changed. */
  async updateCalendarSubscription(id: string, patch: { name?: string; color?: string; isWork?: boolean; ownerActorId?: string }): Promise<{ subscription?: CalendarSubscription; restamped?: number } & CalendarRefusal> {
    const r = await req<{ subscription?: CalendarSubscription; restamped?: number } & CalendarRefusal>(`/calendar/subscriptions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    return refusalOr(r);
  },
  async deleteCalendarSubscription(id: string): Promise<{ ok?: boolean; removedEvents?: number } & CalendarRefusal> {
    const r = await req<{ ok?: boolean; removedEvents?: number } & CalendarRefusal>(`/calendar/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
    return refusalOr(r);
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
  /* Cluster L — lists are records now, so an empty list can exist and a full one can be
   * deleted. The registry ADDS existence; tasks keep their listName strings. */
  async taskLists(): Promise<{ lists: { id: string; name: string; visibility: string; nestId?: string | null; createdBy: string }[] }> {
    const r = await req<{ lists: { id: string; name: string; visibility: string; nestId?: string | null; createdBy: string }[] }>("/task-lists");
    return r.data ?? { lists: [] };
  },
  async createTaskList(body: { name: string; visibility?: string; nestId?: string | null }): Promise<{ list?: { id: string; name: string }; error?: string; message?: string }> {
    const r = await req<{ list?: { id: string; name: string }; error?: string; message?: string }>("/task-lists", { method: "POST", body: JSON.stringify(body) });
    return r.data ?? { error: "network" };
  },
  async deleteTaskList(id: string): Promise<{ ok?: boolean; tasksRemoved?: number; error?: string }> {
    const r = await req<{ ok?: boolean; tasksRemoved?: number; error?: string }>(`/task-lists/${encodeURIComponent(id)}`, { method: "DELETE" });
    return r.data ?? { error: "network" };
  },
  async createTask(body: { title: string; type?: string; dueAt?: string | null; startAt?: string | null; endAt?: string | null; assignedMemberId?: string | null; priority?: string; listName?: string; visibility?: string; nestId?: string; remindOffsets?: number[] }): Promise<{ task?: TaskRec; error?: string }> {
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
  /* ---- E5/E6/E7: who's coming, told, and answering --------------------------------- */
  async setEventAttendees(id: string, memberIds: string[]): Promise<{ event?: EventRec; notified?: number; error?: string; message?: string }> {
    const r = await req<{ event?: EventRec; notified?: number; error?: string; message?: string }>(`/events/${encodeURIComponent(id)}/attendees`, {
      method: "POST", body: JSON.stringify({ memberIds }),
    });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
  /** `memberId` is optional: omit it to answer for yourself (the only thing most members
   *  may do — the server refuses answering for anyone else unless you're an adult). */
  /* Cluster D — asking, offering, suggesting: nothing shared changes until the owner says
   * yes, and each of these tells them you asked. */
  async requestAttend(id: string): Promise<{ ok?: boolean; pending?: boolean; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; pending?: boolean; error?: string; message?: string }>(`/events/${encodeURIComponent(id)}/request-attend`, { method: "POST", body: "{}" });
    return r.data ?? { error: "network" };
  },
  async offerDrive(id: string): Promise<{ ok?: boolean; pending?: boolean; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; pending?: boolean; error?: string; message?: string }>(`/events/${encodeURIComponent(id)}/offer-drive`, { method: "POST", body: "{}" });
    return r.data ?? { error: "network" };
  },
  async suggestBring(id: string, item: string): Promise<{ ok?: boolean; pending?: boolean; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; pending?: boolean; error?: string; message?: string }>(`/events/${encodeURIComponent(id)}/suggest-bring`, { method: "POST", body: JSON.stringify({ item }) });
    return r.data ?? { error: "network" };
  },
  async respondEventRequest(id: string, body: { kind: "attend" | "drive" | "bring"; actorId: string; item?: string; accept: boolean }): Promise<{ event?: EventRec; error?: string; message?: string }> {
    const r = await req<{ event?: EventRec; error?: string; message?: string }>(`/events/${encodeURIComponent(id)}/requests/respond`, { method: "POST", body: JSON.stringify(body) });
    return r.data ?? { error: "network" };
  },
  async rsvpEvent(id: string, status: "accepted" | "declined" | "invited", memberId?: string): Promise<{ event?: EventRec; error?: string; message?: string }> {
    const r = await req<{ event?: EventRec; error?: string; message?: string }>(`/events/${encodeURIComponent(id)}/rsvp`, {
      method: "POST", body: JSON.stringify({ status, ...(memberId ? { memberId } : {}) }),
    });
    return r.data ?? { error: "network" };
  },
  // `google` reports what happened to a canonical event's Google copy: "deleted", or
  // "failed" / "kept_external_actions_disabled" when it's still there and will resurface on
  // the next sync. The server may instead refuse with 422 google_delete_failed.
  async deleteEvent(id: string): Promise<{ ok?: boolean; google?: "deleted" | "failed" | "kept_external_actions_disabled"; error?: string; message?: string }> {
    const r = await req<{ ok?: boolean; google?: "deleted" | "failed" | "kept_external_actions_disabled"; error?: string; message?: string }>(`/events/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.status === 403) return { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },

  /* ---- Helpers (list / read / create / edit / run / delete / history / templates) ----
   *
   * The whole surface. There is no separate skill, function, playbook, automation, trigger
   * or evolution endpoint any more — every one of those routes 404s, and everything they
   * used to do is a field on a Helper.
   *
   * Refusals travel intact. A 403 from here is one of five different things — you're not an
   * adult, it isn't yours, it's the household's, the PIN is missing, the PIN is wrong — and
   * the server writes a sentence for each. Collapsing them into "insufficient_role" is how a
   * fixable refusal comes to look permanent, so `message` is passed through untouched and
   * every caller shows it verbatim.
   */
  async helpers(): Promise<PublicHelper[]> {
    const r = await req<{ helpers: PublicHelper[] }>("/helpers");
    return r.data?.helpers ?? [];
  },
  async helper(id: string): Promise<PublicHelper | null> {
    const r = await req<{ helper?: PublicHelper }>(`/helpers/${encodeURIComponent(id)}`);
    return r.data?.helper ?? null;
  },
  async createHelper(body: HelperInput & { instructions: string }): Promise<{ helper?: PublicHelper } & HelperError> {
    const r = await req<{ helper?: PublicHelper } & HelperError>("/helpers", { method: "POST", body: JSON.stringify(body) });
    if (!r.data) return { error: "network" };
    return r.data;
  },
  async patchHelper(id: string, patch: HelperInput): Promise<{ helper?: PublicHelper } & HelperError> {
    const r = await req<{ helper?: PublicHelper } & HelperError>(`/helpers/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (!r.data) return { error: "network" };
    return r.data;
  },
  async deleteHelper(id: string): Promise<{ ok?: boolean } & HelperError> {
    const r = await req<{ ok?: boolean } & HelperError>(`/helpers/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.data) return { error: "network" };
    return r.data;
  },
  /** Runs it now, in the foreground. This can take well over 30 seconds — the caller owns
   *  showing that. A 422 means it genuinely ran and failed; the body says why. */
  async runHelper(id: string): Promise<HelperRunResult> {
    const r = await req<HelperRunResult>(`/helpers/${encodeURIComponent(id)}/run`, { method: "POST", body: "{}" });
    if (!r.data) return { ok: false, error: "network", message: "Couldn't reach Famili — check your connection." };
    return r.data;
  },
  async helperHistory(id: string): Promise<HelperHistory> {
    const r = await req<HelperHistory>(`/helpers/${encodeURIComponent(id)}/history`);
    return { conversationId: r.data?.conversationId ?? null, messages: r.data?.messages ?? [], lastRun: r.data?.lastRun ?? null };
  },
  /** Starter helpers, grouped. A template is real instructions, shown for editing before
   *  anything is saved — never a blind "create this for me". */
  async helperTemplates(): Promise<HelperTemplateSection[]> {
    const r = await req<{ sections: HelperTemplateSection[] }>("/helper-templates");
    return r.data?.sections ?? [];
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

  /* ---- Household settings (read + toggle) ---- */
  async settings(): Promise<AppSettingsRec | null> {
    const r = await req<{ settings: AppSettingsRec }>("/settings");
    return r.data?.settings ?? null;
  },
  async updateSettings(patch: Partial<Pick<AppSettingsRec, "externalActionsEnabled" | "calendarAutoSync" | "autoApproveImprovements" | "autonomy">> & { ownerPin?: string; pin?: string }): Promise<{ settings?: AppSettingsRec; error?: string; message?: string }> {
    const r = await req<{ settings?: AppSettingsRec; error?: string; message?: string }>("/settings", { method: "POST", body: JSON.stringify(patch) });
    // A 403 here is THREE different things — you're not allowed, you need the PIN, or the PIN
    // was wrong — and this collapsed all of them into "insufficient_role". Two of the three are
    // questions the person can answer, so flattening them makes a fixable refusal look like a
    // permanent one. The server's own error code travels; only a bodyless 403 falls back.
    if (r.status === 403) return r.data?.error ? r.data : { error: "insufficient_role" };
    return r.data ?? { error: "network" };
  },
};

// E1 — one address suggestion: the name a family recognises, the address under it, and the
// full string that goes INTO the field (a label alone won't navigate anywhere).
export interface AddressSuggestionRec { label: string; detail: string; value: string; placeId: string | null }
/* Nests — a small group inside the household. "GPop and Beannie are actually married… their
 * own helpers and grocery list and task list available between the two of them, and yet still
 * isolated from the broader family group." A third space alongside Personal and Family. */
export interface NestMemberRec { actorId: string; name: string | null; status: "joined" | "invited" | "declined" | "left"; respondedAt: string | null }
export interface NestRec {
  id: string; name: string | null; label: string;
  createdBy: string; createdAt: string;
  members: NestMemberRec[];
  myStatus: NestMemberRec["status"] | null;
}
