import { expect, test } from "@playwright/test";
import http from "node:http";
import {
  apiFetch, approveViaUi, chat, openScreen, requireBackend, signUpDisposableHousehold,
  waitForRunStatus, watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-15 — Family Dashboard API Bridge (ACTIVE lane; journey-register.md:
 * "RUNNABLE-NOW (http connector revoked in resident tenant; re-enable) + POST
 * approval chain ISS-001"). This disposable household configures its OWN `http`
 * connector — the resident-tenant revocation is resident-only state and never
 * touched here (mission-pinned).
 *
 * ENVIRONMENT GAP (found while writing this spec, reported per the mission's
 * explicit fallback instruction): the http connector's SSRF/egress guard
 * (server/net.mjs assertSafeUrl, called from server/connectors.mjs:459-462 for
 * every http.get/http.post) blocks loopback/private-range targets with
 * `allowLoopback:false` and has NO dev-mode/test seam — server/test/
 * sandbox-connectors.test.mjs:412-414 pins the exact same refusal against
 * 127.0.0.1. Hitting a real external host is separately banned (benchmark must
 * be hermetic; no external sends). So in THIS environment, a chat-driven
 * http.get/http.post against a local fixture server can only ever reach the
 * guard's honest refusal, never a live bridge. This spec proves everything the
 * environment allows to be proven honestly:
 *   1. the household's own http connector is configured and the plan runs it,
 *   2. the High-risk POST leg is approval-gated and parks for a REAL decision
 *      (Messages → Approvals → Approve) exactly like the resident tenant would
 *      require — the approval loop is real and independent of the egress guard,
 *   3. after approval, the run's honest outcome (blocked by egress policy, not a
 *      fabricated success) is what chat actually reports.
 * No net.mjs code was touched or weakened to make this pass.
 */

const STAMP = Date.now().toString(36);
const PLAN_TITLE = `TG UC15 dashboard bridge plan ${STAMP}`;
const CONV_TITLE = `TG UC15 dashboard bridge ${STAMP}`;
const POST_STEP_TITLE = `TG UC15 post dashboard item ${STAMP}`;

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
});
test.afterEach(async ({ page }) => {
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("UC-15: chat-driven HTTP GET/POST bridge — POST parks for a real approval; the honest egress-blocked outcome (not a fabricated success) lands in chat", async ({ page }) => {
  const errors = watchPageErrors(page);

  // Local fixture "dashboard API" — the mission's preferred hermetic approach.
  // Never actually reached: the egress guard refuses the loopback target before
  // any connection is attempted (see the file-level note above).
  const fixture = http.createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); });
  await new Promise<void>((resolve) => fixture.listen(0, resolve));
  const port = (fixture.address() as { port: number }).port;

  try {
    // Seeding: THIS household configures its own http connector (never the resident tenant).
    const cfg = await apiFetch(page, "/api/connectors/http/config", { method: "POST", body: { baseUrl: `http://127.0.0.1:${port}` } });
    expect(cfg.status, JSON.stringify(cfg.body)).toBe(200);

    const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
    expect(conv.status, JSON.stringify(conv.body)).toBe(200);

    const done = await withFakeAiProvider(page, () => ({
      kind: "plan",
      answer: "Bridging your dashboard API now.",
      plan: {
        title: PLAN_TITLE, summary: "Read dashboard status, then post a new item (needs your OK).",
        icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
        steps: [
          { toolId: "http.get", title: "Read dashboard status", detail: "GET /status", input: { path: "/status" }, requiresApproval: false },
          { toolId: "http.post", title: POST_STEP_TITLE, detail: "POST /items", input: { path: "/items", body: { name: `TG UC15 item ${STAMP}` } }, requiresApproval: true },
        ],
        approvalGates: [], risk: "High",
      },
    }), async () => chat(page, "TG: bridge our dashboard API — check status, then post a new item", conv.body.conversation.id));

    const runId = done?.run?.id;
    expect(runId, "the chat plan must auto-start a run").toBeTruthy();

    // GET is a Read-action, non-approval-gated step with a later step: it fails
    // SOFT (egress-blocked) and the run continues to the gated POST, which parks.
    await waitForRunStatus(page, runId, ["waiting_for_approval"]);

    // Decide THROUGH THE REAL UI — the approval loop is real regardless of the guard.
    await approveViaUi(page, new RegExp(POST_STEP_TITLE));
    const run = await waitForRunStatus(page, runId, ["failed"]);
    expect(run.steps.map((s: any) => s.status), JSON.stringify(run.steps.map((s: any) => s.detail))).toEqual(["failed", "failed"]);
    expect(String(run.steps[0].detail), "the GET leg must report the real egress refusal, not a fabricated result").toMatch(/blocked/i);
    expect(String(run.steps[1].detail), "the approved POST leg must report the real egress refusal, not a fabricated success").toMatch(/blocked/i);

    // Honest outcome in the chat thread — never claims a delivered bridge it didn't achieve.
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await openScreen(page, "Ask FamiliOS");
    await page.getByText(CONV_TITLE, { exact: true }).first().click();
    await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 15_000 });
    // Real server-side wording (server/assistant-runs.mjs runOutcomeText): a failed
    // run reports `"{title}" failed at step N (...): {error}.` — never a fabricated success.
    await expect(page.getByText(/failed at step \d/i).first(), "the run_result must honestly report the run failed, not a fabricated success").toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence/uc15-dashboard-api-bridge.png", fullPage: true });

    errors.assertClean();
  } finally {
    await new Promise((r) => fixture.close(r));
  }
});
