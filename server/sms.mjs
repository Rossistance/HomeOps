// Two-way SMS gateway: family members TEXT FamiliOS and get the assistant's answer
// back in the same message thread. Twilio delivers inbound texts to
// POST /api/webhooks/sms; we validate Twilio's signature, match the sender against
// the contact-methods registry (VERIFIED + OPTED-IN phone methods only — strangers
// get silence), run the message through the same assistant brain as Ask FamiliOS,
// persist the exchange to a durable per-member SMS conversation, and reply via
// TwiML. Approval-gated actions never execute from a text: the reply says the plan
// is drafted and waiting in the app — same approval-first model as everywhere else.
import crypto from "node:crypto";
import {
  listContactMethods, getMember, listConversations, putConversation,
  appendConversationMessage, getSecret,
} from "./store.mjs";
import { assistantRespond } from "./planner.mjs";

/** The auth token also signs Twilio's webhooks (X-Twilio-Signature). */
export function twilioAuthToken() {
  return process.env.TWILIO_AUTH_TOKEN || getSecret("sms", "authToken") || null;
}

/** Twilio signature: HMAC-SHA1(base64) over the exact webhook URL + POST params
 *  concatenated as name+value in alphabetical name order. */
export function twilioSignature(url, params, authToken) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function twilioSignatureValid({ url, params, authToken, signature }) {
  if (!authToken || !signature) return false;
  const expected = twilioSignature(url, params, authToken);
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Compare phone numbers by their trailing 10 digits (US-centric but tolerant of
 *  +1 / formatting differences between Twilio's E.164 and hand-entered methods). */
export function samePhone(a, b) {
  const da = String(a ?? "").replace(/\D/g, ""), db = String(b ?? "").replace(/\D/g, "");
  if (da.length < 7 || db.length < 7) return false;
  return da.slice(-10) === db.slice(-10);
}

/** Resolve an inbound sender to a household member: a VERIFIED, OPTED-IN
 *  Phone/Text contact method matching the From number. Anything else → null. */
export function resolveSmsSender(from) {
  const method = listContactMethods((m) =>
    m.type === "Phone/Text" && m.verified === true && m.optInStatus === "Opted In" && samePhone(m.value, from),
  )[0];
  if (!method) return null;
  const member = getMember(method.memberId);
  if (!member || member.archived) return null;
  return { method, member };
}

/** Find (or create) the member's durable SMS thread — the same server-owned
 *  conversation model the web/mobile chat uses, so the history shows up there too. */
export function smsConversationFor(member, householdId) {
  const existing = listConversations((c) =>
    c.householdId === householdId && c.actorId === member.actorId && c.channel === "sms",
  )[0];
  if (existing) return existing;
  return putConversation({
    id: "conv_" + crypto.randomBytes(8).toString("hex"),
    householdId, actorId: member.actorId, channel: "sms",
    title: "Text messages", messages: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
}

const SMS_MAX = 1500; // ~10 segments; Twilio splits long bodies automatically

/** Turn an assistant result into an SMS-sized, honest reply. */
export function smsReplyText(out) {
  if (!out.ok) {
    return out.error === "no_provider"
      ? "FamiliOS here — I can't think right now (no AI provider is connected). An adult can add one in Settings → AI Providers."
      : "FamiliOS here — something went wrong on my end. Try again in a bit, or use the app.";
  }
  if (out.kind === "plan" && out.plan) {
    const title = out.plan.title ?? "a plan";
    return `I drafted “${title}” for you. Actions that touch the outside world need sign-off, so open FamiliOS → Messages & Approvals to review and run it.`;
  }
  if (out.kind === "build" && out.build) {
    return "I can build that! Open FamiliOS → Ask to review what I proposed and confirm — I don't create new helpers from text alone.";
  }
  const text = String(out.answer ?? "").trim() || "I didn't have anything useful to say — try rephrasing?";
  return text.length > SMS_MAX ? text.slice(0, SMS_MAX - 1) + "…" : text;
}

/**
 * Handle a validated inbound SMS. Returns { replyText, conversationId } — the
 * caller renders TwiML. The assistant runs AS the sender (their role gates the
 * tool catalog exactly like a signed-in session).
 */
export async function handleInboundSms({ from, body }) {
  const sender = resolveSmsSender(from);
  if (!sender) return { replyText: null, unknownSender: true };
  const { member } = sender;
  const householdId = member.householdId ?? "local";
  const conv = smsConversationFor(member, householdId);
  const session = { actorId: member.actorId, actorName: member.displayName ?? member.actorId, role: member.role, householdId };
  const at = new Date().toISOString();
  appendConversationMessage(conv.id, { role: "user", text: String(body), channel: "sms", at });
  const out = await assistantRespond({ message: String(body), session });
  const replyText = smsReplyText(out);
  appendConversationMessage(conv.id, out.ok
    ? { role: "assistant", kind: out.kind, text: out.kind === "answer" ? (out.answer ?? "") : replyText, plan: out.plan ?? null, build: out.build ?? null, model: out.model ?? null, channel: "sms", at }
    : { role: "assistant", kind: "error", text: replyText, error: out.error ?? "assistant_error", channel: "sms", at });
  return { replyText, conversationId: conv.id, actorId: member.actorId, kind: out.ok ? out.kind : "error" };
}

const escapeXml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));

/** TwiML: replying in the SAME thread is just answering the webhook with a Message. */
export function twiml(replyText) {
  return replyText
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(replyText)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}
