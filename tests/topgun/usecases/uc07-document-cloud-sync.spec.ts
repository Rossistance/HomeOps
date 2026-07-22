import { expect, test } from "@playwright/test";
import {
  apiFetch, chat, expectSandboxAccount, openScreen, readSandboxEffects,
  requireBackend, requireSandbox, signUpDisposableHousehold, waitForRunStatus,
  watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-7 — Secure Document Cloud Sync (GATED lane).
 * Real-credential blocker: Google Drive + OneDrive OAuth apps not provisioned —
 * user-owned (DEC-016).
 *
 * Coverage check (server/sandbox-connectors.mjs SANDBOX_COVERAGE): drive.list and
 * onedrive.list are both mocked as Read-only, requiresApproval:false tools. There
 * is NO cloud-write mock for either store — `recordsEffectsFor` covers
 * gmail.send/gmail.modifyLabels/calendar.create/outlook.send/mscal.create/
 * slack.postMessage/dropbox.createFolder/alexa.announce/sms.send, but neither
 * `drive.*` nor `onedrive.*` appears there. A hypothetical drive/onedrive write
 * tool doesn't exist in server/providers.mjs either. Per the mission brief, this
 * spec's honest outcome is therefore the READ-BOTH-STORES + plan result: both
 * enumerations complete (no approval to park on — both steps are
 * requiresApproval:false), and we assert nothing else was recorded as a would-be
 * write (there is no sync/write leg to prove because the sandbox — and the
 * product — doesn't have one).
 *
 * Acceptance (PRD §16 / journey-register UC-7): both cloud stores are
 * successfully enumerated via the REAL UI/chat path; the sync "plan" is the
 * honest deliverable (a completed 2/2 run listing files from each store) — no
 * fabricated write is asserted.
 */

const STAMP = Date.now().toString(36);
const PLAN_TITLE = `TG UC07 document cloud sync plan ${STAMP}`;
const CONV_TITLE = `TG UC07 document cloud sync ${STAMP}`;

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
  await requireSandbox(page, "Google Drive + OneDrive OAuth apps not provisioned — user-owned (DEC-016)");
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-7: both Drive and OneDrive are enumerated; the honest outcome is the read-both-stores plan (no cloud-write mock exists) (sandbox twin)", async ({ page }) => {
  const errors = watchPageErrors(page);
  await expectSandboxAccount(page, "google");
  await expectSandboxAccount(page, "microsoft");

  const effectsBefore = await readSandboxEffects(page);

  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "I'll check what's in Drive and OneDrive so we know what needs to sync.",
    plan: {
      title: PLAN_TITLE, summary: "List files in both Google Drive and OneDrive to plan the sync.",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "drive.list", title: "TG UC07 list Google Drive files", detail: "enumerate Drive", input: {}, requiresApproval: false },
        { toolId: "onedrive.list", title: "TG UC07 list OneDrive files", detail: "enumerate OneDrive", input: {}, requiresApproval: false },
      ],
      approvalGates: [], risk: "Low",
    },
  }), async () => chat(page, "TG: check what documents are in Drive and OneDrive so we can plan a sync", conv.body.conversation.id));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();

  // Both leaves are Read/requiresApproval:false — no consent gate to park on;
  // the run should reach completion without a human decision.
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded"]);

  // Honest coverage check: no cloud-write effect exists to assert, and none got
  // fabricated — the effect log is unchanged by this read-only run.
  const effectsAfter = await readSandboxEffects(page);
  expect(effectsAfter.length, "a read-only drive/onedrive run must record zero would-be effects").toBe(effectsBefore.length);
  expect(effectsAfter.some((e: any) => e.toolId?.startsWith("drive.") || e.toolId?.startsWith("onedrive."))).toBe(false);

  // The read results themselves (via the run's step output) name the Drive and
  // OneDrive fixtures — the honest "read-both-stores" deliverable.
  const driveResult = JSON.stringify(run.steps[0]);
  const onedriveResult = JSON.stringify(run.steps[1]);
  expect(driveResult).toMatch(/Field trip form\.pdf|Grocery list\.txt/);
  expect(onedriveResult).toMatch(/Budget\.xlsx/);

  // Honest summary in the chat thread (the surface the family actually reads).
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Ask FamiliOS");
  await page.getByText(CONV_TITLE, { exact: true }).first().click();
  await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finished \(2\/2\)|completed/i).first(), "the run_result must state an honest 2/2 outcome").toBeVisible({ timeout: 15_000 });

  await page.screenshot({
    path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/uc07-document-cloud-sync.png",
    fullPage: true,
  });

  errors.assertClean();
});
