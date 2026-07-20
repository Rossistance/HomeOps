/**
 * Local AI orchestration layer.
 *
 * This is the deterministic, local-first "rules engine" fallback. It parses
 * plain-English commands into agent configs and workflow plans, routes work to
 * the best agent, and generates briefings / summaries — with no external
 * provider required. The provider router (see `runProvider`) is structured so
 * an OpenAI/Anthropic/Gemini adapter can be slotted in later; until then every
 * task resolves locally.
 */
import type {
  Agent,
  RiskLevel,
  TriggerType,
  WorkflowPlan,
  WorkflowStep,
  AppData,
  Member,
} from "@/types";

export interface IntentProfile {
  key: string;
  label: string;
  name: string;
  icon: string;
  spaceType: string;
  connections: string[];
  defaultTrigger: TriggerType;
  keywords: string[];
}

const INTENTS: IntentProfile[] = [
  {
    key: "briefing",
    label: "Daily briefing",
    name: "Family Briefing Agent",
    icon: "Sun",
    spaceType: "Family",
    connections: ["Google Calendar", "Gmail", "Local reminders"],
    defaultTrigger: "Schedule",
    keywords: ["briefing", "every morning", "each morning", "daily", "good morning", "start my day", "today's"],
  },
  {
    key: "school",
    label: "School & daycare",
    name: "School & Daycare Agent",
    icon: "GraduationCap",
    spaceType: "School",
    connections: ["Gmail", "Local Files", "Local reminders"],
    defaultTrigger: "Email Received",
    keywords: ["school", "daycare", "teacher", "classroom", "permission slip", "picture day", "field trip", "homework"],
  },
  {
    key: "bills",
    label: "Bills & finance",
    name: "Bill & Receipt Agent",
    icon: "Receipt",
    spaceType: "Bills",
    connections: ["Gmail", "Local Files", "Local Files"],
    defaultTrigger: "Email Received",
    keywords: ["bill", "receipt", "expense", "budget", "spending", "reconcile", "statement", "invoice", "payment"],
  },
  {
    key: "subscription",
    label: "Subscriptions",
    name: "Subscription Agent",
    icon: "CreditCard",
    spaceType: "Bills",
    connections: ["Gmail", "Local Files", "Browser Automation"],
    defaultTrigger: "Schedule",
    keywords: ["subscription", "cancel", "unused", "recurring charge", "free trial"],
  },
  {
    key: "meal",
    label: "Meals & groceries",
    name: "Meal & Grocery Agent",
    icon: "UtensilsCrossed",
    spaceType: "Family",
    connections: ["Local reminders", "Text Messaging"],
    defaultTrigger: "Schedule",
    keywords: ["meal", "grocery", "groceries", "dinner", "recipe", "shopping list", "pantry"],
  },
  {
    key: "travel",
    label: "Travel",
    name: "Travel Planner Agent",
    icon: "Plane",
    spaceType: "Travel",
    connections: ["Google Calendar", "Local Files", "Browser Automation"],
    defaultTrigger: "Manual",
    keywords: ["trip", "travel", "vacation", "flight", "hotel", "packing", "itinerary", "reservation"],
  },
  {
    key: "medical",
    label: "Medical",
    name: "Medical Appointment Agent",
    icon: "Stethoscope",
    spaceType: "Medical",
    connections: ["Google Calendar", "Gmail", "Local Files"],
    defaultTrigger: "Calendar Event Created",
    keywords: ["doctor", "medical", "appointment", "dentist", "pediatric", "prescription", "follow-up", "health"],
  },
  {
    key: "home",
    label: "Home maintenance",
    name: "Home Maintenance Agent",
    icon: "Wrench",
    spaceType: "Home Maintenance",
    connections: ["Gmail", "Local Files", "Local reminders"],
    defaultTrigger: "Manual",
    keywords: ["repair", "maintenance", "contractor", "quote", "fix", "plumber", "hvac", "furnace", "lawn"],
  },
  {
    key: "caregiving",
    label: "Caregiving",
    name: "Caregiving Coordinator",
    icon: "HeartHandshake",
    spaceType: "Caregiving",
    connections: ["Google Calendar", "Text Messaging", "Local Files"],
    defaultTrigger: "Schedule",
    keywords: ["caregiving", "grandparent", "elder", "medication", "ride", "assisted living", "parents"],
  },
  {
    key: "document",
    label: "Documents",
    name: "Document Organizer Agent",
    icon: "FolderOpen",
    spaceType: "Personal",
    connections: ["Local Files", "Browser Automation"],
    defaultTrigger: "File Changed",
    keywords: ["document", "file", "organize", "scan", "pdf", "records", "filing", "renewal", "contract", "legal"],
  },
  {
    key: "pet",
    label: "Pets",
    name: "Pet Care Agent",
    icon: "PawPrint",
    spaceType: "Pets",
    connections: ["Local reminders", "Google Calendar"],
    defaultTrigger: "Schedule",
    keywords: ["pet", "dog", "cat", "vet", "feed", "walk", "groom"],
  },
  {
    key: "gift",
    label: "Gifts & birthdays",
    name: "Gift & Birthday Agent",
    icon: "Gift",
    spaceType: "Family",
    connections: ["Google Calendar", "Browser Automation"],
    defaultTrigger: "Schedule",
    keywords: ["gift", "birthday", "present", "party", "anniversary", "holiday"],
  },
  {
    key: "inbox",
    label: "Inbox",
    name: "Inbox Helper Agent",
    icon: "Inbox",
    spaceType: "Personal",
    connections: ["Gmail", "Local reminders"],
    defaultTrigger: "Schedule",
    keywords: ["inbox", "email", "triage", "archive", "unread", "reply", "follow up", "follow-up"],
  },
  {
    key: "research",
    label: "Research",
    name: "Research Agent",
    icon: "Search",
    spaceType: "Personal",
    connections: ["Browser Automation", "RSS / Feed"],
    defaultTrigger: "Manual",
    keywords: ["research", "compare", "deep dive", "find best", "options", "monitor", "watch", "feed", "podcast"],
  },
];

