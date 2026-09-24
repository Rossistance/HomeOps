// FamiliOS — Helpers. The whole agent system, in one concept.
//
// WHAT THIS REPLACES. The old design asked a family to understand seven things before a
// helper could do anything: an Agent (identity + allow-list + deny-list + an unattended
// tier), a Skill (a deterministic step recipe with its own approval gates and risk level),
// a Function (a user-defined wrapper around a tool, with a draft→available lifecycle and
// its own versions), a Playbook, an Automation, a Trigger, and an Evolution record that
// rewrote the first two behind their backs. Every one of them carried a separate answer to
// "who approves this?", so nobody — including the person who built it — could say what
// would happen when a helper ran.
//
// A Helper is all of it:
//   • name + what it does, written in plain English ("instructions"),
//   • when it runs (manual / hourly / daily at a time / weekly on a day),
//   • one autonomy dial with three settings,
//   • its own chat thread, which IS its history.
//
// Running a helper is exactly running Ask Famili with those standing instructions. Same
// tool loop, same tools, same approval chain — the model reads real data, calls real
// tools, sees real results, and writes back what it actually did. There is no plan to
// generate, no step list to render, no recipe that can drift from the tools it names.
//
// Helpers live in the SAME `agents` collection the old registry used, so every helper a
// family already has keeps working and nothing needs migrating; the fields that belonged
// to the removed concepts are simply no longer read.
import crypto from "node:crypto";
import {
  listAgents, getAgent, putAgent, patchAgent, deleteAgentRec,
  listTriggers, getTrigger, putTrigger, patchTrigger, deleteTriggerRec,
  getConversation, putConversation, appendConversationMessage,
  getMember, getSettings, appendAudit, actorInNest, listContactMethods, patchContactMethod,
} from "./store.mjs";
import { nextAnchorOccurrence } from "./triggers.mjs";
import { AUTONOMY, AUTONOMY_TEXT, SCHEDULE_KINDS, normalizeSchedule, scheduleText, autonomyOf, helperVisibleTo } from "./helper-shape.mjs";
import { runAssistantAgent } from "./assistant-agent.mjs";
import { captureMemoryFromExchange } from "./memory-capture.mjs";
import { formatForHousehold } from "./household-time.mjs";
import { roleAtLeast } from "./auth.mjs";

/* The dials, and the plain-English renderings of them, live in helper-shape.mjs: the
 * route layer and the context builder need the same answers and a shared leaf is what
 * keeps the three from importing each other in a circle. */
export { AUTONOMY, AUTONOMY_TEXT, SCHEDULE_KINDS, normalizeSchedule, scheduleText, autonomyOf, helperVisibleTo };

/** The one place autonomy becomes policy. `full` is only honoured when an Owner or Adult
 *  Admin set it (policy.mjs re-checks `setByRole`), which is why the session is stamped
 *  here and never taken from the request body. */
export function autonomyToApprovalPolicy(autonomy, session, base = {}) {
  const keep = { autoAllow: base.autoAllow ?? [], alwaysApprove: base.alwaysApprove ?? [] };
  if (autonomy === "ask") return keep;                       // no unattended grant at all
  const role = session?.role ?? null;
  const canRaise = ["Owner", "Adult Admin"].includes(String(role));
  return {
    ...keep,
    unattended: {
      enabled: true,
      // Asking for the top tier without the standing to grant it records the lower one —
      // the UI then reads back what actually applies instead of what was requested.
      includeHighRisk: autonomy === "full" && canRaise,
      // What was ASKED for, alongside what was granted. Without it a downgrade cannot be
      // told apart from an ordinary "act" grant made by someone who could never have raised
      // it — and the UI would apologise for lowering something nobody tried to raise.
      requested: autonomy,
      setBy: session?.actorId ?? null,
      setByRole: canRaise ? role : null,
      setAt: new Date().toISOString(),
    },
  };
}

