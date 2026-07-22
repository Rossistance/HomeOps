import { expect, test } from "@playwright/test";
import {
  apiFetch, chat, openScreen, requireBackend, signUpDisposableHousehold,
  waitForRunStatus, watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-20 — Chore Manager & Document Linker (ACTIVE lane; the audit's LIVE-verified
 * baseline, EV-032§4). Acceptance (PRD §16): task + list item + attachment visible
 * and linked from run_result.
 *
 * Journey: a parent asks in chat for a chore day to be set up. The plan creates a
 * task, adds a shopping-list item, drafts the family event, and attaches the
 * checklist note to it (eventId deterministically threaded from the created event —
 * the UC-19/20 engine behavior). The family then SEES all of it: the run_result
 * card with links in chat, the task on the Dashboard's "Open tasks" (≤2 clicks from
 * Home), and the event carrying the attachment.
 */

const STAMP = Date.now().toString(36);
const TASK_TITLE = `TG UC20 Clean the garage ${STAMP}`;
const LIST_ITEM = `TG UC20 Buy trash bags ${STAMP}`;
const EVENT_TITLE = `TG UC20 Garage day ${STAMP}`;
const NOTE_TEXT = `TG UC20 checklist doc reference ${STAMP}`;
const PLAN_TITLE = `TG UC20 chore plan ${STAMP}`;
const CONV_TITLE = `TG UC20 chore day ${STAMP}`;

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-20: chat-driven chore setup — task + list item + event attachment land and are visible with run_result links", async ({ page }) => {
  const errors = watchPageErrors(page);

  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);
  const conversationId = conv.body.conversation.id;

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "Setting up your garage chore day now.",
    plan: {
      title: PLAN_TITLE, summary: "Task + list item + event with attached checklist note.",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "homeops.create_task", title: "Create the chore task", detail: TASK_TITLE, input: { title: TASK_TITLE }, requiresApproval: false },
        { toolId: "homeops.create_list_item", title: "Add supplies to the list", detail: LIST_ITEM, input: { text: LIST_ITEM }, requiresApproval: false },
        { toolId: "homeops.create_event_draft", title: "Draft the garage-day event", detail: EVENT_TITLE, input: { title: EVENT_TITLE }, requiresApproval: false },
        // eventId left empty on purpose: the engine threads the ev_ id from the
        // prior succeeded step (deterministic entity-id threading, engine.mjs).
        { toolId: "homeops.attach_note_or_file_reference", title: "Attach the checklist note", detail: NOTE_TEXT, input: { eventId: "", note: NOTE_TEXT }, requiresApproval: false },
      ],
      approvalGates: [], risk: "Low",
    },
  }), async () => chat(page, "TG: set up our garage chore day — task, supplies, event, and attach the checklist", conversationId));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded", "succeeded", "succeeded"]);

  // Server truth: the attachment landed on the event created two steps earlier.
  const events = await apiFetch(page, "/api/events");
  const ev = (events.body?.events ?? []).find((e: any) => e.title === EVENT_TITLE);
  expect(ev, "the drafted event must exist").toBeTruthy();
  expect((ev.attachments ?? []).some((a: any) => String(a.text ?? "").includes(NOTE_TEXT)), "the note must be attached to the event").toBe(true);

  // UI truth 1 — the chat thread renders the run_result with LINKS (WP-004 contract).
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Ask FamiliOS");
  await page.getByText(CONV_TITLE, { exact: true }).first().click();
  await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finished \(4\/4\)|completed/i).first(), "the run_result must state an honest outcome").toBeVisible({ timeout: 15_000 });
  const resultLink = page.getByRole("button", { name: /open task|view task|task/i }).first();
  await expect(resultLink, "the run_result must link to the created task").toBeVisible({ timeout: 10_000 });

  // UI truth 2 — the task is ≤2 clicks from Home: Dashboard → Open tasks.
  await openScreen(page, "Home");
  await expect(page.getByText(TASK_TITLE).first(), "the chore task must be visible on the Dashboard").toBeVisible({ timeout: 15_000 });

  // UI truth 3 — the event exists on the Calendar surface.
  await openScreen(page, "Calendar");
  await expect(page.getByText(EVENT_TITLE).first(), "the drafted event must be visible on Calendar").toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/uc20-chore-manager.png", fullPage: true });

  errors.assertClean();
});
