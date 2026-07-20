// FamiliOS — PERMANENT REGRESSION SUITE for the false-success family of bugs.
//
// Promoted from the Top Gun audit's throwaway repro script
// (.top-gun/runs/run-20260720-073025/audit/evidence/repro-false-success.mjs), which
// PROVED these bugs at HEAD c0c4596. Every assertion below is the inverse of an
// observed failure, so the suite now proves their ABSENCE — and will fail loudly if
// any of the four seams regresses.
//
// The user's report, in one sentence: "it says it created the agent and the runs
// succeed, but no email ever arrives." Four independent seams produced that.
//
//   A. BUILD SEAM (ISS-001, EV-011/EV-015) — the automation's target carried only an
//      agentId: no skill, no goal. Every scheduled fire fell through runAgent into
//      buildReadonlyPlan, a zero-effect "status pass" that reported success.
//   A2. SCHEDULE SEAM (ISS-003, EV-011) — "every day at 7 AM" became creation-time
//      + 24h, because the build spec had no way to express a time of day.
//   B. RUN SEAM (ISS-002, EV-012) — a toolless step titled "Send email to …" was
//      marked `succeeded`; the run read 3/3 and the chat said "That worked".
//   B2. PARK SEAM (ISS-004, EV-013) — a run parked on approval told the conversation
//      nothing, forever.
//   C. CLAMP SEAM (ISS-005, EV-014) — the agent allow-list silently DELETED the send
//      step from the plan; the run completed without it and without a trace.
//
// Runs entirely against the real server on an isolated temp data dir with a scripted
// fake provider. No live network, no real family data, no real email: the fake Gmail
// account is never connected, so the send path is asserted structurally, never fired.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession } from "./harness.mjs";

const USER_MSG = "create an agent that sends a daily morning briefing email to wrhixon@gmail.com every day at 7 AM. It should include the 7-day weather, calendar and tasks for the next 7 days, top 5 global and local news stories with links, and family updates.";

