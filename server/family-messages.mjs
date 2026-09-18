// FamiliOS — family Messages: the household talking to itself.
//
// Threads between members, direct or group, with a membership that can grow and shrink.
// This module owns every rule; server/family-messages-routes.mjs only maps HTTP onto it.
//
// Why not the conversation model. A conversation is one person's dialogue with the
// assistant: one actorId, messages embedded on the record, visibility as broadcast read
// access. A family thread needs participants, a read cursor per person, mute per person,
// who-added-whom, and messages that can be edited, deleted, reacted to and searched. Those
// live here, in two id-keyed collections (family_threads.json, family_messages.json), and
// never appear in Ask's thread list.
//
// Who may message whom (canMessage). Adults may message any adult. Parents (Owner,
// Adult Admin) may message any child (Child View, Limited Member). An Adult Member may
// message a child only inside their own nest. Children never start a thread; they reply in
// the threads they are in. Guest/Helper is outside Messages entirely. A group may be
// created, or grown, only with people the actor could message directly.
import crypto from "node:crypto";
import {
  listFamilyThreads, getFamilyThread, putFamilyThread, patchFamilyThread,
  listFamilyMessages, getFamilyMessage, putFamilyMessage, patchFamilyMessage,
  getMember, listMembers, listNests, isAdultRole, addNotification, appendAudit, withLock,
} from "./store.mjs";
import { pushToMember } from "./notify.mjs";

const PARENT_ROLES = new Set(["Owner", "Adult Admin"]);
const CHILD_ROLES = new Set(["Child View", "Limited Member"]);
export const MESSAGE_MAX = 4000;
export const TITLE_MAX = 80;
export const PAGE_MAX = 100;
export const SHARE_TYPES = ["event", "task", "file", "meal", "list_item", "help_request", "notification"];
/** iOS notification category the app registers for inline Reply (Phase 5). */
export const PUSH_CATEGORY = "family_message";
const TYPING_TTL_MS = 6000;

const nowISO = () => new Date().toISOString();
const tid = () => "fth_" + crypto.randomBytes(8).toString("hex");
const mid = () => "fmsg_" + crypto.randomBytes(8).toString("hex");

export const isParentRole = (role) => PARENT_ROLES.has(role);
export const isChildRole = (role) => CHILD_ROLES.has(role);

/* ---- who may message whom ---------------------------------------------------------- */

function sharedNest(householdId, a, b) {
  return listNests((n) => n.householdId === householdId && !n.archived).some((n) => {
    const joined = (n.members ?? []).filter((m) => m.status === "joined").map((m) => m.actorId);
    return joined.includes(a) && joined.includes(b);
  });
}

/**
 * May `from` open a thread with `to` (or add `to` to one)? Pure over member records.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function canMessage(from, to) {
  if (!from || !to) return { ok: false, reason: "unknown_member" };
  if (from.actorId === to.actorId) return { ok: false, reason: "self" };
  if (from.archived || to.archived) return { ok: false, reason: "archived" };
  if (from.role === "Guest/Helper" || to.role === "Guest/Helper") return { ok: false, reason: "guest" };
  if (isChildRole(from.role)) return { ok: false, reason: "child_cannot_start" };
  if (isAdultRole(to.role)) return { ok: true };
  // `to` is a child.
  if (isParentRole(from.role)) return { ok: true };
  if (from.role === "Adult Member") {
    return sharedNest(from.householdId, from.actorId, to.actorId) ? { ok: true } : { ok: false, reason: "different_nest" };
  }
  return { ok: false, reason: "not_parent" };
}

/* ---- thread shape --------------------------------------------------------------------- */

const activeIds = (t) => Object.entries(t.members ?? {}).filter(([, m]) => !m.leftAt).map(([id]) => id);
const memberState = (t, actorId) => t.members?.[actorId] ?? null;

export function isMuted(t, actorId, now = Date.now()) {
  const m = memberState(t, actorId);
  if (!m?.mutedUntil) return false;
  if (m.mutedUntil === "forever") return true;
  const until = Date.parse(m.mutedUntil);
  return Number.isFinite(until) && until > now;
}

/** May this person read the thread? Participants (including those who left, up to when they
 *  left) and parents looking in on a thread a child is in. */
export function canViewThread(t, viewer) {
  if (!t || !viewer || t.householdId !== viewer.householdId) return false;
  if (memberState(t, viewer.actorId)) return true;
  if (isParentRole(viewer.role)) {
    return activeIds(t).some((id) => isChildRole(getMember(id)?.role));
  }
  return false;
}
export const isActiveParticipant = (t, actorId) => !!memberState(t, actorId) && !memberState(t, actorId).leftAt;

