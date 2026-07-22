import { expect, test } from "@playwright/test";
import {
  apiFetch, approveViaUi, chat, openMessagesTab, openScreen, requireBackend,
  signUpDisposableHousehold, waitForRunStatus, watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-21 — Multi-Channel Meal Planner & Sign-Off (ACTIVE lane; in-app truth only).
 * External delivery channels (SMS/email digest of the plan) are OUT of this lane —
 * journey-register.md row 21 flags ISS-001/003/004 as the external-delivery chain;
 * this spec proves the two things that ARE fully in-app: the meal plan lands
 * (homeops.plan_meal) and the household sign-off is a REAL, decidable approval
 * (homeops.create_approval — server-forced requiresApproval:true, the same
 * inbox-truth.spec.ts / run-world.spec.ts contract), decided through the real
 * Messages → Approvals UI, never the decide API directly.
 *
 * Acceptance (journey-register.md row 21 / PRD §16, in-app scope): "meal plan …
 * visible on Meals … sign-off approval card in Inbox" — read here as the real
 * Approvals surface, since that is where a decidable sign-off card actually lives.
 */

const STAMP = Date.now().toString(36);
const MEAL_TITLE = `TG UC21 taco night ${STAMP}`;
const TODAY = new Date().toISOString().slice(0, 10);
const SIGNOFF_STEP_TITLE = `TG UC21 sign off on the week's meals ${STAMP}`;
const SIGNOFF_SUBJECT = `TG UC21 approve meal plan ${STAMP}`;
const CONV_TITLE = `TG UC21 meal planning ${STAMP}`;
const EVIDENCE_DIR = "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence";

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-21: a planned meal parks for a real sign-off, and both the plan and the decided approval are visible in-app", async ({ page }) => {
  const errors = watchPageErrors(page);

  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);
  const conversationId = conv.body.conversation.id;

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "Planning taco night and asking for your sign-off.",
    plan: {
      title: `TG UC21 meal plan ${STAMP}`, summary: "Plan a meal, then ask the household to sign off on it.",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        {
          toolId: "homeops.plan_meal", title: "Plan taco night", detail: MEAL_TITLE,
          input: { title: MEAL_TITLE, date: TODAY, slot: "dinner", ingredients: ["tortillas", "cheese", "salsa", "ground beef"], servings: 4 },
          requiresApproval: false,
        },
        {
          toolId: "homeops.create_approval", title: SIGNOFF_STEP_TITLE, detail: `Approve the ${MEAL_TITLE} plan for this week.`,
          input: { subject: SIGNOFF_SUBJECT, detail: `Approve the ${MEAL_TITLE} plan for this week.` },
          requiresApproval: true,
        },
      ],
      approvalGates: [], risk: "Medium",
    },
  }), async () => chat(page, "TG: plan taco night this week and get sign-off from the household", conversationId));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();

  // The meal plans instantly (Low risk, no approval); the sign-off is High/gated by
  // the server catalog (create_approval is requiresApproval:true unconditionally,
  // server-authoritative regardless of what the plan step declares) — the run must park.
  await waitForRunStatus(page, runId, ["waiting_for_approval"]);

  // Server truth so far: the meal already landed even though the run hasn't finished
  // (plan_meal ran to completion before the second step parked).
  const meals = await apiFetch(page, "/api/meals");
  const meal = (meals.body?.meals ?? []).find((m: any) => m.title === MEAL_TITLE);
  expect(meal, "the planned meal must exist server-side before the run completes").toBeTruthy();

  // UI truth 1 — the meal plan is visible on Meals.
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Meals");
  await expect(page.getByText(MEAL_TITLE).first(), "the planned meal must be visible on the Meals screen").toBeVisible({ timeout: 15_000 });

  // Decide THROUGH THE REAL UI: Messages → Approvals → Approve.
  await approveViaUi(page, new RegExp(SIGNOFF_STEP_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded"]);

  // UI truth 2 — the decided sign-off is visible IN Messages → Approvals: no
  // Approve/Deny controls remain, and a decided status now renders (inbox-truth.spec.ts
  // WP-001 contract — the approval's home is the Approvals tab, not just the run record).
  await openMessagesTab(page, "Approvals");
  const cardAfter = page.locator("div.card-pad", { hasText: SIGNOFF_STEP_TITLE }).first();
  await expect(cardAfter, "the decided sign-off card must still be visible in Approvals").toBeVisible({ timeout: 15_000 });
  await expect(cardAfter.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await expect(cardAfter.getByText(/^Approved/).first(), "the card must show a decided status in the UI").toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${EVIDENCE_DIR}/uc21-meal-planner-signoff.png`, fullPage: true });

  errors.assertClean();
});
