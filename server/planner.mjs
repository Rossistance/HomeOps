// FamiliOS AI — the planning brain. Turns a plain-English goal into a concrete,
// executable plan by giving the connected AI provider the LIVE tool catalog (real
// provider + connector tools, annotated with whether THIS actor has connected the
// account each needs) and asking it to select tools, fill inputs, and decide which
// steps require approval. Nothing here is simulated: the catalog is real, the model
// call is real (server/ai.mjs), and every selected step maps to a real executor.
import { PROVIDERS } from "./providers.mjs";
import { CONNECTORS, readinessOf } from "./connectors.mjs";
import { listAccountsFor } from "./accounts.mjs";
import { providerChat, providerChatStream, providerChatWithFallback } from "./ai.mjs";
import { getSettings, listEvents, listTasks, listMemory, listMembers, listMeals, canSeeEntity, listAgents, listSkills, listTriggers, getRiskOverride, recordAiUsage, aiBudgetExhausted } from "./store.mjs";
import { listInternalFunctions } from "./internal-functions.mjs";
import { searchWeb, readPage } from "./web.mjs";

// Input hints for the internal family-data tools, so the planner knows how to fill
// them (and the engine knows which fields require threading — see toolInputSchema).
export const INTERNAL_INPUTS = {
  "homeops.create_event_draft": [{ key: "title", required: true }, { key: "startAt" }, { key: "location" }, { key: "participantIds" }, { key: "driverId" }, { key: "visibility" }],
  "homeops.update_event_checklist": [{ key: "eventId", required: true }, { key: "items", required: true }],
  "homeops.assign_driver": [{ key: "eventId", required: true }, { key: "driverId", required: true }],
  "homeops.assign_what_to_bring": [{ key: "eventId", required: true }, { key: "items", required: true }],
  "homeops.create_task": [{ key: "title", required: true }, { key: "dueAt" }, { key: "assignedMemberId" }, { key: "priority" }],
  "homeops.create_list_item": [{ key: "text", required: true }, { key: "listName" }],
  "homeops.plan_meal": [{ key: "title", required: true }, { key: "date" }, { key: "slot" }, { key: "ingredients" }],
  "homeops.attach_note_or_file_reference": [{ key: "eventId", required: true }, { key: "note" }, { key: "fileRef" }],
  "homeops.send_notification_draft": [{ key: "to" }, { key: "body", required: true }, { key: "subject" }, { key: "channel" }],
  "homeops.write_memory": [{ key: "text", required: true }, { key: "scope" }],
  "homeops.create_artifact": [{ key: "title", required: true }, { key: "body" }, { key: "kind" }],
  "homeops.create_approval": [{ key: "subject", required: true }, { key: "detail" }],
};

const ICONS = ["Bot", "Sun", "Mail", "Inbox", "Calendar", "Receipt", "CreditCard", "UtensilsCrossed", "Plane", "Stethoscope", "Wrench", "HeartHandshake", "FolderOpen", "PawPrint", "Gift", "Search", "ShoppingCart", "Bell", "ShieldCheck", "FileText", "Globe", "MessageSquare", "ListChecks"];
const TRIGGERS = ["Schedule", "Webhook", "RSS Feed", "Email Received", "Email Label Applied", "Text Message Received", "Email Reply Received", "Calendar Event Created", "File Changed", "Manual", "Agent-to-Agent"];
const SPACE_TYPES = ["Personal", "Family", "School", "Bills", "Medical", "Travel", "Home Maintenance", "Caregiving", "Pets", "Custom"];
const MINIAPP_TYPES = ["Chore Board", "Trip Planner", "Budget Snapshot", "Grocery List", "Medical Tracker", "Subscription Tracker", "Research Comparison", "Custom"];
const RISKS = ["Low", "Medium", "High", "Sensitive"];
const EXECUTABLE = ["connected", "authorized_write", "authorized_readonly", "local_only"];

