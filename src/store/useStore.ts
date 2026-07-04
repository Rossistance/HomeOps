import { create } from "zustand";
import type {
  AppData,
  Agent,
  AgentStatus,
  ApprovalRequest,
  Automation,
  ContactMethod,
  FileAsset,
  KnowledgeItem,
  MemoryEntry,
  MemoryType,
  MiniApp,
  Playbook,
  Route,
  ScreenId,
  Space,
  Member,
  Task,
  TaskStatus,
  TriggerType,
  CalendarEvent,
  AssistantConversation,
  MessageThread,
  AppSettings,
  WorkflowPlan,
  WorkflowStep,
  AutomationRun,
  RunStep,
  RunStatus,
  SearchResult,
  Role,
  EvolutionProposal,
} from "@/types";
import { buildSeedData, buildEmptyData } from "@/data/seed";
import { agentTemplates } from "@/data/agentTemplates";
import { playbookCatalog } from "@/data/playbooksCatalog";
import { workflowTemplates } from "@/data/workflowTemplates";
import { loadAppData, saveAppData, clearAppData, detectStorageMode, type StorageMode } from "@/storage/db";
import { uid } from "@/lib/ids";
import { pushActivity, executeAgentRun, subagentDefsFor, processFile } from "@/lib/runtime";
import { parseAgentPrompt, buildWorkflowPlan, routeToAgent, detectApprovalGates } from "@/lib/ai";
import { buildSearchIndex, search } from "@/lib/search";
import { getAdvancedMode, setAdvancedMode } from "@/lib/prefs";
import { backend, type BackendConnector, type BackendHealth, type ExecResult, type Session, type ConnectorProvider, type ConnectedAccount, type AgentPlan, type GeneratedMiniApp, type GeneratedPlaybook, type ServerRun, type ServerEvent, type ServerTask, type ServerConversation, type ServerMemory, type ServerAgent } from "@/connectors/api";

/** A plan shape the live runner can execute (AgentPlan satisfies this). */
export interface RunnableStep { toolId: string | null; title: string; detail: string; input: Record<string, unknown>; requiresApproval: boolean }
export interface RunnablePlan { title?: string; summary?: string; steps: RunnableStep[] }

/* ---- Server run → local projection (the SERVER is the source of truth; the
   client mirrors its durable runs into the existing AutomationRun shape) ---- */
