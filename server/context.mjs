// FamiliOS AI — household CONTEXT for the assistant: the live tool catalog, the
// visibility-filtered snapshot of the household a turn is answered against, and the small
// model calls that are not the agent loop (naming a conversation, drafting a mini app).
//
// This file used to be planner.mjs, and most of it was the old brain: one model call that
// classified a message as answer | lookup | plan | build, plus the evolution pass that
// rewrote agents and skills after a failure. All of that is gone — assistant-agent.mjs
// observes real tool results instead of predicting a step list. What remains is the part
// that was always useful: describing the household and its capabilities accurately.
import { PROVIDERS } from "./providers.mjs";
import { CONNECTORS, readinessOf } from "./connectors.mjs";
import { listAccountsFor } from "./accounts.mjs";
import { providerChat, providerChatStream, providerChatWithFallback, aiProviderById } from "./ai.mjs";
import { scheduleText, autonomyText, helperVisibleTo } from "./helper-shape.mjs";
import { getSettings, listEvents, listTasks, listMemory, listMembers, listMeals, canSeeEntity, canSeeEntityInChannel, listAgents, listConversations, getRiskOverride, recordAiUsage, aiBudgetExhausted } from "./store.mjs";
import { listInternalFunctions } from "./internal-functions.mjs";
import { ACTION_INPUTS } from "./actions/registry.mjs";
import { searchWeb, readPage } from "./web.mjs";
import { memoryProvider } from "./memory-provider.mjs";
import { householdTimeZone, localDayBounds, localDateKey, stampToMs } from "./household-time.mjs";

// Input hints for the internal family-data tools, so the planner knows how to fill
// them (and the engine knows which fields require threading — see toolInputSchema).
//
// A DECLARED action's row is not written here — it is derived from the action's own input
// schema (ACTION_INPUTS) so the planner's idea of a tool's fields can never drift from what
// the tool accepts. That drift is real: this table once named three helper tools
// (list_agents / get_agent / update_agent) that did not exist in INTERNAL_FUNCTIONS at all.
// The hand-written rows below are the tools that have not been declared yet.
export const INTERNAL_INPUTS = {
  ...ACTION_INPUTS,
  "homeops.update_event_checklist": [{ key: "eventId", required: true }, { key: "items", required: true }],
  "homeops.assign_driver": [{ key: "eventId", required: true }, { key: "driverId", required: true }],
  "homeops.assign_what_to_bring": [{ key: "eventId", required: true }, { key: "items", required: true }],
  // remindMinutesBefore: "set a reminder" said in the same breath as "add a task" used to be
  // silently dropped — only the UPDATE tool could carry a lead, so a task created by Famili
  // never nudged anyone (2026-09-22: a "notification test" task that could not have fired).
  "homeops.attach_note_or_file_reference": [{ key: "eventId", required: true }, { key: "note" }, { key: "fileRef" }],
  "homeops.send_notification_draft": [{ key: "to" }, { key: "body", required: true }, { key: "subject" }, { key: "channel" }],
  // WP-005: the registry delivery tool — the one path that can actually deliver on a
  // schedule without a per-run approval race.
  "homeops.notify_contact": [{ key: "to" }, { key: "methodId" }, { key: "subject" }, { key: "body", required: true }],
  "homeops.write_memory": [{ key: "text", required: true }, { key: "scope", label: "household | personal" }],
  "homeops.create_artifact": [{ key: "title", required: true }, { key: "body" }, { key: "kind" }],
  "homeops.create_approval": [{ key: "subject", required: true }, { key: "detail" }],
  // Reading an attachment, and pulling structure out of it.
  "homeops.read_file": [{ key: "fileId", required: true }, { key: "question" }],
  "homeops.extract_from_file": [{ key: "fileId", required: true }],
  // K4 — real places, with the family's coordinates when the app supplied them.
  "homeops.find_places": [{ key: "query", required: true }, { key: "lat" }, { key: "lng" }, { key: "limit" }],
  /* Helper inspection + iteration is NOT here. It lives as the native famili.list_helpers /
   * create_helper / update_helper / run_helper tools in assistant-agent.mjs (adult-gated,
   * personal channel). Three rows for homeops.list_agents / get_agent / update_agent sat
   * here for months naming tools that did not exist in INTERNAL_FUNCTIONS, and the prompt
   * told the model to call them; tool-registry-consistency.test.mjs now refuses a row
   * without a tool. */
};

