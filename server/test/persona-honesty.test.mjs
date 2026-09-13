// LEGACY ENGINE: this suite pins the previous single-shot assistant brain (JSON envelope
// answer|lookup|plan|build). The default Ask Famili engine is now the AI SDK agent loop
// (server/assistant-agent.mjs, server/test/assistant-agent.test.mjs); every server here is
// spawned with HOMEOPS_ASSISTANT_ENGINE=legacy so the rollback path stays proven.
// FamiliOS — PERMANENT PERSONA REGRESSION SUITE.
//
// Promoted from the Top Gun audit's persona-passes.mjs, which observed role-variant
// behaviour at HEAD c0c4596 and recorded it as JSON for a human to read. Recording is
// not protection: these are now assertions, so the role gates and the build-honesty
// rules are held in place by the suite rather than by anyone remembering to look.
//
// Five evidence-grounded personas from the audit:
//   Alex   (Owner)        — builds the briefing; gets the full build path
//   Morgan (Adult Admin)  — plain-English helpers; build must be truthful about lifecycle
//   Lily   (Child View)   — AI gated off by default; must be refused, kindly
//   Sam    (Guest/Helper) — lowest role; must get GUIDANCE, never a dead build card
//   Elaine (recipient)    — exists only if delivery happens; covered by the registry gate
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession } from "./harness.mjs";

const BUILD_RESPONSE = {
  kind: "build",
  answer: "I'll set up a weekly chores helper.",
  build: {
    summary: "Weekly chores reminder",
    skill: {
      name: "TG-Chore Reminder", description: "Remind about chores", domain: "Family",
      planner_guidance: "remind", risk_level: "Low",
      steps: [
        { name: "Compose reminder", tool_id: null, approval_required: false },
        { name: "Draft the notification", tool_id: "homeops.send_notification_draft", approval_required: false },
      ],
    },
    agent: { name: "TG-Chore Agent", purpose: "chores", instructions: "Remind weekly." },
    automation: { name: "TG-weekly chores", type: "recurring", intervalMs: 604800000, runAt: null, anchor: "09:00" },
  },
};
// A build with NO automation — the lifecycle contrast case.
const BUILD_NO_AUTOMATION = {
  kind: "build", answer: "I'll save that as a helper.",
  build: {
    summary: "A helper with no schedule",
    skill: { name: "TG-Manual Helper", description: "manual only", domain: "Family", planner_guidance: "", risk_level: "Low", steps: [{ name: "Compose", tool_id: null, approval_required: false }] },
    agent: { name: "TG-Manual Agent", purpose: "manual", instructions: "Run when asked." },
    automation: null,
  },
};

let mode = "with-automation";
function modelReply(messages) {
  const sys = String(messages?.[0]?.content ?? "");
  if (sys.includes("You are FamiliOS, a warm, capable assistant")) {
    return JSON.stringify(mode === "no-automation" ? BUILD_NO_AUTOMATION : BUILD_RESPONSE);
  }
  if (sys.includes("You execute ONE reasoning step")) return JSON.stringify({ text: "Reminder composed: take out bins, water plants.", data: null });
  if (sys.includes("fill the input fields")) return JSON.stringify({ to: "family", subject: "Chores", body: "Take out bins, water plants." });
  if (sys.includes("completed household-assistant run revealed")) return JSON.stringify({ remember: false, text: "" });
  return JSON.stringify({ kind: "answer", answer: "ok" });
}

let ctx, fake, morgan, lily, sam;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  ctx = await startServer({ env: { HOMEOPS_ASSISTANT_ENGINE: "legacy" } });
  fake = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/api/tags") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ models: [{ name: "tg-fake" }] })); return; }
      let messages = []; try { messages = JSON.parse(body).messages ?? []; } catch { /* ignore */ }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { content: modelReply(messages) } }) + "\n");
    });
  });
  await new Promise((r) => fake.listen(0, r));
  const port = fake.address().port;
  morgan = await makeSession(ctx, "m-morgan"); // Adult Admin
  lily = await makeSession(ctx, "m-lily");     // Child View
  sam = await makeSession(ctx, "m-sam");       // Guest/Helper
  await morgan.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "tg-fake" }) });
  await morgan.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });
});
after(async () => {
  await stopServer(ctx);
  await new Promise((r) => fake.close(r));
});