/* ---------------- scripted model ---------------- */
let assistantMode = "build";
const BUILD_RESPONSE = {
  kind: "build",
  answer: "I'll set up a Morning Briefing helper that emails wrhixon@gmail.com every day at 7 AM.",
  build: {
    summary: "Daily 7 AM morning briefing email to wrhixon@gmail.com",
    skill: {
      name: "TG-Morning Briefing", description: "Compose and email the daily morning briefing", domain: "Family",
      planner_guidance: "Gather weather, calendar, tasks, and news; compose the briefing; email wrhixon@gmail.com.",
      risk_level: "Medium",
      steps: [
        { name: "Get 7-day weather", tool_id: "web.search", approval_required: false },
        { name: "Compose the briefing", tool_id: null, approval_required: false },
        { name: "Send email to wrhixon@gmail.com", tool_id: "gmail.send", approval_required: true },
      ],
    },
    agent: { name: "TG-Morning Briefing Agent", purpose: "Send the daily morning briefing", instructions: "Every day at 7 AM, compose the family briefing and email it to wrhixon@gmail.com." },
    automation: { name: "TG-Daily 7AM briefing", type: "recurring", intervalMs: 86400000, runAt: null, anchor: "07:00" },
  },
};
// The pathological build: an automation with NOTHING runnable behind it.
const BUILD_NO_TARGET = {
  kind: "build", answer: "Setting that up.",
  build: { summary: "TG-empty automation", skill: null, agent: null, automation: { name: "TG-nothing", type: "recurring", intervalMs: 86400000 } },
};
const PLAN_NULLSEND_RESPONSE = {
  kind: "plan",
  answer: "On it — composing today's briefing and sending it to wrhixon@gmail.com now.",
  plan: {
    title: "TG-Send briefing email now", summary: "Compose and send the briefing email.",
    icon: "Mail", spaceType: "Personal", instructions: "Compose briefing, send to wrhixon@gmail.com.",
    trigger: { type: "Manual", detail: "" },
    steps: [
      { toolId: "web.search", title: "Get weather", detail: "weather forecast", input: { query: "7 day weather forecast" }, requiresApproval: false },
      { toolId: null, title: "Compose the briefing", detail: "Compose the morning briefing from gathered material.", input: {}, requiresApproval: false },
      { toolId: null, title: "Send email to wrhixon@gmail.com", detail: "Notify wrhixon@gmail.com with the briefing.", input: {}, requiresApproval: false },
    ],
    approvalGates: [], risk: "Low",
  },
};
// Control case: an all-real-tool plan must KEEP today's success copy (the guard against
// this suite's own fix becoming a new false negative).
const PLAN_ALLREAL_RESPONSE = {
  kind: "plan", answer: "On it.",
  plan: {
    title: "TG-All real tools", summary: "Search and remember.", icon: "Bot", spaceType: "Personal", instructions: "",
    trigger: { type: "Manual", detail: "" },
    steps: [
      { toolId: "web.search", title: "Look something up", detail: "search", input: { query: "family dinner ideas" }, requiresApproval: false },
      { toolId: "homeops.write_memory", title: "Remember it", detail: "note the preference", input: { text: "TG-test: the family likes pasta night", scope: "household" }, requiresApproval: false },
    ],
    approvalGates: [], risk: "Low",
  },
};
const PLAN_GMAIL_RESPONSE = {
  kind: "plan", answer: "On it — sending the briefing to wrhixon@gmail.com.",
  plan: {
    title: "TG-Send briefing via gmail", summary: "Send briefing via Gmail.",
    icon: "Mail", spaceType: "Personal", instructions: "Send via gmail.",
    trigger: { type: "Manual", detail: "" },
    steps: [
      { toolId: null, title: "Compose the briefing", detail: "Compose the morning briefing.", input: {}, requiresApproval: false },
      { toolId: "gmail.send", title: "Send email to wrhixon@gmail.com", detail: "", input: { to: "wrhixon@gmail.com", subject: "Morning briefing", body: "" }, requiresApproval: true },
    ],
    approvalGates: ["Send email to wrhixon@gmail.com"], risk: "High",
  },
};
const GOALPLAN_RESPONSE = {
  title: "TG-Goal briefing", summary: "Search then email the briefing.", icon: "Mail", spaceType: "Personal",
  instructions: "Search, compose, email.", trigger: { type: "Manual", detail: "" },
  steps: [
    { toolId: "web.search", title: "Research", detail: "gather material", input: { query: "morning briefing material" }, requiresApproval: false },
    { toolId: null, title: "Compose", detail: "compose briefing", input: {}, requiresApproval: false },
    { toolId: "gmail.send", title: "Send email to wrhixon@gmail.com", detail: "", input: { to: "wrhixon@gmail.com", subject: "Briefing", body: "" }, requiresApproval: true },
  ],
  approvalGates: [], risk: "High",
};

function modelReply(messages) {
  const sys = String(messages?.[0]?.content ?? "");
  if (sys.includes("You are FamiliOS' planning engine")) return JSON.stringify(GOALPLAN_RESPONSE);
  if (sys.includes("You are FamiliOS, a warm, capable assistant")) {
    if (assistantMode === "build") return JSON.stringify(BUILD_RESPONSE);
    if (assistantMode === "build-no-target") return JSON.stringify(BUILD_NO_TARGET);
    if (assistantMode === "plan-nullsend") return JSON.stringify(PLAN_NULLSEND_RESPONSE);
    if (assistantMode === "plan-gmail") return JSON.stringify(PLAN_GMAIL_RESPONSE);
    if (assistantMode === "plan-allreal") return JSON.stringify(PLAN_ALLREAL_RESPONSE);
    return JSON.stringify({ kind: "answer", answer: "ok" });
  }
  if (sys.includes("You execute ONE reasoning step")) return JSON.stringify({ text: "Composed the morning briefing: weather clear all week; no calendar conflicts; 5 headlines gathered.", data: null });
  if (sys.includes("fill the input fields")) return JSON.stringify({});
  if (sys.includes("completed household-assistant run revealed")) return JSON.stringify({ remember: false, text: "" });
  return JSON.stringify({ confident: false, reason: "n/a" });
}

