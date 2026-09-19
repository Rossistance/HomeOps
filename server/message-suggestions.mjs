// FamiliOS — Famili reads a family message and suggests, beside it, the calendar event, task
// or help request it implies — or an update to one that already exists.
//
// Shape of the thing. A suggestion is stored ON the message it came from:
//   { id, kind:"create"|"update", type:"event"|"task"|"help", title, summary, patch,
//     targetId, ownerActorId, status:"open"|"applied"|"dismissed", by, at, result }
// Everyone in the thread sees the open ones; the first person to apply or dismiss wins the
// atomic status flip (withThreadLock) and the chip disappears for the rest on their next poll.
//
// Two dedupe layers, because two members reading the same message at the same time is the
// normal case, not the edge case:
//   1. At suggestion time the model is handed the sender's visible events, tasks and help
//      requests for the next 30 days and must name `matchesExistingId` when the thing already
//      exists — which turns a create into an update, or drops it.
//   2. At apply time the server re-checks: a create whose normalized title already exists on
//      that day is refused with duplicate_of (and the suggestion is closed pointing at it).
//
// Ownership decides how an update lands: the item's owner, or a parent, applies it directly;
// anyone else turns it into a "Can you help?" to the owner carrying the proposed change, and
// nothing moves until the owner says yes.
//
// The model call is the tool-free JSON pattern from file-extract.mjs (providerChatWithFallback),
// gated by the household AI budget and metered as "suggest". No tools, no autonomy: the model
// proposes, a person disposes.
import crypto from "node:crypto";
import {
  getFamilyThread, getFamilyMessage, patchFamilyMessage, listFamilyMessages,
  listEvents, listTasks, listHelpRequests, getEvent, getTask, putEvent, putTask, patchEvent, patchTask,
  getMember, listMembers, canSeeEntity, getSettings, aiBudgetExhausted, recordAiUsage,
} from "./store.mjs";
import { providerChatWithFallback } from "./ai.mjs";
import { householdTimeZone, localMidnightISO } from "./household-time.mjs";
import { createHelpRequest } from "./help-requests.mjs";
import { postMessage, withThreadLock, isParentRole } from "./family-messages.mjs";

const MAX_SUGGESTIONS = 3;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const nowISO = () => new Date().toISOString();
const sid = () => "sug_" + crypto.randomBytes(4).toString("hex");
const eid = (p) => `${p}_${crypto.randomBytes(8).toString("hex")}`;

const SYS = `You read one message from a family group chat and decide whether it implies something the family's shared calendar, task list or help board should hold. Reply with JSON only, no prose, no code fences:
{"suggestions":[{"kind":"create"|"update","type":"event"|"task"|"help","title":"...","summary":"one sentence a parent would say","patch":{...},"matchesExistingId":"id or null"}]}
Rules:
- At most 3 suggestions; an empty list is the normal answer. Suggest only what the message clearly states or asks; never invent dates, places or people.
- "patch" fields — event: title, startAt (ISO 8601 in the household's timezone, or YYYY-MM-DD for all day), endAt, location, notes, participantIds (actorIds from MEMBERS). task: title, dueAt (ISO or YYYY-MM-DD), assignedMemberId (actorId), notes, priority (low|medium|high). help: message (what is being asked, in the asker's words), toActorId (who is being asked), taskId or eventId when it is about an existing item.
- If EXISTING already has the thing (same event, same task, same ask), set kind "update" with matchesExistingId and put only the changed fields in patch; if nothing changed, omit it entirely.
- COORDINATION. When someone offers to drive, pick up, drop off, take, cover or handle an EXISTING event ("do you need help with Eleanor's appointment?", "I can take her Monday"), suggest type "help" phrased as a yes/no question to the person who owns that event: title "Ask <Offerer> to take <who> to <event>?", patch { toActorId: <the offerer's actorId>, message: "<what they would do, in plain words>", eventId: <the event id>, apply: { "driverId": <offerer's actorId> } } (use "participantId" instead of "driverId" when they would attend rather than drive). When someone ASKS another member to do such a thing, do the same with toActorId = the person being asked. Never suggest coordination for an event that is not in EXISTING; suggest a new event instead if the details are there.
- Times are in the household's timezone. Resolve "tomorrow", "Friday" against TODAY.`;

