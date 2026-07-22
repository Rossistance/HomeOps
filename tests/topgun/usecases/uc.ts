import { expect, test, type Page } from "@playwright/test";
import http from "node:http";

export { openScreen, signUpDisposableHousehold, watchPageErrors } from "../web/helpers";

/**
 * Shared harness for the 22-use-case executable benchmark (WP-006 s4–s6).
 *
 * Ground rules every UC spec follows (mission-pinned):
 *  - DISPOSABLE household per test file (signUpDisposableHousehold); teardown via
 *    DELETE /api/account. The resident family tenant is never read or written.
 *  - Drive the REAL UI for the observable outcome (chat, Run now, Approvals decide,
 *    the surface the family would actually look at). API calls are allowed for
 *    SEEDING (creating the agent/skill/contact the scenario needs) — never for the
 *    assertion the UC is about.
 *  - GATED UCs (external credential is user-owned) run their sandbox twin when the
 *    backend has HOMEOPS_CONNECTOR_SANDBOX=1 and SKIP with the same named blocker
 *    when it doesn't. They always annotate the blocker — a sandbox pass is honest
 *    evidence of everything EXCEPT the real wire.
 *  - No external sends: the sandbox replaces the transport after every consent
 *    gate; active-lane specs only use no-credential tools (weather/rss/http/web/
 *    browser/homeops.*) or in-app delivery.
 */

/** Session-aware fetch from inside the page (owns the cookie + CSRF dance). */
export async function apiFetch(
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

export async function waitForRunStatus(page: Page, runId: string, statuses: string[], timeout = 45_000) {
  let last: any;
  await expect(async () => {
    const r = await apiFetch(page, `/api/runs/${runId}`);
    last = r.body?.run;
    expect(statuses, `run ${runId} is "${last?.status}" (${JSON.stringify(last?.steps?.[last?.cursor]?.detail ?? "").slice(0, 200)})`).toContain(last?.status);
  }).toPass({ timeout });
  return last;
}

/** Is the backend running with HOMEOPS_CONNECTOR_SANDBOX=1? (route 404s in real mode) */
export async function sandboxActive(page: Page): Promise<boolean> {
  const r = await page.request.get("/api/sandbox/effects").catch(() => null);
  return !!r && r.status() !== 404;
}

/** The tenant's recorded would-be effects (sends, label changes, creates, …). */
export async function readSandboxEffects(page: Page): Promise<any[]> {
  const r = await apiFetch(page, "/api/sandbox/effects");
  expect(r.status, "sandbox effects route must be readable in sandbox mode").toBe(200);
  return r.body?.effects ?? [];
}

/**
 * GATED-lane preamble. Always records the named real-credential blocker as an
 * annotation (it belongs on the PASSING sandbox run too — that is the honest
 * "pass(sandbox + named blocker)" contract), then skips when the sandbox is off.
 */
export async function requireSandbox(page: Page, blocker: string) {
  test.info().annotations.push({ type: "external-blocker", description: blocker });
  const active = await sandboxActive(page);
  test.skip(
    !active,
    `BLOCKED (real lane): ${blocker} — user-owned credential; start the backend with HOMEOPS_CONNECTOR_SANDBOX=1 to run this UC's sandbox twin.`,
  );
}

/** Skip the file when the lead-managed dev stack is down (never boot it from a spec). */
export async function requireBackend(page: Page) {
  const probe = await page.request.get("/api/health").catch(() => null);
  test.skip(!probe || !probe.ok(), "pending-stack-restart — backend on :8787 unreachable; the dev stack is lead-managed.");
}

/**
 * A hermetic fake AI provider for chat-driven UCs (same pattern run-world.spec.ts
 * pinned): an in-process ollama look-alike that returns a fixed plan/answer, wired
 * into the DISPOSABLE household via the real provider-config API. Deterministic —
 * benchmark runs must not depend on a live LLM.
 */
export async function withFakeAiProvider<T>(
  page: Page,
  replyFor: (message: string) => { kind: "plan"; answer: string; plan: any } | { kind: "answer"; answer: string },
  fn: () => Promise<T>,
): Promise<T> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/api/tags") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "tg-fake" }] }));
        return;
      }
      let userMessage = "";
      try {
        const parsed = JSON.parse(body);
        const msgs = parsed?.messages ?? [];
        userMessage = String(msgs.filter((m: any) => m.role === "user").map((m: any) => m.content).join("\n"));
      } catch { /* fall through with empty message */ }
      const reply = JSON.stringify(replyFor(userMessage));
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { content: reply } }) + "\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const cfg = await apiFetch(page, "/api/ai/providers/ollama/config", { method: "POST", body: { baseUrl: `http://localhost:${port}`, model: "tg-fake" } });
    expect(cfg.status, JSON.stringify(cfg.body)).toBe(200);
    const act = await apiFetch(page, "/api/ai/active", { method: "POST", body: { providerId: "ollama" } });
    expect(act.status, JSON.stringify(act.body)).toBe(200);
    return await fn();
  } finally {
    await new Promise((r) => server.close(r));
  }
}