function roster(householdId) {
  return new Map(listMembers({ householdId }).map((m) => [m.actorId, m]));
}

/** The thread as the API returns it: enriched members, unread count for `forActorId`. */
export function publicThread(t, forActorId) {
  const people = roster(t.householdId);
  const members = Object.entries(t.members ?? {}).map(([actorId, m]) => {
    const p = people.get(actorId);
    return { actorId, displayName: p?.displayName ?? actorId, color: p?.color ?? null, role: p?.role ?? null, joinedAt: m.joinedAt, leftAt: m.leftAt ?? null, lastReadAt: m.lastReadAt ?? null, mutedUntil: m.mutedUntil ?? null };
  });
  const me = memberState(t, forActorId);
  const cutoff = me?.lastReadAt ? Date.parse(me.lastReadAt) : 0;
  const leftAt = me?.leftAt ? Date.parse(me.leftAt) : Infinity;
  const unreadCount = me
    ? listFamilyMessages((x) => x.threadId === t.id && !x.deletedAt && x.fromActorId !== forActorId && x.kind !== "system"
        && Date.parse(x.at) > cutoff && Date.parse(x.at) <= leftAt).length
    : 0;
  return {
    id: t.id, kind: t.kind, title: t.title ?? null, participantIds: activeIds(t), createdBy: t.createdBy,
    createdAt: t.createdAt, updatedAt: t.updatedAt, lastMessageAt: t.lastMessageAt ?? null, lastPreview: t.lastPreview ?? null,
    members, unreadCount, muted: isMuted(t, forActorId), left: !!me?.leftAt, archived: !!t.archived,
  };
}

/** Threads this person can see, newest activity first. `viewing` lets a parent list a child's. */
export function listThreadsFor(actorId, householdId, { viewer } = {}) {
  const v = viewer ?? getMember(actorId);
  return listFamilyThreads((t) => t.householdId === householdId && !!memberState(t, actorId))
    .filter((t) => !viewer || viewer.actorId === actorId || canViewThread(t, viewer))
    .sort((a, b) => String(b.lastMessageAt ?? b.createdAt).localeCompare(String(a.lastMessageAt ?? a.createdAt)))
    .map((t) => publicThread(t, actorId))
    .filter(() => !!v);
}

/* ---- creating ---------------------------------------------------------------------- */

export function createThread({ householdId, actorId, participantIds = [], title = null }) {
  const me = getMember(actorId);
  if (!me || me.householdId !== householdId) return { ok: false, error: "unknown_member" };
  const others = [...new Set(participantIds.map(String))].filter((id) => id !== actorId);
  if (others.length === 0) return { ok: false, error: "nobody_to_message" };
  for (const id of others) {
    const other = getMember(id);
    if (!other || other.householdId !== householdId) return { ok: false, error: "unknown_member", who: id };
    const c = canMessage(me, other);
    if (!c.ok) return { ok: false, error: "cannot_message", reason: c.reason, who: id, whoName: other.displayName };
  }
  const at = nowISO();
  if (others.length === 1) {
    const pair = new Set([actorId, others[0]]);
    const existing = listFamilyThreads((t) => t.householdId === householdId && t.kind === "direct" && !t.archived
      && Object.keys(t.members ?? {}).length === 2 && Object.keys(t.members).every((id) => pair.has(id)))[0];
    if (existing) {
      // Someone who left their own direct thread rejoins it by messaging again.
      const mine = existing.members[actorId];
      if (mine?.leftAt) existing.members[actorId] = { ...mine, leftAt: null, joinedAt: at };
      putFamilyThread({ ...existing, updatedAt: at });
      return { ok: true, thread: existing, existed: true };
    }
  }
  const members = {};
  for (const id of [actorId, ...others]) members[id] = { joinedAt: at, leftAt: null, lastReadAt: id === actorId ? at : null, mutedUntil: null };
  const t = {
    id: tid(), householdId, kind: others.length === 1 ? "direct" : "group",
    title: others.length === 1 ? null : String(title ?? "").trim().slice(0, TITLE_MAX) || null,
    createdBy: actorId, createdAt: at, updatedAt: at, lastMessageAt: null, lastPreview: null, members, archived: false,
  };
  putFamilyThread(t);
  appendAudit({ type: "thread.create", threadId: t.id, kind: t.kind, actorId, householdId, participants: others.length + 1 });
  return { ok: true, thread: t };
}

/* ---- messages ---------------------------------------------------------------------- */

function normalizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const a of list.slice(0, 10)) {
    if (!a || typeof a !== "object") continue;
    if (a.kind === "file" && typeof a.fileId === "string") {
      out.push({ kind: "file", fileId: a.fileId, name: a.name ? String(a.name).slice(0, 160) : null, mime: a.mime ? String(a.mime).slice(0, 80) : null,
        ...(a.audio && Number.isFinite(Number(a.audio.durationMs)) ? { audio: { durationMs: Math.max(0, Math.round(Number(a.audio.durationMs))) } } : {}) });
    } else if (a.kind === "ref" && SHARE_TYPES.includes(a.type) && typeof a.id === "string") {
      out.push({ kind: "ref", type: a.type, id: a.id });
    }
  }
  return out;
}

/** One line that stands for a message in a preview or a push. */
export function describeMessage(m) {
  if (m.deletedAt) return "Message deleted";
  const text = String(m.text ?? "").replace(/\s+/g, " ").trim();
  if (text) return text;
  const a = m.attachments?.[0];
  if (!a) return "";
  if (a.kind === "file") return a.audio ? "🎤 Voice note" : /^image\//.test(a.mime ?? "") ? "📷 Photo" : `📎 ${a.name ?? "File"}`;
  if (a.kind === "ref") return `Shared ${a.type.replace("_", " ")}`;
  return "";
}

export function listMessages(threadId, { before = null, limit = 50, forActorId = null } = {}) {
  const t = getFamilyThread(threadId);
  if (!t) return [];
  const me = forActorId ? memberState(t, forActorId) : null;
  const leftAt = me?.leftAt ? Date.parse(me.leftAt) : Infinity;
  const beforeMs = before ? Date.parse(before) : Infinity;
  const n = Math.min(PAGE_MAX, Math.max(1, Number(limit) || 50));
  return listFamilyMessages((x) => x.threadId === threadId)
    .filter((x) => Date.parse(x.at) <= leftAt && Date.parse(x.at) < beforeMs)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(-n);
}

/**
 * Append a message. The sender's own read cursor moves with it; everyone else active in the
 * thread gets an in-app row and (unless muted) a push. Never throws on delivery.
 */
export async function postMessage({ threadId, fromActorId, text = "", attachments = [], kind = "text" }) {
  const t = getFamilyThread(threadId);
  if (!t || t.archived) return { ok: false, error: "not_found" };
  if (kind !== "system" && !isActiveParticipant(t, fromActorId)) return { ok: false, error: "not_participant" };
  const body = String(text ?? "").trim().slice(0, MESSAGE_MAX);
  const atts = normalizeAttachments(attachments);
  if (kind !== "system" && !body && atts.length === 0) return { ok: false, error: "empty_message" };
  const at = nowISO();
  const m = {
    id: mid(), threadId, householdId: t.householdId, fromActorId, at, kind: kind === "system" ? "system" : atts.some((a) => a.kind === "ref") && !body ? "share" : "text",
    text: body, attachments: atts, reactions: {}, suggestions: [], editedAt: null, deletedAt: null,
  };
  putFamilyMessage(m);
  const members = { ...t.members };
  if (members[fromActorId] && kind !== "system") members[fromActorId] = { ...members[fromActorId], lastReadAt: at };
  const senderName = kind === "system" ? "FamiliOS" : getMember(fromActorId)?.displayName ?? fromActorId;
  patchFamilyThread(threadId, { members, lastMessageAt: at, lastPreview: { from: senderName, actorId: fromActorId, text: describeMessage(m).slice(0, 140) } });
  if (kind !== "system") await notifyRecipients({ ...t, members }, m, senderName);
  return { ok: true, message: m };
}

async function notifyRecipients(t, m, senderName) {
  const threadName = t.kind === "group" ? (t.title ?? "Group") : senderName;
  const title = t.kind === "group" ? `${senderName} · ${threadName}` : senderName;
  const body = describeMessage(m).slice(0, 1000);
  for (const actorId of activeIds(t)) {
    if (actorId === m.fromActorId) continue;
    try {
      addNotification({
        householdId: t.householdId, actorId, channel: "in_app", title, body: body.slice(0, 2000), to: null,
        source: { kind: "thread", id: t.id, name: threadName }, threadId: t.id, data: { type: "thread", id: t.id, messageId: m.id },
      });
      const muted = isMuted(t, actorId);
      appendAudit({ type: "thread.push", threadId: t.id, messageId: m.id, actorId, householdId: t.householdId, skipped: muted ? "muted" : null });
      if (!muted) {
        void pushToMember({ householdId: t.householdId, actorId, title, body, data: { type: "thread", id: t.id, messageId: m.id }, categoryId: PUSH_CATEGORY, bodyLimit: 1000 });
      }
    } catch { /* a delivery hiccup never loses the message itself */ }
  }
}