function visibleItems(session, days = 30) {
  const now = Date.now();
  const horizon = now + days * 86400e3;
  const view = { role: session.role, actorId: session.actorId };
  const events = listEvents((e) => e.householdId === session.householdId && !e.deletedAt && canSeeEntity(e, view) && (e.startAt ? Date.parse(e.startAt) : 0) >= now - 86400e3 && (e.startAt ? Date.parse(e.startAt) : 0) <= horizon)
    .slice(0, 60).map((e) => ({ id: e.id, type: "event", title: e.title, startAt: e.startAt ?? null, allDay: !!e.allDay, location: e.location || null, owner: e.ownerId ?? e.createdBy ?? null }));
  const tasks = listTasks((t) => t.householdId === session.householdId && t.status !== "done" && t.type !== "list" && canSeeEntity(t, view))
    .slice(0, 60).map((t) => ({ id: t.id, type: "task", title: t.title, dueAt: t.dueAt ?? null, assignedMemberId: t.assignedMemberId ?? null }));
  const help = listHelpRequests((h) => h.householdId === session.householdId && h.status === "pending")
    .slice(0, 30).map((h) => ({ id: h.id, type: "help", message: h.message, from: h.fromActorId, to: h.toActorId }));
  return { events, tasks, help };
}

/** Test-only extractor: bracketed directives in the text, so the whole apply path can be
 *  exercised without a model. Enabled by HOMEOPS_SUGGEST_FAKE=1 outside production. */
function fakeExtract(text) {
  const out = [];
  const re = /\[suggest (task|event|help)(?: update ([a-z0-9_]+))?:\s*([^\]]+)\]/gi;
  let m;
  while ((m = re.exec(text))) {
    const [, type, targetId, rest] = m;
    const parts = rest.split("|").map((x) => x.trim());
    const patch = {};
    for (const p of parts.slice(1)) {
      const [k, ...v] = p.split("="); if (!k || !v.length) continue;
      const key = k.trim(); const val = v.join("=").trim();
      if (key.startsWith("apply.")) { patch.apply = { ...(patch.apply ?? {}), [key.slice(6)]: val }; } else patch[key] = val;
    }
    if (type === "help") { patch.message = parts[0]; out.push({ kind: "create", type, title: parts[0], summary: "Ask for help", patch, matchesExistingId: null }); continue; }
    patch.title = parts[0];
    out.push({ kind: targetId ? "update" : "create", type, title: parts[0], summary: `${targetId ? "Update" : "Add"} ${type}`, patch, matchesExistingId: targetId ?? null });
  }
  return out;
}

async function extract({ text, context, session }) {
  if (process.env.HOMEOPS_SUGGEST_FAKE === "1" && process.env.NODE_ENV !== "production") return fakeExtract(text);
  const providerId = getSettings(session.householdId).aiActiveProvider;
  if (!providerId || aiBudgetExhausted(session.householdId)) return [];
  recordAiUsage(session.householdId, "suggest");
  const out = await providerChatWithFallback(providerId, {
    messages: [
      { role: "system", content: SYS },
      { role: "user", content: `TODAY: ${new Date().toISOString()} (timezone ${context.timezone})\nMEMBERS: ${JSON.stringify(context.members)}\nEXISTING: ${JSON.stringify(context.existing)}\nRECENT (oldest first, last one is the message to read):\n${context.recent.map((r) => `${r.from}: ${r.text}`).join("\n")}` },
    ],
  }).catch(() => ({ ok: false }));
  if (!out.ok) return [];
  try {
    const t = String(out.text ?? "");
    const a = t.indexOf("{"); const b = t.lastIndexOf("}");
    const parsed = a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : null;
    return Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  } catch { return []; }
}

