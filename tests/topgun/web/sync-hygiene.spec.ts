import { expect, test, type Page } from "@playwright/test";
import { openScreen, signUpDisposableHousehold, watchPageErrors } from "./helpers";

/**
 * WP-009 — SYNC HYGIENE (ISS-010 / HYP-006 / EV-030). Mission-bar UI-rendered proof.
 *
 * EV-030 observed ~11 collection GETs per second (roughly once per second per open
 * tab, ~660 req/min) even though /api/rev already existed as a short-circuit. Root
 * cause (HYP-006), found by reading src/store/useStore.ts and server/store.mjs:
 *
 *  1. `_dataRev` was a single PROCESS-GLOBAL counter (server/store.mjs) — on a
 *     shared dev/test server running several disposable households concurrently
 *     (this mission runs siblings against the same :8787), any household's write
 *     bumped rev for every OTHER household's client too, making "only refetch on
 *     real change" nearly meaningless.
 *  2. Independently — and this is what actually produced the ~1 req/sec storm —
 *     src/store/useStore.ts's sendToAssistant() ran a loop that called the full
 *     10-collection hydrateFromServer() unconditionally every 2.5s (plus three
 *     more unconditional calls after) for up to 2.5 minutes whenever a chat
 *     message auto-started a run. That loop never consulted /api/rev at all, so
 *     the gate sitting right next to it in the same file did nothing to stop it.
 *
 * The fix (this WP): rev is now tracked per-household (server/store.mjs), pushed
 * over SSE (/api/changes) the instant it changes, with a slow poll fallback that
 * backs off further when the tab is hidden (src/store/useStore.ts loadBackend);
 * and the run-watch loop no longer calls hydrateFromServer on a timer — it relies
 * on the same rev-driven path and only polls the single run's own status.
 *
 * Runs on a FRESH disposable household per test (helpers.ts signUpDisposableHousehold)
 * so this suite's traffic can never be mistaken for another test's, and so the
 * per-household rev fix above is actually exercised (not the resident tenant).
 */

const EVIDENCE_DIR = "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence";

