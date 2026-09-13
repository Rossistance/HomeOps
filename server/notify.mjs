// FamiliOS AI — push notifications (Expo). Shared by the run engine (so a run that
// parks for approval notifies the household even with NO browser open) and by the
// HTTP layer (API-created approvals). Fire-and-forget; never throws.
import { getPushTokens, addNotification, appendAudit, getContactMethod, getMember, listMembers, canApprove, getSettings, getAgent } from "./store.mjs";
import { listAccountsFor } from "./accounts.mjs";
import { apiForAccount } from "./oauth.mjs";
import { executeTool, listConnectors, readinessOf } from "./connectors.mjs";
import { sendPlatformEmail, platformMailReady } from "./mailer.mjs";

// Who should be pinged for THIS approval. A personal action (or one the requester can
// approve themselves) notifies only the requester — a scheduled personal briefing must
// not fan out to the whole household. A request the requester CAN'T approve (e.g. a child
// asking for something) notifies the household's allowed approvers.
function externalActionsEnabled(householdId) {
  try { return getSettings(householdId).externalActionsEnabled !== false; } catch { return true; }
}

export function approvalAudience(approval) {
  const requester = approval.requestedBy ?? approval.actorId ?? null;
  const ids = new Set();
  if (requester) ids.add(requester);
  const requesterMember = requester ? getMember(requester) : null;
  const requesterCanApprove = !!requesterMember && canApprove(approval, { role: requesterMember.role, actorId: requester });
  let broad = false;
  if (approval.visibility !== "personal" && !requesterCanApprove) {
    broad = true;
    for (const m of listMembers({ householdId: approval.householdId ?? "local" })) {
      if (m.archived) continue;
      if (canApprove(approval, { role: m.role, actorId: m.actorId })) ids.add(m.actorId);
    }
  }
  return { ids, broad };
}

// The device tokens an approval notification actually goes to — exported so tests
// can assert the audience without a real Expo send.
export function approvalPushTokens(approval) {
  const { ids, broad } = approvalAudience(approval);
  const hh = approval.householdId ?? "local";
  return getPushTokens()
    .filter((r) => {
      if (r.householdId != null && r.householdId !== hh) return false;
      // Legacy tokens (no owner recorded) only ride along when broadcasting to approvers,
      // so a personal/self-approval never reaches a device we can't attribute.
      if (r.actorId == null) return broad;
      return ids.has(r.actorId);
    })
    .map((r) => r.token);
}

