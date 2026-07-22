import { expect, test } from "@playwright/test";
import { apiFetch, chat, waitForRunStatus, withFakeAiProvider } from "../usecases/uc";
import { signUpDisposableHousehold, watchPageErrors } from "./helpers";

/**
 * WP-002 acceptance closure — the "send me a note" chat E2E:
 * a plain chat ask whose plan sends via homeops.notify_contact to a recipient with
 * NO verified contact method must deliver the honest IN-APP fallback — a real,
 * durable notification the requester can SEE in Messages → Inbox — and the run
 * summary must say "delivered" truthfully (in_app channel), never a false
 * "sent to mom" (ISS-003/004, the mission's central credibility fix).
 */

const STAMP = Date.now().toString(36);
const SUBJECT = `TG WP002 note ${STAMP}`;
const BODY = `TG WP002 chat-delivery body ${STAMP} — this exact sentence must land in the Inbox.`;

test.beforeEach(async ({ page }) => {
  const probe = await page.request.get("/api/health").catch(() => null);
  test.skip(!probe || !probe.ok(), "pending-stack-restart — backend on :8787 unreachable; the dev stack is lead-managed.");
  await signUpDisposableHousehold(page);
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("chat 'send me a note' with no verified contact delivers the honest in-app fallback, visible in Inbox", async ({ page }) => {
  const errors = watchPageErrors(page);
  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: `TG WP002 chat delivery ${STAMP}` } });
  expect(conv.status).toBe(200);

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "Sending your note now.",
    plan: {
      title: `TG WP002 send-a-note plan ${STAMP}`, summary: "Send one note.",
      icon: "Bot", spaceType: "Personal", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "homeops.notify_contact", title: "Send the note", detail: BODY, input: { to: "mom@familios.invalid", subject: SUBJECT, body: BODY }, requiresApproval: false },
      ],
      approvalGates: [], risk: "Low",
    },
  }), async () => chat(page, "TG: send me a note about the fence, please", conv.body.conversation.id));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();
  {
    const probe = await apiFetch(page, `/api/runs/${runId}`);
    expect(probe.body?.run?.sourceRef?.agentId, `chat attribution must stamp the default agent; sourceRef=${JSON.stringify(probe.body?.run?.sourceRef)}`).toBeTruthy();
  }
  const run = await waitForRunStatus(page, runId, ["completed"]);

  // Server truth: the step succeeded via the DISCLOSED in-app fallback channel —
  // never a claimed external send.
  const step = run.steps[0];
  expect(step.status).toBe("succeeded");
  expect(step.result?.channel).toBe("in_app");
  expect(step.result?.inAppFallback, "the fallback must disclose itself").toBe(true);

  // UI truth: the note is a REAL Inbox row the requester can read.
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: /Messages & Approvals/i }).first().click();
  await page.getByRole("button", { name: /^Inbox/ }).first().click();
  await expect(page.getByText(SUBJECT).first(), "the in-app note must be visible in Messages → Inbox").toBeVisible({ timeout: 15_000 });

  errors.assertClean();
});
