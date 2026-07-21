import { expect, test, type Page } from "@playwright/test";
import { signIn, watchPageErrors } from "./helpers";

/**
 * WP-001 (One truthful Inbox) — Messages & Approvals becomes a live read-model of
 * SERVER truth, from every run source, within seconds.
 *
 * Root cause this proves fixed: the client never called GET /api/approvals (Approvals
 * tab rendered the local zustand `data.approvals` mirror, which only ever learns about
 * an approval when THIS session actively starts/polls the run that created it) and
 * backend.notifications() had zero call sites (server notifications were invisible).
 *
 * Both tests below drive the REAL web client against the REAL local backend:
 *  - Test 1 starts a run through the API (never through the UI) and never calls the
 *    decide API manually — the ONLY approval action taken is a real click on Approve in
 *    the browser. If the Approvals tab were still reading the local mirror, the pending
 *    card would never appear (this session never touched runPlan/syncServerRun for it).
 *  - Test 2 seeds a real server notification through a legitimate, deterministic server
 *    route (not a fixture) and proves it renders, marks read via the UI, and the read
 *    state persists across a full reload (i.e. is server truth, not client-only state).
 *
 * Data hygiene: every record created here is prefixed `TG-`. The run uses
 * homeops.create_approval — a real internal, side-effect-free tool (its catalog entry is
 * requiresApproval:true; the handler only writes a durable "approved-decision" artifact,
 * server/internal-functions.mjs) — so nothing external is ever contacted. There is no
 * delete endpoint for runs/approvals/notifications (see run-honesty.spec.ts, which
 * leaves its TG- runs in place for the same reason); the help-request seeded in Test 2
 * is best-effort cancelled in afterAll via the one cleanup route that does exist.
 */

const EVIDENCE_DIR = "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence";

const created: { helpRequests: string[] } = { helpRequests: [] };

test.afterAll(async ({ request }) => {
  for (const id of created.helpRequests) {
    await request.post(`/api/help-requests/${id}/cancel`).catch(() => {});
  }
});

/** Navigate from the signed-in Dashboard into Messages & Approvals, then a specific tab.
 * Deep-link query params (#/messages?tab=approvals) are NOT wired to the in-memory router
 * (useStore's `route` always boots to {screen:"dashboard"}; nothing parses location.hash)
 * — so this goes through the real nav, like a user would. Uses a non-exact regex match
 * because the nav badge digits this very test causes (pending count, unread count) become
 * part of the button's accessible name, which would break an exact-text match. */
async function openMessagesTab(page: Page, tabLabel: "Inbox" | "Approvals") {
  await page.getByRole("button", { name: /Messages & Approvals/i }).first().click();
  await page.getByRole("button", { name: new RegExp(`^${tabLabel}`) }).first().click();
}