function scoreIntent(text: string, intent: IntentProfile): number {
  const lower = text.toLowerCase();
  return intent.keywords.reduce((acc, kw) => (lower.includes(kw) ? acc + (kw.includes(" ") ? 2 : 1) : acc), 0);
}

export function detectIntent(text: string): IntentProfile {
  let best = INTENTS[0];
  let bestScore = -1;
  for (const intent of INTENTS) {
    const s = scoreIntent(text, intent);
    if (s > bestScore) {
      best = intent;
      bestScore = s;
    }
  }
  return best;
}

export function detectTrigger(text: string, fallback: TriggerType): TriggerType {
  const t = text.toLowerCase();
  if (/(every morning|each morning|daily|every day|each day|every week|weekly|every monday|every friday|sunday|each month|monthly|at \d|am\b|pm\b)/.test(t))
    return "Schedule";
  if (/(when .*text|text message|sms)/.test(t)) return "Text Message Received";
  if (/(when .*reply|no reply|hasn't replied|has not replied)/.test(t)) return "Email Reply Received";
  if (/(when .*email|inbox|email comes|email arrives|receive an email)/.test(t)) return "Email Received";
  if (/(label|tag|mark .* as)/.test(t)) return "Email Label Applied";
  if (/(when i upload|when .* file|file is added|attachment|drive|folder)/.test(t)) return "File Changed";
  if (/(webhook|payment|order|confirmation|form submission)/.test(t)) return "Webhook";
  if (/(feed|rss|podcast|blog|channel)/.test(t)) return "RSS Feed";
  if (/(calendar event|new appointment|new booking|booking)/.test(t)) return "Calendar Event Created";
  if (/(monitor|website|watch .* page|price)/.test(t)) return "Schedule";
  return fallback;
}

const HIGH_RISK_VERBS: { re: RegExp; label: string; tool: string }[] = [
  { re: /send.*(email|message|text)|email .* to|reply to|contact (the )?(school|doctor|landlord|vendor|provider)/, label: "Send message outside the household", tool: "Send external email/text" },
  { re: /delete|remove .* file|archive/, label: "Delete or archive files", tool: "Delete/Archive file" },
  { re: /cancel .* subscription|cancel/, label: "Cancel a subscription", tool: "Browser cancellation" },
  { re: /change .* calendar|move .* (event|meeting|appointment)|reschedule/, label: "Change calendar events", tool: "Modify calendar event" },
  { re: /submit .* form|fill .* form|register|sign up/, label: "Submit a form", tool: "Browser form submission" },
  { re: /buy|purchase|pay|order/, label: "Make a purchase or payment", tool: "Payment/Purchase" },
  { re: /upload .* (to|onto) .* (site|portal|website)|log ?in|portal/, label: "Run a browser workflow that signs in on your behalf", tool: "Browser login workflow" },
];

export function detectApprovalGates(text: string): { gates: string[]; risk: RiskLevel } {
  const lower = text.toLowerCase();
  const gates: string[] = [];
  for (const v of HIGH_RISK_VERBS) {
    if (v.re.test(lower)) gates.push(v.label);
  }
  let risk: RiskLevel = gates.length ? "High" : "Low";
  if (/medical|legal|financial|tax|identity|child|kids|school records|bank/.test(lower)) risk = "Sensitive";
  return { gates: Array.from(new Set(gates)), risk };
}

export interface ParsedAgent {
  name: string;
  icon: string;
  purpose: string;
  spaceType: string;
  instructions: string;
  connections: string[];
  triggerType: TriggerType;
  approvalGates: string[];
  risk: RiskLevel;
}

export function parseAgentPrompt(prompt: string): ParsedAgent {
  const intent = detectIntent(prompt);
  const triggerType = detectTrigger(prompt, intent.defaultTrigger);
  const { gates, risk } = detectApprovalGates(prompt);
  return {
    name: intent.name,
    icon: intent.icon,
    purpose: prompt.trim().replace(/^create an agent (that|to)\s*/i, "").replace(/\.$/, ""),
    spaceType: intent.spaceType,
    instructions: `You are the ${intent.name}. ${prompt.trim()} Use the household's knowledge library and connected services. Keep the family informed, and always request approval before any action that leaves the household or touches sensitive information.`,
    connections: intent.connections,
    triggerType,
    approvalGates: gates,
    risk,
  };
}

const ACTION_VERBS: { re: RegExp; step: (m: RegExpMatchArray) => WorkflowStep }[] = [];

export function buildWorkflowPlan(prompt: string, ctx: { agentName: string; agentId: string }): WorkflowPlan {
  const intent = detectIntent(prompt);
  const triggerType = detectTrigger(prompt, intent.defaultTrigger);
  const { gates } = detectApprovalGates(prompt);
  const lower = prompt.toLowerCase();

  const steps: WorkflowStep[] = [];
  let order = 1;
  const add = (label: string, detail: string, tool?: string, needsApproval?: boolean) => {
    steps.push({ id: `step-${order}`, order, label, detail, tool, needsApproval });
    order += 1;
  };

  add("Gather inputs", `Read approved sources for the ${intent.label.toLowerCase()} workflow.`, "Read connections");
  if (/summar|brief|recap|digest/.test(lower)) add("Summarize", "Generate a concise, family-friendly summary.", "Summarize");
  if (/extract|find .* date|due date|deadline/.test(lower)) add("Extract key dates & tasks", "Detect due dates, action items, and contacts.", "Extract");
  if (/reminder|task|to-?do|todo|chore/.test(lower)) add("Create reminders / tasks", "Add reminders and tasks to the right space.", "Create task", false);
  if (/categor|sort|organize|file|folder|tag/.test(lower)) add("Organize & tag", "Categorize and file items into the right folders.", "Tag/Organize", false);
  if (/track|tracker|mini app|dashboard|board/.test(lower)) add("Update tracker", "Sync results into the relevant mini app.", "Update mini app", false);
  for (const v of HIGH_RISK_VERBS) {
    if (v.re.test(lower)) add(v.label, "High-risk action — requires your approval before it runs.", v.tool, true);
  }
  add("Notify", "Deliver the result through your chosen channel.", "Notify");
  add("Log activity", "Record every step in the activity log.", "Activity log");

  const approvalGates = gates.length ? gates : ["No external action — runs without approval."];

  return {
    trigger: `${triggerType}${/morning|daily/.test(lower) ? " · every morning" : ""}`,
    inputSources: intent.connections,
    agentId: ctx.agentId,
    agentName: ctx.agentName,
    steps,
    toolsActions: Array.from(new Set(steps.map((s) => s.tool).filter(Boolean) as string[])),
    approvalGates,
    output: /email|message|send/.test(lower)
      ? "Drafted message + in-app summary (sending requires approval)"
      : "In-app summary, message thread, and updated trackers",
    notifications: ["In-app notification", "Message thread", /text/.test(lower) ? "Text-style alert" : "Optional email digest"],
    errorHandling:
      "If a source is unavailable or confidence is low, the agent stops, explains why, logs the event, and asks for clarification rather than guessing.",
    activityLogging: "Trigger fired → sources checked → steps executed → output delivered (each logged with status).",
  };
}

/** Pick the agent whose purpose/name best matches a free-text request. */
export function routeToAgent(prompt: string, agents: Agent[]): Agent | null {
  if (!agents.length) return null;
  const intent = detectIntent(prompt);
  const lower = prompt.toLowerCase();
  let best: Agent | null = null;
  let bestScore = -1;
  for (const a of agents) {
    if (a.status === "Archived") continue;
    const hay = `${a.name} ${a.purpose} ${a.instructions}`.toLowerCase();
    let score = 0;
    for (const kw of intent.keywords) if (hay.includes(kw)) score += 1;
    if (hay.includes(intent.key)) score += 2;
    for (const word of lower.split(/\s+/)) if (word.length > 4 && hay.includes(word)) score += 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/** Naive extractive summary used by local file processing / recaps. */
export function summarize(text: string, maxSentences = 3): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);
  if (sentences.length <= maxSentences) return text.trim();
  return sentences.slice(0, maxSentences).join(" ").trim();
}

export interface BriefingSection {
  label: string;
  items: string[];
  icon: string;
  accent: string;
}

/** Build today's family briefing from live local data. */
export function generateBriefing(data: AppData): BriefingSection[] {
  const now = Date.now();
  const dayMs = 86400000;
  const todayEvents = data.events
    .filter((e) => {
      const t = new Date(e.startAt).getTime();
      return t >= now - dayMs && t <= now + dayMs * 1.2;
    })
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));

  const overdue = data.tasks.filter((t) => t.status !== "done" && t.dueAt && new Date(t.dueAt).getTime() < now);
  const dueSoon = data.tasks.filter(
    (t) => t.status !== "done" && t.dueAt && new Date(t.dueAt).getTime() >= now && new Date(t.dueAt).getTime() < now + dayMs * 3,
  );
  const bills = data.tasks.filter((t) => t.type === "bill" && t.status !== "done");
  const pendingApprovals = data.approvals.filter((a) => a.status === "Pending");

  return [
    {
      label: "Today's schedule",
      icon: "Calendar",
      accent: "sky",
      items: todayEvents.length
        ? todayEvents.map((e) => `${e.title}`)
        : ["No appointments scheduled — a calm day."],
    },
    {
      label: "Needs attention",
      icon: "AlertCircle",
      accent: "coral",
      items: [
        ...overdue.map((t) => `Overdue: ${t.title}`),
        ...pendingApprovals.map((a) => `Approval: ${a.title}`),
      ].slice(0, 6) || [],
    },
    {
      label: "Bills due soon",
      icon: "Receipt",
      accent: "amber",
      items: bills.length ? bills.map((b) => `${b.title}${b.amount ? ` · $${b.amount}` : ""}`) : ["No bills due this week."],
    },
    {
      label: "Coming up",
      icon: "Clock",
      accent: "sage",
      items: dueSoon.length ? dueSoon.map((t) => t.title) : ["Nothing else pressing in the next few days."],
    },
  ];
}