/** The backing trigger is an implementation detail: the family sees the schedule ON the
 *  helper, never a separate row in a separate tab it has to keep in step by hand. One
 *  hidden trigger per helper, created/updated/removed with the helper itself. */
function syncHelperSchedule(helper, now = Date.now()) {
  const existing = listTriggers((t) => t.helperId === helper.id)[0]
    ?? (helper.triggerId ? getTrigger(helper.triggerId) : null);
  const s = normalizeSchedule(helper.schedule);
  const wanted = s.kind !== "manual" && helper.enabled !== false && helper.status !== "Paused";
  if (!wanted) {
    if (existing) deleteTriggerRec(existing.id);
    return null;
  }
  const tz = getSettings(helper.householdId)?.timezone || null;
  const occ = s.kind === "hourly"
    ? { at: now + 3600_000, tzSource: "interval" }
    : nextAnchorOccurrence(s.time, tz, now, s.kind === "weekly" ? s.weekday : null);
  const id = existing?.id ?? "trg_" + crypto.randomBytes(10).toString("hex");
  const record = {
    ...(existing ?? {}),
    id,
    householdId: helper.householdId,
    helperId: helper.id,
    name: helper.name,
    type: "recurring",
    enabled: true,
    target: { kind: "helper", helperId: helper.id },
    intervalMs: s.kind === "hourly" ? 3600_000 : s.kind === "weekly" ? 604_800_000 : 86_400_000,
    anchor: s.kind === "hourly" ? null : s.time,
    weekday: s.kind === "weekly" ? s.weekday : null,
    tzSource: occ?.tzSource ?? null,
    nextRunAt: occ?.at ?? now + 86_400_000,
    connectorId: null, event: null,
    lastFiredAt: existing?.lastFiredAt ?? null, lastRunId: existing?.lastRunId ?? null,
    lastStatus: existing?.lastStatus ?? null, lastTriggerType: existing?.lastTriggerType ?? null,
    fireCount: existing?.fireCount ?? 0,
    system: true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: new Date().toISOString(),
  };
  putTrigger(record);
  return record.id;
}

/** The household changed timezone: re-resolve every helper's next fire on the new clock. */
export function reanchorHelperSchedules(householdId, now = Date.now()) {
  let changed = 0;
  for (const h of listAgents((a) => a.householdId === householdId)) {
    const s = normalizeSchedule(h.schedule);
    if (s.kind === "manual" || s.kind === "hourly") continue;
    if (syncHelperSchedule(h, now)) changed++;
  }
  return changed;
}

/* ==================================== shape ==================================== */

const STATUSES = ["Active", "Paused"];

function normalizeHelper(body, base = {}, session = null) {
  /* An edit that does not mention autonomy must LEAVE IT ALONE. Re-deriving it on every
   * write would re-stamp who granted it (so renaming a helper re-attributes its grant to
   * whoever renamed it) and, worse, would silently drop the top tier whenever the person
   * editing lacks the standing to have granted it — a quiet downgrade nobody asked for and
   * nobody would see. */
  const autonomyGiven = AUTONOMY.includes(body.autonomy);
  const visibility = body.visibility === "nest"
    ? (actorInNest(body.nestId ?? base.nestId, session?.householdId, session?.actorId)
      ? { visibility: "nest", nestId: String(body.nestId ?? base.nestId) }
      // Naming a nest you are not in leaves the helper personal — yours, which is the safe
      // direction to fail.
      : { visibility: "personal", nestId: null })
    : {
      visibility: body.visibility === "personal" ? "personal"
        : body.visibility === "household" ? "household"
          : (base.visibility ?? "household"),
      nestId: body.visibility ? null : (base.nestId ?? null),
    };
  return {
    icon: body.icon ?? base.icon ?? "Bot",
    purpose: String(body.purpose ?? base.purpose ?? "").slice(0, 300),
    instructions: String(body.instructions ?? base.instructions ?? "").slice(0, 8000),
    status: STATUSES.includes(body.status) ? body.status : (STATUSES.includes(base.status) ? base.status : "Active"),
    enabled: body.enabled !== undefined ? body.enabled !== false : (base.enabled !== false),
    schedule: normalizeSchedule(body.schedule ?? base.schedule),
    approvalPolicy: autonomyGiven
      ? autonomyToApprovalPolicy(body.autonomy, session, base.approvalPolicy ?? {})
      : (base.approvalPolicy ?? autonomyToApprovalPolicy("ask", session)),
    // Kept in the record (the engine still honours them) but no longer a thing a family is
    // asked to assemble: a helper is trusted with the household's tools, and the autonomy
    // dial decides what it may do unattended. A deny-list survives if one was ever set.
    allowedToolIds: Array.isArray(body.allowedToolIds) ? body.allowedToolIds : (base.allowedToolIds ?? []),
    deniedToolIds: Array.isArray(body.deniedToolIds) ? body.deniedToolIds : (base.deniedToolIds ?? []),
    allowedFunctionIds: [], deniedFunctionIds: base.deniedFunctionIds ?? [],
    ...visibility,
  };
}

