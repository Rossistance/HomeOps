// FamiliOS — in-process headless browser (Playwright Chromium) so JS-heavy
// pages render inside runs without an external runtime. Strictly optional:
// if Playwright (or its Chromium build) isn't installed the module reports
// unavailable and web.read degrades honestly to plain HTML fetching.
//
// Install locally / on the host with:  npm run install-browser
// Disable explicitly with:             FAMILIOS_BROWSER=0

let browserPromise = null;   // Promise<Browser> while launching / launched
let unavailable = false;     // sticky: don't retry a broken install every call

const DISABLED = String(process.env.FAMILIOS_BROWSER ?? "").trim() === "0";
const NAV_TIMEOUT_MS = 25_000;
const SETTLE_MS = 1_200; // give SPAs a beat after network-idle for late paints

async function getBrowser() {
  if (DISABLED || unavailable) return null;
  if (!browserPromise) {
    browserPromise = (async () => {
      // Match the install convention (scripts/postinstall-browser.mjs): browsers
      // live inside node_modules so build output survives to the host runtime.
      process.env.PLAYWRIGHT_BROWSERS_PATH ??= "0";
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
      browser.on("disconnected", () => { browserPromise = null; });
      return browser;
    })();
    browserPromise.catch(() => { unavailable = true; browserPromise = null; });
  }
  try { return await browserPromise; } catch { return null; }
}

export function browserAvailable() {
  return !DISABLED && !unavailable;
}

/** Real handshake: actually launch (or reuse) Chromium. Used by health checks
 * so "connected" is never reported on hope. */
export async function probeBrowser() {
  const b = await getBrowser();
  return !!b;
}

/**
 * Render a page in real Chromium and return { title, url, html, text }.
 * Returns null when the browser is unavailable or rendering fails — callers
 * fall back to the static-fetch path. The caller is responsible for SSRF
 * policy (readPage only renders targets safeFetch already allowed).
 */
export async function renderPage(url, { timeoutMs = NAV_TIMEOUT_MS } = {}) {
  const browser = await getBrowser();
  if (!browser) return null;
  let context;
  try {
    context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
      javaScriptEnabled: true,
    });
    // Belt-and-braces: block subresource requests to private ranges even though
    // the top-level target was already policy-checked.
    await context.route(/^https?:\/\/(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/i, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    // Lazy-hydrating pages (galleries, infinite lists) only populate content —
    // sometimes even anchor hrefs — as items scroll into view. Two quick passes
    // down the page wake them up before we read the DOM.
    await page.evaluate(async () => {
      for (let i = 0; i < 2; i++) {
        for (let y = 0; y < document.body.scrollHeight; y += 900) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
      }
      window.scrollTo(0, 0);
    }).catch(() => {});
    await page.waitForTimeout(400);
    const title = await page.title().catch(() => "");
    const finalUrl = page.url();
    const html = await page.content().catch(() => "");
    const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    return { title, url: finalUrl, html, text };
  } catch {
    return null;
  } finally {
    await context?.close().catch(() => {});
  }
}

/** Graceful shutdown (tests / SIGTERM). */
export async function closeBrowser() {
  if (!browserPromise) return;
  try { const b = await browserPromise; await b.close(); } catch { /* already gone */ }
  browserPromise = null;
}