export const ICONS = ["Bot", "Sun", "Mail", "Inbox", "Calendar", "Receipt", "CreditCard", "UtensilsCrossed", "Plane", "Stethoscope", "Wrench", "HeartHandshake", "FolderOpen", "PawPrint", "Gift", "Search", "ShoppingCart", "Bell", "ShieldCheck", "FileText", "Globe", "MessageSquare", "ListChecks"];
const MINIAPP_TYPES = ["Chore Board", "Trip Planner", "Budget Snapshot", "Grocery List", "Medical Tracker", "Subscription Tracker", "Research Comparison", "Custom"];
const RISKS = ["Low", "Medium", "High", "Sensitive"];
const EXECUTABLE = ["connected", "authorized_write", "authorized_readonly", "local_only"];

/* I1 [16:14] — "intelligently name the chat, like ChatGPT or Claude does."
 *
 * Chats were titled with the first 40-60 characters of whatever the user typed, so the
 * switcher filled up with chips reading "give me a list of the 5…" and "What can you do
 * for…" — the exact truncation complaint from A5/K5, but caused by the title itself rather
 * than by the layout.
 *
 * Named from the first exchange (question AND answer), because the question alone is often
 * the ambiguous half: "what about Thursday?" means nothing without what came back.
 *
 * Deliberately cheap and deliberately optional. It runs once per thread, on the smallest
 * available model call, and any failure leaves the existing title exactly as it was — a chat
 * with a clumsy name is a small annoyance; a chat that failed to save because naming it
 * broke is not.
 */
const TITLE_SYS = `Name this conversation the way a person would name a note about it.
- 2 to 5 words. Title Case. No quotes, no trailing period, no emoji.
- Name the SUBJECT, not the request: "Restaurants Near Home", not "User Asks For Restaurants".
- If it is about a specific person or event, use their name: "Beannie's Dentist Appointment".
- If the exchange is small talk or a test, answer exactly: Quick Question
Reply with ONLY the title.`;