export function markRead(threadId, actorId) {
  const t = getFamilyThread(threadId);
  if (!t || !memberState(t, actorId)) return null;
  const members = { ...t.members, [actorId]: { ...t.members[actorId], lastReadAt: nowISO() } };
  return patchFamilyThread(threadId, { members });
}

/** `until`: ISO string, "forever", or null to unmute. */
export function setMute(threadId, actorId, until) {
  const t = getFamilyThread(threadId);
  if (!t || !memberState(t, actorId)) return null;
  let value = null;
  if (until === "forever") value = "forever";
  else if (typeof until === "string" && Number.isFinite(Date.parse(until))) value = new Date(Date.parse(until)).toISOString();
  const members = { ...t.members, [actorId]: { ...t.members[actorId], mutedUntil: value } };
  return patchFamilyThread(threadId, { members });
}

/* ---- membership -------------------------------------------------------------------- */

export async function addMember(threadId, byActorId, actorId) {
  const t = getFamilyThread(threadId);
  if (!t || t.archived) return { ok: false, error: "not_found" };
  const by = getMember(byActorId); const who = getMember(actorId);
  if (!isActiveParticipant(t, byActorId)) return { ok: false, error: "not_participant" };
  if (!by || !isAdultRole(by.role)) return { ok: false, error: "insufficient_role", message: "Only an adult in the chat can add people." };
  if (!who || who.householdId !== t.householdId) return { ok: false, error: "unknown_member" };
  const c = canMessage(by, who);
  if (!c.ok) return { ok: false, error: "cannot_message", reason: c.reason, whoName: who.displayName };
  if (isActiveParticipant(t, actorId)) return { ok: false, error: "already_member" };
  const at = nowISO();
  const members = { ...t.members, [actorId]: { joinedAt: at, leftAt: null, lastReadAt: null, mutedUntil: null } };
  patchFamilyThread(threadId, { members, kind: "group" });
  await postMessage({ threadId, fromActorId: byActorId, kind: "system", text: `${by.displayName} added ${who.displayName}` });
  appendAudit({ type: "thread.add_member", threadId, actorId: byActorId, added: actorId, householdId: t.householdId });
  return { ok: true, thread: getFamilyThread(threadId) };
}

export async function removeMember(threadId, byActorId, actorId) {
  const t = getFamilyThread(threadId);
  if (!t || t.archived) return { ok: false, error: "not_found" };
  const by = getMember(byActorId); const who = getMember(actorId);
  if (!by || !who) return { ok: false, error: "unknown_member" };
  if (byActorId === actorId) return { ok: false, error: "use_leave" };
  if (!isActiveParticipant(t, actorId)) return { ok: false, error: "not_member" };
  const allowed = isParentRole(by.role) || (t.createdBy === byActorId && isActiveParticipant(t, byActorId));
  if (!allowed) return { ok: false, error: "insufficient_role", message: "Only a parent or the person who started the chat can remove someone." };
  const at = nowISO();
  const members = { ...t.members, [actorId]: { ...t.members[actorId], leftAt: at } };
  patchFamilyThread(threadId, { members });
  await postMessage({ threadId, fromActorId: byActorId, kind: "system", text: `${by.displayName} removed ${who.displayName}` });
  appendAudit({ type: "thread.remove_member", threadId, actorId: byActorId, removed: actorId, householdId: t.householdId });
  return { ok: true, thread: getFamilyThread(threadId) };
}

export async function leaveThread(threadId, actorId) {
  const t = getFamilyThread(threadId);
  if (!t || !isActiveParticipant(t, actorId)) return { ok: false, error: "not_participant" };
  const me = getMember(actorId);
  const at = nowISO();
  const members = { ...t.members, [actorId]: { ...t.members[actorId], leftAt: at } };
  const remaining = Object.values(members).filter((m) => !m.leftAt).length;
  await postMessage({ threadId, fromActorId: actorId, kind: "system", text: `${me?.displayName ?? actorId} left` });
  patchFamilyThread(threadId, { members, archived: remaining === 0 });
  return { ok: true, thread: getFamilyThread(threadId) };
}

export function renameThread(threadId, byActorId, title) {
  const t = getFamilyThread(threadId);
  if (!t || !isActiveParticipant(t, byActorId)) return { ok: false, error: "not_participant" };
  if (t.kind !== "group") return { ok: false, error: "direct_thread" };
  const next = String(title ?? "").trim().slice(0, TITLE_MAX) || null;
  return { ok: true, thread: patchFamilyThread(threadId, { title: next }) };
}

