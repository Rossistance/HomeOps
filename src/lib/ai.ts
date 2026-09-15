/**
 * The deterministic, local-first rules engine.
 *
 * It answers questions about the household's OWN data, writes the briefing, and says
 * honestly what it cannot do without a connected AI provider.
 *
 * What it no longer does is build things. It used to parse a sentence into an agent
 * config and a step-by-step workflow plan — a guess, dressed as a plan, that the family
 * was then asked to approve. A helper is now written in plain English and read before it
 * is saved, so there is nothing for a regex to infer on anyone's behalf.
 */
import { isTodayEvent } from "@/lib/dates";
import type {
  AppData,
  Member,
} from "@/types";

/** A household job this engine can RECOGNISE by name. It deliberately carries nothing
 *  about how to do the job: the name, icon, space and connector list that used to live
 *  here only ever fed the sentence-to-agent guesser, and a helper is written by a person
 *  now. Matching a request to a label is all that is left, and all that was ever true. */
export interface IntentProfile {
  key: string;
  label: string;
  keywords: string[];
}

const INTENTS: IntentProfile[] = [
  {
    key: "briefing",
    label: "Daily briefing",
    keywords: ["briefing", "every morning", "each morning", "daily", "good morning", "start my day", "today's"],
  },
  {
    key: "school",
    label: "School & daycare",
    keywords: ["school", "daycare", "teacher", "classroom", "permission slip", "picture day", "field trip", "homework"],
  },
  {
    key: "bills",
    label: "Bills & finance",
    keywords: ["bill", "receipt", "expense", "budget", "spending", "reconcile", "statement", "invoice", "payment"],
  },
  {
    key: "subscription",
    label: "Subscriptions",
    keywords: ["subscription", "cancel", "unused", "recurring charge", "free trial"],
  },
  {
    key: "meal",
    label: "Meals & groceries",
    keywords: ["meal", "grocery", "groceries", "dinner", "recipe", "shopping list", "pantry"],
  },
  {
    key: "travel",
    label: "Travel",
    keywords: ["trip", "travel", "vacation", "flight", "hotel", "packing", "itinerary", "reservation"],
  },
  {
    key: "medical",
    label: "Medical",
    keywords: ["doctor", "medical", "appointment", "dentist", "pediatric", "prescription", "follow-up", "health"],
  },
  {
    key: "home",
    label: "Home maintenance",
    keywords: ["repair", "maintenance", "contractor", "quote", "fix", "plumber", "hvac", "furnace", "lawn"],
  },
  {
    key: "caregiving",
    label: "Caregiving",
    keywords: ["caregiving", "grandparent", "elder", "medication", "ride", "assisted living", "parents"],
  },
  {
    key: "document",
    label: "Documents",
    keywords: ["document", "file", "organize", "scan", "pdf", "records", "filing", "renewal", "contract", "legal"],
  },
  {
    key: "pet",
    label: "Pets",
    keywords: ["pet", "dog", "cat", "vet", "feed", "walk", "groom"],
  },
  {
    key: "gift",
    label: "Gifts & birthdays",
    keywords: ["gift", "birthday", "present", "party", "anniversary", "holiday"],
  },
  {
    key: "inbox",
    label: "Inbox",
    keywords: ["inbox", "email", "triage", "archive", "unread", "reply", "follow up", "follow-up"],
  },
  {
    key: "research",
    label: "Research",
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

/** The approvals a surface actually shows. Server approvals are the truth (the local
 *  `data.approvals` mirror is write-only and never learns a decision), so callers pass
 *  them in; the local list is only the fallback for a session with no server. */
export type PendingApprovalLike = { title: string };
function pendingOf(data: AppData, approvals?: PendingApprovalLike[]): PendingApprovalLike[] {
  return approvals ?? data.approvals.filter((a) => a.status === "Pending").map((a) => ({ title: a.title }));
}

/** Build today's family briefing from live local data. */
export function generateBriefing(data: AppData, approvals?: PendingApprovalLike[]): BriefingSection[] {
  const now = Date.now();
  const dayMs = 86400000;
  // "Today" is the same local-day window every other surface uses (isTodayEvent) — this
  // used to be ±1 day, so yesterday's dinner was still "today's schedule" the next morning.
  const todayEvents = data.events
    .filter((e) => isTodayEvent(e, now))
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));

  const overdue = data.tasks.filter((t) => t.status !== "done" && t.dueAt && new Date(t.dueAt).getTime() < now);
  const dueSoon = data.tasks.filter(
    (t) => t.status !== "done" && t.dueAt && new Date(t.dueAt).getTime() >= now && new Date(t.dueAt).getTime() < now + dayMs * 3,
  );
  const bills = data.tasks.filter((t) => t.type === "bill" && t.status !== "done");
  const pendingApprovals = pendingOf(data, approvals);

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

export function suggestNextActions(data: AppData, approvals?: PendingApprovalLike[]): SuggestedAction[] {
  const out: SuggestedAction[] = [];
  const pending = pendingOf(data, approvals);
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
  const paused = data.agents.filter((a) => a.status === "Paused");
  if (paused.length) {
    out.push({
      title: "A helper is paused",
      detail: paused[0].name,
      route: { screen: "helpers", params: { id: paused[0].id } },
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
    title: "Add a helper",
    detail: "Start from a ready-made one and edit what it does",
    route: { screen: "helpers", params: { new: "1" } },
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
export function suggestAskPrompts(data: AppData, member?: Member, approvals?: PendingApprovalLike[]): AskSuggestion[] {
  const isAdult = ADULT_ROLES.has(member?.role ?? "");
  const firstName = (name?: string) => (name ?? "").split(" ")[0];
  const out: AskSuggestion[] = [];

  const pending = pendingOf(data, approvals);
  if (isAdult && pending.length) {
    out.push({ icon: "ShieldCheck", text: pending.length === 1 ? `Tell me about the "${pending[0].title}" approval waiting on me` : `What are the ${pending.length} things waiting on my approval?` });
  }

  const now = Date.now();
  const todayEvents = data.events.filter((e) => isTodayEvent(e, now));
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

export type LocalAskKind = "capability" | "data" | "unsupported";

export interface LocalAskAnswer {
  kind: LocalAskKind;
  /** Chat-ready text (markdown-safe) describing the answer. */
  text: string;
}

const CAPABILITY_RE = /what can you (help|do)|what do you do|how (can|do) you help|what are you (able|capable)/i;
const CALENDAR_RE = /\b(calendar|schedule)\b.*\btoday\b|today'?s (events|agenda|schedule)|what'?s (happening|going on) today/i;
const APPROVAL_RE = /\bapproval|waiting on me|pending (my )?approval\b/i;
const OVERDUE_RE = /\bover ?due\b|\btasks?\b.*\b(due|left|open)\b/i;
const UNREAD_RE = /\bmissed\b|\bunread\b|summarize.*(thread|conversation|messages)/i;
const PAUSED_HELPER_RE = /paused helper|which helpers? (are|is) (paused|off)/i;

/** Plain-language summary of what the local rules engine can do, drawn from
 *  the real intent catalog rather than a hand-maintained marketing blurb. */
export function describeLocalCapabilities(): string {
  const examples = INTENTS.slice(0, 6).map((i) => i.label.toLowerCase()).join(", ");
  return `Without a connected AI provider I run on FamiliOS's built-in rules engine, so I can answer questions about your own household — today's calendar, what is waiting on your approval, what is overdue, what you missed — and set up a helper for things like ${examples}. Anything open-ended needs a provider connected in Settings → AI Providers.`;
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
  if (PAUSED_HELPER_RE.test(text)) {
    const paused = data.agents.filter((a) => a.status === "Paused");
    return paused.length
      ? `Paused right now:\n${paused.map((a) => `- ${a.name}`).join("\n")}\nOpen Helpers to resume one.`
      : "Nothing is paused — every helper is running on its schedule.";
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

  // A standing job belongs in a helper, where the family reads the actual instructions
  // before it can ever run — not in a plan this engine guessed at from one sentence and
  // then asked someone to approve.
  const intent = detectIntent(t);
  if (scoreIntent(t, intent) > 0) {
    return {
      kind: "unsupported",
      text: `That sounds like a standing job — the kind a helper does. Open **Helpers → New helper**, start from "${intent.label}", and edit what it should do in your own words before you save it. For open-ended answers here in chat, connect an AI provider in Settings → AI Providers.`,
    };
  }

  return {
    kind: "unsupported",
    text: `Connecting an AI provider unlocks open-ended answers like this one. Locally I can already answer questions about your calendar, approvals, tasks and messages, and set up a helper for things like ${INTENTS.slice(0, 5).map((i) => i.label.toLowerCase()).join(", ")}.`,
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
