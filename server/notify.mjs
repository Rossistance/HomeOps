// HomeOps AI — push notifications (Expo). Shared by the run engine (so a run that
// parks for approval notifies the household even with NO browser open) and by the
// HTTP layer (API-created approvals). Fire-and-forget; never throws.
import { getPushTokens, addNotification, appendAudit } from "./store.mjs";
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
 * Never throws. Returns { ok, channel, delivered, needsSetup?, message }. */
const CHANNEL_FOR = { "In-App": "in_app", "Family Dashboard": "dashboard", Email: "email", "Phone/Text": "sms" };

export async function deliverNotification({ session, methodType, to, title, body }) {
  const channel = CHANNEL_FOR[methodType] ?? methodType;
  const text = String(body ?? "").slice(0, 2000);
  const subject = String(title ?? "HomeOps").slice(0, 140);
  try {
    if (channel === "in_app" || channel === "dashboard") {
      const rec = addNotification({ householdId: session.householdId, actorId: session.actorId, channel, title: subject, body: text, to: to ?? null });
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
