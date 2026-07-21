import { expect, test, type Page } from "@playwright/test";
import { signUpDisposableHousehold, watchPageErrors } from "./helpers";

/**
 * WP-004 (ISS-008, FEAT-019/005) — "Done" always links to the thing, and the thing
 * has a home to be found in later.
 *
 * Drives the REAL web client against the REAL local backend on a fresh DISPOSABLE
 * household (helpers.ts signUpDisposableHousehold — real /api/signup, never the
 * resident family tenant a spec that writes records must not touch). A brand-new
 * household also exercises server/seed.mjs's default-Chore-Board provisioning path
 * directly. Starts a real run with three steps — an undated homeops.create_task, a
 * homeops.send_notification_draft, and a homeops.create_artifact of a DIFFERENT kind
 * (so the Knowledge Library always has ≥2 kinds present and the filter chips are
 * guaranteed to render, even on a household with no other history) — then proves:
 *   1. Dashboard "Needs you" → Open tasks shows the created task, and clicking it lands
 *      on the Mini Apps Chore Board with the task visible. Mini apps are entirely
 *      client-owned (src/miniapps + src/store/useStore.ts) and a fresh Playwright
 *      context always starts with data.miniApps: [], but Dashboard's openChoreBoard
 *      lazy-creates the household's default board on that first click when none exists
 *      yet — so this is genuinely 1 click from Home, no setup step required.
 *   2. Files & Knowledge → Knowledge Library lists the drafted artifact, the kind
 *      filter chips narrow the list (and actually hide the other kind), the tab's count
 *      badge is non-zero, and the artifact detail drawer shows the body + a "From run" chip.
 *
 * Data hygiene: every record created here is prefixed `TG-`. Since the household itself
 * is disposable and never reused, cross-run title collisions (the original bug on the
 * resident tenant) are structurally impossible — the per-run RUN_TAG is kept only as a
 * debugging aid. The created task is deleted in afterAll (DELETE /api/tasks/:id exists);
 * artifacts have no delete endpoint (matching run-honesty.spec.ts / results-links.test.mjs
 * precedent), and the lazily-created Chore Board mini app is left in place — it's the
 * intended product surface, not test pollution.
 */

const RUN_TAG = Date.now().toString(36);
const created: { taskId?: string; runId?: string } = {};
const TASK_TITLE = `TG-WP004 open task ${RUN_TAG}`;
const DRAFT_SUBJECT = `TG-WP004 notification draft ${RUN_TAG}`;
const DRAFT_BODY = `TG-WP004 draft body for the results-homes spec (${RUN_TAG}).`;
const REPORT_TITLE = `TG-WP004 companion report ${RUN_TAG}`;
const REPORT_BODY = `TG-WP004 companion report body (${RUN_TAG}).`;
// Absolute — screenshot paths passed to page.screenshot() resolve against the test
// runner's process.cwd(), not this spec file's location, so a relative path here would
// depend on the invocation directory. An absolute path is unambiguous either way.
const EVIDENCE_DIR = "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence";

test.afterAll(async ({ request }) => {
  if (created.taskId) await request.delete(`/api/tasks/${created.taskId}`).catch(() => {});
});

/** Issued from INSIDE the page so it carries the session cookie + CSRF token (mutations
 *  are CSRF-protected — see run-honesty.spec.ts for the same pattern). */