export function createHelper(body, session) {
  /* SECURITY: the id is SERVER-ASSIGNED, never taken from the caller.
   *
   * The old registry accepted `body.id` so a one-time IndexedDB→server migration could keep
   * local ids. That migration is long done, and what the clause left behind is id squatting:
   * a helper's standing consent to message someone is granted per helper id on the contact
   * method, so naming a free id lets a caller move into a grant somebody else was given.
   * Deleting a helper now purges those grants (see deleteHelper), which closes the same hole
   * from the other side — but a client should never have been able to choose an identity at
   * all, so it can't. */
  const id = "agt_" + crypto.randomBytes(10).toString("hex");
  const helper = {
    id,
    householdId: session?.householdId ?? "local",
    createdBy: session?.actorId ?? null,
    name: String(body.name ?? "Untitled helper").slice(0, 80),
    ...normalizeHelper(body, {}, session),
    conversationId: null,
    lastRun: null,
    system: false,
    version: 1,
    createdAt: Date.now(),
    updatedAt: new Date().toISOString(),
  };
  putAgent(helper);
  const triggerId = syncHelperSchedule(helper);
  if (triggerId) patchAgent(id, { triggerId });
  appendAudit({ type: "helper.create", agentId: id, name: helper.name, householdId: helper.householdId, actorId: session?.actorId ?? null });
  return getAgent(id);
}

export function updateHelper(id, patch, session) {
  const base = getAgent(id);
  if (!base) return null;
  const next = {
    ...base,
    ...(patch.name !== undefined ? { name: String(patch.name).slice(0, 80) } : {}),
    ...normalizeHelper(patch, base, session),
    id, householdId: base.householdId, createdBy: base.createdBy, system: base.system,
    version: (base.version ?? 1) + 1,
    updatedAt: new Date().toISOString(),
  };
  putAgent(next);
  const triggerId = syncHelperSchedule(next);
  patchAgent(id, { triggerId: triggerId ?? null });
  appendAudit({ type: "helper.update", agentId: id, householdId: base.householdId, actorId: session?.actorId ?? null });
  return getAgent(id);
}