function mapRunStatus(s: string): RunStatus {
  if (s === "completed") return "Completed";
  if (s === "failed" || s === "cancelled" || s === "expired") return "Failed";
  if (s === "waiting_for_approval" || s === "waiting_for_connector" || s === "waiting_for_provider") return "Waiting for Approval";
  return "Running";
}
function mapStepStatus(s: string): RunStep["status"] {
  if (s === "succeeded") return "done";
  if (s === "running") return "running";
  if (s === "skipped") return "skipped"; // a denied/expired gate never ran — don't show it as done
  if (s === "waiting_for_approval" || s === "blocked" || s === "failed") return "blocked";
  return "pending";
}
const TERMINAL_RUN = ["completed", "failed", "cancelled", "expired"];
const PARKED_RUN = ["waiting_for_approval", "waiting_for_connector", "waiting_for_provider"];
// Renders a tool's resolved input into a human-readable preview instead of the generic
// "Draft prepared by your helper agent…" boilerplate — this is the actual, real content
// (which messages, what label, the literal draft text) the human is being asked to
// approve, not a description OF a description. A long comma-joined id list (e.g. 93
// message ids) collapses to a count — the ids themselves aren't meaningful to a human.
function formatApprovalInput(input: Record<string, unknown> | undefined | null): string {
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
function runFromServer(sr: ServerRun, ctx: { agentId: string; automationId?: string; label?: string; startedAt: string }): AutomationRun {
  const status = mapRunStatus(sr.status);
  const ran = sr.steps.filter((s) => s.status === "succeeded").length;
  // A connector/provider wait has no approval to act on — say so plainly rather than
  // telling the user to "approve the gated step" (there's nothing to approve).
  const waitingSummary = sr.status === "waiting_for_connector" || sr.status === "waiting_for_provider"
    ? "Paused — connect the required service to continue."
    : "Paused — approve the gated step to finish.";
  const outputSummary = status === "Waiting for Approval"
    ? waitingSummary
    : status === "Failed"
      ? `${ran} step(s) ran; some couldn't complete — see details.`
      : status === "Completed"
        ? `Completed ${ran} live action(s).`
        : "Running…";
  return {
    id: sr.id,
    automationId: ctx.automationId,
    agentId: ctx.agentId,
    triggerLabel: ctx.label ?? "Live run",
    status,
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
    subagentRunIds: [],
    activityEntryIds: [],
    error: sr.error ?? undefined,
  };
}

/** Convert a planner AgentPlan into the legacy WorkflowPlan shape stored on automations. */
function workflowPlanFromAgentPlan(plan: AgentPlan, agentId: string, agentName: string): WorkflowPlan {
  const steps: WorkflowStep[] = plan.steps.map((s, i) => ({ id: `step-${i + 1}`, order: i + 1, label: s.title, detail: s.detail, tool: s.toolId ?? undefined, needsApproval: s.requiresApproval }));
  return {
    trigger: `${plan.triggerType}${plan.triggerDetail ? ` · ${plan.triggerDetail}` : ""}`,
    inputSources: plan.requiredConnectors.map((c) => c.name),
    agentId,
    agentName,
    steps,
    toolsActions: [...new Set(plan.steps.map((s) => s.toolId).filter(Boolean))] as string[],
    approvalGates: plan.approvalGates.length ? plan.approvalGates : ["No external action — runs without approval."],
    output: plan.summary || "In-app summary",
    notifications: ["In-app notification", "Message thread"],
    errorHandling: "If a connector isn't ready or confidence is low, the agent stops and asks rather than guessing.",
    activityLogging: "Trigger fired → steps executed → output delivered (each logged with status).",
  };
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
  automations: "Adult Member",
  activity: "Adult Member",
};
export function screenAllowedForRole(screen: ScreenId, role: Role | undefined): boolean {
  const min = SCREEN_MIN_ROLE[screen];
  return !min || roleAtLeast(role, min);
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
// Merge server-registry agents into client state (server-wins-by-id, same pattern as
// events/tasks/memory). Chat-built agents exist ONLY server-side — without this merge
// they never appeared in Helper Agents even though the chat truthfully said "created".
// For ids that already exist locally, only server-authoritative fields are overlaid so
// local presentation wiring (space, owner, playbooks, files) is preserved.
function mergeServerAgents(d: AppData, serverAgents: ServerAgent[], opts: { connectors: BackendConnector[]; providers: ConnectorProvider[]; actorId?: string }) {
  // Deletion propagates: a local agent that WAS server-backed (has serverId) but is no
  // longer in the server registry was deleted there — drop the local ghost. Purely
  // local agents (no serverId yet) are always kept.
  const serverIds = new Set(serverAgents.map((a) => a.id));
  d.agents = d.agents.filter((a) => !a.serverId || serverIds.has(a.serverId));
  for (const sa of serverAgents) {
    const local = d.agents.find((a) => a.id === sa.id || a.serverId === sa.id);
    if (local) {
      local.serverId = sa.id;
      local.name = sa.name;
      local.purpose = sa.purpose;
      local.instructions = sa.instructions;
      local.status = sa.status;
      if (sa.allowedToolIds.length) {
        local.allowedToolIds = sa.allowedToolIds;
        const conns = connectorIdsForToolIds(sa.allowedToolIds, opts.connectors, opts.providers);
        if (conns.length) local.connectionIds = conns;
      }
    } else {
      const space = d.spaces.find((s) => s.type === sa.spaceType) ?? d.spaces.find((s) => s.id === "sp-family") ?? d.spaces[0];
      d.agents.unshift({
        id: sa.id, serverId: sa.id, name: sa.name, icon: sa.icon || "Bot", purpose: sa.purpose,
        status: sa.status, spaceId: space?.id ?? "sp-family",
        ownerMemberId: opts.actorId ?? d.members.find((m) => m.isCurrentUser)?.id ?? d.members[0]?.id ?? "",
        instructions: sa.instructions,
        connectionIds: connectorIdsForToolIds(sa.allowedToolIds, opts.connectors, opts.providers),
        allowedToolIds: sa.allowedToolIds,
        playbookIds: [], memoryIds: [], knowledgeItemIds: [], fileIds: [],
        approvalPolicy: sa.approvalPolicy ?? { autoAllow: [], alwaysApprove: [] },
        safetyLimits: [],
        createdAt: new Date(sa.createdAt).toISOString(), updatedAt: sa.updatedAt,
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
  loginAs: (memberId: string, pin?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  currentRole: () => Role;
  canAccess: (screen: ScreenId) => boolean;

  /* navigation + UI */
  navigate: (screen: ScreenId, params?: Record<string, string>) => void;
  setCommandOpen: (open: boolean) => void;
  setSpaceFilter: (id: string) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  /* derived */
  currentMember: () => Member;
  searchEverything: (q: string) => SearchResult[];
  planFromPrompt: (prompt: string) => {
    plan: WorkflowPlan;
    agentId: string;
    agentName: string;
    approvalRequired: boolean;
  };

  /* agents */
  createAgent: (input: Partial<Agent> & { name: string }) => string;
  createAgentFromTemplate: (templateId: string) => string;
  createAgentFromPrompt: (prompt: string) => string;
  createAgentFromPlan: (plan: AgentPlan, opts?: { connectorIds?: string[]; status?: AgentStatus }) => string;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  setAgentStatus: (id: string, status: AgentStatus) => void;
  duplicateAgent: (id: string) => string;
  deleteAgent: (id: string) => void;
  runAgent: (id: string) => string;
  runAgentLive: (id: string) => Promise<string>;

  /* planner brain (plain English → real plan, mini app, playbook) */
  planAgentFromGoal: (goal: string) => Promise<{ ok: boolean; plan?: AgentPlan; error?: string; message?: string }>;
  generateMiniAppFromGoal: (input: { goal: string; type?: string }) => Promise<{ ok: boolean; app?: GeneratedMiniApp; error?: string; message?: string }>;
  generatePlaybookFromGoal: (goal: string) => Promise<{ ok: boolean; playbook?: GeneratedPlaybook; error?: string; message?: string }>;
  runPlan: (plan: RunnablePlan, opts?: { agentId?: string; automationId?: string; label?: string }) => Promise<string>;
  /** Poll a durable SERVER run to terminal/parked and mirror it into local state. */
  syncServerRun: (runId: string) => Promise<void>;
  // Assistant — the conversational NL → plan → approval → execution → history loop.
  startConversation: (text: string) => Promise<string>;
  sendToAssistant: (conversationId: string, text: string) => Promise<void>;
  runConversationPlan: (conversationId: string, messageId: string) => Promise<void>;
  buildFromChat: (conversationId: string, messageId: string) => Promise<void>;
  deleteConversation: (id: string) => void;
  // Evolution — evidence-backed improvement proposals from real run traces.
  maybeProposeEvolution: (runId: string) => Promise<void>;
  reviewEvolution: (id: string, accept: boolean) => Promise<void>;

  /* connectors (real backend infrastructure) */
  connectors: BackendConnector[];
  providers: ConnectorProvider[];      // first-party OAuth provider platform
  accounts: ConnectedAccount[];        // current actor's connected accounts
  backendHealth: BackendHealth | null;
  backendOnline: boolean;
  externalActionsEnabled: boolean;
  loadBackend: () => Promise<void>;
  hydrateFromServer: () => Promise<void>;
  migrateAgentsToServer: () => Promise<void>;
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

  /* automations */
  createAutomation: (input: Partial<Automation> & { name: string; agentId: string; plan: WorkflowPlan }) => string;
  createAutomationFromPlan: (plan: AgentPlan, opts?: { enabled?: boolean; connectorIds?: string[] }) => string;
  updateAutomation: (id: string, patch: Partial<Automation>) => void;
  toggleAutomation: (id: string) => void;
  runAutomation: (id: string, opts?: { forceFail?: boolean }) => string;
  testAutomation: (id: string) => Promise<string>;
  deleteAutomation: (id: string) => void;
  createAutomationFromTemplate: (templateId: string) => string;

  /* messages + approvals */
  sendMessage: (threadId: string, body: string) => void;
  createThread: (input: Partial<MessageThread> & { title: string }) => string;
  resolveThread: (id: string) => void;
  escalateThread: (id: string) => void;
  reopenThread: (id: string) => void;
  markThreadRead: (id: string) => void;
  addContactMethod: (memberId: string, input: Partial<ContactMethod> & { label: string; value: string }) => void;
  verifyContactMethod: (id: string) => void;
  setContactAllowedAgents: (id: string, agentIds: string[]) => void;
  approveRequest: (id: string, newPreview?: string) => Promise<void>;
  denyRequest: (id: string) => Promise<void>;
  askAgentForChanges: (id: string, note: string) => Promise<void>;
  requestApproval: (input: {
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
  }) => string;

  /* files + knowledge */
  uploadFiles: (files: File[], spaceId?: string) => Promise<string[]>;
  addSampleFile: (input: Partial<FileAsset> & { name: string }) => string;
  updateFile: (id: string, patch: Partial<FileAsset>) => void;
  deleteFile: (id: string) => void;
  toggleFileSensitive: (id: string) => void;
  processFileById: (id: string) => void;
  createKnowledgeItem: (input: Partial<KnowledgeItem> & { title: string }) => string;
  updateKnowledgeItem: (id: string, patch: Partial<KnowledgeItem>) => void;
  deleteKnowledgeItem: (id: string) => void;

  /* playbooks */
  createPlaybook: (input: Partial<Playbook> & { name: string }) => string;
  updatePlaybook: (id: string, patch: Partial<Playbook>) => void;
  duplicatePlaybook: (id: string) => string;
  archivePlaybook: (id: string) => void;
  deletePlaybook: (id: string) => void;
  runPlaybook: (id: string) => Promise<void>;
  addPlaybookFromCatalog: (catalogId: string) => string;

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
  toggleSoloMode: () => void;
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

  return {
    /* ----- initial UI state (data replaced on init) ----- */
    data: buildSeedData(),
    route: { screen: "dashboard" },
    ready: false,
    storageMode: "indexeddb",
    commandOpen: false,
    spaceFilter: "all",
    toasts: [],
    session: null,
    needsOnboarding: false,
    authBusy: false,

    /* ----------------------------- lifecycle ----------------------------- */
    init: async () => {
      const mode = await detectStorageMode();
      const data = await loadAppData();
      if (!data) {
        // Fresh, no-data first run → real onboarding (no auto-seeding of a sample).
        set({ ready: true, storageMode: mode, needsOnboarding: true, storageError: mode === "unavailable" ? "Browser storage is unavailable — changes will not be saved." : undefined });
        return;
      }
      set({ data, ready: true, storageMode: mode, needsOnboarding: false, storageError: mode === "unavailable" ? "Browser storage is unavailable — changes will not be saved." : undefined });
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
        set({ session: s });
        // align the active persona with the authenticated session actor
        commit((d) => { if (d.members.some((m) => m.id === s.actorId)) d.members.forEach((m) => (m.isCurrentUser = m.id === s.actorId)); });
        void get().loadBackend();
      } else {
        set({ session: null });
      }
    },
    loginAs: async (memberId, pin) => {
      const m = get().data.members.find((x) => x.id === memberId);
      if (!m) return false;
      set({ authBusy: true });
      const r = await backend.login({ actorId: m.id, actorName: m.displayName, role: m.role, pin });
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
          set({ session: s, authBusy: false });
          toast({ kind: "success", title: "Household registered with the backend", message: "Your profile now owns the server household — connections and AI providers are unlocked." });
          void get().loadBackend();
          return true;
        }
      }
      if (r.error === "unknown_actor" || r.error === "member_archived") {
        set({ authBusy: false, session: null });
        toast({ kind: "error", title: r.error === "member_archived" ? "Profile removed" : "Profile not registered with the backend", message: r.message ?? "Ask an Owner to add this profile in Settings → Household." });
        return false;
      }
      // Local-first fallback ONLY when the backend is unreachable (offline dev):
      // establish a local persona so role-gated UI works; server mutations stay
      // gated server-side and server-backed screens will show their offline states.
      const session: Session = r.session ?? { actorId: m.id, actorName: m.displayName, role: m.role, csrf: "", householdId: "local" };
      if (!r.session) toast({ kind: "warn", title: "Backend offline", message: "Signed in locally — connections, AI providers, and approvals stay unavailable until the backend is reachable." });
      commit((d) => d.members.forEach((x) => (x.isCurrentUser = x.id === memberId)));
      set({ session, authBusy: false });
      void get().loadBackend();
      return true;
    },
    logout: async () => {
      await backend.logout();
      set({ session: null });
      toast({ kind: "info", title: "Signed out", message: "Pick a profile to continue." });
    },
    currentRole: () => get().session?.role as Role ?? get().currentMember().role,
    canAccess: (screen) => screenAllowedForRole(screen, (get().session?.role as Role) ?? get().currentMember().role),
    reseed: async () => {
      await clearAppData();
      const data = buildSeedData();
      await saveAppData(data).catch(() => {});
      set({ data });
      const owner = data.members.find((m) => m.isCurrentUser) ?? data.members[0];
      if (owner) await get().loginAs(owner.id);
      toast({ kind: "success", title: "Sample data reset", message: "The Harper household sample has been restored." });
    },
    startFresh: async () => {
      // Wipe all local household data and the session, then drop back to first-run
      // onboarding so the user can create (or import) their own household.
      await backend.logout().catch(() => {});
      await clearAppData().catch(() => {});
      set({ session: null, needsOnboarding: true, connectors: [], providers: [], accounts: [], spaceFilter: "all", route: { screen: "dashboard" } });
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
      // Advanced screens are hidden from the nav by default, but flows may legitimately
      // land here (function deep links, playbook chips, activity entries). Auto-enable
      // Advanced Mode on arrival so the nav entries appear and the user isn't stranded
      // on a screen they can't navigate back to. (User-chosen behavior, item 14.)
      const ADVANCED_SCREENS: ScreenId[] = ["skills", "functions", "playbooks"];
      if (ADVANCED_SCREENS.includes(screen) && !getAdvancedMode()) {
        setAdvancedMode(true);
        toast({ kind: "info", title: "Advanced Mode enabled", message: "Skills and Functions are now in your menu — turn Advanced Mode off in Settings anytime." });
      }
      set({ route: { screen, params }, commandOpen: false });
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
    planFromPrompt: (prompt) => {
      const d = get().data;
      const routed = routeToAgent(prompt, d.agents);
      const parsed = parseAgentPrompt(prompt);
      const agentId = routed?.id ?? "";
      const agentName = routed?.name ?? parsed.name;
      const plan = buildWorkflowPlan(prompt, { agentId, agentName });
      const { gates } = detectApprovalGates(prompt);
      return { plan, agentId, agentName, approvalRequired: gates.length > 0 };
    },

    /* ------------------------------- agents ------------------------------- */
    createAgent: (input) => {
      const id = uid("agent");
      commit((d) => {
        const space = input.spaceId ? d.spaces.find((s) => s.id === input.spaceId) : findSpaceByType(d, "Personal");
        const agent: Agent = {
          id,
          name: input.name,
          icon: input.icon ?? "Bot",
          purpose: input.purpose ?? "Helps with household tasks.",
          status: input.status ?? "Draft",
          spaceId: input.spaceId ?? space?.id ?? d.spaces[0].id,
          ownerMemberId: input.ownerMemberId ?? (d.members.find((m) => m.isCurrentUser)?.id ?? d.members[0].id),
          templateId: input.templateId,
          instructions: input.instructions ?? "",
          connectionIds: input.connectionIds ?? [],
          allowedToolIds: input.allowedToolIds ?? [],
          playbookIds: input.playbookIds ?? [],
          memoryIds: input.memoryIds ?? [],
          knowledgeItemIds: input.knowledgeItemIds ?? [],
          fileIds: input.fileIds ?? [],
          approvalPolicy: input.approvalPolicy ?? { autoAllow: [], alwaysApprove: [] },
          safetyLimits: input.safetyLimits ?? ["Asks for approval before any action outside the household."],
          createdAt: nowISO(),
          updatedAt: nowISO(),
        };
        d.agents.unshift(agent);
        if (space && !space.agentIds.includes(id)) space.agentIds.push(id);
        pushActivity(d, {
          actorType: "user",
          actorId: d.members.find((m) => m.isCurrentUser)?.id ?? "user",
          actorName: d.members.find((m) => m.isCurrentUser)?.displayName ?? "You",
          actionType: "agent.created",
          description: `Created helper agent “${agent.name}”`,
          entityType: "agent",
          entityId: id,
          spaceId: agent.spaceId,
          status: "success",
        });
      });
      toast({ kind: "success", title: "Helper agent created", message: input.name });
      return id;
    },
    createAgentFromTemplate: (templateId) => {
      const tmpl = agentTemplates.find((t) => t.id === templateId);
      const d0 = get().data;
      const space = tmpl ? findSpaceByType(d0, tmpl.defaultSpaceType) : undefined;
      const connIds = tmpl ? connectorIdsForNames(tmpl.suggestedConnections) : [];
      const playbookIds = tmpl
        ? d0.playbooks.filter((p) => tmpl.suggestedPlaybooks.some((n) => p.name === n)).map((p) => p.id)
        : [];
      return get().createAgent({
        name: tmpl?.name ?? "New Agent",
        icon: tmpl?.icon ?? "Bot",
        purpose: tmpl?.purpose ?? "",
        instructions: tmpl?.defaultInstructions ?? "",
        status: "Active",
        templateId,
        spaceId: space?.id,
        connectionIds: connIds,
        allowedToolIds: toolIdsForConnectorIds(connIds, get().connectors, get().providers),
        playbookIds,
        approvalPolicy: { autoAllow: tmpl?.defaultAutoAllow ?? [], alwaysApprove: tmpl?.defaultApprovalRules ?? [] },
        safetyLimits: tmpl?.defaultApprovalRules ?? [],
      });
    },
    createAgentFromPrompt: (prompt) => {
      const parsed = parseAgentPrompt(prompt);
      const d0 = get().data;
      const space = d0.spaces.find((s) => s.type === parsed.spaceType);
      const connIds = connectorIdsForNames(parsed.connections);
      return get().createAgent({
        name: parsed.name,
        icon: parsed.icon,
        purpose: parsed.purpose,
        instructions: parsed.instructions,
        status: "Draft",
        spaceId: space?.id,
        connectionIds: connIds,
        allowedToolIds: toolIdsForConnectorIds(connIds, get().connectors, get().providers),
        approvalPolicy: {
          autoAllow: ["Create a draft", "Create a reminder", "Add a task", "Generate a summary", "Tag a file"],
          alwaysApprove: parsed.approvalGates,
        },
        safetyLimits: parsed.approvalGates.length ? parsed.approvalGates : ["Asks before acting outside the household."],
      });
    },
    updateAgent: (id, patch) =>
      commit((d) => {
        const a = d.agents.find((x) => x.id === id);
        if (a) Object.assign(a, patch, { updatedAt: nowISO() });
      }),
    setAgentStatus: (id, status) => {
      commit((d) => {
        const a = d.agents.find((x) => x.id === id);
        if (a) {
          a.status = status;
          a.updatedAt = nowISO();
          pushActivity(d, {
            actorType: "user",
            actorId: d.members.find((m) => m.isCurrentUser)?.id ?? "user",
            actorName: "You",
            actionType: status === "Archived" ? "agent.archived" : status === "Paused" ? "agent.paused" : "agent.updated",
            description: `${a.name} → ${status}`,
            entityType: "agent",
            entityId: id,
            spaceId: a.spaceId,
            status: "info",
          });
        }
      });
      toast({ kind: "info", title: `Agent ${status.toLowerCase()}` });
    },
    duplicateAgent: (id) => {
      const newId = uid("agent");
      commit((d) => {
        const a = d.agents.find((x) => x.id === id);
        if (a) {
          const copy: Agent = { ...structuredClone(a), id: newId, name: `${a.name} (Copy)`, status: "Draft", createdAt: nowISO(), updatedAt: nowISO() };
          d.agents.unshift(copy);
          pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "agent.created", description: `Duplicated “${a.name}”`, entityType: "agent", entityId: newId, status: "success" });
        }
      });
      toast({ kind: "success", title: "Agent duplicated" });
      return newId;
    },
    runAgent: (id) => {
      let runId = "";
      commit((d) => {
        const automation = d.automations.find((a) => a.agentId === id && a.enabled) ?? d.automations.find((a) => a.agentId === id);
        const res = executeAgentRun(d, {
          agentId: id,
          automation,
          triggerLabel: "Manual run",
          manual: true,
          subagents: subagentDefsFor(automation),
        });
        runId = res.runId;
      });
      const last = get().data.runs.find((r) => r.id === runId);
      toast({
        kind: last?.status === "Waiting for Approval" ? "warn" : "success",
        title: last?.status === "Waiting for Approval" ? "Run paused for approval" : "Agent run complete",
        message: last?.outputSummary,
      });
      return runId;
    },
    createAgentFromPlan: (plan, opts) => {
      const d0 = get().data;
      const space = d0.spaces.find((s) => s.type === plan.spaceType);
      const finalConnectorIds = new Set(opts?.connectorIds ?? plan.connectorIds);
      // Every tool the plan's steps actually use — EXCEPT tools behind a connector the
      // user unchecked in the plan-preview step (a step with no connector, e.g. an
      // internal homeops.* tool or a reasoning step, is always kept).
      const allowedToolIds = [...new Set(
        plan.steps
          .filter((s) => s.toolId && (s.connectorId == null || finalConnectorIds.has(s.connectorId)))
          .map((s) => s.toolId),
      )] as string[];
      return get().createAgent({
        name: plan.title,
        icon: plan.icon,
        purpose: plan.summary || plan.title,
        instructions: plan.instructions,
        status: opts?.status ?? "Draft",
        spaceId: space?.id,
        connectionIds: opts?.connectorIds ?? plan.connectorIds,
        allowedToolIds,
        approvalPolicy: {
          autoAllow: plan.steps.filter((s) => s.toolId && !s.requiresApproval).map((s) => s.title),
          alwaysApprove: plan.approvalGates,
        },
        safetyLimits: plan.approvalGates.length ? plan.approvalGates : ["Asks before any action that leaves the household."],
      });
    },
    deleteAgent: (id) => {
      commit((d) => {
        const a = d.agents.find((x) => x.id === id);
        d.agents = d.agents.filter((x) => x.id !== id);
        d.spaces.forEach((s) => { s.agentIds = s.agentIds.filter((x) => x !== id); });
        if (a) pushActivity(d, { actorType: "user", actorId: get().session?.actorId ?? "user", actorName: get().session?.actorName ?? "You", actionType: "agent.deleted", description: `Deleted agent “${a.name}”`, entityType: "agent", entityId: id, spaceId: a.spaceId, status: "warning" });
      });
      toast({ kind: "info", title: "Agent deleted" });
    },
    runAgentLive: async (id) => {
      const d0 = get().data;
      const agent = d0.agents.find((a) => a.id === id);
      if (!agent) return "";
      const isReal = (tid: string) => !!get().connectors.find((c) => c.tools.some((t) => t.id === tid)) || !!get().providers.find((p) => p.tools.some((t) => t.id === tid));
      // Prefer the agent's enabled automation plan if it references real tools.
      const auto = d0.automations.find((a) => a.agentId === id && a.enabled) ?? d0.automations.find((a) => a.agentId === id);
      let steps: RunnableStep[] = (auto?.plan.steps ?? [])
        .filter((s) => s.tool && isReal(s.tool))
        .map((s) => ({ toolId: s.tool as string, title: s.label, detail: s.detail, input: {}, requiresApproval: !!s.needsApproval }));
      // Otherwise, a read-only pass over the agent's allowed read tools.
      if (!steps.length) {
        steps = agent.allowedToolIds
          .filter((tid) => isReal(tid))
          .map((tid) => {
            const tool = get().providers.flatMap((p) => p.tools).find((t) => t.id === tid) ?? get().connectors.flatMap((c) => c.tools).find((t) => t.id === tid);
            return tool && !tool.requiresApproval ? { toolId: tid, title: tool.name, detail: "Read current data.", input: {}, requiresApproval: false } : null;
          })
          .filter(Boolean) as RunnableStep[];
      }
      if (!steps.length) return get().runAgent(id); // nothing real to run → local summary
      return get().runPlan({ title: agent.name, summary: agent.purpose, steps }, { agentId: id, label: "Manual run" });
    },

    /* ---------------------------- planner brain --------------------------- */
    planAgentFromGoal: async (goal) => {
      const r = await backend.plan(goal);
      if (!r.ok || !r.plan) toast({ kind: "warn", title: r.error === "no_provider" ? "Connect an AI provider first" : "Couldn't generate", message: r.message ?? r.error });
      return { ok: !!(r.ok && r.plan), plan: r.plan, error: r.error, message: r.message };
    },
    generateMiniAppFromGoal: async ({ goal, type }) => {
      const r = await backend.generateMiniApp({ goal, type });
      if (!r.ok || !r.app) toast({ kind: "warn", title: r.error === "no_provider" ? "Connect an AI provider first" : "Couldn't generate", message: r.message ?? r.error });
      return { ok: !!(r.ok && r.app), app: r.app, error: r.error, message: r.message };
    },
    generatePlaybookFromGoal: async (goal) => {
      const r = await backend.generatePlaybook(goal);
      if (!r.ok || !r.playbook) toast({ kind: "warn", title: r.error === "no_provider" ? "Connect an AI provider first" : "Couldn't generate", message: r.message ?? r.error });
      return { ok: !!(r.ok && r.playbook), playbook: r.playbook, error: r.error, message: r.message };
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
        source: opts.automationId ? "automation" : agentId ? "agent" : "manual",
        sourceRef: { agentId: agentId || undefined, automationId: opts.automationId },
      });
      if (!started.run) {
        toast({ kind: "error", title: "Couldn't start run", message: started.error === "backend_unreachable" ? "The HomeOps runtime isn't reachable. Start it with `npm run dev`." : started.error ?? "Run could not start." });
        return "";
      }
      const ctx = { agentId, automationId: opts.automationId, label: opts.label, startedAt };
      commit((d) => {
        const mapped = runFromServer(started.run!, ctx);
        const i = d.runs.findIndex((r) => r.id === mapped.id);
        if (i >= 0) d.runs[i] = { ...d.runs[i], ...mapped }; else d.runs.unshift(mapped);
      });
      await get().syncServerRun(started.run.id);
      const finalRun = get().data.runs.find((r) => r.id === started.run!.id);
      const status = finalRun?.status ?? "Running";
      toast({
        kind: status === "Failed" ? "error" : status === "Waiting for Approval" ? "warn" : status === "Completed" ? "success" : "info",
        title: status === "Completed" ? "Run complete" : status === "Waiting for Approval" ? "Run paused for approval" : status === "Failed" ? "Run had problems" : "Run started",
        message: finalRun?.outputSummary,
      });
      // The server records an evidence-backed proposal on failure (engine.mjs); the
      // client baseline keeps the Improvements tab populated until Slice 7 surfaces
      // server-side proposals directly.
      if (status === "Failed") void get().maybeProposeEvolution(started.run.id);
      return started.run.id;
    },
    syncServerRun: async (runId) => {
      // Poll the server run until it reaches a terminal or parked state, mirroring
      // each snapshot into the local AutomationRun. When parked for approval, project
      // the server-created approval into the console so the existing UI can decide it.
      const existing = get().data.runs.find((r) => r.id === runId);
      const ctx = { agentId: existing?.agentId ?? "", automationId: existing?.automationId, label: existing?.triggerLabel, startedAt: existing?.startedAt ?? nowISO() };
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
            dataUsedSummary: gated.connectorName ?? "HomeOps",
            previewContent: [gated.detail || gated.title, inputPreview].filter(Boolean).join("\n\n") || `${gated.title}\n\nApprove to let HomeOps run this step.`,
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
    startConversation: async (text) => {
      const t = (text ?? "").trim();
      let id = uid("conv");
      const now = nowISO();
      // Server-owned thread when online — history is then durable + actor-scoped. Falls
      // back to a local-only conversation when the backend is unreachable.
      if (get().backendOnline) {
        const r = await backend.createConversation((t || "New chat").slice(0, 48));
        if (r.conversation) id = r.conversation.id;
      }
      commit((d) => { (d.conversations ??= []).unshift({ id, title: (t || "New chat").slice(0, 48), createdAt: now, updatedAt: now, messages: [] }); });
      get().navigate("assistant", { id });
      if (t) await get().sendToAssistant(id, t);
      return id;
    },
    sendToAssistant: async (conversationId, text) => {
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
          .filter((e) => { const ts = +new Date(e.startAt); return ts >= now - 36e5 && ts <= now + 7 * 864e5; })
          .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)).slice(0, 8)
          .map((e) => ({ title: e.title, when: e.startAt, location: e.location ?? "" })),
        openTasks: d0.tasks.filter((tk) => tk.status !== "done").slice(0, 10).map((tk) => ({ title: tk.title, due: tk.dueAt ?? "", type: tk.type })),
        pendingApprovals: d0.approvals.filter((a) => a.status === "Pending").length,
        liveConnectors: s.connectors.filter((c) => c.live).map((c) => c.name),
        connectedAccounts: s.accounts.filter((a) => a.status === "connected").map((a) => `${a.provider} (${a.displayName})`),
      };
      // Use SSE streaming so the UI shows a live "generating" indicator while the AI
      // is working. Transitions from "thinking" → "streaming" on first progress event.
      // Pass conversationId so the server persists the turn into the durable thread
      // (when the conversation is server-owned). The server also re-grounds on its own
      // visibility-filtered view of the household — the client context is just a hint.
      const r = await backend.streamAssistant({ message: t, context: ctx, conversationId }, (tokens) => {
        if (tokens === 4) {
          commit((d) => {
            const c = d.conversations?.find((x) => x.id === conversationId); if (!c) return;
            const m = c.messages.find((x) => x.id === aMsgId); if (!m) return;
            m.status = "streaming";
          });
        }
      });
      commit((d) => {
        const c = d.conversations?.find((x) => x.id === conversationId); if (!c) return;
        const m = c.messages.find((x) => x.id === aMsgId); if (!m) return;
        if (!r.ok) {
          m.status = "error";
          m.error = r.message ?? r.error;
          m.text = r.error === "no_provider"
            ? "I need an AI provider to think. Connect one in Settings → AI Providers, then ask me again."
            : r.error === "backend_unreachable"
              ? "I can't reach the HomeOps runtime. Make sure it's running (npm run dev), then try again."
              : "I couldn't reach the AI provider just now. Check it's configured and reachable in Settings → AI Providers, then ask me again.";
        } else if (r.kind === "plan" && r.plan) {
          m.status = "planned"; m.text = r.answer || r.plan.summary || "Here's my plan."; m.plan = r.plan; m.model = r.model;
        } else if (r.kind === "build" && r.build) {
          m.status = "planned"; m.text = r.answer || r.build.summary || "Here's what I'll set up."; m.build = r.build; m.model = r.model;
        } else {
          m.status = "answered"; m.text = r.answer || "I'm not sure how to help with that yet."; m.model = r.model;
        }
        c.updatedAt = nowISO();
      });
    },
    // Unified chat-builder: approve a proposed build and materialize it server-side, then
    // mark the chat message "built" and append a confirmation listing what was created.
    buildFromChat: async (conversationId, messageId) => {
      const c = get().data.conversations?.find((x) => x.id === conversationId);
      const m = c?.messages.find((x) => x.id === messageId);
      if (!m?.build) return;
      commit((d) => { const mm = d.conversations?.find((x) => x.id === conversationId)?.messages.find((x) => x.id === messageId); if (mm) { mm.status = "running"; mm.buildProgress = []; } });
      // Stream per-entity progress so the card checks off each piece as it's built.
      // conversationId travels too: the server durably marks this message built and
      // appends the confirmation, so the card's state survives a refresh.
      const res = await backend.streamBuild(m.build, (ev) => {
        commit((d) => {
          const mm = d.conversations?.find((x) => x.id === conversationId)?.messages.find((x) => x.id === messageId);
          if (mm) mm.buildProgress = [...(mm.buildProgress ?? []), ev.entity];
        });
      }, conversationId);
      if (!res.ok) {
        commit((d) => { const mm = d.conversations?.find((x) => x.id === conversationId)?.messages.find((x) => x.id === messageId); if (mm) mm.status = "planned"; });
        toast({ kind: "error", title: "Couldn't build that", message: res.message ?? res.error ?? "The build failed." });
        return;
      }
      const cr = res.created ?? {};
      const edited = (res.updated ?? []).filter((u) => u.ok);
      const parts = [
        cr.skill && `skill “${cr.skill.name}”`,
        cr.agent && `agent “${cr.agent.name}”`,
        cr.automation && `automation “${cr.automation.name}”`,
        ...edited.map((u) => `updated ${u.kind} “${u.name ?? u.id}”`),
      ].filter(Boolean);
      commit((d) => {
        const cc = d.conversations?.find((x) => x.id === conversationId); if (!cc) return;
        const mm = cc.messages.find((x) => x.id === messageId);
        if (mm) { mm.status = "built"; mm.builtIds = { skillId: cr.skill?.id, agentId: cr.agent?.id, triggerId: cr.automation?.id }; }
        cc.messages.push({
          id: uid("m"), role: "assistant", createdAt: nowISO(), status: "answered",
          text: `Done — I set up ${parts.join(", ")}.${(res.notes && res.notes.length) ? "\n\n" + res.notes.map((n) => `• ${n}`).join("\n") : ""}`,
        });
        cc.updatedAt = nowISO();
      });
      // Pull the just-created entities into client state immediately — without this the
      // new agent existed only in the server registry and never appeared in Helper
      // Agents (the original "app claims it was created but it wasn't" bug).
      try {
        const serverAgents = await backend.agents();
        commit((d) => mergeServerAgents(d, serverAgents, { connectors: get().connectors, providers: get().providers, actorId: get().session?.actorId }));
      } catch { /* next hydrate catches up */ }
      toast({ kind: "success", title: "Built", message: parts.join(", ") || "Created." });
    },
    runConversationPlan: async (conversationId, messageId) => {
      const c = get().data.conversations?.find((x) => x.id === conversationId);
      const m = c?.messages.find((x) => x.id === messageId);
      if (!m?.plan) return;
      commit((d) => { const cc = d.conversations?.find((x) => x.id === conversationId); const mm = cc?.messages.find((x) => x.id === messageId); if (mm) mm.status = "running"; });
      const runId = await get().runPlan({ title: m.plan.title, summary: m.plan.summary, steps: m.plan.steps }, { label: "Ask HomeOps" });
      commit((d) => { const cc = d.conversations?.find((x) => x.id === conversationId); const mm = cc?.messages.find((x) => x.id === messageId); if (mm) { mm.runId = runId; mm.status = "done"; } });
    },
    deleteConversation: (id) => {
      commit((d) => { if (d.conversations) d.conversations = d.conversations.filter((c) => c.id !== id); });
      if (get().route.screen === "assistant" && get().route.params?.id === id) get().navigate("assistant");
      // The conversation is server-durable (P1.1) — without this, it silently
      // reappears on the next hydrate because it was only ever removed locally.
      void backend.deleteConversationRemote(id).then((r) => { if (!r.ok) toast({ kind: "warn", title: "Deleted locally only", message: "Couldn't reach the backend — it may reappear next time you load." }); });
    },

    /* ---------- evolution: learn from real run traces (Phase 2) ----------- */
    maybeProposeEvolution: async (runId) => {
      const run = get().data.runs.find((r) => r.id === runId);
      if (!run || run.status !== "Failed") return; // only learn from genuine failures (not approval pauses)
      const existing = get().data.evolutions ?? [];
      if (existing.some((e) => e.runId === runId && e.status === "pending")) return;   // dedupe per run
      if (existing.filter((e) => e.status === "pending").length >= 24) return;          // avoid pileup
      const agent = run.agentId ? get().data.agents.find((a) => a.id === run.agentId) : undefined;
      const problem = run.steps.find((s) => s.status === "blocked" && !/approval/i.test(s.detail ?? ""));
      const detail = (problem?.detail ?? run.outputSummary ?? "").slice(0, 180);
      const connectorIssue = /connect|not ready|runtime|authoriz|unreachable|not configured|backend/i.test(detail);
      // Deterministic, evidence-based baseline — works with NO AI provider configured.
      const proposal: EvolutionProposal = {
        id: uid("evo"),
        kind: agent ? "agent" : "skill",
        agentId: agent?.id,
        agentName: agent?.name,
        runId,
        title: connectorIssue ? "Connect the required service" : `Handle "${problem?.label ?? run.triggerLabel}" more gracefully`,
        reason: `Run "${run.triggerLabel}" failed${problem ? ` at "${problem.label}"` : ""}: ${detail}`,
        summary: connectorIssue
          ? "A step couldn't run because its connector isn't ready. Connect/authorize it in Connections, or have the agent stop and ask instead of failing."
          : "A step didn't complete. Tighten the agent's guidance so it validates inputs and degrades gracefully when something is missing.",
        before: agent?.instructions,
        after: agent ? `${(agent.instructions ?? "").trim()}\n\nIf a required connector isn't ready or an input is missing, stop and ask the household rather than failing the run.`.trim() : undefined,
        risk: "Low",
        source: "trace",
        status: "pending",
        createdAt: nowISO(),
      };
      // Optional LLM enrichment — refines wording + the suggested "after". Graceful if no provider.
      const trace = { title: run.triggerLabel, status: run.status, summary: run.outputSummary, steps: run.steps.map((s) => ({ label: s.label, status: s.status, detail: s.detail })), agent: agent ? { name: agent.name, instructions: agent.instructions } : null };
      try {
        const r = await backend.proposeEvolution(trace);
        if (r.ok && r.proposal) {
          proposal.title = r.proposal.title || proposal.title;
          proposal.reason = r.proposal.reason || proposal.reason;
          proposal.summary = r.proposal.summary || proposal.summary;
          if (r.proposal.after) proposal.after = r.proposal.after;
          proposal.risk = r.proposal.risk || proposal.risk;
          proposal.source = "ai";
          proposal.model = r.model;
        }
      } catch { /* keep the deterministic baseline */ }
      commit((d) => { (d.evolutions ??= []).unshift(proposal); });
      toast({ kind: "info", title: "New improvement suggestion", message: "HomeOps learned from a failed run — review it in Activity → Improvements." });
    },
    reviewEvolution: async (id, accept) => {
      // Optimistically mark reviewed locally (instant UI feedback)
      commit((d) => { const e = d.evolutions?.find((x) => x.id === id); if (e) e.status = accept ? "accepted" : "rejected"; });
      // Server-side apply: versions the target entity (agent, skill) durably
      try {
        const r = await backend.reviewEvolution(id, accept);
        if (!r.ok) {
          // Revert optimistic update on server error
          commit((d) => { const e = d.evolutions?.find((x) => x.id === id); if (e) e.status = "pending"; });
          toast({ kind: "error", title: "Could not apply improvement", message: r.error ?? "Server error" });
          return;
        }
        const applied = r.applied ?? false;
        toast({
          kind: accept ? "success" : "info",
          title: accept ? "Improvement accepted" : "Suggestion dismissed",
          message: accept && applied ? "The target was versioned with the new guidance." : accept && !applied ? "Accepted — apply the change manually in the builder." : undefined,
        });
      } catch {
        toast({ kind: "error", title: "Could not reach server", message: "The improvement was marked locally but not applied server-side." });
      }
    },

    /* -------------------- connectors (real backend) ----------------------- */
    connectors: [],
    providers: [],
    accounts: [],
    backendHealth: null,
    backendOnline: false,
    externalActionsEnabled: true,
    loadBackend: async () => {
      const [health, connectors, prov, accounts] = await Promise.all([backend.health(), backend.connectors(), backend.providers(), backend.accounts()]);
      set({ backendHealth: health, backendOnline: !!health, connectors, providers: prov.providers, accounts, externalActionsEnabled: health ? health.externalActionsEnabled : true });
      if (health) {
        void get().migrateAgentsToServer();
        void get().hydrateFromServer();
      }
    },
    // Pull server-owned family data (events/tasks/members/conversations) and reconcile it
    // into local AppData. The server is authoritative for items it owns (matched by id);
    // local-only demo/seed items are preserved so the showcase stays populated. Roles come
    // from the server member registry (the client can render but never mint roles). If the
    // backend is offline this is a no-op and the local-first cache continues to render.
    hydrateFromServer: async () => {
      const [events, tasks, members, conversations, memory, serverAgents] = await Promise.all([
        backend.events(), backend.tasks(), backend.members(), backend.conversations(), backend.memory(), backend.agents(),
      ]);
      const mapEvent = (e: ServerEvent): CalendarEvent => ({
        id: e.id, serverId: e.id, title: e.title, startAt: e.startAt ?? "", endAt: e.endAt ?? undefined,
        location: e.location || undefined, spaceId: e.spaceId, memberIds: e.participantIds ?? [],
        category: e.category ?? "General", movable: e.layer === "canonical", source: e.source ?? "HomeOps",
        layer: e.layer, visibility: e.visibility, ownerId: e.ownerId, driverId: e.driverId,
        whatToBring: e.whatToBring, checklist: e.checklist,
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
      const mapMemory = (m: ServerMemory): MemoryEntry => ({
        id: m.id, serverId: m.id, agentId: "", spaceId: "sp-family",
        type: (MEMORY_TYPES as string[]).includes(m.type) ? (m.type as MemoryType) : "Insight",
        title: m.type ? `${m.type[0].toUpperCase()}${m.type.slice(1)}` : "Memory",
        content: m.text, tags: [], source: "Learned from a run",
        confidence: 1, userApproved: true, sensitive: m.scope === "personal",
        createdAt: new Date(m.createdAt).toISOString(), updatedAt: new Date(m.createdAt).toISOString(),
      });
      const mapConv = (c: ServerConversation): AssistantConversation => ({
        id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt,
        messages: (c.messages ?? []).map((m, i) => ({
          id: `${c.id}-m${i}`, role: m.role, text: m.text, createdAt: m.at,
          plan: m.plan ?? undefined, build: m.build ?? undefined, builtIds: m.builtIds ?? undefined, model: m.model ?? undefined,
          // Build proposals keep their card state across refreshes: the server marks the
          // originating message `built` when the build materializes.
          status: m.role === "assistant" ? (m.build ? (m.built ? "built" : "planned") : m.plan ? "planned" : "answered") : undefined,
        })),
      });
      commit((d) => {
        const evIds = new Set(events.map((e) => e.id));
        d.events = [...events.map(mapEvent), ...d.events.filter((e) => !evIds.has(e.serverId ?? e.id))];
        const tkIds = new Set(tasks.map((t) => t.id));
        d.tasks = [...tasks.map(mapTask), ...d.tasks.filter((t) => !tkIds.has(t.serverId ?? t.id))];
        // Roles are server-authoritative: overlay role/relationship onto local members,
        // preserving presentation fields (avatar/initials/email) the server doesn't store.
        for (const sm of members) {
          const local = d.members.find((m) => m.id === sm.actorId);
          if (local) { local.role = sm.role as Member["role"]; if (sm.relationship) local.relationship = sm.relationship; }
        }
        const convIds = new Set(conversations.map((c) => c.id));
        const localConvs = (d.conversations ?? []).filter((c) => !convIds.has(c.id));
        d.conversations = [...conversations.map(mapConv), ...localConvs];
        // Real memory, written by actual agent runs (homeops.write_memory) — previously
        // never surfaced here at all, so "Activity & Memory" only ever showed whatever a
        // human manually added. Server-wins by id; purely local entries are preserved.
        const memIds = new Set(memory.map((m) => m.id));
        d.memories = [...memory.map(mapMemory), ...d.memories.filter((m) => !memIds.has(m.serverId ?? m.id))];
        // Server-registry agents (incl. chat-built ones that exist ONLY server-side).
        mergeServerAgents(d, serverAgents, { connectors: get().connectors, providers: get().providers, actorId: get().session?.actorId });
      });
    },
    // One-time IndexedDB→server agent migration. Pushes local agents to the durable
    // server registry, PRESERVING ids so existing runs (sourceRef.agentId) resolve and
    // the executor can enforce each agent's permitted∩available policy. Idempotent on
    // the server (a supplied id that exists is returned unchanged). Only marks done
    // when every create succeeded, so a non-admin session simply retries on next load.
    migrateAgentsToServer: async () => {
      if (typeof localStorage !== "undefined" && localStorage.getItem("homeops.agentsMigrated.v1")) return;
      try {
        const serverAgents = await backend.agents();
        const serverIds = new Set(serverAgents.map((a) => a.id));
        const spaces = get().data.spaces;
        const locals = get().data.agents.filter((a) => a.status !== "Archived" && !serverIds.has(a.id));
        let ok = true;
        for (const a of locals) {
          const r = await backend.createAgent({
            id: a.id, name: a.name, icon: a.icon, purpose: a.purpose, instructions: a.instructions,
            status: a.status, spaceType: (spaces.find((s) => s.id === a.spaceId)?.type as string) ?? "Family",
            skillIds: [], allowedToolIds: a.allowedToolIds ?? [], allowedFunctionIds: [],
            deniedToolIds: [], deniedFunctionIds: [],
            approvalPolicy: a.approvalPolicy ?? { autoAllow: [], alwaysApprove: [] },
          });
          if (r.error) { ok = false; break; }
        }
        if (ok && typeof localStorage !== "undefined") localStorage.setItem("homeops.agentsMigrated.v1", "1");
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
        toast({ kind: "error", title: r.error === "insufficient_role" ? "Not allowed" : "Could not save", message: r.error === "insufficient_role" ? "Only an Adult Admin or Owner can configure connectors." : r.error === "authentication_required" ? "Sign in to configure connectors." : "Start the HomeOps runtime to configure connectors." });
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

    /* ----------------------------- automations ---------------------------- */
    createAutomation: (input) => {
      const id = uid("auto");
      commit((d) => {
        const agent = d.agents.find((a) => a.id === input.agentId);
        const auto: Automation = {
          id,
          name: input.name,
          description: input.description ?? input.plan.output,
          category: input.category ?? "Custom",
          templateId: input.templateId,
          agentId: input.agentId,
          spaceId: input.spaceId ?? agent?.spaceId ?? d.spaces[0].id,
          triggerType: input.triggerType ?? "Manual",
          triggerConfig: input.triggerConfig ?? {},
          secondaryTriggers: input.secondaryTriggers,
          enabled: input.enabled ?? true,
          status: input.status ?? "active",
          approvalRequired: input.approvalRequired ?? input.plan.approvalGates.some((g) => !/no external/i.test(g)),
          plan: input.plan,
          failureCount: 0,
          runIds: [],
          createdAt: nowISO(),
          updatedAt: nowISO(),
        };
        d.automations.unshift(auto);
        pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "automation.created", description: `Created automation “${auto.name}”`, entityType: "automation", entityId: id, spaceId: auto.spaceId, status: "success" });
      });
      toast({ kind: "success", title: "Automation created", message: input.name });
      return id;
    },
    createAutomationFromPlan: (plan, opts) => {
      const d0 = get().data;
      // Reuse a matching agent if one exists, otherwise create one from the plan.
      const existing = routeToAgent(`${plan.title} ${plan.summary} ${plan.instructions}`, d0.agents);
      const agentId = existing?.id ?? get().createAgentFromPlan(plan, { status: "Active", connectorIds: opts?.connectorIds });
      const agentName = get().data.agents.find((a) => a.id === agentId)?.name ?? plan.title;
      const wf = workflowPlanFromAgentPlan(plan, agentId, agentName);
      const space = d0.spaces.find((s) => s.type === plan.spaceType);
      return get().createAutomation({
        name: plan.title,
        description: plan.summary || plan.title,
        category: "Custom",
        agentId,
        spaceId: space?.id,
        triggerType: (plan.triggerType as TriggerType) ?? "Manual",
        triggerConfig: plan.triggerDetail ? { schedule: plan.triggerDetail } : {},
        enabled: opts?.enabled ?? true,
        status: "active",
        approvalRequired: plan.approvalRequired,
        plan: wf,
      });
    },
    updateAutomation: (id, patch) =>
      commit((d) => {
        const a = d.automations.find((x) => x.id === id);
        if (a) Object.assign(a, patch, { updatedAt: nowISO() });
      }),
    toggleAutomation: (id) => {
      commit((d) => {
        const a = d.automations.find((x) => x.id === id);
        if (a) {
          a.enabled = !a.enabled;
          a.status = a.enabled ? "active" : "paused";
          a.updatedAt = nowISO();
        }
      });
      const a = get().data.automations.find((x) => x.id === id);
      toast({ kind: "info", title: a?.enabled ? "Automation enabled" : "Automation paused" });
    },
    runAutomation: (id, opts) => {
      let runId = "";
      commit((d) => {
        const automation = d.automations.find((a) => a.id === id);
        if (!automation) return;
        const res = executeAgentRun(d, {
          agentId: automation.agentId,
          automation,
          triggerLabel: `Test · ${automation.triggerType}`,
          manual: true,
          forceFail: opts?.forceFail,
          subagents: subagentDefsFor(automation),
        });
        runId = res.runId;
      });
      const last = get().data.runs.find((r) => r.id === runId);
      toast({
        kind: last?.status === "Failed" ? "error" : last?.status === "Waiting for Approval" ? "warn" : "success",
        title:
          last?.status === "Failed"
            ? "Test run failed"
            : last?.status === "Waiting for Approval"
              ? "Run paused for approval"
              : "Test run complete",
        message: last?.outputSummary,
      });
      return runId;
    },
    testAutomation: async (id) => {
      const auto = get().data.automations.find((a) => a.id === id);
      if (!auto) return "";
      const isReal = (tid: string) => !!get().connectors.find((c) => c.tools.some((t) => t.id === tid)) || !!get().providers.find((p) => p.tools.some((t) => t.id === tid));
      const steps: RunnableStep[] = (auto.plan.steps ?? [])
        .filter((s) => s.tool && isReal(s.tool))
        .map((s) => ({ toolId: s.tool as string, title: s.label, detail: s.detail, input: {}, requiresApproval: !!s.needsApproval }));
      if (!steps.length) return get().runAutomation(id); // no real tools wired → local test run
      return get().runPlan({ title: auto.name, summary: auto.description, steps }, { agentId: auto.agentId, automationId: id, label: `Run · ${auto.triggerType}` });
    },
    deleteAutomation: (id) => {
      commit((d) => {
        d.automations = d.automations.filter((a) => a.id !== id);
      });
      toast({ kind: "info", title: "Automation deleted" });
    },
    createAutomationFromTemplate: (templateId) => {
      const tmpl = workflowTemplates.find((t) => t.id === templateId);
      if (!tmpl) return "";
      const d0 = get().data;
      // Prefer an existing agent created from the recommended template, else
      // route by the prompt, else fall back to the first active agent.
      let agent =
        (tmpl.recommendedAgentTemplateId && d0.agents.find((a) => a.templateId === tmpl.recommendedAgentTemplateId)) ||
        d0.agents.find((a) => a.name === tmpl.recommendedAgent) ||
        routeToAgent(tmpl.prompt, d0.agents) ||
        d0.agents.find((a) => a.status === "Active") ||
        d0.agents[0];
      const agentId = agent?.id ?? "";
      const plan = buildWorkflowPlan(tmpl.prompt, { agentId, agentName: agent?.name ?? tmpl.recommendedAgent });
      plan.trigger = tmpl.triggerType;
      plan.inputSources = [...tmpl.requiredConnections, ...tmpl.optionalConnections];
      const realGates = tmpl.approvalRequirements.filter((a) => /approval required/i.test(a));
      if (realGates.length) plan.approvalGates = realGates;
      plan.output = tmpl.outputFormat.join(" · ");
      const approvalRequired = realGates.length > 0;
      return get().createAutomation({
        name: tmpl.name,
        description: tmpl.prompt,
        category: tmpl.category,
        templateId,
        agentId,
        spaceId: agent?.spaceId,
        triggerType: tmpl.triggerType,
        triggerConfig: { filters: tmpl.requiredConnections },
        enabled: true,
        status: "active",
        approvalRequired,
        plan,
      });
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
    addContactMethod: (memberId, input) => {
      commit((d) => {
        d.contactMethods.push({
          id: uid("contact"),
          memberId,
          label: input.label,
          type: input.type ?? "Email",
          value: input.value,
          verified: false,
          optInStatus: "Pending",
          allowedAgentIds: input.allowedAgentIds ?? [],
        });
      });
      toast({ kind: "info", title: "Contact method added", message: "Verify it to let agents send to it." });
    },
    verifyContactMethod: (id) => {
      commit((d) => {
        const c = d.contactMethods.find((x) => x.id === id);
        if (c) {
          c.verified = true;
          c.optInStatus = "Opted In";
        }
      });
      toast({ kind: "success", title: "Contact verified" });
    },
    setContactAllowedAgents: (id, agentIds) =>
      commit((d) => {
        const c = d.contactMethods.find((x) => x.id === id);
        if (c) c.allowedAgentIds = agentIds;
      }),
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
          // Jump to the live run so the user sees the updated state immediately.
          get().navigate("automations", { tab: "monitor", ...(newRunId ? { run: newRunId } : {}) });
          toast({ kind: "success", title: "Revised plan started", message: "Opening the live run — gated steps still pause for approval." });
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

    /* --------------------------- files + knowledge ------------------------ */
    uploadFiles: async (files, spaceId) => {
      const ids: string[] = [];
      for (const file of files) {
        const id = uid("file");
        ids.push(id);
        const isText = /\.(txt|md|csv|json)$/i.test(file.name) || file.type.startsWith("text");
        let previewContent: string | undefined;
        let dataUrl: string | undefined;
        if (isText) {
          previewContent = await file.text().catch(() => undefined);
        } else if (file.type.startsWith("image")) {
          dataUrl = await new Promise<string | undefined>((res) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result as string);
            reader.onerror = () => res(undefined);
            reader.readAsDataURL(file);
          });
        }
        const ext = (file.name.split(".").pop() ?? "").toUpperCase();
        const typeMap: Record<string, FileAsset["type"]> = { PDF: "PDF", DOCX: "DOCX", TXT: "TXT", MD: "MD", CSV: "CSV", XLSX: "XLSX", PNG: "Image", JPG: "Image", JPEG: "Image", GIF: "Image", ZIP: "ZIP", MP3: "Audio", MP4: "Video" };
        const dates = previewContent ? Array.from(previewContent.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\b/g)).map((m) => m[0]).slice(0, 5) : [];
        const tasks = previewContent
          ? previewContent.split(/\n/).filter((l) => /(due|sign|return|pay|bring|submit|deadline)/i.test(l)).map((l) => l.trim().slice(0, 80)).slice(0, 5)
          : [];
        commit((d) => {
          const sid = spaceId ?? d.spaces.find((s) => s.type === "Personal")?.id ?? d.spaces[0].id;
          const f: FileAsset = {
            id,
            name: file.name,
            type: typeMap[ext] ?? "TXT",
            sizeBytes: file.size,
            tags: ["Uploaded"],
            ownerMemberId: d.members.find((m) => m.isCurrentUser)?.id ?? d.members[0].id,
            spaceId: sid,
            uploadedAt: nowISO(),
            linkedAgentIds: [],
            linkedWorkflowIds: [],
            summary: previewContent ? `Uploaded ${ext} file. ${previewContent.slice(0, 120)}` : `Uploaded ${ext} file (${Math.round(file.size / 1024)} KB).`,
            detectedDates: dates,
            detectedTasks: tasks,
            sensitive: /tax|medical|ssn|passport|id|bank|legal/i.test(file.name),
            searchIndexed: false,
            previewContent,
            dataUrl,
            folder: "Uploads",
          };
          d.files.unshift(f);
          pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "file.uploaded", description: `Uploaded ${file.name}`, entityType: "file", entityId: id, spaceId: sid, status: "success" });
          processFile(d, id);
        });
      }
      toast({ kind: "success", title: `${files.length} file${files.length > 1 ? "s" : ""} processed`, message: "Summaries and detected items are ready." });
      return ids;
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
          linkedWorkflowIds: [],
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
      commit((d) => {
        const f = d.files.find((x) => x.id === id);
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
      commit((d) => processFile(d, id));
      toast({ kind: "success", title: "File processed" });
    },
    createKnowledgeItem: (input) => {
      const id = uid("know");
      commit((d) => {
        d.knowledge.unshift({
          id,
          title: input.title,
          type: input.type ?? "Reference Note",
          content: input.content ?? "",
          fileAssetIds: input.fileAssetIds ?? [],
          tags: input.tags ?? [],
          spaceId: input.spaceId ?? d.spaces[0].id,
          createdBy: d.members.find((m) => m.isCurrentUser)?.displayName ?? "You",
          sensitive: input.sensitive ?? false,
          agentReadable: input.agentReadable ?? true,
          agentEditableRequiresApproval: input.agentEditableRequiresApproval ?? true,
          createdAt: nowISO(),
          updatedAt: nowISO(),
        });
      });
      toast({ kind: "success", title: "Knowledge added" });
      return id;
    },
    updateKnowledgeItem: (id, patch) =>
      commit((d) => {
        const k = d.knowledge.find((x) => x.id === id);
        if (k) Object.assign(k, patch, { updatedAt: nowISO() });
      }),
    deleteKnowledgeItem: (id) => {
      commit((d) => {
        d.knowledge = d.knowledge.filter((x) => x.id !== id);
      });
      toast({ kind: "info", title: "Knowledge item removed" });
    },

    /* ------------------------------ playbooks ----------------------------- */
    createPlaybook: (input) => {
      const id = uid("pb");
      commit((d) => {
        d.playbooks.unshift({
          id,
          name: input.name,
          description: input.description ?? "",
          whenToUse: input.whenToUse ?? "",
          steps: input.steps ?? [],
          requiredConnections: input.requiredConnections ?? [],
          requiredFileTypes: input.requiredFileTypes ?? [],
          outputFormat: input.outputFormat ?? "",
          approvalRules: input.approvalRules ?? [],
          supportingFileIds: input.supportingFileIds ?? [],
          linkedAgentIds: input.linkedAgentIds ?? [],
          category: input.category ?? "Custom",
          createdAt: nowISO(),
          updatedAt: nowISO(),
        });
      });
      toast({ kind: "success", title: "Playbook created" });
      return id;
    },
    updatePlaybook: (id, patch) =>
      commit((d) => {
        const p = d.playbooks.find((x) => x.id === id);
        if (p) Object.assign(p, patch, { updatedAt: nowISO() });
      }),
    duplicatePlaybook: (id) => {
      const newId = uid("pb");
      commit((d) => {
        const p = d.playbooks.find((x) => x.id === id);
        if (p) {
          d.playbooks.unshift({ ...structuredClone(p), id: newId, name: `${p.name} (Copy)`, createdAt: nowISO(), updatedAt: nowISO() });
        }
      });
      toast({ kind: "success", title: "Playbook duplicated" });
      return newId;
    },
    archivePlaybook: (id) => {
      commit((d) => {
        const p = d.playbooks.find((x) => x.id === id);
        if (p) p.archived = !p.archived;
      });
      toast({ kind: "info", title: "Playbook archived" });
    },
    deletePlaybook: (id) => {
      commit((d) => {
        d.playbooks = d.playbooks.filter((x) => x.id !== id);
        d.agents.forEach((a) => { a.playbookIds = a.playbookIds.filter((x) => x !== id); });
      });
      toast({ kind: "info", title: "Playbook deleted" });
    },
    runPlaybook: async (id) => {
      const p = get().data.playbooks.find((x) => x.id === id);
      if (!p) return;
      const goal = `Run the "${p.name}" playbook. ${p.description}${p.whenToUse ? ` When to use: ${p.whenToUse}.` : ""} Steps to follow: ${[...p.steps].sort((a, b) => a.order - b.order).map((s) => s.text).join("; ")}.`;
      toast({ kind: "info", title: "Planning playbook run…", message: p.name });
      const r = await backend.plan(goal);
      if (!r.ok || !r.plan) { toast({ kind: "warn", title: r.error === "no_provider" ? "Connect an AI provider first" : "Couldn't run playbook", message: r.message ?? r.error }); return; }
      await get().runPlan(r.plan, { label: `Playbook · ${p.name}` });
    },
    addPlaybookFromCatalog: (catalogId) => {
      const tmpl = playbookCatalog.find((p) => p.id === catalogId);
      const newId = uid("pb");
      commit((d) => {
        if (!tmpl) return;
        d.playbooks.unshift({ ...structuredClone(tmpl), id: newId, createdAt: nowISO(), updatedAt: nowISO() });
      });
      toast({ kind: "success", title: "Playbook added", message: tmpl?.name });
      return newId;
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
        if (m) m.sensitive = !m.sensitive;
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
          linkedAutomationIds: input.linkedAutomationIds ?? [],
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
      commit((d) => {
        const app = d.miniApps.find((x) => x.id === id);
        if (app) d.miniApps.unshift({ ...structuredClone(app), id: newId, name: `${app.name} (Copy)`, version: 1, createdAt: nowISO(), updatedAt: nowISO() });
      });
      toast({ kind: "success", title: "Mini app duplicated" });
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
      // Persist to the server when online; on success tag the optimistic item with its
      // serverId so later updates target the durable record (and the next hydrate
      // reconciles to the canonical server task).
      if (get().backendOnline) {
        void backend.createTaskRemote({ title: input.title, type: input.type, status: input.status, dueAt: input.dueAt ?? null, assignedMemberId: input.assignedMemberId ?? null, spaceId: input.spaceId, priority: input.priority, amount: input.amount ?? null, notes: input.notes ?? "", visibility: input.visibility ?? "household" })
          .then((r) => { if (r.task) commit((d) => { const t = d.tasks.find((x) => x.id === id); if (t) t.serverId = r.task!.id; }); });
      }
      return id;
    },
    updateTask: (id, patch) => {
      let serverId: string | undefined;
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (t) { Object.assign(t, patch, { updatedAt: nowISO() }); serverId = t.serverId; }
      });
      if (serverId && get().backendOnline) void backend.updateTaskRemote(serverId, patch as Record<string, unknown>);
    },
    setTaskStatus: (id, status) => {
      let serverId: string | undefined;
      commit((d) => {
        const t = d.tasks.find((x) => x.id === id);
        if (t) { t.status = status; t.updatedAt = nowISO(); serverId = t.serverId; }
      });
      if (serverId && get().backendOnline) void backend.updateTaskRemote(serverId, { status });
    },
    deleteTask: (id) => {
      const serverId = get().data.tasks.find((x) => x.id === id)?.serverId;
      commit((d) => { d.tasks = d.tasks.filter((x) => x.id !== id); });
      if (serverId && get().backendOnline) void backend.deleteTaskRemote(serverId);
    },
    moveEvent: (id, newStartISO) => {
      let serverId: string | undefined;
      commit((d) => {
        const e = d.events.find((x) => x.id === id);
        if (e) {
          e.startAt = newStartISO;
          serverId = e.serverId;
          pushActivity(d, { actorType: "user", actorId: "user", actorName: "You", actionType: "calendar.changed", description: `Moved “${e.title}”`, entityType: "event", entityId: id, spaceId: e.spaceId, status: "info" });
        }
      });
      if (serverId && get().backendOnline) void backend.updateEvent(serverId, { startAt: newStartISO });
      toast({ kind: "success", title: "Event moved" });
    },
    createEvent: (input) => {
      const id = uid("event");
      commit((d) => {
        d.events.push({
          id,
          title: input.title,
          startAt: input.startAt,
          endAt: input.endAt,
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
        void backend.createEvent({ title: input.title, startAt: input.startAt ?? null, endAt: input.endAt ?? null, location: input.location ?? "", spaceId: input.spaceId, participantIds: input.memberIds ?? [], category: input.category, visibility: input.visibility ?? "household" })
          .then((r) => { if (r.event) commit((d) => { const e = d.events.find((x) => x.id === id); if (e) e.serverId = r.event!.id; }); });
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
      toast({ kind: "info", title: "AI provider updated", message: id === "local" ? "Using the local rules engine." : "Manage real providers in Settings → AI Providers." });
    },
    toggleSoloMode: () => {
      commit((d) => {
        d.settings.soloProfessionalMode = !d.settings.soloProfessionalMode;
      });
      toast({ kind: "info", title: "Solo Professional Mode toggled" });
    },
  };
});
