// BlueBubbles — FamiliOS's iMessage bridge.
//
// One Apple ID on a cloud Mac (BlueBubbles Server, headless) carries texts for EVERY
// household on this deployment. Nothing about the transport tells two families apart — the
// same number receives all of it — so identity is decided the way sms.mjs already decides
// it: by the SENDER's handle against each household's verified contact methods. This module
// is only the wire: how to reach the Mac, how to read what it posts to us, how to hand it
// text to send. It knows nothing about members, households or the assistant.
//
// Wire facts (BlueBubbles Server REST API):
//   • Every request carries the server password. BlueBubbles reads it from the `password`
//     query parameter (aliases `guid` and `token`); it is also sent as a bearer header so a
//     reverse proxy or tunnel in front of the Mac can enforce the same secret.
//   • POST /api/v1/message/text   { chatGuid, tempGuid, message, method }
//   • POST /api/v1/chat/new       { addresses: [address], message, service }  — first contact
//   • GET  /api/v1/ping           → { status: 200, message: "pong" }
//   • Webhooks are plain JSON POSTs, unsigned:
//       { type: "new-message", data: { guid, text, isFromMe, handle: { address, service },
//                                      chats: [{ guid }], dateCreated } }
//     The shared secret we register in the webhook URL (or send as a header) is the only
//     authentication, which is why the route fails closed without one in production.
//   • A one-to-one chat's GUID is "<service>;-;<address>", a group chat's "<service>;+;…".
import crypto from "node:crypto";
import { getConnectorConfig, getSecret, listContactMethods, patchContactMethod } from "./store.mjs";

/** The connector the rest of the product keys on. The id predates the bridge and is
 *  referenced by the engine, notify, sandbox twin and tests as the "text" channel; the
 *  user-facing name and provider changed, the key did not. */
export const CONNECTOR_ID = "sms";

const DEFAULT_SEND_METHOD = "private-api";

/** Deployment config: environment first (Render), then the connector's stored fields. */
export function bluebubblesConfig() {
  const cfg = getConnectorConfig(CONNECTOR_ID);
  const url = String(process.env.BLUEBUBBLES_URL || cfg.fields?.serverUrl || "").trim().replace(/\/+$/, "");
  const password = process.env.BLUEBUBBLES_PASSWORD || getSecret(CONNECTOR_ID, "password") || null;
  const webhookSecret = process.env.BLUEBUBBLES_WEBHOOK_SECRET || getSecret(CONNECTOR_ID, "webhookSecret") || null;
  const method = String(process.env.BLUEBUBBLES_SEND_METHOD || cfg.fields?.sendMethod || DEFAULT_SEND_METHOD).trim() || DEFAULT_SEND_METHOD;
  return { url, password, webhookSecret, method };
}

/** True when the outbound half can be attempted at all. */
export function bluebubblesConfigured(cfg = bluebubblesConfig()) {
  return !!(cfg.url && cfg.password);
}

/**
 * A handle the way iMessage writes it: an email Apple ID lower-cased, a phone number in
 * E.164. Hand-entered contact methods arrive as "(555) 010-8899"; the Mac reports
 * "+15550108899"; both must land on the same chat.
 */
export function normalizeAddress(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.includes("@")) return s.toLowerCase();
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (digits.length > 11) return "+" + digits;
  return s;
}

/** The GUID of the one-to-one chat with a handle. */
export function chatGuidFor(address, service = "iMessage") {
  return `${service};-;${normalizeAddress(address)}`;
}

/** True for a group thread — the assistant never answers into one of those. */
export function isGroupChatGuid(guid) {
  return String(guid ?? "").includes(";+;");
}

/** Two handles for the same person: equal Apple IDs, or phone numbers whose last ten
 *  digits agree (a hand-entered "(555) 010-8899" and the Mac's "+15550108899"). */
export function sameHandle(a, b) {
  const na = normalizeAddress(a), nb = normalizeAddress(b);
  if (!na || !nb) return false;
  if (na.includes("@") || nb.includes("@")) return na === nb;
  const da = na.replace(/\D/g, ""), db = nb.replace(/\D/g, "");
  return da.length >= 7 && db.length >= 7 && da.slice(-10) === db.slice(-10);
}