export function deleteHelper(id) {
  const h = getAgent(id);
  if (!h) return { error: "not_found" };
  /* Only the household's own assistant is undeletable: it is the identity chat acts as. The
   * old seed also flagged its use-case agents `system: true`, and a family must be able to
   * clear those out — protecting the flag instead of the one record made the stale catalog
   * impossible to empty from the app. */
  if (h.id === "agt_household") return { error: "system_helper_protected", message: "This is the household's own assistant — it can be edited, but not deleted." };
  for (const t of listTriggers((t) => t.helperId === id)) deleteTriggerRec(t.id);
  deleteAgentRec(id);
  /* SECURITY (adversarial review, finding H1): deleting a helper is how a family expects to
   * REVOKE it. Its standing consent to message someone lives on the CONTACT METHODS that
   * allowlisted it, not on the helper record — so removing the helper alone left live grants
   * pointing at an id that no longer resolves. Purged here so revocation means what a family
   * thinks it means. Best-effort: the engine also hard-fails an unknown acting helper. */
  try {
    for (const m of listContactMethods((c) => (c.allowedAgentIds ?? []).includes(id))) {
      patchContactMethod(m.id, { allowedAgentIds: (m.allowedAgentIds ?? []).filter((a) => a !== id) });
    }
  } catch { /* the run-time gate is the backstop */ }
  appendAudit({ type: "helper.delete", agentId: id, householdId: h.householdId });
  return { ok: true };
}


/**
 * Only an adult may write a household helper; an Adult Member's helpers are their own.
 *
 * `nextVisibility` is the visibility the WRITE is asking for, and it has to be checked
 * separately from the one the record already has. Reading only the stored value left a
 * promotion hole: an Adult Member edits the personal helper they legitimately own, passes
 * `visibility: "household"`, clears the check on the old value, and hands their helper to
 * the whole family — which is the household-level act the check exists to prevent.
 */
export function mayWriteHelper(session, helper, nextVisibility = undefined) {
  const role = session?.role ?? null;
  if (!roleAtLeast(role, "Adult Member")) {
    return { ok: false, error: "insufficient_role", message: "Ask a parent or an adult in the family to change helpers." };
  }
  if (["Owner", "Adult Admin"].includes(String(role))) return { ok: true };
  const household = { ok: false, error: "household_helper", message: "This helper belongs to the whole family, so an Owner or Adult Admin looks after it." };
  if (nextVisibility === "household") return household;
  if (!helper) return { ok: true };                                  // creating: forced personal below
  if (helper.visibility === "household") return household;
  /* A NEST helper belongs to the nest, not to whoever typed it first. Checking `createdBy`
   * alone meant the other person in the nest could see and run it but not fix it — which is
   * the opposite of what sharing it was for. */
  if (helper.visibility === "nest") {
    return helper.createdBy === session?.actorId || actorInNest(helper.nestId, session?.householdId, session?.actorId)
      ? { ok: true }
      : { ok: false, error: "not_yours", message: "This helper belongs to a group you're not part of." };
  }
  if (helper.createdBy && helper.createdBy !== session?.actorId) {
    return { ok: false, error: "not_yours", message: "This is someone else's personal helper." };
  }
  return { ok: true };
}

export function getHelper(id, session) {
  const h = getAgent(id);
  if (!h) return null;
  if (h.householdId !== "local" && h.householdId !== session?.householdId) return null;
  return helperVisibleTo(h, session) ? h : null;
}