let fake, ctx, owner;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTerminal(runId, extra = [], timeoutMs = 30000) {
  const terminal = ["completed", "failed", "cancelled", "expired", ...extra];
  const t0 = Date.now();
  let run = null;
  while (Date.now() - t0 < timeoutMs) {
    const r = await owner.req(`/api/runs/${runId}`);
    run = r.data?.run ?? null;
    if (run && terminal.includes(run.status)) return run;
    await sleep(300);
  }
  return run;
}
const messagesOf = async (convId) => (await owner.req(`/api/conversations/${convId}`)).data?.conversation?.messages ?? [];
const textOf = (msgs) => msgs.map((m) => String(m.text ?? "")).join("\n---\n");
async function newConv(title) {
  const c = await owner.req("/api/conversations", { method: "POST", body: JSON.stringify({ title }) });
  return c.data.conversation.id;
}

before(async () => {
  ctx = await startServer();
  fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/api/tags") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ models: [{ name: "tg-fake" }] })); return; }
      let messages = [];
      try { messages = JSON.parse(body).messages ?? []; } catch { /* ignore */ }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { content: modelReply(messages) } }) + "\n");
    });
  });
  await new Promise((r) => fake.listen(0, r));
  const port = fake.address().port;
  owner = await makeSession(ctx, "m-alex");
  await owner.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "tg-fake" }) });
  await owner.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });
});
after(async () => {
  await stopServer(ctx);
  await new Promise((r) => fake.close(r));
});

/* ================================================================= *
 * A. BUILD SEAM — the automation runs the skill that was built
 * ================================================================= */
describe("repro A — chat-built automation targets the built skill (WP-001, ISS-001)", () => {
  let created, trig, convId, createdAt;

  before(async () => {
    assistantMode = "build";
    convId = await newConv("TG-regression build");
    createdAt = Date.now();
    const a1 = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: USER_MSG, conversationId: convId }) });
    const b1 = await owner.req("/api/assistant/build", { method: "POST", body: JSON.stringify({ build: a1.data?.build, conversationId: convId }) });
    created = b1.data?.created ?? {};
    trig = (await owner.req(`/api/triggers/${created.automation.id}`)).data?.trigger;
  });

  test("the trigger's target carries the skill the build created", () => {
    // THE root-cause assertion. At HEAD this was `{kind:"agent", agentId}` with
    // skillId undefined — the single field whose absence made every fire a no-op.
    assert.equal(trig.target.skillId, created.skill.id, "trigger target must point at the created skill");
    assert.equal(trig.target.agentId, created.agent.id, "and still run AS the created agent");
  });

  test("a fired run executes the skill's real steps, not a read-only status pass", async () => {
    const fire = await owner.req(`/api/triggers/${trig.id}/fire`, { method: "POST", body: JSON.stringify({}) });
    assert.ok(fire.data?.runId, "fire must start a run");
    const run = await waitTerminal(fire.data.runId, ["waiting_for_approval", "waiting_for_connector"]);
    assert.ok(run, "run must exist");
    // The old failure signature, asserted against explicitly so it can never return.
    assert.ok(!/status pass/i.test(run.title), `run must not be a read-only status pass (got "${run.title}")`);
    const titles = run.steps.map((s) => s.title);
    assert.equal(run.steps.length, 3, `expected the skill's 3 steps, got ${titles.join(" | ")}`);
    assert.ok(titles.some((t) => /send email/i.test(t)), "the send step must be present in the fired run");
  });

  test("the send step parks for approval rather than silently succeeding", async () => {
    const run = (await owner.req(`/api/runs/${trig.lastRunId ?? ""}`)).data?.run
      ?? await waitTerminal((await owner.req(`/api/triggers/${trig.id}`)).data.trigger.lastRunId, ["waiting_for_approval", "waiting_for_connector"]);
    const send = run.steps.find((s) => /send email/i.test(s.title));
    assert.ok(["waiting_for_approval", "blocked", "pending"].includes(send.status),
      `the gmail.send step must await approval or a connector, never report success (got ${send.status})`);
  });

  test("the trigger's lastStatus settles on a TERMINAL value (ISS-009)", async () => {
    // At HEAD this stayed "started" forever: nothing wrote the outcome back.
    let t = null;
    for (let i = 0; i < 25; i++) {
      t = (await owner.req(`/api/triggers/${trig.id}`)).data?.trigger;
      if (["completed", "failed", "expired", "waiting_for_approval", "waiting_for_connector"].includes(t.lastStatus)) break;
      await sleep(300);
    }
    assert.ok(["completed", "failed", "expired", "waiting_for_approval", "waiting_for_connector"].includes(t.lastStatus),
      `lastStatus must reflect the run's real state, got "${t.lastStatus}"`);
    assert.notEqual(t.lastStatus, "started", "lastStatus must not remain the fire-time placeholder");
  });

  test("the build_result message names what will run and when", async () => {
    const all = textOf(await messagesOf(convId));
    assert.match(all, /TG-Morning Briefing/, "the confirmation must name the skill that will run");
    assert.match(all, /7:00 AM|07:00/, "the confirmation must state the real schedule");
    assert.match(all, /approval/i, "the confirmation must disclose the approval gate on the send");
  });

  test("an automation with nothing runnable is REFUSED, and the chat says so", async () => {
    assistantMode = "build-no-target";
    const c = await newConv("TG-regression unrunnable");
    const a = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: automate something", conversationId: c }) });
    const b = await owner.req("/api/assistant/build", { method: "POST", body: JSON.stringify({ build: a.data?.build, conversationId: c }) });
    assert.equal(b.status, 422, "an unrunnable automation must be refused with 422");
    assert.equal(b.data?.error, "unrunnable_automation");
    const all = textOf(await messagesOf(c));
    assert.match(all, /couldn't set that automation up/i, "the refusal must land in the conversation, not only in the HTTP response");
  });
});