export async function nameConversation({ question, answer, session, providerId }) {
  const pid = activeProviderId(providerId, session?.householdId);
  if (!pid) return null;
  if (aiBudgetExhausted(session?.householdId)) return null;
  recordAiUsage(session?.householdId, "title");
  const out = await providerChatWithFallback(pid, {
    messages: [
      { role: "system", content: TITLE_SYS },
      { role: "user", content: `Q: ${String(question ?? "").slice(0, 600)}\n\nA: ${String(answer ?? "").slice(0, 600)}` },
    ],
  }).catch(() => null);
  if (!out?.ok || !out.text) return null;
  // A model that ignores the instructions must not be able to write a paragraph into a chip.
  const title = String(out.text)
    .split("\n")[0]
    .replace(/^["'\s]+|["'\s.]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 60)
    .trim();
  if (!title || title.length < 3) return null;
  return title;
}

// Exported for memory-capture.mjs, which needs the same "which provider answers for this
// household" resolution without re-deriving it and drifting.
export function activeProviderId(explicit, householdId) {
  return explicit || getSettings(householdId).aiActiveProvider || null;
}
// C1.3 budget gate: every planner entry point checks the household's optional
// daily AI budget BEFORE spending, then meters the call it's about to make.
// Returns an honest refusal object, or null to proceed.
function budgetGate(session) {
  if (aiBudgetExhausted(session?.householdId)) {
    return { ok: false, error: "ai_budget_exhausted", message: "Your household's daily AI budget is used up — it resets at midnight (UTC). An admin can raise or remove the limit in Settings." };
  }
  recordAiUsage(session?.householdId, "assistant");
  return null;
}

/** The full, live tool catalog with per-actor connectedness — the planner's menu. */
export function toolCatalog(session) {
  const accountProviders = new Set(
    (session ? listAccountsFor(session.householdId, session.actorId) : []).map((a) => a.provider),
  );
  const out = [];
  const mapInputs = (inputs) => (inputs ?? []).map((i) => ({ key: i.key, label: i.label, type: i.type ?? "text", required: !!i.required, default: i.default }));
  for (const p of PROVIDERS) {
    const connected = accountProviders.has(p.id);
    for (const t of p.tools) {
      out.push({ toolId: t.id, name: t.name, action: t.action, risk: t.risk, requiresApproval: !!t.requiresApproval, connectorId: p.id, connectorName: p.name, source: "provider", connected, inputs: mapInputs(t.inputs) });
    }
  }
  for (const c of CONNECTORS) {
    const readiness = readinessOf(c);
    const connected = EXECUTABLE.includes(readiness);
    for (const t of (c.tools ?? [])) {
      out.push({ toolId: t.id, name: t.name, action: t.action, risk: t.risk, requiresApproval: !!t.requiresApproval, connectorId: c.id, connectorName: c.name, source: "connector", connected, readiness, inputs: mapInputs(t.inputs) });
    }
  }
  // Internal FamiliOS data tools — always available (no external account needed), so the
  // planner grounds family work on real server-owned events/tasks/memory rather than
  // reaching for unconnected external apps.
  for (const f of listInternalFunctions()) {
    out.push({ toolId: f.id, name: f.name, action: f.action, risk: f.risk, requiresApproval: !!f.requiresApproval, connectorId: f.connectorId, connectorName: f.connectorName, source: "internal", connected: true, inputs: mapInputs(INTERNAL_INPUTS[f.id] ?? []), ...(f.description ? { description: f.description } : {}) });
  }
  // Household risk overrides (item 9): the catalog reports EFFECTIVE values so the
  // planner and every UI reflect the same reality the engine enforces. Defaults are
  // preserved alongside so the override is visible (and reversible), never silent.
  if (session?.householdId) {
    for (const t of out) {
      const ov = getRiskOverride(session.householdId, t.toolId, session.actorId ?? null);
      if (!ov) continue;
      t.defaultRisk = t.risk;
      t.defaultRequiresApproval = t.requiresApproval;
      t.risk = ov.riskClass ?? t.risk;
      t.requiresApproval = ov.skipApproval ? false : t.requiresApproval;
      t.riskOverridden = true;
    }
  }
  return out;
}

/* ===================== WP-006 slice 2 — PLANNER CATALOG COMPACTION =====================
 * The full live catalog is dozens of tools. Handed whole to a small LOCAL model (LM Studio
 * / Ollama) it (a) eats context the model needs for the actual reasoning and (b) buries the
 * two or three tools a given goal really needs. This stage prunes the catalog the MODEL
 * SEES (never the catalog used to RESOLVE its answer — normalizePlan still gets the full
 * catalog, and the engine still re-validates every step), in two independent steps:
 *   (a) restrict to the acting agent's PERMITTED tools (allow/deny), always keeping the
 *       always-available internal homeops.* tools — for EVERY provider. An agent can only
 *       run its permitted set, so nothing else belongs on its menu.
 *   (b) for a LOCAL provider only, additionally rank by relevance to the goal text and cap
 *       the serialized catalog under a char budget (HOMEOPS_PLANNER_CATALOG_BUDGET). Cloud
 *       providers keep the full permitted catalog — unchanged behavior.
 * The scorer is deterministic (keyword/token overlap, stable tiebreak) — no AI call. */

// HYP-005: LM Studio is DOWN on this host, so the budget cannot be latency-tuned against
// Qwen live (DEFERRED-ON-GATE). The default is a generous char budget chosen so a typical
// permitted catalog is NOT pruned in practice; a smaller value (~2500) is the journal-ready
// starting point to profile once the token gate is user-owned. ~4 chars ≈ 1 token.
export function plannerCatalogBudget() {
  const n = Number(process.env.HOMEOPS_PLANNER_CATALOG_BUDGET);
  return Number.isFinite(n) && n > 0 ? n : 8000;
}

// A LOCAL AI provider (LM Studio / Ollama) — read from ai.mjs' provider metadata, never
// hard-coded, so a future local provider inherits the compaction automatically.
export function isLocalProvider(providerId) {
  if (!providerId) return false;
  const p = aiProviderById(providerId);
  return !!p && (p.local === true || p.kind === "local");
}

// Always-on internal tools: the homeops.* family-data functions need no external account,
// so they belong on every agent's menu regardless of allow-list or budget pressure.
function isAlwaysAvailableTool(t) {
  return t?.source === "internal" || String(t?.toolId ?? "").startsWith("homeops.");
}

// Pure allow/deny check, mirroring agents.mjs isToolStepAllowed — replicated (not imported)
// to avoid a planner↔agents import cycle. Empty allow-list = permissive (deny-only).
function agentPermitsTool(agent, toolId) {
  if (!agent || !toolId) return true;
  if ((agent.deniedToolIds ?? []).includes(toolId) || (agent.deniedFunctionIds ?? []).includes(toolId)) return false;
  const allow = [...(agent.allowedToolIds ?? []), ...(agent.allowedFunctionIds ?? [])];
  return allow.length === 0 || allow.includes(toolId);
}

const CATALOG_STOPWORDS = new Set(["the", "and", "for", "with", "that", "this", "you", "your", "our", "was", "are", "get", "got", "let", "them", "then", "into", "from", "have", "has", "will", "would", "can", "want", "need", "please", "a", "an", "to", "of", "on", "in", "is", "it", "at", "by", "my", "me", "we", "us", "do", "add", "new"]);
function tokenizeForCatalog(s) {
  return new Set(String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !CATALOG_STOPWORDS.has(w)));
}
// Deterministic relevance: how many goal tokens appear in the tool's name/action/connector/id.
function relevanceScore(t, goalTokens) {
  if (!goalTokens.size) return 0;
  const hay = tokenizeForCatalog(`${t.name ?? ""} ${t.action ?? ""} ${t.connectorName ?? ""} ${String(t.toolId ?? "").replace(/[._]/g, " ")}`);
  let score = 0;
  for (const w of goalTokens) if (hay.has(w)) score++;
  return score;
}

const projectCatalogTool = (t) => ({ id: t.toolId, name: t.name, action: t.action, risk: t.risk, approval: t.requiresApproval, connector: t.connectorId, connected: t.connected, inputs: (t.inputs ?? []).map((i) => (typeof i === "string" ? i : i.key)) });

/**
 * Build the COMPACT catalog the model sees, from a full toolCatalog() array.
 * @param {Array} catalog full toolCatalog(session) output
 * @param {object} opts
 * @param {object|null} opts.agent    acting agent (permitted-tools restriction); null = no restriction
 * @param {string}      opts.goal     goal/message text (relevance ranking for local providers)
 * @param {string|null} opts.providerId RESOLVED active provider id (local → budget+rank)
 * @param {number}      [opts.budget] char budget override (defaults to plannerCatalogBudget())
 */
export function pruneCatalogForPrompt(catalog, { agent = null, goal = "", providerId = null, budget } = {}) {
  const permitted = agent
    ? catalog.filter((t) => isAlwaysAvailableTool(t) || agentPermitsTool(agent, t.toolId))
    : catalog.slice();

  // Cloud (or unknown) provider: full permitted catalog, unchanged behavior.
  if (!isLocalProvider(providerId)) return permitted.map(projectCatalogTool);

  // Local provider: rank by relevance, then greedily fill a char budget. Always-available
  // homeops.* tools are retained first and never dropped (they are the family-data spine).
  const cap = budget ?? plannerCatalogBudget();
  const goalTokens = tokenizeForCatalog(goal);
  const ranked = permitted
    .map((t, i) => ({ t, i, score: relevanceScore(t, goalTokens) }))
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .map((x) => x.t);

  const essential = ranked.filter(isAlwaysAvailableTool);
  const optional = ranked.filter((t) => !isAlwaysAvailableTool(t));
  const kept = new Set(essential);
  let size = JSON.stringify(essential.map(projectCatalogTool)).length;
  for (const t of optional) {
    const add = JSON.stringify(projectCatalogTool(t)).length + 1;
    if (size + add > cap) break;
    kept.add(t); size += add;
  }
  // Emit in relevance order (most-relevant first), keeping only the chosen tools.
  return ranked.filter((t) => kept.has(t)).map(projectCatalogTool);
}

// Escape raw control chars (newlines/tabs) that appear INSIDE JSON string literals —
// the single most common reason a model's otherwise-valid JSON fails to parse (e.g. a
// multi-line briefing in an `answer` field). Only touches chars inside unescaped strings.
function repairJSONControlChars(s) {
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { out += c; esc = false; continue; }
    if (c === "\\") { out += c; esc = true; continue; }
    if (c === '"') { inStr = !inStr; out += c; continue; }
    if (inStr && c === "\n") { out += "\\n"; continue; }
    if (inStr && c === "\r") { out += "\\r"; continue; }
    if (inStr && c === "\t") { out += "\\t"; continue; }
    out += c;
  }
  return out;
}

