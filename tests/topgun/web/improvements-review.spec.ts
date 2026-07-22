import { expect, test } from "@playwright/test";
import { openScreen, signUpDisposableHousehold, watchPageErrors } from "./helpers";

/**
 * WP-008a (ISS-007/DEC-015/HYP-002) — the Improvements (evolution) tab gets a
 * before/after diff and a Revert action, so an accepted self-change is reviewable
 * and undoable instead of a black box.
 *
 * SEEDING: no AI provider is configured on this host, so an evolution can't be
 * produced through the real proposeEvolution/failed-run path. Per the mission's own
 * fallback instruction, this spec seeds through the server's EXISTING, legitimate
 * manual-propose route instead (POST /api/evolution, kind: "agent" — an Adult Admin
 * proposing an improvement by hand is a real, supported flow, not a test-only
 * backdoor) and accepts it through the existing POST /api/evolution/:id/review route.
 * Both routes are live in server/index.mjs today.
 *
 * KNOWN GAP (documented honestly, not silently worked around): the before/after diff
 * data (`before`, `revertible` on GET /api/evolution) and the revert endpoint itself
 * (POST /api/evolutions/:id/revert) are WP-008a's HANDOFF ITEMS for server/index.mjs —
 * owned by another work package this wave and not yet wired into the running server.
 * This spec is written against the POST-HANDOFF behavior (what the lead's index.mjs
 * integration produces) and was authored/typechecked but NOT executed against the live
 * shared dev server in this session — doing so requires that handoff to land, and the
 * dev stack is lead-managed / must not be restarted. Once the handoff is merged, this
 * spec should pass unmodified.
 */

const EVIDENCE_DIR = "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence";
const ORIGINAL_INSTRUCTIONS = "Original household-assistant instructions, pre-improvement.";
const IMPROVED_INSTRUCTIONS = "Improved instructions: always confirm delivery before marking a task done.";

/** Manually propose + accept an agent evolution via the server's own routes (no AI
 *  needed) — a real, Adult-Admin-authorized flow, not a fixture bypassing the app. */
async function seedAcceptedAgentEvolution(page: import("@playwright/test").Page) {
  return await page.evaluate(
    async ({ before, after }) => {
      const j = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) });
      // Mutations are CSRF-gated — carry the session token like the app does.
      const s = await fetch("/api/session", { credentials: "include" }).then((r) => r.json()).catch(() => null);
      const H = { "content-type": "application/json", ...(s?.session?.csrf ? { "x-homeops-csrf": s.session.csrf } : {}) };
      // Fresh disposable households have no agents — create the evolution target
      // through the real registry route (server-verified id, same flow as the app).
      const createdAgent = await j(await fetch("/api/agents", {
        method: "POST", credentials: "include", headers: H,
        body: JSON.stringify({ name: "TG-Improvements Agent", purpose: "improvements-review spec target", instructions: before, status: "Active" }),
      }));
      const agent = createdAgent.body?.agent;
      if (!agent) throw new Error(`agent create failed: ${JSON.stringify(createdAgent).slice(0, 200)}`);
      const proposed = await j(await fetch("/api/evolution", {
        method: "POST", credentials: "include", headers: H,
        body: JSON.stringify({
          kind: "agent", agentId: agent.id, title: "Manual test improvement",
          reason: "Seeded by improvements-review.spec.ts", summary: "Confirm delivery before marking done.",
          after, risk: "Low",
        }),
      }));
      const evoId = proposed.body?.evolution?.id;
      if (!evoId) throw new Error(`propose failed: ${JSON.stringify(proposed)}`);
      const accepted = await j(await fetch(`/api/evolution/${evoId}/review`, {
        method: "POST", credentials: "include", headers: H,
        body: JSON.stringify({ accept: true }),
      }));
      if (!accepted.body?.applied) throw new Error(`accept did not apply: ${JSON.stringify(accepted)}`);
      return { agentId: agent.id, evoId };
    },
    { before: ORIGINAL_INSTRUCTIONS, after: IMPROVED_INSTRUCTIONS },
  );
}

test("Improvements tab shows a before/after diff and Revert restores the prior instructions", async ({ page }) => {
  const errors = watchPageErrors(page);
  await signUpDisposableHousehold(page);

  const { agentId, evoId } = await seedAcceptedAgentEvolution(page);

  await openScreen(page, "Activity & Memory");
  await page.getByRole("button", { name: "Improvements", exact: false }).click();

  const card = page.locator("text=Manual test improvement").first();
  await expect(card, "the accepted improvement should appear in the list").toBeVisible({ timeout: 15_000 });

  // Expand the before/after diff.
  const toggle = page.getByText("Before / after", { exact: true }).first();
  await toggle.click();
  await expect(page.getByText(ORIGINAL_INSTRUCTIONS, { exact: false }).first(), "Before block shows the pre-change text").toBeVisible();
  await expect(page.getByText(IMPROVED_INSTRUCTIONS, { exact: false }).first(), "After block shows the applied text").toBeVisible();

  await page.screenshot({ path: `${EVIDENCE_DIR}/wp008a-diff.png`, fullPage: true });

  // Revert, with the confirm step.
  const revertButton = page.getByRole("button", { name: "Revert", exact: true }).first();
  await expect(revertButton, "a Revert action should be offered on an accepted, still-live change").toBeVisible();
  await revertButton.click();
  await expect(page.getByText("Revert this improvement?")).toBeVisible();
  await page.getByRole("button", { name: "Revert", exact: true }).last().click(); // confirm inside the modal

  await expect(page.getByText("Reverted", { exact: false }).first(), "the row flips to reverted").toBeVisible({ timeout: 10_000 });

  // Assert the restore via the API (source of truth), not just the UI label.
  const agentAfterRevert = await page.evaluate(async (id) => {
    const r = await fetch(`/api/agents/${id}`, { credentials: "include" });
    return (await r.json())?.agent;
  }, agentId);
  expect(agentAfterRevert?.instructions).toBe(ORIGINAL_INSTRUCTIONS);

  const evoAfterRevert = await page.evaluate(async () => {
    const r = await fetch("/api/evolution", { credentials: "include" });
    return (await r.json())?.evolutions ?? [];
  });
  const revertedRow = (evoAfterRevert as Array<{ id: string; status: string }>).find((e) => e.id === evoId);
  expect(revertedRow?.status).toBe("reverted");

  await page.screenshot({ path: `${EVIDENCE_DIR}/wp008a-reverted.png`, fullPage: true });
  errors.assertClean();
});
