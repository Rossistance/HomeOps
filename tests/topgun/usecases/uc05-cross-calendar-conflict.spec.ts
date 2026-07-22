import { expect, test } from "@playwright/test";
import {
  apiFetch, approveViaUi, chat, expectSandboxAccount, openScreen, readSandboxEffects,
  requireBackend, requireSandbox, signUpDisposableHousehold, waitForRunStatus,
  watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-5 — Cross-Calendar Conflict Sync (GATED lane).
 * Real-credential blocker: Microsoft 365 + Google OAuth apps not provisioned —
 * user-owned (DEC-016). Sandbox twin: mscal.list + calendar.list (both Read, no
 * approval) read both calendars, then mscal.create (Medium risk,
 * requiresApproval:true) writes a sync hold on the work calendar for the
 * conflicting Google event — the write parks until approved.
 *
 * Acceptance (PRD §16 / journey-register UC-5): both calendars are read, the
 * hold-create is parked then approved through the REAL UI, and the recorded
 * would-be mscal.create effect names the hold title (carrying the conflicting
 * Google event's summary) and start time; the chat run_result reports the
 * outcome honestly.
 */

const STAMP = Date.now().toString(36);
const PLAN_TITLE = `TG UC05 cross-calendar sync plan ${STAMP}`;
const CONV_TITLE = `TG UC05 cross-calendar sync ${STAMP}`;
const HOLD_TITLE = `TG UC05 Hold: Dentist — Noah ${STAMP}`;
const HOLD_START = "2026-07-22T15:00:00Z";

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
  await requireSandbox(page, "Microsoft 365 + Google OAuth apps not provisioned — user-owned (DEC-016)");
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-5: both calendars are read, a conflicting event gets a synced hold on the work calendar through a real UI approval (sandbox twin)", async ({ page }) => {
  const errors = watchPageErrors(page);
  await expectSandboxAccount(page, "microsoft");
  await expectSandboxAccount(page, "google");

  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "I'll compare both calendars and hold the work calendar for the conflicting family event.",
    plan: {
      title: PLAN_TITLE, summary: "Read the work and family calendars and write a sync hold for the conflict (needs your OK).",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "mscal.list", title: "Read the work calendar", detail: "check work events", input: {}, requiresApproval: false },
        { toolId: "calendar.list", title: "Read the family calendar", detail: "check family events", input: {}, requiresApproval: false },
        {
          toolId: "mscal.create", title: "TG UC05 write work-calendar hold",
          detail: "Block the work calendar for the conflicting family event",
          input: { summary: HOLD_TITLE, start: HOLD_START },
          requiresApproval: true,
        },
      ],
      approvalGates: [], risk: "Medium",
    },
  }), async () => chat(page, "TG: compare my work and family calendars and hold my work calendar for any conflicts", conv.body.conversation.id));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();

  // The calendar write must PARK — sandbox mode never relaxes consent gates.
  await waitForRunStatus(page, runId, ["waiting_for_approval"]);

  await approveViaUi(page, /TG UC05 write work-calendar hold/);
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded", "succeeded"]);

  // The recorded would-be effect: the sync hold, carrying the conflicting event's title/time.
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
  await expect(page.getByText(/finished \(3\/3\)|completed/i).first(), "the run_result must state an honest 3/3 outcome").toBeVisible({ timeout: 15_000 });

  await page.screenshot({
    path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/uc05-cross-calendar-conflict.png",
    fullPage: true,
  });

  errors.assertClean();
});
