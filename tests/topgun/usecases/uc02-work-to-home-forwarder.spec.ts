import { expect, test } from "@playwright/test";
import {
  apiFetch, approveViaUi, chat, expectSandboxAccount, openScreen, readSandboxEffects,
  requireBackend, requireSandbox, signUpDisposableHousehold, waitForRunStatus,
  watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-2 — Emergency Work-to-Home Forwarder (GATED lane).
 * Real-credential blocker: Microsoft 365 OAuth app not provisioned — user-owned
 * (DEC-016). This spec runs the SANDBOX twin: outlook.search (Read, no approval)
 * finds the urgent work mail, then gmail.send (High risk, requiresApproval:true)
 * forwards it home — the send parks until a human decides in Messages → Approvals.
 *
 * Acceptance (PRD §16 / journey-register UC-2): the urgent mail is found via
 * outlook.search, the forward is parked then approved through the REAL UI, and
 * the recorded would-be gmail.send effect names the synthetic home recipient,
 * subject and content; the chat run_result reports the outcome honestly.
 */

const STAMP = Date.now().toString(36);
const PLAN_TITLE = `TG UC02 work-to-home forward plan ${STAMP}`;
const CONV_TITLE = `TG UC02 work-to-home forward ${STAMP}`;
const HOME_RECIPIENT = "family.home.sandbox@example.invalid";

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
  await requireSandbox(page, "Microsoft 365 OAuth app not provisioned — user-owned (DEC-016)");
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-2: urgent work mail is found via Outlook search, then forwarded home through a real UI approval (sandbox twin)", async ({ page }) => {
  const errors = watchPageErrors(page);
  await expectSandboxAccount(page, "microsoft");
  await expectSandboxAccount(page, "google");

  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "I'll check work mail for anything urgent and forward it home.",
    plan: {
      title: PLAN_TITLE, summary: "Search Outlook for urgent mail and forward it home (needs your OK).",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "outlook.search", title: "Find urgent work mail", detail: "check the work inbox", input: {}, requiresApproval: false },
        {
          toolId: "gmail.send", title: "TG UC02 forward urgent mail home",
          detail: "Forward the urgent work mail to the family inbox",
          input: { to: HOME_RECIPIENT, subject: `TG UC02 Fwd: Invoice #4471 ${STAMP}`, body: "Forwarded from work — billing needs a decision today." },
          requiresApproval: true,
        },
      ],
      approvalGates: [], risk: "Medium",
    },
  }), async () => chat(page, "TG: check my work email for anything urgent and forward it home", conv.body.conversation.id));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();

  // The High-risk cross-account send must PARK — sandbox mode never relaxes consent gates.
  await waitForRunStatus(page, runId, ["waiting_for_approval"]);

  await approveViaUi(page, /TG UC02 forward urgent mail home/);
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded"]);

  // The recorded would-be effect: the forward landed at the synthetic home recipient.
  const effects = await readSandboxEffects(page);
  const send = effects.find((e: any) => e.toolId === "gmail.send");
  expect(send, `a gmail.send effect must be recorded; got ${JSON.stringify(effects.map((e: any) => e.toolId))}`).toBeTruthy();
  expect(send.recipient).toContain(HOME_RECIPIENT);
  expect(String(send.subject)).toContain("Invoice #4471");
  expect(String(send.content)).toContain("billing needs a decision");

  // Honest summary in the chat thread (the surface the family actually reads).
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Ask FamiliOS");
  await page.getByText(CONV_TITLE, { exact: true }).first().click();
  await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finished \(2\/2\)|completed/i).first(), "the run_result must state an honest 2/2 outcome").toBeVisible({ timeout: 15_000 });

  await page.screenshot({
    path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/uc02-work-to-home-forwarder.png",
    fullPage: true,
  });

  errors.assertClean();
});