/** Tolerant JSON extraction — handles code fences, surrounding prose, and repairs the
 *  common "raw newline inside a string" malformation before giving up. */
export function extractJSON(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return null;
  const slice = t.slice(first, last + 1);
  try { return JSON.parse(slice); } catch { /* fall through to a repair attempt */ }
  try { return JSON.parse(repairJSONControlChars(slice)); } catch { return null; }
}

// When the model emitted our JSON envelope but it STILL won't parse, never dump the raw
// JSON into the chat. Recover the human-facing `answer` string if we can; otherwise say
// we hit a snag. Plain prose (no envelope) passes through unchanged.
function safeAnswerFallback(rawText) {
  const t = String(rawText || "").trim();
  if (!t) return "I'm not sure how to help with that yet.";
  if (/"kind"\s*:/.test(t) && /"answer"\s*:/.test(t)) {
    const m = t.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) { try { return JSON.parse('"' + m[1] + '"'); } catch { return m[1]; } }
    return "I hit a snag composing that — mind trying again?";
  }
  if (/^[[{]/.test(t) && /[}\]]$/.test(t)) return "I hit a snag composing that — mind trying again?";
  return t;
}

/* ---- WP-003 (ISS-002): EFFECT-CLAIMING STEPS ----
 * A step with `toolId: null` is a REASONING step — the engine thinks, writes text, and
 * moves on. Nothing leaves the house. But models routinely emit toolless steps titled
 * "Send email to wrhixon@gmail.com", and the engine dutifully marked them `succeeded`.
 * The run then read 3/3 complete and the chat said "That worked" — for a run that had
 * composed a briefing and sent absolutely nothing (EV-012). That single mismatch is the
 * user's whole complaint.
 *
 * So: detect a toolless step whose own words CLAIM an external effect, and mark it.
 * The engine refuses to call it a success, and the summary says what didn't happen.
 * Deliberately narrow — it matches delivery verbs against the step's title/detail only.
 * "Compose the briefing", "Summarize the week", "Decide which items matter" are honest
 * reasoning steps and are untouched, which is the regression this guard must not cause. */
