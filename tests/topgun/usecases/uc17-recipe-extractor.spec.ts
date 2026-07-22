import { expect, test } from "@playwright/test";
import http from "node:http";
import {
  apiFetch, chat, openScreen, requireBackend, signUpDisposableHousehold,
  waitForRunStatus, watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-17 — Smart Recipe Extractor (ACTIVE lane; journey-register.md:
 * "RUNNABLE-NOW — not exercised live"). Acceptance (PRD §16): recipe card with
 * ingredients + steps + source link in chat, via the `web` connector's
 * web.recipe tool (server/connectors.mjs:126, executed at connectors.mjs:538-542,
 * server/web.mjs extractRecipe → readPage).
 *
 * ENVIRONMENT GAP (found while writing this spec, reported per the mission's
 * explicit fallback instruction): web.recipe's readPage calls
 * `safeFetch(target, ..., {timeoutMs, maxBytes})` with no `allowLoopback`
 * override (server/web.mjs:290) — the SSRF guard's default (`allowLoopback:
 * false`, server/net.mjs:51) refuses loopback targets, and hitting a real
 * external recipe site is separately banned (benchmark must be hermetic; no
 * external sends). A local node:http fixture recipe page (the mission's
 * preferred approach) is therefore refused before any content is ever read —
 * `readPage` returns `fetch_failed` naming the guard's `loopback_blocked`
 * reason (server/web.mjs:326). This spec proves the honest refusal path through
 * the real UI instead of fabricating a recipe card: the chat run reports it
 * didn't finish, and no recipe artifact/card text appears anywhere. No net.mjs
 * code was touched or weakened to make this pass.
 */

const STAMP = Date.now().toString(36);
const PLAN_TITLE = `TG UC17 recipe extraction plan ${STAMP}`;
const CONV_TITLE = `TG UC17 recipe extraction ${STAMP}`;
const RECIPE_TITLE = `TG UC17 Chili ${STAMP}`;

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-17: chat-driven recipe extraction — the egress guard's honest refusal (not a fabricated recipe card) lands in chat", async ({ page }) => {
  const errors = watchPageErrors(page);

  // Local fixture recipe page (schema.org/Recipe JSON-LD) — never actually read:
  // the egress guard refuses the loopback target before any fetch happens (see
  // the file-level note above).
  const fixture = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<html><head><script type="application/ld+json">${JSON.stringify({
      "@type": "Recipe", name: RECIPE_TITLE,
      recipeIngredient: ["1 lb ground beef", "1 can beans"],
      recipeInstructions: [{ "@type": "HowToStep", text: "Brown the beef." }, { "@type": "HowToStep", text: "Add beans and simmer." }],
    })}</script></head><body><h1>${RECIPE_TITLE}</h1></body></html>`);
  });
  await new Promise<void>((resolve) => fixture.listen(0, resolve));
  const port = (fixture.address() as { port: number }).port;

  try {
    const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
    expect(conv.status, JSON.stringify(conv.body)).toBe(200);

    const done = await withFakeAiProvider(page, () => ({
      kind: "plan",
      answer: "Extracting that chili recipe now.",
      plan: {
        title: PLAN_TITLE, summary: "Read the recipe page and extract ingredients + steps.",
        icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
        steps: [
          { toolId: "web.recipe", title: "Extract the chili recipe", detail: RECIPE_TITLE, input: { url: `http://127.0.0.1:${port}/chili` }, requiresApproval: false },
        ],
        approvalGates: [], risk: "Low",
      },
    }), async () => chat(page, "TG: grab that chili recipe and pull out the ingredients and steps", conv.body.conversation.id));

    const runId = done?.run?.id;
    expect(runId, "the chat plan must auto-start a run").toBeTruthy();

    // web.recipe is the run's ONLY (final) step — the guard's refusal hard-fails
    // the run; there is no recipe card to salvage.
    const run = await waitForRunStatus(page, runId, ["failed"]);
    expect(run.steps[0].status).toBe("failed");
    expect(String(run.steps[0].detail), "the extraction step must report the real fetch/egress refusal, not a fabricated recipe").toMatch(/blocked|fetch_failed|could not read/i);

    // Honest outcome in the chat thread — never fabricates a recipe card it
    // couldn't actually read.
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await openScreen(page, "Ask FamiliOS");
    await page.getByText(CONV_TITLE, { exact: true }).first().click();
    await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
    // Real server-side wording (server/assistant-runs.mjs runOutcomeText): a failed
    // run reports `"{title}" failed at step N (...): {error}.` — never a fabricated success.
    await expect(page.getByText(/failed at step \d/i).first(), "the run_result must honestly report the run failed, not a fabricated success").toBeVisible({ timeout: 15_000 });
    // No-fabricated-success check: the recipe's own title/ingredients must not
    // appear anywhere in the thread — nothing was actually extracted.
    await expect(page.getByText("1 lb ground beef")).toHaveCount(0);

    await page.screenshot({ path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/uc17-recipe-extractor.png", fullPage: true });

    errors.assertClean();
  } finally {
    await new Promise((r) => fixture.close(r));
  }
});
