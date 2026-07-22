import { expect, test } from "@playwright/test";
import {
  apiFetch, chat, openScreen, requireBackend, signUpDisposableHousehold,
  waitForRunStatus, watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-18 — Digital Memory Scrapbooker (ACTIVE lane).
 * Journey: a parent asks the assistant to remember a family moment and keep a
 * keepsake of it. The plan writes a household memory (homeops.write_memory) and
 * creates a durable artifact (homeops.create_artifact) in the same run.
 *
 * Acceptance (journey-register.md row 18 / PRD §16): "memory searchable + artifact
 * visible in Files & Knowledge". Proven surfaces this spec reuses: the Memory tab's
 * provider search box (memory-search.spec.ts, WP-007) and the Knowledge Library's
 * "Generated reports & briefings" group (results-homes.spec.ts, WP-004) — the exact
 * ISS-002-adjacent artifact-surface gap the audit flagged is what those WPs fixed.
 */

const STAMP = Date.now().toString(36);
const MEMORY_TEXT = `TG UC18 memory ${STAMP}: the school art show photo needs printing before Friday.`;
const ARTIFACT_TITLE = `TG UC18 keepsake ${STAMP}`;
const ARTIFACT_BODY = `TG UC18 scrapbook entry (${STAMP}): art show photo, printed and framed for the hallway.`;
const PLAN_TITLE = `TG UC18 memory scrapbook plan ${STAMP}`;
const CONV_TITLE = `TG UC18 scrapbook ${STAMP}`;
const EVIDENCE_DIR = "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence";

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-18: chat-driven memory + keepsake — the memory is searchable and the artifact is visible in the Knowledge Library", async ({ page }) => {
  const errors = watchPageErrors(page);

  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);
  const conversationId = conv.body.conversation.id;

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "Saving that memory and making you a keepsake of it.",
    plan: {
      title: PLAN_TITLE, summary: "Remember the moment and keep a durable keepsake.",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "homeops.write_memory", title: "Remember the art show photo", detail: MEMORY_TEXT, input: { text: MEMORY_TEXT, scope: "family" }, requiresApproval: false },
        { toolId: "homeops.create_artifact", title: "Keep a scrapbook entry", detail: ARTIFACT_TITLE, input: { title: ARTIFACT_TITLE, body: ARTIFACT_BODY, kind: "keepsake" }, requiresApproval: false },
      ],
      approvalGates: [], risk: "Low",
    },
  }), async () => chat(page, "TG: remember the art show photo and keep a scrapbook entry for it", conversationId));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded", "succeeded"]);

  // Server truth: the artifact landed with the exact title/body.
  const artifacts = await apiFetch(page, "/api/artifacts");
  const art = (artifacts.body?.artifacts ?? []).find((a: any) => a.title === ARTIFACT_TITLE);
  expect(art, "the keepsake artifact must exist server-side").toBeTruthy();
  expect(art.body).toBe(ARTIFACT_BODY);

  // UI truth 1 — the memory is searchable in Activity & Memory → Memory tab (WP-007
  // provider search, the same box memory-search.spec.ts proved against).
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Activity & Memory");
  await page.getByRole("tab", { name: /memory/i }).or(page.getByRole("button", { name: /^Memory$/ })).first().click();
  const search = page.getByLabel("Search memory across your household's full recall history");
  await expect(search, "the Memory tab must expose the provider search box").toBeVisible({ timeout: 10_000 });
  await search.fill(STAMP);
  await search.press("Enter");
  await expect(page.getByText(/art show photo needs printing before Friday/i).first(), "the written memory must render in the search results").toBeVisible({ timeout: 10_000 });

  // UI truth 2 — the keepsake artifact is visible in Files & Knowledge → Knowledge Library.
  await page.getByRole("button", { name: "Files & Knowledge", exact: true }).first().click();
  await page.getByRole("button", { name: /Knowledge Library/ }).click();
  const artifactsGroup = page.getByRole("button", { name: /Generated reports & briefings/ });
  await expect(artifactsGroup).toBeVisible({ timeout: 15_000 });
  if ((await artifactsGroup.getAttribute("aria-expanded")) !== "true") await artifactsGroup.click();
  await expect(page.getByText(ARTIFACT_TITLE).first(), "the keepsake artifact must be listed in the Knowledge Library").toBeVisible({ timeout: 15_000 });
  await page.getByText(ARTIFACT_TITLE).first().click();
  await expect(page.getByText(ARTIFACT_BODY).first(), "the artifact detail drawer must show the keepsake body").toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${EVIDENCE_DIR}/uc18-memory-scrapbooker.png`, fullPage: true });

  errors.assertClean();
});
