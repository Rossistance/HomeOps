// FamiliOS AI — push notifications (Expo). Shared by the run engine (so a run that
// parks for approval notifies the household even with NO browser open) and by the
// HTTP layer (API-created approvals). Fire-and-forget; never throws.
import { getPushTokens, addNotification, appendAudit, getContactMethod } from "./store.mjs";
import { listAccountsFor } from "./accounts.mjs";
import { apiForAccount } from "./oauth.mjs";
import { executeTool, listConnectors, readinessOf } from "./connectors.mjs";

export async function pushApprovalNotification(approval) {
  try {
    const tokens = getPushTokens();
    if (!tokens.length) return { ok: false, reason: "no_tokens" };
    const body = `${approval.toolId ?? "Action"}${approval.preview ? " — " + String(approval.preview).slice(0, 80) : ""}`;
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(tokens.map((to) => ({ to, title: "Approval needed", body, data: { type: "approval", id: approval.id }, sound: "default", badge: 1 }))),
    });
    return { ok: true, sent: tokens.length };
  } catch {
    return { ok: false, reason: "send_failed" };
  }
}

/* ---- Notification delivery to a contact method (item 16b) ----
 * Real routing per channel, honest about what's actually available:
 *   • in_app / dashboard → always works (durable notification record the app shows)
 *   • email              → gmail.send via the household's connected Google account
 *   • sms  (Phone/Text)  → the sms.send connector, if configured/ready
 * Never throws. Returns { ok, channel, delivered, needsSetup?, message }.
 *
 * Callers pass EITHER a methodId (resolved from the server-owned contact-methods
 * registry — the canonical path) or an ad-hoc methodType/to pair (kept for
 * back-compat and free-form sends). Registry resolution is fail-closed: an
 * unverified or not-opted-in method never sends, and when an agentId is supplied
 * the method's per-agent allowlist is enforced. */
const CHANNEL_FOR = { "In-App": "in_app", "Family Dashboard": "dashboard", Email: "email", "Phone/Text": "sms" };
const EXTERNAL_TYPES = ["Email", "Phone/Text"];

export async function deliverNotification({ session, methodId, methodType, to, title, body, agentId }) {
  let method = null;
  if (methodId) {
    method = getContactMethod(methodId);
    if (!method || method.householdId !== session.householdId) {
      return { ok: false, channel: null, delivered: false, error: "method_not_found", message: "That contact method doesn't exist." };
    }
    const ch = CHANNEL_FOR[method.type] ?? method.type;
    if (!method.verified) {
      return { ok: false, channel: ch, delivered: false, error: "method_not_verified", message: `“${method.label}” isn't verified yet — verify it before sending.` };
    }
    if (method.optInStatus !== "Opted In") {
      return { ok: false, channel: ch, delivered: false, error: "method_not_opted_in", message: `“${method.label}” hasn't opted in to receiving messages.` };
    }
    if (agentId && !(method.allowedAgentIds ?? []).includes(agentId)) {
      return { ok: false, channel: ch, delivered: false, error: "agent_not_allowed", message: "This agent isn't allowed to message that contact method." };
    }
    methodType = method.type;
    to = EXTERNAL_TYPES.includes(method.type) ? method.value : null;
  }
  return deliverViaChannel({
    session,
    channel: CHANNEL_FOR[methodType] ?? methodType,
    to,
    subject: title,
    body,
    // A registry-resolved method delivers to the method's OWNER (that's who the
    // address belongs to); the ad-hoc path keeps notifying the calling actor.
    recipientActorId: method?.memberId ?? session.actorId,
  });
}

/* Deliver a verification code through a contact method's REAL channel. This is the
 * ONE path allowed to reach a not-yet-verified method — proving control of the
 * address is exactly what the code is for. Same honest channel routing as any
 * other delivery: if the channel isn't set up, it says so and nothing is sent. */
export async function sendVerificationCode({ session, method, code }) {
  return deliverViaChannel({
    session,
    channel: CHANNEL_FOR[method.type] ?? method.type,
    to: EXTERNAL_TYPES.includes(method.type) ? method.value : null,
    subject: "Your FamiliOS verification code",
    body: `Your FamiliOS verification code for “${method.label}” is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore it.`,
    recipientActorId: method.memberId,
  });
}

async function deliverViaChannel({ session, channel, to, subject: rawSubject, body, recipientActorId }) {
  const text = String(body ?? "").slice(0, 2000);
  const subject = String(rawSubject ?? "FamiliOS").slice(0, 140);
  try {
    if (channel === "in_app" || channel === "dashboard") {
      const rec = addNotification({ householdId: session.householdId, actorId: recipientActorId ?? session.actorId, channel, title: subject, body: text, to: to ?? null });
      appendAudit({ type: "notify.deliver", channel, ok: true, householdId: session.householdId });
      return { ok: true, channel, delivered: true, notificationId: rec.id, message: "Shown in the app." };
    }
    if (channel === "email") {
      if (!to) return { ok: false, channel, delivered: false, message: "No email address on this contact method." };
      const account = listAccountsFor(session.householdId, session.actorId).find((a) => a.provider === "google");
      if (!account) return { ok: false, channel, delivered: false, needsSetup: "google", message: "Connect a Google account (with Send email) in Connections to deliver by email." };
      if (!(account.scopes ?? []).some((s) => /gmail\.send|mail\.google/i.test(String(s)))) return { ok: false, channel, delivered: false, needsSetup: "gmail.send", message: "Reconnect Google and grant the Send email permission." };
      const api = apiForAccount(account);
      const raw = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}`, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const r = await api("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ raw }) });
      const ok = !!r.ok;
      appendAudit({ type: "notify.deliver", channel, ok, householdId: session.householdId });
      return ok ? { ok: true, channel, delivered: true, message: `Emailed ${to}.` } : { ok: false, channel, delivered: false, message: r.json?.error?.message ?? "Gmail rejected the send." };
    }
    if (channel === "sms") {
      if (!to) return { ok: false, channel, delivered: false, message: "No phone number on this contact method." };
      const sms = listConnectors().find((c) => c.id === "sms");
      if (!sms || !["configured", "connected", "ready", "healthy"].includes(readinessOf(sms))) {
        return { ok: false, channel, delivered: false, needsSetup: "sms", message: "Configure the Text Messaging connector (Twilio) in Connections to deliver by text." };
      }
      const r = await executeTool("sms.send", { to, body: text }, { actorId: session.actorId, requestId: "notify", approvalConsumed: true });
      const ok = !!r?.ok;
      appendAudit({ type: "notify.deliver", channel, ok, householdId: session.householdId });
      return ok ? { ok: true, channel, delivered: true, message: `Texted ${to}.` } : { ok: false, channel, delivered: false, message: r?.message ?? r?.error ?? "Text send failed." };
    }
    return { ok: false, channel, delivered: false, message: `Unknown channel: ${channel}` };
  } catch (e) {
    return { ok: false, channel, delivered: false, message: String(e?.message ?? e) };
  }
}