export type SuggestedAction = { title: string; detail: string; route: { screen: string; params?: Record<string, string> }; icon: string };

export function suggestNextActions(data: AppData): SuggestedAction[] {
  const out: SuggestedAction[] = [];
  const pending = data.approvals.filter((a) => a.status === "Pending");
  if (pending.length) {
    out.push({
      title: `Review ${pending.length} approval${pending.length > 1 ? "s" : ""}`,
      detail: pending[0].title,
      route: { screen: "messages", params: { tab: "approvals" } },
      icon: "ShieldCheck",
    });
  }
  const reviewFiles = data.files.filter((f) => f.detectedTasks.length && !f.searchIndexed);
  if (reviewFiles.length) {
    out.push({
      title: "Process a new document",
      detail: reviewFiles[0].name,
      route: { screen: "files" },
      icon: "FileText",
    });
  }
  const drafts = data.agents.filter((a) => a.status === "Draft");
  if (drafts.length) {
    out.push({
      title: "Finish setting up a helper agent",
      detail: drafts[0].name,
      route: { screen: "agents", params: { id: drafts[0].id } },
      icon: "Bot",
    });
  }
  const unread = data.threads.filter((t) => t.unread);
  if (unread.length) {
    out.push({
      title: "Catch up on family messages",
      detail: unread[0].title,
      route: { screen: "messages" },
      icon: "MessageSquare",
    });
  }
  out.push({
    title: "Start a workflow from a template",
    detail: "20 ready-to-use household automations",
    route: { screen: "automations", params: { tab: "templates" } },
    icon: "Sparkles",
  });
  return out.slice(0, 5);
}

