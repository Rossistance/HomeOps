import { expect, test } from "@playwright/test";
import http from "node:http";
import {
  apiFetch, chat, openScreen, requireBackend, signUpDisposableHousehold,
  waitForRunStatus, watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-16 — School Menu Data Harvester (ACTIVE lane; journey-register.md:
 * "RUNNABLE-NOW (browser-runtime healthy) — not exercised live"). /api/health
 * reports browserRuntime:true (in-process Playwright Chromium, server/browser.mjs)
 * and the plan drives it via the `browser` connector's browser.open tool
 * (server/connectors.mjs:108, executed at connectors.mjs:543-547).
 *
 * ENVIRONMENT GAP (found while writing this spec, reported per the mission's
 * explicit fallback instruction): browser.open's target URL is validated by the
 * SAME SSRF guard as UC-15/17 (server/connectors.mjs:355-356
 * `assertSafeUrl(body.url, { allowLoopback:false })`, inside callBrowserRuntime)
 * — loopback/private targets are refused with NO dev-mode/test seam, and hitting
 * a real external school-district page is separately banned (benchmark must be
 * hermetic; no external sends). A local node:http fixture page (the mission's
 * preferred approach) is therefore refused before the in-process Chromium ever
 * navigates to it. This spec proves the honest refusal path through the real
 * UI instead of fabricating a "menu harvested" success: the chat run reports it
 * didn't finish, and no menu artifact appears anywhere the family would look
 * (Files & Knowledge) — exactly the no-fabricated-success bar this benchmark
 * holds every UC to. No net.mjs code was touched or weakened.
 *
 * Separately worth flagging (not this guard): the PRD's own acceptance text for
 * UC-16 ("file downloaded to Local Files and listed") names the `files-local`
 * connector, whose only tool (file.import) is `runtime:"client"` — executeTool
 * (connectors.mjs:395-397) fails EVERY client-only tool closed with
 * `client_only` before it ever runs, for ANY plan, in ANY environment. A
 * chat-driven/agentic plan can never save a "downloaded file" through that
 * connector at all; only a manual, in-browser file import can. This spec
 * targets the mission brief's actual wording ("browser-runtime automation
 * reads a page; result saved/visible") via browser.open + homeops.create_artifact
 * instead, which is the closest agentic equivalent that exists.
 */

const STAMP = Date.now().toString(36);
const PLAN_TITLE = `TG UC16 school menu harvest plan ${STAMP}`;
const CONV_TITLE = `TG UC16 school menu harvest ${STAMP}`;
const ARTIFACT_TITLE = `TG UC16 school menu ${STAMP}`;

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-16: chat-driven school-menu harvest via browser automation — the egress guard's honest refusal (not a fabricated harvest) lands in chat and no menu artifact appears anywhere", async ({ page }) => {
  const errors = watchPageErrors(page);

  // Local fixture "school menu" page — never actually reached: the egress guard
  // refuses the loopback target before the headless browser ever navigates
  // (see the file-level note above).
  const fixture = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body><h1>This Week's Menu</h1><ul><li>Monday: Pizza</li><li>Tuesday: Tacos</li></ul></body></html>");
  });
  await new Promise<void>((resolve) => fixture.listen(0, resolve));
  const port = (fixture.address() as { port: number }).port;

  try {
    // Seeding: the browser connector reports "connected" readiness only after a real
    // handshake is RECORDED (server/connectors.mjs readinessOf — a configured URL alone
    // is not proof). Without this, executeTool never even reaches the egress guard: it
    // parks the run as "waiting_for_connector" first (a different, also-honest refusal).
    // /api/health already shows browserRuntime:true, so this records the in-process
    // Playwright Chromium handshake real health checks perform.
    const health = await apiFetch(page, "/api/connectors/browser/health", { method: "POST" });
    expect(health.status, JSON.stringify(health.body)).toBe(200);
    expect(health.body?.ok, `browser runtime must be healthy for this UC to reach the egress guard at all: ${JSON.stringify(health.body)}`).toBe(true);

    const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
    expect(conv.status, JSON.stringify(conv.body)).toBe(200);

    const done = await withFakeAiProvider(page, () => ({
      kind: "plan",
      answer: "Harvesting this week's school menu now.",
      plan: {
        title: PLAN_TITLE, summary: "Read the school menu page and save it.",
        icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
        steps: [
          { toolId: "browser.open", title: "Open the school menu page", detail: "extract this week's menu", input: { url: `http://127.0.0.1:${port}/menu`, extract: "this week's menu" }, requiresApproval: false },
          { toolId: "homeops.create_artifact", title: "Save the harvested menu", detail: ARTIFACT_TITLE, input: { title: ARTIFACT_TITLE, body: "" }, requiresApproval: false },
        ],
        approvalGates: [], risk: "Medium",
      },
    }), async () => chat(page, "TG: go get this week's school menu from the district page", conv.body.conversation.id));

    const runId = done?.run?.id;
    expect(runId, "the chat plan must auto-start a run").toBeTruthy();

    // browser.open is a "Browser Action", not a soft-failable "Read" — the guard's
    // refusal hard-fails the run on step 1; the save step never runs.
    const run = await waitForRunStatus(page, runId, ["failed"]);
    expect(run.steps[0].status).toBe("failed");
    expect(String(run.steps[0].detail), "the harvest step must report the real egress refusal, not a fabricated result").toMatch(/blocked/i);

    // Honest outcome in the chat thread — never claims a menu it didn't harvest.
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await openScreen(page, "Ask FamiliOS");
    await page.getByText(CONV_TITLE, { exact: true }).first().click();
    await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
    // Real server-side wording (server/assistant-runs.mjs runOutcomeText): a failed
    // run reports `"{title}" failed at step N (...): {error}.` — never a fabricated success.
    await expect(page.getByText(/failed at step \d/i).first(), "the run_result must honestly report the run failed, not a fabricated success").toBeVisible({ timeout: 15_000 });

    // No-fabricated-success check: the never-run save step must not have produced
    // an artifact anywhere the family would look for the harvested menu.
    await openScreen(page, "Files & Knowledge");
    await expect(page.getByText(ARTIFACT_TITLE), "no menu artifact must appear — the harvest genuinely never happened").toHaveCount(0);

    await page.screenshot({ path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/uc16-school-menu-harvester.png", fullPage: true });

    errors.assertClean();
  } finally {
    await new Promise((r) => fixture.close(r));
  }
});