export function listHelpers(session) {
  const hh = session?.householdId ?? "local";
  return listAgents((a) => (a.householdId === hh || a.householdId === "local") && helperVisibleTo(a, session))
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

/** Everything a screen needs, already in words. No counts a family has to reconcile. */
export function publicHelper(h, session = null) {
  if (!h) return null;
  const autonomy = autonomyOf(h);
  const schedule = normalizeSchedule(h.schedule);
  return {
    id: h.id,
    name: h.name,
    icon: h.icon ?? "Bot",
    purpose: h.purpose ?? "",
    instructions: h.instructions ?? "",
    visibility: h.visibility ?? "household",
    nestId: h.nestId ?? null,
    status: h.status ?? "Active",
    enabled: h.enabled !== false,
    schedule,
    scheduleText: scheduleText(schedule),
    autonomy,
    autonomyText: AUTONOMY_TEXT[autonomy],
    // `full` asked for by someone without the standing is stored as `act`; say so rather
    // than showing the family a promise the policy engine will not keep.
    autonomyDowngraded: h.approvalPolicy?.unattended?.requested === "full"
      && h.approvalPolicy.unattended.includeHighRisk !== true,
    conversationId: h.conversationId ?? null,
    lastRun: h.lastRun ?? null,
    createdBy: h.createdBy ?? null,
    isMine: !!session && h.createdBy === session.actorId,
    system: !!h.system,
    version: h.version ?? 1,
    updatedAt: h.updatedAt,
  };
}

/* ==================================== runs ===================================== */

/** A helper's thread is its log: every run appends the ask and what it actually did, so
 *  "what has this been doing?" is answered by reading it, not by decoding run records. */
function ensureConversation(helper, session) {
  if (helper.conversationId) {
    const c = getConversation(helper.conversationId);
    if (c) return c;
  }
  const c = putConversation({
    id: "conv_" + crypto.randomBytes(8).toString("hex"),
    householdId: helper.householdId,
    actorId: helper.createdBy ?? session?.actorId ?? null,
    title: helper.name,
    titleAuto: false,
    helperId: helper.id,
    visibility: helper.visibility ?? "household",
    nestId: helper.nestId ?? null,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  patchAgent(helper.id, { conversationId: c.id });
  return c;
}

/** The session a scheduled run acts as. A personal helper runs as its owner so approvals
 *  reach that one person; a household helper runs as the scheduler. */
function sessionForHelper(helper) {
  if (helper.visibility === "personal" && helper.createdBy) {
    const owner = getMember(helper.createdBy);
    if (owner && !owner.archived) return { householdId: helper.householdId, actorId: owner.actorId, role: owner.role };
  }
  return { householdId: helper.householdId, actorId: "scheduler", role: "Owner" };
}

/**
 * Run a helper: one Ask Famili turn carrying the helper's standing instructions.
 * @returns {Promise<{ok:true, answer:string, toolCalls:Array, runIds:string[], conversationId:string} | {ok:false, error:string, message:string}>}
 */
export async function runHelper({ helperId, session = null, reason = "manual", payload = null, now = Date.now() } = {}) {
  const helper = getAgent(helperId);
  if (!helper) return { ok: false, error: "unknown_helper", message: "That helper no longer exists." };
  if (helper.enabled === false || helper.status === "Paused") {
    return { ok: false, error: "helper_paused", message: `"${helper.name}" is paused, so it didn't run.` };
  }
  if (!String(helper.instructions ?? "").trim()) {
    return { ok: false, error: "no_instructions", message: `"${helper.name}" has no instructions yet, so there is nothing for it to do. Tell it what its job is.` };
  }
  const runSession = session ?? sessionForHelper(helper);
  const conversation = ensureConversation(helper, runSession);
  const history = (conversation.messages ?? []).slice(-6);

  const when = formatForHousehold(new Date(now).toISOString(), helper.householdId);
  // A manual run may carry a note from the person who pressed Run — "focus on Monday",
  // "email it to me" — which becomes part of the ask rather than a second turn.
  const note = reason === "manual" && typeof payload?.request === "string" && payload.request.trim()
    ? `\n\nThe person who ran you added: ${payload.request.trim().slice(0, 2000)}`
    : "";
  const ask = reason === "schedule"
    ? `Scheduled run — ${when}. Do your job now for the household as it stands right now.`
    : reason === "webhook"
      ? `Something came in — ${when}. Do your job now.${payload ? `\n\nWhat arrived:\n${JSON.stringify(payload).slice(0, 2000)}` : ""}`
      : `Run now — ${when}. Do your job for the household as it stands right now.${note}`;

  const startedAt = Date.now();
  // A helper's run is never an owner alone with the assistant (ADR-005): its note is read by
  // whoever the helper reports to, so a surprise is withheld. The ledger is checked anyway
  // before its exchange is remembered, so that stays true if the audience rule ever changes.
  const ledger = {};
  let out;
  try {
    out = await runAssistantAgent({
      message: ask, context: null, session: runSession, history,
      agent: helper, conversationId: conversation.id, visibility: helper.visibility ?? "household",
      asHelper: true, audience: "shared", ledger,
    });
  } catch (e) {
    out = { ok: false, error: "helper_failed", message: String(e?.message ?? e) };
  }

  const at = new Date().toISOString();
  appendConversationMessage(conversation.id, {
    id: "m_" + crypto.randomBytes(6).toString("hex"), role: "user", text: ask, at, source: reason,
  });
  appendConversationMessage(conversation.id, {
    id: "m_" + crypto.randomBytes(6).toString("hex"),
    role: "assistant",
    text: out.ok ? out.answer : (out.message ?? "Something went wrong."),
    kind: out.ok ? "answer" : "error",
    at,
    toolCalls: out.toolCalls ?? [],
    runIds: out.runIds ?? [],
  });

  // A one-line summary the list view can show without opening the thread.
  const did = (out.toolCalls ?? []).filter((c) => c.status === "done").length;
  const waiting = (out.toolCalls ?? []).filter((c) => c.status === "awaiting_approval").length;
  const lastRun = {
    at: startedAt,
    finishedAt: Date.now(),
    ok: !!out.ok,
    reason,
    summary: out.ok
      ? (waiting ? `Waiting for approval on ${waiting} thing${waiting === 1 ? "" : "s"}` : did ? `Did ${did} thing${did === 1 ? "" : "s"}` : "Nothing needed doing")
      : (out.message ?? "Failed"),
    runIds: out.runIds ?? [],
    error: out.ok ? null : (out.error ?? "failed"),
  };
  patchAgent(helper.id, { lastRun });
  // What a helper found out is household intelligence too — a briefing that discovers the
  // family has a Nest thermostat, or that dance is every Thursday, is worth remembering
  // exactly as a chat answer would be. Scoped to the helper's room; never blocks the run.
  if (out.ok && out.answer && !ledger.secretReleased) {
    void captureMemoryFromExchange({
      householdId: helper.householdId, actorId: helper.createdBy ?? runSession.actorId,
      visibility: helper.visibility ?? "household", nestId: helper.nestId ?? null,
      message: ask, answer: out.answer, via: "helper", agentId: helper.id, agentName: helper.name,
    });
  }
  appendAudit({
    type: "helper.run", agentId: helper.id, reason, ok: !!out.ok,
    error: out.ok ? undefined : out.error, toolCount: (out.toolCalls ?? []).length,
    householdId: helper.householdId, actorId: runSession.actorId,
  });

  return out.ok
    ? { ok: true, answer: out.answer, toolCalls: out.toolCalls ?? [], runIds: out.runIds ?? [], conversationId: conversation.id, lastRun }
    : { ok: false, error: out.error ?? "helper_failed", message: out.message ?? "The helper couldn't finish.", conversationId: conversation.id, lastRun };
}

/* ================================== templates ================================== */

/** Starter helpers. A template is just a name and a first draft of the instructions —
 *  there is no hidden step graph, so what a family reads here is what the helper will
 *  actually be told to do, and they can edit every word of it before it runs. */
export const HELPER_TEMPLATES = [
  {
    id: "tpl_morning", name: "Morning Briefing", icon: "Sun", category: "Every day",
    purpose: "One short summary of the day, every morning.",
    schedule: { kind: "daily", time: "07:00" }, autonomy: "act",
    instructions: "Every morning, look at today's calendar events and anything due today, and write the family one short, warm summary: who has to be where and when, what's due, and anything still waiting on someone. Mention conflicts and anything unusual about the day. If the day is quiet, say so in one line. Keep it under 120 words and don't invent anything that isn't on the calendar or the task list.",
  },
  {
    id: "tpl_week_ahead", name: "Week Ahead", icon: "Calendar", category: "Every day",
    purpose: "A Sunday look at the week coming up.",
    schedule: { kind: "weekly", time: "17:00", weekday: 0 }, autonomy: "act",
    instructions: "Every Sunday evening, look at the next seven days of the calendar and the open tasks. Write the family a short heads-up: the busiest day, anything that needs preparing in advance (forms, gear, gifts, appointments to confirm), and any day with nothing on it that could be used. Point out conflicts where two people are needed in two places.",
  },
  {
    id: "tpl_meals", name: "Meal Planner", icon: "UtensilsCrossed", category: "Every day",
    purpose: "Plans the week's dinners and keeps the grocery list current.",
    schedule: { kind: "weekly", time: "16:00", weekday: 6 }, autonomy: "ask",
    instructions: "Once a week, plan dinners for the coming week. Check what's already planned first and don't replace it. Size meals to the people in the household, respect anything the family has told me about food (allergies, vegetarian, dislikes), and avoid repeating last week's meals. Put each dinner on the calendar and add the missing ingredients to the grocery list. Then tell the family the menu in one short list.",
  },
  {
    id: "tpl_tasks", name: "Nothing Forgotten", icon: "ListChecks", category: "Every day",
    purpose: "Nudges about things going stale or coming due.",
    schedule: { kind: "daily", time: "18:00" }, autonomy: "act",
    instructions: "Each evening, look for tasks that are overdue, due tomorrow, or have been sitting untouched for more than a week, and anything on the calendar tomorrow that needs something brought or prepared. Write one short note naming who each thing belongs to. If nothing needs attention, say nothing needs attention.",
  },
  {
    id: "tpl_school", name: "School Paperwork", icon: "FileText", category: "School",
    purpose: "Turns school notices into dates nobody misses.",
    schedule: { kind: "manual" }, autonomy: "ask",
    instructions: "When the family shares a school notice, permission slip, newsletter or schedule, read it and pull out every date, deadline, cost and thing that has to be brought or signed. Put each one on the calendar or the task list with the child's name, and tell the family what you found in a short list. Ask before adding more than a handful of events at once.",
  },
  {
    id: "tpl_bills", name: "Bills & Renewals", icon: "CreditCard", category: "Money",
    purpose: "Keeps bills and subscriptions from surprising anyone.",
    schedule: { kind: "weekly", time: "09:00", weekday: 1 }, autonomy: "ask",
    instructions: "Once a week, check for bills and subscription renewals coming up in the next two weeks, using what the family has recorded and anything in connected email. List what's due, the amount if it's known, and the date. Flag anything that looks like a price rise or a free trial about to convert. Never pay anything — just tell the family.",
  },
  {
    id: "tpl_appointments", name: "Appointment Prep", icon: "Stethoscope", category: "Health",
    purpose: "Gets everyone ready before an appointment.",
    schedule: { kind: "daily", time: "19:00" }, autonomy: "act",
    instructions: "Each evening, check tomorrow's calendar for medical, dental or similar appointments. For each one, remind the family who it's for, the time and place, how long to allow to get there, and anything that needs bringing (insurance card, forms, referral, a list of questions). If there's nothing tomorrow, say nothing.",
  },
  {
    id: "tpl_carpool", name: "Rides & Pickups", icon: "Bot", category: "Every day",
    purpose: "Works out who is driving whom.",
    schedule: { kind: "daily", time: "20:00" }, autonomy: "ask",
    instructions: "Each evening, look at tomorrow's activities, practices and appointments and work out whether every one of them has someone to drive. Where two pickups overlap or nobody is assigned, say so clearly and suggest who could take it based on the rest of their day. Don't message anyone outside the family without asking first.",
  },
];

export function helperTemplates() {
  const sections = [];
  for (const t of HELPER_TEMPLATES) {
    let s = sections.find((x) => x.key === t.category);
    if (!s) { s = { key: t.category, title: t.category, templates: [] }; sections.push(s); }
    s.templates.push({ ...t, scheduleText: scheduleText(t.schedule), autonomyText: AUTONOMY_TEXT[t.autonomy] });
  }
  return sections;
}
