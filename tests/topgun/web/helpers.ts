import { expect, type Page } from "@playwright/test";
import { buildEmptyData } from "../../../src/data/seed";

/**
 * Profiles come from the SERVER registry (/api/profiles) — on a fresh/dev backend that's
 * the seeded Harper family (server/seed.mjs), on a lived-in backend it's the real
 * household. Tests therefore resolve profiles dynamically instead of hardcoding names.
 * Override with TOPGUN_WEB_PROFILE when a specific member should be used.
 */

/**
 * Seed the "returning user" state a fresh Playwright profile lacks.
 *
 * App boot (src/store/useStore.ts init → src/storage/db.ts loadAppData) shows
 * Onboarding when NO local AppData exists, and the Lock screen when data exists
 * but no session does. A fresh browser context always lands on Onboarding, so
 * every spec that assumes the Lock screen must seed local data first.
 *
 * loadAppData checks IndexedDB then falls through to localStorage
 * ("homeops-ai:appdata") — a fresh context has an empty IndexedDB, so seeding
 * localStorage via addInitScript (runs before the app's own scripts) is enough.
 * The payload comes from the app's own buildEmptyData so the schema can never
 * drift from what the store expects. No backend calls, no backend writes.
 *
 * Must be called BEFORE the first page.goto().
 */
export async function seedReturningUserState(page: Page) {
  const data = buildEmptyData("TG Harness Household", "TG Harness Local");
  await page.addInitScript((json: string) => {
    try { window.localStorage.setItem("homeops-ai:appdata", json); } catch { /* storage unavailable → app shows its own banner */ }
  }, JSON.stringify(data));
}
export interface LockProfile {
  actorId: string;
  displayName: string;
  role: string;
  pinRequired?: boolean;
}

const lockHeading = (page: Page) => page.getByRole("heading", { name: /who.s using/i });
const commandPalette = (page: Page) => page.getByLabel("Open command palette and search");

export async function getProfiles(page: Page): Promise<LockProfile[]> {
  const res = await page.request.get("/api/profiles").catch(() => null);
  if (!res || !res.ok()) return [];
  const body = (await res.json().catch(() => null)) as { profiles?: LockProfile[] } | null;
  return body?.profiles ?? [];
}

/** Pick a profile: explicit name > TOPGUN_WEB_PROFILE > requested role > first non-PIN > first. */
export async function pickProfile(
  page: Page,
  opts: { name?: string; role?: RegExp } = {},
): Promise<LockProfile | null> {
  const profiles = await getProfiles(page);
  if (!profiles.length) return null;
  const wanted = opts.name ?? process.env.TOPGUN_WEB_PROFILE;
  if (wanted) return profiles.find((p) => p.displayName === wanted) ?? null;
  if (opts.role) {
    const match = profiles.find((p) => opts.role!.test(p.role));
    if (match) return match;
    return null;
  }
  return profiles.find((p) => !p.pinRequired) ?? profiles[0];
}

/**
 * Sign in from the profile Lock screen. Dev-mode backends sign every profile straight
 * in; production-mode backends PIN-gate Owner/Adult Admin — supply TOPGUN_WEB_PIN for
 * those, or target a child/guest profile.
 */
export async function signIn(page: Page, opts: { name?: string; role?: RegExp } = {}) {
  await seedReturningUserState(page); // fresh profiles otherwise land on Onboarding, never Lock
  await page.goto("/");
  await expect(commandPalette(page).or(lockHeading(page)).first()).toBeVisible({ timeout: 20_000 });
  if (await commandPalette(page).isVisible()) return; // already in a session

  const profile = await pickProfile(page, opts);
  if (!profile) {
    throw new Error(
      `No matching profile on this backend (wanted ${JSON.stringify(opts)}; ` +
        `set TOPGUN_WEB_PROFILE to a member of this household, or check /api/profiles).`,
    );
  }
  await page.getByText(profile.displayName, { exact: true }).first().click();

  // Elevated roles may bounce to the owner-PIN card (production-mode backend).
  const pinCard = page.getByText(/enter owner pin/i);
  const entered = lockHeading(page).waitFor({ state: "hidden", timeout: 10_000 }).then(() => "in" as const);
  const pinned = pinCard.waitFor({ state: "visible", timeout: 10_000 }).then(() => "pin" as const);
  const outcome = await Promise.race([entered, pinned]).catch(() => "unknown" as const);

  if (outcome === "pin") {
    const pin = process.env.TOPGUN_WEB_PIN;
    if (!pin) {
      throw new Error(
        `Profile "${profile.displayName}" is PIN-gated by this backend. Run against a dev backend, ` +
          "set TOPGUN_WEB_PIN, or target a child/guest profile via TOPGUN_WEB_PROFILE.",
      );
    }
    await page.getByPlaceholder("••••").fill(pin);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(lockHeading(page)).toBeHidden({ timeout: 15_000 });
  return profile;
}

/** Navigate via the sidebar (desktop) or the drawer (mobile viewports). */
export async function openScreen(page: Page, navLabel: string, opts: { mobile?: boolean } = {}) {
  if (opts.mobile) {
    const drawerToggle = page.getByLabel("Open menu");
    if (await drawerToggle.isVisible()) {
      await drawerToggle.click();
      const drawer = page.getByRole("dialog", { name: "Navigation menu" });
      await drawer.getByRole("button", { name: navLabel, exact: true }).click();
      await drawer.waitFor({ state: "hidden" }).catch(() => {});
      return;
    }
  }
  await page.getByRole("button", { name: navLabel, exact: true }).first().click();
}

/** Assert the runtime pill reports the backend online (sidebar on desktop, drawer on mobile). */
export async function expectRuntimeOnline(page: Page, mobile: boolean) {
  if (!mobile) {
    await expect(page.getByText(/Runtime (online|offline)/)).toBeVisible();
    await expect(page.getByText("Runtime online")).toBeVisible({ timeout: 15_000 });
    return;
  }
  await page.getByLabel("Open menu").click();
  const drawer = page.getByRole("dialog", { name: "Navigation menu" });
  await expect(drawer.getByText("Runtime online")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
}

/** Fail the test on uncaught page exceptions; report console.error noise without failing. */
export function watchPageErrors(page: Page) {
  const uncaught: Error[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => uncaught.push(err));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  return {
    assertClean() {
      if (uncaught.length) {
        throw new Error(`Uncaught page error(s):\n${uncaught.map((e) => e.stack ?? e.message).join("\n---\n")}`);
      }
    },
    consoleErrors,
  };
}
