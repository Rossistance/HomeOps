import { expect, test, type Page } from "@playwright/test";
import {
  apiFetch, chat, openMessagesTab, openScreen, requireBackend, signUpDisposableHousehold,
  waitForRunStatus, watchPageErrors, withFakeAiProvider,
} from "./uc";

/**
 * UC-22 — Internal System Sync (functions) (ACTIVE lane).
 * Two angles per journey-register.md row 22:
 *  1. A chat-driven plan writes a note to memory via homeops.write_memory — the
 *     fn_note_to_memory equivalent (server/internal-functions.mjs; "fn_note_to_memory
 *     available" per the register) — then the note is searchable in the Memory tab
 *     (same WP-007 provider-search contract as memory-search.spec.ts / UC-18).
 *  2. A "recent inbox digest": real server notifications render in Messages → Inbox
 *     (the exact WP-001 surface run-world.spec.ts's inbox-truth test proved — seeded
 *     via the legitimate /api/help-requests route, never a fixture) — standing in for
 *     the register's noted "digest fn draft" gap with the real underlying surface.
 */

const STAMP = Date.now().toString(36);
const SYNC_NOTE = `TG UC22 sync ${STAMP}: the router firmware update finished overnight without issues.`;
const PLAN_TITLE = `TG UC22 system sync plan ${STAMP}`;
const CONV_TITLE = `TG UC22 system sync ${STAMP}`;
const DIGEST_MESSAGE = `TG UC22 inbox digest ${STAMP}: this exact sentence must render as an unread row.`;
const EVIDENCE_DIR = "D:/FamiliOS/FamiliOS/.top-gun/runs/run-20260721-054151/implementation/evidence";

const created: { helpRequestId?: string } = {};

test.beforeEach(async ({ page }) => {
  await requireBackend(page);
  await signUpDisposableHousehold(page);
});
test.afterEach(async ({ page }) => {
  if (created.helpRequestId) await apiFetch(page, `/api/help-requests/${created.helpRequestId}/cancel`, { method: "POST" }).catch(() => {});
  await apiFetch(page, "/api/account", { method: "DELETE", body: { password: "tg-disposable-pass-1" } }).catch(() => {});
});

/** Seed a real, legitimate server notification (POST /api/help-requests, targeted at
 * self) — the same deterministic, non-fixture seed run-world.spec.ts's inbox-truth
 * test uses to prove the Inbox tab is a live read-model of server truth. */
async function seedInboxDigestNotification(page: Page, message: string) {
  const r = await page.evaluate(async (message) => {
    const s = await fetch("/api/session", { credentials: "include" }).then((r) => r.json()).catch(() => null);
    const csrf = s?.session?.csrf;
    const res = await fetch("/api/help-requests", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json", ...(csrf ? { "x-homeops-csrf": csrf } : {}) },
      body: JSON.stringify({ toActorId: s?.session?.actorId, message, kind: "ask" }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, message);
  return r;
}

test("UC-22: a system-sync note lands in memory and a recent server notification renders as a real inbox digest", async ({ page }) => {
  const errors = watchPageErrors(page);

  // ---- Angle 1: chat-driven note-to-memory (fn_note_to_memory equivalent).
  const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: CONV_TITLE } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(200);

  const done = await withFakeAiProvider(page, () => ({
    kind: "plan",
    answer: "Logging that in the household's memory.",
    plan: {
      title: PLAN_TITLE, summary: "Write the system-sync note to household memory.",
      icon: "Bot", spaceType: "Family", instructions: "", trigger: { type: "Manual", detail: "" },
      steps: [
        { toolId: "homeops.write_memory", title: "Note the firmware sync", detail: SYNC_NOTE, input: { text: SYNC_NOTE, scope: "household" }, requiresApproval: false },
      ],
      approvalGates: [], risk: "Low",
    },
  }), async () => chat(page, "TG: note that the router firmware sync finished overnight", conv.body.conversation.id));

  const runId = done?.run?.id;
  expect(runId, "the chat plan must auto-start a run").toBeTruthy();
  const run = await waitForRunStatus(page, runId, ["completed"]);
  expect(run.steps.map((s: any) => s.status)).toEqual(["succeeded"]);

  // ---- Angle 2: a real server notification, seeded via a legitimate route.
  const seeded = await seedInboxDigestNotification(page, DIGEST_MESSAGE);
  expect(seeded.status, `help-request seed should succeed: ${JSON.stringify(seeded.body).slice(0, 300)}`).toBe(200);
  created.helpRequestId = seeded.body?.helpRequest?.id;

  await expect(async () => {
    const notifs = await apiFetch(page, "/api/notifications");
    const mine = (notifs.body?.notifications ?? []).find((n: any) => n.body?.includes(DIGEST_MESSAGE));
    expect(mine, "the server must have recorded the digest notification").toBeTruthy();
    expect(mine.read).toBe(false);
  }).toPass({ timeout: 10_000 });

  // UI truth 1 — the note is searchable in Activity & Memory → Memory tab.
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Activity & Memory");
  await page.getByRole("tab", { name: /memory/i }).or(page.getByRole("button", { name: /^Memory$/ })).first().click();
  const search = page.getByLabel("Search memory across your household's full recall history");
  await expect(search, "the Memory tab must expose the provider search box").toBeVisible({ timeout: 10_000 });
  await search.fill(STAMP);
  await search.press("Enter");
  await expect(page.getByText(/router firmware update finished overnight/i).first(), "the synced note must render in the search results").toBeVisible({ timeout: 10_000 });

  // UI truth 2 — the recent-notifications digest renders in Messages → Inbox.
  await openMessagesTab(page, "Inbox");
  const row = page.locator("button", { hasText: DIGEST_MESSAGE }).first();
  await expect(row, "the unread digest notification must render in the Inbox timeline").toBeVisible({ timeout: 10_000 });
  await expect(row.getByText("Unread", { exact: true }), "it must be visually distinct as unread").toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/uc22-internal-system-sync.png`, fullPage: true });

  errors.assertClean();
});
