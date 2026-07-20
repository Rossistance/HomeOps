import { expect, test } from "@playwright/test";

// TC-WEB PWA lane. The service worker + manifest exist only in PRODUCTION builds
// (vite.config.ts: VitePWA devOptions.enabled = false), so these specs run against a
// production surface named by TOPGUN_PWA_BASEURL:
//   local:  npm run build && npm run preview   → http://localhost:4173
//   deployed (read-only GETs): https://homeops-ai.onrender.com
const PWA = process.env.TOPGUN_PWA_BASEURL;

test.describe("PWA production surface", () => {
  test.skip(
    !PWA,
    "Set TOPGUN_PWA_BASEURL to a production build origin (e.g. http://localhost:4173 after `npm run build && npm run preview`).",
  );

  test("web manifest is served and declares an installable standalone app", async ({ request }) => {
    const page_ = await request.get(`${PWA}/`);
    expect(page_.ok()).toBeTruthy();
    const html = await page_.text();
    const match = html.match(/<link[^>]+rel="manifest"[^>]+href="([^"]+)"/i);
    expect(match, "index.html should link a web manifest").toBeTruthy();
    const manifestUrl = new URL(match![1], `${PWA}/`).toString();
    const res = await request.get(manifestUrl);
    expect(res.ok()).toBeTruthy();
    const manifest = await res.json();
    expect(manifest.name).toBe("FamiliOS");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(Array.isArray(manifest.icons) && manifest.icons.length > 0).toBeTruthy();
  });

  test("service worker registers and controls the page", async ({ page }) => {
    await page.goto(`${PWA}/`, { waitUntil: "load" });
    const swState = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return "unsupported";
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((r) => setTimeout(() => r(null), 15_000)),
      ]);
      return reg ? "active" : "timeout";
    });
    expect(swState, "service worker should reach the active state").toBe("active");
  });

  test("API routes are not hijacked by the SPA shell (navigateFallbackDenylist)", async ({ request }) => {
    const res = await request.get(`${PWA}/api/health`);
    expect(res.status(), "/api/health must be served by the backend, not the SW shell").toBeLessThan(500);
    const type = res.headers()["content-type"] ?? "";
    expect(type.includes("text/html"), "/api/* must never return the SPA HTML shell").toBeFalsy();
  });
});