/* ---- editing, deleting, reacting --------------------------------------------------- */

function refreshPreview(t, m) {
  if (!t.lastPreview || Date.parse(m.at) < Date.parse(t.lastMessageAt ?? 0)) return;
  const senderName = getMember(m.fromActorId)?.displayName ?? m.fromActorId;
  patchFamilyThread(t.id, { lastPreview: { from: senderName, actorId: m.fromActorId, text: describeMessage(m).slice(0, 140) } });
}

export function editMessage(threadId, messageId, byActorId, text) {
  const t = getFamilyThread(threadId); const m = getFamilyMessage(messageId);
  if (!t || !m || m.threadId !== threadId) return { ok: false, error: "not_found" };
  if (m.fromActorId !== byActorId) return { ok: false, error: "not_sender" };
  if (m.deletedAt) return { ok: false, error: "deleted" };
  const body = String(text ?? "").trim().slice(0, MESSAGE_MAX);
  if (!body && m.attachments.length === 0) return { ok: false, error: "empty_message" };
  const next = patchFamilyMessage(messageId, { text: body, editedAt: nowISO() });
  refreshPreview(t, next);
  return { ok: true, message: next };
}

export function deleteMessage(threadId, messageId, byActorId) {
  const t = getFamilyThread(threadId); const m = getFamilyMessage(messageId);
  if (!t || !m || m.threadId !== threadId) return { ok: false, error: "not_found" };
  const by = getMember(byActorId);
  if (m.fromActorId !== byActorId && !isParentRole(by?.role)) return { ok: false, error: "not_sender" };
  if (m.deletedAt) return { ok: true, message: m };
  const next = patchFamilyMessage(messageId, { text: "", attachments: [], reactions: {}, suggestions: [], deletedAt: nowISO() });
  refreshPreview(t, next);
  return { ok: true, message: next };
}

export function toggleReaction(threadId, messageId, actorId, emoji) {
  const t = getFamilyThread(threadId); const m = getFamilyMessage(messageId);
  if (!t || !m || m.threadId !== threadId) return { ok: false, error: "not_found" };
  if (!isActiveParticipant(t, actorId)) return { ok: false, error: "not_participant" };
  if (m.deletedAt) return { ok: false, error: "deleted" };
  const e = String(emoji ?? "").trim().slice(0, 8);
  if (!e) return { ok: false, error: "empty_emoji" };
  const reactions = { ...(m.reactions ?? {}) };
  const who = new Set(reactions[e] ?? []);
  if (who.has(actorId)) who.delete(actorId); else who.add(actorId);
  if (who.size) reactions[e] = [...who]; else delete reactions[e];
  return { ok: true, message: patchFamilyMessage(messageId, { reactions }) };
}

/* ---- search, typing ---------------------------------------------------------------- */

export function searchMessages(actorId, householdId, q, { limit = 50 } = {}) {
  const needle = String(q ?? "").trim().toLowerCase();
  if (needle.length < 2) return [];
  const mine = new Map(listFamilyThreads((t) => t.householdId === householdId && !!memberState(t, actorId)).map((t) => [t.id, t]));
  return listFamilyMessages((m) => mine.has(m.threadId) && !m.deletedAt)
    .filter((m) => {
      const me = memberState(mine.get(m.threadId), actorId);
      if (me?.leftAt && Date.parse(m.at) > Date.parse(me.leftAt)) return false;
      return String(m.text ?? "").toLowerCase().includes(needle) || (m.attachments ?? []).some((a) => String(a.name ?? "").toLowerCase().includes(needle));
    })
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, Math.min(200, Math.max(1, Number(limit) || 50)))
    .map((m) => ({ threadId: m.threadId, message: m }));
}

const _typing = new Map(); // `${householdId}:${threadId}` → Map(actorId → ms)
export function setTyping(householdId, threadId, actorId) {
  const key = `${householdId}:${threadId}`;
  if (!_typing.has(key)) _typing.set(key, new Map());
  _typing.get(key).set(actorId, Date.now());
}
export function whoIsTyping(householdId, threadId, exceptActorId = null, now = Date.now()) {
  const m = _typing.get(`${householdId}:${threadId}`);
  if (!m) return [];
  const out = [];
  for (const [actorId, ts] of m) {
    if (now - ts > TYPING_TTL_MS) { m.delete(actorId); continue; }
    if (actorId !== exceptActorId) out.push(actorId);
  }
  return out;
}

/** Serialized mutation on one thread (the suggestion apply race uses this too). */
export const withThreadLock = (threadId, fn) => withLock(`thread:${threadId}`, fn);
