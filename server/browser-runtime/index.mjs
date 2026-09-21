// FamiliOS — optional Playwright headless-browser runtime.
//
// A small, dependency-isolated HTTP service the main backend calls when the
// "Browser Automation" connector runs `browser.open` / `browser.download`. It is
// a SEPARATE process (its only dependency is Playwright) so the control-plane
// backend stays dependency-free. The backend reaches it at BROWSER_RUNTIME_URL.
//
// Honesty-first: we never ask for the user's password. Sign-in happens inside the
// browser session; this service drives navigation and extraction only.
//
// Run:  cd server/browser-runtime && npm install && npm run setup && npm start
// Then: set BROWSER_RUNTIME_URL=http://localhost:9223 in the backend's .env
//
// WHY THIS SERVICE IS THE ANSWER, and not a flag on the backend:
//
//   "Browser automation says runtime offline. How am I intended to run browser automation
//    with Playwright or something similar from the server? We need to make this be able
//    to work."
//
// It couldn't, in-process, on the instance the backend runs on. Chromium plus the backend
// measured over 512MB on real pages and the OOM killer took the WHOLE app down (Render
// events, 2026-07-09) — which is why server/browser.mjs refuses to launch below ~900MB of
// container memory. That refusal is the correct behaviour and lowering it would trade an
// honest "offline" for an app that dies mid-render.
//
// So the browser moves out. Here, it is the only thing in the container, an OOM kills a
// service nobody else depends on, and the backend keeps answering. That's what makes it
// work rather than making it *look* like it works.
//
// SECURITY. A runtime reachable over the public internet is a browser anyone can drive —
// an open proxy that fetches URLs from inside your network. So:
//   • BROWSER_RUNTIME_TOKEN set  → every request must present it; binds all interfaces.
//   • BROWSER_RUNTIME_TOKEN unset → binds 127.0.0.1 ONLY, so the documented local flow
//     above still works with no ceremony and cannot be exposed by accident.
// There is deliberately no third mode. "Public and unauthenticated" is not a configuration
// you can reach by forgetting something.
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { chromium } from "playwright";

const PORT = Number(process.env.BROWSER_RUNTIME_PORT || process.env.PORT || 9223);
const NAME = "homeops-browser-runtime";
const VERSION = "1.2.0"; // 1.2.0 adds POST /shot
const MAX_TEXT = 20000;
const NAV_TIMEOUT = 30000;

const TOKEN = String(process.env.BROWSER_RUNTIME_TOKEN || "").trim();
/* No token, no exposure. Binding loopback is the enforcement — not a warning in a log
 * nobody reads. */
const HOST = TOKEN ? "0.0.0.0" : "127.0.0.1";

/** Constant-time compare, and never on unequal lengths (timingSafeEqual throws). */
function tokenOk(req) {
  if (!TOKEN) return true; // loopback-only; the bind address is the gate
  const raw = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(raw), b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

let browser = null;
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({ headless: true });
  return browser;
}