/* ================================================================= *
 * A2. SCHEDULE SEAM — "7 AM" means 07:00
 * ================================================================= */
describe("repro A2 — a daily 7 AM automation is anchored to 07:00 (WP-002, ISS-003)", () => {
  test("nextRunAt is the next 07:00 local, not creation-time + 24h", async () => {
    assistantMode = "build";
    const c = await newConv("TG-regression schedule");
    const createdAt = Date.now();
    const a = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: USER_MSG, conversationId: c }) });
    const b = await owner.req("/api/assistant/build", { method: "POST", body: JSON.stringify({ build: a.data?.build, conversationId: c }) });
    const t = (await owner.req(`/api/triggers/${b.data.created.automation.id}`)).data.trigger;
    assert.equal(t.anchor, "07:00", "the anchor must survive normalizeBuild into the trigger");
    const local = new Date(t.nextRunAt);
    assert.equal(local.getHours(), 7, `first run must be at 07:00 local, got ${local.toString()}`);
    assert.equal(local.getMinutes(), 0);
    assert.ok(t.nextRunAt > createdAt, "and it must be in the future");
    // The HEAD signature: nextRunAt - createdAt was exactly 24h.
    const deltaH = (t.nextRunAt - createdAt) / 3600000;
    assert.ok(Math.abs(deltaH - 24) > 0.02 || local.getHours() === 7,
      "nextRunAt must be derived from the wall clock, not from creation-time + interval");
    assert.match(t.scheduleText, /Daily · 7:00 AM/, "the clients must get human schedule copy");
  });

  test("after a fire, the following run is 07:00 again — not fire-time + 24h", async () => {
    const { nextAnchorOccurrence } = await import("../triggers.mjs");
    // Fire time deliberately off-anchor: a chained interval would perpetuate 09:23.
    const fireMoment = new Date(); fireMoment.setHours(9, 23, 0, 0);
    const next = nextAnchorOccurrence("07:00", null, fireMoment.getTime());
    const d = new Date(next.at);
    assert.equal(d.getHours(), 7, "the recomputed occurrence must be 07:00");
    assert.equal(d.getMinutes(), 0);
    assert.ok(next.at > fireMoment.getTime());
  });

  test("a DST transition keeps the anchor at 07:00 wall-clock (tz fixture)", async () => {
    const { nextAnchorOccurrence } = await import("../triggers.mjs");
    const tz = "America/New_York";
    const fmt = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
    // US DST begins 2026-03-08. Resolve the anchor on each side of the boundary.
    const before = nextAnchorOccurrence("07:00", tz, Date.parse("2026-03-07T13:00:00Z"));
    const after = nextAnchorOccurrence("07:00", tz, Date.parse("2026-03-09T13:00:00Z"));
    assert.equal(fmt(before.at), "07:00", "07:00 local before the DST shift");
    assert.equal(fmt(after.at), "07:00", "07:00 local after the DST shift — the UTC instant moves, the wall clock does not");
    assert.equal(before.tzSource, "household");
  });
});