const EFFECT_VERBS = /\b(send|sends|sending|sent|email|e-mail|emails|emailing|text|texts|texting|sms|message|messages|messaging|notify|notifies|notifying|deliver|delivers|delivering|dispatch|post|posts|publish|publishes|share|shares|forward|forwards|reply|replies|alert|alerts)\b/i;
// Guard against reasoning steps that merely TALK about a later delivery
// ("draft the email body", "decide who to notify") rather than claiming to do it.
const PREPARATORY = /\b(draft|drafts|drafting|compose|composes|composing|prepare|prepares|preparing|write|writes|writing|decide|decides|deciding|choose|chooses|choosing|select|selects|selecting|summarize|summarizes|summarizing|plan|plans|planning|review|reviews|reviewing)\b/i;

export function claimsExternalEffect(step) {
  if (!step || step.toolId) return false;
  const title = String(step.title ?? "");
  const detail = String(step.detail ?? "");
  const text = `${title} ${detail}`;
  if (!EFFECT_VERBS.test(text)) return false;
  // If the TITLE leads with preparatory language, treat it as composition, not delivery.
  if (PREPARATORY.test(title) && !EFFECT_VERBS.test(title)) return false;
  return true;
}



/**
 * Build the assistant's grounding context from SERVER-OWNED data (events, tasks,
 * memory, members), visibility-filtered to the requesting actor. This replaces blind
 * trust in the client-provided context: the server's view of the household is
 * authoritative, and a child's assistant never sees adults-only items. The client
 * context (if any) is kept only as a low-priority hint.
 */
/** Start of the day containing `nowISO` — on the HOUSEHOLD's clock when `tz` is given, else
 *  the server's (the previous behaviour, kept for callers with no household). `setHours(0)`
 *  on a UTC-hosted server put "today" at 8 PM the previous evening for a US family, which is
 *  how the assistant came to deny a 5 PM movie the whole family could see on the calendar. */
