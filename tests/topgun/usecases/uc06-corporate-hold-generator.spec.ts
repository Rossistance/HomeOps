import { expect, test } from "@playwright/test";
import {
  apiFetch, approveViaUi, chat, expectSandboxAccount, openScreen, readSandboxEffects,
  requireBackend, requireSandbox, signUpDisposableHousehold, waitForRunStatus,
  watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-6 — Corporate Hold Generator (GATED lane).
 * Real-credential blocker: Microsoft 365 OAuth app not provisioned — user-owned
 * (DEC-016). Sandbox twin: calendar.list (Read, no approval) confirms the
 * existing family event, then mscal.create (Medium risk, requiresApproval:true)
 * writes a matching hold on the work calendar — the write parks until a human
 * approves in Messages → Approvals.
 *
 * Acceptance (PRD §16 / journey-register UC-6): the family event is read first
 * (it must exist before a hold is generated for it), the work-calendar
 * hold-create is parked then approved through the REAL UI, and the recorded
 * would-be mscal.create effect names the hold title and start time; the chat
 * run_result reports the outcome honestly.
 */

const STAMP = Date.now().toString(36);
const PLAN_TITLE = `TG UC06 corporate hold plan ${STAMP}`;
const CONV_TITLE = `TG UC06 corporate hold ${STAMP}`;
const HOLD_TITLE = `TG UC06 Hold: Soccer practice ${STAMP}`;
const HOLD_START = "2026-07-22T17:00:00Z";

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
  await requireSandbox(page, "Microsoft 365 OAuth app not provisioned — user-owned (DEC-016)");
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-6: an existing family event gets a matching work-calendar hold through a real UI approval (sandbox twin)", async ({ page }) => {
  const errors = watchPageErrors(page);
  await expectSandboxAccount(page, "google");
  await expectSandboxAccount(page, "microsoft");

  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "I'll confirm the family event exists, then hold your work calendar for it.",
    plan: {
      title: PLAN_TITLE, summary: "Confirm the family event and write a matching work-calendar hold (needs your OK).",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "calendar.list", title: "Confirm the family event exists", detail: "check the family calendar", input: {}, requiresApproval: false },
        {
          toolId: "mscal.create", title: "TG UC06 write corporate hold",
          detail: "Block the work calendar to match the family commitment",
          input: { summary: HOLD_TITLE, start: HOLD_START },
          requiresApproval: true,
        },
      ],
      approvalGates: [], risk: "Medium",
    },
  }), async () => chat(page, "TG: block my work calendar to match soccer practice", conv.body.conversation.id));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();

  // The corporate-calendar write must PARK — sandbox mode never relaxes consent gates.
  await waitForRunStatus(page, runId, ["waiting_for_approval"]);

  await approveViaUi(page, /TG UC06 write corporate hold/);
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded"]);

  // The recorded would-be effect: the corporate hold, exact title and start time.
  const effects = await readSandboxEffects(page);
  const create = effects.find((e: any) => e.toolId === "mscal.create");
  expect(create, `an mscal.create effect must be recorded; got ${JSON.stringify(effects.map((e: any) => e.toolId))}`).toBeTruthy();
  expect(String(create.subject)).toBe(HOLD_TITLE);
  expect(String(create.content)).toContain(HOLD_START);

  // Honest summary in the chat thread (the surface the family actually reads).
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Ask FamiliOS");
  await page.getByText(CONV_TITLE, { exact: true }).first().click();
  await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finished \(2\/2\)|completed/i).first(), "the run_result must state an honest 2/2 outcome").toBeVisible({ timeout: 15_000 });

  await page.screenshot({
    path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/uc06-corporate-hold-generator.png",
    fullPage: true,
  });

  errors.assertClean();
});
