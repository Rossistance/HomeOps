import { test, expect, type Page } from "@playwright/test";
import { signIn, openScreen } from "../web/helpers";
// The demo household's own lists, so the spec and the seed can never disagree about a title.
import { WORK_TITLES } from "../../../scripts/seed-calendar-demo.mjs";

// ADR-005 on the web client: someone else's Work calendar arrives as "<Name> working" blocks
// and its meeting titles appear nowhere in the page — not in text, not in an attribute. The
// owner still sees her own. Seeded by scripts/seed-calendar-demo.mjs (calendar-privacy.config.ts).

/** The seed finishes a moment after the server answers /api/health: wait for Beannie. */
async function waitForSeed(page: Page) {
  await expect.poll(async () => {
    const r = await page.request.get("/api/profiles").catch(() => null);
    if (!r || !r.ok()) return false;
    const body = (await r.json().catch(() => null)) as { profiles?: { displayName: string }[] } | null;
    return (body?.profiles ?? []).some((p) => p.displayName === "Beannie");
  }, { timeout: 45_000, message: "the demo household was never seeded" }).toBe(true);
}

test.beforeEach(async ({ page }) => { await waitForSeed(page); });

test("Alex sees \"Beannie working\" and none of her Work meeting titles", async ({ page }, info) => {
  await signIn(page, { name: "Alex" });
  await openScreen(page, "Calendar");
  await expect(page.getByRole("tablist", { name: "Calendar view" })).toBeVisible();
  await expect(page.getByText("Beannie working").first()).toBeVisible();
  // Something else of Beannie's that is NOT hidden still shows — the page did load her.
  await expect(page.getByText("Beannie pottery class").first()).toBeVisible();

  const html = await page.content();
  for (const title of WORK_TITLES) {
    expect(html, `"${title}" must not reach Alex's page`).not.toContain(title);
  }
  await page.screenshot({ path: info.outputPath("alex-calendar-list.png"), fullPage: true });
  // The month grid draws the same data a second way (day cells, no titles); no leak there either.
  await page.getByRole("tab", { name: /month/i }).click();
  await expect(page.getByRole("tab", { name: /month/i })).toHaveAttribute("aria-selected", "true");
  const monthHtml = await page.content();
  for (const title of WORK_TITLES) expect(monthHtml, `"${title}" in the month view`).not.toContain(title);
});

test("Beannie sees her own Work meeting titles", async ({ page }, info) => {
  await signIn(page, { name: "Beannie" });
  await openScreen(page, "Calendar");
  await expect(page.getByRole("tablist", { name: "Calendar view" })).toBeVisible();
  for (const title of ["Team standup", "Q3 roadmap review", "Budget sync"]) {
    await expect(page.getByText(title).first(), `${title} is Beannie's own`).toBeVisible();
  }
  // Her own time is never a block to her.
  await expect(page.getByText("Beannie working")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("beannie-calendar-list.png"), fullPage: true });
});