export function startOfLocalDay(nowISO, tz) {
  const ms = nowISO ? Date.parse(nowISO) : Date.now();
  if (tz) {
    const b = localDayBounds(Number.isNaN(ms) ? Date.now() : ms, tz);
    if (b && Number.isFinite(b.start)) return new Date(b.start).toISOString();
  }
  const d = nowISO ? new Date(nowISO) : new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Is this event still worth showing the assistant, given the current instant?
 *
 * Exported and pure so the boundary that caused the "I can't see your calendar" failure is
 * directly testable, rather than a filter buried in a 90-line context builder.
 */
export function isUpcomingForContext(e, nowISO, tz) {
  if (!e?.startAt) return true;                       // undated items are always relevant
  const dayStart = Date.parse(startOfLocalDay(nowISO, tz));
  const startMs = tz ? stampToMs(e.startAt, tz) : Date.parse(e.startAt);
  if (Number.isNaN(startMs)) return true;             // unparseable: better shown than hidden
  if (startMs >= dayStart) return true;               // anything today or later
  const endMs = e.endAt ? (tz ? stampToMs(e.endAt, tz) : Date.parse(e.endAt)) : NaN;
  const nowMs = nowISO ? Date.parse(nowISO) : Date.now();
  return !Number.isNaN(endMs) && endMs >= nowMs;      // started earlier, still running
}

/* `channel` is WHERE THE ANSWER WILL BE READ, which is not the same question as who asked.
 * "personal" (the default, and every caller that existed before the group lanes) filters to
 * what the asker may see. "group" narrows further to what is shared anyway, because the
 * audience of a family group thread includes people who are not in the household. See
 * canSeeEntityInChannel in store.mjs for the reasoning and for why `adults` is not in it. */
export async function buildServerContext(session, clientContext, { goal, channel = "personal" } = {}) {
  if (!session) return clientContext ?? {};
  const inChannel = (e) => canSeeEntityInChannel(e, session, channel);
  const hh = session.householdId;
  const now = new Date().toISOString();
  const tz = householdTimeZone(hh);
  // "Upcoming" is measured from the START OF TODAY, not from this instant.
  //
  // This filter used to be `startAt >= now`, and it is why the assistant kept insisting it
  // could not see events the family could see plainly on their calendar ("I definitely see
  // it, it says all school movie and it's on my calendar for today at 5 PM"). Two ways it
  // silently hid today:
  //   • a timed event at 5 PM, asked about at 6 PM, is already in the past by instant;
  //   • an ALL-DAY event today starts at local midnight, so it was excluded from one
  //     minute past midnight onward — i.e. for the entire day it was happening.
  // The model is instructed to answer only from this context, so a dropped event doesn't
  // read as "missing data" — it reads as the assistant flatly denying reality.
  //
  // A day-scoped window matches how a household actually thinks ("until 12 PM tonight it
  // is still upcoming"), and the extra clause keeps multi-day events that began earlier
  // but haven't finished yet.
  const events = listEvents((e) => e.householdId === hh)
    .filter(inChannel)
    .filter((e) => isUpcomingForContext(e, now, tz))
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
    .slice(0, 12)
    // endAt/allDay ride along so the assistant can say "All day" or "until 8pm" instead of
    // inventing a time, and can reason about what is happening RIGHT NOW.
    .map((e) => ({ id: e.id, title: e.title, startAt: e.startAt, endAt: e.endAt ?? null, allDay: e.allDay === true, location: e.location, driverId: e.driverId, participants: e.participantIds }));
  const tasks = listTasks((t) => t.householdId === hh)
    .filter(inChannel)
    .filter((t) => t.status !== "done")
    .slice(0, 10)
    .map((t) => ({ id: t.id, title: t.title, type: t.type, dueAt: t.dueAt, assignedMemberId: t.assignedMemberId }));
  // WP-007 (DEC-014) — retrieval-quality memory read path. When the provider (real
  // sidecar, or its always-available sqlite-FTS5 fallback — see memory-provider.mjs) is
  // healthy, ground the assistant on profile() + search(goal) instead of a flat recency
  // slice. When it's degraded/offline, fall back to the legacy listMemory() behavior with
  // an EXPLICIT disclosure marker in the context — never a silent, unannounced downgrade.
  /* In the group channel a personal memory is dropped OUTRIGHT rather than matched against
   * the asker: the asker is not the audience, and "their own memory" is the single most
   * sensitive thing this context carries. Memory has its own `scope` vocabulary rather than
   * an entity `visibility`, so canSeeEntityInChannel does not reach it. */
  const visibleToActor = (m) =>
    m.scope !== "personal" || (channel !== "group" && (m.sourceActorId ?? m.source?.actorId) === session.actorId);
  let memory; let memoryDisclosure;
  const memHealth = await memoryProvider.health();
  if (memHealth.ok) {
    const [profileRes, searchRes] = await Promise.all([
      memoryProvider.profile({ containerTag: hh }),
      goal ? memoryProvider.search(String(goal), { containerTag: hh, limit: 8 }) : Promise.resolve({ ok: true, degraded: false, results: [] }),
    ]);
    if (profileRes.ok && searchRes.ok) {
      const seen = new Set();
      const rows = [];
      for (const r of [...(searchRes.results ?? []), ...(profileRes.highlights ?? [])]) {
        if (!r?.text || seen.has(r.text)) continue;
        if (!visibleToActor(r)) continue;
        seen.add(r.text);
        rows.push({ text: r.text, scope: r.scope });
        if (rows.length >= 6) break;
      }
      memory = rows;
    } else {
      memoryDisclosure = "memory recall degraded — provider returned an error, showing recent entries only";
    }
  } else {
    memoryDisclosure = "memory recall degraded — sidecar offline, showing recent entries only";
  }
  if (memoryDisclosure) {
    memory = listMemory({ householdId: hh, limit: 6 })
      .filter((m) => m.scope !== "personal" || m.source?.actorId === session.actorId)
      .map((m) => ({ text: m.text, scope: m.scope }));
  }
  // Active roster only — archived members (removed invites, demo seeds) were
  // leaking in and made the assistant size meals for a phantom family of 10.
  const activeMembers = listMembers({ householdId: hh }).filter((m) => !m.archived);
  const members = activeMembers.map((m) => ({ id: m.actorId, name: m.displayName, role: m.role, relationship: m.relationship ?? null }));
  const householdSize = activeMembers.length;
  const inHh = (x) => x.householdId === hh || x.householdId === "local";
  /* The FAMILY chats, as context.
   *
   * Asked for as the other half of the Adult Member silo: their own chat stays private, but
   * the assistant should "pick up on context on things that are happening in the entire
   * household, and the family chats". It applies to everyone, not only Adult Members — an
   * assistant that can't see the conversation where the family agreed on Saturday is going
   * to ask about Saturday again.
   *
   * Household-visibility threads only. A personal thread — anyone's, including the caller's
   * other ones — is never pulled in: that is exactly the isolation the silo promises, and
   * the same rule canSeeConversation already enforces on the wire. Titles plus the last
   * exchange, capped, because this is orientation and not a transcript.
   *
   * This one needs no `channel` narrowing: the household filter it already applies IS the
   * group rule. Said out loud because it is the field that most looks like it was missed.
   */
  const familyChats = listConversations((c) => c.householdId === hh && c.visibility === "household")
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, 5)
    .map((c) => {
      const msgs = (c.messages ?? []).filter((m) => m.text);
      const last = msgs.slice(-2).map((m) => `${m.role === "user" ? "asked" : "answered"}: ${String(m.text).slice(0, 180)}`);
      return { title: c.title, updatedAt: c.updatedAt, recent: last };
    })
    .filter((c) => c.recent.length > 0);
  /* One list, not three. The model used to be handed existingAgents AND existingSkills AND
   * existingAutomations and had to work out which of the three a request belonged to — the
   * same guess the family was being asked to make. A helper carries its own schedule and
   * its own autonomy, so there is one row per thing that exists.
   *
   * PRIVACY: a PERSONAL helper belongs to the member who made it. Without agentVisibleTo
   * one member's private helper appears in another member's context and the assistant
   * cheerfully names it — which matters more now that an Adult Member's helpers are
   * personal by default. */
  /* In the group channel, a PERSONAL helper is dropped even from its own owner: naming
   * "Ross's medication reminder" to the thread discloses it to everyone reading. */
  const existingHelpers = listAgents(inHh)
    .filter((a) => helperVisibleTo(a, session))
    .filter((a) => channel !== "group" || String(a.visibility ?? "household") === "household")
    .map((a) => ({
    id: a.id, name: a.name, purpose: a.purpose ?? "",
    runs: scheduleText(a.schedule), permission: autonomyText(a),
    enabled: a.enabled !== false && a.status !== "Paused",
    lastRun: a.lastRun ? { at: new Date(a.lastRun.at).toISOString(), ok: a.lastRun.ok, summary: a.lastRun.summary } : null,
  }));
  // The meal plan rides along so scheduling conflicts are visible BEFORE the
  // assistant proposes anything ("Wednesday already has tacos — swap or keep?").
  /* Meals carry no visibility filter on the personal path and never have — a meal plan is a
   * household artifact. The group narrowing is applied one-directionally so that stays true:
   * this must not become the commit that quietly starts hiding meals in the app. */
  const upcomingMeals = listMeals((m) => m.householdId === hh && !m.archived && m.date && m.date >= now.slice(0, 10))
    .filter((m) => channel !== "group" || canSeeEntityInChannel(m, session, "group"))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 14)
    .map((m) => ({ date: m.date, slot: m.slot, title: m.title }));
  // Device location (permission-gated, city-level, sent by the app) is promoted
  // to a first-class context field so local requests tailor without follow-ups.
  const loc = clientContext?.location;
  const location = loc && typeof loc === "object" && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)
    ? { latitude: loc.latitude, longitude: loc.longitude, city: loc.city ?? null, region: loc.region ?? null, country: loc.country ?? null }
    : undefined;
  return {
    now, timezone: tz, today: localDateKey(Date.parse(now), tz), asActor: { id: session.actorId, role: session.role },
    householdSize, members, upcomingEvents: events, openTasks: tasks, upcomingMeals, recentMemory: memory,
    ...(memoryDisclosure ? { memoryDisclosure } : {}),
    existingHelpers,
    ...(familyChats.length ? { familyChats } : {}),
    ...(location ? { location } : {}),
    /* THE ATTACHMENT BUG, half one. The client's context was tucked entirely under
     * `clientHints`, so a photo's details landed at context.clientHints.attachedFileName while
     * the system prompt told the model to look at context.attachedFileName. It looked, found
     * nothing, and reported — accurately — that it had only been given a filename.
     *
     * The metadata is small and lifts to where it was always documented. The CONTENTS do not
     * travel through here at all any more; see attachmentSection below. */
    ...(clientContext?.attachedFileName ? { attachedFileName: clientContext.attachedFileName } : {}),
    ...(clientContext?.attachedFileKind ? { attachedFileKind: clientContext.attachedFileKind } : {}),
    ...(clientContext?.attachedFileError ? { attachedFileError: clientContext.attachedFileError } : {}),
    ...(clientContext?.attachedFileTruncated ? { attachedFileTruncated: true } : {}),
    ...(clientContext?.attachedAlsoNames ? { attachedAlsoNames: clientContext.attachedAlsoNames } : {}),
    clientHints: clientContext ?? undefined,
  };
}