function normalizeSuggestion(raw, session) {
  const type = ["event", "task", "help"].includes(raw?.type) ? raw.type : null;
  if (!type) return null;
  const title = String(raw?.title ?? raw?.patch?.title ?? raw?.patch?.message ?? "").trim().slice(0, 160);
  if (!title) return null;
  const patch = raw?.patch && typeof raw.patch === "object" ? raw.patch : {};
  let kind = raw?.kind === "update" ? "update" : "create";
  let targetId = raw?.matchesExistingId ? String(raw.matchesExistingId) : null;
  let ownerActorId = null;
  if (targetId) {
    const target = type === "event" ? getEvent(targetId) : type === "task" ? getTask(targetId) : null;
    if (!target || target.householdId !== session.householdId) { targetId = null; kind = "create"; }
    else { kind = "update"; ownerActorId = type === "event" ? (target.ownerId ?? target.createdBy ?? null) : (target.assignedMemberId ?? target.createdBy ?? null); }
  }
  let hideFrom = [];
  if (type === "help") {
    kind = "create"; targetId = null;
    // The person being asked should not be the one who taps "ask them"; everyone else in the
    // chat may. A linked event is checked here so the yes/no is never about a phantom.
    if (patch.toActorId) hideFrom = [String(patch.toActorId)];
    if (patch.eventId && !(getEvent(String(patch.eventId))?.householdId === session.householdId)) { delete patch.eventId; delete patch.apply; }
  }
  return { id: sid(), kind, type, title, summary: String(raw?.summary ?? "").slice(0, 240), patch, targetId, ownerActorId, hideFrom, status: "open", by: null, at: null, result: null };
}

/** Read one stored message and attach up to three suggestions. Never throws. */
export async function suggestForMessage({ message, session }) {
  try {
    const t = getFamilyThread(message.threadId);
    if (!t) return [];
    const recent = listFamilyMessages((m) => m.threadId === t.id && !m.deletedAt && m.kind === "text")
      .sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-6)
      .map((m) => ({ from: getMember(m.fromActorId)?.displayName ?? m.fromActorId, text: m.text }));
    const members = listMembers({ householdId: session.householdId }).filter((m) => !m.archived).map((m) => ({ actorId: m.actorId, name: m.displayName, role: m.role }));
    const context = { timezone: householdTimeZone(session.householdId), members, existing: visibleItems(session), recent };
    const raw = await extract({ text: message.text, context, session });
    const suggestions = raw.map((r) => normalizeSuggestion(r, session)).filter(Boolean).slice(0, MAX_SUGGESTIONS);
    if (!suggestions.length) return [];
    const current = getFamilyMessage(message.id);
    if (!current || current.deletedAt) return [];
    patchFamilyMessage(message.id, { suggestions: [...(current.suggestions ?? []), ...suggestions] });
    return suggestions;
  } catch { return []; }
}

/* ---- applying ---------------------------------------------------------------------- */

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const dayOf = (iso, tz) => { if (!iso) return null; try { return new Date(iso).toLocaleDateString("en-CA", { timeZone: tz }); } catch { return null; } };

function findDuplicate({ type, title, when, householdId, tz }) {
  const key = norm(title);
  if (!key) return null;
  const day = when ? (DATE_ONLY_RE.test(when) ? when : dayOf(when, tz)) : null;
  if (type === "event") {
    return listEvents((e) => e.householdId === householdId && !e.deletedAt && norm(e.title) === key && (!day || dayOf(e.startAt, tz) === day))[0] ?? null;
  }
  return listTasks((t) => t.householdId === householdId && t.status !== "done" && norm(t.title) === key && (!day || !t.dueAt || dayOf(t.dueAt, tz) === day))[0] ?? null;
}

