import { expect, test } from "@playwright/test";
import { openScreen, pickProfile, signIn, watchPageErrors } from "./helpers";

// TC-WEB core flows: state-based navigation (no per-screen URLs — must click nav),
// command palette, assistant input, calendar controls, role scoping.

const OWNER = { role: /owner|adult admin/i };

// Non-advanced nav surface (Skills/Functions are Advanced Mode-gated; see Shell.tsx NAV_GROUPS).
const NAV_LABELS = [
  "Home",
  "Ask FamiliOS",
  "Calendar",
  "Helper Agents",
  "Automations",
  "Messages & Approvals",
  "Meals",
  "Household Spaces",
  "Mini Apps",
  "Files & Knowledge",
  "Activity & Memory",
  "Connections",
  "Settings",
];

test("primary navigation reaches every owner screen without page errors", async ({ page, isMobile }) => {
  test.skip(isMobile === true, "Desktop sidebar walk; the mobile variant below covers drawer + bottom nav.");
  const errors = watchPageErrors(page);
  await signIn(page, OWNER);
  for (const label of NAV_LABELS) {
    const navButton = page.getByRole("button", { name: label, exact: true }).first();
    await navButton.click();
    await expect(navButton, `nav item "${label}" should become the current screen`).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  errors.assertClean();
});

test("mobile: bottom nav + drawer navigation work", async ({ page, isMobile }) => {
  test.skip(isMobile !== true, "Mobile-viewport variant (web-webkit-iphone project).");
  const errors = watchPageErrors(page);
  await signIn(page, OWNER);
  // Bottom nav primaries (Shell.tsx MOBILE_PRIMARY): Home, Helper Agents, Automations, Messages & Approvals.
  for (const label of ["Helper Agents", "Automations", "Home"]) {
    await page.getByRole("button", { name: label, exact: true }).last().click();
  }
  // A non-primary screen must be reachable through the drawer.
  await openScreen(page, "Calendar", { mobile: true });
  await expect(page.getByRole("tablist", { name: "Calendar view" })).toBeVisible();
  errors.assertClean();
});

test("command palette opens and closes", async ({ page }) => {
  await signIn(page, OWNER);
  await page.getByLabel("Open command palette and search").click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test("assistant screen exposes the ask input", async ({ page, isMobile }) => {
  await signIn(page, OWNER);
  await openScreen(page, "Ask FamiliOS", { mobile: isMobile === true });
  await expect(page.getByLabel(/Ask FamiliOS|Message FamiliOS/).first()).toBeVisible();
});

test("calendar renders view tabs and month controls", async ({ page, isMobile }) => {
  await signIn(page, OWNER);
  await openScreen(page, "Calendar", { mobile: isMobile === true });
  await expect(page.getByRole("tablist", { name: "Calendar view" })).toBeVisible();
  await expect(page.getByLabel("Previous month")).toBeVisible();
  await expect(page.getByLabel("Next month")).toBeVisible();
});

test("authorization-negative: child profile does not see admin surfaces", async ({ page }) => {
  await page.goto("/");
  const child = await pickProfile(page, { role: /child/i });
  test.skip(!child, "No Child-role profile exists on this backend — authorization-negative case not applicable.");
  await signIn(page, { name: child!.displayName });
  // Child View is role-scoped: approvals/settings-class admin nav must be absent.
  await expect(page.getByRole("button", { name: "Messages & Approvals", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connections", exact: true })).toHaveCount(0);
});
