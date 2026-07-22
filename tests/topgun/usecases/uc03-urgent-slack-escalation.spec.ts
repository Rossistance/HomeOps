import { expect, test } from "@playwright/test";
import {
  apiFetch, approveViaUi, chat, expectSandboxAccount, openScreen, readSandboxEffects,
  requireBackend, requireSandbox, signUpDisposableHousehold, waitForRunStatus,
  watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-3 — Urgent Slack Escalation (GATED lane).
 * Real-credential blocker: Microsoft 365 + Slack OAuth apps not provisioned —
 * user-owned (DEC-016). Sandbox twin: outlook.search (Read, no approval) finds
 * the urgent mail, then slack.postMessage (High risk, requiresApproval:true)
 * escalates it to the family Slack channel — the post parks until approved.
 *
 * Acceptance (PRD §16 / journey-register UC-3): urgent mail found via
 * outlook.search; the Slack post is parked then approved through the REAL UI;
 * the recorded would-be slack.postMessage effect names the target channel and
 * message content; the chat run_result reports the outcome honestly.
 */

const STAMP = Date.now().toString(36);
const PLAN_TITLE = `TG UC03 slack escalation plan ${STAMP}`;
const CONV_TITLE = `TG UC03 slack escalation ${STAMP}`;
const SLACK_CHANNEL = "C_SBX_FAMILY";

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
  await requireSandbox(page, "Microsoft 365 + Slack OAuth apps not provisioned — user-owned (DEC-016)");
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-3: urgent work mail is found via Outlook search, then escalated to Slack through a real UI approval (sandbox twin)", async ({ page }) => {
  const errors = watchPageErrors(page);
  await expectSandboxAccount(page, "microsoft");
  await expectSandboxAccount(page, "slack");

  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);

  const escalationText = `TG UC03 escalation ${STAMP}: urgent work mail needs eyes — Invoice #4471 from billing@vendor.example.`;

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "I'll check work mail for anything urgent and escalate it to the family Slack channel.",
    plan: {
      title: PLAN_TITLE, summary: "Search Outlook for urgent mail and post an escalation to Slack (needs your OK).",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "outlook.search", title: "Find urgent work mail", detail: "check the work inbox", input: {}, requiresApproval: false },
        {
          toolId: "slack.postMessage", title: "TG UC03 escalate urgent mail to Slack",
          detail: "Post the urgent work mail summary to #family",
          input: { channel: SLACK_CHANNEL, text: escalationText },
          requiresApproval: true,
        },
      ],
      approvalGates: [], risk: "Medium",
    },
  }), async () => chat(page, "TG: check my work email for anything urgent and escalate it to the family Slack channel", conv.body.conversation.id));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();

  // The High-risk Slack post must PARK — sandbox mode never relaxes consent gates.
  await waitForRunStatus(page, runId, ["waiting_for_approval"]);

  await approveViaUi(page, /TG UC03 escalate urgent mail to Slack/);
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded"]);

  // The recorded would-be effect: the escalation landed in the sandbox family channel.
  const effects = await readSandboxEffects(page);
  const post = effects.find((e: any) => e.toolId === "slack.postMessage");
  expect(post, `a slack.postMessage effect must be recorded; got ${JSON.stringify(effects.map((e: any) => e.toolId))}`).toBeTruthy();
  expect(post.recipient).toBe(SLACK_CHANNEL);
  expect(String(post.content)).toContain(`TG UC03 escalation ${STAMP}`);
  expect(String(post.content)).toContain("Invoice #4471");

  // Honest summary in the chat thread (the surface the family actually reads).
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Ask FamiliOS");
  await page.getByText(CONV_TITLE, { exact: true }).first().click();
  await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finished \(2\/2\)|completed/i).first(), "the run_result must state an honest 2/2 outcome").toBeVisible({ timeout: 15_000 });

  await page.screenshot({
    path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/uc03-urgent-slack-escalation.png",
    fullPage: true,
  });

  errors.assertClean();
});