/* ================================================================= *
 * B. RUN SEAM — a toolless "send" never reports success
 * ================================================================= */
describe("repro B — a toolless send step cannot claim success (WP-003, ISS-002)", () => {
  let run, msgs;

  before(async () => {
    assistantMode = "plan-nullsend";
    const c = await newConv("TG-regression nullsend");
    const b = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: send me the morning briefing email right now", conversationId: c }) });
    run = await waitTerminal(b.data.run.id);
    await sleep(1500); // let the run-finished hook append the chat result
    msgs = await messagesOf(c);
  });

  test("the toolless send step is marked skipped_no_tool, not succeeded", () => {
    const send = run.steps.find((s) => /send email/i.test(s.title));
    assert.ok(send, "the send step must still be in the trace");
    assert.equal(send.status, "skipped_no_tool", "a step with no delivery tool must never read as succeeded");
    assert.equal(send.effectClaimed, true, "and it must be flagged as claiming an external effect");
  });

  test("the composition step is still an honest success (no over-correction)", () => {
    const compose = run.steps.find((s) => /compose/i.test(s.title));
    assert.equal(compose.status, "succeeded", "genuine reasoning steps must be untouched by the fix");
  });

  test("the chat states plainly that nothing was sent", () => {
    const result = msgs.find((m) => m.kind === "run_result");
    assert.ok(result, "the run must report back to the conversation");
    assert.match(result.text, /nothing was actually sent|Not sent/i, "the summary must disclose the non-delivery");
    assert.doesNotMatch(result.text, /^Done — "TG-Send briefing email now" finished \(3\/3/, "the old 3/3 success headline must be gone");
  });

  test("no save-as-helper offer follows a run that delivered nothing", () => {
    const offer = msgs.find((m) => m.kind === "build" && /save/i.test(String(m.text ?? "")));
    assert.equal(offer, undefined, "offering to immortalize a non-delivering recipe is the false success at its worst");
  });

  // Found by the MANDATORY browser pass, not by inspection: `normalizePlan` is not on
  // every path into a run. A deterministic SKILL's steps come through
  // `buildPlanFromSkill`, and POST /api/runs/start accepts a raw plan — both skipped
  // normalization, so the effect-claim flag was never set and a toolless "Send email"
  // step still reported `succeeded`. Since the user's chat-built briefing runs AS A
  // SKILL, this was the user's exact scenario still broken behind a green suite.
  // The verdict is now settled in `startRun`, the one choke point every run passes.
  test("a RAW plan (no normalizePlan) still flags a toolless send", async () => {
    const r = await owner.req("/api/runs/start", {
      method: "POST",
      body: JSON.stringify({
        source: "manual",
        plan: { title: "TG-raw plan", summary: "", steps: [
          { toolId: null, title: "Compose the briefing", detail: "compose", input: {} },
          { toolId: null, title: "Send email to tg-raw@example.invalid", detail: "notify them", input: {} },
        ] },
      }),
    });
    const run = await waitTerminal(r.data.run.id);
    const send = run.steps.find((s) => /send email/i.test(s.title));
    assert.equal(send.status, "skipped_no_tool", "a raw plan must get the same honesty as a normalized one");
  });

  test("a SKILL's toolless send step is flagged too (the user's actual path)", async () => {
    const skill = await owner.req("/api/skills", {
      method: "POST",
      body: JSON.stringify({
        name: "TG-Skill nullsend", description: "TG", domain: "Family",
        steps: [
          { step_id: "s1", name: "Compose the briefing", tool_id: null, approval_required: false, input_mapping: {} },
          { step_id: "s2", name: "Send email to tg-skill@example.invalid", tool_id: null, approval_required: false, input_mapping: {} },
        ],
      }),
    });
    const r = await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ skillId: skill.data.skill.id }) });
    const run = await waitTerminal(r.data.run.id);
    const send = run.steps.find((s) => /send email/i.test(s.title));
    assert.equal(send.status, "skipped_no_tool",
      "a chat-built skill is exactly how the user's briefing runs — it must not report a phantom send as success");
  });

  test("CONTROL: an all-real-tool run keeps its success copy", async () => {
    assistantMode = "plan-allreal";
    const c = await newConv("TG-regression allreal");
    const b = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: look up dinner ideas and remember we like pasta", conversationId: c }) });
    const r = await waitTerminal(b.data.run.id);
    assert.equal(r.status, "completed");
    await sleep(1200);
    const result = (await messagesOf(c)).find((m) => m.kind === "run_result");
    assert.match(result.text, /^Done —/, "a run that really did its work must still say Done");
    assert.doesNotMatch(result.text, /nothing was actually sent/i, "and must not inherit the non-delivery caveat");
  });
});

