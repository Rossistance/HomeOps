import { create } from "zustand";
import { useEffect, useState } from "react";
import type {
  AppData,
  Agent,
  ApprovalRequest,
  ContactMethod,
  FileAsset,
  KnowledgeItem,
  MemoryEntry,
  MemoryType,
  MiniApp,
  Route,
  ScreenId,
  Space,
  Member,
  Task,
  TaskStatus,
  CalendarEvent,
  AssistantConversation,
  AssistantMessage,
  AssistantToolCall,
  MessageThread,
  AppSettings,
  HelperRun,
  RunStep,
  RunStatus,
  RunStatusView,
  SearchResult,
  Role,
} from "@/types";
import { capabilitiesFor } from "@/lib/roles";
import { buildSeedData, buildEmptyData, isSampleData } from "@/data/seed";
import { loadAppData, saveAppData, clearAppData, detectStorageMode, type StorageMode } from "@/storage/db";
import { uid } from "@/lib/ids";
import { mergeServerAuthoritative } from "@/store/reconcile";
import { pushActivity, processFile } from "@/lib/runtime";
import { buildSearchIndex, search } from "@/lib/search";
import { isLive } from "@/lib/dates";
import { backend, type BackendConnector, type BackendHealth, type ExecResult, type Session, type ConnectorProvider, type ConnectedAccount, type AgentPlan, type GeneratedMiniApp, type ServerRun, type ServerEvent, type ServerTask, type ServerConversation, type ServerConversationMessage, type ServerMemory, type PublicHelper, type ServerContactMethod, type ServerArtifact, type ServerFile, type ServerKnowledge, type BackendApproval, type ServerNotification } from "@/connectors/api";

/** A plan shape the live runner can execute (AgentPlan satisfies this). */
export interface RunnableStep { toolId: string | null; title: string; detail: string; input: Record<string, unknown>; requiresApproval: boolean }
export interface RunnablePlan { title?: string; summary?: string; steps: RunnableStep[] }

/** Local knowledge id → the in-flight create's promise (resolving to the server id, or
 *  undefined if the create failed). A very-fast edit/delete on a just-created item awaits
 *  this instead of silently no-op'ing — which otherwise reverted edits on the next hydrate
 *  and orphaned server rows on delete. */
const knowledgeServerIdPending = new Map<string, Promise<string | undefined>>();

/* ---- Server run → local projection (the SERVER is the source of truth; the
   client mirrors its durable runs into the local HelperRun shape) ---- */
function mapRunStatus(s: string): RunStatus {
  if (s === "completed") return "Completed";
  // WP-101 (sibling slice): partially_failed is terminal and NOT a success — it must
  // never collapse into "Completed" (a lie) or fall through to "Running" (a hang, since
  // nothing ever moves it past that on the client).
  if (s === "partially_failed") return "Partly Done";
  if (s === "failed" || s === "cancelled" || s === "expired") return "Failed";
  if (s === "waiting_for_approval" || s === "waiting_for_connector" || s === "waiting_for_provider") return "Waiting for Approval";
  return "Running";
}

/**
 * WP-003 slice 1 — the ONE status vocabulary. A pure, TOTAL mapper over the full
 * server run-status enum (server/engine.mjs: pending | queued | running | retrying |
 * waiting_for_approval | waiting_for_connector | waiting_for_provider | completed |
 * failed | cancelled | expired). Every run chip in the app renders label + CTA from
 * this — never a raw status and never the old collapsed bucket that made a connector
 * wait read "Waiting for Approval" (EV-009). Parked causes are distinguished:
 *   waiting_for_approval  → "Needs approval"     → Messages ▸ Approvals
 *   waiting_for_connector → "Needs a connection" → Connections
 *   waiting_for_provider  → "Needs an AI provider" → Settings ▸ AI providers
 * The collapsed UI RunStatus values ("Completed"/"Failed"/…) are accepted too, so
 * purely-local/seed runs (which carry no serverStatus) still map cleanly.
 */
export function runStatusView(status: string | undefined | null): RunStatusView {
  const s = String(status ?? "").toLowerCase();
  switch (s) {
    case "waiting_for_approval":
    case "waiting for approval":
      return { label: "Needs approval", tone: "amber", parked: true, terminal: false, active: false, cta: { label: "Review approval", screen: "messages", params: { tab: "approvals" } } };
    case "waiting_for_connector":
      return { label: "Needs a connection", tone: "amber", parked: true, terminal: false, active: false, cta: { label: "Open Connections", screen: "connections" } };
    case "waiting_for_provider":
      return { label: "Needs an AI provider", tone: "amber", parked: true, terminal: false, active: false, cta: { label: "Connect a provider", screen: "settings" } };
    case "completed":
      return { label: "Completed", tone: "sage", parked: false, terminal: true, active: false };
    // WP-101 (sibling slice): a run where required steps succeeded but an
    // optional/soft-fail step didn't — terminal (it will not change again on its
    // own), and deliberately NOT "sage" (that would read as a clean success) nor
    // "coral" (that would read as a full failure it isn't). Per-step optionality
    // isn't in the client payload yet, so this can't name the specific failed step —
    // only the honest run-level outcome.
    case "partially_failed":
      return { label: "Partly done", tone: "amber", parked: false, terminal: true, active: false };
    case "failed":
      return { label: "Failed", tone: "coral", parked: false, terminal: true, active: false };
    case "expired":
      return { label: "Expired", tone: "coral", parked: false, terminal: true, active: false };
    case "cancelled":
      return { label: "Cancelled", tone: "gray", parked: false, terminal: true, active: false };
    case "running":
      return { label: "Running", tone: "sky", parked: false, terminal: false, active: true };
    case "retrying":
      return { label: "Retrying", tone: "sky", parked: false, terminal: false, active: true };
    case "queued":
    case "pending":
      return { label: "Queued", tone: "sky", parked: false, terminal: false, active: true };
    default:
      // Total: anything the engine emits that we don't recognise gets an honest,
      // title-cased label rather than silently collapsing to "Running".
      return { label: s ? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Unknown", tone: "gray", parked: false, terminal: false, active: false };
  }
}
function mapStepStatus(s: string): RunStep["status"] {
  if (s === "succeeded") return "done";
  if (s === "running") return "running";
  // WP-004: none of these are a success — a denied/expired approval gate never ran,
  // a policy-clamped step never ran, a toolless step that claimed to send/email/notify
  // never delivered, and an approval window that closed unattended sent nothing. The
  // RunStep type has no dedicated literal for each, so all three share "skipped" —
  // but `detail` (set distinctly server-side for each case) still names exactly what
  // happened, so the caveat is never lost, only bucketed.
  if (s === "skipped" || s === "skipped_no_tool" || s === "expired") return "skipped";
  if (s === "waiting_for_approval" || s === "blocked" || s === "failed") return "blocked";
  return "pending";
}
// WP-101 (sibling slice): partially_failed is terminal — omitting it here means the
// poller never breaks on a run that's actually done, and it polls forever. Exported so
// every poller (ExecutionMonitor, the chat run-watcher) stops on the SAME set.
export const TERMINAL_RUN = ["completed", "failed", "cancelled", "expired", "partially_failed"];
const PARKED_RUN = ["waiting_for_approval", "waiting_for_connector", "waiting_for_provider"];
// Renders a tool's resolved input into a human-readable preview instead of the generic
// "Draft prepared by your helper agent…" boilerplate — this is the actual, real content
// (which messages, what label, the literal draft text) the human is being asked to
// approve, not a description OF a description. A long comma-joined id list (e.g. 93
// message ids) collapses to a count — the ids themselves aren't meaningful to a human.
export function formatApprovalInput(input: Record<string, unknown> | undefined | null): string {
  if (!input) return "";
  const lines: string[] = [];
  for (const [key, raw] of Object.entries(input)) {
    if (raw == null || raw === "") continue;
    let display: string;
    if (Array.isArray(raw)) {
      display = raw.length > 4 ? `${raw.length} item(s)` : raw.join(", ");
    } else if (typeof raw === "string" && raw.includes(",") && raw.split(",").length > 4) {
      display = `${raw.split(",").filter(Boolean).length} item(s)`;
    } else if (typeof raw === "object") {
      display = JSON.stringify(raw);
    } else {
      display = String(raw);
    }
    const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
    lines.push(`${label}: ${display}`);
  }
  return lines.join("\n");
}
export function runFromServer(sr: ServerRun, ctx: { agentId: string; label?: string; startedAt: string }): HelperRun {
  const status = mapRunStatus(sr.status);
  const ran = sr.steps.filter((s) => s.status === "succeeded").length;
  // A connector/provider wait has no approval to act on — say so plainly rather than
  // telling the user to "approve the gated step" (there's nothing to approve).
  const waitingSummary = sr.status === "waiting_for_connector" || sr.status === "waiting_for_provider"
    ? "Paused — connect the required service to continue."
    : "Paused — approve the gated step to finish.";
  // WP-004: "expired" collapses into the "Failed" bucket (RunStatus has no dedicated
  // literal for it), but it means something distinct — the approval window closed
  // before anyone decided, so nothing was sent. Say that plainly instead of the
  // generic "some couldn't complete" failure copy.
  const outputSummary = status === "Waiting for Approval"
    ? waitingSummary
    : sr.status === "expired"
      ? "Expired — nothing was sent. Review in Inbox."
      // WP-101 (sibling slice): required steps succeeded, at least one optional step
      // didn't — say so plainly rather than either "Completed" (a lie) or the full
      // "Failed" copy (also wrong: nothing REQUIRED failed here). Per-step optionality
      // isn't in the payload yet, so this can't name which step — just the honest
      // run-level shape.
      : status === "Partly Done"
        ? `Completed ${ran} step(s); an optional step didn't finish — see details.`
        : status === "Failed"
          ? `${ran} step(s) ran; some couldn't complete — see details.`
          : status === "Completed"
            ? `Completed ${ran} live action(s).`
            : "Running…";
  return {
    id: sr.id,
    agentId: ctx.agentId,
    triggerLabel: ctx.label ?? "Live run",
    status,
    // WP-003 slice 1 — the FULL server enum rides along so every chip can render a
    // cause-specific label + CTA via runStatusView, never the collapsed `status` above.
    serverStatus: sr.status,
    startedAt: sr.startedAt ? new Date(sr.startedAt).toISOString() : ctx.startedAt,
    completedAt: sr.finishedAt ? new Date(sr.finishedAt).toISOString() : undefined,
    inputSummary: sr.summary || sr.title || "Plan",
    outputSummary,
    actionsTaken: sr.steps.filter((s) => s.status === "succeeded").map((s) => s.title),
    steps: sr.steps.map((s) => ({
      label: s.title,
      status: mapStepStatus(s.status),
      detail: s.detail || s.toolCalls?.[s.toolCalls.length - 1]?.resultSummary || "",
      timestamp: s.finishedAt ? new Date(s.finishedAt).toISOString() : undefined,
    })),
    approvalRequestIds: [],
    activityEntryIds: [],
    error: sr.error ?? undefined,
  };
}

/**
 * WP-003 slice 2 — ONE HISTORY. Render a server run directly for LISTING surfaces
 * without going through the
 * local `data.runs` write-mirror — that mirror only ever contains runs THIS session
 * started/synced (runPlan/syncServerRun), never every run in the household, so it was
 * never a truthful listing source. Both screens call this over GET /api/runs, so the
 * SAME run renders IDENTICAL status text everywhere it appears.
 */
export function runViewFromServer(sr: ServerRun): HelperRun {
  const ref = sr.sourceRef ?? {};
  const agentId = typeof ref.agentId === "string" ? ref.agentId : "";
  const startedAtMs = sr.startedAt ?? sr.createdAt;
  return runFromServer(sr, {
    agentId,
    label: sr.title || sr.summary || undefined,
    startedAt: startedAtMs ? new Date(startedAtMs).toISOString() : new Date().toISOString(),
  });
}

/**
 * WP-003 slice 2 — shared server-truth run listing. Fetches GET /api/runs (optionally
 * scoped to one helper),
 * maps every row through runViewFromServer, and — matching the existing degraded-mode
 * pattern used elsewhere (Dashboard "backend offline" banners) — keeps the last
 * successful fetch on screen with `stale` set true rather than flashing an empty list
 * the moment the backend blips. `backend.runs()` itself swallows network errors into an
 * empty array, so an empty result is only trusted once the backend is confirmed online.
 */
export function useServerRuns(filter?: { agentId?: string }): { runs: HelperRun[]; loading: boolean; stale: boolean; fetchedAt: number | null; refresh: () => void } {
  const backendOnline = useStore((s) => s.backendOnline);
  const [runs, setRuns] = useState<HelperRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const agentId = filter?.agentId;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const q = agentId ? `?agentId=${encodeURIComponent(agentId)}&limit=100` : `?limit=100`;
    void backend.runs(q).then((list) => {
      if (!alive) return;
      if (list.length > 0 || useStore.getState().backendOnline) {
        setRuns(list.map(runViewFromServer));
        setFetchedAt(Date.now());
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [agentId, nonce]);
  return { runs, loading, stale: !backendOnline, fetchedAt, refresh: () => setNonce((n) => n + 1) };
}

/**
 * WP-003 slice 5 — recents hygiene. True when every assistant reply this conversation
 * ever got was an honest error (no AI provider, unreachable, etc.) — nothing was ever
 * answered, planned, or built. Recents (AssistantHome) labels these distinctly and
 * collapses repeats down to the single most recent one instead of piling up a fresh
 * "New chat" row per failed attempt.
 */
export function isErrorOnlyThread(c: AssistantConversation): boolean {
  const assistantMsgs = c.messages.filter((m) => m.role === "assistant");
  return assistantMsgs.length > 0 && assistantMsgs.every((m) => m.status === "error");
}

/** Role authority ranks (frontend mirror of the backend), highest first. */
const ROLE_RANK: Record<Role, number> = {
  Owner: 6, "Adult Admin": 5, "Adult Member": 4, "Limited Member": 3, "Child View": 2, "Guest/Helper": 1,
};
export function roleAtLeast(role: Role | undefined, min: Role): boolean {
  return (ROLE_RANK[role ?? "Guest/Helper"] ?? 0) >= ROLE_RANK[min];
}
/** Minimum role required to open a screen. Unlisted screens are open to all. */
const SCREEN_MIN_ROLE: Partial<Record<ScreenId, Role>> = {
  settings: "Adult Admin",
  connections: "Adult Admin",
  activity: "Adult Member",
};
export function screenAllowedForRole(screen: ScreenId, role: Role | undefined): boolean {
  const min = SCREEN_MIN_ROLE[screen];
  return !min || roleAtLeast(role, min);
}
/** Scoped view modes see a trimmed surface. Role rank alone can't express this (a
 * sitter ranks below a child but needs MORE screens), so the capability matrix wins:
 * child → Home + Calendar (+ Ask only when an adult enabled AI); grandparent → Home,
 * Ask, Calendar; sitter → those plus Connections (they may connect their own calendar).
 * Adults keep the role-rank rules above. */
const SCOPED_SCREENS: Record<string, ScreenId[]> = {
  child: ["dashboard", "calendar"],
  grandparent: ["dashboard", "assistant", "calendar"],
  sitter: ["dashboard", "assistant", "calendar", "connections"],
};
export function screenAllowedForMember(screen: ScreenId, member: { role?: string | null; relationship?: string | null; aiEnabled?: boolean | null }, role: Role | undefined): boolean {
  const caps = capabilitiesFor(member);
  const scoped = SCOPED_SCREENS[caps.viewMode];
  if (!scoped) return screenAllowedForRole(screen, role);
  if (screen === "assistant") return caps.canUseAI; // child needs adult-granted AI; gp/sitter always may ask
  return scoped.includes(screen);
}

/** Households seeded entirely on this device (buildEmptyData / buildSeedData — see
 * src/data/seed.ts) always use the fixed ids "hh-local" / "hh-harper", regardless of
 * whether they were later successfully registered with a server. loginAs uses this to
 * recognize "this household may simply not be known to THIS server" and fall back to a
 * client-only session (T-03) instead of hard-failing — a sample or freshly-created
 * household should never dead-end on a stranger's Lock screen just because the backend
 * it's talking to already belongs to someone else. */
function isLocalOnlyHousehold(d: AppData): boolean {
  return d.household.id === "hh-local" || d.household.id === "hh-harper";
}

/** Map a connector display name / alias to its backend connector id. */
// IDs here MUST match real backend connector/provider ids (server/connectors.mjs,
// server/providers.mjs) — a fictional id (the previous "gmail"/"gcal" split) silently
// matches nothing, so connectionIds/allowedToolIds derived from it end up empty even
// though the alias logic "succeeded". Gmail, Calendar, and Drive are all scopes of the
// single "google" provider, not separate connectors.
const CONNECTOR_ALIASES: { id: string; aliases: string[] }[] = [
  { id: "google", aliases: ["gmail", "email", "calendar", "google calendar", "drive", "google"] },
  { id: "weather", aliases: ["weather"] },
  { id: "rss", aliases: ["rss", "feed", "podcast", "blog"] },
  { id: "http", aliases: ["http", "custom api", "api"] },
  { id: "webhook", aliases: ["webhook"] },
  { id: "files-local", aliases: ["local files", "file", "drive", "storage", "csv", "budget", "import"] },
  { id: "browser", aliases: ["browser"] },
  { id: "sms", aliases: ["text", "sms", "message"] },
  { id: "microsoft", aliases: ["microsoft", "outlook", "onedrive"] },
  { id: "slack", aliases: ["slack"] },
  { id: "dropbox", aliases: ["dropbox"] },
  { id: "notion", aliases: ["notion"] },
  { id: "todoist", aliases: ["todoist"] },
  { id: "ticktick", aliases: ["ticktick"] },
];
function connectorIdsForNames(names: string[]): string[] {
  const ids = new Set<string>();
  for (const n of names) {
    const low = n.toLowerCase();
    const hit = CONNECTOR_ALIASES.find((c) => c.aliases.some((a) => low.includes(a)));
    if (hit) ids.add(hit.id);
  }
  return [...ids];
}
// Intelligent tool preselection: an agent created from a template or a plain-English
// goal should already be allowed to use the real tools its chosen connectors expose —
// without this, allowedToolIds ships empty and the agent can't do anything until a
// human manually re-checks every tool by hand in the builder.
function toolIdsForConnectorIds(connectorIds: string[], connectors: BackendConnector[], providers: ConnectorProvider[]): string[] {
  const ids = new Set<string>();
  for (const cid of connectorIds) {
    connectors.find((c) => c.id === cid)?.tools.forEach((t) => ids.add(t.id));
    providers.find((p) => p.id === cid)?.tools.forEach((t) => ids.add(t.id));
  }
  return [...ids];
}
// Reverse of the above: given real tool ids (e.g. from a server agent's allow-list),
// resolve which connector/provider each belongs to — so a hydrated server agent shows
// its connections in the UI instead of an empty chip row.
function connectorIdsForToolIds(toolIds: string[], connectors: BackendConnector[], providers: ConnectorProvider[]): string[] {
  const ids = new Set<string>();
  for (const tid of toolIds) {
    const c = connectors.find((x) => x.tools.some((t) => t.id === tid));
    if (c) { ids.add(c.id); continue; }
    const p = providers.find((x) => x.tools.some((t) => t.id === tid));
    if (p) ids.add(p.id);
  }
  return [...ids];
}
// Merge the household's helpers into the local display mirror (`data.agents`).
//
// A helper is the server's record; this mirror exists only so surfaces that name a helper
// by id — Messages, Spaces, Files, Activity, search — can resolve a name and an icon
// without a round-trip each. Nothing is authored here, so the merge is server-wins and a
// helper deleted upstream disappears rather than lingering as an un-openable ghost.
function mergeHelpersIntoAgents(d: AppData, helpers: PublicHelper[], opts: { actorId?: string }) {
  const serverIds = new Set(helpers.map((h) => h.id));
  d.agents = d.agents.filter((a) => !a.serverId || serverIds.has(a.serverId));
  for (const h of helpers) {
    const local = d.agents.find((a) => a.id === h.id || a.serverId === h.id);
    if (local) {
      local.serverId = h.id;
      local.name = h.name;
      local.icon = h.icon || local.icon;
      local.purpose = h.purpose;
      local.instructions = h.instructions;
      local.status = h.status;
      local.updatedAt = h.updatedAt;
    } else {
      d.agents.unshift({
        id: h.id, serverId: h.id, name: h.name, icon: h.icon || "Bot", purpose: h.purpose,
        status: h.status, spaceId: d.spaces.find((sp) => sp.id === "sp-family")?.id ?? d.spaces[0]?.id ?? "sp-family",
        ownerMemberId: h.createdBy ?? opts.actorId ?? d.members.find((m) => m.isCurrentUser)?.id ?? d.members[0]?.id ?? "",
        instructions: h.instructions,
        connectionIds: [], allowedToolIds: [], memoryIds: [], knowledgeItemIds: [], fileIds: [],
        approvalPolicy: { autoAllow: [], alwaysApprove: [] },
        safetyLimits: [],
        createdAt: h.updatedAt, updatedAt: h.updatedAt,
      });
    }
  }
}

export interface Toast {
  id: string;
  kind: "success" | "info" | "error" | "warn";
  title: string;
  message?: string;
}

interface UIState {
  route: Route;
  ready: boolean;
  storageMode: StorageMode;
  storageError?: string;
  commandOpen: boolean;
  spaceFilter: string; // "all" | spaceId
  toasts: Toast[];
  session: Session | null;     // backend/persona session (who is acting + role)
  needsOnboarding: boolean;    // true on a fresh, no-data first run
  authBusy: boolean;
  // T-03: true when `session` is a client-only session — the server never confirmed
  // this actor (sample data, a locally-created household, or the backend was simply
  // unreachable at sign-in). loginAs mints this instead of hard-failing so a sample or
  // not-yet-registered household never dead-ends on someone else's Lock screen. Server-
  // only features keep degrading honestly through their own typed-error paths.
  isLocalSession: boolean;
}

export interface Store extends UIState {
  data: AppData;

  /* lifecycle */
  init: () => Promise<void>;
  reseed: () => Promise<void>;
  startFresh: () => Promise<void>;   // wipe local data + sign out → first-run onboarding
  importData: (data: AppData) => void;
  saveNow: () => Promise<void>;

  /* onboarding + session */
  completeOnboarding: (choice: "sample" | "blank" | "import", opts?: { householdName?: string; ownerName?: string; data?: AppData }) => Promise<void>;
  bootstrapSession: () => Promise<void>;
  // WP-010: `householdHint` (an hh_* id) enters a signed-up household's own member from the
  // session-scoped picker. Returns "password_required" when that member authenticates by
  // email+password — the Lock screen then reveals the login form (no passwordless escalation).
  loginAs: (memberId: string, pin?: string, fallback?: { displayName: string; role: string }, householdHint?: string) => Promise<boolean | "password_required">;
  logout: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<boolean>;
  signupHousehold: (input: { email: string; password: string; ownerName: string; householdName?: string; inviteToken?: string; resetLocalData?: boolean }) => Promise<boolean>;
  currentRole: () => Role;
  canAccess: (screen: ScreenId) => boolean;
  // T-02: a single source of truth for "server-backed features are known to be
  // unavailable right now" — the backend is unreachable, or this session is local-only
  // (see isLocalSession above). Drives the global degraded-mode banner.
  isDegraded: () => boolean;
  degradedMessage: () => string | null;

  /* navigation + UI */
  navigate: (screen: ScreenId, params?: Record<string, string>) => void;
  /* ISS-115 — local back. The router was flat: navigate() replaced `route` and kept no
   * history at all, so there was no "parent" to return to and the browser's Back button
   * left the app entirely ("back exits the whole section"). The stack records where you
   * came from AND how far you'd scrolled, so returning lands you where you actually were.
   * Shell reports/consumes the scroll offset, keeping the DOM out of the store. */
  routeStack: { route: Route; scrollTop: number }[];
  currentScrollTop: number;
  restoreScrollTop: number | null;
  setScrollTop: (n: number) => void;
  consumeScrollRestore: () => void;
  goBack: () => void;
  setCommandOpen: (open: boolean) => void;
  setSpaceFilter: (id: string) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  /* derived */
  currentMember: () => Member;
  searchEverything: (q: string) => SearchResult[];

  /* helpers — the server owns them; this is the shared read of GET /api/helpers so the
   * Helpers screen and every surface that merely NAMES one stay in step. */
  helpers: PublicHelper[];
  refreshHelpers: () => Promise<PublicHelper[]>;

  /* mini-app generator (plain English → a real mini app) */
  generateMiniAppFromGoal: (input: { goal: string; type?: string }) => Promise<{ ok: boolean; app?: GeneratedMiniApp; error?: string; message?: string }>;
  runPlan: (plan: RunnablePlan, opts?: { agentId?: string; label?: string }) => Promise<string>;
  /** Poll a durable SERVER run to terminal/parked and mirror it into local state. */
  syncServerRun: (runId: string) => Promise<void>;
  // Assistant — the conversational NL → answer/build (+ approval-gated runs) → history loop.
  startConversation: (text: string, opts?: { visibility?: "household" | "personal" }) => Promise<string>;
  sendToAssistant: (conversationId: string, text: string, extraContext?: Record<string, unknown>) => Promise<void>;
  runConversationPlan: (conversationId: string, messageId: string) => Promise<void>;
  deleteConversation: (id: string) => void;

  /* connectors (real backend infrastructure) */
  connectors: BackendConnector[];
  providers: ConnectorProvider[];      // first-party OAuth provider platform
  accounts: ConnectedAccount[];        // current actor's connected accounts
  backendHealth: BackendHealth | null;
  backendOnline: boolean;
  externalActionsEnabled: boolean;
  loadBackend: () => Promise<void>;
  hydrateFromServer: () => Promise<void>;

  /* WP-001: server-truth approvals + notifications feed. Messages » Inbox/Approvals,
   * the nav badge, and the Dashboard "Needs you" card all read THESE — never the local
   * `data.approvals` mirror, which only fills in when this session actively polled a run
   * it started (see syncServerRun above). Refreshed by the existing hydrate/poll loop;
   * also refreshed on-demand (tab mount, right after a decide/mark-read). */
  serverApprovals: BackendApproval[];
  serverNotifications: ServerNotification[];
  refreshApprovalsAndNotifications: () => Promise<void>;
  decideServerApproval: (id: string, approve: boolean) => Promise<boolean>;
  markServerNotificationRead: (id: string) => Promise<boolean>;
  migrateContactMethodsToServer: () => Promise<void>;
  configureConnector: (id: string, values: Record<string, string>) => Promise<void>;
  revokeConnector: (id: string) => Promise<void>;
  checkConnectorHealth: (id: string) => Promise<{ ok: boolean; status?: string; latencyMs?: number; error?: string }>;
  startConnectorAuth: (id: string) => Promise<void>;
  connectProvider: (providerId: string) => Promise<void>;     // one-click OAuth → per-user account
  revokeAccount: (accountId: string) => Promise<void>;
  checkAccountHealth: (accountId: string) => Promise<void>;
  runTool: (toolId: string, input?: Record<string, unknown>, opts?: { agentId?: string; label?: string; approvalId?: string; accountId?: string; quiet?: boolean }) => Promise<ExecResult>;
  sendWebhookTest: (payload: Record<string, unknown>) => Promise<void>;
  setKillSwitch: (enabled: boolean) => Promise<void>;

  /* messages + approvals */
  sendMessage: (threadId: string, body: string) => void;
  createThread: (input: Partial<MessageThread> & { title: string }) => string;
  resolveThread: (id: string) => void;
  escalateThread: (id: string) => void;
  reopenThread: (id: string) => void;
  markThreadRead: (id: string) => void;
  addContactMethod: (memberId: string, input: Partial<ContactMethod> & { label: string; value: string }) => Promise<void>;
  /** Send a 6-digit verification code through the method's real channel. */
  sendContactVerification: (id: string) => Promise<{ ok: boolean; needsSetup?: string; message?: string }>;
  /** Enter the delivered code — proves control of the address → verified + opted-in. */
  confirmContactVerification: (id: string, code: string) => Promise<{ ok: boolean; message?: string }>;
  /** Adult-only manual override (server-enforced); the code loop is the honest path. */
  verifyContactMethod: (id: string) => Promise<void>;
  setContactAllowedAgents: (id: string, agentIds: string[]) => Promise<void>;
  approveRequest: (id: string, newPreview?: string) => Promise<void>;
  denyRequest: (id: string) => Promise<void>;
  askAgentForChanges: (id: string, note: string) => Promise<void>;
  /** Local projection of an approval that ALREADY exists server-side (runTool /
   *  syncServerRun pass its backendApprovalId). Never call this for a brand-new ask —
   *  the Approvals console reads server truth, so a local-only record is invisible to
   *  everyone who could decide it. Use requestServerApproval for that. */
  requestApproval: (input: ApprovalRequestInput) => string;
  /** Create the approval on the server first, mirror it locally only on success; a
   *  refusal is toasted with the reason and nothing is minted. Resolves the local id. */
  requestServerApproval: (input: ApprovalRequestInput & { toolId: string }) => Promise<string | null>;

  /* files + knowledge */
  uploadFiles: (files: File[], spaceId?: string) => Promise<string[]>;
  uploadIdCard: (front: File, back: File, name?: string, spaceId?: string) => Promise<string | null>;
  addSampleFile: (input: Partial<FileAsset> & { name: string }) => string;
  updateFile: (id: string, patch: Partial<FileAsset>) => void;
  deleteFile: (id: string) => void;
  toggleFileSensitive: (id: string) => void;
  processFileById: (id: string) => void;
  createKnowledgeItem: (input: Partial<KnowledgeItem> & { title: string }) => string;
  updateKnowledgeItem: (id: string, patch: Partial<KnowledgeItem>) => void;
  deleteKnowledgeItem: (id: string) => void;

  /* memory */
  createMemory: (input: Partial<MemoryEntry> & { title: string; content: string }) => string;
  updateMemory: (id: string, patch: Partial<MemoryEntry>) => void;
  deleteMemory: (id: string) => void;
  approveMemory: (id: string) => void;
  toggleMemorySensitive: (id: string) => void;

  /* mini apps */
  updateMiniAppData: (id: string, data: Record<string, unknown>) => void;
  createMiniApp: (input: Partial<MiniApp> & { name: string; type: MiniApp["type"] }) => string;
  archiveMiniApp: (id: string) => void;
  deleteMiniApp: (id: string) => void;
  duplicateMiniApp: (id: string) => string;

  /* tasks + events */
  createTask: (input: Partial<Task> & { title: string }) => string;
  updateTask: (id: string, patch: Partial<Task>) => void;
  setTaskStatus: (id: string, status: TaskStatus) => void;
  deleteTask: (id: string) => void;
  moveEvent: (id: string, newStartISO: string) => void;
  createEvent: (input: Partial<CalendarEvent> & { title: string; startAt: string }) => string;

  /* spaces + members */
  createSpace: (input: Partial<Space> & { name: string; type: Space["type"] }) => string;
  updateSpace: (id: string, patch: Partial<Space>) => void;
  deleteSpace: (id: string) => void;
  updateMember: (id: string, patch: Partial<Member>) => void;
  createMember: (input: Partial<Member> & { displayName: string }) => string;
  deleteMember: (id: string) => void;
  toggleSpaceMember: (spaceId: string, memberId: string) => void;

  /* settings */
  updateSettings: (patch: Partial<AppSettings>) => void;
  setActiveProvider: (id: AppSettings["ai"]["activeProvider"]) => void;
}

export interface ApprovalRequestInput {
  title: string;
  proposedAction: string;
  riskLevel?: ApprovalRequest["riskLevel"];
  category?: ApprovalRequest["category"];
  agentId?: string;
  spaceId?: string;
  dataUsedSummary?: string;
  recipientSummary?: string;
  previewContent?: string;
  description?: string;
  toolId?: string;
  toolInput?: Record<string, unknown>;
  connectorId?: string;
  backendApprovalId?: string;
}

/** One honest sentence for a refused/unreachable server write, shared by every
 *  optimistic mutation that rolls back (tasks, events, approvals). */
function refusalMessage(error: string | undefined, fallback = "The server refused it — nothing was saved."): string {
  if (error === "insufficient_role") return "Your role can't make this change.";
  if (error === "authentication_required") return "Sign in to make this change.";
  if (error === "backend_unreachable") return "Couldn't reach the server — nothing was saved.";
  return fallback;
}

/* --------------------------- persistence plumbing --------------------------- */

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(data: AppData, onError: (msg: string) => void) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveAppData(data).catch((e) => onError(e instanceof Error ? e.message : "Save failed."));
  }, 400);
}