/** Send a chat message through the real assistant stream; returns the done-frame result. */
export async function chat(page: Page, message: string, conversationId?: string) {
  const streamed = await page.evaluate(async ({ message, conversationId }) => {
    const s = await fetch("/api/session", { credentials: "include" }).then((r) => r.json()).catch(() => null);
    const csrf = s?.session?.csrf;
    const r = await fetch("/api/assistant/stream", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json", ...(csrf ? { "x-homeops-csrf": csrf } : {}) },
      body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
    });
    const text = await r.text();
    const doneLine = text.split("\n").reverse().find((l) => l.startsWith("data: ") && l.includes('"type":"done"'));
    return { status: r.status, done: doneLine ? JSON.parse(doneLine.slice(6)).result : null };
  }, { message, conversationId });
  expect(streamed.status, "assistant stream must accept the message").toBe(200);
  return streamed.done;
}

/** Navigate into Messages & Approvals, then a tab — the exact pattern inbox-truth.spec.ts
 * proved (no deep-link hash router exists; badge digits join the accessible name). */
export async function openMessagesTab(page: Page, tabLabel: "Inbox" | "Approvals") {
  await page.getByRole("button", { name: /Messages & Approvals/i }).first().click();
  await page.getByRole("button", { name: new RegExp(`^${tabLabel}`) }).first().click();
}

/**
 * Decide a pending approval THROUGH THE REAL UI: Messages → Approvals → the card
 * whose text matches → Approve (a real click — the same read-model + decide path a
 * family member uses; WP-001-proven locators). Returns after the click; callers
 * poll the run to completion themselves.
 */
export async function approveViaUi(page: Page, cardText: string | RegExp) {
  await openMessagesTab(page, "Approvals");
  const card = page.locator("div.card-pad", { hasText: cardText }).first();
  await expect(card, `pending approval card matching ${cardText} must be visible in Messages → Approvals`).toBeVisible({ timeout: 15_000 });
  // Cards render collapsed; the Approve/Deny row appears once expanded (the
  // inbox-truth.spec.ts flow: expand via the card's first button, then Approve).
  const approve = card.getByRole("button", { name: "Approve", exact: true });
  if (!(await approve.isVisible().catch(() => false))) await card.locator("button").first().click();
  await expect(approve).toBeVisible({ timeout: 10_000 });
  await approve.click();
}

/** Owner's sandbox accounts are seeded at session creation — assert one exists. */
export async function expectSandboxAccount(page: Page, providerId: string) {
  const r = await apiFetch(page, "/api/providers");
  const p = (r.body?.providers ?? []).find((x: any) => x.id === providerId);
  expect(p, `provider ${providerId} must exist`).toBeTruthy();
  expect(
    (p.accounts ?? []).some((a: any) => a.status === "connected"),
    `Owner must have a seeded connected ${providerId} sandbox account (session-time seeding, index.mjs)`,
  ).toBe(true);
}