/** Bubbled prompt suggestions under the "Ask FamiliOS" input — household/member-context-
 *  aware, unlike the generic hardcoded examples this replaces. Real signals (pending
 *  approvals, overdue tasks, today's calendar, unread messages) surface first, gated by
 *  what the CURRENT member's role can act on; a fresh/quiet household falls back to a
 *  short set of genuinely useful starter prompts rather than showing nothing. */
export interface AskSuggestion { icon: string; text: string }
const ADULT_ROLES = new Set(["Owner", "Adult Admin", "Adult Member"]);
export function suggestAskPrompts(data: AppData, member?: Member): AskSuggestion[] {
  const isAdult = ADULT_ROLES.has(member?.role ?? "");
  const firstName = (name?: string) => (name ?? "").split(" ")[0];
  const out: AskSuggestion[] = [];

  const pending = data.approvals.filter((a) => a.status === "Pending");
  if (isAdult && pending.length) {
    out.push({ icon: "ShieldCheck", text: pending.length === 1 ? `Tell me about the "${pending[0].title}" approval waiting on me` : `What are the ${pending.length} things waiting on my approval?` });
  }

  const now = Date.now();
  const todayEvents = data.events.filter((e) => e.startAt && new Date(e.startAt).getTime() >= now - 3600_000 && new Date(e.startAt).toDateString() === new Date().toDateString());
  if (todayEvents.length) {
    out.push({ icon: "CalendarDays", text: "What's on the family calendar today, and who's driving?" });
  }

  const overdue = data.tasks.filter((t) => t.status !== "done" && t.dueAt && new Date(t.dueAt).getTime() < now);
  const mine = member ? overdue.filter((t) => t.assignedMemberId === member.id) : [];
  if (overdue.length) {
    out.push({ icon: "AlertCircle", text: mine.length ? `What's overdue that's assigned to ${firstName(member?.displayName) || "me"}?` : "What tasks are overdue for the household?" });
  }

  const unread = data.threads.filter((t) => t.unread);
  if (unread.length) {
    out.push({ icon: "MessageSquare", text: `Summarize what I missed in "${unread[0].title}"` });
  }

  const drafts = isAdult ? data.agents.filter((a) => a.status === "Draft") : [];
  if (drafts.length) {
    out.push({ icon: "Bot", text: `Help me finish setting up "${drafts[0].name}"` });
  }

  // Fallback starters — real household actions, not generic filler, for a quiet or
  // brand-new household with no signals above yet.
  const fallback: AskSuggestion[] = [
    { icon: "UtensilsCrossed", text: "Plan three dinners for this week and start a grocery list" },
    { icon: "BellPlus", text: "Remind me about something tomorrow" },
    { icon: "Mail", text: "Draft an email I can review before it sends" },
    { icon: "Sparkles", text: "What can you help our household with?" },
  ];
  for (const f of fallback) {
    if (out.length >= 4) break;
    out.push(f);
  }
  return out.slice(0, 4);
}

