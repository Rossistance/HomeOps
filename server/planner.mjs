// FamiliOS AI — the planning brain. Turns a plain-English goal into a concrete,
// executable plan by giving the connected AI provider the LIVE tool catalog (real
// provider + connector tools, annotated with whether THIS actor has connected the
// account each needs) and asking it to select tools, fill inputs, and decide which
// steps require approval. Nothing here is simulated: the catalog is real, the model
// call is real (server/ai.mjs), and every selected step maps to a real executor.
import { PROVIDERS } from "./providers.mjs";
import { CONNECTORS, readinessOf } from "./connectors.mjs";
import { listAccountsFor } from "./accounts.mjs";
import { providerChat, providerChatStream, providerChatWithFallback, aiProviderById } from "./ai.mjs";
import { getSettings, listEvents, listTasks, listMemory, listMembers, listMeals, canSeeEntity, listAgents, listSkills, listTriggers, listConversations, getRiskOverride, recordAiUsage, aiBudgetExhausted } from "./store.mjs";
import { agentVisibleTo } from "./agents.mjs";
import { listInternalFunctions } from "./internal-functions.mjs";
import { searchWeb, readPage } from "./web.mjs";
import { memoryProvider } from "./memory-provider.mjs";
import { listPublicFunctions } from "./functions.mjs";
import { householdTimeZone, localDayBounds, localDateKey, stampToMs } from "./household-time.mjs";

// Input hints for the internal family-data tools, so the planner knows how to fill
// them (and the engine knows which fields require threading — see toolInputSchema).
export const INTERNAL_INPUTS = {
  "homeops.create_event_draft": [{ key: "title", required: true }, { key: "startAt" }, { key: "endAt" }, { key: "allDay" }, { key: "location" }, { key: "notes" }, { key: "participantIds" }, { key: "driverId" }, { key: "visibility" }],
  "homeops.update_event_checklist": [{ key: "eventId", required: true }, { key: "items", required: true }],
  "homeops.assign_driver": [{ key: "eventId", required: true }, { key: "driverId", required: true }],
  "homeops.assign_what_to_bring": [{ key: "eventId", required: true }, { key: "items", required: true }],
  "homeops.create_task": [{ key: "title", required: true }, { key: "dueAt" }, { key: "assignedMemberId" }, { key: "priority" }, { key: "notes" }],
  "homeops.create_list_item": [{ key: "text", required: true }, { key: "listName" }],
  // The prompt contract and this schema used to disagree: recipeUrl/instructions/servings/
  // replace were read by the handler and named in the prompt, but never declared here — so
  // the engine's input fill dropped them (Severity-5 item 7) and a meal lost its recipe.
  "homeops.plan_meal": [{ key: "title", required: true }, { key: "date" }, { key: "slot" }, { key: "time" }, { key: "ingredients" }, { key: "instructions" }, { key: "recipeUrl" }, { key: "servings" }, { key: "replace" }, { key: "notes" }],
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
  // Helper inspection + iteration — the whole point of having a model behind this.
  "homeops.list_agents": [],
  "homeops.get_agent": [{ key: "agentId", required: true }],
  "homeops.update_agent": [
    { key: "agentId", required: true }, { key: "name" }, { key: "purpose" }, { key: "instructions" }, { key: "status" },
    // G5: "don't ask for permission, you have approval" — said in chat, so it has to be
    // reachable from chat. includeSendAndSpend only lands for an Owner/Adult Admin.
    { key: "runUnattended" }, { key: "includeSendAndSpend" },
  ],
};

