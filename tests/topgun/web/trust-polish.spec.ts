import { expect, test, type Page } from "@playwright/test";
import { openScreen, signUpDisposableHousehold, watchPageErrors } from "./helpers";

/**
 * WP-011 — trust & lifecycle polish (ISS-014).
 *
 * Drives the REAL web client against the REAL local backend on a FRESH disposable
 * household (helpers.ts signUpDisposableHousehold — a physically separate hh_*
 * tenant DB). Mission rule: specs that write records never touch the resident
 * family tenant.
 *
 * Forces a genuine technical audit row the same way run-world.spec.ts scenario (d)
 * does — a provider tool with zero connected accounts parks the run
 * (waiting_for_connector) and writes a real `run.step` audit event with a raw
 * error code. Before this WP, the Activity Log showed that raw string
 * ("run.step · <toolId> — <error>") to every family member. This spec proves:
 *   - by default (Advanced Mode off), the family sees a warm, honest, plain-
 *     language line instead of the raw string;
 *   - with Advanced Mode on, the exact raw string is still there, unchanged.
 *
 * Each test starts with a runtime probe: if the backend on :8787 is unreachable,
 * the spec skips with reason "pending-stack-restart" rather than failing — this
 * dev stack is lead-managed and this agent must never restart it itself.
 */

const EVIDENCE_DIR = "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence";

async function apiFetch(page: Page, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  return page.evaluate(async ({ path, init }) => {
    const s = await fetch("/api/session", { credentials: "include" }).then((r) => r.json()).catch(() => null);
    const csrf = s?.session?.csrf;
    const r = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "include",
      headers: { "content-type": "application/json", ...(csrf && init.method && init.method !== "GET" ? { "x-homeops-csrf": csrf } : {}) },
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

// Same technique as run-world.spec.ts (d): find a provider tool with zero
// connected accounts so starting a run against it genuinely parks on the
// connector, producing a REAL "run.step" audit event with ok:false.
async function pickUnconnectedProviderTool(page: Page): Promise<{ toolId: string }> {
  const r = await apiFetch(page, "/api/providers");
  const providers: { id: string; accounts?: unknown[]; tools: { id: string; action: string; requiresApproval: boolean }[] }[] = r.body?.providers ?? [];
  for (const p of providers) {
    if ((p.accounts?.length ?? 0) > 0) continue;
    const tool = p.tools.find((t) => t.action === "Read" && !t.requiresApproval) ?? p.tools.find((t) => !t.requiresApproval);
    if (tool) return { toolId: tool.id };
  }
  throw new Error(`no unconnected provider tool available to force a connector park — providers: ${JSON.stringify(providers.map((p) => ({ id: p.id, accounts: p.accounts?.length ?? 0 })))}`);
}

test.beforeEach(async ({ page }) => {
  const probe = await page.request.get("/api/health").catch(() => null);
  test.skip(!probe || !probe.ok(), "pending-stack-restart — backend on :8787 was unreachable when this spec ran; re-run once the lead has confirmed the dev stack is back up.");
});

test("Activity Log shows a plain-language line for a technical audit row, and the raw string only under Advanced Mode", async ({ page }) => {
  const errors = watchPageErrors(page);
  await signUpDisposableHousehold(page);

  const { toolId } = await pickUnconnectedProviderTool(page);
  const started = await apiFetch(page, "/api/runs/start", {
    method: "POST",
    body: {
      source: "manual",
      plan: {
        title: "TG-WP011 trust-polish connector park",
        summary: "TG trust-polish plain-language scenario",
        steps: [{ toolId, title: "TG connector-park step", input: {} }],
      },
    },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  await waitForRunStatus(page, started.body.run.id, ["waiting_for_connector"]);

  // Confirm server truth: a real run.step audit row exists, with ok:false and a
  // raw error code — this is the exact raw string the Activity Log used to leak.
  const audit = await apiFetch(page, "/api/audit?limit=50");
  const rows: { type: string; toolId?: string; ok: boolean; error?: string }[] = audit.body?.audit ?? audit.body?.events ?? [];
  const techRow = rows.find((r) => r.type === "run.step" && r.toolId === toolId && r.ok === false);
  expect(techRow, `expected a run.step audit row for ${toolId}; got ${JSON.stringify(rows.slice(0, 10))}`).toBeTruthy();
  const rawSubstring = `${toolId} — ${techRow!.error ?? "failed"}`;

  // ---- Advanced Mode OFF (default): plain language, no raw code ----
  await openScreen(page, "Activity & Memory");
  await expect(page.getByRole("heading", { name: "Activity & Memory" })).toBeVisible({ timeout: 15_000 });
  // Narrow to just this event's action type so the assertion isn't fooled by other
  // rows (e.g. identity.created from signup) that happen to share the household.
  // The Shell chrome renders its own household-space <select> ahead of this screen's
  // filters in DOM order, so a bare `.first()` would pick that up instead. Identify
  // the Activity Log's OWN "action type" filter by the option it must contain.
  const typeSelect = page.locator("select").filter({ has: page.locator('option[value="run.step"]') });
  await typeSelect.selectOption("run.step");
  const plainRow = page.locator("li", { hasText: /isn.t connected yet|wasn.t reachable|needs to be signed in again|ran into a problem/i }).first();
  await expect(plainRow, "the Activity Log must show a warm plain-language line for the technical audit row by default").toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(rawSubstring, { exact: false }), "the raw technical string must NOT be visible with Advanced Mode off").toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp011-activity-plain.png`, fullPage: true });

  // ---- Advanced Mode ON: the raw string is available, verbatim ----
  await openScreen(page, "Settings");
  await page.getByRole("switch", { name: "Advanced Mode" }).click();
  await openScreen(page, "Activity & Memory");
  const typeSelectAdvanced = page.locator("select").filter({ has: page.locator('option[value="run.step"]') });
  await typeSelectAdvanced.selectOption("run.step");
  await expect(page.getByText(rawSubstring, { exact: false }).first(), "the raw audit string must be visible verbatim once Advanced Mode is on").toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp011-activity-advanced.png`, fullPage: true });

  errors.assertClean();
});
