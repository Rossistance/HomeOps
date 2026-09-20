// FamiliOS — a link that shows one card, to one person, for two minutes.
//
// Famili confirms in the family's group chat that it added something. A confirmation that
// is only a sentence is an unverifiable claim: the family has the app's word that a record
// exists. The answer is a picture of the actual card, rendered from the actual database.
//
// Which needs a headless browser to open a page, and that page has to be AUTHENTICATED —
// and this is where the obvious designs all fail. There is no share token in this codebase;
// the in-process renderer aborts every loopback request it makes (browser.mjs), so a page
// cannot call the local API; and the external runtime's /open takes a URL and nothing else,
// no cookie and no storage state.
//
// So the page is server-rendered COMPLETE, with no client-side fetch at all, and the link
// carries a signed, single-purpose, two-minute token naming exactly one record.
//
// ── The part that is easy to get wrong ─────────────────────────────────────────────────
// The token is necessary and NOT sufficient. An unauthenticated route never calls gate(),
// and gate() is the only thing that sets the tenant, so the handler would read the resident
// household no matter whose token it holds. Worse, canSeeEntity(entity, {}) defaults its
// session to an empty object, which makes `entity.ownerId === actorId` compare undefined to
// undefined and return TRUE, and it never checks householdId at all. So the token has to
// drive runWithTenant, the synthetic session has to be complete, and the household has to
// be re-checked on the record itself. The precedent for all three is the pre-auth avatar
// route in index.mjs, which validates a household hint against the real tenant list and
// then re-checks householdId on the file it found.
import crypto from "node:crypto";
import { derivePurposeKey } from "./store.mjs";

/** Two minutes. Long enough for a cold browser runtime to wake and render, short enough
 *  that a link leaking out of a log is not a standing grant. */
export const PREVIEW_TTL_MS = 120_000;

const KEY = () => derivePurposeKey("preview");
const b64u = (buf) => Buffer.from(buf).toString("base64url");

/** The only record types a preview may name. A closed set, because the whole point is that
 *  this link cannot be walked into a general-purpose reader. */
export const PREVIEW_TYPES = Object.freeze(new Set(["event", "task", "list_item", "meal", "file", "help_request"]));

/**
 * Mint a token for one record, readable as one person, for PREVIEW_TTL_MS.
 * @returns {{ok:true, token:string, expiresAt:number} | {ok:false, error:string}}
 */
export function mintPreviewToken({ householdId, actorId, role, type, id, nowMs }) {
  if (!householdId || !actorId || !type || !id) return { ok: false, error: "invalid_input" };
  if (!PREVIEW_TYPES.has(type)) return { ok: false, error: "invalid_input" };
  const exp = (nowMs ?? Date.now()) + PREVIEW_TTL_MS;
  // The ROLE travels in the payload and is signed with the rest. It has to: the page is
  // rendered as this person, and canSeeEntity uses role for the "adults" visibility tier.
  const payload = { h: householdId, a: actorId, r: role ?? "Adult Member", t: type, i: id, e: exp };
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(crypto.createHmac("sha256", KEY()).update(body).digest());
  return { ok: true, token: `${body}.${sig}`, expiresAt: exp };
}

/**
 * Verify and unpack. Constant-time on the signature, and every failure is the same shape so
 * a caller cannot turn this into an oracle for which household ids exist.
 * @returns {{ok:true, householdId, actorId, role, type, id, expiresAt} | {ok:false, error:string}}
 */
export function readPreviewToken(token, nowMs) {
  const raw = String(token ?? "");
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return { ok: false, error: "preview_invalid" };
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  let expected;
  try { expected = b64u(crypto.createHmac("sha256", KEY()).update(body).digest()); } catch { return { ok: false, error: "preview_invalid" }; }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: "preview_invalid" };
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return { ok: false, error: "preview_invalid" }; }
  if (!p || typeof p !== "object") return { ok: false, error: "preview_invalid" };
  if (!PREVIEW_TYPES.has(p.t)) return { ok: false, error: "preview_invalid" };
  if (!Number.isFinite(p.e) || p.e <= (nowMs ?? Date.now())) return { ok: false, error: "preview_expired" };
  return { ok: true, householdId: String(p.h), actorId: String(p.a), role: String(p.r), type: String(p.t), id: String(p.i), expiresAt: p.e };
}

/* ───────────────────────── the page ───────────────────────── */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * One card, as a complete document. No stylesheet link, no script, no fetch — every one of
 * those would be a subresource the in-process renderer aborts, and the render would come
 * back as an empty frame with no error worth reading. Tactile Hearth's tokens are inlined
 * rather than imported for the same reason.
 */
export function renderPreviewCard({ title, when, where, who, status, kindLabel }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=520,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; width: 520px; padding: 28px;
    font: 400 16px/1.45 ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #F4EFE7; color: #2C2622; }
  .card { background: #FFFDFA; border-radius: 22px; padding: 24px 26px;
    box-shadow: 0 1px 2px rgba(44,38,34,.06), 0 8px 24px rgba(44,38,34,.10);
    border: 1px solid rgba(44,38,34,.06); }
  .kind { font-size: 12px; letter-spacing: .09em; text-transform: uppercase;
    color: #8A7F74; font-weight: 600; margin-bottom: 10px; }
  h1 { font-size: 25px; line-height: 1.22; margin: 0 0 16px; font-weight: 650; letter-spacing: -0.01em; }
  dl { margin: 0; display: grid; grid-template-columns: 86px 1fr; gap: 9px 14px; }
  dt { color: #8A7F74; font-size: 14px; }
  dd { margin: 0; font-size: 15px; font-weight: 500; }
  .mark { margin-top: 20px; padding-top: 14px; border-top: 1px solid rgba(44,38,34,.08);
    color: #8A7F74; font-size: 13px; }
</style></head>
<body><div class="card">
  <div class="kind">${esc(kindLabel)}</div>
  <h1>${esc(title)}</h1>
  <dl>
    ${when ? `<dt>When</dt><dd>${esc(when)}</dd>` : ""}
    ${where ? `<dt>Where</dt><dd>${esc(where)}</dd>` : ""}
    ${who ? `<dt>Who</dt><dd>${esc(who)}</dd>` : ""}
    ${status ? `<dt>Status</dt><dd>${esc(status)}</dd>` : ""}
  </dl>
  <div class="mark">In your family's FamiliOS</div>
</div></body></html>`;
}

/** The page shown when a token is stale or wrong. Deliberately says nothing about whether
 *  the record exists, which household it belonged to, or why the token failed. */
export function renderPreviewGone() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Not available</title>
<style>body{margin:0;width:520px;padding:48px 28px;font:400 16px/1.45 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#F4EFE7;color:#8A7F74;text-align:center}</style>
</head><body>This preview link has expired.</body></html>`;
}