async function startRun(page: Page, plan: unknown) {
  return page.evaluate(async (p) => {
    const s = await fetch("/api/session", { credentials: "include" }).then((r) => r.json()).catch(() => null);
    const csrf = s?.session?.csrf;
    const r = await fetch("/api/runs/start", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...(csrf ? { "x-homeops-csrf": csrf } : {}) },
      body: JSON.stringify(p),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, plan);
}

async function getRun(page: Page, id: string) {
  return page.evaluate(async (runId) => {
    const r = await fetch(`/api/runs/${runId}`, { credentials: "include" });
    return (await r.json())?.run;
  }, id);
}

test("dashboard Open tasks + Chore Board + Knowledge artifacts show what a run just created", async ({ page }) => {
  const errors = watchPageErrors(page);
  await signUpDisposableHousehold(page);

  // ---- Start the real run: an undated task + a draft notification + a differently-
  // kinded artifact (guarantees ≥2 kinds exist so the filter chips are testable even on
  // a household with zero prior history).
  const started = await startRun(page, {
    source: "manual",
    plan: {
      title: "TG-WP004 results-homes run",
      summary: "TG test run for the WP-004 results-homes spec.",
      steps: [
        { toolId: "homeops.create_task", title: "Create the open task", input: { title: TASK_TITLE } },
        { toolId: "homeops.send_notification_draft", title: "Draft a note", input: { to: "tg-family@example.invalid", subject: DRAFT_SUBJECT, body: DRAFT_BODY } },
        { toolId: "homeops.create_artifact", title: "Create a companion report", input: { title: REPORT_TITLE, body: REPORT_BODY, kind: "briefing" } },
      ],
    },
  });
  expect(started.status, `run start should succeed: ${JSON.stringify(started.body).slice(0, 300)}`).toBe(200);
  const runId = started.body?.run?.id;
  expect(runId).toBeTruthy();
  created.runId = runId;

  let finished: { steps?: { result?: { id?: string } }[] } | undefined;
  await expect(async () => {
    finished = await getRun(page, runId);
    expect(finished?.status).toBe("completed");
  }).toPass({ timeout: 30_000 });
  const taskId = finished?.steps?.[0]?.result?.id;
  expect(taskId, "the run must have actually recorded a created task id").toBeTruthy();
  created.taskId = taskId;

  // ---- Dashboard: "Open tasks" shows the new task.
  await page.reload(); // force a fresh hydrateFromServer() on boot so the new task is pulled in
  await expect(async () => {
    await page.getByRole("button", { name: "Home", exact: true }).first().click().catch(() => {});
    await expect(page.getByText(TASK_TITLE).first()).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  const openTaskRow = page.getByRole("button", { name: new RegExp(`Open task "${TASK_TITLE}"`) }).first();
  await expect(openTaskRow).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp004-dashboard-open-tasks.png`, fullPage: true });

  // ---- Click-through (1 click from Home) lands on the Chore Board with the task visible.
  // Dashboard's openChoreBoard lazy-creates the default board on this click if the
  // household doesn't have one yet — no separate setup step needed.
  await openTaskRow.click();
  await expect(page.getByRole("heading", { name: "Family Chore Board" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(TASK_TITLE).first()).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp004-choreboard-task.png`, fullPage: true });

  // ---- Files & Knowledge: the Knowledge Library lists the drafted artifact.
  await page.getByRole("button", { name: "Files & Knowledge", exact: true }).first().click();
  await page.getByRole("button", { name: /Knowledge Library/ }).click();
  const artifactsGroup = page.getByRole("button", { name: /Generated reports & briefings/ });
  await expect(artifactsGroup).toBeVisible({ timeout: 15_000 });
  if ((await artifactsGroup.getAttribute("aria-expanded")) !== "true") await artifactsGroup.click();
  await expect(page.getByText(DRAFT_SUBJECT).first()).toBeVisible({ timeout: 15_000 });
  // The tab's count badge must be non-zero now that at least one artifact exists.
  const knowledgeTabCount = page.getByRole("button", { name: /Knowledge Library/ }).locator("span").last();
  await expect(knowledgeTabCount).not.toHaveText("0");
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp004-knowledge-artifacts.png`, fullPage: true });

  // ---- Kind filter chips narrow the list (aria-pressed, keyboard-focusable buttons).
  // The run above created two distinct kinds (notification-draft + briefing), so the
  // chips are guaranteed to render and actually narrow the visible cards.
  await expect(page.getByText(REPORT_TITLE).first()).toBeVisible();
  // Scoped to the filter-chip group specifically — the artifact CARD's own accessible
  // name also contains "notification draft" (its title), so an unscoped role lookup
  // matches both and trips Playwright's strict mode.
  const chipGroup = page.getByRole("group", { name: "Filter artifacts by kind" });
  const draftChip = chipGroup.getByRole("button", { name: /notification draft/i });
  await expect(draftChip).toBeVisible();
  await expect(draftChip).toHaveAttribute("aria-pressed", "false");
  await draftChip.focus();
  await draftChip.press("Enter");
  await expect(draftChip).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(DRAFT_SUBJECT).first()).toBeVisible();
  await expect(page.getByText(REPORT_TITLE)).toHaveCount(0); // filtered out — proves the chip narrows, not just decorates

  // ---- Artifact detail drawer: content + a "From run" chip.
  await page.getByText(DRAFT_SUBJECT).first().click();
  await expect(page.getByText(DRAFT_BODY).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("From run", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp004-artifact-detail.png`, fullPage: true });

  errors.assertClean();
});
