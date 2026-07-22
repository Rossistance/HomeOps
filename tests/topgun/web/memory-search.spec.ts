import { expect, test } from "@playwright/test";
import { openScreen, signUpDisposableHousehold, watchPageErrors } from "./helpers";

/**
 * WP-007 s5 (DEC-014) — retrieval-grade memory is visible where a family member
 * would look: Activity & Memory → Memory tab search finds a fact a run just wrote.
 *
 * Backend note: on this host the provider is the DEC-014 node:sqlite FTS5 hybrid
 * (Supermemory's sidecar has no native Windows path — WSL only). The UI contract
 * is provider-agnostic: healthy → search works; degraded → an honest banner.
 */

const EVIDENCE_DIR = "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence";

test("a fact written by a run is findable in the Memory tab search", async ({ page }) => {
  const errors = watchPageErrors(page);
  await signUpDisposableHousehold(page);

  const stamp = Date.now();
  const fact = `TG-memory fact ${stamp}: the backyard fence sign-off is scheduled for Saturday.`;
  // Write the memory the way the product does — through a real run step.
  const started = await page.evaluate(async (text) => {
    const s = await fetch("/api/session", { credentials: "include" }).then((r) => r.json()).catch(() => null);
    const csrf = s?.session?.csrf;
    const r = await fetch("/api/runs/start", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json", ...(csrf ? { "x-homeops-csrf": csrf } : {}) },
      body: JSON.stringify({
        source: "manual",
        plan: { title: "TG-memory writer", summary: "TG memory-search spec", steps: [{ toolId: "homeops.write_memory", title: "Remember the fence plan", input: { text, scope: "household" }, requiresApproval: false }] },
      }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, fact);
  expect(started.status, JSON.stringify(started.body).slice(0, 200)).toBe(200);
  // Server truth: the run completes.
  await expect(async () => {
    const run = await page.evaluate(async (id) => (await fetch(`/api/runs/${id}`, { credentials: "include" }).then((r) => r.json()))?.run, started.body.run.id);
    expect(run?.status).toBe("completed");
  }).toPass({ timeout: 20_000 });

  // The family surface: Activity & Memory → Memory tab → search "fence".
  await openScreen(page, "Activity & Memory");
  await page.getByRole("tab", { name: /memory/i }).or(page.getByRole("button", { name: /^Memory$/ })).first().click();
  // Two memory search boxes exist: the legacy local-list filter ("Search memory…")
  // and the provider search — target the provider one by its full aria-label.
  const search = page.getByLabel("Search memory across your household's full recall history");
  await expect(search, "the Memory tab must expose the provider search box").toBeVisible({ timeout: 10_000 });
  await search.fill("fence");
  await search.press("Enter");
  await expect(page.getByText(/fence sign-off is scheduled for Saturday/i).first(), "the searched fact must render in the results").toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp007-memory-search.png`, fullPage: true });
  errors.assertClean();
});
