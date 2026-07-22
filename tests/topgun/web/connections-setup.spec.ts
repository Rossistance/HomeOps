import { expect, test } from "@playwright/test";
import { openScreen, signUpDisposableHousehold, watchPageErrors } from "./helpers";

/**
 * WP-012 — connector provisioning for the gated 13 use-cases (audit/work-packages.md).
 *
 * Proves the real-credential setup checklist (src/data/providerSetup.ts, rendered by
 * src/screens/Connections.tsx) actually surfaces where an admin would look: a
 * not-configured provider card → its drawer's "Set up" toggle → an expanded checklist
 * naming the real console, the scopes needed, the redirect URI, the env vars, which
 * gated UC(s) it unlocks, and the sandbox-twin status. Nothing here provisions a real
 * OAuth app, enters a credential, or completes a consent flow (DEC-016 stays
 * user-owned) — this only proves the DOCUMENTATION path renders correctly.
 *
 * Runs on a FRESH disposable household (tests/topgun/web/helpers.ts
 * signUpDisposableHousehold — a physically separate hh_* tenant DB), so it never reads
 * or depends on the resident household's provider configuration. A dev backend with no
 * deployment OAuth env vars set (the default local setup) reports every provider as
 * `not_configured_by_deployment`, which is exactly the state this spec needs.
 *
 * The dev stack is lead-managed; an unreachable backend skips the file rather than
 * failing it (same guard as run-world.spec.ts / helper-agents-nav.spec.ts).
 */

const EVIDENCE_DIR = "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence";

test.beforeEach(async ({ page }) => {
  const probe = await page.request.get("/api/health").catch(() => null);
  test.skip(!probe || !probe.ok(), "pending-stack-restart — backend on :8787 was unreachable when this spec ran; re-run once the lead has confirmed the dev stack is back up.");
  await signUpDisposableHousehold(page);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    const s = await fetch("/api/session", { credentials: "include" }).then((r) => r.json()).catch(() => null);
    const csrf = s?.session?.csrf;
    await fetch("/api/account", {
      method: "DELETE",
      credentials: "include",
      headers: { "content-type": "application/json", ...(csrf ? { "x-homeops-csrf": csrf } : {}) },
      body: JSON.stringify({ password: "tg-disposable-pass-1" }),
    }).catch(() => {});
  }).catch(() => {});
});

test("a not-configured provider card expands a Set up checklist with scopes + redirect URI visible", async ({ page }) => {
  const errors = watchPageErrors(page);

  await openScreen(page, "Connections");
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible({ timeout: 15_000 });

  // Pick whichever first-party provider card this deployment actually reports as
  // not-configured — which one that is depends on which HOMEOPS_OAUTH_*_CLIENT_ID/SECRET
  // env vars happen to be set locally (a resident dev stack may have real Google
  // credentials configured for other testing), so the spec discovers it dynamically
  // instead of assuming a specific provider is always the unconfigured one.
  const providerCards = page.getByRole("button", { name: /^Open /i });
  await expect(providerCards.first()).toBeVisible({ timeout: 15_000 });
  const cardCount = await providerCards.count();
  let notConfigured = null;
  for (let i = 0; i < cardCount; i++) {
    const card = providerCards.nth(i);
    if (await card.getByText("Setup by admin").count()) { notConfigured = card; break; }
  }
  expect(notConfigured, "expected at least one not-configured-by-deployment provider card on a stack with no OAuth env vars set for every provider").not.toBeNull();
  await notConfigured!.click();

  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Not configured by deployment")).toBeVisible({ timeout: 10_000 });
  // The redirect URI and the two env var names are always visible for a not-configured
  // provider, independent of the checklist toggle below.
  await expect(drawer.getByText(/\/api\/oauth\/callback/)).toBeVisible();
  const envCodes = drawer.locator("li code");
  await expect(envCodes).toHaveCount(2);

  // The checklist itself is collapsed until "Set up" is clicked.
  const setupToggle = drawer.getByRole("button", { name: "Set up" });
  await expect(setupToggle).toBeVisible();
  await expect(page.getByTestId("setup-guide-panel")).toHaveCount(0);

  await setupToggle.click();
  const panel = page.getByTestId("setup-guide-panel");
  await expect(panel).toBeVisible({ timeout: 5_000 });

  // Console link, setup steps, scopes with real OAuth scope strings, env vars, the
  // unlocked UC(s), and the honest sandbox-twin note all render inside the checklist.
  await expect(panel.getByText("Setup steps", { exact: true })).toBeVisible();
  await expect(panel.locator("ol li").first()).toBeVisible();
  await expect(panel.getByText("Scopes needed", { exact: true })).toBeVisible();
  await expect(panel.getByText("Env vars", { exact: true })).toBeVisible();
  await expect(panel.getByText("Unlocks", { exact: true })).toBeVisible();
  await expect(panel.getByText(/^UC-\d+ · /).first()).toBeVisible();
  await expect(panel.getByText(/Verify inside FamiliOS:/)).toBeVisible();
  await expect(panel.getByText(/sandbox twin/i)).toBeVisible();

  await page.screenshot({ path: `${EVIDENCE_DIR}/wp012-setup-checklist.png`, fullPage: true });

  // Toggling again hides it — the affordance is a real expand/collapse, not one-shot reveal.
  await drawer.getByRole("button", { name: "Hide setup guide" }).click();
  await expect(page.getByTestId("setup-guide-panel")).toHaveCount(0);

  errors.assertClean();
});