export const ICONS = ["Bot", "Sun", "Mail", "Inbox", "Calendar", "Receipt", "CreditCard", "UtensilsCrossed", "Plane", "Stethoscope", "Wrench", "HeartHandshake", "FolderOpen", "PawPrint", "Gift", "Search", "ShoppingCart", "Bell", "ShieldCheck", "FileText", "Globe", "MessageSquare", "ListChecks"];
export const TRIGGERS = ["Schedule", "Webhook", "RSS Feed", "Email Received", "Email Label Applied", "Text Message Received", "Email Reply Received", "Calendar Event Created", "File Changed", "Manual", "Agent-to-Agent"];
export const SPACE_TYPES = ["Personal", "Family", "School", "Bills", "Medical", "Travel", "Home Maintenance", "Caregiving", "Pets", "Custom"];
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
    out.push({ toolId: f.id, name: f.name, action: f.action, risk: f.risk, requiresApproval: !!f.requiresApproval, connectorId: f.connectorId, connectorName: f.connectorName, source: "internal", connected: true, inputs: mapInputs(INTERNAL_INPUTS[f.id] ?? []) });
  }
  // Registered (household-authored) functions — Severity-5 item 2. The engine could EXECUTE
  // them (resolveRegisteredFunction) but the planner, the assistant, the repair pass, the
  // risk-override route and the function-builder picker all fed from this catalog, which
  // never listed them: a family could author, test and allow-list a function and no chat
  // could ever reach it. "connected" is the function's live availability (passed a real
  // test + deps satisfied), so an unready one shows up honestly rather than not at all.
  if (session) {
    for (const f of listPublicFunctions(session)) {
      if (!f || f.state === "deprecated") continue;
      out.push({ toolId: f.id, name: f.name ?? f.id, action: f.effectiveAction ?? "Other", risk: f.effectiveRisk ?? "Low", requiresApproval: !!f.requiresApproval, connectorId: f.connectorId ?? "functions", connectorName: f.connectorName ?? "Functions", source: "function", connected: f.executable === true, readiness: f.state, description: f.description ?? "", inputs: mapInputs(f.input_schema ?? []) });
    }
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

export function normalizePlan(p, catalog, goal) {
  const byId = new Map(catalog.map((t) => [t.toolId, t]));
  const icon = ICONS.includes(p.icon) ? p.icon : "Bot";
  const spaceType = SPACE_TYPES.includes(p.spaceType) ? p.spaceType : "Personal";
  const tType = p.trigger?.type ?? p.triggerType;
  const triggerType = TRIGGERS.includes(tType) ? tType : "Manual";
  const rawSteps = Array.isArray(p.steps) ? p.steps : [];
  const steps = rawSteps.slice(0, 12).map((s) => {
    const t = s && s.toolId ? byId.get(s.toolId) : undefined;
    const base = { toolId: t ? s.toolId : null, title: String(s?.title ?? t?.name ?? "Step"), detail: String(s?.detail ?? "") };
    return {
      ...base,
      // WP-003: a toolless step that claims to SEND is flagged here, once, so every
      // downstream consumer (engine, summary, both clients) sees the same verdict.
      effectClaimed: claimsExternalEffect(base),
      requiresApproval: t ? t.requiresApproval : !!s?.requiresApproval,
      risk: t?.risk ?? (RISKS.includes(s?.risk) ? s.risk : "Low"),
      connectorId: t?.connectorId ?? null,
      connectorName: t?.connectorName ?? null,
      connected: t ? t.connected : true,
      input: s && typeof s.input === "object" && s.input ? s.input : {},
    };
  });
  const connectorIds = [...new Set(steps.map((s) => s.connectorId).filter(Boolean))];
  const requiredConnectors = connectorIds.map((cid) => {
    const t = catalog.find((x) => x.connectorId === cid);
    return { id: cid, name: t?.connectorName ?? cid, connected: !!t?.connected };
  });
  const missing = requiredConnectors.filter((c) => !c.connected).map((c) => c.name);
  const risk = RISKS.includes(p.risk) ? p.risk : (steps.some((s) => s.requiresApproval) ? "High" : "Low");
  return {
    title: String(p.title ?? goal.slice(0, 60)),
    summary: String(p.summary ?? ""),
    icon, spaceType, triggerType,
    triggerDetail: String(p.trigger?.detail ?? p.triggerDetail ?? ""),
    instructions: String(p.instructions ?? ""),
    steps, connectorIds, requiredConnectors, missing,
    approvalGates: Array.isArray(p.approvalGates) && p.approvalGates.length ? p.approvalGates.map(String) : steps.filter((s) => s.requiresApproval).map((s) => s.title),
    risk,
    approvalRequired: steps.some((s) => s.requiresApproval),
  };
}

const PLAN_SYS = `You are FamiliOS' planning engine for a family operating system. Turn the user's plain-English goal into a single concrete plan that a helper agent will run.

Rules:
- Select tools ONLY from the provided catalog (match the exact "id"). If a step is reasoning/notify/summarize with no matching tool, set "toolId" to null.
- Prefer tools whose "connected" is true. You may still include a needed tool that is not connected — the app will tell the user to connect it.
- For each tool step, fill "input" using ONLY that tool's listed input keys; use sensible concrete values from the goal (leave unknown values as empty string).
- Mark "requiresApproval" true for any step that sends, writes, deletes, downloads, posts, or pays.
- Keep it to the fewest steps that achieve the goal (max ~8).
- Respond with ONLY a JSON object — no prose, no markdown fences.

JSON shape:
{
  "title": string,                       // short name for the agent/automation
  "summary": string,                     // 1-2 plain sentences: what this does
  "icon": string,                        // pick one from the allowed icons
  "spaceType": string,                   // pick one from the allowed space types
  "instructions": string,                // 2-4 sentences the agent will follow
  "trigger": { "type": string, "detail": string },   // type from allowed triggers
  "steps": [ { "toolId": string|null, "title": string, "detail": string, "input": object, "requiresApproval": boolean } ],
  "approvalGates": [string],
  "risk": "Low"|"Medium"|"High"|"Sensitive"
}`;

export async function planFromGoal({ goal, session, providerId, agent = null } = {}) {
  if (!goal || !String(goal).trim()) return { ok: false, error: "empty_goal", message: "Describe what you want first." };
  const id = activeProviderId(providerId, session?.householdId);
  if (!id) return { ok: false, error: "no_provider", message: "No AI provider is connected. Add one in Settings → AI Providers, then try plain-English generation." };
  const gated = budgetGate(session); if (gated) return gated;
  const catalog = toolCatalog(session); // full catalog resolves the model's answer + engine re-validates
  const compact = pruneCatalogForPrompt(catalog, { agent, goal: String(goal), providerId: id });
  const user = `Available tools (JSON): ${JSON.stringify(compact)}\n\nAllowed trigger types: ${TRIGGERS.join(", ")}\nAllowed space types: ${SPACE_TYPES.join(", ")}\nAllowed icons: ${ICONS.join(", ")}\n\nGoal: ${String(goal).trim()}`;
  const out = await providerChatWithFallback(id, { messages: [{ role: "system", content: PLAN_SYS }, { role: "user", content: user }] });
  if (!out.ok) return { ok: false, error: out.error ?? "provider_error", message: out.message ?? "The AI provider did not respond." };
  const parsed = extractJSON(out.text);
  if (!parsed) return { ok: false, error: "parse_failed", message: "The AI response could not be parsed into a plan. Try rephrasing the goal." };
  return { ok: true, plan: normalizePlan(parsed, catalog, String(goal).trim()), model: out.model };
}

/* --------------------------- Assistant brain ---------------------------- *
 * The conversational loop's brain. Given a user message + a compact household
 * context (sent by the client; household data stays local-first), it decides
 * whether to ANSWER (grounded in context) or propose an ACTION PLAN (same real
 * AgentPlan the planner produces, executed through the server approval gate).   */
const ASSISTANT_SYS = `You are FamiliOS, a warm, capable assistant for a family's household operations. You either ANSWER with information grounded in the provided household context, or you propose an ACTION PLAN using the available tools.

Choose:
- ANSWER when the user wants information you already have — household context, advice, opinions, summaries of provided data. Ground every claim in the provided context; if needed data isn't connected or present, say so plainly — never invent events, counts, or results.
- LOOKUP when answering needs CURRENT outside information (news, headlines, weather, prices, hours, scores, "what's happening with…", any fact you don't reliably know). The server fetches the web for you mid-turn and you compose the final answer — the user gets real information in THIS turn, never a plan they must run. A purely informational request must NEVER become a plan.
- PLAN when the user wants a ONE-OFF thing DONE now with side effects (send this, add/schedule/change something, find-and-do). Build the smallest plan that achieves it. Plans EXECUTE IMMEDIATELY — the user does not click anything — so your "answer" sentence says what you're doing right now ("On it — adding taco night and the groceries…"), not "here's my plan". Steps that send/write externally still pause for the family's approval automatically.
- BUILD only when the user asks for a DURABLE or RECURRING capability — "create an agent/helper that…", "every week / each morning", "automate", "from now on". This is the ONLY case where you present the full worked-up plan for confirmation before anything runs.

Plan rules:
- Use tools ONLY from the catalog, matched by exact "id". For a reasoning/notify/summarize step with no matching tool, set "toolId" to null.
- Fill each tool step's "input" using ONLY that tool's listed input keys, with concrete values from the request (unknown values = empty string).
- Set "requiresApproval" true for any step that sends, writes, deletes, posts, downloads, or pays.
- NEVER refuse an action request outright. If the catalog can't cover part of it, plan the steps that ARE achievable with real tools, use toolId:null reasoning steps for the gap, and say in "answer" exactly what's missing and how to unlock it (connect an account, reconnect for a new permission, add a connector). A partial, honest plan always beats "I can't".

Web research:
- When answering requires information you don't have (recipes, prices, hours, how-tos, current facts), plan it: "web.search" with a plain-English query, then "web.read" on the best result URL. For recipe pages use "web.recipe" — it returns the structured name, ingredients, step-by-step instructions, and source URL.

Location awareness:
- When context.location is present (city/region from the user's device), USE IT for anything local: weather, "near us/me", local news, restaurants, stores, events, drive times. Put the city into lookup queries and plan-step inputs ("weather Chattanooga TN", "pizza near Chattanooga") — never ask "where are you?" when the context already says.
- When a local request arrives WITHOUT context.location, check recentMemory for the family's area; only ask as a last resort, and suggest they allow location access for next time.

Be state-aware before scheduling ANYTHING:
- The context lists upcomingMeals and upcomingEvents. If a requested date/slot already has something (e.g. Wednesday dinner is already "Tacos"), do NOT silently double-book: ANSWER with the conflict and ask — "Wednesday dinner is already Tacos. Swap it for X, or pick another night?" — then act on their choice (homeops.plan_meal accepts replace:true to swap).
- Size everything to the household: householdSize and members (with relationships) are in the context. A family of 4 gets 4-serving meals — scale ingredient quantities and never propose "serves 10" without being asked.
- Never re-add what already exists: check upcomingMeals, openTasks, existingAgents before proposing duplicates; prefer updating or extending the existing item.
- context.familyChats is what the household has recently been discussing in its SHARED chats. Use it to stay oriented — do not re-ask something already settled there, and connect a request to it when it obviously relates. Never quote it back verbatim as though the person you are talking to said it, and never assume they were part of that conversation.
- When the user states a durable household fact or preference ("we're vegetarian", "Grandma visits Sundays", "we're a family of 4"), remember it: include a homeops.write_memory step (scope "household") in your next plan, or propose a one-step plan for it — so every future conversation already knows.
- Roster changes (add/remove/merge members) are human actions by design: point the user to Settings → Household (long-press a member to remove) or the web Members tab — never claim you can't help without saying where it IS done.

NEVER ANNOUNCE CONTENT YOU DO NOT THEN INCLUDE:
- If you say "here's the list", "here are your tasks", "these are the events" — THE ITEMS MUST BE IN THAT SAME MESSAGE, written out. A sentence promising a list, followed by nothing, is the single worst failure this assistant has. It has happened three turns in a row while the family typed "you didnt return anything", then "still nothing", then "still nothing".
- Write the items INLINE as a real list, with the concrete values from context (title, date/time, who it's for, overdue marker). Do not describe the shape of an answer instead of giving it ("a member-by-member list, with overdue items marked" is not an answer — the names and tasks are).
- If the context genuinely has nothing to list, say exactly that ("Nothing is on the calendar for today") — an honest empty is fine; a promised-but-absent list is not.
- Never defer the visible result to a run, a card, or a later message. Anything you can already read in context belongs in your reply NOW.

DO THE THING, DON'T OFFER TO DO IT:
- The family already asked. "If you want, I can narrow this to best-rated / open now / closest" and "I can also sort these by easiest-to-finish" are not answers — they are the work, described. DO the sort, DO the narrowing, in this reply, using your best judgement about what they meant.
- Offer refinements AFTER delivering something, never instead of it. Give the sorted list, then optionally add one line: "Say the word if you'd rather sort by X."
- When a request has an obvious default (sort order, how many, which member), pick the sensible one and state the choice you made — don't stop to ask.

Fixing and improving the family's HELPERS (agents) — you can actually do this now:
- When a helper gets something wrong ("the briefing missed tonight's event", "make the morning agent include X"), DIAGNOSE AND FIX IT rather than describing what they should change themselves. context.existingAgents lists them; "homeops.get_agent" {agentId} returns a helper's real instructions; "homeops.update_agent" {agentId, instructions|purpose|name|status} rewrites them.
- context.attachedAlsoNames lists files attached alongside the one you were given. You have NOT read those. If they matter to the answer, say which one you read and offer to read the next — never imply you looked at all of them.
- An "ATTACHED …" section may appear after the tool list. That is the REAL CONTENTS of a file the person just attached — a photo they took, a document, a schedule — read on the server moments ago. Answer from it directly. If context.attachedFileError is set instead, the file could not be read: say what it says, plainly, and suggest the alternative it names. Never tell someone you cannot see an attachment when that section is present, and never claim to have read one when it is not. If context.attachedFileName exists but there is no ATTACHED section and no attachedFileError, say honestly that the file did not come through — never invent a reason or ask them to re-upload it in another format.
- When an attachment (or a file in the library) plausibly CONTAINS things the family would want in the app — a schedule, an invitation, a class list, a permission slip, a receipt — use "homeops.extract_from_file" {fileId}. It returns candidates as cards for them to pick from. Say what you found and that nothing has been added yet. Do NOT create events or tasks yourself from a file; the whole point is that they choose.
- To answer a question about a specific file without proposing anything, use "homeops.read_file" {fileId, question}.
- "restaurants near me", "a pharmacy that's open", "coffee close by" — use "homeops.find_places" {query, lat, lng, limit}. Pass the lat/lng from context.location when it is there. Never answer a "near me" question from memory or with a search link: that tool returns the real rows, and they render as cards. It also returns "limitations" — say those out loud. Google publishes no live busy-ness and no wait-time estimate through any API, so if someone asked for those, tell them plainly that part is unavailable and give them everything you DO have. Do not approximate it.
- When someone tells you a helper does not need to ask them any more ("don't ask for permission", "you have approval", "just run it", "run unattended"), that is "homeops.update_agent" {agentId, runUnattended: true} — and {includeSendAndSpend: true} as well if they mean sending or spending too. Do it; do not answer with instructions for finding the setting. Then say plainly what still pauses, using the tool's own "unattendedNote" — never claim it will run everything unattended when the result says otherwise.
- Read the helper's CURRENT instructions with get_agent BEFORE editing. Then rewrite the whole instructions text with your correction folded in — update_agent replaces the field, so send the complete new version, not a fragment or a diff.
- update_agent is approval-gated on purpose: it changes what that helper will do on its own, unattended, later. Plan the step and let the family sign it off; the approval card shows them the change.
- NEVER say you have updated, fixed, retrained, or changed a helper unless an update_agent step actually ran and succeeded. If you only intend to, say that you are about to and plan the step. Claiming a change you did not make is the worst thing you can do here — the family will believe the helper is fixed, and it will fail them again unattended.
- If the family's complaint is really about DATA rather than the helper (an event you can see in upcomingEvents, a task already in openTasks), say so and answer directly instead of editing a helper that isn't at fault.

Meal planning ("plan N meals", "what's for dinner this week"):
- Research candidate recipes with web.search + web.recipe, then PRESENT the suggestions inline in "answer" (name, why it fits, source URL) so the family can approve or swap each one in chat.
- For EACH approved meal, use "homeops.plan_meal" with {title, date (YYYY-MM-DD), slot, recipeUrl, ingredients (full list), instructions (steps), servings}. That single tool adds the meal to the Meal Planner, puts missing ingredients on the shared Groceries list (grocery mini app), creates the calendar event with the recipe + ingredients + instructions in its body, and — when calendar auto-sync is on — pushes it straight to Google Calendar. Do not duplicate those steps with separate tools.

Build rules:
- skill.steps[].tool_id must be an exact catalog id (or null for a reasoning step); set approval_required true for any send/write/pay step.
- Prefer internal "homeops.*" tools (always available) for family data; only reference external tools (gmail/sms/etc.) the user clearly asked for.
- DELIVERY ON A SCHEDULE: when a recurring automation must email or text someone, use "homeops.notify_contact" ({to or methodId, subject, body}), NOT "gmail.send". notify_contact delivers through the household's verified contact-method registry, which is what lets an unattended 7 AM run actually send; gmail.send waits for a human approval that nobody is awake to give. Reserve "gmail.send" for one-off sends the user is present for.
- If the recipient isn't a verified contact method yet, still plan the notify_contact step — it returns an honest setup prompt naming exactly what to verify, which is more useful than omitting the delivery.
- automation.type is one of "recurring" (set intervalMs in ms), "schedule" (set runAt ISO), "webhook", or "manual".
- When the user names a TIME OF DAY ("every day at 7 AM", "each morning at 6:30", "weekly on Sunday at 8"), you MUST set automation.anchor to that time as 24-hour "HH:MM" (7 AM → "07:00", 6:30 AM → "06:30", 8 PM → "20:00") IN ADDITION to intervalMs. The anchor is what makes it fire at that hour; intervalMs alone would fire at whatever time the user happened to ask.
- Keep it minimal: a skill alone is fine; add an agent only if it should be owned/long-lived; add an automation only if it should run on a schedule/event.
- To CHANGE an EXISTING helper/recipe instead of creating a new one ("add a step to…", "make X also…", "change the instructions for…"), DO NOT create a duplicate — use "edits" referencing the exact id from the context's existingAgents / existingSkills, with only the fields that change.

Respond with ONLY a JSON object (no prose, no markdown fences), one of:
{ "kind": "answer", "answer": string }
{ "kind": "lookup", "answer": string, "queries": [string], "readUrls": [string] }  — "answer" is one short working sentence ("Checking the latest headlines…"); "queries" is 1-3 plain-English web searches; "readUrls" is 0-2 exact URLs worth reading in full (usually empty — search snippets often suffice).
{ "kind": "plan", "answer": string, "plan": { "title": string, "summary": string, "icon": string, "spaceType": string, "instructions": string, "trigger": { "type": string, "detail": string }, "steps": [ { "toolId": string|null, "title": string, "detail": string, "input": object, "requiresApproval": boolean } ], "approvalGates": [string], "risk": "Low"|"Medium"|"High"|"Sensitive" } }
{ "kind": "build", "answer": string, "build": { "summary": string, "skill": { "name": string, "description": string, "domain": string, "planner_guidance": string, "steps": [ { "name": string, "tool_id": string|null, "approval_required": boolean } ], "risk_level": "Low"|"Medium"|"High"|"Sensitive" } | null, "agent": { "name": string, "purpose": string, "instructions": string } | null, "automation": { "name": string, "type": "recurring"|"schedule"|"webhook"|"manual", "intervalMs": number | null, "runAt": string | null, "anchor": string | null } | null, "edits": [ { "kind": "agent"|"skill", "id": string, "summary": string, "patch": object } ] } }
For a plan or build, "answer" is one friendly sentence summarizing what you'll set up or change.`;

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

export async function buildServerContext(session, clientContext, { goal } = {}) {
  if (!session) return clientContext ?? {};
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
    .filter((e) => canSeeEntity(e, session))
    .filter((e) => isUpcomingForContext(e, now, tz))
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
    .slice(0, 12)
    // endAt/allDay ride along so the assistant can say "All day" or "until 8pm" instead of
    // inventing a time, and can reason about what is happening RIGHT NOW.
    .map((e) => ({ id: e.id, title: e.title, startAt: e.startAt, endAt: e.endAt ?? null, allDay: e.allDay === true, location: e.location, driverId: e.driverId, participants: e.participantIds }));
  const tasks = listTasks((t) => t.householdId === hh)
    .filter((t) => canSeeEntity(t, session))
    .filter((t) => t.status !== "done")
    .slice(0, 10)
    .map((t) => ({ id: t.id, title: t.title, type: t.type, dueAt: t.dueAt, assignedMemberId: t.assignedMemberId }));
  // WP-007 (DEC-014) — retrieval-quality memory read path. When the provider (real
  // sidecar, or its always-available sqlite-FTS5 fallback — see memory-provider.mjs) is
  // healthy, ground the assistant on profile() + search(goal) instead of a flat recency
  // slice. When it's degraded/offline, fall back to the legacy listMemory() behavior with
  // an EXPLICIT disclosure marker in the context — never a silent, unannounced downgrade.
  const visibleToActor = (m) => m.scope !== "personal" || (m.sourceActorId ?? m.source?.actorId) === session.actorId;
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
  // Existing helpers/recipes/automations — so the assistant can EDIT/extend them by id
  // instead of creating duplicates, and answer "what helpers do I have?".
  const inHh = (x) => x.householdId === hh || x.householdId === "local";
  /* PRIVACY: a PERSONAL helper belongs to the member who made it, and this list was flat —
   * so one member's private helper appeared in another member's assistant context, and the
   * assistant would cheerfully name it. Now filtered by the same agentVisibleTo rule the
   * agents screen and the run selector use. Matters much more now that Adult Members build
   * their own helpers by default (the silo). */
  const existingAgents = listAgents(inHh)
    .filter((a) => agentVisibleTo(a, session))
    .map((a) => ({ id: a.id, name: a.name, purpose: a.purpose, status: a.status }));
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
  const existingSkills = listSkills(inHh).map((s) => ({ id: s.id, name: s.name, description: s.description, status: s.status }));
  const existingAutomations = listTriggers(inHh).map((t) => ({ id: t.id, name: t.name, type: t.type, enabled: t.enabled }));
  // The meal plan rides along so scheduling conflicts are visible BEFORE the
  // assistant proposes anything ("Wednesday already has tacos — swap or keep?").
  const upcomingMeals = listMeals((m) => m.householdId === hh && !m.archived && m.date && m.date >= now.slice(0, 10))
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
    existingAgents, existingSkills, existingAutomations,
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

/* ---- One-turn live lookups ----
 * When the assistant decides it needs current outside information, the server
 * fetches it MID-TURN (bounded: ≤3 searches, ≤2 page reads through the existing
 * 5-tier web chain) and a second model pass composes the final chat answer with
 * inline markdown links. The user asks "top 5 global news stories" and gets
 * five linked headlines in THIS reply — never a plan card. */
const COMPOSE_SYS = `You compose the final chat reply for a family assistant, using ONLY the fetched web material provided (search results and page extracts) plus the user's question. Rules:
- Cite with inline markdown links: [Headline or source name](url). Every factual claim should trace to a provided result.
- "Top N" requests get a numbered list: each item is the headline as a markdown link, then one plain sentence of what happened.
- Prefer diverse, reputable sources; skip duplicates of the same story.
- Be honest about gaps: if the fetched material doesn't cover part of the question, say so briefly.
- Plain markdown text only — no JSON, no code fences. Keep it tight and readable on a phone.`;

async function performLookup({ id, session, message, parsed }) {
  const queries = (Array.isArray(parsed.queries) ? parsed.queries : []).map((q) => String(q).trim()).filter(Boolean).slice(0, 3);
  const readUrls = (Array.isArray(parsed.readUrls) ? parsed.readUrls : []).map((u) => String(u).trim()).filter((u) => /^https?:\/\//.test(u)).slice(0, 2);
  if (!queries.length && !readUrls.length) {
    return { ok: true, kind: "answer", answer: String(parsed.answer ?? "I couldn't work out what to look up — can you rephrase?") };
  }
  // In parallel: the searches and page reads are independent, and they were the slowest
  // serial stretch of the whole turn (Severity-5 item 5).
  const searches = await Promise.all(queries.map(async (q) => {
    const r = await searchWeb(q, { maxResults: 6 }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    return {
      query: q, ok: !!r?.ok,
      results: (r?.results ?? []).slice(0, 6).map((x) => ({ title: x.title, url: x.url, snippet: String(x.snippet ?? "").slice(0, 240) })),
      ...(r?.ok ? {} : { error: r?.error ?? "search_failed" }),
    };
  }));
  const pages = await Promise.all(readUrls.map(async (u) => {
    const p = await readPage(u, { maxChars: 2600 }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    return { url: u, ok: !!p?.ok, title: p?.title ?? "", text: String(p?.text ?? "").slice(0, 2600), ...(p?.ok ? {} : { error: p?.error ?? "read_failed" }) };
  }));
  const anyMaterial = searches.some((s) => s.results.length) || pages.some((p) => p.ok);
  if (!anyMaterial) {
    const why = searches[0]?.error ?? pages[0]?.error ?? "no results";
    return { ok: true, kind: "answer", answer: `I tried to look that up but the web fetch came back empty (${why}). Try again in a minute, or rephrase the question.` };
  }
  recordAiUsage(session?.householdId, "assistant"); // the compose pass is a second metered call
  const compose = await providerChatWithFallback(id, {
    messages: [
      { role: "system", content: COMPOSE_SYS },
      { role: "user", content: `User asked: ${String(message).trim()}\n\nSearch results (JSON): ${JSON.stringify(searches)}\n\nPage extracts (JSON): ${JSON.stringify(pages)}` },
    ],
  });
  if (!compose.ok) {
    // Honest fallback: hand over the raw links rather than nothing.
    const links = searches.flatMap((s) => s.results).slice(0, 5).map((r, i) => `${i + 1}. [${r.title}](${r.url})`).join("\n");
    return { ok: true, kind: "answer", answer: `Here's what I found (the summarizer hiccuped, so these are raw results):\n\n${links}` };
  }
  return { ok: true, kind: "answer", answer: String(compose.text ?? "").trim(), model: compose.model, lookedUp: true };
}

export async function assistantRespond({ message, context, session, providerId, history, agent = null } = {}) {
  if (!message || !String(message).trim()) return { ok: false, error: "empty_message", message: "Type a message first." };
  const id = activeProviderId(providerId, session?.householdId);
  if (!id) return { ok: false, error: "no_provider", message: "No AI provider is connected. Add one in Settings → AI Providers, then ask me again." };
  const gated = budgetGate(session); if (gated) return gated;
  const catalog = toolCatalog(session); // full catalog resolves the model's answer + engine re-validates
  const compact = pruneCatalogForPrompt(catalog, { agent, goal: String(message), providerId: id });
  const serverCtx = await buildServerContext(session, context, { goal: message });
  const ctxStr = JSON.stringify(serverCtx).slice(0, 4000);
  const user = `Household context (JSON): ${ctxStr}\n\nAvailable tools (JSON): ${JSON.stringify(compact)}\n\nAllowed trigger types: ${TRIGGERS.join(", ")}\nAllowed space types: ${SPACE_TYPES.join(", ")}\nAllowed icons: ${ICONS.join(", ")}${attachmentSection(context)}\n\nUser message: ${String(message).trim()}`;
  // Conversation memory: without prior turns the assistant is amnesiac — a fact
  // stated one message ago ("we're a family of 4") was already forgotten. The
  // last few turns ride along as real chat messages, truncated per turn.
  const priorTurns = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.text)
    .slice(-10)
    .map((m) => ({ role: m.role, content: String(m.text).slice(0, 1500) }));
  const out = await providerChatWithFallback(id, { messages: [{ role: "system", content: ASSISTANT_SYS }, ...priorTurns, { role: "user", content: user }] });
  if (!out.ok) return { ok: false, error: out.error ?? "provider_error", message: out.message ?? "The AI provider did not respond." };
  const parsed = extractJSON(out.text);
  // Robust chat: if the model didn't return clean JSON, treat its prose as an answer —
  // but never leak a raw/broken JSON envelope into the chat.
  if (!parsed) return { ok: true, kind: "answer", answer: safeAnswerFallback(out.text), model: out.model };
  if (parsed.kind === "lookup") {
    return await performLookup({ id, session, message, parsed });
  }
  if (parsed.kind === "plan" && parsed.plan && typeof parsed.plan === "object") {
    const plan = normalizePlan(parsed.plan, catalog, String(message).trim());
    return { ok: true, kind: "plan", answer: String(parsed.answer ?? plan.summary ?? "On it."), plan, model: out.model };
  }
  if (parsed.kind === "build" && parsed.build && typeof parsed.build === "object") {
    return { ok: true, kind: "build", answer: String(parsed.answer ?? parsed.build.summary ?? "Here's what I'll set up."), build: normalizeBuild(parsed.build), model: out.model };
  }
  return { ok: true, kind: "answer", answer: String(parsed.answer ?? out.text ?? "").trim() || "I'm not sure how to help with that yet.", model: out.model };
}

/** Clamp a model-proposed build spec to safe, expected shapes before it reaches the
 *  materialize endpoint (which re-validates + role-gates). Defensive, not trusting. */
export function normalizeBuild(b) {
  const out = { summary: String(b.summary ?? "").slice(0, 280) };
  if (b.skill && typeof b.skill === "object") {
    out.skill = {
      name: String(b.skill.name ?? "New skill").slice(0, 80),
      description: String(b.skill.description ?? "").slice(0, 400),
      domain: String(b.skill.domain ?? "Family"),
      planner_guidance: String(b.skill.planner_guidance ?? "").slice(0, 800),
      risk_level: ["Low", "Medium", "High", "Sensitive"].includes(b.skill.risk_level) ? b.skill.risk_level : "Low",
      steps: Array.isArray(b.skill.steps) ? b.skill.steps.slice(0, 12).map((s, i) => ({
        step_id: `s${i + 1}`, name: String(s?.name ?? `Step ${i + 1}`).slice(0, 80),
        tool_id: s?.tool_id ?? null, approval_required: !!s?.approval_required, input_mapping: {},
      })) : [],
    };
  }
  if (b.agent && typeof b.agent === "object") {
    out.agent = { name: String(b.agent.name ?? "New helper").slice(0, 80), purpose: String(b.agent.purpose ?? "").slice(0, 200), instructions: String(b.agent.instructions ?? "").slice(0, 800) };
  }
  if (b.automation && typeof b.automation === "object") {
    const type = ["recurring", "schedule", "webhook", "manual"].includes(b.automation.type) ? b.automation.type : "manual";
    // WP-002 (ISS-003): `anchor` is the field that lets "every day at 7 AM" mean 07:00.
    // Without it the build spec could only express an INTERVAL, so the scheduler had
    // nothing to anchor to and fell back to creation-time + 24h (EV-011). Validated
    // here rather than trusted: anything that isn't a real HH:MM becomes null.
    const anchor = /^\d{1,2}:\d{2}$/.test(String(b.automation.anchor ?? "")) ? String(b.automation.anchor).trim() : null;
    const anchorOk = anchor && Number(anchor.split(":")[0]) <= 23 && Number(anchor.split(":")[1]) <= 59 ? anchor : null;
    out.automation = {
      name: String(b.automation.name ?? "New automation").slice(0, 80), type,
      intervalMs: Number(b.automation.intervalMs) > 0 ? Number(b.automation.intervalMs) : null,
      runAt: b.automation.runAt ?? null,
      anchor: anchorOk,
    };
  }
  // Edits to existing entities — only safe, declared fields are forwarded (the
  // materialize endpoint re-validates + versions via partialUpdate).
  const SKILL_FIELDS = ["name", "description", "domain", "planner_guidance", "risk_level", "steps", "input_schema", "approval_policy"];
  const AGENT_FIELDS = ["name", "purpose", "instructions", "status", "skillIds", "allowedToolIds", "allowedFunctionIds", "spaceType"];
  if (Array.isArray(b.edits)) {
    out.edits = b.edits
      .filter((e) => e && (e.kind === "agent" || e.kind === "skill") && typeof e.id === "string" && e.patch && typeof e.patch === "object")
      .slice(0, 8)
      .map((e) => {
        const allow = e.kind === "skill" ? SKILL_FIELDS : AGENT_FIELDS;
        const patch = {};
        for (const k of allow) if (k in e.patch) patch[k] = e.patch[k];
        return { kind: e.kind, id: e.id, summary: String(e.summary ?? "").slice(0, 160), patch };
      })
      .filter((e) => Object.keys(e.patch).length > 0);
  }
  return out;
}

/**
 * Streaming assistant — same logic as assistantRespond but uses providerChatStream.
 * The onToken callback fires with each raw text chunk from the provider (useful for
 * liveness signals; the JSON tokens are not meaningful mid-stream). Returns the
 * same {ok, kind, answer, plan, model} shape when the full response is assembled.
 */
/* The assistant does three genuinely different things and used to admit to one.
 *
 * `onToken` is a liveness ping — it fires as provider tokens arrive, and the client turned
 * that into "Writing…". For a plain answer that's true. For a LOOKUP it was a lie during the
 * slowest part of the whole interaction: performLookup goes out to the live web, which can
 * take many seconds, and the old code announced it by calling onToken("") — a fake token,
 * whose only effect was to make the app claim it was writing. Someone watching "Writing…"
 * for eight seconds concludes the app is stuck, because nothing is being written.
 *
 * So the phase is now said out loud rather than inferred from a side effect. `onPhase` is
 * optional; callers that don't pass it behave exactly as before. */
export async function assistantStream({ message, context, session, providerId, history, agent = null } = {}, onToken, onPhase) {
  const phase = (p) => { try { onPhase?.(p); } catch { /* progress reporting must never break a run */ } };
  if (!message || !String(message).trim()) return { ok: false, error: "empty_message", message: "Type a message first." };
  const id = activeProviderId(providerId, session?.householdId);
  if (!id) return { ok: false, error: "no_provider", message: "No AI provider is connected. Add one in Settings → AI Providers, then ask me again." };
  const gated = budgetGate(session); if (gated) return gated;
  const catalog = toolCatalog(session); // full catalog resolves the model's answer + engine re-validates
  const compact = pruneCatalogForPrompt(catalog, { agent, goal: String(message), providerId: id });
  const serverCtx = await buildServerContext(session, context, { goal: message });
  const ctxStr = JSON.stringify(serverCtx).slice(0, 4000);
  const user = `Household context (JSON): ${ctxStr}\n\nAvailable tools (JSON): ${JSON.stringify(compact)}\n\nAllowed trigger types: ${TRIGGERS.join(", ")}\nAllowed space types: ${SPACE_TYPES.join(", ")}\nAllowed icons: ${ICONS.join(", ")}${attachmentSection(context)}\n\nUser message: ${String(message).trim()}`;
  // Same conversation memory as assistantRespond (the chat UIs always stream).
  const priorTurns = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.text)
    .slice(-10)
    .map((m) => ({ role: m.role, content: String(m.text).slice(0, 1500) }));
  const out = await providerChatStream(id, { messages: [{ role: "system", content: ASSISTANT_SYS }, ...priorTurns, { role: "user", content: user }] }, onToken);
  if (!out.ok) return { ok: false, error: out.error ?? "provider_error", message: out.message ?? "The AI provider did not respond." };
  const parsed = extractJSON(out.text);
  if (!parsed) return { ok: true, kind: "answer", answer: safeAnswerFallback(out.text), model: out.model };
  if (parsed.kind === "lookup") {
    // The long one. Say so, and keep the liveness ping for clients that only understand it.
    phase("searching");
    try { onToken?.(""); } catch { /* liveness only */ }
    return await performLookup({ id, session, message, parsed });
  }
  if (parsed.kind === "plan" && parsed.plan && typeof parsed.plan === "object") {
    phase("creating");
    const plan = normalizePlan(parsed.plan, catalog, String(message).trim());
    return { ok: true, kind: "plan", answer: String(parsed.answer ?? plan.summary ?? "On it."), plan, model: out.model };
  }
  if (parsed.kind === "build" && parsed.build && typeof parsed.build === "object") {
    phase("creating");
    return { ok: true, kind: "build", answer: String(parsed.answer ?? parsed.build.summary ?? "Here's what I'll set up."), build: normalizeBuild(parsed.build), model: out.model };
  }
  return { ok: true, kind: "answer", answer: String(parsed.answer ?? out.text ?? "").trim() || "I'm not sure how to help with that yet.", model: out.model };
}

/* ------------------------- Evolution (learning) ------------------------- *
 * Given a real run trace (what an agent/plan did and where it struggled),
 * propose ONE concrete, low-risk improvement. The client computes a deterministic
 * evidence baseline first; this LLM pass refines the wording + the suggested
 * "after" instructions. Grounded in the trace — never invents failures.          */
const EVOLVE_SYS = `You are FamiliOS' improvement engine. Given a run trace, propose ONE concrete, low-risk improvement grounded ONLY in what the trace shows. Never invent failures or capabilities. Respond with ONLY a JSON object (no prose, no fences):
{ "title": string, "reason": string, "summary": string, "after": string, "risk": "Low"|"Medium"|"High" }
- "reason": cite the specific step/error from the trace.
- "summary": the improvement in one or two plain sentences.
- "after": improved agent instructions (if the trace includes an agent) or a one-line tool-usage tip otherwise. Keep it practical, safe, and family-appropriate.`;

export async function proposeEvolution({ trace, session, providerId } = {}) {
  const id = activeProviderId(providerId, session?.householdId);
  if (!id) return { ok: false, error: "no_provider" };
  const gated = budgetGate(session); if (gated) return gated;
  if (!trace || typeof trace !== "object") return { ok: false, error: "empty_trace" };
  const out = await providerChat(id, { messages: [{ role: "system", content: EVOLVE_SYS }, { role: "user", content: `Run trace (JSON): ${JSON.stringify(trace).slice(0, 4000)}` }] });
  if (!out.ok) return { ok: false, error: out.error ?? "provider_error", message: out.message };
  const parsed = extractJSON(out.text);
  if (!parsed) return { ok: false, error: "parse_failed" };
  const risk = ["Low", "Medium", "High"].includes(parsed.risk) ? parsed.risk : "Low";
  return { ok: true, proposal: { title: String(parsed.title ?? "Improvement"), reason: String(parsed.reason ?? ""), summary: String(parsed.summary ?? ""), after: parsed.after != null ? String(parsed.after) : undefined, risk }, model: out.model };
}

/* ---- Auto-approval confidence judge (a VALIDATION pass, NOT a live re-run) ------ *
 * Given the failure trace + a proposed `after` (new instructions/guidance), ask the
 * AI whether applying the change is LIKELY to make the next run succeed. Strict by
 * design: confident only when the change directly addresses the failure and is low-
 * risk. Any missing provider / exhausted budget / unparseable answer → confident:false,
 * so the engine NEVER auto-applies without a positive judgment (fail-closed).          */
const JUDGE_SYS = `You are FamiliOS' change-safety judge. You are given a failed run's trace and a proposed change to an agent's instructions (or a skill's guidance). Decide whether applying this change is LIKELY to make the NEXT run succeed. Be STRICT: answer confident:true ONLY when the change DIRECTLY addresses the specific failure shown in the trace AND is low-risk (introduces no new external actions, no new permissions, nothing a family would consider unsafe). If the change is vague, off-target, risky, or you are unsure, answer false. Respond with ONLY a JSON object — no prose, no fences: {"confident": boolean, "reason": string}`;

export async function judgeEvolutionConfidence({ trace, proposal, session, providerId } = {}) {
  const id = activeProviderId(providerId, session?.householdId);
  if (!id) return { ok: false, confident: false, reason: "no_provider" };
  if (!proposal || proposal.after == null || !String(proposal.after).trim()) return { ok: false, confident: false, reason: "no_after" };
  const gated = budgetGate(session); if (gated) return { ok: false, confident: false, reason: "ai_budget_exhausted" };
  const user = `Failure trace (JSON): ${JSON.stringify(trace ?? {}).slice(0, 3000)}\n\nProposed change to apply (the new instructions/guidance):\n${String(proposal.after).slice(0, 2000)}`;
  const out = await providerChat(id, { messages: [{ role: "system", content: JUDGE_SYS }, { role: "user", content: user }] });
  if (!out.ok) return { ok: false, confident: false, reason: out.error ?? "provider_error" };
  const parsed = extractJSON(out.text);
  if (!parsed || typeof parsed.confident !== "boolean") return { ok: false, confident: false, reason: "parse_failed" };
  return { ok: true, confident: parsed.confident === true, reason: String(parsed.reason ?? ""), model: out.model };
}

const MINIAPP_SYS = `You generate the seed DATA for a FamiliOS "mini app" (a small interactive household tracker) from a plain-English request. Respond with ONLY a JSON object — no prose, no markdown fences:
{ "type": <one of the allowed types>, "name": string, "description": string, "data": object }

Use the data shape that matches the chosen type:
- "Trip Planner": { "destination": string, "dates": string, "itinerary": [{ "day": string, "items": [string] }], "packing": [{ "id": string, "text": string, "done": false }], "todos": [{ "id": string, "text": string, "done": false }], "reservations": [{ "name": string, "detail": string }], "documents": [string], "budget": [{ "label": string, "amount": number }] }
- "Subscription Tracker": { "subscriptions": [{ "id": string, "name": string, "monthly": number, "lastCharge": ISODate, "usage": string, "recommendation": string }] }
- "Budget Snapshot": { "rows": [{ "id": string, "label": string, "amount": number, "date": ISODate, "source": string }], "categoryTotals": [{ "label": string, "amount": number }], "alerts": [string] }
- "Chore Board": { "columns": [{ "key": "todo|in-progress|done|needs-help", "title": string }] }
- Anything else ("Grocery List", "Medical Tracker", "Research Comparison", "Custom"): { "sections": [{ "title": string, "items": [string] }] }
Generate realistic, useful starter content (3-8 items) inferred from the request. Use plain ISO dates (YYYY-MM-DD) where dates are needed.`;

export async function generateMiniApp({ goal, type, session, providerId } = {}) {
  if (!goal || !String(goal).trim()) return { ok: false, error: "empty_goal", message: "Describe the mini app you want." };
  const id = activeProviderId(providerId, session?.householdId);
  if (!id) return { ok: false, error: "no_provider", message: "No AI provider is connected. Add one in Settings → AI Providers to generate mini apps." };
  const gated = budgetGate(session); if (gated) return gated;
  const user = `Allowed types: ${MINIAPP_TYPES.join(", ")}.${type ? ` Preferred type: ${type}.` : ""}\nRequest: ${String(goal).trim()}`;
  const out = await providerChat(id, { messages: [{ role: "system", content: MINIAPP_SYS }, { role: "user", content: user }] });
  if (!out.ok) return { ok: false, error: out.error ?? "provider_error", message: out.message ?? "The AI provider did not respond." };
  const parsed = extractJSON(out.text);
  if (!parsed) return { ok: false, error: "parse_failed", message: "The AI response could not be parsed. Try rephrasing." };
  const t = MINIAPP_TYPES.includes(parsed.type) ? parsed.type : (type && MINIAPP_TYPES.includes(type) ? type : "Custom");
  return { ok: true, app: { type: t, name: String(parsed.name ?? String(goal).slice(0, 40)), description: String(parsed.description ?? ""), data: parsed.data && typeof parsed.data === "object" ? parsed.data : {} }, model: out.model };
}

const PLAYBOOK_SYS = `You write a reusable FamiliOS "playbook" — step-by-step instructions a helper agent follows for a recurring household workflow — from a plain-English request. Respond with ONLY a JSON object — no prose, no markdown fences:
{ "name": string, "description": string, "whenToUse": string, "category": string, "steps": [string], "requiredConnections": [string], "outputFormat": string, "approvalRules": [string] }
Write 4-8 concrete, ordered steps. requiredConnections name real services (e.g. "Gmail", "Google Calendar", "Local Files"). approvalRules list any step that should pause for human approval.`;

export async function generatePlaybook({ goal, session, providerId } = {}) {
  if (!goal || !String(goal).trim()) return { ok: false, error: "empty_goal", message: "Describe the playbook you want." };
  const id = activeProviderId(providerId, session?.householdId);
  if (!id) return { ok: false, error: "no_provider", message: "No AI provider is connected. Add one in Settings → AI Providers to generate playbooks." };
  const gated = budgetGate(session); if (gated) return gated;
  const out = await providerChat(id, { messages: [{ role: "system", content: PLAYBOOK_SYS }, { role: "user", content: `Request: ${String(goal).trim()}` }] });
  if (!out.ok) return { ok: false, error: out.error ?? "provider_error", message: out.message ?? "The AI provider did not respond." };
  const parsed = extractJSON(out.text);
  if (!parsed) return { ok: false, error: "parse_failed", message: "The AI response could not be parsed. Try rephrasing." };
  const steps = (Array.isArray(parsed.steps) ? parsed.steps : []).map((s) => String(typeof s === "string" ? s : s?.text ?? "")).filter(Boolean);
  return {
    ok: true,
    playbook: {
      name: String(parsed.name ?? String(goal).slice(0, 48)),
      description: String(parsed.description ?? ""),
      whenToUse: String(parsed.whenToUse ?? ""),
      category: String(parsed.category ?? "Custom"),
      steps,
      requiredConnections: (Array.isArray(parsed.requiredConnections) ? parsed.requiredConnections : []).map(String),
      outputFormat: String(parsed.outputFormat ?? ""),
      approvalRules: (Array.isArray(parsed.approvalRules) ? parsed.approvalRules : []).map(String),
    },
    model: out.model,
  };
}
