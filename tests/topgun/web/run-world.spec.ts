import { expect, test, type Page } from "@playwright/test";
import http from "node:http";
import { openScreen, signUpDisposableHousehold, watchPageErrors } from "./helpers";

/** The app has no hash router — navigate the way a family member does: sidebar click,
 *  then the Run History tab. (First joint run caught goto("/#/…") landing on Home.) */
async function openAutomationsHistory(page: Page) {
  await openScreen(page, "Automations");
  const tab = page.getByRole("tab", { name: /run history/i }).first();
  if (await tab.isVisible().catch(() => false)) await tab.click();
  else await page.getByText("Run History", { exact: false }).first().click();
}

/**
 * WP-003 — ONE RUN WORLD (ISS-005/009/011/016). Mission-bar UI-rendered proof.
 *
 * Drives the REAL web client against the REAL local backend on a FRESH disposable
 * household per test (helpers.ts signUpDisposableHousehold — a physically separate
 * hh_* tenant DB via the real /api/signup flow). Mission rule: specs that write
 * records never touch the resident family tenant. Every record is still `TG-`
 * prefixed for readability even though the whole household is throwaway.
 *
 * Covers the four run sources named in the mission bar:
 *   (a) an in-page POST /api/runs/start (source: manual)
 *   (b) a real "Run now" UI click on a trivial agent
 *   (c) an approval-parked run
 *   (d) a connector-parked run (a provider tool with zero connected accounts)
 * …and the double-run guard: a chat plan card whose message already carries a
 * runId must never show a Run button, even after a hard reload wipes the local
 * `data.runs` write-mirror (the exact shape of the bug this WP fixed in
 * useStore.ts's mapConv — see the comment there).
 *
 * A record created via a raw in-page fetch (not through the app's own store
 * actions) is invisible to screens that read the CLIENT store (data.agents,
 * data.conversations) until the next hydrateFromServer() — a page.reload() forces
 * that immediately (same pattern as results-homes.spec.ts). Screens that instead
 * read server truth directly (Automations » Run History via useServerRuns) don't
 * need this — they fetch on their own mount.
 *
 * Each test starts with a runtime probe: if the backend on :8787 is unreachable,
 * the whole file skips with reason "pending-stack-restart" rather than failing —
 * this dev stack is lead-managed and this agent must never restart it itself.
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

test.beforeEach(async ({ page }) => {
  // Runtime feature probe — this dev stack is lead-managed; this agent must never
  // restart it, so an unreachable backend skips the file rather than failing it.
  const probe = await page.request.get("/api/health").catch(() => null);
  test.skip(!probe || !probe.ok(), "pending-stack-restart — backend on :8787 was unreachable when this spec ran; re-run once the lead has confirmed the dev stack is back up.");
  await signUpDisposableHousehold(page);
});

test("(a) a manual API-started run renders in Automations » Run History with a real status label", async ({ page }) => {
  const errors = watchPageErrors(page);
  const started = await apiFetch(page, "/api/runs/start", {
    method: "POST",
    body: {
      source: "manual",
      plan: {
        title: "TG-WP003 manual run",
        summary: "TG one-run-world manual scenario",
        steps: [{ toolId: "homeops.write_memory", title: "Remember", input: { text: "TG WP003 manual fact", scope: "household" } }],
      },
    },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  await waitForRunStatus(page, started.body.run.id, ["completed"]);

  // Run History reads GET /api/runs directly (server truth) — no reload needed.
  await openAutomationsHistory(page);
  const row = page.getByText("TG-WP003 manual run").first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp003-unified-history.png`, fullPage: true });
  errors.assertClean();
});

test("(b) a real 'Run now' UI click shows IDENTICAL status text in Agent history and Automations history", async ({ page }) => {
  const errors = watchPageErrors(page);
  const agent = await apiFetch(page, "/api/agents", {
    method: "POST",
    body: { name: "TG-WP003 Read Agent", purpose: "TG one-run-world agent scenario", instructions: "TG test.", allowedToolIds: ["web.search"], status: "Active" },
  });
  expect(agent.status, JSON.stringify(agent.body)).toBe(200);

  // The Agents LIST screen reads data.agents (client store) — a raw-fetch-created
  // agent is invisible there until the next hydrate; force it now.
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Helper Agents");
  await page.getByText("TG-WP003 Read Agent", { exact: true }).first().click();
  // Two "Run now" buttons can exist at once: the drawer header's persistent primary
  // button, and the Runs tab's own EmptyState action (rendered once runNow() flips the
  // tab to "runs" while the just-refetched list is still momentarily empty). `.first()`
  // always resolves to the header button (it precedes the tab panel in DOM order),
  // which is the one this scenario is actually driving.
  const runNow = page.getByRole("button", { name: /run now/i }).first();
  await expect(runNow).toBeVisible({ timeout: 15_000 });
  await runNow.click();
  // The load-bearing check below is the history rendering, not this transient
  // "Running…" state — a fast tool can resolve before this assertion even runs.
  await expect(page.getByRole("tab", { name: /run history/i }).or(page.getByText(/no runs yet|manual run/i))).toBeVisible({ timeout: 25_000 }).catch(() => {});

  // The agent-detail run row's status chip — scoped to the run row itself, NOT a
  // bare `.chip` page-wide search (the drawer header renders its OWN `.chip` for
  // the agent's status, e.g. "Needs Attention", which a loose text match found
  // first and misreported as the run's status). The row's label is the run's
  // SERVER title, which runViewFromServer derives from the PLAN's title
  // (runAgentLive builds `{title: agent.name, ...}`) — the agent's own name, not
  // the "Manual run" ctx.label used only for the local write-mirror.
  // Scoped to the OPEN DRAWER (role="dialog") specifically: the Agents LIST card
  // behind it is `role="button"` too and ALSO has the agent's name + its OWN
  // status badge ("Active") in accessible text — an unscoped page-wide search
  // matched that list card instead of the run row inside the drawer.
  const drawer = page.getByRole("dialog");
  const runRow = drawer.getByRole("button", { name: /TG-WP003 Read Agent/ }).first();
  await expect(runRow).toBeVisible({ timeout: 25_000 });
  const agentDetailBadge = runRow.locator(".chip").first();
  await expect(agentDetailBadge).toBeVisible({ timeout: 10_000 });
  const agentStatusText = (await agentDetailBadge.textContent())?.replace(/\s+/g, " ").trim();
  expect(agentStatusText, "agent-detail run history must show a real status, not blank").toBeTruthy();

  // Close the agent-detail drawer — its full-screen backdrop otherwise intercepts
  // the sidebar click below (Drawer, components/ui.tsx, closes on Escape/backdrop).
  await page.keyboard.press("Escape");
  await openAutomationsHistory(page);
  const autoRow = page.getByRole("button", { name: /TG-WP003 Read Agent/ }).first();
  await expect(autoRow).toBeVisible({ timeout: 20_000 });
  const autoBadge = autoRow.locator(".chip").first();
  const autoStatusText = (await autoBadge.textContent())?.replace(/\s+/g, " ").trim();
  expect(autoStatusText, "the SAME run must render the identical status text in both listings — this is the ONE HISTORY guarantee").toBe(agentStatusText);
  errors.assertClean();
});

test("(c) an approval-parked run renders 'Needs approval' with a CTA that lands in Messages » Approvals", async ({ page }) => {
  const errors = watchPageErrors(page);
  const agent = await apiFetch(page, "/api/agents", {
    method: "POST",
    body: { name: "TG-WP003 Approval Agent", purpose: "TG approval scenario", instructions: "TG test.", allowedToolIds: ["homeops.create_approval"], status: "Active" },
  });
  expect(agent.status, JSON.stringify(agent.body)).toBe(200);
  const agentId = agent.body.agent.id;

  // Attribution note: POST /api/runs/start strips sourceRef.agentId from client
  // submissions (server/index.mjs clientSourceRef — SERVER_ASSIGNED_SOURCEREF), by
  // design, so a raw client-submitted plan can never claim an agent identity. The
  // one legitimate client-facing path that DOES attribute a run to an agent is a
  // skill run (server/orchestrator.mjs runSkill sets sourceRef.agentId = skill.
  // defaultAgentId) — so this scenario runs the approval step as a skill, not a raw
  // plan, to genuinely exercise the agent-history filter GET /api/runs?agentId=…
  // relies on. (The real "Run now" button — scenario b — builds a raw plan and so
  // does NOT currently attribute agentId either; that's a pre-existing product gap
  // outside this WP's scoped files, flagged separately — see ISS-018 — not fixed here.)
  const skill = await apiFetch(page, "/api/skills", {
    method: "POST",
    body: {
      name: "TG-WP003 approval park", description: "TG one-run-world approval scenario", domain: "General", type: "custom", mode: "deterministic",
      defaultAgentId: agentId,
      steps: [{ step_id: "s1", name: "Ask for sign-off", tool_id: "homeops.create_approval", input_mapping: { subject: "TG WP003 approval check", detail: "TG one-run-world approval detail." } }],
    },
  });
  expect(skill.status, JSON.stringify(skill.body)).toBe(200);
  const started = await apiFetch(page, "/api/runs/start", { method: "POST", body: { skillId: skill.body.skill.id, source: "agent" } });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const parked = await waitForRunStatus(page, started.body.run.id, ["waiting_for_approval"]);
  expect(parked.sourceRef?.agentId, "the run must actually be attributed to the agent for the history filter to find it").toBe(agentId);

  // The Agents LIST + agent-detail Run History both read client-store/server-truth
  // mixes that need a fresh hydrate to see this agent at all.
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openScreen(page, "Helper Agents");
  await page.getByText("TG-WP003 Approval Agent", { exact: true }).first().click();
  await page.getByRole("button", { name: /run history/i }).click();
  const row = page.getByText("TG-WP003 approval park").first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Needs approval", { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  await row.click();
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp003-needs-approval-label.png`, fullPage: true });

  const cta = page.getByRole("button", { name: /review approval/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();
  await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible({ timeout: 15_000 });
  // Messages' Tabs (components/ui.tsx) are plain buttons, not ARIA tabs — assert the
  // Approvals TAB'S CONTENT landed instead: the pending approval this run created.
  // The approval record's preview is the STEP's title (engine.mjs createApproval
  // preview: stepNow.title), "Ask for sign-off" — not the tool input's subject field.
  await expect(page.getByText("Ask for sign-off").first()).toBeVisible({ timeout: 10_000 });
  errors.assertClean();
});

/**
 * Picks a real provider tool whose provider has ZERO connected accounts for the
 * current actor. A fresh disposable household starts with none at all, so this
 * should resolve on the very first candidate — kept as a defensive check anyway
 * (never trust "fresh household" as a hard guarantee). Prefers a "Read"/non-
 * approval tool: engine.mjs's provider-account check (`if (!account) return
 * {waiting:"connector"}`) fires identically for read and write provider tools, but
 * an approval-gated tool parks on approval FIRST (engine.mjs checks
 * `resolved.requiresApproval` before ever calling execResolved) and would never
 * reach the connector check at all.
 */