/* ------------------------------------------------------------------------- *
 * No-provider chat fallback — when Ask FamiliOS has no connected AI
 * provider, this is what lets the surface keep its "every task resolves
 * locally" promise instead of dead-ending. It classifies a chat message into
 * something the deterministic engine can genuinely do (a plan it can draft,
 * a household-data question it can answer from live state, or a capability
 * question) versus open-ended reasoning that honestly needs a provider —
 * and only ever proposes what it can actually deliver.
 * ------------------------------------------------------------------------- */

export type LocalAskKind = "plan" | "capability" | "data" | "unsupported";

export interface LocalAskAnswer {
  kind: LocalAskKind;
  /** Chat-ready text (markdown-safe) describing the answer. */
  text: string;
  /** Present when `kind === "plan"` — a real, approvable automation proposal. */
  plan?: { plan: WorkflowPlan; agentId: string; agentName: string; approvalRequired: boolean; triggerType: TriggerType };
}

const CAPABILITY_RE = /what can you (help|do)|what do you do|how (can|do) you help|what are you (able|capable)/i;
const CALENDAR_RE = /\b(calendar|schedule)\b.*\btoday\b|today'?s (events|agenda|schedule)|what'?s (happening|going on) today/i;
const APPROVAL_RE = /\bapproval|waiting on me|pending (my )?approval\b/i;
const OVERDUE_RE = /\bover ?due\b|\btasks?\b.*\b(due|left|open)\b/i;
const UNREAD_RE = /\bmissed\b|\bunread\b|summarize.*(thread|conversation|messages)/i;
const DRAFT_AGENT_RE = /finish setting up|draft (agent|helper)/i;
const ACTION_RE = /\b(plan|remind(er)?|draft|organize|schedule|track|summar(y|ize|ise)|automat|set ?up|create|build|watch|monitor)\b/i;

