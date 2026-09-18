// FamiliOS — HTTP for family Messages. Every rule lives in family-messages.mjs; this file
// only parses the request, gates the session, and answers. Called from index.mjs for any
// path under /api/threads; returns true when it answered.
import {
  listThreadsFor, createThread, publicThread, listMessages, postMessage, markRead, setMute,
  addMember, removeMember, leaveThread, renameThread, editMessage, deleteMessage, toggleReaction,
  searchMessages, setTyping, whoIsTyping, canViewThread, isActiveParticipant, isParentRole, isChildRole,
} from "./family-messages.mjs";
import { getFamilyThread, getMember } from "./store.mjs";
import { resolvePreview } from "./share-preview.mjs";

const err = (json, res, req, status, error, extra = {}) => json(res, status, { error, ...extra }, req);

/** Attach a fresh preview to every `ref` attachment, as this reader may see it. */
function withPreviews(messages, session) {
  return messages.map((m) => ({
    ...m,
    attachments: (m.attachments ?? []).map((a) => (a.kind === "ref" ? { ...a, preview: resolvePreview(a, session) } : a)),
  }));
}

export async function handleFamilyMessageRoutes({ req, res, path, method, url, gate, json, readBody, audit }) {
  const g = gate(req, { requireSession: true });
  if (!g.ok) { json(res, g.status, { error: g.error }, req); return true; }
  const s = g.session;
  const me = getMember(s.actorId);
  if (!me || me.role === "Guest/Helper") { err(json, res, req, 403, "messages_not_available", { message: "Messages are for household members." }); return true; }

  // GET /api/threads[?actorId=<child>] — mine, or a child's when I am a parent.
  if (path === "/api/threads" && method === "GET") {
    const other = url.searchParams.get("actorId");
    if (other && other !== s.actorId) {
      const child = getMember(other);
      if (!isParentRole(s.role) || !child || child.householdId !== s.householdId || !isChildRole(child.role)) return err(json, res, req, 403, "not_allowed"), true;
      json(res, 200, { threads: listThreadsFor(other, s.householdId, { viewer: me }), viewing: other }, req);
      return true;
    }
    json(res, 200, { threads: listThreadsFor(s.actorId, s.householdId) }, req);
    return true;
  }
  if (path === "/api/threads" && method === "POST") {
    const body = await readBody(req); if (!body) return err(json, res, req, 400, "malformed_json"), true;
    const out = createThread({ householdId: s.householdId, actorId: s.actorId, participantIds: Array.isArray(body.participantIds) ? body.participantIds : [], title: body.title });
    if (!out.ok) return err(json, res, req, out.error === "cannot_message" ? 403 : 400, out.error, { reason: out.reason, who: out.who, whoName: out.whoName }), true;
    audit({ type: "thread.create", threadId: out.thread.id, ok: true }, req, s);
    json(res, 200, { thread: publicThread(out.thread, s.actorId), existed: !!out.existed }, req);
    return true;
  }
  if (path === "/api/threads/search" && method === "GET") {
    const hits = searchMessages(s.actorId, s.householdId, url.searchParams.get("q") ?? "", { limit: Number(url.searchParams.get("limit") || 50) });
    const threads = {};
    for (const h of hits) if (!threads[h.threadId]) { const t = getFamilyThread(h.threadId); if (t) threads[h.threadId] = publicThread(t, s.actorId); }
    json(res, 200, { hits: hits.map((h) => ({ threadId: h.threadId, message: withPreviews([h.message], s)[0] })), threads }, req);
    return true;
  }

  const m = path.match(/^\/api\/threads\/([^/]+)(?:\/(.*))?$/);
  if (!m) return false;
  const [, threadId, rest = ""] = m;
  const t = getFamilyThread(threadId);
  if (!t || t.householdId !== s.householdId || !canViewThread(t, me)) return err(json, res, req, 404, "not_found"), true;
  const active = isActiveParticipant(t, s.actorId);

  if (rest === "" && method === "GET") {
    const messages = listMessages(threadId, { before: url.searchParams.get("before"), limit: Number(url.searchParams.get("limit") || 50), forActorId: s.actorId });
    const readBy = Object.fromEntries(Object.entries(t.members).filter(([, x]) => !x.leftAt).map(([id, x]) => [id, x.lastReadAt ?? null]));
    json(res, 200, { thread: publicThread(t, s.actorId), messages: withPreviews(messages, s), readBy, typing: whoIsTyping(s.householdId, threadId, s.actorId) }, req);
    return true;
  }
  if (rest === "" && method === "PATCH") {
    const body = await readBody(req); if (!body) return err(json, res, req, 400, "malformed_json"), true;
    const out = renameThread(threadId, s.actorId, body.title);
    if (!out.ok) return err(json, res, req, 400, out.error), true;
    json(res, 200, { thread: publicThread(out.thread, s.actorId) }, req);
    return true;
  }
  if (rest === "messages" && method === "POST") {
    if (!active) return err(json, res, req, 403, "not_participant"), true;
    const body = await readBody(req); if (!body) return err(json, res, req, 400, "malformed_json"), true;
    const out = await postMessage({ threadId, fromActorId: s.actorId, text: body.text, attachments: body.attachments });
    if (!out.ok) return err(json, res, req, 400, out.error), true;
    json(res, 200, { message: withPreviews([out.message], s)[0] }, req);
    // Famili reads the message after it is answered, never before: suggestions land on
    // the record a few seconds later and show up on the next poll.
    if (out.message.kind === "text" && out.message.text) {
      setImmediate(() => { void import("./message-suggestions.mjs").then((mod) => mod.suggestForMessage({ message: out.message, session: s })).catch(() => {}); });
    }
    return true;
  }
  if (rest === "read" && method === "POST") { markRead(threadId, s.actorId); json(res, 200, { ok: true }, req); return true; }
  if (rest === "typing" && method === "POST") { if (active) setTyping(s.householdId, threadId, s.actorId); json(res, 200, { ok: true }, req); return true; }
  if (rest === "mute" && method === "POST") {
    const body = await readBody(req); if (!body) return err(json, res, req, 400, "malformed_json"), true;
    const out = setMute(threadId, s.actorId, body.until ?? null);
    json(res, 200, { thread: publicThread(out ?? t, s.actorId) }, req);
    return true;
  }
  if (rest === "members" && method === "POST") {
    const body = await readBody(req); if (!body) return err(json, res, req, 400, "malformed_json"), true;
    const out = await addMember(threadId, s.actorId, String(body.actorId ?? ""));
    if (!out.ok) return err(json, res, req, out.error === "insufficient_role" || out.error === "cannot_message" ? 403 : 400, out.error, { reason: out.reason, whoName: out.whoName, message: out.message }), true;
    audit({ type: "thread.add_member", threadId, added: body.actorId, ok: true }, req, s);
    json(res, 200, { thread: publicThread(out.thread, s.actorId) }, req);
    return true;
  }
  const rm = rest.match(/^members\/([^/]+)$/);
  if (rm && method === "DELETE") {
    const out = await removeMember(threadId, s.actorId, rm[1]);
    if (!out.ok) return err(json, res, req, out.error === "insufficient_role" ? 403 : 400, out.error, { message: out.message }), true;
    audit({ type: "thread.remove_member", threadId, removed: rm[1], ok: true }, req, s);
    json(res, 200, { thread: publicThread(out.thread, s.actorId) }, req);
    return true;
  }
  if (rest === "leave" && method === "POST") {
    const out = await leaveThread(threadId, s.actorId);
    if (!out.ok) return err(json, res, req, 400, out.error), true;
    json(res, 200, { thread: publicThread(out.thread, s.actorId) }, req);
    return true;
  }
  const mm = rest.match(/^messages\/([^/]+)(?:\/(reactions|suggestions\/([^/]+)))?$/);
  if (mm) {
    const [, messageId, sub, suggestionId] = mm;
    if (!sub && method === "PATCH") {
      const body = await readBody(req); if (!body) return err(json, res, req, 400, "malformed_json"), true;
      const out = editMessage(threadId, messageId, s.actorId, body.text);
      if (!out.ok) return err(json, res, req, out.error === "not_sender" ? 403 : 400, out.error), true;
      json(res, 200, { message: withPreviews([out.message], s)[0] }, req);
      return true;
    }
    if (!sub && method === "DELETE") {
      const out = deleteMessage(threadId, messageId, s.actorId);
      if (!out.ok) return err(json, res, req, out.error === "not_sender" ? 403 : 400, out.error), true;
      json(res, 200, { message: out.message }, req);
      return true;
    }
    if (sub === "reactions" && method === "POST") {
      const body = await readBody(req); if (!body) return err(json, res, req, 400, "malformed_json"), true;
      const out = toggleReaction(threadId, messageId, s.actorId, body.emoji);
      if (!out.ok) return err(json, res, req, 400, out.error), true;
      json(res, 200, { message: withPreviews([out.message], s)[0] }, req);
      return true;
    }
    if (suggestionId && method === "POST") {
      const body = await readBody(req); if (!body) return err(json, res, req, 400, "malformed_json"), true;
      const { applySuggestion } = await import("./message-suggestions.mjs");
      const out = await applySuggestion({ threadId, messageId, suggestionId, session: s, action: body.action === "dismiss" ? "dismiss" : "apply" });
      if (!out.ok) return err(json, res, req, out.error === "already_taken" ? 409 : 400, out.error, { message: out.message, suggestion: out.suggestion }), true;
      audit({ type: "thread.suggestion", threadId, messageId, suggestionId, action: body.action, ok: true }, req, s);
      json(res, 200, out, req);
      return true;
    }
  }
  return false;
}