async function pickUnconnectedProviderTool(page: Page): Promise<{ toolId: string; providerName: string }> {
  const r = await apiFetch(page, "/api/providers");
  const providers: { id: string; name: string; accounts?: unknown[]; tools: { id: string; action: string; requiresApproval: boolean }[] }[] = r.body?.providers ?? [];
  for (const p of providers) {
    if ((p.accounts?.length ?? 0) > 0) continue;
    const tool = p.tools.find((t) => t.action === "Read" && !t.requiresApproval) ?? p.tools.find((t) => !t.requiresApproval);
    if (tool) return { toolId: tool.id, providerName: p.name };
  }
  throw new Error(`no unconnected provider tool available to force a connector park — providers: ${JSON.stringify(providers.map((p) => ({ id: p.id, accounts: p.accounts?.length ?? 0 })))}`);
}

test("(d) a connector-parked run renders 'Needs a connection' with a CTA that lands in Connections", async ({ page }) => {
  const errors = watchPageErrors(page);
  const { toolId } = await pickUnconnectedProviderTool(page);
  const started = await apiFetch(page, "/api/runs/start", {
    method: "POST",
    body: {
      source: "manual",
      plan: {
        title: "TG-WP003 connector park",
        summary: "TG one-run-world connector scenario",
        steps: [{ toolId, title: "TG connector-park step", input: {} }],
      },
    },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  await waitForRunStatus(page, started.body.run.id, ["waiting_for_connector"]);

  await openAutomationsHistory(page);
  const row = page.getByText("TG-WP003 connector park").first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Needs a connection", { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  await row.click();
  await page.screenshot({ path: `${EVIDENCE_DIR}/wp003-needs-connection-label.png`, fullPage: true });

  const cta = page.getByRole("button", { name: /open connections/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible({ timeout: 15_000 });
  errors.assertClean();
});

test("double-run guard: a plan card with an attached run never shows a Run button, even across a hard reload", async ({ page }) => {
  const errors = watchPageErrors(page);
  // A hermetic fake AI provider — this household is disposable and starts with no
  // active provider, so there's nothing to save/restore; just wire the fake one in.
  let fakeProviderServer: http.Server | null = null;
  try {
    fakeProviderServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/api/tags") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ models: [{ name: "tg-fake" }] })); return; }
        const reply = JSON.stringify({ kind: "plan", answer: "On it — doing it now.", plan: {
          title: "TG-WP003 double-run-guard plan", summary: "one fast, real, no-approval step",
          icon: "Bot", spaceType: "Personal", instructions: "", trigger: { type: "Manual", detail: "" },
          steps: [{ toolId: "homeops.write_memory", title: "Remember", detail: "", input: { text: "TG WP003 double-run-guard fact", scope: "household" }, requiresApproval: false }],
          approvalGates: [], risk: "Low",
        } });
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.end(JSON.stringify({ message: { content: reply } }) + "\n");
      });
    });
    await new Promise<void>((resolve) => fakeProviderServer!.listen(0, resolve));
    const fakeProviderPort = (fakeProviderServer.address() as { port: number }).port;
    await apiFetch(page, "/api/ai/providers/ollama/config", { method: "POST", body: { baseUrl: `http://localhost:${fakeProviderPort}`, model: "tg-fake" } });
    await apiFetch(page, "/api/ai/active", { method: "POST", body: { providerId: "ollama" } });

    const conv = await apiFetch(page, "/api/conversations", { method: "POST", body: { title: "TG-WP003 double-run guard" } });
    const conversationId = conv.body.conversation.id;

    const streamed = await page.evaluate(async ({ id }) => {
      const s = await fetch("/api/session", { credentials: "include" }).then((r) => r.json()).catch(() => null);
      const csrf = s?.session?.csrf;
      const r = await fetch("/api/assistant/stream", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json", ...(csrf ? { "x-homeops-csrf": csrf } : {}) },
        body: JSON.stringify({ message: "TG: remember this for the double-run guard test", conversationId: id }),
      });
      const text = await r.text();
      const doneLine = text.split("\n").reverse().find((l) => l.startsWith("data: ") && l.includes('"type":"done"'));
      return { status: r.status, done: doneLine ? JSON.parse(doneLine.slice(6)).result : null };
    }, { id: conversationId });
    expect(streamed.status).toBe(200);
    expect(streamed.done?.run?.id, "the plan must have auto-started a run").toBeTruthy();

    // The conversation + its plan message live only server-side so far — the client
    // store (data.conversations, populated by hydrateFromServer's mapConv) has never
    // heard of it. Reload before the FIRST visibility check too, not just after the
    // regression-check's hard reload below. The app has no hash router — open the
    // chat the way a family member does: sidebar click, then the conversation by title.
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await openScreen(page, "Ask FamiliOS");
    await page.getByText("TG-WP003 double-run guard", { exact: true }).first().click();
    await expect(page.getByText("TG-WP003 double-run-guard plan").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^run plan$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /run \(with approvals\)/i })).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE_DIR}/wp003-plan-card-no-run-button.png`, fullPage: true });

    // The critical regression check: wipe the local `data.runs`/`data.conversations`
    // write-mirror explicitly (another device's exact starting state) — only the
    // server-durable runId on the message should be able to keep the Run button
    // suppressed.
    await page.evaluate(async () => {
      const req = indexedDB.deleteDatabase("homeops-ai");
      await new Promise((resolve) => { req.onsuccess = resolve; req.onerror = resolve; req.onblocked = resolve; });
    });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await openScreen(page, "Ask FamiliOS");
    await page.getByText("TG-WP003 double-run guard", { exact: true }).first().click();
    await expect(page.getByText("TG-WP003 double-run-guard plan").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^run plan$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /run \(with approvals\)/i })).toHaveCount(0);
    errors.assertClean();
  } finally {
    if (fakeProviderServer) await new Promise((r) => fakeProviderServer!.close(r));
  }
});
