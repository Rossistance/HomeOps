import { expect, test } from "@playwright/test";
import {
  apiFetch, approveViaUi, chat, expectSandboxAccount, openScreen, readSandboxEffects,
  requireBackend, requireSandbox, signUpDisposableHousehold, waitForRunStatus,
  watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-12 — Smart Climate Night-Mode (GATED lane).
 * Real-credential blocker: Google Home / Nest Device Access (an SDM project
 * + OAuth) not provisioned — user-owned (DEC-016). This spec runs the
 * SANDBOX twin against the `google` provider's smarthome tools
 * (server/providers.mjs): smarthome.listDevices (Read, requiresApproval:
 * false) finds the Nest thermostat, then smarthome.setThermostat (Write,
 * requiresApproval:true) parks until a human approves. The sandbox fills
 * HOMEOPS_SDM_PROJECT_ID with a synthetic value (sandbox-connectors.mjs
 * ensureSandboxEnvDefaults) only because that var is unset — it never
 * touches a real one — and the setThermostat effect is recorded.
 *
 * Acceptance (PRD §16 / journey-register UC-12): the household's Nest
 * thermostat is set to a night-mode setpoint; the honest outcome (park →
 * approve → set) is visible in chat and the recorded would-be effect names
 * the exact device and setpoint.
 */

const STAMP = Date.now().toString(36);
// The sandbox listDevices fixture (sandbox-connectors.mjs respondGoogle) returns
// this exact SDM resource name for the one seeded Nest thermostat.
const DEVICE_NAME = "enterprises/sandbox-sdm-project/devices/sbx-nest-1";
const NIGHT_MODE_CELSIUS = "18";
const PLAN_TITLE = `TG UC12 climate night-mode plan ${STAMP}`;
const CONV_TITLE = `TG UC12 climate night-mode ${STAMP}`;

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
  await requireSandbox(page, "Google Home / Nest Device Access (SDM project + OAuth) not provisioned — user-owned (DEC-016)");
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-12: the Nest thermostat is found, night-mode setback parks for approval, a real UI approve applies it (sandbox twin)", async ({ page }) => {
  const errors = watchPageErrors(page);
  await expectSandboxAccount(page, "google");

  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "I'll find the thermostat and set it back for the night (needs your OK).",
    plan: {
      title: PLAN_TITLE, summary: "List Google Home devices, then set the thermostat to a night-mode setpoint.",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "smarthome.listDevices", title: "TG UC12 list Google Home devices", detail: "find the thermostat", input: {}, requiresApproval: false },
        { toolId: "smarthome.setThermostat", title: "TG UC12 set night-mode setback", detail: "Lower the heat setpoint for the night", input: { deviceId: DEVICE_NAME, celsius: NIGHT_MODE_CELSIUS }, requiresApproval: true },
      ],
      approvalGates: [], risk: "Medium",
    },
  }), async () => chat(page, "TG: set the thermostat back for the night", conv.body.conversation.id));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();

  // The Medium-risk thermostat write must PARK — sandbox mode never relaxes consent gates.
  await waitForRunStatus(page, runId, ["waiting_for_approval"]);

  await approveViaUi(page, /TG UC12 set night-mode setback/);
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded"]);

  // The first step actually found the seeded Nest fixture (honest — not assumed).
  const listResult = JSON.stringify(run.steps[0]);
  expect(listResult).toContain("sbx-nest-1");

  // The recorded would-be effect: exactly this device, this setpoint.
  const effects = await readSandboxEffects(page);
  const setback = effects.find((e: any) => e.toolId === "smarthome.setThermostat");
  expect(setback, `a smarthome.setThermostat effect must be recorded; got ${JSON.stringify(effects.map((e: any) => e.toolId))}`).toBeTruthy();
  expect(String(setback.recipient)).toContain("sbx-nest-1");
  expect(String(setback.content)).toContain(NIGHT_MODE_CELSIUS);

  // Honest summary in the chat thread (the surface the family actually reads).
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Ask FamiliOS");
  await page.getByText(CONV_TITLE, { exact: true }).first().click();
  await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finished \(2\/2\)|completed/i).first(), "the run_result must state an honest 2/2 outcome").toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/uc12-climate-night-mode.png", fullPage: true });

  errors.assertClean();
});