test("a parked run's approval renders from server truth, decides in the UI, and resumes to completed", async ({ page }) => {
  const errors = watchPageErrors(page);
  await signIn(page, { role: /owner|adult admin/i });

  const stamp = Date.now();
  const stepTitle = `TG-Request household sign-off ${stamp}`;
  const stepDetail = `TG-Step detail ${stamp}: proposed-action line for the inbox-truth spec.`;
  const inputSubject = `TG-Subject ${stamp}`;
  const inputDetail = `TG-Resolved-input marker ${stamp}: this exact sentence proves the REAL resolved tool input rendered in the Approvals card, not a generic placeholder.`;

  // Start the run from INSIDE the page so it carries the real session cookie + CSRF token
  // (mutations are CSRF-protected — a bare request context 403s). homeops.create_approval
  // has requiresApproval:true fixed in its server catalog entry (server-authoritative —
  // server/engine.mjs resolveToolBase; a step's own declared requiresApproval is ignored
  // once a tool resolves), so this reliably parks regardless of what the plan step says.
  const started = await page.evaluate(
    async ({ stepTitle, stepDetail, inputSubject, inputDetail }) => {
      const s = await fetch("/api/session", { credentials: "include" }).then((r) => r.json()).catch(() => null);
      const csrf = s?.session?.csrf;
      const r = await fetch("/api/runs/start", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...(csrf ? { "x-homeops-csrf": csrf } : {}) },
        body: JSON.stringify({
          source: "manual",
          plan: {
            title: "TG-Inbox truth check",
            summary: "TG test: approval-gated step, decided from the UI only",
            steps: [{
              toolId: "homeops.create_approval",
              title: stepTitle,
              detail: stepDetail,
              input: { subject: inputSubject, detail: inputDetail },
            }],
          },
        }),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    { stepTitle, stepDetail, inputSubject, inputDetail },
  );
  expect(started.status, `run start should succeed: ${JSON.stringify(started.body).slice(0, 300)}`).toBe(200);
  const runId = started.body?.run?.id;
  expect(runId).toBeTruthy();

  // Confirm the SERVER reached the parked state before touching the UI — a rendering
  // failure below can never be confused with a backend failure.
  await expect(async () => {
    const run = await page.evaluate(async (id) => (await fetch(`/api/runs/${id}`, { credentials: "include" }).then((r) => r.json()))?.run, runId);
    expect(run?.status).toBe("waiting_for_approval");
    expect(run?.steps?.some((s: { approvalId: string | null }) => !!s.approvalId), "the parked step must carry an approvalId").toBe(true);
  }).toPass({ timeout: 15_000 });

  // Navigate into Messages → Approvals. NO manual API approval call has happened — this
  // proves the client learned about the park purely by reading server truth on open,
  // satisfying "visible from every run source" (this session never started/polled this
  // run through the store's own runPlan/syncServerRun path).
  await openMessagesTab(page, "Approvals");

  const card = page.locator("div.card-pad", { hasText: stepTitle }).first();
  await expect(card, "the pending card must be visible within seconds of opening the tab").toBeVisible({ timeout: 5_000 });

  // Badge >= 1 — the topbar "N to approve" pill (Shell.tsx Topbar), fed by the same
  // server-truth list as the Approvals tab.
  await expect(page.getByText(/\d+ to approve/)).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp001-badge.png` });

  // Expand the card and assert the REAL resolved input — not the approval's short
  // preview label, the actual frozen tool input off the originating run step.
  await card.locator("button").first().click();
  await expect(card.getByText(inputDetail, { exact: false }), "the real resolved input must render, not a placeholder").toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp001-approvals-pending.png`, fullPage: true });

  // Approve — a real click, the only decide action taken anywhere in this test.
  await card.getByRole("button", { name: "Approve", exact: true }).click();

  // The server auto-resumes the parked run on approve (server/index.mjs decide route) —
  // poll /api/runs/:id from the page (server truth) until it completes.
  await expect(async () => {
    const run = await page.evaluate(async (id) => (await fetch(`/api/runs/${id}`, { credentials: "include" }).then((r) => r.json()))?.run, runId);
    expect(run?.status, `run should reach completed; last seen: ${run?.status}`).toBe("completed");
  }).toPass({ timeout: 20_000 });

  // The approval must have moved out of Pending into Decided IN THE UI (no Approve/Deny
  // controls remain, and a decided status now renders) — not just on the server.
  const cardAfter = page.locator("div.card-pad", { hasText: stepTitle }).first();
  await expect(cardAfter.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await expect(cardAfter.getByText(/^Approved/).first(), "the card must show a decided status in the UI").toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp001-approved-completed.png`, fullPage: true });

  errors.assertClean();
});

test("a real server notification renders in the Inbox tab, marks read via the UI, and stays read after reload", async ({ page, request }) => {
  const errors = watchPageErrors(page);
  await signIn(page, { role: /owner|adult admin/i });

  const stamp = Date.now();
  const message = `TG-Inbox truth notification ${stamp}: this exact sentence must render as an unread row.`;

  // Seed a real notification via a legitimate, deterministic server route — NOT a
  // fixture. POST /api/help-requests (server/index.mjs) creates a durable help-request
  // and calls addNotification() for the recipient (server/index.mjs ~1442) on the
  // "in_app" channel only — no external send. Target self (toActorId = own actorId) so
  // the notification lands on THIS session's actor and is visible via GET
  // /api/notifications, which filters strictly by n.actorId === session.actorId.
  const seeded = await page.evaluate(async (message) => {
    const s = await fetch("/api/session", { credentials: "include" }).then((r) => r.json()).catch(() => null);
    const csrf = s?.session?.csrf;
    const r = await fetch("/api/help-requests", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...(csrf ? { "x-homeops-csrf": csrf } : {}) },
      body: JSON.stringify({ toActorId: s?.session?.actorId, message, kind: "ask" }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, message);
  expect(seeded.status, `help-request seed should succeed: ${JSON.stringify(seeded.body).slice(0, 300)}`).toBe(200);
  const helpRequestId = seeded.body?.helpRequest?.id;
  if (helpRequestId) created.helpRequests.push(helpRequestId);

  // Confirm the SERVER actually recorded an unread notification before touching the UI.
  await expect(async () => {
    const notifs = await page.evaluate(
      async () => (await fetch("/api/notifications", { credentials: "include" }).then((r) => r.json()))?.notifications ?? [],
    );
    const mine = notifs.find((n: { body: string }) => n.body?.includes(message));
    expect(mine, "the server must have recorded the notification").toBeTruthy();
    expect(mine.read, "it must start unread").toBe(false);
  }).toPass({ timeout: 10_000 });

  await openMessagesTab(page, "Inbox");

  const row = page.locator("button", { hasText: message }).first();
  await expect(row, "the unread notification must render in the Inbox timeline").toBeVisible({ timeout: 10_000 });
  await expect(row.getByText("Unread", { exact: true }), "it must be visually distinct as unread").toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp001-inbox-notification.png`, fullPage: true });

  // Mark read via a real UI click (not an API call).
  await row.click();

  // Persists server-side (not just optimistic client state).
  await expect(async () => {
    const notifs = await page.evaluate(
      async () => (await fetch("/api/notifications", { credentials: "include" }).then((r) => r.json()))?.notifications ?? [],
    );
    const mine = notifs.find((n: { body: string }) => n.body?.includes(message));
    expect(mine?.read, "the server must have persisted the read state").toBe(true);
  }).toPass({ timeout: 10_000 });

  // Reload and confirm the UI reflects the persisted server state on a fresh mount — the
  // row is still present, but no longer rendered as unread.
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openMessagesTab(page, "Inbox");
  const rowAfterReload = page.locator("button", { hasText: message }).first();
  await expect(rowAfterReload, "the notification must still be visible after reload").toBeVisible({ timeout: 10_000 });
  await expect(rowAfterReload.getByText("Unread", { exact: true }), "it must stay read across refresh").toHaveCount(0);

  errors.assertClean();
});
