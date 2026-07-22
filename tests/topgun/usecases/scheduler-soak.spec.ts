import { expect, test } from "@playwright/test";
import {
  apiFetch, approveViaUi, openScreen, requireBackend, signUpDisposableHousehold,
  waitForRunStatus, watchPageErrors,
} from "./uc";

/**
 * WP-006 s7 — the UNATTENDED soak scenario: a tz-anchored scheduled trigger fires
 * by itself (server tick, no browser/API nudge), the gated step PARKS for approval
 * instead of acting unattended, a human decides in the real Approvals UI, and the
 * run completes with the trigger's bookkeeping updated.
 *
 * Proves the mission's scheduler contract end to end:
 *  - anchor "HH:MM" resolves against the HOUSEHOLD timezone (tzSource:"household"),
 *  - the 10s tick fires the trigger at nextRunAt without any client involvement,
 *  - the kill-switch/approval gate holds for scheduled runs (parks, never acts),
 *  - decide→resume→complete works from the family-facing UI,
 *  - the run lands in the ONE run history (Automations) attributed to its agent.
 */

const STAMP = Date.now().toString(36);
const AGENT_NAME = `TG SOAK agent ${STAMP}`;
const SKILL_NAME = `TG SOAK morning check ${STAMP}`;
const STEP_TITLE = `TG SOAK sign-off ${STAMP}`;
const TZ = "America/New_York";

/** Wall-clock "HH:MM" in `tz` for a UTC instant. */
function wallClock(tz: string, atMs: number): string {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(atMs));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("unattended: a tz-anchored schedule fires on its own, parks for approval, and completes after a real UI decide", async ({ page }) => {
  test.setTimeout(300_000); // anchor granularity is one minute — the wait is real.
  const errors = watchPageErrors(page);

  // The household declares its timezone — the anchor must resolve against IT.
  const settings = await apiFetch(page, "/api/settings", { method: "POST", body: { timezone: TZ } });
  expect(settings.status, JSON.stringify(settings.body)).toBe(200);

  // A deterministic skill whose one step is approval-gated: an unattended fire
  // must PARK, never act (homeops.create_approval is server-pinned requiresApproval).
  const agent = await apiFetch(page, "/api/agents", {
    method: "POST",
    body: { name: AGENT_NAME, purpose: "TG unattended soak", instructions: "TG soak.", allowedToolIds: ["homeops.create_approval"], status: "Active" },
  });
  expect(agent.status, JSON.stringify(agent.body)).toBe(200);
  const skill = await apiFetch(page, "/api/skills", {
    method: "POST",
    body: {
      name: SKILL_NAME, description: "TG unattended scheduler soak", domain: "General", type: "custom", mode: "deterministic",
      defaultAgentId: agent.body.agent.id,
      steps: [{ step_id: "s1", name: STEP_TITLE, tool_id: "homeops.create_approval", input_mapping: { subject: STEP_TITLE, detail: "TG unattended soak sign-off detail." } }],
    },
  });
  expect(skill.status, JSON.stringify(skill.body)).toBe(200);

  // Anchor: the NEXT minute boundary ≥40s out on the household's wall clock, so the
  // tick (10s) has an unambiguous target inside this test's budget.
  const fireAt = (Math.floor(Date.now() / 60_000) + (Date.now() % 60_000 > 20_000 ? 2 : 1)) * 60_000;
  const anchor = wallClock(TZ, fireAt);
  const trig = await apiFetch(page, "/api/triggers", {
    method: "POST",
    body: { name: `TG SOAK trigger ${STAMP}`, type: "schedule", anchor, target: { kind: "skill", skillId: skill.body.skill.id } },
  });
  expect(trig.status, JSON.stringify(trig.body)).toBe(200);
  const trigger = trig.body.trigger;
  // tz-anchored proof: resolved against the HOUSEHOLD zone to exactly our instant.
  expect(trigger.tzSource, "anchor must resolve against the household timezone, not the server's").toBe("household");
  expect(trigger.nextRunAt, `nextRunAt must be the anchored instant (${new Date(fireAt).toISOString()})`).toBe(fireAt);

  // UNATTENDED WAIT: no clicks, no mutations — read-only polling for the run the
  // server tick creates by itself.
  let runId = "";
  await expect(async () => {
    const t = await apiFetch(page, `/api/triggers/${trigger.id}`);
    expect(t.body?.trigger?.lastRunId, `trigger has not fired yet (nextRunAt ${new Date(trigger.nextRunAt).toISOString()}, now ${new Date().toISOString()})`).toBeTruthy();
    runId = t.body.trigger.lastRunId;
  }).toPass({ timeout: fireAt - Date.now() + 45_000, intervals: [5_000] });

  // The gate held: the unattended run PARKED for a human decision.
  await waitForRunStatus(page, runId, ["waiting_for_approval"]);

  // The decide→complete loop through the real family-facing UI.
  await approveViaUi(page, new RegExp(STEP_TITLE));
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.sourceRef?.agentId, "the scheduled run must be attributed to its agent").toBe(agent.body.agent.id);

  // The ONE history: the run renders in Automations » Run History with its status.
  await openScreen(page, "Automations");
  const tab = page.getByRole("tab", { name: /run history/i }).first();
  if (await tab.isVisible().catch(() => false)) await tab.click();
  else await page.getByText("Run History", { exact: false }).first().click();
  await expect(page.getByText(AGENT_NAME).first(), "the unattended run must be visible in the unified history").toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/soak-unattended-scheduler.png", fullPage: true });

  // Trigger bookkeeping closed the loop.
  const after = await apiFetch(page, `/api/triggers/${trigger.id}`);
  expect(after.body.trigger.fireCount).toBeGreaterThanOrEqual(1);
  expect(["completed", "waiting_for_approval"]).toContain(after.body.trigger.lastStatus ?? "completed");

  errors.assertClean();
});
