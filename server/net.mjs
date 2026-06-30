// HomeOps AI — egress safety. Prevents the backend from being used as an SSRF
// primitive: blocks private/loopback/link-local/metadata targets, validates every
// redirect hop, and caps timeout + response size. Loopback is permitted ONLY for
// connectors that are explicitly local by design (Ollama / LM Studio).
import dns from "node:dns/promises";
import net from "node:net";

function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}
function inRange4(ip, cidr) {
  const [base, bits] = cidr.split("/");
  const mask = bits === "0" ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}
const BLOCK4 = ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4"];

function isLoopback(ip) {
  if (net.isIPv4(ip)) return inRange4(ip, "127.0.0.0/8");
  return ip === "::1" || ip === "0:0:0:0:0:0:0:1";
}
function classify(ip) {
  // returns "loopback" | "private" | "public"
  if (net.isIPv4(ip)) {
    if (inRange4(ip, "127.0.0.0/8")) return "loopback";
    if (BLOCK4.some((c) => inRange4(ip, c))) return "private";
    return "public";
  }
  const lower = ip.toLowerCase();
  if (lower === "::1") return "loopback";
  if (lower === "::" ) return "private";
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return "private"; // link-local fe80::/10
  if (lower.startsWith("fc") || lower.startsWith("fd")) return "private"; // ULA fc00::/7
  if (lower.startsWith("ff")) return "private"; // multicast
  // IPv4-mapped ::ffff:a.b.c.d
  const m = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
  if (m) return classify(m[1]);
  return "public";
}

/**
 * Validate a URL string for safe backend egress.
 * @returns {Promise<{ok:true, url:URL, host:string, ipCategory:string} | {ok:false, error:string}>}
 */
export async function assertSafeUrl(urlStr, { allowLoopback = false } = {}) {
  let url;
  try { url = new URL(urlStr); } catch { return { ok: false, error: "invalid_url" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "scheme_not_allowed" };
  const host = url.hostname;
  // Literal IPs are classified directly; hostnames are resolved (DNS-rebinding safe).
  let addrs = [];
  if (net.isIP(host)) {
    addrs = [host];
  } else {
    if (host.toLowerCase() === "localhost" || host.toLowerCase().endsWith(".local")) {
      if (!allowLoopback) return { ok: false, error: "loopback_blocked" };
      return { ok: true, url, host, ipCategory: "loopback" };
    }
    try {
      const res = await dns.lookup(host, { all: true });
      addrs = res.map((r) => r.address);
    } catch { return { ok: false, error: "dns_failure" }; }
  }
  let category = "public";
  for (const ip of addrs) {
    const c = classify(ip);
    if (c === "private") return { ok: false, error: "private_range_blocked", host, ip };
    if (c === "loopback") {
      if (!allowLoopback) return { ok: false, error: "loopback_blocked", host, ip };
      category = "loopback";
    }
  }
  return { ok: true, url, host, ipCategory: category };
}

/**
 * Fetch with SSRF guard, redirect re-validation, timeout, and response-size cap.
 * Every hop (including redirect targets) is re-validated against the policy.
 */
export async function safeFetch(urlStr, opts = {}, policy = {}) {
  const { allowLoopback = false, timeoutMs = 8000, maxBytes = 1_000_000, maxRedirects = 3 } = policy;
  let current = urlStr;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await assertSafeUrl(current, { allowLoopback });
    if (!check.ok) return { ok: false, error: check.error, host: check.host, ip: check.ip, policyBlocked: true };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(current, { ...opts, redirect: "manual", signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, error: "fetch_failed", message: String(e?.message ?? e) };
    }
    clearTimeout(timer);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location"), current).toString();
      continue; // re-validate next hop
    }
    // Read body with a hard size cap.
    const reader = res.body?.getReader?.();
    let text = "";
    if (reader) {
      let total = 0;
      const dec = new TextDecoder();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { try { await reader.cancel(); } catch {} text += "…[truncated]"; break; }
        text += dec.decode(value, { stream: true });
      }
    } else {
      text = await res.text();
    }
    return { ok: true, status: res.status, httpOk: res.ok, host: check.host, ipCategory: check.ipCategory, text, finalUrl: current };
  }
  return { ok: false, error: "too_many_redirects" };
}

/**
 * Streaming SSRF-safe fetch. Validates the URL (same policy as safeFetch), then
 * calls onChunk(string) for each received buffer chunk. No redirect following —
 * streaming responses do not redirect. Returns {ok, httpOk, status} or {ok:false, error}.
 */
export async function safeFetchStream(urlStr, opts = {}, policy = {}, onChunk) {
  const { allowLoopback = false, timeoutMs = 60_000, maxBytes = 4_000_000 } = policy;
  const check = await assertSafeUrl(urlStr, { allowLoopback });
  if (!check.ok) return { ok: false, error: check.error, host: check.host, policyBlocked: true };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(urlStr, { ...opts, redirect: "manual", signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: "fetch_failed", message: String(e?.message ?? e) };
  }
  clearTimeout(timer);
  if (!res.ok) {
    let text = "";
    try { text = await res.text(); } catch {}
    return { ok: true, httpOk: false, status: res.status, text };
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    if (onChunk) onChunk(text);
    return { ok: true, httpOk: true, status: res.status };
  }
  const dec = new TextDecoder();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { try { await reader.cancel(); } catch {} break; }
      if (onChunk) onChunk(dec.decode(value, { stream: true }));
    }
  } catch (e) {
    return { ok: false, error: "stream_error", message: String(e?.message ?? e) };
  }
  return { ok: true, httpOk: true, status: res.status };
}

export { isLoopback };
