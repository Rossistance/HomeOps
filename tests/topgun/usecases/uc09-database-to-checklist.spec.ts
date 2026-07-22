import { expect, test } from "@playwright/test";
import {
  apiFetch, chat, openScreen, requireBackend, signUpDisposableHousehold,
  waitForRunStatus, watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-9 — Database-to-Checklist Pipeline (GATED lane, honest-park variant).
 *
 * Notion and Todoist are DELIBERATELY NOT SANDBOXED — server/test/README-
 * sandbox.md and server/sandbox-connectors.mjs MOCKED_PROVIDER_IDS both omit
 * them by design (they stay `not_connected` in real mode AND in sandbox mode
 * alike). There is therefore no sandbox twin to run for the "read the
 * database" half of this UC; the maximum TRUTHFUL evidence is the HONEST
 * PARK — a plan step on the unconnected provider lands the run in
 * `waiting_for_connector` with the "Needs a connection" label and a working
 * Connections CTA through the REAL UI, exactly the run-world.spec.ts
 * scenario (d) pattern (pickUnconnectedProviderTool / "Needs a connection").
 * No requireSandbox() gate is used here on purpose: this behavior is
 * identical with the sandbox flag on or off, so the spec never skips.
 *
 * The internal-checklist half of the pipeline — turning rows into
 * checklist items via homeops.create_list_item — has NO external credential
 * and completes for REAL in this same spec (server/internal-functions.mjs).
 *
 * Acceptance (PRD §16 / journey-register UC-9): the honest park is visible
 * end to end through the UI, AND the internal checklist-creation leg is
 * proven with a real, completed run + server-truth task record.
 */

const STAMP = Date.now().toString(36);
const PARK_RUN_TITLE = `TG UC09 notion database read ${STAMP}`;
const CHECKLIST_ITEM_1 = `TG UC09 checklist row A ${STAMP}`;
const CHECKLIST_ITEM_2 = `TG UC09 checklist row B ${STAMP}`;
const LIST_NAME = `TG UC09 Database Checklist ${STAMP}`;
const CONV_TITLE = `TG UC09 database to checklist ${STAMP}`;
const PLAN_TITLE = `TG UC09 checklist pipeline plan ${STAMP}`;
const EVIDENCE_DIR = "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence";

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-9: reading the Notion database honestly parks on 'Needs a connection'; the internal checklist half completes for real", async ({ page }) => {
  test.info().annotations.push({ type: "external-blocker", description: "Notion + Todoist connectors — not sandboxed by design, real credentials user-owned" });
  const errors = watchPageErrors(page);

  // --- Part 1: the honest park (the "read the database" leg). ------------
  // A fresh disposable household has zero connected accounts for any
  // provider — notion.search (Read, requiresApproval:false — server/
  // providers.mjs) resolves to `waiting_for_connector` the moment engine.mjs
  // finds no connected account, before ever reaching the (unmocked) network.
  const parked = await apiFetch(page, "/api/runs/start", {
    method: "POST",
    body: {
      source: "manual",
      plan: {
        title: PARK_RUN_TITLE,
        summary: "TG UC09: pull the project database rows from Notion so they can become checklist items.",
        steps: [{ toolId: "notion.search", title: "TG UC09 read Notion database", input: { query: "TG UC09 project tracker" } }],
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
  await expect(parkRow, "the Notion-database read must render in Run History").toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Needs a connection", { exact: false }).first(), "the honest label for an unconnected provider").toBeVisible({ timeout: 10_000 });
  await parkRow.click();
  await page.screenshot({ path: `${EVIDENCE_DIR}/uc09-database-to-checklist-honest-park.png`, fullPage: true });

  const cta = page.getByRole("button", { name: /open connections/i }).first();
  await expect(cta, "a working Connections CTA off the parked run").toBeVisible({ timeout: 10_000 });
  await cta.click();
  await expect(page.getByRole("heading", { name: "Connections" }), "the CTA must actually land in Connections").toBeVisible({ timeout: 15_000 });

  // --- Part 2: the internal-checklist half completes for real. -----------
  // No external credential is needed to turn the (conceptual, not-yet-
  // readable) database rows into household checklist items — homeops.
  // create_list_item is a durable internal write, proven via the real chat
  // → run → completion path, the same pattern uc01/uc11 use.
  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);
  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "I can't read the Notion database yet (it isn't connected), but I've turned the two rows you already gave me into checklist items.",
    plan: {
      title: PLAN_TITLE, summary: "Create checklist items for the known database rows.",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "homeops.create_list_item", title: "TG UC09 add checklist row A", detail: "", input: { text: CHECKLIST_ITEM_1, listName: LIST_NAME }, requiresApproval: false },
        { toolId: "homeops.create_list_item", title: "TG UC09 add checklist row B", detail: "", input: { text: CHECKLIST_ITEM_2, listName: LIST_NAME }, requiresApproval: false },
      ],
      approvalGates: [], risk: "Low",
    },
  }), async () => chat(page, "TG: turn these two database rows into checklist items", conv.body.conversation.id));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded"]);

  // Server truth: both checklist items are real, durable tasks of type "list".
  const tasks = await apiFetch(page, "/api/tasks");
  const seeded = (tasks.body?.tasks ?? []).filter((t: any) => t.title === CHECKLIST_ITEM_1 || t.title === CHECKLIST_ITEM_2);
  expect(seeded.length, "both checklist items must exist server-side").toBe(2);
  expect(seeded.every((t: any) => t.type === "list" && t.listName === LIST_NAME)).toBe(true);

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Ask FamiliOS");
  await page.getByText(CONV_TITLE, { exact: true }).first().click();
  await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finished \(2\/2\)|completed/i).first(), "the run_result must state an honest 2/2 outcome").toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${EVIDENCE_DIR}/uc09-database-to-checklist.png`, fullPage: true });

  errors.assertClean();
});
