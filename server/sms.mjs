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
  appendConversationMessage, getSecret, patchContactMethod, appendAudit,
} from "./store.mjs";
import { assistantRespond } from "./planner.mjs";

/* ---------------------------- carrier keyword handling ----------------------------
 * Every A2P 10DLC and toll-free campaign asserts that a recipient can text STOP to stop
 * and HELP for help. FamiliOS asserted exactly that in its campaign submission and did NOT
 * implement it: the inbound handler passed the whole body straight to the assistant, so
 * "STOP" was answered by an LLM and the contact method stayed "Opted In" forever. A
 * reviewer who tests the flow finds it broken, which is an independent rejection cause on
 * top of the entity classification — and a family who asks to be left alone keeps getting
 * texts. This is the fix.
 *
 * Keyword sets follow Twilio's Advanced Opt-Out standard keywords, which are what carriers
 * enforce. STOP, START and UNSTOP are reserved and non-removable on Twilio's side; on
 * toll-free senders only START/UNSTOP undo a block (YES does not), which is why YES is
 * accepted here as a courtesy but the HELP text names START.
 *
 * Division of labour: Twilio blocks the TRANSPORT (and, with Advanced Opt-Out enabled on
 * the Messaging Service, may answer before we ever see the message). This handler keeps
 * FamiliOS's OWN registry honest, so notify.mjs stops trying to reach someone who left and
 * the audit log can evidence that every opt-out was honoured the moment it arrived. Both
 * layers are wanted; neither substitutes for the other. */
const OPT_OUT_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"]);
const OPT_IN_WORDS = new Set(["start", "unstop", "yes"]);
const HELP_WORDS = new Set(["help", "info"]);

/** Carriers match a keyword when it is the WHOLE message, and so do we. "help me plan
 *  dinner" is a request for the assistant; "HELP" is a compliance keyword. Surrounding
 *  punctuation and case are ignored; anything longer than one word is not a keyword. */
export function classifySmsKeyword(body) {
  const word = String(body ?? "").trim().toLowerCase().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
  if (!word || /\s/.test(word)) return null;
  if (OPT_OUT_WORDS.has(word)) return "opt_out";
  if (OPT_IN_WORDS.has(word)) return "opt_in";
  if (HELP_WORDS.has(word)) return "help";
  return null;
}

/** Every Phone/Text method matching this number, WHATEVER its consent state.
 *
 * resolveSmsSender() deliberately requires verified + opted-in, which is right for running
 * the assistant. It is wrong for keywords: an opted-OUT person could never text START to
 * come back, and an unverified number's STOP would be ignored. Consent withdrawal must not
 * depend on the state it is withdrawing from. One number can also map to more than one
 * member (a shared family phone), and a STOP applies to all of them. */
export function smsMethodsForNumber(from) {
  return listContactMethods((m) => m.type === "Phone/Text" && samePhone(m.value, from));
}

const SUPPORT_EMAIL = process.env.HOMEOPS_SUPPORT_EMAIL || "budgetbeacon.ai@gmail.com";
const PUBLIC_URL = (process.env.HOMEOPS_PUBLIC_URL || "https://homeops-ai.onrender.com").replace(/\/+$/, "");

/** The HELP reply carries what CTIA asks a help response to carry: who this is, what the
 *  programme does, that rates may apply, how to leave, and a human to contact. */
export function smsHelpText() {
  return `FamiliOS: your household assistant. Text a question and I'll answer; reminders arrive only for things your family set up. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, START to opt back in. Help: ${SUPPORT_EMAIL} ${PUBLIC_URL}/terms.html`;
}

/**
 * Apply a compliance keyword. Returns { replyText, action } — or null when the keyword
 * doesn't apply to this sender, so the caller can fall through to normal handling.
 *
 * Unknown numbers get null (silence), matching the stranger policy everywhere else in this
 * module: answering would confirm whether a number is registered to a household. Twilio's
 * own standard keyword handling covers the carrier obligation for numbers we don't know.
 */