function activeProviderId(explicit, householdId) {
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
  // Household risk overrides (item 9): the catalog reports EFFECTIVE values so the
  // planner and every UI reflect the same reality the engine enforces. Defaults are
  // preserved alongside so the override is visible (and reversible), never silent.
  if (session?.householdId) {
    for (const t of out) {
      const ov = getRiskOverride(session.householdId, t.toolId);
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
function extractJSON(text) {
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

export function normalizePlan(p, catalog, goal) {
  const byId = new Map(catalog.map((t) => [t.toolId, t]));
  const icon = ICONS.includes(p.icon) ? p.icon : "Bot";
  const spaceType = SPACE_TYPES.includes(p.spaceType) ? p.spaceType : "Personal";
  const tType = p.trigger?.type ?? p.triggerType;
  const triggerType = TRIGGERS.includes(tType) ? tType : "Manual";
  const rawSteps = Array.isArray(p.steps) ? p.steps : [];
  const steps = rawSteps.slice(0, 12).map((s) => {
    const t = s && s.toolId ? byId.get(s.toolId) : undefined;
    return {
      toolId: t ? s.toolId : null,
      title: String(s?.title ?? t?.name ?? "Step"),
      detail: String(s?.detail ?? ""),
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

export async function planFromGoal({ goal, session, providerId } = {}) {
  if (!goal || !String(goal).trim()) return { ok: false, error: "empty_goal", message: "Describe what you want first." };
  const id = activeProviderId(providerId, session?.householdId);
  if (!id) return { ok: false, error: "no_provider", message: "No AI provider is connected. Add one in Settings → AI Providers, then try plain-English generation." };
  const gated = budgetGate(session); if (gated) return gated;
  const catalog = toolCatalog(session);
  const compact = catalog.map((t) => ({ id: t.toolId, name: t.name, action: t.action, risk: t.risk, approval: t.requiresApproval, connector: t.connectorId, connected: t.connected, inputs: t.inputs.map((i) => i.key) }));
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
- When the user states a durable household fact or preference ("we're vegetarian", "Grandma visits Sundays", "we're a family of 4"), remember it: include a homeops.write_memory step (scope "household") in your next plan, or propose a one-step plan for it — so every future conversation already knows.
- Roster changes (add/remove/merge members) are human actions by design: point the user to Settings → Household (long-press a member to remove) or the web Members tab — never claim you can't help without saying where it IS done.

Meal planning ("plan N meals", "what's for dinner this week"):
- Research candidate recipes with web.search + web.recipe, then PRESENT the suggestions inline in "answer" (name, why it fits, source URL) so the family can approve or swap each one in chat.
- For EACH approved meal, use "homeops.plan_meal" with {title, date (YYYY-MM-DD), slot, recipeUrl, ingredients (full list), instructions (steps), servings}. That single tool adds the meal to the Meal Planner, puts missing ingredients on the shared Groceries list (grocery mini app), creates the calendar event with the recipe + ingredients + instructions in its body, and — when calendar auto-sync is on — pushes it straight to Google Calendar. Do not duplicate those steps with separate tools.

Build rules:
- skill.steps[].tool_id must be an exact catalog id (or null for a reasoning step); set approval_required true for any send/write/pay step.
- Prefer internal "homeops.*" tools (always available) for family data; only reference external tools (gmail/sms/etc.) the user clearly asked for.
- automation.type is one of "recurring" (set intervalMs in ms), "schedule" (set runAt ISO), "webhook", or "manual".
- Keep it minimal: a skill alone is fine; add an agent only if it should be owned/long-lived; add an automation only if it should run on a schedule/event.
- To CHANGE an EXISTING helper/recipe instead of creating a new one ("add a step to…", "make X also…", "change the instructions for…"), DO NOT create a duplicate — use "edits" referencing the exact id from the context's existingAgents / existingSkills, with only the fields that change.

Respond with ONLY a JSON object (no prose, no markdown fences), one of:
{ "kind": "answer", "answer": string }
{ "kind": "lookup", "answer": string, "queries": [string], "readUrls": [string] }  — "answer" is one short working sentence ("Checking the latest headlines…"); "queries" is 1-3 plain-English web searches; "readUrls" is 0-2 exact URLs worth reading in full (usually empty — search snippets often suffice).
{ "kind": "plan", "answer": string, "plan": { "title": string, "summary": string, "icon": string, "spaceType": string, "instructions": string, "trigger": { "type": string, "detail": string }, "steps": [ { "toolId": string|null, "title": string, "detail": string, "input": object, "requiresApproval": boolean } ], "approvalGates": [string], "risk": "Low"|"Medium"|"High"|"Sensitive" } }
{ "kind": "build", "answer": string, "build": { "summary": string, "skill": { "name": string, "description": string, "domain": string, "planner_guidance": string, "steps": [ { "name": string, "tool_id": string|null, "approval_required": boolean } ], "risk_level": "Low"|"Medium"|"High"|"Sensitive" } | null, "agent": { "name": string, "purpose": string, "instructions": string } | null, "automation": { "name": string, "type": "recurring"|"schedule"|"webhook"|"manual", "intervalMs": number | null, "runAt": string | null } | null, "edits": [ { "kind": "agent"|"skill", "id": string, "summary": string, "patch": object } ] } }
For a plan or build, "answer" is one friendly sentence summarizing what you'll set up or change.`;

/**
 * Build the assistant's grounding context from SERVER-OWNED data (events, tasks,
 * memory, members), visibility-filtered to the requesting actor. This replaces blind
 * trust in the client-provided context: the server's view of the household is
 * authoritative, and a child's assistant never sees adults-only items. The client
 * context (if any) is kept only as a low-priority hint.
 */
export function buildServerContext(session, clientContext) {
  if (!session) return clientContext ?? {};
  const hh = session.householdId;
  const now = new Date().toISOString();
  const events = listEvents((e) => e.householdId === hh)
    .filter((e) => canSeeEntity(e, session))
    .filter((e) => !e.startAt || e.startAt >= now)
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
    .slice(0, 8)
    .map((e) => ({ id: e.id, title: e.title, startAt: e.startAt, location: e.location, driverId: e.driverId, participants: e.participantIds }));
  const tasks = listTasks((t) => t.householdId === hh)
    .filter((t) => canSeeEntity(t, session))
    .filter((t) => t.status !== "done")
    .slice(0, 10)
    .map((t) => ({ id: t.id, title: t.title, type: t.type, dueAt: t.dueAt, assignedMemberId: t.assignedMemberId }));
  const memory = listMemory({ householdId: hh, limit: 6 })
    .filter((m) => m.scope !== "personal" || m.source?.actorId === session.actorId)
    .map((m) => ({ text: m.text, scope: m.scope }));
  // Active roster only — archived members (removed invites, demo seeds) were
  // leaking in and made the assistant size meals for a phantom family of 10.
  const activeMembers = listMembers({ householdId: hh }).filter((m) => !m.archived);
  const members = activeMembers.map((m) => ({ id: m.actorId, name: m.displayName, role: m.role, relationship: m.relationship ?? null }));
  const householdSize = activeMembers.length;
  // Existing helpers/recipes/automations — so the assistant can EDIT/extend them by id
  // instead of creating duplicates, and answer "what helpers do I have?".
  const inHh = (x) => x.householdId === hh || x.householdId === "local";
  const existingAgents = listAgents(inHh).map((a) => ({ id: a.id, name: a.name, purpose: a.purpose, status: a.status }));
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
    now, asActor: { id: session.actorId, role: session.role },
    householdSize, members, upcomingEvents: events, openTasks: tasks, upcomingMeals, recentMemory: memory,
    existingAgents, existingSkills, existingAutomations,
    ...(location ? { location } : {}),
    clientHints: clientContext ?? undefined,
  };
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
  const searches = [];
  for (const q of queries) {
    const r = await searchWeb(q, { maxResults: 6 }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    searches.push({
      query: q, ok: !!r?.ok,
      results: (r?.results ?? []).slice(0, 6).map((x) => ({ title: x.title, url: x.url, snippet: String(x.snippet ?? "").slice(0, 240) })),
      ...(r?.ok ? {} : { error: r?.error ?? "search_failed" }),
    });
  }
  const pages = [];
  for (const u of readUrls) {
    const p = await readPage(u, { maxChars: 2600 }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    pages.push({ url: u, ok: !!p?.ok, title: p?.title ?? "", text: String(p?.text ?? "").slice(0, 2600), ...(p?.ok ? {} : { error: p?.error ?? "read_failed" }) });
  }
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

export async function assistantRespond({ message, context, session, providerId, history } = {}) {
  if (!message || !String(message).trim()) return { ok: false, error: "empty_message", message: "Type a message first." };
  const id = activeProviderId(providerId, session?.householdId);
  if (!id) return { ok: false, error: "no_provider", message: "No AI provider is connected. Add one in Settings → AI Providers, then ask me again." };
  const gated = budgetGate(session); if (gated) return gated;
  const catalog = toolCatalog(session);
  const compact = catalog.map((t) => ({ id: t.toolId, name: t.name, action: t.action, risk: t.risk, approval: t.requiresApproval, connector: t.connectorId, connected: t.connected, inputs: t.inputs.map((i) => i.key) }));
  const serverCtx = buildServerContext(session, context);
  const ctxStr = JSON.stringify(serverCtx).slice(0, 4000);
  const user = `Household context (JSON): ${ctxStr}\n\nAvailable tools (JSON): ${JSON.stringify(compact)}\n\nAllowed trigger types: ${TRIGGERS.join(", ")}\nAllowed space types: ${SPACE_TYPES.join(", ")}\nAllowed icons: ${ICONS.join(", ")}\n\nUser message: ${String(message).trim()}`;
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
function normalizeBuild(b) {
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
    out.automation = { name: String(b.automation.name ?? "New automation").slice(0, 80), type, intervalMs: Number(b.automation.intervalMs) > 0 ? Number(b.automation.intervalMs) : null, runAt: b.automation.runAt ?? null };
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
export async function assistantStream({ message, context, session, providerId, history } = {}, onToken) {
  if (!message || !String(message).trim()) return { ok: false, error: "empty_message", message: "Type a message first." };
  const id = activeProviderId(providerId, session?.householdId);
  if (!id) return { ok: false, error: "no_provider", message: "No AI provider is connected. Add one in Settings → AI Providers, then ask me again." };
  const gated = budgetGate(session); if (gated) return gated;
  const catalog = toolCatalog(session);
  const compact = catalog.map((t) => ({ id: t.toolId, name: t.name, action: t.action, risk: t.risk, approval: t.requiresApproval, connector: t.connectorId, connected: t.connected, inputs: t.inputs.map((i) => i.key) }));
  const serverCtx = buildServerContext(session, context);
  const ctxStr = JSON.stringify(serverCtx).slice(0, 4000);
  const user = `Household context (JSON): ${ctxStr}\n\nAvailable tools (JSON): ${JSON.stringify(compact)}\n\nAllowed trigger types: ${TRIGGERS.join(", ")}\nAllowed space types: ${SPACE_TYPES.join(", ")}\nAllowed icons: ${ICONS.join(", ")}\n\nUser message: ${String(message).trim()}`;
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
    // Signal the client that live fetching started (the streamed JSON tokens
    // weren't meaningful), then do the bounded fetch + compose pass.
    try { onToken?.(""); } catch { /* liveness only */ }
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
