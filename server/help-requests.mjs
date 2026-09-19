// FamiliOS — "Can you help?" between two members, as one function.
//
// The HTTP route and a message suggestion both create help requests; the rule (a current
// recipient, a message, no duplicate pending ask for the same task) and the two-person
// notification live here so neither path can drift from the other.
import crypto from "node:crypto";
import { getMember, listHelpRequests, putHelpRequest, addNotification } from "./store.mjs";
import { pushToMember } from "./notify.mjs";

/**
 * @returns {{ ok: true, helpRequest } | { ok: false, status: number, error: string, message: string, helpRequest? }}
 */
/**
 * `proposal` (optional) is what a YES does: { threadId, messageId, eventId, patch } — the event
 * change applied on accept (a driver, an added participant), and the chat to report back into.
 */
export function createHelpRequest({ session, toActorId, message, kind = "ask", eventId = null, taskId = null, proposal = null }) {
  const to = getMember(String(toActorId ?? ""));
  if (!to || to.archived || to.householdId !== session.householdId) return { ok: false, status: 400, error: "bad_recipient", message: "Pick a current household member to ask." };
  const text = String(message ?? "").trim().slice(0, 500);
  if (!text) return { ok: false, status: 400, error: "message_required", message: "Say what you need help with." };
  const k = kind === "offer" ? "offer" : "ask";
  // WP-001 (ISS-009 root): a duplicate PENDING request for the same (taskId, recipient)
  // piled up records that rendered as duplicate cards; 409 returns the existing one.
  if (taskId) {
    const existing = listHelpRequests((h) => h.householdId === session.householdId && h.status === "pending" && h.taskId === taskId && h.toActorId === to.actorId);
    if (existing.length) return { ok: false, status: 409, error: "duplicate_request", message: `${to.displayName} was already asked about this — waiting on their answer.`, helpRequest: existing[0] };
  }
  const fromName = getMember(session.actorId)?.displayName ?? session.actorId;
  const hr = putHelpRequest({
    id: "hr_" + crypto.randomBytes(8).toString("hex"), householdId: session.householdId,
    fromActorId: session.actorId, fromName, toActorId: to.actorId, toName: to.displayName,
    kind: k, message: text, eventId: eventId ?? null, taskId: taskId ?? null,
    ...(proposal && typeof proposal === "object" ? { proposal } : {}),
    status: "pending", responseNote: null, createdAt: new Date().toISOString(), respondedAt: null,
  });
  const nTitle = k === "offer" ? "Help offered" : "Can you help?";
  const nBody = k === "offer" ? `${fromName} offered to help: ${text}` : `${fromName}: ${text}`;
  addNotification({ householdId: session.householdId, actorId: to.actorId, channel: "in_app", title: nTitle, body: nBody, source: { kind: "member", id: session.actorId, name: fromName }, data: { type: "help_request", id: hr.id } });
  void pushToMember({ householdId: session.householdId, actorId: to.actorId, title: nTitle, body: nBody, data: { type: "help_request", id: hr.id } });
  return { ok: true, helpRequest: hr };
}
