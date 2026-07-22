import { expect, test } from "@playwright/test";
import {
  apiFetch, approveViaUi, chat, expectSandboxAccount, openScreen, readSandboxEffects,
  requireBackend, requireSandbox, signUpDisposableHousehold, waitForRunStatus,
  watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-1 — School Correspondence Organizer (GATED lane).
 * Real-credential blocker: a Google OAuth app with gmail.readonly + gmail.modify
 * scopes — user-owned provisioning (DEC-016). This spec runs the SANDBOX twin:
 * every consent gate is real (gmail.modifyLabels requiresApproval:true parks the
 * run until a human approves in Messages → Approvals), only the wire is mocked.
 *
 * Acceptance (PRD §16): label applied to the sandbox school mail; honest outcome
 * visible in chat. Asserted: search → approval park → REAL UI approve → resume →
 * completed; the recorded would-be effect labels exactly sbx-msg-1 (the school
 * fixture) with the School label; the chat run_result reports 2/2 honestly.
 */

const STAMP = Date.now().toString(36);
const PLAN_TITLE = `TG UC01 school mail plan ${STAMP}`;
const CONV_TITLE = `TG UC01 school mail ${STAMP}`;

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
  await requireSandbox(page, "Google OAuth app (gmail.readonly + gmail.modify scopes) not provisioned — user-owned (DEC-016)");
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-1: school mail is found, labeling parks for approval, a real UI approve applies the label (sandbox twin)", async ({ page }) => {
  const errors = watchPageErrors(page);
  await expectSandboxAccount(page, "google");

  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "I'll organize the school mail now.",
    plan: {
      title: PLAN_TITLE, summary: "Find school mail and label it School (needs your OK).",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "gmail.search", title: "Find recent school mail", detail: "school correspondence", input: { query: "from:(office@lincoln.example) newer_than:7d", maxResults: "10" }, requiresApproval: false },
        { toolId: "gmail.modifyLabels", title: "TG UC01 label school mail", detail: "Apply the School label", input: { messageIds: "sbx-msg-1", addLabels: "School" }, requiresApproval: true },
      ],
      approvalGates: [], risk: "Medium",
    },
  }), async () => chat(page, "TG: organize the school emails into a School label", conv.body.conversation.id));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();

  // The High-risk label write must PARK — sandbox mode never relaxes consent gates.
  await waitForRunStatus(page, runId, ["waiting_for_approval"]);

  // Decide THROUGH THE REAL UI (Messages → Approvals → Approve), then the server
  // auto-resumes the run to completion.
  await approveViaUi(page, /TG UC01 label school mail/);
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded"]);

  // The recorded would-be effect: exactly the school fixture message, School label.
  const effects = await readSandboxEffects(page);
  const label = effects.find((e: any) => e.toolId === "gmail.modifyLabels");
  expect(label, `a gmail.modifyLabels effect must be recorded; got ${JSON.stringify(effects.map((e: any) => e.toolId))}`).toBeTruthy();
  expect(label.recipient).toContain("sbx-msg-1");
  expect(String(label.content)).toMatch(/School|Label_/);

  // Honest summary in the chat thread (the surface the family actually reads).
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Ask FamiliOS");
  await page.getByText(CONV_TITLE, { exact: true }).first().click();
  await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finished \(2\/2\)|completed/i).first(), "the run_result must state an honest 2/2 outcome").toBeVisible({ timeout: 15_000 });

  errors.assertClean();
});
