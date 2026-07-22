import { expect, test } from "@playwright/test";
import {
  apiFetch, approveViaUi, chat, expectSandboxAccount, openScreen, readSandboxEffects,
  requireBackend, requireSandbox, signUpDisposableHousehold, waitForRunStatus,
  watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-8 — Secure Archive Builder (GATED lane).
 * Real-credential blocker: a Dropbox OAuth app — user-owned provisioning
 * (DEC-016). This spec runs the SANDBOX twin: dropbox.list (Read,
 * requiresApproval:false) enumerates the existing folder, then
 * dropbox.createFolder (Write, requiresApproval:true — server/providers.mjs)
 * parks the run until a human approves in Messages → Approvals. Only the wire
 * is mocked (server/sandbox-connectors.mjs respondDropbox) — the consent gate
 * is real.
 *
 * Acceptance (PRD §16 / journey-register UC-8): an archive folder is created
 * for the household's secure documents; the honest outcome (park → approve →
 * created) is visible in chat and the recorded would-be effect names the
 * exact archive path.
 */

const STAMP = Date.now().toString(36);
const ARCHIVE_PATH = `/FamiliOS/Archive/TG-UC08-${STAMP}`;
const PLAN_TITLE = `TG UC08 secure archive plan ${STAMP}`;
const CONV_TITLE = `TG UC08 secure archive ${STAMP}`;

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
  await requireSandbox(page, "Dropbox OAuth app not provisioned — user-owned (DEC-016)");
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-8: Dropbox is enumerated, the archive folder create parks for approval, a real UI approve creates it (sandbox twin)", async ({ page }) => {
  const errors = watchPageErrors(page);
  await expectSandboxAccount(page, "dropbox");

  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "I'll check Dropbox and build a secure archive folder for these documents.",
    plan: {
      title: PLAN_TITLE, summary: "List the existing Dropbox files, then create a secure archive folder (needs your OK).",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "dropbox.list", title: "TG UC08 list Dropbox files", detail: "enumerate existing files first", input: { path: "" }, requiresApproval: false },
        { toolId: "dropbox.createFolder", title: "TG UC08 create archive folder", detail: "Build the secure archive folder", input: { path: ARCHIVE_PATH }, requiresApproval: true },
      ],
      approvalGates: [], risk: "High",
    },
  }), async () => chat(page, "TG: build a secure archive folder for our documents in Dropbox", conv.body.conversation.id));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();

  // The High-risk folder-create write must PARK — sandbox mode never relaxes consent gates.
  await waitForRunStatus(page, runId, ["waiting_for_approval"]);

  // Decide THROUGH THE REAL UI (Messages → Approvals → Approve), then the server
  // auto-resumes the run to completion.
  await approveViaUi(page, /TG UC08 create archive folder/);
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded"]);

  // The recorded would-be effect: exactly the archive path this run asked for.
  const effects = await readSandboxEffects(page);
  const created = effects.find((e: any) => e.toolId === "dropbox.createFolder");
  expect(created, `a dropbox.createFolder effect must be recorded; got ${JSON.stringify(effects.map((e: any) => e.toolId))}`).toBeTruthy();
  expect(created.recipient).toBe(ARCHIVE_PATH);
  expect(String(created.content)).toContain(ARCHIVE_PATH);

  // Honest summary in the chat thread (the surface the family actually reads).
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Ask FamiliOS");
  await page.getByText(CONV_TITLE, { exact: true }).first().click();
  await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finished \(2\/2\)|completed/i).first(), "the run_result must state an honest 2/2 outcome").toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/uc08-secure-archive-builder.png", fullPage: true });

  errors.assertClean();
});
