import { expect, test } from "@playwright/test";
import {
  apiFetch, approveViaUi, chat, expectSandboxAccount, openScreen, readSandboxEffects,
  requireBackend, requireSandbox, signUpDisposableHousehold, waitForRunStatus,
  watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-4 — Grandparent Weekly Digest (GATED lane).
 * Real-credential blocker: email-send OAuth (Google gmail.send / MS365
 * Mail.Send) not provisioned — user-owned (DEC-016). Sandbox twin: calendar.list
 * (Read, no approval) supplies the week's events, then gmail.send (High risk,
 * requiresApproval:true) delivers the composed digest to a synthetic grandparent
 * address — the send parks until a human approves in Messages → Approvals.
 *
 * Acceptance (PRD §16 / journey-register UC-4): the digest is composed from the
 * calendar read, the send is parked then approved through the REAL UI, and the
 * recorded would-be gmail.send effect names the grandparent recipient, subject
 * and the digest content (the two fixture events); the chat run_result reports
 * the outcome honestly.
 */

const STAMP = Date.now().toString(36);
const PLAN_TITLE = `TG UC04 grandparent digest plan ${STAMP}`;
const CONV_TITLE = `TG UC04 grandparent digest ${STAMP}`;
const GRANDPARENT_RECIPIENT = "grandma.sandbox@example.invalid";
const DIGEST_SUBJECT = `TG UC04 This week with the kids ${STAMP}`;
const DIGEST_BODY = "Hi Grandma! Here's what the kids are up to this week: Dentist — Noah at Bright Smiles, and Soccer practice at Rec Center.";

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
  await requireSandbox(page, "email-send OAuth (Google gmail.send / MS365 Mail.Send) not provisioned — user-owned (DEC-016)");
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-4: weekly calendar events are composed into a digest and delivered to a grandparent through a real UI approval (sandbox twin)", async ({ page }) => {
  const errors = watchPageErrors(page);
  await expectSandboxAccount(page, "google");

  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "I'll pull this week's calendar and send Grandma a digest.",
    plan: {
      title: PLAN_TITLE, summary: "Read this week's calendar and email a digest to Grandma (needs your OK).",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "calendar.list", title: "Read this week's events", detail: "gather what's happening", input: {}, requiresApproval: false },
        {
          toolId: "gmail.send", title: "TG UC04 send grandparent digest",
          detail: "Email the weekly digest to Grandma",
          input: { to: GRANDPARENT_RECIPIENT, subject: DIGEST_SUBJECT, body: DIGEST_BODY },
          requiresApproval: true,
        },
      ],
      approvalGates: [], risk: "Medium",
    },
  }), async () => chat(page, "TG: send Grandma her weekly digest of what the kids are up to", conv.body.conversation.id));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();

  // The High-risk digest send must PARK — sandbox mode never relaxes consent gates.
  await waitForRunStatus(page, runId, ["waiting_for_approval"]);

  await approveViaUi(page, /TG UC04 send grandparent digest/);
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded"]);

  // The recorded would-be effect: exactly the grandparent recipient, subject, and digest content.
  const effects = await readSandboxEffects(page);
  const send = effects.find((e: any) => e.toolId === "gmail.send");
  expect(send, `a gmail.send effect must be recorded; got ${JSON.stringify(effects.map((e: any) => e.toolId))}`).toBeTruthy();
  expect(send.recipient).toContain(GRANDPARENT_RECIPIENT);
  expect(String(send.subject)).toBe(DIGEST_SUBJECT);
  expect(String(send.content)).toContain("Dentist");
  expect(String(send.content)).toContain("Soccer practice");

  // Honest summary in the chat thread (the surface the family actually reads).
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Ask FamiliOS");
  await page.getByText(CONV_TITLE, { exact: true }).first().click();
  await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finished \(2\/2\)|completed/i).first(), "the run_result must state an honest 2/2 outcome").toBeVisible({ timeout: 15_000 });

  await page.screenshot({
    path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/uc04-grandparent-digest.png",
    fullPage: true,
  });

  errors.assertClean();
});