export function applySmsKeyword({ kind, from }) {
  const methods = smsMethodsForNumber(from);
  if (methods.length === 0) return null;

  if (kind === "opt_out") {
    const changed = [];
    for (const m of methods) {
      if (m.optInStatus === "Opted Out") continue;
      patchContactMethod(m.id, { optInStatus: "Opted Out", optOutAt: new Date().toISOString(), optOutVia: "sms_keyword", updatedAt: new Date().toISOString() });
      changed.push(m.id);
    }
    appendAudit({ type: "sms.opt_out", from, methodIds: methods.map((m) => m.id), changed, householdId: methods[0].householdId });
    return {
      action: "opt_out", changed, memberId: methods[0].memberId, householdId: methods[0].householdId,
      replyText: "You're unsubscribed from FamiliOS texts and won't get any more. Reply START to turn them back on.",
    };
  }

  if (kind === "opt_in") {
    // Re-subscribing is only ever a RESTORE of a consent that was verified once. A texted
    // START must not be able to manufacture consent for a number nobody proved they own —
    // that is the same rule that stopped seed data shipping pre-verified in seed.mjs.
    const verified = methods.filter((m) => m.verified === true);
    if (verified.length === 0) {
      appendAudit({ type: "sms.opt_in_refused", from, reason: "unverified", methodIds: methods.map((m) => m.id), householdId: methods[0].householdId });
      return {
        action: "opt_in_refused", changed: [], memberId: methods[0].memberId, householdId: methods[0].householdId,
        replyText: "This number isn't verified yet, so I can't turn texts on from here. An adult can add and verify it in FamiliOS → Settings → Contacts.",
      };
    }
    const changed = [];
    for (const m of verified) {
      if (m.optInStatus === "Opted In") continue;
      patchContactMethod(m.id, { optInStatus: "Opted In", optOutAt: null, optInVia: "sms_keyword", updatedAt: new Date().toISOString() });
      changed.push(m.id);
    }
    appendAudit({ type: "sms.opt_in", from, methodIds: verified.map((m) => m.id), changed, householdId: methods[0].householdId });
    return {
      action: "opt_in", changed, memberId: verified[0].memberId, householdId: methods[0].householdId,
      replyText: "You're subscribed to FamiliOS texts again. Reply STOP any time to opt out, HELP for help.",
    };
  }

  if (kind === "help") {
    appendAudit({ type: "sms.help", from, householdId: methods[0].householdId });
    return { action: "help", changed: [], replyText: smsHelpText(), memberId: methods[0].memberId, householdId: methods[0].householdId };
  }

  return null;
}

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
  // COMPLIANCE KEYWORDS FIRST. A STOP is a legal instruction, not a conversational turn:
  // it must be honoured before any model sees it, must work for a sender who is opted out
  // or unverified (and so unresolvable below), and must never depend on an AI provider
  // being configured. START and HELP ride the same path for the same reason.
  const keyword = classifySmsKeyword(body);
  if (keyword) {
    const applied = applySmsKeyword({ kind: keyword, from });
    if (!applied) return { replyText: null, unknownSender: true };
    // Thread it into the member's own conversation when we can attribute it, so the family
    // can see in the app that the opt-out happened and exactly when.
    let conversationId = null;
    const member = applied.memberId ? getMember(applied.memberId) : null;
    if (member && !member.archived) {
      const conv = smsConversationFor(member, member.householdId ?? applied.householdId ?? "local");
      const at = new Date().toISOString();
      appendConversationMessage(conv.id, { role: "user", text: String(body), channel: "sms", at });
      appendConversationMessage(conv.id, { role: "assistant", kind: "status", text: applied.replyText, channel: "sms", at });
      conversationId = conv.id;
    }
    return { replyText: applied.replyText, conversationId, actorId: member?.actorId ?? null, kind: "keyword", keyword, action: applied.action };
  }

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