function stamp(v, tz) {
  if (!v) return null;
  if (DATE_ONLY_RE.test(String(v))) return localMidnightISO(String(v), tz);
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

async function applyCreate(s, session, tz, { threadId, messageId } = {}) {
  const p = s.patch ?? {};
  if (s.type === "help") {
    const apply = p.apply && typeof p.apply === "object" && p.eventId ? p.apply : null;
    const proposal = apply ? { threadId, messageId, eventId: p.eventId, patch: apply } : (threadId ? { threadId, messageId, eventId: p.eventId ?? null, patch: null } : null);
    const out = createHelpRequest({ session, toActorId: p.toActorId, message: p.message ?? s.title, eventId: p.eventId ?? null, taskId: p.taskId ?? null, proposal });
    if (!out.ok) return { ok: false, error: out.error, message: out.message };
    // The ask lands in the chat, beside the words that prompted it, as a card the person
    // asked can answer with one tap — and everyone else can see is waiting on them.
    if (threadId) {
      await postMessage({ threadId, fromActorId: session.actorId, kind: "share", text: "", attachments: [{ kind: "ref", type: "help_request", id: out.helpRequest.id }] });
    }
    return { ok: true, result: { requested: { toActorId: out.helpRequest.toActorId }, created: { type: "help_request", id: out.helpRequest.id } }, line: null };
  }
  const dup = findDuplicate({ type: s.type, title: p.title ?? s.title, when: s.type === "event" ? p.startAt : p.dueAt, householdId: session.householdId, tz });
  if (dup) return { ok: true, result: { duplicateOf: dup.id, note: `Already on the ${s.type === "event" ? "calendar" : "list"}: “${dup.title}”` }, line: null };
  if (s.type === "event") {
    const startAt = stamp(p.startAt, tz);
    if (!startAt) return { ok: false, error: "invalid_startAt", message: "The suggested event has no usable date." };
    const endAt = stamp(p.endAt, tz);
    const rec = putEvent({
      id: eid("ev"), householdId: session.householdId, title: String(p.title ?? s.title).slice(0, 160),
      startAt, endAt: endAt && Date.parse(endAt) > Date.parse(startAt) ? endAt : null, allDay: p.allDay === true || DATE_ONLY_RE.test(String(p.startAt ?? "")),
      notes: typeof p.notes === "string" ? p.notes : "", location: typeof p.location === "string" ? p.location : "", spaceId: "sp-family",
      participantIds: Array.isArray(p.participantIds) ? p.participantIds.map(String) : [], driverId: null, ownerId: session.actorId, backupOwnerId: null,
      whatToBring: [], checklist: [], travel: null, reminders: [], attachments: [], comments: [], mealImpact: null,
      visibility: "household", category: "Family", layer: "canonical", status: "confirmed",
      source: "Family Messages", provenance: { via: "message_suggestion", actorId: session.actorId },
      createdBy: session.actorId, createdAt: Date.now(), updatedAt: nowISO(),
    });
    return { ok: true, result: { created: { type: "event", id: rec.id } }, line: `added “${rec.title}” to the calendar` };
  }
  const rec = putTask({
    id: eid("tk"), householdId: session.householdId, title: String(p.title ?? s.title).slice(0, 160), type: "task", status: "todo",
    dueAt: stamp(p.dueAt, tz), assignedMemberId: p.assignedMemberId ? String(p.assignedMemberId) : null, spaceId: "sp-family",
    priority: ["low", "medium", "high"].includes(p.priority) ? p.priority : "medium", amount: null, visibility: "household",
    notes: typeof p.notes === "string" ? p.notes : "", source: "message_suggestion", createdBy: session.actorId, createdAt: nowISO(), updatedAt: nowISO(),
  });
  return { ok: true, result: { created: { type: "task", id: rec.id } }, line: `added the task “${rec.title}”` };
}

function applyUpdate(s, session, tz) {
  const p = { ...(s.patch ?? {}) };
  const target = s.type === "event" ? getEvent(s.targetId) : getTask(s.targetId);
  if (!target || target.householdId !== session.householdId) return { ok: false, error: "target_gone", message: "That item no longer exists." };
  const owner = s.ownerActorId ?? (s.type === "event" ? (target.ownerId ?? target.createdBy) : (target.assignedMemberId ?? target.createdBy));
  const mayEdit = owner === session.actorId || isParentRole(session.role);
  // The owner sees the concrete change, not the model's gloss on it.
  const changes = Object.entries(p).filter(([k, v]) => k !== "title" && v != null && v !== "").map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(", ");
  const summary = changes || s.summary || "a change";
  if (!mayEdit) {
    const ownerName = getMember(owner)?.displayName ?? "the owner";
    const out = createHelpRequest({ session, toActorId: owner, message: `Please update “${target.title}”: ${summary}`.slice(0, 500), eventId: s.type === "event" ? target.id : null, taskId: s.type === "task" ? target.id : null });
    if (!out.ok) return { ok: false, error: out.error, message: out.message };
    return { ok: true, result: { requested: { toActorId: owner }, created: { type: "help_request", id: out.helpRequest.id } }, line: `asked ${ownerName} to update “${target.title}”` };
  }
  const patch = {};
  if (s.type === "event") {
    if (p.title) patch.title = String(p.title).slice(0, 160);
    if (p.startAt) { const v = stamp(p.startAt, tz); if (v) { patch.startAt = v; if (DATE_ONLY_RE.test(String(p.startAt))) patch.allDay = true; } }
    if (p.endAt) { const v = stamp(p.endAt, tz); if (v) patch.endAt = v; }
    if (typeof p.location === "string") patch.location = p.location;
    if (typeof p.notes === "string") patch.notes = p.notes;
    if (Array.isArray(p.participantIds)) patch.participantIds = p.participantIds.map(String);
    if (typeof p.allDay === "boolean") patch.allDay = p.allDay;
    patchEvent(target.id, { ...patch, updatedAt: nowISO() });
  } else {
    if (p.title) patch.title = String(p.title).slice(0, 160);
    if (p.dueAt) { const v = stamp(p.dueAt, tz); if (v) patch.dueAt = v; }
    if (p.assignedMemberId !== undefined) patch.assignedMemberId = p.assignedMemberId ? String(p.assignedMemberId) : null;
    if (typeof p.notes === "string") patch.notes = p.notes;
    if (["low", "medium", "high"].includes(p.priority)) patch.priority = p.priority;
    patchTask(target.id, { ...patch, updatedAt: nowISO() });
  }
  return { ok: true, result: { updated: { type: s.type, id: target.id } }, line: `updated “${target.title}” (${summary})` };
}

/**
 * Apply or dismiss one suggestion, exactly once across the whole thread.
 * @returns {{ ok: true, suggestion, ... } | { ok: false, error, message?, suggestion? }}
 */
export async function applySuggestion({ threadId, messageId, suggestionId, session, action }) {
  return withThreadLock(threadId, async () => {
    const m = getFamilyMessage(messageId);
    if (!m || m.threadId !== threadId) return { ok: false, error: "not_found" };
    const s = (m.suggestions ?? []).find((x) => x.id === suggestionId);
    if (!s) return { ok: false, error: "not_found" };
    if (s.status !== "open") return { ok: false, error: "already_taken", message: `${getMember(s.by)?.displayName ?? "Someone"} already ${s.status === "applied" ? "did this" : "dismissed this"}.`, suggestion: s };
    const me = getMember(session.actorId);
    const write = (next) => {
      const suggestions = (getFamilyMessage(messageId)?.suggestions ?? []).map((x) => (x.id === suggestionId ? next : x));
      patchFamilyMessage(messageId, { suggestions });
      return next;
    };
    if (action === "dismiss") {
      return { ok: true, suggestion: write({ ...s, status: "dismissed", by: session.actorId, at: nowISO() }) };
    }
    const tz = householdTimeZone(session.householdId);
    const out = s.kind === "create" ? await applyCreate(s, session, tz, { threadId, messageId }) : applyUpdate(s, session, tz);
    if (!out.ok) return { ok: false, error: out.error, message: out.message, suggestion: s };
    const next = write({ ...s, status: "applied", by: session.actorId, at: nowISO(), result: out.result });
    if (out.line) {
      await postMessage({ threadId, fromActorId: session.actorId, kind: "system", text: `${me?.displayName ?? "Someone"} ${out.line}` });
    }
    return { ok: true, suggestion: next, ...out.result };
  });
}
