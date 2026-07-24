import { expect, test, type Page } from "@playwright/test";
import { openScreen, signUpDisposableHousehold, watchPageErrors } from "./helpers";

/**
 * WP-107 / ISS-115 — "I have no idea why it's throwing me around everywhere… so
 * aggravating." Observed by all five personas.
 *
 * The router was flat: navigate() replaced `route` and kept no history, so there was no
 * parent to return to, and because nothing ever called pushState the browser's own Back
 * button unloaded the whole SPA. This proves the two halves of the acceptance criterion:
 * Back returns to the IMMEDIATE parent, and it restores the scroll position.
 *
 * The active screen is asserted via the nav's aria-current="page", which is the app's own
 * statement about where it thinks it is.
 */

const activeNav = (page: Page) => page.locator('button[aria-current="page"]');
const backButton = (page: Page) => page.getByRole("button", { name: "Back", exact: true });

test.beforeEach(async ({ page }) => {
  const probe = await page.request.get("/api/health").catch(() => null);
  test.skip(!probe || !probe.ok(), "pending-stack-restart — backend on :8787 was unreachable when this spec ran.");
  await signUpDisposableHousehold(page);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    const s = await fetch("/api/session", { credentials: "include" }).then((r) => r.json()).catch(() => null);
    await fetch("/api/account", {
      method: "DELETE", credentials: "include",
      headers: { "content-type": "application/json", ...(s?.session?.csrf ? { "x-homeops-csrf": s.session.csrf } : {}) },
      body: JSON.stringify({ password: "tg-disposable-pass-1" }),
    }).catch(() => {});
  }).catch(() => {});
});

test("ISS-115: no Back is offered on the landing screen — it never promises a move it can't make", async ({ page }) => {
  const errors = watchPageErrors(page);
  await expect(activeNav(page).first()).toBeVisible({ timeout: 15_000 });
  await expect(backButton(page)).toHaveCount(0);
  errors.assertClean();
});

test("ISS-115: Back returns to the IMMEDIATE parent, not out of the section", async ({ page }) => {
  const errors = watchPageErrors(page);

  await openScreen(page, "Helper Agents");
  await expect(activeNav(page).first()).toHaveText(/Helper Agents/);

  await openScreen(page, "Connections");
  await expect(activeNav(page).first()).toHaveText(/Connections/);

  // The whole complaint in one assertion: this must land on Helper Agents — the place we
  // came from — not on Home and not outside the app.
  await backButton(page).click();
  await expect(activeNav(page).first()).toHaveText(/Helper Agents/);

  // And again, one more level, to prove it's a stack rather than a single remembered slot.
  await backButton(page).click();
  await expect(activeNav(page).first()).toHaveText(/Home/);
  await expect(backButton(page)).toHaveCount(0, { timeout: 5_000 });
  errors.assertClean();
});

test("ISS-115: Back restores the scroll position it left from", async ({ page }) => {
  const errors = watchPageErrors(page);
  // A SHORT viewport guarantees the content overflows — otherwise this test quietly skips
  // at full desktop height and scroll restoration goes unproven, which is half the
  // acceptance criterion. Width stays >= the lg breakpoint on purpose: below it the
  // sidebar collapses behind the mobile drawer and openScreen can't reach the nav.
  await page.setViewportSize({ width: 1280, height: 400 });
  await openScreen(page, "Settings");

  // Settings loads its data async, so wait for <main> to ACTUALLY overflow before
  // scrolling — setting scrollTop on a container that isn't tall enough yet silently
  // does nothing, and the test would then prove nothing while appearing to pass.
  await page.waitForFunction(
    () => { const el = document.querySelector("main"); return !!el && el.scrollHeight - el.clientHeight > 150; },
    undefined, { timeout: 15_000 },
  );

  // Scroll the real scroll container (<main>), not the window.
  const scrolled = await page.evaluate(() => {
    const el = document.querySelector("main");
    if (!el) return 0;
    el.scrollTop = 300;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
    return el.scrollTop;
  });
  expect(scrolled, "the container must actually hold the offset").toBeGreaterThan(100);

  await openScreen(page, "Connections");
  // A forward move starts at the top — otherwise arriving somewhere new is its own
  // disorientation.
  expect(await page.evaluate(() => document.querySelector("main")?.scrollTop ?? -1)).toBe(0);

  await backButton(page).click();
  await expect(activeNav(page).first()).toHaveText(/Settings/);
  // Restoration is applied on the frame after paint, so allow the offset to land.
  await page.waitForFunction(
    () => (document.querySelector("main")?.scrollTop ?? 0) > 150,
    undefined, { timeout: 10_000 },
  );
  errors.assertClean();
});