/* ================================================================= *
 * B2. PARK SEAM — a parked run reports back
 * ================================================================= */
describe("repro B2 — a run parked on approval tells the conversation (WP-004, ISS-004)", () => {
  test("a waiting message lands in the thread while the run is still parked", async () => {
    assistantMode = "plan-gmail";
    const c = await newConv("TG-regression park");
    const b = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: email me the briefing via gmail now", conversationId: c }) });
    const run = await waitTerminal(b.data.run.id, ["waiting_for_approval", "waiting_for_connector"], 20000);
    assert.ok(["waiting_for_approval", "waiting_for_connector", "failed"].includes(run.status));
    let all = "";
    for (let i = 0; i < 20; i++) { all = textOf(await messagesOf(c)); if (/waiting for your approval|couldn't|connect/i.test(all)) break; await sleep(300); }
    // At HEAD the thread's last line stayed "On it —" indefinitely.
    assert.match(all, /waiting for your approval|nothing has been sent|Connect your Google/i,
      "a parked or blocked run must say so in the conversation");
  });
});

/* ================================================================= *
 * C. CLAMP SEAM — a policy-blocked step stays visible
 * ================================================================= */
describe("repro C — the agent allow-list clamp is visible, never silent (WP-003, ISS-005)", () => {
  test("a disallowed send survives into the run as skipped, with a reason", async () => {
    const ag = await owner.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "TG-Clamp Agent", purpose: "clamp demo", instructions: "demo", allowedToolIds: ["web.search"], status: "Active" }) });
    const tr = await owner.req("/api/triggers", { method: "POST", body: JSON.stringify({ name: "TG-clamp trigger", type: "manual", target: { kind: "agent", agentId: ag.data.agent.id, goal: "Compose and email the morning briefing to wrhixon@gmail.com" } }) });
    const fire = await owner.req(`/api/triggers/${tr.data.trigger.id}/fire`, { method: "POST", body: JSON.stringify({}) });
    const run = await waitTerminal(fire.data.runId, ["waiting_for_approval", "waiting_for_connector"]);
    const send = run.steps.find((s) => /send email/i.test(s.title));
    // At HEAD this step was FILTERED OUT before startRun — `send` was undefined and
    // the run completed, with the omission recorded nowhere the family could see.
    assert.ok(send, "the clamped step must remain in the run trace");
    assert.equal(send.status, "skipped", "it must be visibly skipped");
    assert.match(String(send.detail), /not permitted/i, "and it must say why");
    assert.ok(send.clampedOut, "carrying the machine-readable clamp reason for both clients");
  });
});
