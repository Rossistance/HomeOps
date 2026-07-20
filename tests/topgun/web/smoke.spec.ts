import { expect, test } from "@playwright/test";
import { expectRuntimeOnline, getProfiles, seedReturningUserState, signIn, watchPageErrors } from "./helpers";

// TC-WEB smoke lane: app boots, session establishes, shell + backend link are truthful.
// Profiles are resolved from /api/profiles (real household or seeded Harpers) — nothing
// is hardcoded to seed data. Every test seeds the returning-user local state first
// (see seedReturningUserState) — a fresh browser profile otherwise boots to Onboarding.

test("app boots to the profile lock screen with the server roster", async ({ page }) => {
  const errors = watchPageErrors(page);
  await seedReturningUserState(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /who.s using/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/choose a profile to continue/i)).toBeVisible();
  const profiles = await getProfiles(page);
  expect(profiles.length, "backend /api/profiles should list at least one household member").toBeGreaterThan(0);
  await expect(page.getByText(profiles[0].displayName, { exact: true }).first()).toBeVisible();
  await expect(page).toHaveTitle(/familios|homeops/i);
  errors.assertClean();
});

test("a household member signs in and reaches the shell with the backend online", async ({ page, isMobile }) => {
  const errors = watchPageErrors(page);
  const profile = await signIn(page, { role: /owner|adult admin/i });
  test.info().annotations.push({ type: "profile", description: `${profile?.displayName} (${profile?.role})` });
  // Post-auth chrome: the command bar is the shell's always-present affordance.
  await expect(page.getByLabel("Open command palette and search")).toBeVisible();
  // Integration truth, not decoration: the pill reflects a real /api health state.
  await expectRuntimeOnline(page, isMobile === true);
  errors.assertClean();
});

test("sign out returns to the lock screen", async ({ page, isMobile }) => {
  test.skip(isMobile === true, "Sign-out control lives in the desktop sidebar; mobile drawer variant tracked in core-flows.");
  await signIn(page, { role: /owner|adult admin/i });
  await page.getByLabel("Sign out / switch profile").click();
  await expect(page.getByRole("heading", { name: /who.s using/i })).toBeVisible({ timeout: 15_000 });
});