/* ------------------------------ Thread memory ------------------------------
 * The Mac names the conversation it has with a person (the chat GUID). Remembering it on
 * the person's Phone/Text contact method means every reply and every later notification
 * lands in the thread they already have with the household number, instead of the bridge
 * guessing a GUID from the address each time. Runs in the ambient tenant: the caller
 * decides whose registry this is. */
export function rememberChatGuid(address, chatGuid) {
  if (!chatGuid || isGroupChatGuid(chatGuid)) return 0;
  let n = 0;
  for (const m of listContactMethods((x) => x.type === "Phone/Text" && sameHandle(x.value, address))) {
    if (m.imessageChatGuid === chatGuid) continue;
    patchContactMethod(m.id, { imessageChatGuid: chatGuid, imessageAddress: normalizeAddress(address), updatedAt: new Date().toISOString() });
    n++;
  }
  return n;
}

/** The thread this household remembers for a handle, if any. */
export function rememberedChatGuid(address) {
  const m = listContactMethods((x) => x.type === "Phone/Text" && !!x.imessageChatGuid && sameHandle(x.value, address))[0];
  return m?.imessageChatGuid ?? null;
}

/* ---------------------------------- HTTP ---------------------------------- */

/* The bridge URL is deployment configuration (BLUEBUBBLES_URL), like BROWSER_RUNTIME_URL —
 * a Tailscale or Cloudflare-tunnel address is private by design, so the SSRF guard that
 * protects user-supplied URLs would wrongly refuse it. Plain fetch, with a timeout. */