export async function pushApprovalNotification(approval) {
  try {
    const tokens = approvalPushTokens(approval);
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

/* ---- Targeted Expo push to ONE member's device(s) ----
 * Used by help requests (and anything else person-to-person): only tokens owned by
 * that actor in that household are sent to — never legacy/unattributed tokens, so a
 * personal ping can't reach a device we can't attribute. Fire-and-forget; never throws. */
export async function pushToMember({ householdId, actorId, title, body, data, timeSensitive = false }) {
  try {
    const hh = householdId ?? "local";
    // A removed member's devices keep their tokens until they re-register; the archive
    // route clears them, and this guard covers a token that slipped through.
    if (getMember(actorId)?.archived) return { ok: false, reason: "member_archived" };
    const tokens = getPushTokens()
      .filter((r) => (r.householdId == null || r.householdId === hh) && r.actorId === actorId)
      .map((r) => r.token);
    if (!tokens.length) return { ok: false, reason: "no_tokens" };
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      /* Cluster N — "the priority to get this notification needs to be on high… it will
       * still ring on high." Expo maps priority:"high" to APNs high priority, and
       * interruptionLevel:"timeSensitive" is what lets iOS surface a reminder through a
       * Focus mode WHEN the user has granted the app Time Sensitive notifications — the
       * capability is theirs to grant, so this is a request, not a promise to bypass
       * silence. Only reminders ask for it; ordinary chatter must not cry wolf. */
      body: JSON.stringify(tokens.map((to) => ({
        to, title, body: String(body ?? "").slice(0, 160), data: data ?? {}, sound: "default", badge: 1,
        ...(timeSensitive ? { priority: "high", interruptionLevel: "timeSensitive" } : {}),
      }))),
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
// Channels that actually leave the house — the ones the kill switch must govern.
const EXTERNAL_CHANNELS = ["email", "sms"];

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
    // The address may still be verified and opted in, but the PERSON has left the household.
    if (method.memberId && getMember(method.memberId)?.archived) {
      return { ok: false, channel: ch, delivered: false, error: "member_archived", message: `“${method.label}” belongs to a member who was removed from the household.` };
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
    // WP-005 — WHOSE MAILBOX SENDS IT. A scheduled fire runs as the "scheduler" system
    // actor, which owns no Google account, so an unattended send would have failed
    // "not connected" even with everything correctly configured. Accounts are per-actor
    // by design, so the agent's OWNER is the honest sending identity — the person who
    // built the helper and granted it the allowlist in the first place.
    senderActorIds: [session.actorId, ...(agentId ? [getAgent(agentId)?.createdBy].filter(Boolean) : [])],
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

/* ---- D1/D2: the recovery code, sent BEFORE anyone is signed in ----
 * [01:32] "Forgot password — it should send an email with a recovery code."
 * [01:46] "And forgot email, or forgot username."
 *
 * Both are pre-auth, so there is no session to send as. What there IS, on the identity
 * record, is the household and actor the account belongs to — which is enough to reach that
 * household's own connected Google account, the only email transport this deployment has.
 *
 * The caller must NOT change its response based on what happens here: telling someone
 * "no account with that email" is account enumeration. So this reports honestly to the
 * AUDIT LOG and lets the route answer the same 200 either way.
 */
export async function sendRecoveryCode({ householdId, actorId, email, code, kind = "password" }) {
  const subject = kind === "email" ? "Your FamiliOS sign-in email" : "Your FamiliOS recovery code";
  const body = kind === "email"
    ? `You asked which email your FamiliOS account uses. It's ${email}.

If you didn't ask for this, you can ignore it — nothing about your account has changed.`
    : `Your FamiliOS recovery code is ${code}.

It expires in 15 minutes and can be used once. If you didn't ask to reset your password, you can ignore this — your password hasn't changed.`;
  // PLATFORM TRANSPORT FIRST, and deliberately NOT behind the household kill switch.
  //
  // This is the message that lets someone back into their own account, and routing it
  // through the household's Gmail made it circular: the households that need it most are
  // the new ones, which have no Google connection yet and cannot make one without signing
  // in. It also sat behind "pause external actions", so a family that flipped that switch
  // had quietly locked itself out of password reset with no way back.
  //
  // The kill switch governs the HOUSEHOLD acting on the world. A recovery code is FamiliOS
  // talking to a registered account holder about their own credentials — not a household
  // action, and not something a household setting should be able to withhold from its own
  // members. Audited distinctly (transport: "platform") so the bypass is visible.
  if (platformMailReady()) {
    const p = await sendPlatformEmail({ to: email, subject, text: body });
    appendAudit({
      type: "identity.recovery_send", kind, householdId, transport: "platform", ok: !!p.ok,
      ...(p.ok ? {} : { error: p.error ?? "send_failed", detail: p.message }),
    });
    if (p.ok) return { ok: true, channel: "email", delivered: true, transport: "platform", message: `Emailed ${email}.` };
    // fall through: a configured-but-failing platform sender should still try the household's
    // own transport rather than stranding the person.
  }
  const out = await deliverViaChannel({
    session: { householdId, actorId },
    channel: "email",
    to: email,
    subject,
    body,
    recipientActorId: actorId,
  });
  appendAudit({
    type: "identity.recovery_send", kind, householdId, transport: "household", ok: !!out.ok,
    ...(out.ok ? {} : { error: out.needsSetup ?? "send_failed", detail: out.message }),
  });
  return out;
}

/* ---- WP-002 slice 3 — in-app delivery fallback (item 16b follow-up) ----
 * homeops.notify_contact (internal-functions.mjs) used to hard-refuse whenever the
 * requested recipient had no REGISTERED contact method — there is nowhere off-device
 * to reach them. That refusal meant a plain, unsetup chat ask ("let mom know I'll be
 * late") did NOTHING at all; the requester didn't even get the honesty of a result.
 *
 * This reuses deliverViaChannel's existing in_app write path (the exact one a
 * registered "In-App" contact method already resolves to) to show the message to the
 * REQUESTER — the one person guaranteed reachable right now, since they're
 * mid-conversation — instead of to the unregistered target. It is a fallback, not a
 * bypass: it can ONLY ever write the in_app channel (never email/sms), so it can never
 * touch the verified/opted-in/allowlist gates that guard real external sends, and it
 * is not reachable from any other path. Every use is audited distinctly
 * (notify.delivered_inapp) so it's never confused with a real off-device delivery. */
export async function deliverInAppFallback({ session, title, body }) {
  const out = await deliverViaChannel({ session, channel: "in_app", to: null, subject: title, body, recipientActorId: session.actorId });
  if (out.ok && out.delivered) {
    appendAudit({ type: "notify.delivered_inapp", householdId: session.householdId, actorId: session.actorId });
  }
  return out;
}

async function deliverViaChannel({ session, channel, to, subject: rawSubject, body, recipientActorId, senderActorIds }) {
  const text = String(body ?? "").slice(0, 2000);
  const subject = String(rawSubject ?? "FamiliOS").slice(0, 140);
  try {
    // WP-005 SECURITY — KILL SWITCH COVERAGE. The household's "pause external actions"
    // switch was enforced in the engine's provider-tool path and inside the sms
    // connector, but the EMAIL branch below called Gmail directly and never consulted
    // it. That gap did not matter while nothing could reach this path unattended; the
    // moment homeops.notify_contact makes it schedulable, an un-honored kill switch
    // becomes a family flipping "stop" and mail going out anyway. Checked here, once,
    // for every external channel — including the verification-code path.
    if (EXTERNAL_CHANNELS.includes(channel) && !externalActionsEnabled(session?.householdId)) {
      appendAudit({ type: "notify.blocked_by_kill_switch", channel, householdId: session?.householdId });
      return { ok: false, channel, delivered: false, error: "external_actions_disabled", message: "External actions are paused by the household kill switch — nothing was sent. Turn them back on in Settings to allow this." };
    }
    if (channel === "in_app" || channel === "dashboard") {
      const rec = addNotification({ householdId: session.householdId, actorId: recipientActorId ?? session.actorId, channel, title: subject, body: text, to: to ?? null });
      appendAudit({ type: "notify.deliver", channel, ok: true, householdId: session.householdId });
      return { ok: true, channel, delivered: true, notificationId: rec.id, message: "Shown in the app." };
    }
    if (channel === "email") {
      if (!to) return { ok: false, channel, delivered: false, message: "No email address on this contact method." };
      if (!text.trim()) return { ok: false, channel, delivered: false, message: "Nothing to send — the message body was empty." };
      // Try the acting actor first, then the fallback identities (the agent's owner)
      // — first Google account found wins.
      const candidates = [...new Set([session.actorId, ...(senderActorIds ?? [])].filter(Boolean))];
      let account = null;
      for (const actorId of candidates) {
        account = listAccountsFor(session.householdId, actorId).find((a) => a.provider === "google");
        if (account) break;
      }
      if (!account) {
        // No Google connection. Rather than refuse outright — which is what a brand-new
        // household always got, since it cannot have one yet — fall back to the platform
        // sender when the deployment has one. Audited as a distinct transport so nobody
        // later mistakes a noreply@ delivery for mail the family sent themselves.
        if (platformMailReady()) {
          const p = await sendPlatformEmail({ to, subject, text });
          appendAudit({ type: "notify.deliver", channel, transport: "platform", ok: !!p.ok, householdId: session.householdId, ...(p.ok ? {} : { error: p.error }) });
          return p.ok
            ? { ok: true, channel, delivered: true, transport: "platform", message: `Emailed ${to} from FamiliOS.` }
            : { ok: false, channel, delivered: false, needsSetup: "google", message: `Couldn't send: ${p.message} Connect a Google account (with Send email) in Connections to send as your household instead.` };
        }
        return { ok: false, channel, delivered: false, needsSetup: "google", message: "Connect a Google account (with Send email) in Connections to deliver by email." };
      }
      // WP-005: a STALE account is not a working one. An expired/revoked Google grant
      // would otherwise sail past these guards and fail deep inside the Gmail call,
      // surfacing as an opaque provider error rather than the one thing the family can
      // act on: reconnect. Say it plainly, before spending the request.
      if (["needs_reconnect", "revoked", "expired"].includes(account.status)) {
        return { ok: false, channel, delivered: false, needsSetup: "google_reconnect", message: `Your Google connection needs to be re-authorized (it's currently "${account.status}") — reconnect it in Connections and this will send. Nothing was sent.` };
      }
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
