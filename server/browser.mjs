// FamiliOS — in-process headless browser (Playwright Chromium) so JS-heavy
// pages render inside runs without an external runtime. Strictly optional:
// if Playwright (or its Chromium build) isn't installed the module reports
// unavailable and web.read degrades honestly to plain HTML fetching.
//
// Memory discipline (learned the hard way — Chromium OOM-killed a 512MB
// Render instance rendering an image-heavy page): images/media/fonts are
// blocked (we only need DOM text + links), renders are serialized through a
// single-flight queue, scrolling is capped, and the whole browser is closed
// after a short idle so its baseline RSS isn't held between runs.
//
// Install locally / on the host with:  npm run install-browser
// Disable explicitly with:             FAMILIOS_BROWSER=0

import { readFileSync } from "node:fs";
import os from "node:os";

let browserPromise = null;   // Promise<Browser> while launching / launched
let unavailable = false;     // sticky: don't retry a broken install every call
let idleTimer = null;        // closes Chromium after IDLE_CLOSE_MS of no renders
let queue = Promise.resolve(); // single-flight: one render at a time

// Memory gate: Chromium + this Node server measured >512MB on real pages and
// OOM-killed the whole instance (Render events, 2026-07-09). Unless the host
// has real headroom, the browser stays off and callers use their static
// fallbacks. FAMILIOS_BROWSER=1 forces on; =0 forces off; unset → auto.
const MIN_BROWSER_BYTES = 900 * 1024 * 1024;
function containerMemoryBytes() {
  // cgroup v2 (Render, most containers), then v1, then host total.
  for (const p of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const raw = readFileSync(p, "utf8").trim();
      if (raw && raw !== "max") { const n = Number(raw); if (Number.isFinite(n) && n > 0) return n; }
    } catch { /* not this cgroup layout */ }
  }
  return os.totalmem();
}
const FORCED = String(process.env.FAMILIOS_BROWSER ?? "").trim();
const DISABLED = FORCED === "0" || (FORCED !== "1" && containerMemoryBytes() < MIN_BROWSER_BYTES);
const NAV_TIMEOUT_MS = 25_000;
const SETTLE_MS = 1_200;      // give SPAs a beat after network-idle for late paints
const IDLE_CLOSE_MS = 20_000; // reclaim Chromium's memory shortly after use
const MAX_SCROLL_STEPS = 15;  // lazy-load wake-up, bounded

const BLOCKED_RESOURCES = new Set(["image", "media", "font"]);

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
        args: [
          "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
          "--disable-extensions", "--mute-audio",
          // Keep the process tree small on small instances.
          "--disable-features=site-per-process",
          "--js-flags=--max-old-space-size=128",
        ],
      });
      browser.on("disconnected", () => { browserPromise = null; });
      return browser;
    })();
    browserPromise.catch(() => { unavailable = true; browserPromise = null; });
  }
  try { return await browserPromise; } catch { return null; }
}

function scheduleIdleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { void closeBrowser(); }, IDLE_CLOSE_MS);
  idleTimer.unref?.();
}

export function browserAvailable() {
  return !DISABLED && !unavailable;
}

/** Real handshake: actually launch (or reuse) Chromium. Used by health checks
 * so "connected" is never reported on hope. */
export async function probeBrowser() {
  const b = await getBrowser();
  scheduleIdleClose();
  return !!b;
}

async function renderPageInner(url, timeoutMs) {
  const browser = await getBrowser();
  if (!browser) return null;
  let context;
  try {
    context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
      javaScriptEnabled: true,
    });
    // Memory: drop images/media/fonts (we only read DOM text + links).
    // SSRF belt-and-braces: block subresource requests to private ranges even
    // though the top-level target was already policy-checked.
    const PRIVATE = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/i;
    await context.route("**/*", (route) => {
      const req = route.request();
      if (PRIVATE.test(req.url()) || BLOCKED_RESOURCES.has(req.resourceType())) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    // Lazy-hydrating pages (galleries, infinite lists) only populate content —
    // sometimes even anchor hrefs — as items scroll into view. One bounded
    // pass down the page wakes them up before we read the DOM.
    await page.evaluate(async (maxSteps) => {
      let y = 0;
      for (let i = 0; i < maxSteps; i++) {
        y += 1600;
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
        if (y >= document.body.scrollHeight) break;
      }
      window.scrollTo(0, 0);
    }, MAX_SCROLL_STEPS).catch(() => {});
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
    scheduleIdleClose();
  }
}

/**
 * Render a page in real Chromium and return { title, url, html, text }.
 * Returns null when the browser is unavailable or rendering fails — callers
 * fall back to the static-fetch path. The caller is responsible for SSRF
 * policy (readPage only renders targets safeFetch already allowed).
 * Renders are serialized — concurrent callers queue rather than multiplying
 * Chromium's memory footprint.
 */
export async function renderPage(url, { timeoutMs = NAV_TIMEOUT_MS } = {}) {
  const task = queue.then(() => renderPageInner(url, timeoutMs));
  queue = task.catch(() => {});
  return task;
}

/** Graceful shutdown (idle reclaim / tests / SIGTERM). */
export async function closeBrowser() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (!browserPromise) return;
  try { const b = await browserPromise; await b.close(); } catch { /* already gone */ }
  browserPromise = null;
}
