import { expect, test } from "@playwright/test";
import {
  apiFetch, chat, openScreen, requireBackend, signUpDisposableHousehold,
  waitForRunStatus, watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-11 — Overdue Chore Auditor (ACTIVE lane; internal-tasks variant).
 * The Todoist lane is GATED external (no read connector sandboxed by design — see
 * journey-register.md row 11) and is NOT this spec's job; the annotation below
 * records that honestly. This spec exercises the internal-tasks twin instead: seed
 * overdue chores the way the product does (homeops.create_task with a past dueAt),
 * then have the assistant audit them in chat. The overdue LIST itself is rendered
 * from the real tasks surface — Dashboard "Needs you" (isOverdue(t.dueAt), the same
 * server-truth read WP-004's results-homes.spec.ts proved for open tasks).
 *
 * Acceptance (journey-register.md row 11 / PRD §16): "overdue list rendered from
 * tasks surface".
 */

const STAMP = Date.now().toString(36);
const TASK_1 = `TG UC11 overdue trash day ${STAMP}`;
const TASK_2 = `TG UC11 overdue laundry ${STAMP}`;
const CONV_TITLE = `TG UC11 chore audit ${STAMP}`;
const PAST_DUE = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const AUDIT_ANSWER = `TG UC11 audit: 2 chores are overdue — "${TASK_1}" and "${TASK_2}". Want me to nudge whoever's assigned?`;
const EVIDENCE_DIR = "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence";

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-11: overdue chores are seeded, audited in chat, and the tasks surface (Dashboard Needs you) shows them overdue", async ({ page }) => {
  test.info().annotations.push({ type: "external-blocker", description: "Todoist connector — not sandboxed by design; internal-tasks variant executed instead" });
  const errors = watchPageErrors(page);

  // Seed via a real run (homeops.create_task with a past dueAt) — the same path the
  // product itself uses to create a task, not a direct store poke.
  const seed = await apiFetch(page, "/api/runs/start", {
    method: "POST",
    body: {
      source: "manual",
      plan: {
        title: "TG UC11 seed overdue chores",
        summary: "TG test seed for the overdue-chore-auditor spec.",
        steps: [
          { toolId: "homeops.create_task", title: "Seed overdue chore 1", input: { title: TASK_1, dueAt: PAST_DUE } },
          { toolId: "homeops.create_task", title: "Seed overdue chore 2", input: { title: TASK_2, dueAt: PAST_DUE } },
        ],
      },
    },
  });
  expect(seed.status, JSON.stringify(seed.body)).toBe(200);
  await waitForRunStatus(page, seed.body.run.id, ["completed"]);

  // Server truth: both tasks exist with a genuinely past dueAt.
  const tasks = await apiFetch(page, "/api/tasks");
  const seeded = (tasks.body?.tasks ?? []).filter((t: any) => t.title === TASK_1 || t.title === TASK_2);
  expect(seeded.length, "both seeded overdue tasks must exist server-side").toBe(2);
  expect(seeded.every((t: any) => new Date(t.dueAt).getTime() < Date.now()), "each seeded task's dueAt must be in the past").toBe(true);

  // Chat-driven audit — a deterministic canned reply stands in for the live model
  // (withFakeAiProvider), the same hermetic pattern every UC spec uses.
  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);
  const done = await withFakeAiProvider(
    page,
    () => ({ kind: "answer", answer: AUDIT_ANSWER }),
    async () => chat(page, "TG: audit our overdue chores", conv.body.conversation.id),
  );
  expect(done?.ok, JSON.stringify(done)).toBe(true);

  // UI truth 1 — the chat thread renders the audit answer.
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Ask FamiliOS");
  await page.getByText(CONV_TITLE, { exact: true }).first().click();
  await expect(page.getByText(AUDIT_ANSWER).first(), "the audit answer must render in the chat thread").toBeVisible({ timeout: 15_000 });

  // UI truth 2 — the overdue list rendered from the real tasks surface: Dashboard
  // "Needs you" (isOverdue(t.dueAt) — Dashboard.tsx), labeled Overdue with relative age.
  await openScreen(page, "Home");
  const overdueRow1 = page.locator("li", { hasText: TASK_1 }).first();
  const overdueRow2 = page.locator("li", { hasText: TASK_2 }).first();
  await expect(overdueRow1, "the first overdue chore must be visible on the Dashboard").toBeVisible({ timeout: 15_000 });
  await expect(overdueRow2, "the second overdue chore must be visible on the Dashboard").toBeVisible({ timeout: 15_000 });
  await expect(overdueRow1.getByText(/Overdue/), "it must be labeled Overdue, not just an open task").toBeVisible();
  await expect(overdueRow2.getByText(/Overdue/), "it must be labeled Overdue, not just an open task").toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/uc11-overdue-chore-auditor.png`, fullPage: true });

  errors.assertClean();
});
