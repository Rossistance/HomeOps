// HomeOps — optional Playwright headless-browser runtime.
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
import http from "node:http";
import { chromium } from "playwright";

const PORT = Number(process.env.BROWSER_RUNTIME_PORT || 9223);
const NAME = "homeops-browser-runtime";
const VERSION = "1.0.0";
const MAX_TEXT = 20000;
const NAV_TIMEOUT = 30000;

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
  if (req.method === "GET") return send(res, 200, { ok: true, name: NAME, version: VERSION, headless: true });

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

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`${NAME} v${VERSION} listening on http://localhost:${PORT} — set BROWSER_RUNTIME_URL=http://localhost:${PORT} in the backend .env`);
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { try { await browser?.close(); } catch { /* ignore */ } process.exit(0); });