function send(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(s);
}
function readBody(req) {
  return new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve(null); } }); });
}
function isHttpUrl(u) { try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:"; } catch { return false; } }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health / reachability — the backend probes this to mark the connector "connected".
  // Unauthenticated ON PURPOSE: it reveals nothing but "a runtime is here", and Render's
  // platform health check has no way to present a bearer token.
  if (req.method === "GET") return send(res, 200, { ok: true, name: NAME, version: VERSION, headless: true, authRequired: !!TOKEN });

  // Everything past here drives a real browser, so it needs the token.
  if (!tokenOk(req)) return send(res, 401, { ok: false, error: "unauthorized", message: "Present BROWSER_RUNTIME_TOKEN as a bearer token." });

  if (req.method === "POST" && url.pathname === "/open") {
    const body = await readBody(req);
    if (!body) return send(res, 400, { ok: false, error: "bad_json" });
    if (!isHttpUrl(body.url)) return send(res, 400, { ok: false, error: "invalid_url", message: "Provide an http(s) URL." });
    let ctx;
    try {
      const b = await getBrowser();
      ctx = await b.newContext();
      const page = await ctx.newPage();
      await page.goto(body.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      const title = await page.title();
      const finalUrl = page.url();
      const text = (await page.evaluate(() => document.body?.innerText || "")).slice(0, MAX_TEXT);
      const links = await page.evaluate(() => Array.from(document.querySelectorAll("a")).slice(0, 30).map((a) => ({ text: (a.textContent || "").trim().slice(0, 80), href: a.href })).filter((l) => l.href));
      return send(res, 200, { ok: true, title, url: finalUrl, textLength: text.length, text, links });
    } catch (e) {
      return send(res, 200, { ok: false, error: "navigation_failed", message: String(e?.message ?? e) });
    } finally { try { await ctx?.close(); } catch { /* ignore */ } }
  }

  /* /shot — one PNG of one page, base64 in the same JSON envelope every other endpoint
   * uses. Base64 rather than raw bytes so nothing about the transport changes: the backend
   * reaches this service through safeFetch, which reads a response as text with a size cap.
   *
   * This exists so a confirmation in a family's group chat can carry a picture of the
   * actual record rather than the app's word that one exists. The page it shoots is
   * server-rendered complete and carries a two-minute signed token; see preview-token.mjs. */
  if (req.method === "POST" && url.pathname === "/shot") {
    const body = await readBody(req);
    if (!body) return send(res, 400, { ok: false, error: "bad_json" });
    if (!isHttpUrl(body.url)) return send(res, 400, { ok: false, error: "invalid_url", message: "Provide an http(s) URL." });
    const width = Math.min(1200, Math.max(200, Number(body.width) || 520));
    const height = Math.min(1600, Math.max(200, Number(body.height) || 420));
    let ctx;
    try {
      const b = await getBrowser();
      ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await page.goto(body.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      // The page has no scripts and no subresources by construction, so there is nothing to
      // wait for beyond layout. fullPage keeps a taller card from being cropped silently.
      const buf = await page.screenshot({ type: "png", fullPage: true });
      return send(res, 200, { ok: true, mime: "image/png", bytes: buf.length, base64: buf.toString("base64") });
    } catch (e) {
      return send(res, 200, { ok: false, error: "render_failed", message: String(e?.message ?? e) });
    } finally { try { await ctx?.close(); } catch { /* ignore */ } }
  }

  if (req.method === "POST" && url.pathname === "/download") {
    const body = await readBody(req);
    if (!body) return send(res, 400, { ok: false, error: "bad_json" });
    if (!isHttpUrl(body.url)) return send(res, 400, { ok: false, error: "invalid_url", message: "Provide an http(s) URL." });
    let ctx;
    try {
      const b = await getBrowser();
      ctx = await b.newContext({ acceptDownloads: true });
      const page = await ctx.newPage();
      await page.goto(body.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 20000 }),
        body.selector ? page.click(body.selector) : Promise.resolve(),
      ]).catch(() => [null]);
      if (!download) return send(res, 200, { ok: false, error: "no_download", message: "No download was triggered. Provide a `selector` for the download link." });
      const filename = download.suggestedFilename();
      const path = await download.path();
      let sizeBytes = 0;
      try { const fs = await import("node:fs"); sizeBytes = fs.statSync(path).size; } catch { /* ignore */ }
      return send(res, 200, { ok: true, filename, sizeBytes, savedTo: path });
    } catch (e) {
      return send(res, 200, { ok: false, error: "download_failed", message: String(e?.message ?? e) });
    } finally { try { await ctx?.close(); } catch { /* ignore */ } }
  }

  return send(res, 404, { ok: false, error: "not_found" });
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(TOKEN
    ? `${NAME} v${VERSION} listening on ${HOST}:${PORT} (token required)`
    : `${NAME} v${VERSION} listening on http://localhost:${PORT} — loopback only (set BROWSER_RUNTIME_TOKEN to accept remote calls). Set BROWSER_RUNTIME_URL=http://localhost:${PORT} in the backend .env`);
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { try { await browser?.close(); } catch { /* ignore */ } process.exit(0); });