describe("Morgan (Adult Admin) — a chat-built helper is honest about what it will do", () => {
  let created, notes, trig;

  before(async () => {
    mode = "with-automation";
    const conv = await morgan.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "TG-morgan chores" }) });
    const a = await morgan.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: create a helper that reminds the family about chores every week", conversationId: conv.data.conversation.id }) });
    const b = await morgan.req("/api/assistant/build", { method: "POST", body: JSON.stringify({ build: a.data?.build, conversationId: conv.data.conversation.id }) });
    created = b.data?.created ?? {};
    notes = b.data?.notes ?? [];
    trig = (await morgan.req(`/api/triggers/${created.automation.id}`)).data?.trigger;
  });

  test("the agent lands ACTIVE when the same build puts it on a schedule (ISS-007)", () => {
    // A Draft agent behind an ENABLED trigger is the false-success shape in miniature.
    assert.equal(created.agent.status, "Active", "a scheduled helper must not be left as an inert Draft");
    assert.equal(trig.enabled, true);
  });

  test("a helper with NO schedule stays Draft, and the notes say it won't run alone", async () => {
    mode = "no-automation";
    const conv = await morgan.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "TG-morgan manual" }) });
    const a = await morgan.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: save a manual helper", conversationId: conv.data.conversation.id }) });
    const b = await morgan.req("/api/assistant/build", { method: "POST", body: JSON.stringify({ build: a.data?.build, conversationId: conv.data.conversation.id }) });
    assert.equal(b.data.created.agent.status, "Draft", "nothing fires unattended, so Draft is the honest state");
    assert.match(JSON.stringify(b.data.notes), /draft/i);
    mode = "with-automation";
  });

  test("the automation targets the built skill, not a bare agent id", () => {
    assert.equal(trig.target.skillId, created.skill.id);
  });

  test("the schedule is rendered for humans, not as intervalMs", () => {
    assert.ok(trig.scheduleText, "publicTrigger must expose scheduleText");
    assert.doesNotMatch(trig.scheduleText, /^\d{6,}$/, "never raw milliseconds");
    assert.match(trig.scheduleText, /9:00 AM/, "the anchored time must reach the clients");
  });

  test("the agent inherited the capabilities its skill actually needs", () => {
    const caps = [...(created.agent.allowedToolIds ?? []), ...(created.agent.allowedFunctionIds ?? [])];
    assert.ok(caps.includes("homeops.send_notification_draft"),
      "a helper whose steps reference a tool it is not permitted is inert — the exact silent failure this guards");
  });

  test("a fired run executes the skill's real steps", async () => {
    const fire = await morgan.req(`/api/triggers/${trig.id}/fire`, { method: "POST", body: JSON.stringify({}) });
    assert.ok(fire.data?.runId);
    let run = null;
    for (let i = 0; i < 40; i++) {
      run = (await morgan.req(`/api/runs/${fire.data.runId}`)).data?.run;
      if (run && ["completed", "failed", "expired", "waiting_for_approval", "waiting_for_connector"].includes(run.status)) break;
      await sleep(250);
    }
    assert.ok(!/status pass/i.test(run.title), "must not degrade into a read-only status pass");
    assert.ok(run.steps.some((s) => s.toolId === "homeops.send_notification_draft"),
      "the skill's real step must be in the fired run");
  });
});

describe("Lily (Child View) — the AI gate holds and refuses kindly", () => {
  test("a child without AI enabled is refused on chat AND on build", async () => {
    const c1 = await lily.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: hi" }) });
    const c2 = await lily.req("/api/assistant/build", { method: "POST", body: JSON.stringify({ build: BUILD_RESPONSE.build }) });
    assert.ok(c1.status >= 400, `child chat must be gated, got ${c1.status}`);
    assert.ok(c2.status >= 400, `child build must be gated, got ${c2.status}`);
    assert.ok(c2.data?.error, "the refusal must carry a machine-readable reason");
  });
});

describe("Sam (Guest/Helper) — the lowest role gets guidance, never a dead build card", () => {
  test("a guest cannot create durable agents or automations", async () => {
    const g2 = await sam.req("/api/assistant/build", { method: "POST", body: JSON.stringify({ build: BUILD_RESPONSE.build }) });
    assert.ok(g2.status >= 400, "the build route must role-gate the lowest role");
    assert.equal(g2.data?.error, "insufficient_role");
  });

  test("and the refusal is a reason, not a silent no-op (ISS-011)", async () => {
    const g1 = await sam.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: send everyone a note" }) });
    // Either the assistant answers with guidance, or it is gated with a stated reason.
    // What must NOT happen is a cheerful build card the guest can never action.
    if (g1.status < 400) {
      assert.notEqual(g1.data?.kind, "build", "a guest must not be handed a build card they cannot execute");
    } else {
      assert.ok(g1.data?.error, "a gated guest must be told why");
    }
  });
});

describe("Elaine (recipient) — the registry gate is fail-closed without a mail account", () => {
  test("/api/notify reports an honest, actionable block rather than claiming delivery", async () => {
    const n1 = await morgan.req("/api/notify", { method: "POST", body: JSON.stringify({ methodId: "ct-morgan-email", title: "TG test", body: "TG registry gate check" }) });
    const blob = JSON.stringify(n1.data ?? {});
    assert.doesNotMatch(blob, /"delivered"\s*:\s*true/, "nothing may claim delivery with no mail account connected");
    assert.ok(n1.status >= 400 || /needsSetup|not found|verif|Connect/i.test(blob),
      `the block must be explicit and actionable, got ${blob.slice(0, 200)}`);
  });
});
