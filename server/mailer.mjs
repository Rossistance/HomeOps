// FamiliOS — PLATFORM email transport.
//
// Why this module exists. Until now the only way this deployment could send an email was
// `gmail.send` on a household's own connected Google account (notify.mjs said so outright:
// "the only email transport this deployment has"). That is fine for a family asking their
// assistant to email the school — it should come from them. It is fatal for FamiliOS's own
// transactional mail, because of a circularity: a brand-new household has no Google
// connection, and the messages it needs first are the ones that let it sign in at all.
// Password reset, email verification and the "forgot which email" recovery were all
// undeliverable to exactly the people they exist for. You cannot sell a subscription to
// someone who can't get back into their account.
//
// So: FamiliOS speaks for itself over a platform sender, and a household still speaks for
// itself over its own Gmail. Two different voices, deliberately not merged — a verification
// code from noreply@ is correct, and a note to a teacher from noreply@ is not.
//
// Deliberately dependency-free: an HTTPS POST through safeFetch rather than nodemailer or an
// SDK. That keeps the install surface unchanged and — more usefully — puts platform mail
// INSIDE the egress choke point, so it shows up wherever outbound traffic is accounted for
// instead of being a ninth call site that quietly bypasses it.
import { safeFetch } from "./net.mjs";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const apiKey = () => (process.env.RESEND_API_KEY || "").trim();
/** Resend's shared sandbox sender works with no domain verification, but only delivers to
 *  the Resend account owner's own address — fine for a first smoke test, not for customers.
 *  Set FAMILIOS_MAIL_FROM to a verified domain before inviting anyone. */
const mailFrom = () => (process.env.FAMILIOS_MAIL_FROM || "FamiliOS <onboarding@resend.dev>").trim();
const replyTo = () => (process.env.FAMILIOS_MAIL_REPLY_TO || "").trim();

/**
 * Truthful readiness, same vocabulary the AI providers use (ai.mjs): configuration is not
 * proof of reachability, so this reports what is CONFIGURED and never guesses at health.
 *   not_configured → no API key; nothing can be sent and callers must degrade honestly
 *   sandbox_sender → configured, but still on the shared sandbox From (owner-only delivery)
 *   configured     → key + a From of your own
 */
export function platformMailReadiness() {
  if (!apiKey()) return "not_configured";
  return /@resend\.dev>?\s*$/i.test(mailFrom()) ? "sandbox_sender" : "configured";
}
export function platformMailReady() {
  return platformMailReadiness() !== "not_configured";
}
/** Safe to expose on /api/health: says whether transactional mail can go out, and names the
 *  From so a misconfigured sender is visible rather than mysterious. Never returns the key. */
export function platformMailStatus() {
  const readiness = platformMailReadiness();
  return { readiness, from: readiness === "not_configured" ? null : mailFrom(), provider: "resend" };
}

/**
 * Send one transactional email as FamiliOS itself.
 *
 * Returns { ok, id } | { ok:false, error, message }. Never throws: a mailer that throws
 * turns "the code didn't arrive" into a 500 on a signup, and the caller's job is to stay
 * enumeration-safe either way.
 */
export async function sendPlatformEmail({ to, subject, text, html }) {
  if (!apiKey()) {
    return { ok: false, error: "mail_not_configured", message: "No platform email transport is configured (set RESEND_API_KEY)." };
  }
  const address = String(to ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { ok: false, error: "bad_recipient", message: "Not a valid email address." };
  }
  const body = {
    from: mailFrom(),
    to: [address],
    subject: String(subject ?? "FamiliOS").slice(0, 200),
    text: String(text ?? "").slice(0, 20000),
  };
  if (html) body.html = String(html).slice(0, 80000);
  if (replyTo()) body.reply_to = replyTo();

  const r = await safeFetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }, { timeoutMs: 10_000, maxBytes: 64_000 });

  if (!r.ok) return { ok: false, error: r.error ?? "mail_unreachable", message: r.message ?? "Could not reach the mail provider." };
  if (!r.httpOk) {
    // Surface the provider's own reason — "domain not verified" and "invalid API key" are
    // both actionable, and collapsing them into "send failed" is how a deployment stays
    // broken for a week.
    let detail = "";
    try { detail = JSON.parse(r.text ?? "{}")?.message ?? ""; } catch { detail = String(r.text ?? "").slice(0, 200); }
    return { ok: false, error: "mail_rejected", status: r.status, message: detail || `Mail provider returned ${r.status}.` };
  }
  let id = null;
  try { id = JSON.parse(r.text ?? "{}")?.id ?? null; } catch { /* a 2xx with an unparseable body still sent */ }
  return { ok: true, id };
}
