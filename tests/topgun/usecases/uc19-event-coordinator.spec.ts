import { expect, test } from "@playwright/test";
import {
  apiFetch, chat, openScreen, requireBackend, signUpDisposableHousehold,
  waitForRunStatus, watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-19 — Event Coordinator & Logistics Assigner (ACTIVE lane; RUNNABLE-NOW per
 * journey-register.md: "engine threads eventId deterministically — not exercised
 * live"). Acceptance (PRD §16): event + checklist + driver + what-to-bring visible
 * on Calendar/event detail.
 *
 * Journey: a parent asks in chat to set up a field-trip event with logistics. The
 * plan drafts the event, then three follow-on homeops.* steps all need the fresh
 * eventId — left empty on purpose so the engine's deterministic entity-id
 * threading (server/engine.mjs deterministicFill, the `ev_`-prefixed id from the
 * prior succeeded step) fills it, exactly the UC-19/20 engine behavior the pilot
 * (uc20) proved. driverId is NOT auto-threaded (engine.mjs:221 — it "never
 * touches member-reference ids"), so this spec supplies the real household
 * member id (the signed-in owner's actorId) itself. The family then sees the
 * event, its checklist, its driver, and its what-to-bring list on Calendar.
 */

const STAMP = Date.now().toString(36);
const EVENT_TITLE = `TG UC19 Field trip ${STAMP}`;
const CHECKLIST_ITEM_1 = `TG UC19 Pack lunch ${STAMP}`;
const CHECKLIST_ITEM_2 = `TG UC19 Bring permission slip ${STAMP}`;
const BRING_ITEM = `TG UC19 Sunscreen ${STAMP}`;
const PLAN_TITLE = `TG UC19 event logistics plan ${STAMP}`;
const CONV_TITLE = `TG UC19 event logistics ${STAMP}`;

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-19: chat-driven event logistics — event + checklist + driver + what-to-bring land and are visible on Calendar", async ({ page }) => {
  const errors = watchPageErrors(page);

  // Seeding: the real member id to assign as driver (driverId is never auto-threaded).
  const session = await apiFetch(page, "/api/session");
  expect(session.status, JSON.stringify(session.body)).toBe(200);
  const ownerActorId = session.body.session.actorId;
  const ownerName = session.body.session.actorName;
  expect(ownerActorId, "the signed-in owner must have an actorId to assign as driver").toBeTruthy();

  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);
  const conversationId = conv.body.conversation.id;

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "Setting up the field trip logistics now.",
    plan: {
      title: PLAN_TITLE, summary: "Event + checklist + driver + what-to-bring for the field trip.",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "homeops.create_event_draft", title: "Draft the field trip event", detail: EVENT_TITLE, input: { title: EVENT_TITLE, location: "School" }, requiresApproval: false },
        // eventId left empty on purpose for all three follow-on steps: the engine
        // threads the ev_ id from the create_event_draft step above (deterministic
        // entity-id threading, engine.mjs:214-227 — the UC-19 engine behavior).
        { toolId: "homeops.update_event_checklist", title: "Add the trip checklist", detail: `${CHECKLIST_ITEM_1}, ${CHECKLIST_ITEM_2}`, input: { eventId: "", items: [CHECKLIST_ITEM_1, CHECKLIST_ITEM_2] }, requiresApproval: false },
        { toolId: "homeops.assign_driver", title: "Assign the driver", detail: ownerName, input: { eventId: "", driverId: ownerActorId }, requiresApproval: false },
        { toolId: "homeops.assign_what_to_bring", title: "Assign what to bring", detail: BRING_ITEM, input: { eventId: "", items: [BRING_ITEM] }, requiresApproval: false },
      ],
      approvalGates: [], risk: "Low",
    },
  }), async () => chat(page, "TG: set up our field trip — event, checklist, a driver, and what to bring", conversationId));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status), JSON.stringify(run.steps.map((s: any) => s.detail))).toEqual(["succeeded", "succeeded", "succeeded", "succeeded"]);

  // Server truth: one event carries all three logistics writes, correctly threaded.
  const events = await apiFetch(page, "/api/events");
  const ev = (events.body?.events ?? []).find((e: any) => e.title === EVENT_TITLE);
  expect(ev, "the drafted event must exist").toBeTruthy();
  expect(ev.driverId).toBe(ownerActorId);
  expect((ev.checklist ?? []).map((c: any) => c.text)).toEqual([CHECKLIST_ITEM_1, CHECKLIST_ITEM_2]);
  expect((ev.whatToBring ?? []).map((w: any) => w.item)).toEqual([BRING_ITEM]);

  // UI truth 1 — the chat thread renders an honest completed run_result.
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Ask FamiliOS");
  await page.getByText(CONV_TITLE, { exact: true }).first().click();
  await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/finished \(4\/4\)|completed/i).first(), "the run_result must state an honest 4/4 outcome").toBeVisible({ timeout: 15_000 });

  // UI truth 2 — the event, its driver, its checklist, and its what-to-bring list
  // are all visible on the real Calendar surface.
  await openScreen(page, "Calendar");
  const eventButton = page.getByRole("button", { name: `Open ${EVENT_TITLE}` });
  await expect(eventButton, "the field-trip event must be visible on Calendar").toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(new RegExp(`Driver: ${ownerName}`)).first(), "the assigned driver must show on the event row").toBeVisible({ timeout: 10_000 });

  await eventButton.click();
  await expect(page.getByText(CHECKLIST_ITEM_1).first(), "checklist item 1 must be visible in the event detail").toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(CHECKLIST_ITEM_2).first(), "checklist item 2 must be visible in the event detail").toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(BRING_ITEM).first(), "the what-to-bring item must be visible in the event detail").toBeVisible({ timeout: 10_000 });

  await page.screenshot({ path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/uc19-event-coordinator.png", fullPage: true });

  errors.assertClean();
});
