// HomeOps AI — backend authority: origin allowlist, sessions, CSRF, and roles.
// The control plane is deny-by-default: mutations require a valid session cookie,
// a matching CSRF token, and an allowed Origin. Reads of sensitive state
// (audit, settings, connector config, webhook history) require a session too.
import { getSession } from "./store.mjs";

const IS_PROD = (process.env.HOMEOPS_ENV || process.env.NODE_ENV) === "production";

// Allowed browser origins. Dev defaults to the Vite origin only. Production must
// set HOMEOPS_ALLOWED_ORIGINS to the exact deployment origin(s).
const DEFAULT_DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const ALLOWED_ORIGINS = (process.env.HOMEOPS_ALLOWED_ORIGINS
  ? process.env.HOMEOPS_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : IS_PROD ? [] : DEFAULT_DEV_ORIGINS);

export function isAllowedOrigin(origin) {
  if (!origin) return true; // same-origin / server-side requests send no Origin
  return ALLOWED_ORIGINS.includes(origin);
}

// Roles, highest authority first. Used for route authorization.
export const ROLES = ["Owner", "Adult Admin", "Adult Member", "Limited Member", "Child View", "Guest/Helper"];
const RANK = Object.fromEntries(ROLES.map((r, i) => [r, ROLES.length - i]));
export function roleAtLeast(role, min) {
  return (RANK[role] ?? 0) >= (RANK[min] ?? 999);
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Bearer token from the Authorization header (native/mobile clients). */
export function bearerToken(req) {
  const h = req.headers["authorization"] || req.headers["Authorization"];
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(String(h));
  return m ? m[1].trim() : null;
}

export function sessionFromReq(req) {
  const cookieTok = parseCookies(req)["homeops_session"];
  if (cookieTok) { const s = getSession(cookieTok); if (s) return s; }
  const bt = bearerToken(req);
  return bt ? getSession(bt) : undefined;
}

export function sessionCookie(token) {
  // httpOnly so JS can't read it; SameSite=Lax + (Secure in prod). Path=/.
  const attrs = ["homeops_session=" + token, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=" + 12 * 60 * 60];
  if (IS_PROD) attrs.push("Secure");
  return attrs.join("; ");
}
export function clearSessionCookie() {
  return "homeops_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";
}

export function corsHeaders(req) {
  const origin = req.headers.origin;
  const h = {
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-homeops-csrf, x-homeops-signature, x-homeops-timestamp, x-homeops-nonce, x-homeops-test",
    vary: "Origin",
  };
  if (origin && isAllowedOrigin(origin)) {
    h["access-control-allow-origin"] = origin;
    h["access-control-allow-credentials"] = "true";
  }
  return h;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Gate a request. Returns { ok:true, session } or { ok:false, status, error }.
 * - origin must be allowed (blocks cross-site reads/writes from unknown pages)
 * - mutations additionally require a session + matching CSRF header
 * - opts.requireSession forces auth on reads; opts.minRole enforces a role floor
 */
export function gate(req, opts = {}) {
  // Bearer-token auth (native/mobile): tokens are NOT sent ambiently by browsers,
  // so they carry no CSRF risk — token-authed requests skip the origin + CSRF gate
  // and authenticate purely by the token. Cookie auth keeps the full origin/CSRF gate.
  const bearer = bearerToken(req);
  const viaBearer = !!(bearer && getSession(bearer));
  const session = viaBearer ? getSession(bearer) : sessionFromReq(req);

  if (!viaBearer && !isAllowedOrigin(req.headers.origin)) {
    return { ok: false, status: 403, error: "origin_not_allowed" };
  }

  const isMutation = !SAFE_METHODS.has(req.method);
  if ((isMutation || opts.requireSession) && !session) {
    return { ok: false, status: 401, error: "authentication_required" };
  }
  if (isMutation && session && !viaBearer) {
    const csrf = req.headers["x-homeops-csrf"];
    if (!csrf || csrf !== session.csrf) return { ok: false, status: 403, error: "csrf_failed" };
  }
  if (opts.minRole && session && !roleAtLeast(session.role, opts.minRole)) {
    return { ok: false, status: 403, error: "insufficient_role" };
  }
  return { ok: true, session };
}

export { IS_PROD, ALLOWED_ORIGINS };
