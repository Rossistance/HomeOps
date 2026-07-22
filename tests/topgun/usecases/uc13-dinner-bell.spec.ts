import { expect, test } from "@playwright/test";
import {
  apiFetch, approveViaUi, chat, expectSandboxAccount, openScreen, readSandboxEffects,
  requireBackend, requireSandbox, signUpDisposableHousehold, waitForRunStatus,
  watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-13 — Smart Speaker Dinner Bell (GATED lane).
 * Real-credential blocker: Amazon Alexa skill/API credentials not
 * provisioned — user-owned (DEC-016). This spec runs the SANDBOX twin
 * against the `amazon-alexa` provider (server/providers.mjs): alexa.
 * listDevices (Read, requiresApproval:false) finds the Kitchen Echo, then
 * alexa.announce (Send, requiresApproval:true, delivers:true) parks until a
 * human approves. The sandbox fills HOMEOPS_ALEXA_ENDPOINT with a synthetic
 * value only because it's unset (sandbox-connectors.mjs
 * ensureSandboxEnvDefaults) and the announce effect is recorded.
 *
 * Acceptance (PRD §16 / journey-register UC-13): an announcement calling
 * the family to dinner is delivered to the Kitchen Echo; the honest outcome
 * (park → approve → announce) is visible in chat and the recorded would-be
 * effect names the exact device and announcement text.
 */

const STAMP = Date.now().toString(36);
// The sandbox listDevices fixture (sandbox-connectors.mjs respondAlexa) returns
// exactly this one seeded Echo device.
const DEVICE_ID = "SBX-ECHO-1";
const ANNOUNCEMENT = `TG UC13 dinner's ready — come to the kitchen! ${STAMP}`;
const PLAN_TITLE = `TG UC13 dinner bell plan ${STAMP}`;
const CONV_TITLE = `TG UC13 dinner bell ${STAMP}`;

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
  await requireSandbox(page, "Amazon Alexa skill/API credentials not provisioned — user-owned (DEC-016)");
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-13: the Kitchen Echo is found, the dinner announcement parks for approval, a real UI approve delivers it (sandbox twin)", async ({ page }) => {
  const errors = watchPageErrors(page);
  await expectSandboxAccount(page, "amazon-alexa");

  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "I'll find the kitchen speaker and call everyone to dinner (needs your OK).",
    plan: {
      title: PLAN_TITLE, summary: "List Alexa devices, then announce that dinner is ready.",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "alexa.listDevices", title: "TG UC13 list Alexa devices", detail: "find the kitchen speaker", input: {}, requiresApproval: false },
        { toolId: "alexa.announce", title: "TG UC13 announce dinner is ready", detail: "Ring the dinner bell", input: { message: ANNOUNCEMENT, device: DEVICE_ID }, requiresApproval: true },
      ],
      approvalGates: [], risk: "Medium",
    },
  }), async () => chat(page, "TG: ring the dinner bell on the kitchen speaker", conv.body.conversation.id));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();

  // The Send/delivers:true announcement must PARK — sandbox mode never relaxes consent gates.
  await waitForRunStatus(page, runId, ["waiting_for_approval"]);

  await approveViaUi(page, /TG UC13 announce dinner is ready/);
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded"]);

  // The first step actually found the seeded Echo fixture (honest — not assumed).
  const listResult = JSON.stringify(run.steps[0]);
  expect(listResult).toContain("SBX-ECHO-1");
  expect(listResult).toMatch(/Kitchen Echo/);

  // The recorded would-be effect: exactly this device, exactly this text.
  const effects = await readSandboxEffects(page);
  const announced = effects.find((e: any) => e.toolId === "alexa.announce");
  expect(announced, `an alexa.announce effect must be recorded; got ${JSON.stringify(effects.map((e: any) => e.toolId))}`).toBeTruthy();
  expect(announced.recipient).toBe(DEVICE_ID);
  expect(String(announced.content)).toBe(ANNOUNCEMENT);

  // Honest summary in the chat thread (the surface the family actually reads).
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Ask FamiliOS");
  await page.getByText(CONV_TITLE, { exact: true }).first().click();
  await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finished \(2\/2\)|completed/i).first(), "the run_result must state an honest 2/2 outcome").toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/uc13-dinner-bell.png", fullPage: true });

  errors.assertClean();
});
