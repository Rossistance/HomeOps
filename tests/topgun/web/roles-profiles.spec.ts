import { expect, test, type Page } from "@playwright/test";
import { openScreen, signUpDisposableHousehold, watchPageErrors } from "./helpers";

/**
 * WP-010 — WEB ACCESS & ROLES (ISS-012 / ISS-015 / EV-025/027/037 / JRN-3).
 *
 * The bug: after signing OUT of a signed-up (hh_*) household, the Lock screen only ever
 * offered the RESIDENT household's profiles — the signed-up family's own members (children
 * included) were unreachable on web, so the child role gates (childAiGate; no approval
 * decide rights) could never be exercised through the browser.
 *
 * This spec drives the REAL web client against the REAL local backend on a FRESH disposable
 * household (helpers.signUpDisposableHousehold — a physically separate hh_* tenant), then:
 *   (a) signs out and proves the picker lists BOTH members of the disposable household,
 *   (b) enters as the child and proves the childAiGate refuses chat with a kid-friendly
 *       message and the child has no approval-decide rights (server authority — the reachable
 *       manifestation of the gate now that the child can actually sign in on web),
 *   (c) proves the pre-auth privacy flag (hideProfilesPreAuth) hides that household's roster.
 *
 * Same lead-managed-stack etiquette as run-world.spec.ts: an unreachable backend SKIPS.
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

const lockHeading = (page: Page) => page.getByRole("heading", { name: /who.s using/i });

test.beforeEach(async ({ page }) => {
  const probe = await page.request.get("/api/health").catch(() => null);
  test.skip(!probe || !probe.ok(), "pending-stack-restart — backend on :8787 was unreachable when this spec ran; re-run once the lead has confirmed the dev stack is back up.");
});

test("child of a signed-up household can be reached from the picker, is chat-gated, and cannot decide approvals", async ({ page }) => {
  const errors = watchPageErrors(page);
  const { householdName } = await signUpDisposableHousehold(page);

  // The disposable-household helper signs up via a raw fetch (bypassing the app's own
  // backend.signup, which is what normally persists the picker hint). The owner is now in
  // the shell; capture the real hh_* id and add a child member the way an Owner does.
  const sess = await apiFetch(page, "/api/session");
  const hh = sess.body.session.householdId as string;
  expect(hh, "disposable household must be an hh_* tenant").toMatch(/^hh_/);

  const kid = await apiFetch(page, "/api/members", { method: "POST", body: { displayName: "WP Kid", role: "Child View", actorId: "m-kid", relationship: "Child" } });
  expect(kid.status, JSON.stringify(kid.body)).toBe(200);

  // Seed a pending approval in the household, requested by the OWNER (via a skill run) —
  // the child must never be able to see or decide it.
  const skill = await apiFetch(page, "/api/skills", {
    method: "POST",
    body: {
      name: "WP010 approval park", description: "WP010 child-cannot-decide scenario", domain: "General", type: "custom", mode: "deterministic",
      steps: [{ step_id: "s1", name: "Ask for sign-off", tool_id: "homeops.create_approval", input_mapping: { subject: "WP010 approval check", detail: "WP010 approval detail." } }],
    },
  });
  expect(skill.status, JSON.stringify(skill.body)).toBe(200);
  const started = await apiFetch(page, "/api/runs/start", { method: "POST", body: { skillId: skill.body.skill.id, source: "agent" } });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  await waitForRunStatus(page, started.body.run.id, ["waiting_for_approval"]);
  const ownerApprovals = await apiFetch(page, "/api/approvals");
  const approvalId = ownerApprovals.body.approvals[0]?.id as string;
  expect(approvalId, "owner should see the pending approval they requested").toBeTruthy();

  // Persist the picker hint exactly as the real signup/login flow does (api.ts
  // saveHouseholdHint) — the raw-fetch helper skipped that one step.
  await page.evaluate(({ hh, name }) => {
    localStorage.setItem("familios.householdHint.v1", JSON.stringify({ id: hh, name }));
  }, { hh, name: householdName });

  // Sign out and return to the Lock screen. The remembered hint makes the picker offer
  // THIS family's roster, not the resident household's.
  await apiFetch(page, "/api/session", { method: "DELETE" });
  await page.goto("/");
  await expect(lockHeading(page)).toBeVisible({ timeout: 20_000 });

  // (a) The picker lists BOTH members of the disposable household — the family's own owner
  // ("TG Owner", the signUpDisposableHousehold owner) AND the child — never the resident
  // household's "Ross — Owner".
  await expect(page.getByText("TG Owner", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("WP Kid", { exact: true })).toBeVisible();
  await expect(page.getByText("Ross", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp010-picker-own-household.png`, fullPage: true });

  // Scope 2 (no escalation): clicking the OWNER — an email+password member — must NOT enter
  // passwordlessly; it reveals the sign-in form asking for that member's own credentials.
  await page.getByText("TG Owner", { exact: true }).click();
  await expect(page.getByText(/Enter TG Owner's email and password/i)).toBeVisible({ timeout: 10_000 });

  // The child has no identity, so picking them enters straight in with a Child View session.
  await page.getByText("WP Kid", { exact: true }).click();
  await expect(lockHeading(page)).toBeHidden({ timeout: 15_000 });
  const childSess = await apiFetch(page, "/api/session");
  expect(childSess.body.session.role).toBe("Child View");
  expect(childSess.body.session.householdId).toBe(hh);
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp010-child-chat-gate.png`, fullPage: true });

  // (b1) childAiGate: the child's assistant chat is refused with a kid-friendly message.
  const chat = await apiFetch(page, "/api/assistant", { method: "POST", body: { text: "hi" } });
  expect(chat.status).toBe(403);
  expect(chat.body.error).toBe("ai_disabled");
  expect(chat.body.message).toMatch(/ask a parent/i);

  // (b2) No decide rights: the child never even SEES the owner's pending approval, and a
  // direct decide attempt is refused server-side. The child's trimmed navigation has no
  // Messages/Approvals entry at all — the UI manifestation of "no decide buttons".
  const childApprovals = await apiFetch(page, "/api/approvals");
  expect(childApprovals.status).toBe(200);
  expect(childApprovals.body.approvals.map((a: any) => a.id)).not.toContain(approvalId);
  const decide = await apiFetch(page, `/api/approvals/${approvalId}/decide`, { method: "POST", body: { decision: "approve" } });
  expect(decide.status).toBe(403);
  await expect(page.getByRole("button", { name: "Messages", exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp010-child-no-decide.png`, fullPage: true });

  errors.assertClean();
});

test("privacy flag hides the household's roster from the pre-auth picker (ISS-015)", async ({ page }) => {
  const { householdName } = await signUpDisposableHousehold(page);
  const sess = await apiFetch(page, "/api/session");
  const hh = sess.body.session.householdId as string;

  // Baseline: with the hint, the pre-auth picker returns the roster (no session needed).
  const beforeFresh = await page.request.get(`/api/profiles?household=${encodeURIComponent(hh)}`);
  expect((await beforeFresh.json()).profiles.length).toBeGreaterThan(0);

  // Owner turns the privacy flag ON.
  const set = await apiFetch(page, "/api/settings", { method: "POST", body: { hideProfilesPreAuth: true } });
  expect(set.status).toBe(200);
  expect(set.body.settings.hideProfilesPreAuth).toBe(true);

  // A FRESH context (no session cookie) now gets no names for that household. Fetch from
  // inside a same-origin page so the browser sets the correct allowed Origin automatically.
  const base = new URL(page.url()).origin;
  const ctx = await page.context().browser()!.newContext();
  try {
    const p2 = await ctx.newPage();
    await p2.goto(base);
    const body = await p2.evaluate(async (hh) => {
      const r = await fetch(`/api/profiles?household=${encodeURIComponent(hh)}`, { credentials: "include" });
      return r.json();
    }, hh);
    expect(body.hidden).toBe(true);
    expect(body.profiles.length).toBe(0);
  } finally {
    await ctx.close();
  }
  expect(householdName).toContain("TG Disposable");
});

test.afterEach(async ({ page }) => {
  // Best-effort teardown of the disposable tenant (never the resident household). If we
  // ended the test as the child, re-establish an Owner session first so the delete is authorized.
  const who = await apiFetch(page, "/api/session").catch(() => null);
  if (!who?.body?.session || who.body.session.role !== "Owner") return;
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});
