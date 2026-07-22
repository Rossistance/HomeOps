import { expect, test } from "@playwright/test";
import {
  apiFetch, chat, openScreen, requireBackend, signUpDisposableHousehold,
  waitForRunStatus, watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-10 — Vacation Project Onboarding (GATED lane, honest-park variant).
 *
 * Same honest-park contract as UC-9: Notion and TickTick are DELIBERATELY
 * NOT SANDBOXED (server/test/README-sandbox.md, sandbox-connectors.mjs
 * MOCKED_PROVIDER_IDS omits both) — they stay `not_connected` whether the
 * sandbox flag is on or off. The maximum truthful evidence for the
 * "pull the vacation-planning Notion page + push tasks to TickTick" leg is
 * therefore the honest park: a plan step on the unconnected provider lands
 * the run in `waiting_for_connector` with "Needs a connection" + a working
 * Connections CTA (run-world.spec.ts scenario (d) pattern). No
 * requireSandbox() gate — this behavior is the same with the flag on or off.
 *
 * The internal half — turning the vacation project into household tasks via
 * homeops.create_task — has no external credential and completes for REAL.
 *
 * Acceptance (PRD §16 / journey-register UC-10): the honest park is proven
 * through the real UI, AND the internal task-creation leg is proven with a
 * real, completed run + server-truth task records.
 */

const STAMP = Date.now().toString(36);
const PARK_RUN_TITLE = `TG UC10 ticktick vacation push ${STAMP}`;
const TASK_1 = `TG UC10 book vacation rental ${STAMP}`;
const TASK_2 = `TG UC10 pack beach gear ${STAMP}`;
const CONV_TITLE = `TG UC10 vacation onboarding ${STAMP}`;
const PLAN_TITLE = `TG UC10 vacation onboarding plan ${STAMP}`;
const EVIDENCE_DIR = "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence";

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-10: pushing the vacation project to TickTick honestly parks on 'Needs a connection'; the internal task half completes for real", async ({ page }) => {
  test.info().annotations.push({ type: "external-blocker", description: "Notion + TickTick connectors — not sandboxed by design, real credentials user-owned" });
  const errors = watchPageErrors(page);

  // --- Part 1: the honest park (the "push to TickTick" leg). -------------
  // Fresh disposable household → zero connected accounts. ticktick.
  // listProjects is Read/requiresApproval:false (server/providers.mjs), but
  // engine.mjs's connector-account check fires before the tool ever runs, so
  // even a no-approval tool parks on `waiting_for_connector` when the
  // provider has no connected account — the run-world.spec.ts scenario (d)
  // pattern (pickUnconnectedProviderTool prefers exactly this shape).
  const parked = await apiFetch(page, "/api/runs/start", {
    method: "POST",
    body: {
      source: "manual",
      plan: {
        title: PARK_RUN_TITLE,
        summary: "TG UC10: push the vacation project's tasks into TickTick.",
        steps: [{ toolId: "ticktick.listProjects", title: "TG UC10 read TickTick projects", input: {} }],
      },
    },
  });
  expect(parked.status, JSON.stringify(parked.body)).toBe(200);
  await waitForRunStatus(page, parked.body.run.id, ["waiting_for_connector"]);

  await openScreen(page, "Automations");
  const tab = page.getByRole("tab", { name: /run history/i }).first();
  if (await tab.isVisible().catch(() => false)) await tab.click();
  else await page.getByText("Run History", { exact: false }).first().click();
  const parkRow = page.getByText(PARK_RUN_TITLE).first();
  await expect(parkRow, "the TickTick push must render in Run History").toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Needs a connection", { exact: false }).first(), "the honest label for an unconnected provider").toBeVisible({ timeout: 10_000 });
  await parkRow.click();
  await page.screenshot({ path: `${EVIDENCE_DIR}/uc10-vacation-onboarding-honest-park.png`, fullPage: true });

  const cta = page.getByRole("button", { name: /open connections/i }).first();
  await expect(cta, "a working Connections CTA off the parked run").toBeVisible({ timeout: 10_000 });
  await cta.click();
  await expect(page.getByRole("heading", { name: "Connections" }), "the CTA must actually land in Connections").toBeVisible({ timeout: 15_000 });

  // --- Part 2: the internal-task half completes for real. ----------------
  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);
  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "TickTick isn't connected yet, so I've onboarded the vacation project as household tasks instead.",
    plan: {
      title: PLAN_TITLE, summary: "Create household tasks for the vacation project.",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "homeops.create_task", title: "TG UC10 add rental task", detail: "", input: { title: TASK_1 }, requiresApproval: false },
        { toolId: "homeops.create_task", title: "TG UC10 add packing task", detail: "", input: { title: TASK_2 }, requiresApproval: false },
      ],
      approvalGates: [], risk: "Low",
    },
  }), async () => chat(page, "TG: onboard our vacation project into tasks", conv.body.conversation.id));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded"]);

  // Server truth: both vacation tasks are real, durable household tasks.
  const tasks = await apiFetch(page, "/api/tasks");
  const seeded = (tasks.body?.tasks ?? []).filter((t: any) => t.title === TASK_1 || t.title === TASK_2);
  expect(seeded.length, "both onboarding tasks must exist server-side").toBe(2);

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Ask FamiliOS");
  await page.getByText(CONV_TITLE, { exact: true }).first().click();
  await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finished \(2\/2\)|completed/i).first(), "the run_result must state an honest 2/2 outcome").toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${EVIDENCE_DIR}/uc10-vacation-onboarding.png`, fullPage: true });

  errors.assertClean();
});