function nowISO() {
  return new Date().toISOString();
}

export const useStore = create<Store>((set, get) => {
  /** Clone data, mutate, set, and schedule a debounced save. */
  const commit = (fn: (d: AppData) => void) => {
    set((s) => {
      const d: AppData = structuredClone(s.data);
      fn(d);
      return { data: d } as Partial<Store>;
    });
    scheduleSave(get().data, (msg) => set({ storageError: msg }));
  };

  const findSpaceByType = (d: AppData, type: Space["type"]): Space | undefined =>
    d.spaces.find((s) => s.type === type);

  const toast = (t: Omit<Toast, "id">) => {
    const id = uid("toast");
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
  };

  /** Mint a client-only session (T-03) — used whenever the backend won't confirm a
   * server actor for a household that's local-only anyway (sample/unregistered) or the
   * backend is simply unreachable. Never claims server capabilities: connectors,
   * approvals, and AI providers still gate through their own real typed-error paths
   * (loadBackend/hydrateFromServer run normally and report whatever the server says). */
  const establishLocalSession = (m: { id: string; displayName: string; role: string }, memberId: string, message: string, opts?: { toastTitle?: string }) => {
    const session: Session = { actorId: m.id, actorName: m.displayName, role: m.role, csrf: "", householdId: "local" };
    commit((d) => d.members.forEach((x) => (x.isCurrentUser = x.id === memberId)));
    set({ session, authBusy: false, isLocalSession: true });
    toast({ kind: "warn", title: opts?.toastTitle ?? "Signed in locally", message });
    void get().loadBackend();
    return true;
  };

  return {
    /* ----- initial UI state (data replaced on init) ----- */
    data: buildSeedData(),
    route: { screen: "dashboard" },
    routeStack: [],
    currentScrollTop: 0,
    restoreScrollTop: null,
    ready: false,
    storageMode: "indexeddb",
    commandOpen: false,
    spaceFilter: "all",
    toasts: [],
    session: null,
    needsOnboarding: false,
    authBusy: false,
    isLocalSession: false,

    /* ----------------------------- lifecycle ----------------------------- */
    init: async () => {
      const mode = await detectStorageMode();
      const data = await loadAppData();
      const storageError = mode === "unavailable" ? "Browser storage is unavailable — changes will not be saved." : undefined;
      if (!data) {
        // An empty local store does NOT mean "new user". A returning browser — cleared
        // site data, a fresh profile, another device — can still hold a valid session,
        // and the server may already host this family's claimed household. Try to come
        // BACK before offering to create anything: the old early-return skipped
        // bootstrapSession entirely, so clearing storage stranded the owner on
        // onboarding with no route to the Lock screen, and "Create household" would
        // have minted a SECOND tenant beside their real one.
        set({ ready: true, storageMode: mode, storageError });
        await get().bootstrapSession();
        const returning = !!get().session || !!(await backend.profiles().catch(() => null))?.claimed;
        if (returning) {
          // Never leave the Harper SAMPLE (this store's default `data`) standing in for a
          // real household — it has no serverIds, so hydrate would blend it into their
          // data. A clean base; the server hydrate fills in the real household.
          set({ data: buildEmptyData("My Household", get().session?.actorName ?? "You"), needsOnboarding: false });
        } else {
          set({ needsOnboarding: true }); // genuine first run → real onboarding
        }
        return;
      }
      set({ data, ready: true, storageMode: mode, needsOnboarding: false, storageError });
      // Restore any existing backend session; if present, load connector infra.
      await get().bootstrapSession();
    },
    completeOnboarding: async (choice, opts) => {
      const data =
        choice === "sample" ? buildSeedData()
        : choice === "import" && opts?.data ? opts.data
        : buildEmptyData(opts?.householdName ?? "My Household", opts?.ownerName ?? "You");
      await saveAppData(data).catch(() => {});
      set({ data, needsOnboarding: false });
      const owner = data.members.find((m) => m.isCurrentUser) ?? data.members[0];
      if (choice !== "sample" && owner) {
        // Roles are server-owned: register the new owner with the backend, or the
        // profile can never open a server session and every server-backed screen
        // (Connections, AI providers, approvals) silently fails.
        const claim = await backend.claimHousehold({ ownerName: owner.displayName, actorId: owner.id });
        if (claim.session) {
          const s = claim.session;
          commit((d) => d.members.forEach((x) => (x.isCurrentUser = x.id === s.actorId)));
          set({ session: s });
          void get().loadBackend();
          // Default a brand-new household to this browser's timezone so "every day at
          // 7 AM" triggers anchor correctly from day one, instead of silently falling
          // back to the server's clock. Adult Admin/Owner can change it in Settings.
          void backend.setSettings({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
        } else if (claim.error === "already_claimed") {
          // The backend may already know this exact owner (e.g. re-running onboarding
          // after a claim) — a normal login settles it before we bother the user.
          const ok = await get().loginAs(owner.id);
          if (!ok) toast({ kind: "error", title: "Backend already has a household", message: claim.message ?? "Sign in as its Owner and add this profile in Settings, or reset the server data." });
        } else if (claim.error) {
          toast({ kind: "warn", title: "Backend not registered", message: "The backend is unreachable — server features (connections, AI providers, approvals) stay locked until this profile is registered." });
        }
      } else if (owner) {
        await get().loginAs(owner.id);
      }
      toast({ kind: "success", title: choice === "sample" ? "Sample household loaded" : choice === "import" ? "Backup restored" : "Household created", message: data.household.name });
    },
    bootstrapSession: async () => {
      const s = await backend.session();
      if (s) {
        // A cookie-backed session always came from the server — never a local fallback.
        set({ session: s, isLocalSession: false });
        // align the active persona with the authenticated session actor
        commit((d) => { if (d.members.some((m) => m.id === s.actorId)) d.members.forEach((m) => (m.isCurrentUser = m.id === s.actorId)); });
        void get().loadBackend();
      } else {
        set({ session: null });
      }
    },
    loginAs: async (memberId, pin, fallback, householdHint) => {
      // Server-registered profiles (e.g. the claimed owner, mobile-created invites)
      // may not exist in the local store yet — the Lock screen passes their server
      // profile so sign-in works before the first hydrate.
      const m = get().data.members.find((x) => x.id === memberId)
        ?? (fallback ? { id: memberId, displayName: fallback.displayName, role: fallback.role as Role } : undefined);
      if (!m) return false;
      set({ authBusy: true });
      const r = await backend.login({ actorId: m.id, actorName: m.displayName, role: m.role, pin, ...(householdHint ? { household: householdHint } : {}) });
      // WP-010: this member of a signed-up household signs in with their own email +
      // password — the picker can't enter their profile passwordlessly. Signal the Lock
      // screen to reveal the login form; never a fake local session.
      if (r.error === "password_required") { set({ authBusy: false, session: null }); return "password_required"; }
      // Explicit server rejections are surfaced, never papered over with a fake
      // local session (that's how "signed in but every page is broken" happens).
      if (r.error === "pin_required") { set({ authBusy: false, session: null }); toast({ kind: "error", title: "PIN required", message: "Enter the owner PIN to sign in as an admin." }); return false; }
      if (r.error === "unknown_actor" && get().data.household.ownerMemberId === m.id) {
        // Self-heal: this is the local household's owner but the backend still has
        // only the demo roster (created before the claim flow existed). Claim it.
        const claim = await backend.claimHousehold({ ownerName: m.displayName, actorId: m.id });
        if (claim.session) {
          const s = claim.session;
          commit((d) => d.members.forEach((x) => (x.isCurrentUser = x.id === s.actorId)));
          set({ session: s, authBusy: false, isLocalSession: false });
          toast({ kind: "success", title: "Household registered with the backend", message: "Your profile now owns the server household — connections and AI providers are unlocked." });
          void get().loadBackend();
          return true;
        }
        // Claim failed (most commonly: this server already has a different household)
        // — fall through to the local-session fallback below instead of hard-failing.
      }
      if (r.error === "unknown_actor" || r.error === "member_archived") {
        // T-03: a sample or locally-created household simply may not exist on THIS
        // server (never claimed, or claimed by someone else) — keep the profile usable
        // on this device rather than stranding it behind a stranger's roster.
        // `member_archived` is included: claiming a server ARCHIVES the demo roster in
        // the server registry, so on a claimed server the sample members answer
        // "archived" rather than "unknown" — but the server's verdict about its own
        // old demo roster has no authority over this device's local-only household.
        if (isLocalOnlyHousehold(get().data)) {
          return establishLocalSession(m, memberId, "This profile isn't registered with this server — you're using it locally on this device only. Register it (Settings) or connect a different server to unlock connections, AI providers, and approvals.");
        }
        set({ authBusy: false, session: null });
        toast({ kind: "error", title: r.error === "member_archived" ? "Profile removed" : "Profile not registered with the backend", message: r.message ?? "Ask an Owner to add this profile in Settings → Household." });
        return false;
      }
      if (!r.session) {
        // Local-first fallback ONLY when the backend is unreachable (offline dev):
        // establish a local persona so role-gated UI works; server mutations stay
        // gated server-side and server-backed screens will show their offline states.
        return establishLocalSession(m, memberId, "The FamiliOS server isn't reachable — signed in locally on this device only. Connections, AI providers, and approvals stay unavailable until it's back.", { toastTitle: "Backend offline" });
      }
      commit((d) => d.members.forEach((x) => (x.isCurrentUser = x.id === memberId)));
      set({ session: r.session, authBusy: false, isLocalSession: false });
      void get().loadBackend();
      return true;
    },
    logout: async () => {
      await backend.logout();
      set({ session: null, isLocalSession: false });
      toast({ kind: "info", title: "Signed out", message: "Pick a profile to continue." });
    },
    // C1.4 self-serve identity: email sign-in / household creation. On success the
    // server session carries the (possibly brand-new) householdId and every API
    // call is scoped to THAT household — the server roster becomes the truth on
    // the next hydrate.
    loginWithEmail: async (email: string, password: string) => {
      set({ authBusy: true });
      const r = await backend.loginEmail(email, password);
      if (!r.session) {
        set({ authBusy: false, session: null });
        toast({ kind: "error", title: "Sign-in failed", message: r.error === "invalid_credentials" ? "Wrong email or password." : r.message ?? "The backend is unreachable." });
        return false;
      }
      set({ session: r.session, authBusy: false, needsOnboarding: false, isLocalSession: false });
      void get().loadBackend();
      void get().hydrateFromServer();
      return true;
    },
    signupHousehold: async (input: { email: string; password: string; ownerName: string; householdName?: string; inviteToken?: string; resetLocalData?: boolean }) => {
      // T-03: "Create household" on an already-claimed server routes here instead of
      // the local-claim path (which would orphan the new household behind a stranger's
      // roster). This browser's prior local data (sample content, a previous local-only
      // household) isn't this new server household's — start it from a clean template so
      // the post-signup hydrate doesn't leave stale local helpers lying around.
      if (input.resetLocalData) set({ data: buildEmptyData(input.householdName ?? "My Household", input.ownerName) });
      set({ authBusy: true });
      const r = await backend.signup(input);
      if (!r.session) {
        set({ authBusy: false, session: null });
        const msg = r.error === "email_taken" ? "That email already has an account — sign in instead."
          : r.error === "invalid_invite" ? "That invite code is invalid, used, or expired."
          : r.error === "weak_password" ? "Use a password of at least 8 characters."
          : r.message ?? "The backend is unreachable.";
        toast({ kind: "error", title: "Couldn't create the account", message: msg });
        return false;
      }
      set({ session: r.session, authBusy: false, needsOnboarding: false, isLocalSession: false });
      toast({ kind: "success", title: input.inviteToken ? "Welcome to the household!" : "Your household is ready", message: input.inviteToken ? "You've joined — everything the family shares is here." : "You're the Owner. Invite your family from Settings whenever you're ready." });
      void get().loadBackend();
      void get().hydrateFromServer();
      // Default a brand-new household to this browser's timezone (see completeOnboarding
      // for the same reasoning) — skip when JOINING an existing household via invite,
      // since that household may already have one set.
      if (!input.inviteToken) void backend.setSettings({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      return true;
    },
    currentRole: () => get().session?.role as Role ?? get().currentMember().role,
    canAccess: (screen) => screenAllowedForMember(screen, get().currentMember(), (get().session?.role as Role) ?? get().currentMember().role),
    isDegraded: () => !get().backendOnline || get().isLocalSession,
    degradedMessage: () => {
      if (!get().backendOnline) return "Can't reach the FamiliOS server — connections, AI providers, and approvals are unavailable until it's back.";
      if (get().isLocalSession) return "This profile isn't registered with this server — you're working locally on this device only. Connections, AI providers, and approvals stay off until it's registered.";
      return null;
    },
    reseed: async () => {
      // End any server-backed session FIRST. A live session's hydrate treats the
      // server roster as authoritative and would immediately clobber the fresh
      // sample members (the ISS-003 orphaning race: reseed on a claimed server
      // used to leave household=hh-harper but members=<server roster>, so the
      // sample owner could never sign in and the user dead-ended on Lock).
      await backend.logout().catch(() => { /* offline is fine — no session to end */ });
      set({ session: null, isLocalSession: false });
      await clearAppData();
      const data = buildSeedData();
      await saveAppData(data).catch(() => {});
      set({ data });
      const owner = data.members.find((m) => m.isCurrentUser) ?? data.members[0];
      // With no server session, loginAs on a claimed/foreign server resolves to a
      // local (on-device) session for the sample household instead of dead-ending.
      if (owner) await get().loginAs(owner.id);
      toast({ kind: "success", title: "Sample data reset", message: "The Harper household sample has been restored." });
    },
    startFresh: async () => {
      // Wipe all local household data and the session, then drop back to first-run
      // onboarding so the user can create (or import) their own household.
      await backend.logout().catch(() => {});
      await clearAppData().catch(() => {});
      set({ session: null, isLocalSession: false, needsOnboarding: true, connectors: [], providers: [], accounts: [], spaceFilter: "all", route: { screen: "dashboard" } });
    },
    importData: (data) => {
      set({ data });
      scheduleSave(data, (msg) => set({ storageError: msg }));
      toast({ kind: "success", title: "Backup imported", message: "Your household data was restored from file." });
    },
    saveNow: async () => {
      try {
        await saveAppData(get().data);
        set({ storageError: undefined });
      } catch (e) {
        set({ storageError: e instanceof Error ? e.message : "Save failed." });
      }
    },

    /* --------------------------- navigation / UI -------------------------- */
    navigate: (screen, params) => {
      set((s) => {
        // Same screen with the same params isn't a new place — don't stack a duplicate
        // that Back would then have to be pressed twice to escape.
        const same = s.route.screen === screen && JSON.stringify(s.route.params ?? {}) === JSON.stringify(params ?? {});
        if (same) return { commandOpen: false } as Partial<Store>;
        return {
          // Capped: this is a breadcrumb for getting back, not a session recording.
          routeStack: [...s.routeStack, { route: s.route, scrollTop: s.currentScrollTop }].slice(-30),
          route: { screen, params },
          commandOpen: false,
          currentScrollTop: 0,
          restoreScrollTop: null, // a forward move starts at the top
        } as Partial<Store>;
      });
    },
    setScrollTop: (n) => set({ currentScrollTop: n }),
    consumeScrollRestore: () => set({ restoreScrollTop: null }),
    goBack: () => {
      const stack = get().routeStack;
      if (stack.length === 0) return;
      const prev = stack[stack.length - 1];
      set({
        route: prev.route,
        routeStack: stack.slice(0, -1),
        // Handed to Shell, which restores it once the parent has rendered — the "restores
        // scroll" half of the criterion. Returning to the top of a long list you had
        // scrolled halfway down is its own kind of being thrown around.
        restoreScrollTop: prev.scrollTop,
        currentScrollTop: prev.scrollTop,
        commandOpen: false,
      });
    },
    setCommandOpen: (open) => set({ commandOpen: open }),
    setSpaceFilter: (id) => set({ spaceFilter: id }),
    toast,
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    /* ------------------------------- derived ------------------------------ */
    currentMember: () => {
      const d = get().data;
      return d.members.find((m) => m.isCurrentUser) ?? d.members[0];
    },
    searchEverything: (q) => search(buildSearchIndex(get().data), q),
    /* -------------------------------- helpers ------------------------------- *
     * The server is the registry. This holds one shared copy so the Helpers screen and
     * every surface that merely names a helper read the same rows, and refreshes the
     * local display mirror in the same pass. */
    helpers: [],
    refreshHelpers: async () => {
      const helpers = await backend.helpers();
      set({ helpers });
      commit((d) => mergeHelpersIntoAgents(d, helpers, { actorId: get().session?.actorId }));
      return helpers;
    },

    /* --------------------------- mini-app generator ------------------------- */
    generateMiniAppFromGoal: async ({ goal, type }) => {
      const r = await backend.generateMiniApp({ goal, type });
      if (!r.ok || !r.app) toast({ kind: "warn", title: r.error === "no_provider" ? "Connect an AI provider first" : "Couldn't generate", message: r.message ?? r.error });
      return { ok: !!(r.ok && r.app), app: r.app, error: r.error, message: r.message };
    },
    runPlan: async (plan, opts = {}) => {
      // Execution is delegated to the durable SERVER runtime — the single source of
      // truth. The browser no longer orchestrates steps; it starts a run, then
      // mirrors the server's durable trace into local state for the existing UI.
      const startedAt = nowISO();
      const agentId = opts.agentId ?? "";
      const planForServer = {
        title: plan.title,
        summary: plan.summary,
        steps: plan.steps.map((s) => ({ toolId: s.toolId ?? null, title: s.title, detail: s.detail, input: s.input ?? {} })),
      };
      const started = await backend.startRun({
        plan: planForServer,
        source: agentId ? "agent" : "manual",
        sourceRef: { agentId: agentId || undefined },
      });
      if (!started.run) {
        toast({ kind: "error", title: "Couldn't start run", message: started.error === "backend_unreachable" ? "The FamiliOS runtime isn't reachable. Start it with `npm run dev`." : started.error ?? "Run could not start." });
        return "";
      }
      const ctx = { agentId, label: opts.label, startedAt };
      commit((d) => {
        const mapped = runFromServer(started.run!, ctx);
        const i = d.runs.findIndex((r) => r.id === mapped.id);
        if (i >= 0) d.runs[i] = { ...d.runs[i], ...mapped }; else d.runs.unshift(mapped);
      });
      await get().syncServerRun(started.run.id);
      const finalRun = get().data.runs.find((r) => r.id === started.run!.id);
      const status = finalRun?.status ?? "Running";
      // ISS-116: an unattributed "Run paused for approval" landing seconds after an
      // unrelated pause toast read as cause and effect, and the user blamed the
      // control they had just touched. Runs are ASYNC — the only thing that makes one
      // toast distinguishable from another is the entity it belongs to.
      const subject =
        (agentId ? get().data.agents.find((a) => a.id === agentId)?.name : undefined)
        ?? opts.label ?? plan.title;
      const base = status === "Completed" ? "Run complete"
        : status === "Waiting for Approval" ? "Run paused for approval"
        : status === "Failed" ? "Run had problems" : "Run started";
      toast({
        kind: status === "Failed" ? "error" : status === "Waiting for Approval" ? "warn" : status === "Completed" ? "success" : "info",
        title: subject ? `${base} — ${subject}` : base,
        message: finalRun?.outputSummary,
      });
      return started.run.id;
    },
    syncServerRun: async (runId) => {
      // Poll the server run until it reaches a terminal or parked state, mirroring
      // each snapshot into the local HelperRun. When parked for approval, project
      // the server-created approval into the console so the existing UI can decide it.
      const existing = get().data.runs.find((r) => r.id === runId);
      const ctx = { agentId: existing?.agentId ?? "", label: existing?.triggerLabel, startedAt: existing?.startedAt ?? nowISO() };
      let sr: ServerRun | null = null;
      for (let i = 0; i < 240; i++) {
        sr = await backend.getRun(runId);
        if (!sr) break;
        commit((d) => {
          const mapped = runFromServer(sr!, ctx);
          const idx = d.runs.findIndex((r) => r.id === runId);
          if (idx >= 0) mapped.approvalRequestIds = d.runs[idx].approvalRequestIds;
          if (idx >= 0) d.runs[idx] = { ...d.runs[idx], ...mapped }; else d.runs.unshift(mapped);
        });
        if (TERMINAL_RUN.includes(sr.status) || PARKED_RUN.includes(sr.status)) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      if (sr && sr.status === "waiting_for_approval") {
        const gated = sr.steps[sr.cursor];
        if (gated?.approvalId && !get().data.approvals.some((a) => a.backendApprovalId === gated.approvalId)) {
          // Mirror the server-created approval into the local console as a
          // server-managed gate: the server resumes execution once decided. The preview
          // is the REAL resolved input (which messages, what label, the actual draft) —
          // not a generic description of a description.
          const inputPreview = formatApprovalInput(gated.input);
          const aprId = get().requestApproval({
            title: gated.title,
            proposedAction: gated.detail || gated.title,
            riskLevel: (gated.risk as ApprovalRequest["riskLevel"]) ?? "High",
            category: gated.connectorId === "homeops" ? "Form" : "Message",
            agentId: ctx.agentId || undefined,
            dataUsedSummary: gated.connectorName ?? "FamiliOS",
            previewContent: [gated.detail || gated.title, inputPreview].filter(Boolean).join("\n\n") || `${gated.title}\n\nApprove to let FamiliOS run this step.`,
            toolId: gated.toolId ?? undefined,
            connectorId: gated.connectorId ?? undefined,
            backendApprovalId: gated.approvalId,
          });
          commit((d) => {
            const a = d.approvals.find((x) => x.id === aprId);
            if (a) { a.serverManaged = true; a.relatedRunId = runId; }
            const run = d.runs.find((r) => r.id === runId);
            if (run && !run.approvalRequestIds.includes(aprId)) run.approvalRequestIds.push(aprId);
          });
        }
      }
    },

    /* -------- assistant: the conversational NL → plan → approval loop ------- */
    startConversation: async (text, opts) => {
      const t = (text ?? "").trim();
      // WP-003 slice 5 (recents hygiene) — a retry from Ask FamiliOS's home composer
      // reuses the most recent thread instead of minting another one, IF that thread
      // never got a real answer (every reply so far was an honest error). Without
      // this, each "no AI provider" / "backend unreachable" attempt piled up its own
      // near-empty "New chat" row in Recents — noise that only ever repeats the same
      // failure. A thread that got even one real answer/plan/build is never reused.
      const mostRecent = get().data.conversations?.[0];
      if (mostRecent && isErrorOnlyThread(mostRecent)) {
        get().navigate("assistant", { id: mostRecent.id });
        if (t) await get().sendToAssistant(mostRecent.id, t);
        return mostRecent.id;
      }
      let id = uid("conv");
      let serverId: string | undefined;
      const now = nowISO();
      // Server-owned thread when online — history is then durable + actor-scoped. Falls
      // back to a local-only conversation when the backend is unreachable. A server-created
      // thread records its serverId so hydrate can drop it if it's cleared upstream (inbox
      // wipe) via mergeServerAuthoritative; an offline thread has none and survives locally.
      if (get().backendOnline) {
        const r = await backend.createConversation((t || "New chat").slice(0, 48), opts?.visibility);
        if (r.conversation) { id = r.conversation.id; serverId = r.conversation.id; }
      }
      commit((d) => { (d.conversations ??= []).unshift({ id, serverId, title: (t || "New chat").slice(0, 48), createdAt: now, updatedAt: now, messages: [] }); });
      get().navigate("assistant", { id });
      if (t) await get().sendToAssistant(id, t);
      return id;
    },
    sendToAssistant: async (conversationId, text, extraContext) => {
      const t = (text ?? "").trim(); if (!t) return;
      const aMsgId = uid("m");
      commit((d) => {
        const c = (d.conversations ??= []).find((x) => x.id === conversationId); if (!c) return;
        c.messages.push({ id: uid("m"), role: "user", text: t, createdAt: nowISO() });
        c.messages.push({ id: aMsgId, role: "assistant", text: "", createdAt: nowISO(), status: "thinking" });
        if (c.messages.length <= 2) c.title = t.slice(0, 48);
        c.updatedAt = nowISO();
      });
      // Build a compact, grounded household context — the data stays local; only
      // this summary is sent so the assistant can answer truthfully.
      const s = get();
      const d0 = s.data;
      const now = Date.now();
      const ctx = {
        household: d0.household?.name,
        now: new Date().toISOString(),
        members: d0.members.map((m) => m.displayName),
        upcomingEvents: [...d0.events]
          .filter((e) => isLive(e, now) && +new Date(e.startAt) <= now + 7 * 864e5)
          .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)).slice(0, 8)
          .map((e) => ({ title: e.title, when: e.startAt, location: e.location ?? "", allDay: !!e.allDay })),
        openTasks: d0.tasks.filter((tk) => tk.status !== "done").slice(0, 10).map((tk) => ({ title: tk.title, due: tk.dueAt ?? "", type: tk.type })),
        pendingApprovals: s.serverApprovals.filter((a) => a.status === "pending").length,
        liveConnectors: s.connectors.filter((c) => c.live).map((c) => c.name),
        connectedAccounts: s.accounts.filter((a) => a.status === "connected").map((a) => `${a.provider} (${a.displayName})`),
        // Per-turn extras (e.g. { attachedFileId, attachedFileName } from the "+" attach button).
        ...(extraContext ?? {}),
      };
      // Use SSE streaming so the UI shows a live "generating" indicator while the AI
      // is working. Transitions from "thinking" → "streaming" on first progress event.
      // Pass conversationId so the server persists the turn into the durable thread
      // (when the conversation is server-owned). The server also re-grounds on its own
      // visibility-filtered view of the household — the client context is just a hint.
      // A server `phase` outranks the token-count guess: "searching" means the assistant is
      // out fetching pages, which is the SLOWEST part of a lookup and the part a token count
      // cannot see. Once a phase has been reported, the token heuristic stops overwriting it
      // — otherwise the label would flicker back to "Generating…" mid-search, which is the
      // same wrong-but-confident status the mobile client fixed with its phaseLockedRef.
      let phaseLocked = false;
      const patchMsg = (fn: (m: AssistantMessage) => void) => commit((d) => {
        const m = d.conversations?.find((x) => x.id === conversationId)?.messages.find((x) => x.id === aMsgId);
        if (m) fn(m);
      });
      // Names the turn: the server runs a named turn at most once, so a retried request
      // can never execute the turn's tools a second time.
      const clientTurnId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const r = await backend.streamAssistant({ message: t, context: ctx, conversationId, clientTurnId }, (tokens) => {
        if (tokens === 4 && !phaseLocked) patchMsg((m) => { m.status = "streaming"; });
      }, (phase) => {
        phaseLocked = true;
        patchMsg((m) => { m.status = phase === "searching" ? "searching" : phase === "creating" ? "creating" : "streaming"; });
      }, (text) => {
        // The reply as it streams — rendered live; the engine's final `answer` replaces it on done.
        patchMsg((m) => { m.text += text; m.status = "streaming"; });
      }, (ev) => {
        // Live tool frames become provisional chips (running → done/failed as they settle);
        // the engine's authoritative toolCalls list replaces them on done.
        patchMsg((m) => {
          const calls = m.toolCalls ?? (m.toolCalls = []);
          const status: AssistantToolCall["status"] = ev.status === "error" ? "failed" : ev.status === "called" ? "done" : "running";
          const entry: AssistantToolCall = { tool: ev.tool, label: ev.label ?? ev.tool, status, ok: ev.status === "called" ? true : ev.status === "error" ? false : undefined, summary: ev.message };
          const i = calls.findIndex((c) => c.tool === ev.tool && c.status === "running");
          if (i >= 0) calls[i] = entry; else calls.push(entry);
        });
      });
      // A durable run can now arrive with ANY kind — an approval-gated step parks a run
      // even on a plain "answer" — so the attach + watcher below key off the run, not kind.
      const runId = r.ok ? (r.run?.id ?? r.runId ?? r.runIds?.[0] ?? undefined) : undefined;
      const okText = r.kind === "plan" && r.plan ? (r.answer || r.plan.summary || (runId ? "On it — doing it now." : "Here's my plan."))
        : (r.answer || "I'm not sure how to help with that yet.");
      commit((d) => {
        const c = d.conversations?.find((x) => x.id === conversationId); if (!c) return;
        const m = c.messages.find((x) => x.id === aMsgId); if (!m) return;
        if (!r.ok) {
          m.status = "error";
          // Keep the MACHINE-READABLE code in m.error — the Assistant UI keys the
          // local-engine fallback off `m.error === "no_provider"`; prose belongs in
          // m.text. (Previously this stored r.message, so the fallback never fired
          // when the server attached a human message to the error.)
          let code = r.error ?? "unknown";
          // In a local on-device session the server refuses with authentication_
          // required — but the truthful chat-surface state is simply that no server-
          // side AI provider is available HERE. Same when the backend is unreachable.
          // Route both to the local-engine fallback instead of a dead-end.
          if (code === "backend_unreachable" || (get().isLocalSession && (code === "authentication_required" || code === "forbidden"))) {
            code = "no_provider";
          }
          m.error = code;
          m.text = code === "ai_disabled"
            ? "AI chat isn't turned on for your profile yet. Ask a parent to switch it on in Household → Members, and I'll be right here!"
            : code === "no_provider"
            ? "I need an AI provider to think, and none is connected for this household yet — that is set up by whoever runs this deployment."
            : "I couldn't reach the AI provider just now. Try again in a moment.";
        } else if (r.kind === "plan" && r.plan) {
          // Auto-run (C-intel): the server already started executing this plan —
          // attach the run so the card shows live status instead of a Run button.
          m.status = runId ? "done" : "planned"; m.plan = r.plan;
        } else {
          m.status = "answered";
        }
        if (r.ok) { m.text = okText; m.model = r.model; m.toolCalls = r.toolCalls; if (runId) m.runId = runId; }
        c.updatedAt = nowISO();
      });
      // Watch a server-started run to a terminal state, hydrating so its live status,
      // run_result message, and any self-repair follow-ups (status lines, the repaired
      // run, the save-as-helper offer) land in this thread.
      if (r.ok && runId) {
        // The exact text this turn's message was optimistically set to above — used
        // below to detect whether anything has already replaced it before we do.
        const optimisticText = okText;
        void (async () => {
          let last: ServerRun | null = null;
          for (let i = 0; i < 60; i++) {
            await new Promise((res) => setTimeout(res, 2500));
            // WP-009 (HYP-006 root cause): this used to call hydrateFromServer()
            // — a Promise.all across 10 collections — unconditionally every
            // 2.5s here, completely bypassing the /api/rev short-circuit. That
            // was the actual source of the ~1 req/sec collection-fetch storm
            // (EV-030), not the rev poll itself: every chat-started run drove
            // its own ungated full refetch loop for up to 2.5 minutes. The
            // rev-gated SSE/poll loop started in loadBackend now owns
            // refetching collections on real change; this loop only needs the
            // single run's status (one cheap request) for terminal detection
            // and the honesty fallback below.
            last = await backend.getRun(runId);
            if (last && TERMINAL_RUN.includes(last.status)) break;
          }
          // One unconditional sync now that the run is terminal/exhausted — cheap
          // (fires once, not on a timer) and a safety net in case a rev push was
          // somehow missed while this run's steps were landing.
          void get().hydrateFromServer();
          // WP-004: polling gives up after ~2.5 minutes. A run that's still parked
          // (waiting on approval/connector) or that expired unattended must not leave
          // the optimistic "On it —" text as the last word in the thread.
          if (last && last.status !== "completed") {
            const honest =
              last.status === "waiting_for_approval" ? "Still waiting on your approval — nothing has been sent yet. Check Approvals."
              : last.status === "waiting_for_connector" || last.status === "waiting_for_provider" ? "Still paused — connect the required service to continue. Nothing has been sent yet."
              : last.status === "expired" ? "Expired — nothing was sent. Review in Inbox."
              : last.status === "failed" ? `Didn't finish: ${last.error ?? "a step failed."}`
              : "This hasn't finished yet — nothing has been sent. Check Activity for its latest status.";
            commit((d) => {
              const c = d.conversations?.find((x) => x.id === conversationId);
              const mm = c?.messages.find((x) => x.id === aMsgId);
              if (mm && mm.text === optimisticText) mm.text = honest;
            });
          }
        })();
      }
    },
    runConversationPlan: async (conversationId, messageId) => {
      const c = get().data.conversations?.find((x) => x.id === conversationId);
      const m = c?.messages.find((x) => x.id === messageId);
      if (!m?.plan) return;
      commit((d) => { const cc = d.conversations?.find((x) => x.id === conversationId); const mm = cc?.messages.find((x) => x.id === messageId); if (mm) mm.status = "running"; });
      const runId = await get().runPlan({ title: m.plan.title, summary: m.plan.summary, steps: m.plan.steps }, { label: "Ask FamiliOS" });
      commit((d) => { const cc = d.conversations?.find((x) => x.id === conversationId); const mm = cc?.messages.find((x) => x.id === messageId); if (mm) { mm.runId = runId; mm.status = "done"; } });
      if (!runId) return;
      // The run's results come back INTO this chat (runPlan already polled to a
      // terminal/parked state): outcome + step outputs + artifacts, persisted
      // server-side so it survives hydration and shows on every device.
      const run = get().data.runs.find((r) => r.id === runId);
      if (!run) return;
      const done = run.steps.filter((s) => s.status === "done").length;
      const artifacts = await backend.artifacts(`?runId=${encodeURIComponent(runId)}`).catch(() => [] as ServerArtifact[]);
      const stepLines = run.steps
        .filter((s) => s.detail && s.status === "done")
        .slice(0, 4)
        .map((s) => `- **${s.label}**: ${String(s.detail).slice(0, 220)}`);
      const artLines = (artifacts ?? []).slice(0, 3).map((a) => `**${a.title}**${a.body ? `\n\n${a.body.slice(0, 700)}` : ""}`);
      const header =
        run.status === "Completed" ? `Done — **${run.triggerLabel || m.plan.title}** finished (${done}/${run.steps.length} steps).`
        : run.status === "Waiting for Approval" ? `**${m.plan.title}** is paused — a step needs your approval (check Approvals). It resumes automatically once you decide.`
        : run.status === "Failed" ? `**${m.plan.title}** didn't finish: ${run.outputSummary ?? "a step failed."}`
        : `**${m.plan.title}** is running — results will land in Activity.`;
      const text = [header, ...stepLines, ...artLines].join("\n\n");
      const saved = await backend.appendConversationMessage(conversationId, { text, kind: "run_result", runId });
      if (saved.conversation) {
        const sc = saved.conversation;
        commit((d) => {
          const cc = d.conversations?.find((x) => x.id === conversationId);
          if (cc) {
            cc.messages.push({ id: `${sc.id}-m${sc.messages.length - 1}`, role: "assistant", text, createdAt: nowISO(), status: "answered" });
            cc.updatedAt = nowISO();
          }
        });
      }
    },
    deleteConversation: (id) => {
      commit((d) => { if (d.conversations) d.conversations = d.conversations.filter((c) => c.id !== id); });
      if (get().route.screen === "assistant" && get().route.params?.id === id) get().navigate("assistant");
      // The conversation is server-durable (P1.1) — without this, it silently
      // reappears on the next hydrate because it was only ever removed locally.
      void backend.deleteConversationRemote(id).then((r) => { if (!r.ok) toast({ kind: "warn", title: "Deleted locally only", message: "Couldn't reach the backend — it may reappear next time you load." }); });
    },

    /* -------------------- connectors (real backend) ----------------------- */
    connectors: [],
    providers: [],
    accounts: [],
    backendHealth: null,
    backendOnline: false,
    externalActionsEnabled: true,
    serverApprovals: [],
    serverNotifications: [],
    // Single source for both server-truth lists — called from hydrateFromServer (the
    // existing hydrate/poll loop) AND on-demand (Approvals/Inbox tab mount, right after a
    // decide or mark-read) so the UI never waits out the ~15s background poll to show a
    // just-created or just-decided approval.
    refreshApprovalsAndNotifications: async () => {
      const [serverApprovals, serverNotifications] = await Promise.all([backend.listApprovals(), backend.notifications()]);
      set({ serverApprovals, serverNotifications });
    },
    decideServerApproval: async (id, approve) => {
      const dec = await backend.decideApproval(id, approve);
      if (dec.error || !dec.approval) {
        toast({
          kind: "error",
          title: approve ? "Approval failed" : "Could not deny",
          message: dec.error === "expired" ? "This request expired — ask the agent to re-submit." : "Could not record the decision on the server.",
        });
        return false;
      }
      await get().refreshApprovalsAndNotifications();
      toast({ kind: approve ? "success" : "info", title: approve ? "Approved" : "Denied", message: dec.approval.preview || undefined });
      return true;
    },
    markServerNotificationRead: async (id) => {
      // Optimistic flip so the row updates immediately; refreshed for real on the next
      // hydrate. A failed request reverts on the following refresh rather than rolling
      // back locally — the read state is inconsequential enough not to warrant a second
      // network round-trip just to undo it.
      set((s) => ({ serverNotifications: s.serverNotifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
      const r = await backend.markNotificationRead(id);
      return !!r.ok;
    },
    loadBackend: async () => {
      const [health, connectors, prov, accounts] = await Promise.all([backend.health(), backend.connectors(), backend.providers(), backend.accounts()]);
      // Unauthenticated/local sessions get null back from these endpoints — keep the
      // previous (or empty) lists instead of clobbering state with undefined, which
      // used to white-screen any screen that maps over connectors/providers.
      set({
        backendHealth: health, backendOnline: !!health,
        connectors: connectors ?? get().connectors ?? [],
        providers: prov?.providers ?? get().providers ?? [],
        accounts: accounts ?? get().accounts ?? [],
        externalActionsEnabled: health ? health.externalActionsEnabled : true,
      });
      if (health) {
        void get().migrateContactMethodsToServer();
        void get().hydrateFromServer();
        // Cross-device freshness (WP-009 / ISS-010 / HYP-006): re-hydrate the 10
        // server collections ONLY when household data actually changed, signalled
        // by /api/rev (now per-household — see store.mjs). A fixed-interval poll
        // alone can't satisfy both "idle app makes almost no requests" AND
        // "a change is visible within a few seconds" (a poll fast enough for the
        // latter blows the request budget for the former) — so the fast path is a
        // push channel (SSE /api/changes), and a slow poll is only the fallback
        // for when SSE can't connect, backing further off while the tab is
        // hidden. Singleton — survives repeat loadBackend calls and any number
        // of open tabs/components that just want "tell me when something changed."
        type FamiliosSyncState = { es: EventSource | null; pollId: number | null; lastRev: number | null; hydrateTimer: number | null };
        const w = window as unknown as { __familiosSync?: FamiliosSyncState };
        if (!w.__familiosSync) {
          const state: FamiliosSyncState = { es: null, pollId: null, lastRev: null, hydrateTimer: null };
          w.__familiosSync = state;
          // Coalesce a burst of rev bumps (e.g. several run steps completing back
          // to back) into one hydrate instead of one per bump.
          const scheduleHydrate = (rev: number) => {
            if (state.lastRev != null && rev === state.lastRev) return;
            state.lastRev = rev;
            if (state.hydrateTimer != null) return;
            state.hydrateTimer = window.setTimeout(() => {
              state.hydrateTimer = null;
              if (get().session) void get().hydrateFromServer();
            }, 300);
          };
          const pollOnce = async () => {
            if (!get().session) return;
            const rev = await backend.rev();
            if (rev != null) scheduleHydrate(rev);
          };
          const armPoll = (ms: number) => {
            if (state.pollId != null) window.clearInterval(state.pollId);
            state.pollId = window.setInterval(pollOnce, ms);
          };
          const startSSE = () => {
            if (typeof EventSource === "undefined" || state.es) return;
            try {
              const es = new EventSource("/api/changes", { withCredentials: true });
              es.onmessage = (e) => {
                try { const { rev } = JSON.parse(e.data) as { rev: number }; scheduleHydrate(rev); } catch { /* not a rev payload */ }
              };
              // EventSource auto-reconnects on its own; the fallback poll below
              // still catches anything missed while a reconnect is in flight.
              es.onerror = () => {};
              state.es = es;
            } catch { /* SSE unsupported/blocked — the fallback poll covers it */ }
          };
          startSSE();
          armPoll(document.hidden ? 30_000 : 20_000); // fallback safety net, not the primary freshness path
          void pollOnce(); // catch anything between the initial hydrate above and SSE connecting
          document.addEventListener("visibilitychange", () => {
            if (document.hidden) { armPoll(30_000); return; }
            armPoll(20_000);
            void pollOnce(); // immediate rev check the moment the tab is foregrounded again
            if (!state.es) startSSE();
          });
        }
      }
    },
    // Pull server-owned family data (events/tasks/members/conversations) and reconcile it
    // into local AppData. The server is authoritative for items it owns (matched by id);
    // local-only demo/seed items are preserved so the showcase stays populated. Roles come
    // from the server member registry (the client can render but never mint roles). If the
    // backend is offline this is a no-op and the local-first cache continues to render.
    hydrateFromServer: async () => {
      // WP-001: piggyback the approvals + notifications refresh on this same hydrate/poll
      // loop (initial load, the 15s revision-changed poll, and every explicit call below)
      // instead of standing up a second polling loop. Fire-and-forget — independent of the
      // AppData reconciliation this function otherwise does.
      void get().refreshApprovalsAndNotifications();
      const [events, tasks, members, conversations, memory, helpers, contactMethods, household, files, knowledge] = await Promise.all([
        backend.events(), backend.tasks(), backend.members(), backend.conversations(), backend.memory(), backend.helpers(), backend.contactMethods(), backend.household(), backend.files(), backend.knowledge(),
      ]);
      const mimeToType = (mime: string, name: string): FileAsset["type"] => {
        const ext = (name.split(".").pop() ?? "").toUpperCase();
        const byExt: Record<string, FileAsset["type"]> = { PDF: "PDF", DOCX: "DOCX", TXT: "TXT", MD: "MD", CSV: "CSV", XLSX: "XLSX", PNG: "Image", JPG: "Image", JPEG: "Image", GIF: "Image", ZIP: "ZIP", MP3: "Audio", MP4: "Video" };
        if (byExt[ext]) return byExt[ext];
        if (mime.startsWith("image")) return "Image"; if (mime.startsWith("audio")) return "Audio"; if (mime.startsWith("video")) return "Video";
        if (mime.includes("pdf")) return "PDF"; return "TXT";
      };
      const mapFile = (f: ServerFile): FileAsset => ({
        id: f.id, serverId: f.id, name: f.name, type: mimeToType(f.mime ?? "", f.name), sizeBytes: f.sizeBytes ?? 0,
        tags: f.tags ?? [], ownerMemberId: f.uploadedBy, spaceId: f.spaceId ?? "sp-family", uploadedAt: f.createdAt,
        linkedAgentIds: [], summary: `${f.pageCount && f.pageCount > 1 ? `${f.pageCount}-page ` : ""}file synced from your household.`,
        detectedDates: [], detectedTasks: [], sensitive: (f.visibility === "personal") || /tax|medical|ssn|passport|id|bank|legal/i.test(f.name),
        searchIndexed: false, folder: "Uploads", pageCount: f.pageCount,
      });
      const mapKnowledge = (k: ServerKnowledge): KnowledgeItem => ({
        id: k.id, serverId: k.id, title: k.title, type: (k.type as KnowledgeItem["type"]) || "Reference Note", content: k.content ?? "",
        fileAssetIds: k.fileIds ?? [], tags: k.tags ?? [], spaceId: "sp-family", createdBy: k.createdBy,
        sensitive: !!k.sensitive, visibility: k.visibility, agentReadable: true, agentEditableRequiresApproval: true,
        createdAt: k.createdAt, updatedAt: k.updatedAt,
      });
      const mapEvent = (e: ServerEvent): CalendarEvent => ({
        id: e.id, serverId: e.id, title: e.title, startAt: e.startAt ?? "", endAt: e.endAt ?? undefined, allDay: e.allDay || undefined,
        location: e.location || undefined, spaceId: e.spaceId, memberIds: e.participantIds ?? [],
        category: e.category ?? "General", movable: e.layer === "canonical", source: e.source ?? "FamiliOS",
        layer: e.layer, visibility: e.visibility, ownerId: e.ownerId, driverId: e.driverId, editable: e.editable,
        whatToBring: e.whatToBring, checklist: e.checklist,
        notes: (e as { notes?: string }).notes || undefined,
        provenance: (e as { provenance?: CalendarEvent["provenance"] }).provenance ?? null,
      });
      const mapTask = (t: ServerTask): Task => ({
        id: t.id, serverId: t.id, title: t.title, type: (t.type as Task["type"]) ?? "task",
        status: (t.status as Task["status"]) ?? "todo", dueAt: t.dueAt ?? undefined,
        assignedMemberId: t.assignedMemberId ?? undefined, spaceId: t.spaceId,
        priority: (t.priority as Task["priority"]) ?? "medium", amount: t.amount ?? undefined,
        source: (t.source as Task["source"]) ?? "user", notes: t.notes || undefined,
        visibility: t.visibility, listName: t.listName, createdAt: t.createdAt, updatedAt: t.updatedAt,
      });
      const MEMORY_TYPES: MemoryType[] = ["Fact", "Preference", "Routine", "Rule", "Contact", "Insight"];
      // Attribution is the server's to give (a run's agent); "" means it gave none, and
      // the Memory surfaces hide their agent filter/tab rather than offer one that can't match.
      const mapMemory = (m: ServerMemory): MemoryEntry => ({
        id: m.id, serverId: m.id, agentId: m.agentId ?? m.source?.agentId ?? "", spaceId: "sp-family",
        type: (MEMORY_TYPES as string[]).includes(m.type) ? (m.type as MemoryType) : "Insight",
        title: m.type ? `${m.type[0].toUpperCase()}${m.type.slice(1)}` : "Memory",
        content: m.text, tags: [], source: "Learned from a run",
        confidence: 1, userApproved: true, sensitive: m.scope === "personal",
        createdAt: new Date(m.createdAt).toISOString(), updatedAt: new Date(m.createdAt).toISOString(),
      });
      // WP-003 slice 3 (double-run guard) — this used to drop runId/kind/error/
      // artifactId/link/taskId/approvalId on every hydrate, because
      // ServerConversationMessage (connectors/api.ts, owned by another WP) was never
      // widened to declare fields the server has sent all along (server/index.mjs
      // turn-persistence, server/assistant-runs.mjs onRunFinished/onRunParked). That
      // was the double-run bug's real root cause: a plan message's runId vanished on
      // the very next poll/refresh, so PlanCard saw "no run" and showed the Run
      // button again for a plan that had already been dispatched. Read the extra
      // fields via a local cast instead of editing that (additive-only, out-of-scope)
      // file — the runtime object has always carried them; only the type didn't.
      type RawConvMsg = ServerConversationMessage & {
        error?: string | null; kind?: string;
        artifactId?: string | null; link?: string | null; taskId?: string | null; approvalId?: string | null;
        links?: { kind: "task" | "artifact"; id: string; label: string }[];
      };
      const mapConv = (c: ServerConversation): AssistantConversation => ({
        id: c.id, serverId: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt,
        messages: (c.messages ?? []).map((m0, i) => {
          const m = m0 as RawConvMsg;
          return {
            id: `${c.id}-m${i}`, role: m.role, text: m.text, createdAt: m.at,
            plan: m.plan ?? undefined, model: m.model ?? undefined,
            runId: m.runId ?? m.runIds?.[0] ?? undefined, toolCalls: m.toolCalls ?? undefined, kind: m.kind, error: m.error ?? undefined,
            artifactId: m.artifactId ?? undefined, artifactLink: m.link ?? undefined,
            taskId: m.taskId ?? undefined, approvalId: m.approvalId ?? undefined,
            links: m.links ?? undefined,
            // An honest server-side error (kind:"error") must keep reading as an error
            // after hydrate too — it used to fall through to "answered", which silently
            // dropped the coral error styling and the no-provider fallback card.
            status: m.role === "assistant"
              ? (m.kind === "error" ? "error" : m.plan ? "planned" : "answered")
              : undefined,
          };
        }),
      });
      const mapContact = (c: ServerContactMethod): ContactMethod => ({
        id: c.id, memberId: c.memberId, label: c.label, type: c.type, value: c.value,
        verified: c.verified, optInStatus: c.optInStatus, allowedAgentIds: c.allowedAgentIds ?? [],
      });
      commit((d) => {
        // A real, server-backed household must NEVER merge into the local SAMPLE. Sample
        // records carry no serverId, so every server-authoritative merge below would read
        // them as never-synced local drafts and keep them forever — surfacing as Harper
        // sample events, spaces, agents, knowledge, memories and messages blended into the
        // family's own data. Reset to a clean base first; everything below then populates
        // it from the server. Guarded on a real session, so exploring the sample with no
        // session (the onboarding "Explore the sample" path) is left completely alone.
        if (get().session && isSampleData(d)) {
          Object.assign(d, buildEmptyData("My Household", get().session?.actorName ?? "You"));
        }
        // Events are server-authoritative AND churn-prone: Google Calendar re-syncs
        // re-key the same event, so the old "keep locals whose id isn't in the current
        // server set" merge let stale copies pile up (prod: 41 server events → 511 in
        // the client store, the same DBT session under 4 ids). mergeServerAuthoritative
        // drops anything that ever had a serverId but isn't in the current set, keeping
        // only genuinely-local (offline/un-synced) events. Self-heals on the next hydrate.
        d.events = mergeServerAuthoritative(events.map(mapEvent), d.events);
        // Contact methods are server-owned (the delivery registry). Before the one-time
        // migration completes, local-only entries survive so nothing vanishes from the UI;
        // once migrated, the server is fully authoritative — including DELETIONS, so a
        // method removed on another client can't linger here as a stale local ghost.
        const contactsMigrated = typeof localStorage !== "undefined" && !!localStorage.getItem("homeops.contactsMigrated.v1");
        const cmIds = new Set(contactMethods.map((c) => c.id));
        d.contactMethods = contactsMigrated
          ? contactMethods.map(mapContact)
          : [...contactMethods.map(mapContact), ...d.contactMethods.filter((c) => !cmIds.has(c.id))];
        // Server-authoritative (see reconcile.ts): a task that once had a serverId but is
        // gone from the server's current set was deleted upstream and must NOT linger as a
        // local ghost — only never-synced offline drafts (no serverId) survive.
        d.tasks = mergeServerAuthoritative(tasks.map(mapTask), d.tasks);
        // The roster is server-authoritative: the server registry IS the member list
        // (the iOS app writes to the same registry). Presentation fields the server
        // doesn't store (avatar color, initials, email) survive by id; local-only
        // members — the demo seed, pre-claim leftovers — are DROPPED so sample data
        // can never shadow the real household.
        if (members.length > 0) {
          const AV = ["ember", "sage", "sky", "lavender", "amber", "ink"];
          const nowISO = new Date().toISOString();
          d.members = members.map((sm) => {
            const local = d.members.find((m) => m.id === sm.actorId);
            return {
              id: sm.actorId,
              displayName: sm.displayName,
              role: sm.role as Member["role"],
              relationship: sm.relationship ?? local?.relationship ?? "",
              avatarColor: sm.color || local?.avatarColor || AV[[...sm.displayName].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length],
              initials: local?.initials ?? sm.displayName.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase(),
              spaceIds: local?.spaceIds ?? sm.spaceIds ?? [],
              isCurrentUser: sm.isCurrentUser,
              email: local?.email,
              photoFileId: sm.photoFileId ?? null,
              aiEnabled: sm.aiEnabled,
              createdAt: local?.createdAt ?? nowISO,
              updatedAt: nowISO,
            };
          });
          const serverOwner = members.find((m) => m.role === "Owner");
          if (serverOwner) d.household.ownerMemberId = serverOwner.actorId;
        }
        // Household name is server-owned too (renameable from iOS Settings).
        if (household?.name) d.household.name = household.name;
        // Server-authoritative: a thread deleted/cleared on the server (inbox cleanup) must
        // disappear here too — only offline-created threads that never synced (no serverId)
        // survive. Before this, cleared threads lingered in Recents as un-openable ghosts.
        d.conversations = mergeServerAuthoritative(conversations.map(mapConv), d.conversations ?? []);
        // Real memory, written by actual agent runs (homeops.write_memory). Server-authoritative:
        // memories cleared on the server (reset / fresh start) must NOT survive as local ghosts —
        // only user-added local memories (no serverId, never pushed) are kept. This was the
        // "33 memories persist after a server wipe" bug: the old merge kept stale serverId rows.
        // There is no memory PATCH endpoint, so an edit made here can never reach the
        // server row — and the old merge re-mapped that row on every poll, silently
        // reverting the edit. A locally-edited copy (updatedAt later than the server's
        // stamp) carries its edits forward instead; deletions still propagate.
        const priorMemories = new Map(d.memories.filter((m) => m.serverId).map((m) => [m.serverId!, m]));
        d.memories = mergeServerAuthoritative(memory.map(mapMemory), d.memories).map((m) => {
          const prev = m.serverId ? priorMemories.get(m.serverId) : undefined;
          return prev && prev.updatedAt > m.updatedAt
            ? { ...m, title: prev.title, content: prev.content, type: prev.type, tags: prev.tags, sensitive: prev.sensitive, userApproved: prev.userApproved, spaceId: prev.spaceId, agentId: prev.agentId || m.agentId, updatedAt: prev.updatedAt }
            : m;
        });
        // Durable files (server blobs). Web reads the same /api/files the iOS app writes to,
        // so uploads survive refresh/device-switch and show up in the shared Library.
        // Server-authoritative: a file deleted on the server is dropped here; only offline /
        // mid-upload files (no serverId yet) are preserved until they push.
        // ISS-120: `searchIndexed` is a CLIENT-side flag — the server does not model
        // indexing — so mapFile hardcoding it false wiped it on EVERY poll. A file the
        // user had just processed flipped back to "Not indexed" seconds after the "File
        // processed" toast, which is the contradiction that was reported. Carry this
        // browser's own answer forward rather than overwriting it with a guess.
        // Same class of wipe for name / tags / sensitive: all three are editable here, but
        // there is no file PATCH endpoint (src/connectors/api.ts has upload/content/delete
        // only), so the server copy can never learn them — the previous local record is
        // the only place they exist. Carried forward by serverId; deletions still propagate.
        const priorIndexed = new Set(d.files.filter((f) => f.searchIndexed).map((f) => f.serverId ?? f.id));
        const priorFiles = new Map(d.files.filter((f) => f.serverId).map((f) => [f.serverId!, f]));
        d.files = mergeServerAuthoritative(files.map(mapFile), d.files).map((f) => {
          const prev = f.serverId ? priorFiles.get(f.serverId) : undefined;
          const carried = prev ? { ...f, name: prev.name, tags: prev.tags, sensitive: prev.sensitive } : f;
          return priorIndexed.has(f.serverId ?? f.id) ? { ...carried, searchIndexed: true } : carried;
        });
        // Server-owned Knowledge (user-authored, editable, durable). Server-authoritative:
        // knowledge deleted on the server is dropped here; only never-synced local drafts survive.
        d.knowledge = mergeServerAuthoritative(knowledge.map(mapKnowledge), d.knowledge);
        // Helpers (the server's registry) → the local display mirror.
        mergeHelpersIntoAgents(d, helpers, { actorId: get().session?.actorId });
      });
      set({ helpers });
    },
    // One-time IndexedDB→server contact-method migration (same contract as agents):
    // ids and verified/opt-in state are PRESERVED, the server create is idempotent on a
    // supplied id, and we only mark done when every push succeeded — a non-adult session
    // (which may not push other members' methods) simply retries on the next load.
    migrateContactMethodsToServer: async () => {
      if (typeof localStorage !== "undefined" && localStorage.getItem("homeops.contactsMigrated.v1")) return;
      try {
        const server = await backend.contactMethods();
        const serverIds = new Set(server.map((c) => c.id));
        const locals = get().data.contactMethods.filter((c) => !serverIds.has(c.id));
        let ok = true;
        for (const c of locals) {
          const r = await backend.createContactMethod({
            id: c.id, memberId: c.memberId, label: c.label, type: c.type, value: c.value,
            verified: c.verified, optInStatus: c.optInStatus, allowedAgentIds: c.allowedAgentIds ?? [],
          });
          if (r.error) { ok = false; break; }
        }
        if (ok && typeof localStorage !== "undefined") localStorage.setItem("homeops.contactsMigrated.v1", "1");
      } catch { /* non-fatal — retry on next backend load */ }
    },
    configureConnector: async (id, values) => {
      const r = await backend.saveConfig(id, values);
      const updated = r.connector;
      if (updated) {
        set((s) => ({ connectors: s.connectors.map((c) => (c.id === id ? updated : c)) }));
        commit((d) => pushActivity(d, { actorType: "user", actorId: get().session?.actorId ?? "user", actorName: get().session?.actorName ?? "You", actionType: "connection.added", description: `Configured ${updated.name} (${updated.readiness.replace(/_/g, " ")})`, entityType: "connector", entityId: id, status: "success" }));
        toast({ kind: "success", title: "Connector configured", message: `${updated.name} — ${updated.readiness.replace(/_/g, " ")}` });
      } else {
        toast({ kind: "error", title: r.error === "insufficient_role" ? "Not allowed" : "Could not save", message: r.error === "insufficient_role" ? "Only an Adult Admin or Owner can configure connectors." : r.error === "authentication_required" ? "Sign in to configure connectors." : "Start the FamiliOS runtime to configure connectors." });
      }
    },
    revokeConnector: async (id) => {
      const updated = await backend.revoke(id);
      if (updated) {
        set((s) => ({ connectors: s.connectors.map((c) => (c.id === id ? updated : c)) }));
        commit((d) => pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "connection.revoked", description: `Revoked ${updated.name}`, entityType: "connector", entityId: id, status: "warning" }));
        toast({ kind: "info", title: "Connector revoked" });
      }
    },
    checkConnectorHealth: async (id) => {
      const h = await backend.checkHealth(id);
      // reflect any readiness change
      const fresh = await backend.connectors();
      if (fresh.length) set({ connectors: fresh, backendOnline: true });
      toast({ kind: h.ok ? "success" : "warn", title: h.ok ? "Health check passed" : "Health check failed", message: h.ok ? `${h.latencyMs ?? 0}ms` : h.error ?? h.status });
      return h;
    },
    startConnectorAuth: async (id) => {
      const out = await backend.oauthStart(id);
      if (!out.ok || !out.url) {
        toast({ kind: "warn", title: "Setup required", message: out.message ?? "Add OAuth client credentials first, then Authorize." });
        return;
      }
      const popup = window.open(out.url, "homeops-oauth", "width=520,height=680");
      toast({ kind: "info", title: "Authorize in the new window", message: "Sign in and grant access — you'll return here automatically." });
      let done = false;
      const isReady = () => {
        const c = get().connectors.find((x) => x.id === id);
        return !!c && ["authorized_write", "authorized_readonly", "connected"].includes(c.readiness);
      };
      const finish = async () => {
        if (done) return;
        done = true;
        window.removeEventListener("message", onMsg);
        clearInterval(poll);
        await get().loadBackend();
        const c = get().connectors.find((x) => x.id === id);
        const ready = isReady();
        toast({ kind: ready ? "success" : "info", title: ready ? `${c?.name} connected` : "Returned from authorization", message: ready ? "Tools are live now." : "If it didn't connect, re-check your OAuth client setup." });
      };
      const onMsg = (e: MessageEvent) => {
        const d = e.data as { type?: string; connectorId?: string } | null;
        if (d && d.type === "homeops-oauth" && d.connectorId === id) void finish();
      };
      window.addEventListener("message", onMsg);
      let ticks = 0;
      const poll = setInterval(async () => {
        ticks += 1;
        await get().loadBackend();
        if (isReady() || (popup && popup.closed) || ticks > 48) void finish();
      }, 2500);
    },
    connectProvider: async (providerId) => {
      const out = await backend.oauthStart(providerId);
      if (!out.ok || !out.url) {
        toast({ kind: "warn", title: "Can't connect", message: out.error === "not_configured_by_deployment" ? (out.message ?? "This provider isn't configured by the deployment.") : out.message ?? out.error ?? "Unable to start sign-in." });
        return;
      }
      const provider = get().providers.find((p) => p.id === providerId);
      const before = get().accounts.filter((a) => a.provider === providerId).length;
      const popup = window.open(out.url, "homeops-oauth", "width=520,height=680");
      toast({ kind: "info", title: `Sign in to ${provider?.name ?? providerId}`, message: "A provider window opened — sign in and approve access. You'll return automatically." });
      let done = false;
      const finish = async () => {
        if (done) return; done = true;
        window.removeEventListener("message", onMsg); clearInterval(poll);
        await get().loadBackend();
        const after = get().accounts.filter((a) => a.provider === providerId);
        const connected = after.length > before || after.some((a) => a.status === "connected");
        toast({ kind: connected ? "success" : "info", title: connected ? `${provider?.name ?? providerId} connected` : "Returned from sign-in", message: connected ? `Signed in as ${after[after.length - 1]?.displayName ?? "your account"}. Tools are live.` : "If it didn't connect, try again." });
      };
      const onMsg = (e: MessageEvent) => { const d = e.data as { type?: string; provider?: string } | null; if (d && d.type === "homeops-oauth" && d.provider === providerId) void finish(); };
      window.addEventListener("message", onMsg);
      let ticks = 0;
      const poll = setInterval(async () => { ticks += 1; await get().loadBackend(); if (get().accounts.filter((a) => a.provider === providerId).length > before || (popup && popup.closed) || ticks > 48) void finish(); }, 2500);
    },
    revokeAccount: async (accountId) => {
      const acct = get().accounts.find((a) => a.id === accountId);
      await backend.revokeAccount(accountId);
      await get().loadBackend();
      commit((d) => pushActivity(d, { actorType: "user", actorId: get().session?.actorId ?? "user", actorName: get().session?.actorName ?? "You", actionType: "connection.revoked", description: `Disconnected ${acct?.provider ?? "account"} (${acct?.displayName ?? ""})`, entityType: "connector", entityId: acct?.provider, status: "warning" }));
      toast({ kind: "info", title: "Account disconnected" });
    },
    checkAccountHealth: async (accountId) => {
      const h = await backend.accountHealth(accountId);
      await get().loadBackend();
      toast({ kind: h.ok ? "success" : "warn", title: h.ok ? "Account healthy" : "Health check failed", message: h.ok ? `${h.latencyMs ?? 0}ms` : h.status });
    },
    runTool: async (toolId, input = {}, opts = {}) => {
      // Resolve the tool from the legacy utility connectors OR the provider platform.
      const conn = get().connectors.find((c) => c.tools.some((t) => t.id === toolId));
      const prov = get().providers.find((p) => p.tools.some((t) => t.id === toolId));
      const tool = conn?.tools.find((t) => t.id === toolId) ?? prov?.tools.find((t) => t.id === toolId);
      const sourceId = conn?.id ?? prov?.id;
      const sourceName = conn?.name ?? prov?.name ?? "connector";

      // High-risk tools never execute directly. We create a SERVER-SIDE approval
      // record (bound to actor + tool + canonical input hash) and surface a local
      // projection. Execution only happens after approveRequest decides + consumes
      // that record — the client cannot bypass it with a flag.
      if (tool?.requiresApproval && !opts.approvalId && sourceId) {
        const categoryBySource: Record<string, ApprovalRequest["category"]> = {
          google: "Email", microsoft: "Email", gcal: "Calendar", slack: "Message", sms: "Message", http: "Form", browser: "Browser", "files-local": "File", dropbox: "File", notion: "Form", todoist: "Form", ticktick: "Form",
        };
        const inputLines = Object.entries(input).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
        const intentLine = opts.label && opts.label !== tool.name ? `What the agent wants to do: ${opts.label}\n\n` : "";
        const preview = `${intentLine}${tool.name} via ${sourceName} · ${tool.action} (${tool.risk} risk)\n\n${inputLines || "(no parameters)"}\n\nApprove to execute this real action.`;
        const created = await backend.createApproval({ toolId, connectorId: sourceId, input, category: categoryBySource[sourceId], preview });
        if (!created.approval) {
          toast({ kind: "error", title: "Could not request approval", message: created.error === "authentication_required" ? "Sign in to request this action." : created.error ?? "Backend unavailable." });
          return { ok: false, error: created.error ?? "approval_failed" };
        }
        get().requestApproval({
          title: `${tool.name} — ${sourceName}`,
          proposedAction: ("description" in tool && tool.description) ? tool.description as string : tool.name,
          riskLevel: tool.risk,
          category: categoryBySource[sourceId] ?? (tool.action === "Send" ? "Message" : tool.action === "Download" ? "Browser" : "Form"),
          agentId: opts.agentId,
          dataUsedSummary: sourceName,
          recipientSummary: (input.to as string) || (input.summary as string) || "External recipient",
          previewContent: preview,
          toolId,
          toolInput: input,
          connectorId: sourceId,
          backendApprovalId: created.approval.id,
        });
        return { ok: false, error: "approval_required", message: "Approval requested — approve it to run." };
      }

      const res = await backend.execute(toolId, input, { approvalId: opts.approvalId, accountId: opts.accountId });
      commit((d) => {
        pushActivity(d, {
          actorType: opts.agentId ? "agent" : "user",
          actorId: opts.agentId ?? get().session?.actorId ?? "user",
          actorName: opts.agentId ? d.agents.find((a) => a.id === opts.agentId)?.name ?? "Agent" : get().session?.actorName ?? "You",
          actionType: res.ok ? "tool.executed" : "tool.failed",
          description: res.ok ? `Ran ${tool?.name ?? toolId} via ${sourceName}` : `${tool?.name ?? toolId} blocked: ${res.error ?? "error"} (${sourceName})`,
          entityType: "connector",
          entityId: sourceId,
          status: res.ok ? "success" : "error",
          metadata: { toolId, error: res.error },
        });
      });
      if (!opts.quiet) {
        if (!res.ok) toast({ kind: "warn", title: tool?.name ?? "Tool", message: res.message ?? res.error });
        else toast({ kind: "success", title: `${tool?.name ?? "Tool"} ran`, message: sourceName });
      }
      return res;
    },
    sendWebhookTest: async (payload) => {
      const r = await backend.sendWebhook("webhook", payload, true);
      if (r.ok) {
        commit((d) => pushActivity(d, { actorType: "webhook", actorId: "webhook", actorName: "Webhook Receiver", actionType: "webhook.received", description: `Webhook received: ${(payload.description as string) ?? (payload.type as string) ?? "event"}`, entityType: "connector", entityId: "webhook", status: "success" }));
        toast({ kind: "success", title: "Webhook received", message: "The real receiver stored and logged the event." });
      } else {
        toast({ kind: "warn", title: "Webhook failed", message: r.error });
      }
    },
    setKillSwitch: async (enabled) => {
      const s = await backend.setSettings({ externalActionsEnabled: enabled });
      set({ externalActionsEnabled: s.externalActionsEnabled });
      toast({ kind: enabled ? "info" : "warn", title: enabled ? "External actions enabled" : "External actions paused", message: enabled ? undefined : "All write/send tools are blocked until re-enabled." });
    },

    /* -------------------------- messages + approvals ---------------------- */
    sendMessage: (threadId, body) => {
      commit((d) => {
        const thread = d.threads.find((t) => t.id === threadId);
        if (!thread) return;
        const me = d.members.find((m) => m.isCurrentUser);
        d.messages.push({
          id: uid("msg"),
          threadId,
          senderType: "user",
          senderId: me?.id ?? "user",
          senderName: me?.displayName ?? "You",
          body,
          channel: "In-App",
          deliveryStatus: "Sent",
          requiresReply: false,
          createdAt: nowISO(),
        });
        thread.preview = body.slice(0, 80);
        thread.updatedAt = nowISO();
        thread.unread = false;
        // Agent acknowledges and turns reply into an instruction.
        const agentId = thread.agentIds[0];
        const agent = d.agents.find((a) => a.id === agentId);
        if (agent) {
          d.messages.push({
            id: uid("msg"),
            threadId,
            senderType: "agent",
            senderId: agent.id,
            senderName: agent.name,
            body: `Got it — I'll treat that as an instruction and follow up. (${body.slice(0, 40)}…)`,
            channel: "In-App",
            deliveryStatus: "Delivered",
            requiresReply: false,
            createdAt: nowISO(),
          });
        }
        pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "message.sent", description: `Replied in “${thread.title}”`, entityType: "thread", entityId: threadId, spaceId: thread.spaceId, status: "success" });
      });
    },
    createThread: (input) => {
      const id = uid("thread");
      commit((d) => {
        d.threads.unshift({
          id,
          title: input.title,
          participantIds: input.participantIds ?? [],
          agentIds: input.agentIds ?? [],
          spaceId: input.spaceId ?? d.spaces[0].id,
          status: "open",
          preview: input.preview ?? "",
          unread: false,
          createdAt: nowISO(),
          updatedAt: nowISO(),
        });
      });
      return id;
    },
    resolveThread: (id) => {
      commit((d) => {
        const t = d.threads.find((x) => x.id === id);
        if (t) {
          t.status = "resolved";
          t.updatedAt = nowISO();
        }
      });
      toast({ kind: "success", title: "Marked resolved" });
    },
    escalateThread: (id) => {
      commit((d) => {
        const t = d.threads.find((x) => x.id === id);
        if (t) {
          t.status = "escalated";
          t.updatedAt = nowISO();
          pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "message.escalated", description: `Escalated “${t.title}”`, entityType: "thread", entityId: id, spaceId: t.spaceId, status: "warning" });
        }
      });
      toast({ kind: "warn", title: "Escalated as urgent" });
    },
    reopenThread: (id) =>
      commit((d) => {
        const t = d.threads.find((x) => x.id === id);
        if (t) {
          t.status = "open";
          t.updatedAt = nowISO();
        }
      }),
    markThreadRead: (id) =>
      commit((d) => {
        const t = d.threads.find((x) => x.id === id);
        if (t) t.unread = false;
      }),
    // Contact methods live in the server-owned registry (the source notify.mjs resolves
    // from), so every mutation goes through the backend and the local copy only mirrors
    // what the server confirmed — no fake local success when the backend refuses/is down.
    addContactMethod: async (memberId, input) => {
      const r = await backend.createContactMethod({
        memberId, label: input.label, type: input.type ?? "Email", value: input.value,
        allowedAgentIds: input.allowedAgentIds ?? [],
      });
      const cm = r.contactMethod;
      if (!cm) {
        toast({ kind: "error", title: r.error === "insufficient_role" ? "Not allowed" : "Could not add contact method", message: r.error === "insufficient_role" ? "You can only add contact methods for yourself." : r.message ?? (r.error === "backend_unreachable" ? "Start the FamiliOS runtime to manage contacts." : "The server rejected this contact method.") });
        return;
      }
      commit((d) => {
        d.contactMethods.push({ id: cm.id, memberId: cm.memberId, label: cm.label, type: cm.type, value: cm.value, verified: cm.verified, optInStatus: cm.optInStatus, allowedAgentIds: cm.allowedAgentIds ?? [] });
      });
      toast({ kind: "info", title: "Contact method added", message: cm.verified ? undefined : "Verify it to let agents send to it." });
    },
    // The true verification loop: request a code through the method's real channel…
    sendContactVerification: async (id) => {
      const r = await backend.sendContactVerification(id);
      if (r.ok) toast({ kind: "success", title: "Code sent", message: r.message ?? "Enter the 6-digit code to verify." });
      else if (r.needsSetup) toast({ kind: "warn", title: "Channel needs setup", message: r.message ?? "Connect the required service in Connections first." });
      else if (r.error === "resend_too_soon") toast({ kind: "warn", title: "Code already sent", message: r.message ?? "Wait a moment before requesting another." });
      else toast({ kind: "error", title: "Couldn't send code", message: r.message ?? (r.error === "backend_unreachable" ? "Start the FamiliOS runtime to manage contacts." : r.error) });
      return { ok: !!r.ok, needsSetup: r.needsSetup, message: r.message };
    },
    // …and confirm it. Entering the code is the proof of address control.
    confirmContactVerification: async (id, code) => {
      const r = await backend.confirmContactVerification(id, code);
      const cm = r.contactMethod;
      if ((r.ok && cm) || r.alreadyVerified) {
        commit((d) => {
          const c = d.contactMethods.find((x) => x.id === id);
          if (c && cm) { c.verified = cm.verified; c.optInStatus = cm.optInStatus; }
        });
        toast({ kind: "success", title: "Contact verified", message: "Agents can now message this method." });
        return { ok: true };
      }
      const message = r.message ?? (r.error === "code_incorrect" ? `That code doesn't match${r.attemptsLeft != null ? ` — ${r.attemptsLeft} attempts left` : ""}.` : r.error);
      toast({ kind: "error", title: "Couldn't verify", message });
      return { ok: false, message };
    },
    // Adult-only manual override, recorded server-side as verifiedVia:"manual".
    verifyContactMethod: async (id) => {
      const r = await backend.patchContactMethod(id, { verified: true, optInStatus: "Opted In" });
      const cm = r.contactMethod;
      if (!cm) {
        toast({ kind: "error", title: r.error === "insufficient_role" ? "Not allowed" : "Could not verify", message: r.message ?? (r.error === "insufficient_role" ? "Verify with the code sent to this method, or ask an adult to override." : "Start the FamiliOS runtime to manage contacts.") });
        return;
      }
      commit((d) => {
        const c = d.contactMethods.find((x) => x.id === id);
        if (c) { c.verified = cm.verified; c.optInStatus = cm.optInStatus; }
      });
      toast({ kind: "success", title: "Marked verified", message: "Recorded as a manual override." });
    },
    setContactAllowedAgents: async (id, agentIds) => {
      const r = await backend.patchContactMethod(id, { allowedAgentIds: agentIds });
      const cm = r.contactMethod;
      if (!cm) {
        toast({ kind: "error", title: r.error === "insufficient_role" ? "Not allowed" : "Could not update", message: r.error === "insufficient_role" ? "Only adults can change another member's agent allowlist." : "Start the FamiliOS runtime to manage contacts." });
        return;
      }
      commit((d) => {
        const c = d.contactMethods.find((x) => x.id === id);
        if (c) c.allowedAgentIds = cm.allowedAgentIds ?? [];
      });
    },
    approveRequest: async (id, newPreview) => {
      const existing = get().data.approvals.find((x) => x.id === id);
      if (!existing) return;
      // Stale-guard: only a Pending request can be approved. A request that has had
      // changes requested (or already decided) cannot be approved without a re-request.
      if (existing.status !== "Pending") {
        toast({ kind: "warn", title: "Can't approve", message: existing.status === "Changes Requested" ? "Changes were requested — the agent must re-submit." : `This request is already ${existing.status.toLowerCase()}.` });
        return;
      }

      // 1) Decide on the server-side record (the source of truth).
      let pending: { toolId: string; toolInput: Record<string, unknown>; title: string; backendApprovalId: string } | null = null;
      if (existing.backendApprovalId) {
        const dec = await backend.decideApproval(existing.backendApprovalId, true);
        if (dec.error || dec.approval?.status !== "approved") {
          toast({ kind: "error", title: "Approval failed", message: dec.error === "expired" ? "This request expired — ask the agent to re-submit." : "Could not record approval on the server." });
          return;
        }
        // Server-managed gate (a step inside a durable run): the SERVER resumes and
        // executes the step. The client must NOT re-execute — it only mirrors the run.
        if (existing.serverManaged) {
          const meId = get().session?.actorId ?? get().currentMember().id;
          const meName = get().session?.actorName ?? get().currentMember().displayName;
          commit((d) => {
            const a = d.approvals.find((x) => x.id === id);
            if (a) { a.status = "Approved"; a.decisionByMemberId = meId; a.decisionAt = nowISO(); a.updatedAt = nowISO(); }
            pushActivity(d, { actorType: "user", actorId: meId, actorName: meName, actionType: "approval.granted", description: `Approved: ${existing.title}`, entityType: "approval", entityId: id, status: "success" });
          });
          toast({ kind: "info", title: "Approved — finishing run…", message: existing.title });
          if (existing.relatedRunId) {
            await backend.resumeRun(existing.relatedRunId); // idempotent (auto-resume hook also fires)
            await get().syncServerRun(existing.relatedRunId);
            const r = get().data.runs.find((x) => x.id === existing.relatedRunId);
            toast({ kind: r?.status === "Failed" ? "error" : "success", title: r?.status === "Failed" ? "Run had problems" : "Action completed", message: r?.outputSummary });
          }
          return;
        }
        if (existing.toolId) pending = { toolId: existing.toolId, toolInput: existing.toolInput ?? {}, title: existing.title, backendApprovalId: existing.backendApprovalId };
      }

      const me = get().session ?? { actorId: get().currentMember().id, actorName: get().currentMember().displayName };
      const willExecute = !!pending;
      const decidedStatus: ApprovalRequest["status"] = newPreview !== undefined ? "Edited Before Approval" : "Approved";
      commit((d) => {
        const a = d.approvals.find((x) => x.id === id);
        if (!a) return;
        if (newPreview !== undefined) a.previewContent = newPreview;
        a.status = willExecute ? "Executing" : decidedStatus;
        a.decisionByMemberId = me.actorId;
        a.decisionAt = nowISO();
        a.updatedAt = nowISO();
        if (willExecute) a.executionStartedAt = nowISO();
        if (!willExecute && a.relatedRunId) {
          const run = d.runs.find((r) => r.id === a.relatedRunId);
          if (run) { run.status = "Completed"; run.completedAt = nowISO(); run.steps.forEach((s) => (s.status = s.status === "blocked" ? "done" : s.status)); run.outputSummary = "Approved by you."; }
        }
        d.messages.filter((m) => m.approvalRequestId === id).forEach((m) => (m.deliveryStatus = "Sent"));
        pushActivity(d, { actorType: "user", actorId: me.actorId, actorName: me.actorName, actionType: "approval.granted", description: `Approved: ${a.title}`, entityType: "approval", entityId: id, spaceId: a.spaceId, status: "success" });
      });

      // 2) Execute the real action by consuming the approved server-side record.
      if (pending) {
        const exec = pending;
        const t0 = Date.now();
        toast({ kind: "info", title: "Approved — executing…", message: exec.title });
        const res = await backend.execute(exec.toolId, exec.toolInput, { approvalId: exec.backendApprovalId });
        const conn = get().connectors.find((c) => c.tools.some((t) => t.id === exec.toolId));
        const prov = get().providers.find((p) => p.tools.some((t) => t.id === exec.toolId));
        const tool = conn?.tools.find((t) => t.id === exec.toolId) ?? prov?.tools.find((t) => t.id === exec.toolId);
        const sourceName = conn?.name ?? prov?.name ?? "connector";
        const summary = res.ok ? JSON.stringify(res.result) : res.message ?? res.error ?? "error";
        const ms = Date.now() - t0;
        commit((d) => {
          const a = d.approvals.find((x) => x.id === id);
          if (a) {
            a.executionOk = res.ok;
            a.executionResult = summary;
            a.executionEndedAt = nowISO();
            a.executionMs = ms;
            a.status = res.ok ? decidedStatus : "Execution Failed";
            a.previewContent = `${a.previewContent}\n\n— ${res.ok ? "Executed ✓" : "Execution failed ✗"}: ${summary.slice(0, 400)}`;
            a.updatedAt = nowISO();
            if (a.relatedRunId) {
              const run = d.runs.find((r) => r.id === a.relatedRunId);
              if (run) {
                const blocked = run.steps.find((s) => s.status === "blocked");
                if (blocked) { blocked.status = res.ok ? "done" : "blocked"; blocked.detail = res.ok ? summary.slice(0, 160) : (res.message ?? res.error ?? "Failed"); }
                const otherPending = run.approvalRequestIds.some((aid) => { const x = d.approvals.find((p) => p.id === aid); return x && (x.status === "Pending" || x.status === "Executing"); });
                if (!otherPending && !run.steps.some((s) => s.status === "blocked" || s.status === "pending" || s.status === "running")) { run.status = res.ok ? "Completed" : "Failed"; run.completedAt = nowISO(); run.outputSummary = res.ok ? "Completed after approval." : "A step failed after approval."; }
              }
            }
          }
          pushActivity(d, { actorType: "user", actorId: me.actorId, actorName: me.actorName, actionType: res.ok ? "tool.executed" : "tool.failed", description: res.ok ? `Executed ${tool?.name ?? exec.toolId} via ${sourceName} (after approval)` : `${tool?.name ?? exec.toolId} failed after approval: ${res.error ?? "error"}`, entityType: "connector", entityId: conn?.id ?? prov?.id, status: res.ok ? "success" : "error", metadata: { toolId: exec.toolId, error: res.error } });
        });
        toast({ kind: res.ok ? "success" : "error", title: res.ok ? "Action completed" : "Action failed", message: res.ok ? exec.title : res.message ?? res.error });
        return;
      }
      toast({ kind: "success", title: "Approved", message: "Recorded." });
    },
    denyRequest: async (id) => {
      const existing = get().data.approvals.find((x) => x.id === id);
      if (existing?.backendApprovalId && existing.status === "Pending") await backend.decideApproval(existing.backendApprovalId, false);
      const me = get().session ?? { actorId: get().currentMember().id, actorName: get().currentMember().displayName };
      // For a server-managed gate the server auto-resumes → fails the run on deny; the
      // local commit below sets the authoritative "Cancelled" projection directly, so we
      // skip a syncServerRun poll (it would only flash a transient "Failed" first).
      commit((d) => {
        const a = d.approvals.find((x) => x.id === id);
        if (!a) return;
        a.status = "Denied";
        a.decisionByMemberId = me.actorId;
        a.decisionAt = nowISO();
        a.updatedAt = nowISO();
        if (a.relatedRunId) {
          const run = d.runs.find((r) => r.id === a.relatedRunId);
          if (run) { run.status = "Cancelled"; run.outputSummary = "Denied by you — no action taken."; }
        }
        pushActivity(d, { actorType: "user", actorId: me.actorId, actorName: me.actorName, actionType: "approval.denied", description: `Denied: ${a.title}`, entityType: "approval", entityId: id, spaceId: a.spaceId, status: "warning" });
      });
      toast({ kind: "info", title: "Denied", message: "No action was taken." });
    },
    askAgentForChanges: async (id, note) => {
      // Invalidate the server-side approval so the stale request can never be executed,
      // and move it to "Changes Requested" (approve/deny disabled until re-submitted).
      const existing = get().data.approvals.find((x) => x.id === id);
      if (existing?.backendApprovalId && existing.status === "Pending") await backend.decideApproval(existing.backendApprovalId, false);
      // A server-managed run gate can't be edited in place, but "ask for changes" should
      // be more than "start over": re-invoke the planner with the ORIGINAL plan + your
      // feedback to produce a REVISED plan, stop the stale run, dispatch the revision, and
      // jump to the live monitor (item 10b). Falls back to stop-and-tell if re-planning
      // can't produce a plan (no AI provider, etc.).
      if (existing?.serverManaged && existing.relatedRunId) {
        const stopStale = (extra: string) => {
          commit((d) => {
            const a = d.approvals.find((x) => x.id === id);
            if (a) { a.status = "Denied"; a.previewContent = `${a.previewContent}\n\n— You asked for changes: “${note}”. ${extra}`; a.decisionByMemberId = get().session?.actorId; a.decisionAt = nowISO(); a.updatedAt = nowISO(); }
            const run = d.runs.find((r) => r.id === existing.relatedRunId);
            if (run && run.status !== "Completed") { run.status = "Cancelled"; run.outputSummary = "Superseded — you asked for changes."; }
            pushActivity(d, { actorType: "user", actorId: get().session?.actorId ?? "user", actorName: get().session?.actorName ?? "You", actionType: "approval.changes_requested", description: "Asked for changes — replanning", entityType: "approval", entityId: id, spaceId: a?.spaceId, status: "info" });
          });
        };
        // Pull the ORIGINAL plan (full steps incl. toolId + input) from the server run.
        const serverRun = await backend.getRun(existing.relatedRunId);
        const originalSteps = (serverRun?.steps ?? []).map((s) => ({ toolId: s.toolId, title: s.title, detail: s.detail, input: s.input ?? {} }));
        if (!originalSteps.length) { stopStale("Start a new run with your changes."); toast({ kind: "info", title: "Run stopped", message: "Start a new run with your changes." }); return; }
        toast({ kind: "info", title: "Reworking the plan…", message: "Applying your feedback and drafting a revised plan." });
        const msg = `Revise the following plan based on my feedback, keeping everything that still applies and changing only what my feedback asks for. Return a revised plan (kind:"plan").\n\nOriginal plan "${serverRun?.title ?? "Plan"}" steps (JSON): ${JSON.stringify(originalSteps).slice(0, 3000)}\n\nMy feedback: ${note}`;
        const out = await backend.assistant(msg);
        if (out.ok && out.kind === "plan" && out.plan) {
          stopStale("I drafted a revised plan and started it below.");
          const newRunId = await get().runPlan(
            { title: out.plan.title || `Revised: ${serverRun?.title ?? "plan"}`, summary: out.plan.summary, steps: out.plan.steps },
            { label: "Revised after feedback", agentId: existing.requestedByAgentId },
          );
          void newRunId;
          toast({ kind: "success", title: "Revised plan started", message: "It's running now — gated steps still pause for approval." });
          return;
        }
        // Re-planning didn't yield a plan — honest fallback.
        stopStale("Start a new run with your changes.");
        toast({ kind: out.ok ? "info" : "warn", title: "Run stopped", message: out.ok ? "I couldn't draft a revision automatically — start a new run with your changes." : "Couldn't reach the planner — start a new run with your changes." });
        return;
      }
      commit((d) => {
        const a = d.approvals.find((x) => x.id === id);
        if (!a) return;
        a.previewContent = `${a.previewContent}\n\n— You asked the agent: “${note}”`;
        a.status = "Changes Requested";
        a.updatedAt = nowISO();
        pushActivity(d, { actorType: "user", actorId: get().session?.actorId ?? "user", actorName: get().session?.actorName ?? "You", actionType: "approval.changes_requested", description: `Asked ${d.agents.find((ag) => ag.id === a.requestedByAgentId)?.name ?? "agent"} for changes`, entityType: "approval", entityId: id, spaceId: a.spaceId, status: "info" });
      });
      toast({ kind: "info", title: "Sent back for changes", message: "This request can't be approved until it's re-submitted." });
    },
    requestApproval: (input) => {
      const id = uid("apr");
      commit((d) => {
        const agent = input.agentId ? d.agents.find((a) => a.id === input.agentId) : undefined;
        const approval: ApprovalRequest = {
          id,
          title: input.title,
          description: input.description ?? input.title,
          riskLevel: input.riskLevel ?? "High",
          requestedByAgentId: input.agentId ?? d.agents[0]?.id ?? "system",
          spaceId: input.spaceId ?? agent?.spaceId ?? d.spaces[0]?.id ?? "sp-personal",
          proposedAction: input.proposedAction,
          dataUsedSummary: input.dataUsedSummary ?? "Household data",
          recipientSummary: input.recipientSummary ?? "Outside the household",
          previewContent: input.previewContent ?? "Review the details, then approve to proceed.",
          status: "Pending",
          category: input.category ?? "Message",
          toolId: input.toolId,
          toolInput: input.toolInput,
          connectorId: input.connectorId,
          backendApprovalId: input.backendApprovalId,
          createdAt: nowISO(),
          updatedAt: nowISO(),
        };
        d.approvals.unshift(approval);
        pushActivity(d, { actorType: "agent", actorId: approval.requestedByAgentId, actorName: agent?.name ?? "Agent", actionType: "approval.requested", description: `Approval requested: ${input.title}`, entityType: "approval", entityId: id, spaceId: approval.spaceId, status: "pending" });
      });
      toast({ kind: "warn", title: "Approval requested", message: input.title });
      return id;
    },
    requestServerApproval: async (input) => {
      // Same route runTool takes for a gated tool: the server record is what the Approvals
      // console (and every other device) can see and decide; the local row only mirrors it.
      const created = await backend.createApproval({ toolId: input.toolId, connectorId: input.connectorId, input: input.toolInput ?? {}, category: input.category, preview: input.previewContent ?? input.proposedAction });
      if (!created.approval) {
        toast({ kind: "error", title: "Couldn't request approval", message: refusalMessage(created.error, created.error ? `The server refused it (${created.error}).` : "The server refused it.") });
        return null;
      }
      void get().refreshApprovalsAndNotifications();
      return get().requestApproval({ ...input, backendApprovalId: created.approval.id });
    },

    /* --------------------------- files + knowledge ------------------------ */
    uploadFiles: async (files, spaceId) => {
      const ids: string[] = [];
      let durableCount = 0;
      for (const file of files) {
        const id = uid("file");
        ids.push(id);
        const isText = /\.(txt|md|csv|json)$/i.test(file.name) || file.type.startsWith("text");
        // Read the raw bytes once as a data URL — this drives the image preview AND gives the
        // base64 we POST to the durable server so the upload survives refresh/device-switch and
        // lands in the shared Library (the old code only ever wrote to local IndexedDB). Text
        // files also get a text preview for on-device date/task detection.
        const dataUrl = await new Promise<string | undefined>((res) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result as string);
          reader.onerror = () => res(undefined);
          reader.readAsDataURL(file);
        });
        const base64 = dataUrl && dataUrl.includes(",") ? dataUrl.split(",")[1] : undefined;
        const previewContent = isText ? await file.text().catch(() => undefined) : undefined;
        const ext = (file.name.split(".").pop() ?? "").toUpperCase();
        const typeMap: Record<string, FileAsset["type"]> = { PDF: "PDF", DOCX: "DOCX", TXT: "TXT", MD: "MD", CSV: "CSV", XLSX: "XLSX", PNG: "Image", JPG: "Image", JPEG: "Image", GIF: "Image", ZIP: "ZIP", MP3: "Audio", MP4: "Video" };
        const dates = previewContent ? Array.from(previewContent.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\b/g)).map((m) => m[0]).slice(0, 5) : [];
        const tasks = previewContent
          ? previewContent.split(/\n/).filter((l) => /(due|sign|return|pay|bring|submit|deadline)/i.test(l)).map((l) => l.trim().slice(0, 80)).slice(0, 5)
          : [];
        // Durable server copy (best-effort — the local record still renders if the runtime is offline).
        let serverId: string | undefined;
        if (base64) {
          const up = await backend.uploadFile({ name: file.name, mime: file.type || "application/octet-stream", contentBase64: base64, spaceId, source: "upload" });
          if (up.file) { serverId = up.file.id; durableCount++; }
        }
        commit((d) => {
          const sid = spaceId ?? d.spaces.find((s) => s.type === "Personal")?.id ?? d.spaces[0].id;
          const f: FileAsset = {
            id,
            serverId,
            name: file.name,
            type: typeMap[ext] ?? "TXT",
            sizeBytes: file.size,
            tags: ["Uploaded"],
            ownerMemberId: d.members.find((m) => m.isCurrentUser)?.id ?? d.members[0].id,
            spaceId: sid,
            uploadedAt: nowISO(),
            linkedAgentIds: [],
            summary: previewContent ? `Uploaded ${ext} file. ${previewContent.slice(0, 120)}` : `Uploaded ${ext} file (${Math.round(file.size / 1024)} KB).`,
            detectedDates: dates,
            detectedTasks: tasks,
            sensitive: /tax|medical|ssn|passport|id|bank|legal/i.test(file.name),
            searchIndexed: false,
            previewContent,
            dataUrl: file.type.startsWith("image") ? dataUrl : undefined,
            folder: "Uploads",
          };
          d.files.unshift(f);
          pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "file.uploaded", description: `Uploaded ${file.name}`, entityType: "file", entityId: id, spaceId: sid, status: "success" });
          processFile(d, id);
        });
      }
      toast(durableCount === files.length
        ? { kind: "success", title: `${files.length} file${files.length > 1 ? "s" : ""} saved`, message: "Stored in your household Library — available on every device." }
        : { kind: "warn", title: `${files.length} file${files.length > 1 ? "s" : ""} added locally`, message: "Start the FamiliOS runtime to store them durably across devices." });
      return ids;
    },
    // Front + back of an ID card (or any 2-sided doc) as ONE durable file: both images are
    // stored as pages of a single server record (POST /api/files with `pages`), not two
    // separate files. Retrieve a side with backend.fileContent(id, pageIndex).
    uploadIdCard: async (front, back, name, spaceId) => {
      const toB64 = (f: File) => new Promise<string | undefined>((res) => {
        const reader = new FileReader();
        reader.onload = () => { const u = reader.result as string; res(u.includes(",") ? u.split(",")[1] : undefined); };
        reader.onerror = () => res(undefined);
        reader.readAsDataURL(f);
      });
      const [fb, bb] = await Promise.all([toB64(front), toB64(back)]);
      if (!fb || !bb) { toast({ kind: "error", title: "Couldn't read images", message: "Please choose two image files." }); return null; }
      const up = await backend.uploadFile({
        name: name || "ID card", mime: front.type || "image/jpeg", spaceId, source: "upload",
        tags: ["ID", "Uploaded"], visibility: "personal",
        pages: [{ name: "Front", base64: fb }, { name: "Back", base64: bb }],
      });
      if (!up.file) { toast({ kind: "error", title: "Couldn't save", message: up.error === "backend_unreachable" ? "Start the FamiliOS runtime to store files." : (up.message ?? up.error) }); return null; }
      const id = uid("file");
      const frontDataUrl = `data:${front.type || "image/jpeg"};base64,${fb}`;
      commit((d) => {
        const sid = spaceId ?? d.spaces.find((s) => s.type === "Personal")?.id ?? d.spaces[0].id;
        d.files.unshift({
          id, serverId: up.file!.id, name: up.file!.name, type: "Image", sizeBytes: up.file!.sizeBytes ?? front.size + back.size,
          tags: ["ID", "Uploaded"], ownerMemberId: d.members.find((m) => m.isCurrentUser)?.id ?? d.members[0].id, spaceId: sid,
          uploadedAt: nowISO(), linkedAgentIds: [], summary: "2-page document (front & back).",
          detectedDates: [], detectedTasks: [], sensitive: true, searchIndexed: false, dataUrl: frontDataUrl, folder: "Uploads", pageCount: 2,
        });
        pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "file.uploaded", description: `Uploaded ${up.file!.name} (front & back)`, entityType: "file", entityId: id, spaceId: sid, status: "success" });
      });
      toast({ kind: "success", title: "ID card saved", message: "Front and back stored as one document." });
      return id;
    },
    addSampleFile: (input) => {
      const id = uid("file");
      commit((d) => {
        const f: FileAsset = {
          id,
          name: input.name,
          type: input.type ?? "PDF",
          sizeBytes: input.sizeBytes ?? 102400,
          tags: input.tags ?? [],
          ownerMemberId: input.ownerMemberId ?? d.members[0].id,
          spaceId: input.spaceId ?? d.spaces[0].id,
          uploadedAt: nowISO(),
          linkedAgentIds: input.linkedAgentIds ?? [],
          summary: input.summary ?? "",
          detectedDates: input.detectedDates ?? [],
          detectedTasks: input.detectedTasks ?? [],
          sensitive: input.sensitive ?? false,
          searchIndexed: true,
          previewContent: input.previewContent,
          folder: input.folder ?? "Uploads",
        };
        d.files.unshift(f);
        pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "file.uploaded", description: `Added ${f.name}`, entityType: "file", entityId: id, spaceId: f.spaceId, status: "success" });
      });
      return id;
    },
    updateFile: (id, patch) =>
      commit((d) => {
        const f = d.files.find((x) => x.id === id);
        if (f) Object.assign(f, patch);
      }),
    deleteFile: (id) => {
      const f = get().data.files.find((x) => x.id === id);
      // Remove the durable server blob too, so a delete on web actually clears it everywhere
      // (not just this browser's copy).
      if (f?.serverId) void backend.deleteFileRemote(f.serverId);
      commit((d) => {
        d.files = d.files.filter((x) => x.id !== id);
        if (f) pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "file.deleted", description: `Deleted ${f.name}`, entityType: "file", entityId: id, spaceId: f.spaceId, status: "warning" });
      });
      toast({ kind: "info", title: "File deleted" });
    },
    toggleFileSensitive: (id) =>
      commit((d) => {
        const f = d.files.find((x) => x.id === id);
        if (f) f.sensitive = !f.sensitive;
      }),
    processFileById: (id) => {
      // ISS-120: this fired "File processed" unconditionally — even when processFile found
      // no such file and did nothing at all (`if (!file) return`). Same false-success class
      // as ISS-110: a success signal that isn't reading the outcome it reports.
      if (!get().data.files.some((f) => f.id === id)) {
        toast({ kind: "error", title: "Couldn't process that file", message: "It's no longer in your library." });
        return;
      }
      commit((d) => processFile(d, id));
      // The toast and the "Indexed / Not indexed" badge now read the SAME state, so they
      // can't disagree: success is claimed only once the file really is indexed.
      const indexed = get().data.files.find((f) => f.id === id)?.searchIndexed === true;
      toast(indexed
        ? { kind: "success", title: "File processed", message: "It's indexed and searchable now." }
        : { kind: "warn", title: "Not indexed yet", message: "The file was updated, but it isn't searchable yet." });
    },
    // Knowledge items are now server-owned (durable, editable, visibility-scoped) — the old
    // versions only ever wrote to this browser's IndexedDB, so nothing survived a refresh or
    // showed up on another device. These create/patch/delete against /api/knowledge and mirror
    // the result locally; the id we store is the server id so edits/deletes address the record.
    createKnowledgeItem: (input) => {
      const id = uid("know");
      const createdBy = get().data.members.find((m) => m.isCurrentUser)?.displayName ?? "You";
      const item: KnowledgeItem = {
        id, serverId: undefined, title: input.title, type: input.type ?? "Reference Note", content: input.content ?? "",
        fileAssetIds: input.fileAssetIds ?? [], tags: input.tags ?? [], spaceId: input.spaceId ?? get().data.spaces[0].id,
        createdBy, sensitive: input.sensitive ?? false, visibility: input.sensitive ? "personal" : "household",
        agentReadable: input.agentReadable ?? true, agentEditableRequiresApproval: input.agentEditableRequiresApproval ?? true,
        createdAt: nowISO(), updatedAt: nowISO(),
      };
      commit((d) => { d.knowledge.unshift(item); });
      const pending = backend.createKnowledge({ title: item.title, type: item.type, content: item.content, tags: item.tags, visibility: item.visibility, sensitive: item.sensitive, fileIds: item.fileAssetIds })
        .then((r) => {
          if (r.item) { commit((d) => { const k = d.knowledge.find((x) => x.id === id); if (k) k.serverId = r.item!.id; }); return r.item.id; }
          toast({ kind: "warn", title: "Saved locally only", message: r.error === "backend_unreachable" ? "Start the FamiliOS runtime to sync knowledge across devices." : (r.error ?? "The server rejected this item.") });
          return undefined;
        })
        .finally(() => { knowledgeServerIdPending.delete(id); });
      knowledgeServerIdPending.set(id, pending);
      toast({ kind: "success", title: "Knowledge added" });
      return id;
    },
    // Resolve the server id even for an item whose create POST hasn't returned yet, so a
    // fast edit/delete on a fresh item still reaches the server (no silent revert / orphan).
    updateKnowledgeItem: (id, patch) => {
      commit((d) => { const k = d.knowledge.find((x) => x.id === id); if (k) Object.assign(k, patch, { updatedAt: nowISO() }); });
      void (async () => {
        let sid = get().data.knowledge.find((x) => x.id === id)?.serverId;
        if (!sid && knowledgeServerIdPending.has(id)) sid = await knowledgeServerIdPending.get(id);
        if (!sid) return; // create failed / local-only — nothing to patch server-side
        const p: Partial<ServerKnowledge> = {};
        if (patch.title !== undefined) p.title = patch.title;
        if (patch.type !== undefined) p.type = patch.type;
        if (patch.content !== undefined) p.content = patch.content;
        if (patch.tags !== undefined) p.tags = patch.tags;
        if (patch.sensitive !== undefined) { p.sensitive = patch.sensitive; p.visibility = patch.sensitive ? "personal" : "household"; }
        await backend.patchKnowledge(sid, p);
      })();
    },
    deleteKnowledgeItem: (id) => {
      const existing = get().data.knowledge.find((x) => x.id === id);
      commit((d) => { d.knowledge = d.knowledge.filter((x) => x.id !== id); });
      void (async () => {
        let sid = existing?.serverId;
        if (!sid && knowledgeServerIdPending.has(id)) sid = await knowledgeServerIdPending.get(id);
        if (sid) await backend.deleteKnowledge(sid); // waits out an in-flight create so the row isn't orphaned
      })();
      toast({ kind: "info", title: "Knowledge item removed" });
    },

    /* ------------------------------- memory ------------------------------- */
    createMemory: (input) => {
      const id = uid("mem");
      commit((d) => {
        d.memories.unshift({
          id,
          agentId: input.agentId ?? d.agents[0].id,
          spaceId: input.spaceId ?? d.spaces[0].id,
          type: input.type ?? "Fact",
          title: input.title,
          content: input.content,
          tags: input.tags ?? [],
          source: input.source ?? "Added by you",
          confidence: input.confidence ?? 1,
          userApproved: input.userApproved ?? true,
          sensitive: input.sensitive ?? false,
          createdAt: nowISO(),
          updatedAt: nowISO(),
        });
        pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "memory.created", description: `Memory created: ${input.title}`, entityType: "memory", entityId: id, status: "success" });
      });
      toast({ kind: "success", title: "Memory saved" });
      return id;
    },
    updateMemory: (id, patch) =>
      commit((d) => {
        const m = d.memories.find((x) => x.id === id);
        if (m) {
          Object.assign(m, patch, { updatedAt: nowISO() });
          pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "memory.updated", description: `Memory updated: ${m.title}`, entityType: "memory", entityId: id, status: "info" });
        }
      }),
    deleteMemory: (id) => {
      const serverId = get().data.memories.find((x) => x.id === id)?.serverId;
      commit((d) => {
        const m = d.memories.find((x) => x.id === id);
        d.memories = d.memories.filter((x) => x.id !== id);
        if (m) pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "memory.deleted", description: `Memory deleted: ${m.title}`, entityType: "memory", entityId: id, status: "warning" });
      });
      // Real (server-owned) memory must actually be deleted server-side, or it reappears
      // on the next hydrate — the exact bug this project already has for conversations.
      if (serverId) void backend.deleteMemoryRemote(serverId).then((r) => { if (!r.ok) toast({ kind: "warn", title: "Deleted locally only", message: "Couldn't reach the backend — it may reappear next time you load." }); });
      toast({ kind: "info", title: "Memory deleted" });
    },
    approveMemory: (id) => {
      commit((d) => {
        const m = d.memories.find((x) => x.id === id);
        if (m) {
          m.userApproved = true;
          m.updatedAt = nowISO();
        }
      });
      toast({ kind: "success", title: "Memory approved" });
    },
    toggleMemorySensitive: (id) =>
      commit((d) => {
        const m = d.memories.find((x) => x.id === id);
        // updatedAt is what the hydrate merge reads to keep a local edit — stamp it.
        if (m) { m.sensitive = !m.sensitive; m.updatedAt = nowISO(); }
      }),

    /* ------------------------------ mini apps ----------------------------- */
    updateMiniAppData: (id, data) =>
      commit((d) => {
        const app = d.miniApps.find((x) => x.id === id);
        if (app) {
          app.data = data;
          app.version += 1;
          app.updatedAt = nowISO();
          pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "miniapp.updated", description: `Updated mini app “${app.name}”`, entityType: "miniApp", entityId: id, spaceId: app.spaceId, status: "info" });
        }
      }),
    createMiniApp: (input) => {
      const id = uid("app");
      commit((d) => {
        d.miniApps.unshift({
          id,
          name: input.name,
          type: input.type,
          description: input.description ?? "",
          spaceId: input.spaceId ?? d.spaces[0].id,
          createdByAgentId: input.createdByAgentId,
          data: input.data ?? {},
          linkedEntityIds: input.linkedEntityIds ?? [],
          version: 1,
          status: "active",
          createdAt: nowISO(),
          updatedAt: nowISO(),
        });
        pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "miniapp.created", description: `Created mini app “${input.name}”`, entityType: "miniApp", entityId: id, status: "success" });
      });
      toast({ kind: "success", title: "Mini app created" });
      return id;
    },
    archiveMiniApp: (id) => {
      commit((d) => {
        const app = d.miniApps.find((x) => x.id === id);
        if (app) app.status = app.status === "archived" ? "active" : "archived";
      });
      toast({ kind: "info", title: "Mini app archived" });
    },
    deleteMiniApp: (id) => {
      commit((d) => {
        d.miniApps = d.miniApps.filter((x) => x.id !== id);
      });
      toast({ kind: "info", title: "Mini app deleted" });
    },
    duplicateMiniApp: (id) => {
      const newId = uid("app");
      const source = get().data.miniApps.find((x) => x.id === id);
      commit((d) => {
        const app = d.miniApps.find((x) => x.id === id);
        // ISS-122: the clone copied `status` too, so duplicating an ARCHIVED app produced
        // another archived one — "Mini app duplicated" reported success while the copy was
        // only findable under Archived, with nothing saying so. A duplicate is something
        // you just made in order to use it, so it lands ACTIVE, where you're already
        // looking; the original's archived state is left alone.
        if (app) d.miniApps.unshift({ ...structuredClone(app), id: newId, name: `${app.name} (Copy)`, status: "active", version: 1, createdAt: nowISO(), updatedAt: nowISO() });
      });
      toast(source?.status === "archived"
        ? { kind: "success", title: "Mini app duplicated", message: "The copy is active — the original stays archived." }
        : { kind: "success", title: "Mini app duplicated" });
      return newId;
    },

    /* --------------------------- tasks + events --------------------------- */
    createTask: (input) => {
      const id = uid("task");
      commit((d) => {
        d.tasks.unshift({
          id,
          title: input.title,
          type: input.type ?? "task",
          status: input.status ?? "todo",
          dueAt: input.dueAt,
          assignedMemberId: input.assignedMemberId,
          spaceId: input.spaceId ?? d.spaces[0].id,
          priority: input.priority ?? "medium",
          amount: input.amount,
          source: input.source ?? "user",
          createdByAgentId: input.createdByAgentId,
          notes: input.notes,
          visibility: input.visibility ?? "household",
          createdAt: nowISO(),
          updatedAt: nowISO(),
        });
      });
      toast({ kind: "success", title: "Reminder added" });
      // Persist to the server; on success tag the optimistic item with its serverId so
      // later updates target the durable record. A local-only session (T-03) has no
      // server household to write to, so it stays a device-local task on purpose.
      if (!get().isLocalSession) {
        void backend.createTaskRemote({ title: input.title, type: input.type, status: input.status, dueAt: input.dueAt ?? null, assignedMemberId: input.assignedMemberId ?? null, spaceId: input.spaceId, priority: input.priority, amount: input.amount ?? null, notes: input.notes ?? "", visibility: input.visibility ?? "household" })
          .then((r) => {
            if (r.task) { commit((d) => { const t = d.tasks.find((x) => x.id === id); if (t) t.serverId = r.task!.id; }); return; }
            // Same shape as createEvent (ISS-105): a create the server refused must not
            // linger as a phantom that survives every hydrate. Roll it back and say so.
            commit((d) => { d.tasks = d.tasks.filter((x) => x.id !== id); });
            toast({ kind: "error", title: "Couldn't save that task", message: refusalMessage(r.error) });
          });
      }
      return id;
    },
    // Server-backed tasks/events ALWAYS go to the server (never skipped on a stale
    // `backendOnline`), and a refused or unreachable write is rolled back with a toast —
    // a fire-and-forget PATCH left this device believing a change nobody else could see.
    updateTask: (id, patch) => {
      const before = get().data.tasks.find((x) => x.id === id);
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (t) Object.assign(t, patch, { updatedAt: nowISO() });
      });
      if (!before?.serverId) return;
      void backend.updateTaskRemote(before.serverId, patch as Partial<ServerTask>).then((r) => {
        if (r.task) return;
        commit((d) => { const i = d.tasks.findIndex((x) => x.id === id); if (i >= 0) d.tasks[i] = before; });
        toast({ kind: "error", title: "Couldn't save that change", message: refusalMessage(r.error, "The server refused the change — it was undone.") });
      });
    },
    setTaskStatus: (id, status) => {
      const before = get().data.tasks.find((x) => x.id === id);
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (t) { t.status = status; t.updatedAt = nowISO(); }
      });
      if (!before?.serverId) return;
      void backend.updateTaskRemote(before.serverId, { status }).then((r) => {
        if (r.task) return;
        commit((d) => { const t = d.tasks.find((x) => x.id === id); if (t) { t.status = before.status; t.updatedAt = nowISO(); } });
        toast({ kind: "error", title: "Couldn't update that task", message: refusalMessage(r.error, "The server refused the change — it was undone.") });
      });
    },
    deleteTask: (id) => {
      const before = get().data.tasks.find((x) => x.id === id);
      const index = get().data.tasks.findIndex((x) => x.id === id);
      commit((d) => { d.tasks = d.tasks.filter((x) => x.id !== id); });
      if (!before?.serverId) return;
      void backend.deleteTaskRemote(before.serverId).then((r) => {
        if (r.ok) return;
        commit((d) => { d.tasks.splice(Math.min(index, d.tasks.length), 0, before); });
        toast({ kind: "error", title: "Couldn't delete that task", message: refusalMessage(r.error, "The server refused — the task was restored.") });
      });
    },
    moveEvent: (id, newStartISO) => {
      const before = get().data.events.find((x) => x.id === id);
      commit((d) => {
        const e = d.events.find((x) => x.id === id);
        if (e) {
          e.startAt = newStartISO;
          pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "calendar.changed", description: `Moved “${e.title}”`, entityType: "event", entityId: id, spaceId: e.spaceId, status: "info" });
        }
      });
      toast({ kind: "success", title: "Event moved" });
      if (!before?.serverId) return;
      void backend.updateEvent(before.serverId, { startAt: newStartISO }).then((r) => {
        if (r.event) return;
        commit((d) => { const e = d.events.find((x) => x.id === id); if (e) e.startAt = before.startAt; });
        toast({ kind: "error", title: "Couldn't move that event", message: refusalMessage(r.error, "The server refused the move — it was undone.") });
      });
    },
    createEvent: (input) => {
      const id = uid("event");
      commit((d) => {
        d.events.push({
          id,
          title: input.title,
          startAt: input.startAt,
          endAt: input.endAt,
          allDay: input.allDay,
          location: input.location,
          spaceId: input.spaceId ?? d.spaces[0].id,
          memberIds: input.memberIds ?? [],
          category: input.category ?? "General",
          movable: input.movable ?? true,
          source: input.source ?? "You",
          notes: input.notes,
          visibility: input.visibility ?? "household",
        });
      });
      if (get().backendOnline) {
        void backend.createEvent({ title: input.title, startAt: input.startAt ?? null, endAt: input.endAt ?? null, allDay: input.allDay, location: input.location ?? "", spaceId: input.spaceId, participantIds: input.memberIds ?? [], category: input.category, visibility: input.visibility ?? "household" })
          .then((r) => {
            if (r.event) { commit((d) => { const e = d.events.find((x) => x.id === id); if (e) e.serverId = r.event!.id; }); return; }
            // ISS-105: a create the server REFUSED must not linger as a phantom. With no
            // serverId it survives every hydrate (mergeServerAuthoritative reads it as a
            // never-synced offline draft), so it looks saved on this device while existing
            // nowhere else — no other device, and no server. This branch didn't exist:
            // the failure was swallowed entirely. Roll it back and say so.
            commit((d) => { d.events = d.events.filter((x) => x.id !== id); });
            toast({
              kind: "error",
              title: "Couldn't save that event",
              message: r.error === "invalid_startAt" || r.error === "invalid_endAt"
                ? "That date or time isn't valid — check it and try again."
                : r.error === "backend_unreachable"
                  ? "Couldn't reach the server — nothing was saved."
                  : "The server refused it — nothing was saved.",
            });
          });
      }
      return id;
    },

    /* --------------------------- spaces + members ------------------------- */
    createSpace: (input) => {
      const id = uid("space");
      commit((d) => {
        d.spaces.push({
          id,
          name: input.name,
          type: input.type,
          description: input.description ?? "",
          icon: input.icon ?? "Folder",
          accent: input.accent ?? "ink",
          memberIds: input.memberIds ?? [],
          agentIds: [],
          connectionIds: [],
          sensitive: input.sensitive ?? false,
          createdAt: nowISO(),
          updatedAt: nowISO(),
        });
      });
      toast({ kind: "success", title: "Space created" });
      return id;
    },
    updateSpace: (id, patch) =>
      commit((d) => {
        const s = d.spaces.find((x) => x.id === id);
        if (s) Object.assign(s, patch, { updatedAt: nowISO() });
      }),
    deleteSpace: (id) => {
      commit((d) => {
        d.spaces = d.spaces.filter((x) => x.id !== id);
      });
      toast({ kind: "info", title: "Space removed" });
    },
    updateMember: (id, patch) => {
      commit((d) => {
        const m = d.members.find((x) => x.id === id);
        if (m) Object.assign(m, patch, { updatedAt: nowISO() });
      });
      toast({ kind: "info", title: "Member updated" });
    },
    createMember: (input) => {
      const id = uid("member");
      commit((d) => {
        d.members.push({
          id,
          displayName: input.displayName,
          role: input.role ?? "Adult Member",
          avatarColor: input.avatarColor ?? "sky",
          initials: input.initials ?? input.displayName.slice(0, 2).toUpperCase(),
          relationship: input.relationship ?? "Family member",
          spaceIds: input.spaceIds ?? [],
          email: input.email,
          createdAt: nowISO(),
          updatedAt: nowISO(),
        });
      });
      toast({ kind: "success", title: "Member added" });
      return id;
    },
    deleteMember: (id) => {
      commit((d) => {
        d.members = d.members.filter((x) => x.id !== id);
      });
      toast({ kind: "info", title: "Member removed" });
    },
    toggleSpaceMember: (spaceId, memberId) =>
      // Keep both sides of the membership relation in sync (P2-DATA-002).
      commit((d) => {
        const s = d.spaces.find((x) => x.id === spaceId);
        const m = d.members.find((x) => x.id === memberId);
        if (!s) return;
        const isMember = s.memberIds.includes(memberId);
        if (isMember) {
          s.memberIds = s.memberIds.filter((x) => x !== memberId);
          if (m) m.spaceIds = (m.spaceIds ?? []).filter((x) => x !== spaceId);
        } else {
          s.memberIds = [...s.memberIds, memberId];
          if (m && !m.spaceIds?.includes(spaceId)) m.spaceIds = [...(m.spaceIds ?? []), spaceId];
        }
        s.updatedAt = nowISO();
      }),

    /* ------------------------------ settings ------------------------------ */
    updateSettings: (patch) =>
      commit((d) => {
        d.settings = { ...d.settings, ...patch };
      }),
    setActiveProvider: (id) => {
      commit((d) => {
        d.settings.ai.activeProvider = id;
      });
      toast({ kind: "info", title: "AI provider updated", message: id === "local" ? "Using the local rules engine." : "Real providers are configured by the deployment." });
    },
  };
});