async function bbFetch(cfg, path, { method = "GET", body, timeoutMs = 15000 } = {}) {
  if (!cfg.url) return { ok: false, error: "not_configured", message: "The BlueBubbles server URL isn't set." };
  if (!cfg.password) return { ok: false, error: "not_configured", message: "The BlueBubbles server password isn't set." };
  let u;
  try { u = new URL(cfg.url + path); } catch { return { ok: false, error: "not_configured", message: "The BlueBubbles server URL isn't a valid URL." }; }
  u.searchParams.set("password", cfg.password);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(u, {
      method,
      headers: { authorization: `Bearer ${cfg.password}`, "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    let json = null;
    try { json = await r.json(); } catch { json = null; }
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, error: "unreachable", message: String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Health: is the Mac there, and is the password right? */
export async function ping() {
  const cfg = bluebubblesConfig();
  const t0 = Date.now();
  if (!bluebubblesConfigured(cfg)) return { ok: false, status: "not_configured", error: "bluebubbles_not_configured", latencyMs: 0 };
  const r = await bbFetch(cfg, "/api/v1/ping", { timeoutMs: 8000 });
  if (r.ok) return { ok: true, status: "healthy", latencyMs: Date.now() - t0, code: r.status };
  const status = r.error === "unreachable" ? "unreachable" : r.status === 401 || r.status === 403 ? "unauthorized" : "error";
  return { ok: false, status, latencyMs: Date.now() - t0, code: r.status, error: r.error ?? `http_${r.status}` };
}

/**
 * Send one text. Prefers a remembered chat GUID (the thread the person already has with
 * the household number); otherwise addresses the one-to-one chat by handle, and when the
 * Mac has never spoken to that handle, starts the chat with the message itself.
 *
 * Returns { ok, action: "sent" | "started", chatGuid, guid, to } or
 *         { ok: false, error: "not_configured" | "unreachable" | "invalid_input" | "provider_error", message }.
 */
export async function sendText({ to, chatGuid, text, tempGuid } = {}) {
  const cfg = bluebubblesConfig();
  const message = String(text ?? "").trim();
  if (!message) return { ok: false, error: "invalid_input", message: "Nothing to send." };
  const address = normalizeAddress(to);
  if (!chatGuid && !address) return { ok: false, error: "invalid_input", message: "No one to send it to." };
  if (!bluebubblesConfigured(cfg)) return { ok: false, error: "not_configured", message: "Connect the iMessage bridge (BlueBubbles) in Connections first." };

  const guid = chatGuid || chatGuidFor(address);
  const temp = tempGuid || `familios-${crypto.randomUUID()}`;
  let r = await bbFetch(cfg, "/api/v1/message/text", { method: "POST", body: { chatGuid: guid, tempGuid: temp, message, method: cfg.method } });
  if (r.ok) return { ok: true, action: "sent", chatGuid: guid, guid: r.json?.data?.guid ?? null, to: address || null };

  // No such chat on the Mac (first contact, or a thread the person deleted): let it create
  // the chat with this message.
  if (address && (r.status === 400 || r.status === 404)) {
    const n = await bbFetch(cfg, "/api/v1/chat/new", { method: "POST", body: { addresses: [address], message, service: "iMessage", method: cfg.method, tempGuid: temp } });
    if (n.ok) {
      const created = n.json?.data ?? {};
      return { ok: true, action: "started", chatGuid: created.guid ?? chatGuidFor(address), guid: created.messages?.[0]?.guid ?? null, to: address };
    }
    r = n;
  }
  if (r.error === "unreachable" || r.error === "not_configured") return { ok: false, error: r.error, message: r.message };
  const why = r.json?.error?.error ?? r.json?.error?.message ?? r.json?.message ?? null;
  return { ok: false, error: "provider_error", status: r.status, message: why ? `BlueBubbles: ${why}` : `BlueBubbles rejected the send (HTTP ${r.status}).` };
}

/* -------------------------------- Webhooks -------------------------------- */

/**
 * Read a BlueBubbles webhook body into one shape. Returns null for a body that is not a
 * message event at all; a message event always carries `type: "new-message"` plus the
 * fields the router needs. Tolerant of the two payload layouts the server has used
 * (`data` vs. a bare message object) so a server update does not silently mute the family.
 */
export function parseInboundWebhook(payload) {
  if (!payload || typeof payload !== "object") return null;
  const type = String(payload.type ?? payload.event ?? "").toLowerCase();
  if (type && type !== "new-message") return { type, ignored: true };
  const d = payload.data ?? payload.message ?? payload;
  if (!d || typeof d !== "object") return null;
  const handle = d.handle ?? d.sender ?? null;
  const address = normalizeAddress(handle?.address ?? d.address ?? d.from ?? "");
  const chats = Array.isArray(d.chats) ? d.chats : d.chat ? [d.chat] : [];
  const chatGuid = String(chats[0]?.guid ?? d.chatGuid ?? "").trim() || null;
  const service = handle?.service ?? (chatGuid ? chatGuid.split(";")[0] : null) ?? "iMessage";
  return {
    type: "new-message",
    guid: String(d.guid ?? d.id ?? "").trim() || null,
    text: String(d.text ?? d.body ?? "").trim(),
    address,
    chatGuid,
    service,
    isFromMe: d.isFromMe === true,
    /* TRI-STATE, and the third state is the point. `true` and `false` are answers; `null`
     * means the delivery carried no chat context at all — the bare payload layout above,
     * where `chats` is absent and there is no `chatGuid`. That used to resolve to `false`,
     * so a group message delivered in that layout fell past the group guard and was handled
     * as a one-to-one: the household assistant ran on it and answered the sender. A guard
     * that cannot tell must not guess, so the caller drops `null` instead of treating the
     * unknown as private. */
    isGroup: chats.length > 0 || chatGuid ? chats.some((c) => isGroupChatGuid(c?.guid)) || isGroupChatGuid(chatGuid) : null,
    dateCreated: d.dateCreated ?? null,
  };
}

/** The secret a webhook delivery presented — header, bearer, or the registered URL's query. */
export function webhookSecretPresented(headers, url) {
  const h = headers?.["x-familios-webhook-secret"] ?? headers?.["x-webhook-secret"];
  if (h) return String(Array.isArray(h) ? h[0] : h);
  const m = String(headers?.authorization ?? "").match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const q = url?.searchParams?.get("secret") ?? url?.searchParams?.get("token");
  return q || null;
}

export function secretMatches(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