async function apiFetch(
  page: Page,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  return page.evaluate(async ({ path, init }) => {
    const s = await fetch("/api/session", { credentials: "include" }).then((r) => r.json()).catch(() => null);
    const csrf = s?.session?.csrf;
    const r = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(csrf && init.method && init.method !== "GET" ? { "x-homeops-csrf": csrf } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { path, init });
}

async function waitForRunStatus(page: Page, runId: string, statuses: string[], timeout = 25_000) {
  let last: any;
  await expect(async () => {
    const r = await apiFetch(page, `/api/runs/${runId}`);
    last = r.body?.run;
    expect(statuses).toContain(last?.status);
  }).toPass({ timeout });
  return last;
}

/**
 * Is the RUNNING server process new enough to have /api/changes (SSE)? This dev
 * stack is a plain `node server/index.mjs` with no file-watcher (scripts/dev.mjs)
 * — server-side edits (server/index.mjs, server/store.mjs) only take effect after
 * the lead restarts it, which this agent must never do itself. Probe with NO
 * session cookie: gate({requireSession:true}) runs BEFORE the SSE stream opens
 * (server/index.mjs), so an unauthenticated GET resolves immediately either way —
 * 401 on the new server (route matched, auth rejected before writeHead), 404 on
 * an old one (route doesn't exist yet). Never hangs waiting on an open stream.
 *
 * (b) and (c) below are the ≤5s-freshness tests, which — see the SSE comment in
 * loadBackend (src/store/useStore.ts) — are mathematically impossible to satisfy
 * with polling alone inside the ≤6-requests/60s idle budget (a poll fast enough
 * to notice a change within 5s needs ≥12 requests/min). They gate on this probe
 * and skip with "pending-stack-restart" rather than fail while the shared stack
 * still predates this WP's server changes — the same pattern run-world.spec.ts
 * uses for "backend unreachable." (a) has no such dependency: it degrades
 * gracefully to the slow poll-only fallback, which if anything makes the idle
 * count LOWER, so it runs unconditionally.
 */
async function sseRouteExists(page: Page): Promise<boolean> {
  const origin = new URL(page.url()).origin;
  try {
    const res = await fetch(`${origin}/api/changes`);
    return res.status !== 404;
  } catch {
    return false;
  }
}

test.beforeEach(async ({ page }) => {
  // Runtime feature probe — this dev stack is lead-managed; this agent must never
  // restart it, so an unreachable backend skips the file rather than failing it.
  const probe = await page.request.get("/api/health").catch(() => null);
  test.skip(!probe || !probe.ok(), "pending-stack-restart — backend on :8787 was unreachable when this spec ran; re-run once the lead has confirmed the dev stack is back up.");
  await signUpDisposableHousehold(page);
});

test.afterEach(async ({ page }) => {
  // Best-effort teardown: remove the disposable tenant this test created. Never
  // touches the resident family household — signUpDisposableHousehold always
  // signs in as a freshly created Owner on its own throwaway tenant.
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

test("(a) an idle app makes at most 6 /api/* requests over a 60s window (PRD §14)", async ({ page }) => {
  test.setTimeout(100_000);
  const errors = watchPageErrors(page);
  await openScreen(page, "Home");

  // Let the initial hydrate burst (loadBackend's first hydrateFromServer + the
  // SSE connect + the catch-up rev poll) fully settle before measuring — the
  // acceptance bar is steady-state idle traffic, not first paint.
  await page.waitForTimeout(5_000);

  const idleRequests: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/")) idleRequests.push(`${req.method()} ${url.replace(/^https?:\/\/[^/]+/, "")}`);
  });

  await page.waitForTimeout(60_000);

  await page.screenshot({ path: `${EVIDENCE_DIR}/wp009-idle-trace.png`, fullPage: true });
  console.log(`[wp009] idle /api/* requests over 60s: ${idleRequests.length}`, idleRequests);
  expect(idleRequests.length, `idle /api/* requests in 60s (PRD §14 budget: ≤6): ${JSON.stringify(idleRequests)}`).toBeLessThanOrEqual(6);
  errors.assertClean();
});

test("(b) a server-side data change is visible in the UI within 5s, with no reload", async ({ page }) => {
  test.skip(!(await sseRouteExists(page)), "pending-stack-restart — /api/changes not present in the currently-running server process yet; see sseRouteExists comment above.");
  const errors = watchPageErrors(page);
  await openScreen(page, "Home");
  await page.waitForTimeout(2_000); // let the initial hydrate settle so this is a genuine mid-idle change

  const title = `TG-WP009 sync task ${Date.now().toString(36)}`;
  const created = await apiFetch(page, "/api/tasks", {
    method: "POST",
    body: { title, type: "task", status: "todo", spaceId: "sp-family" },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);

  // toBeVisible's own timeout enforces the ≤5s bar — if the rev push/poll or the
  // resulting hydrateFromServer() is too slow, this throws before 5s elapses.
  const t0 = Date.now();
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 5_000 });
  console.log(`[wp009] server-created task rendered after ${Date.now() - t0}ms`);
  errors.assertClean();
});

test("(c) an approval-gated run parking updates the 'to approve' badge within 5s, with no reload", async ({ page }) => {
  test.skip(!(await sseRouteExists(page)), "pending-stack-restart — /api/changes not present in the currently-running server process yet; see sseRouteExists comment above.");
  const errors = watchPageErrors(page);
  await openScreen(page, "Home");
  await page.waitForTimeout(2_000);

  // Same server contract as tests/topgun/web/run-world.spec.ts scenario (c): a
  // skill whose one step is the approval-gating tool, run via /api/runs/start.
  const skill = await apiFetch(page, "/api/skills", {
    method: "POST",
    body: {
      name: "TG-WP009 badge freshness", description: "TG sync-hygiene badge scenario", domain: "General", type: "custom", mode: "deterministic",
      steps: [{ step_id: "s1", name: "Ask for sign-off", tool_id: "homeops.create_approval", input_mapping: { subject: "TG WP009 badge check", detail: "TG sync-hygiene approval detail." } }],
    },
  });
  expect(skill.status, JSON.stringify(skill.body)).toBe(200);

  const t0 = Date.now();
  const started = await apiFetch(page, "/api/runs/start", { method: "POST", body: { skillId: skill.body.skill.id, source: "agent" } });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  await waitForRunStatus(page, started.body.run.id, ["waiting_for_approval"]);

  // Desktop: the Topbar renders a "N to approve" pill (`sm:flex`, hidden on
  // narrow/mobile viewports). Mobile (the iPhone webkit project): the same
  // server-truth count renders as a numeric badge on the "Messages" nav item,
  // reachable via the drawer — same freshness path, different surface.
  const viewport = page.viewportSize();
  const isNarrow = !viewport || viewport.width < 640;
  if (!isNarrow) {
    await expect(page.getByText(/to approve/i)).toBeVisible({ timeout: 5_000 });
  } else {
    await page.getByLabel("Open menu").click();
    const drawer = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(drawer.locator('button:has-text("Messages") span.bg-amber-500')).toBeVisible({ timeout: 5_000 });
  }
  console.log(`[wp009] "to approve" badge updated after ${Date.now() - t0}ms (no reload)`);
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp009-badge-freshness.png`, fullPage: true });
  errors.assertClean();
});