/**
 * The attached file's contents, as their own labelled section of the user message.
 *
 * THE ATTACHMENT BUG, half two, and the worse half. The household context is serialised and cut
 * at 4000 characters — `JSON.stringify(serverCtx).slice(0, 4000)`. A page of transcribed text
 * from a photo is longer than that on its own, and it sat at the END of the object, so it was
 * sliced off entirely. Worse: cutting a JSON string mid-way leaves invalid JSON, so the part
 * that DID survive was garbage to the model too.
 *
 * So the contents never travel inside that blob. They get their own section, with their own
 * budget, after the context and before the question — which also makes the boundary between
 * "what the household looks like" and "what this photo says" legible to the model instead of
 * being two different things inside one JSON object.
 */
export function attachmentSection(clientContext) {
  const text = clientContext?.attachedFileText;
  if (!text || typeof text !== "string" || !text.trim()) return "";
  const name = clientContext.attachedFileName ?? "the attached file";
  const kind = String(clientContext.attachedFileKind ?? "file").toUpperCase();
  // 12k characters: a dense page of transcription fits, and one attachment still can't crowd
  // the household context and the tool catalog out of the window.
  const body = text.length > 12000 ? `${text.slice(0, 12000)}
…(truncated)` : text;
  const also = Array.isArray(clientContext.attachedAlsoNames) && clientContext.attachedAlsoNames.length
    ? `
Also attached but NOT read: ${clientContext.attachedAlsoNames.join(", ")}. Say so if it matters; never imply you looked at them.`
    : "";
  return `

ATTACHED ${kind} — "${name}". This is its real contents, read on the server moments ago. Answer from it:
"""
${body}
"""${also}`;
}