/** Plain-language summary of what the local rules engine can do, drawn from
 *  the real intent catalog rather than a hand-maintained marketing blurb. */
export function describeLocalCapabilities(): string {
  const examples = INTENTS.slice(0, 6).map((i) => i.label.toLowerCase()).join(", ");
  return `Without a connected AI provider, I run on FamiliOS's built-in rules engine — I can still draft a real, approvable plan for things like ${examples}, and more. Try "Plan…", "Remind me…", "Draft…", or "Organize…", or ask about your calendar, approvals, or tasks. Nothing runs without your approval.`;
}

/** Answers a factual question about the household's own live data with no
 *  reasoning model required — the same signals that power the suggestion
 *  chips (see `suggestAskPrompts`), read directly instead of guessed at. */
export function answerLocalDataQuestion(text: string, data: AppData, member?: Member): string | null {
  const now = Date.now();
  if (CALENDAR_RE.test(text)) {
    const todays = data.events
      .filter((e) => new Date(e.startAt).toDateString() === new Date().toDateString())
      .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
    return todays.length
      ? `Today's schedule:\n${todays.map((e) => `- ${e.title}${e.location ? ` (${e.location})` : ""} — ${new Date(e.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`).join("\n")}`
      : "Nothing on the calendar today — a calm day.";
  }
  if (APPROVAL_RE.test(text)) {
    const pending = data.approvals.filter((a) => a.status === "Pending");
    return pending.length
      ? `${pending.length} approval${pending.length > 1 ? "s" : ""} waiting on you:\n${pending.slice(0, 6).map((a) => `- ${a.title}`).join("\n")}`
      : "Nothing is waiting on your approval right now.";
  }
  if (OVERDUE_RE.test(text)) {
    const overdue = data.tasks.filter((t) => t.status !== "done" && t.dueAt && new Date(t.dueAt).getTime() < now);
    const wantsMine = /\bme\b|\bmy\b/i.test(text) && member;
    const list = wantsMine ? overdue.filter((t) => t.assignedMemberId === member!.id) : overdue;
    return list.length
      ? `${list.length} overdue:\n${list.slice(0, 8).map((t) => `- ${t.title}`).join("\n")}`
      : "Nothing overdue — you're caught up.";
  }
  if (UNREAD_RE.test(text)) {
    const unread = data.threads.filter((t) => t.unread);
    if (!unread.length) return "No unread messages right now.";
    const t0 = unread[0];
    const body = data.messages.filter((m) => m.threadId === t0.id).map((m) => m.body).join(" ");
    return `"${t0.title}": ${body ? summarize(body, 2) : t0.preview || "No preview available."}`;
  }
  if (DRAFT_AGENT_RE.test(text)) {
    const drafts = data.agents.filter((a) => a.status === "Draft");
    return drafts.length
      ? `You have a draft helper agent, "${drafts[0].name}" — open Helper Agents to finish setting it up.`
      : "No draft agents waiting right now.";
  }
  return null;
}

/** Classifies and answers a chat message with the local, deterministic
 *  engine only — no network call, no external provider. Used by the
 *  Assistant surface when no AI provider is connected so the surface keeps
 *  the "every task resolves locally" promise instead of dead-ending. */
export function answerLocally(text: string, data: AppData, member?: Member): LocalAskAnswer {
  const t = text.trim();
  if (!t) return { kind: "unsupported", text: describeLocalCapabilities() };

  if (CAPABILITY_RE.test(t)) return { kind: "capability", text: describeLocalCapabilities() };

  const dataAnswer = answerLocalDataQuestion(t, data, member);
  if (dataAnswer) return { kind: "data", text: dataAnswer };

  const routed = routeToAgent(t, data.agents);
  const intent = detectIntent(t);
  const intentScore = scoreIntent(t, intent);
  if (intentScore > 0 || ACTION_RE.test(t)) {
    const parsed = parseAgentPrompt(t);
    const agentId = routed?.id ?? "";
    const agentName = routed?.name ?? parsed.name;
    const triggerType = detectTrigger(t, intent.defaultTrigger);
    const plan = buildWorkflowPlan(t, { agentId, agentName });
    const { gates } = detectApprovalGates(t);
    return {
      kind: "plan",
      text: "Here's a plan the local rules engine can build — review it and approve to create the automation.",
      plan: { plan, agentId, agentName, approvalRequired: gates.length > 0, triggerType },
    };
  }

  return {
    kind: "unsupported",
    text: `Connecting an AI provider unlocks open-ended answers like this one. Locally, I can already help with things like ${INTENTS.slice(0, 5).map((i) => i.label.toLowerCase()).join(", ")}, and more — try "Plan…", "Remind me…", or "Draft…", or add a provider in Settings → AI Providers.`,
  };
}

/** Provider router — local resolves everything today; cloud adapters are
 *  declared but disabled by default (see Settings). */
export function activeProviderLabel(provider: string): string {
  switch (provider) {
    case "openai":
      return "OpenAI-compatible (placeholder)";
    case "anthropic":
      return "Anthropic-compatible (placeholder)";
    case "gemini":
      return "Gemini-compatible (placeholder)";
    default:
      return "Local rules engine";
  }
}

// Reserved for future use — keeps the verb table referenced.
void ACTION_VERBS;