export async function generateMiniApp({ goal, type, session, providerId } = {}) {
  if (!goal || !String(goal).trim()) return { ok: false, error: "empty_goal", message: "Describe the mini app you want." };
  const id = activeProviderId(providerId, session?.householdId);
  if (!id) return { ok: false, error: "no_provider", message: "No AI provider is connected for this household yet, so I can't build a mini app." };
  const gated = budgetGate(session); if (gated) return gated;
  const user = `Allowed types: ${MINIAPP_TYPES.join(", ")}.${type ? ` Preferred type: ${type}.` : ""}\nRequest: ${String(goal).trim()}`;
  const out = await providerChat(id, { messages: [{ role: "system", content: MINIAPP_SYS }, { role: "user", content: user }] });
  if (!out.ok) return { ok: false, error: out.error ?? "provider_error", message: out.message ?? "The AI provider did not respond." };
  const parsed = extractJSON(out.text);
  if (!parsed) return { ok: false, error: "parse_failed", message: "The AI response could not be parsed. Try rephrasing." };
  const t = MINIAPP_TYPES.includes(parsed.type) ? parsed.type : (type && MINIAPP_TYPES.includes(type) ? type : "Custom");
  return { ok: true, app: { type: t, name: String(parsed.name ?? String(goal).slice(0, 40)), description: String(parsed.description ?? ""), data: parsed.data && typeof parsed.data === "object" ? parsed.data : {} }, model: out.model };
}

