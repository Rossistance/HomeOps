// Top Gun audit run-20260720-073025 — false-success repro at HEAD (c0c4596).
// Drives the REAL server (harness pattern: isolated temp data dir, real HTTP,
// real engine) with a scripted fake Ollama provider standing in for the model.
// NO external network calls except localhost; NO real family data touched.
//
// Repros:
//   A. build-seam  — user's exact "daily 7 AM briefing email agent" chat request
//                    -> build -> materialize -> inspect trigger -> fire -> inspect run.
//   B. run-seam    — one-off plan whose "send email" step is a toolId:null reasoning
//                    step -> auto-executes -> run "completed", chat says Done, nothing sent.
//   B2. gate-seam  — plan with real gmail.send step, no Google account -> parks forever.
//   C. clamp-seam  — agent goal-run where the plan's gmail.send is silently dropped
//                    by the allow-list clamp -> run completes without the send.
import http from "node:http";
import fs from "node:fs";
import { startServer, stopServer, makeSession } from "../../../../../server/test/harness.mjs";

const OUT = new URL("./repro-output.json", import.meta.url);
const results = { startedAt: new Date().toISOString(), head: "c0c4596", repros: {} };
const record = (k, v) => { results.repros[k] = v; };

const USER_MSG = "create an agent that sends a daily morning briefing email to wrhixon@gmail.com every day at 7 AM. It should include the 7-day weather, calendar and tasks for the next 7 days, top 5 global and local news stories with links, and family updates.";

// ---- scripted model ---------------------------------------------------------
// Routes on the system prompt of each providerChat call, mimicking what a real
// model instructed by ASSISTANT_SYS / PLAN_SYS / REASONING_SYS would return.
let assistantMode = "build"; // switched per repro
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
        { name: "Gather calendar and tasks", tool_id: null, approval_required: false },
        { name: "Top global and local news with links", tool_id: "web.search", approval_required: false },
        { name: "Compose the briefing", tool_id: null, approval_required: false },
        { name: "Send email to wrhixon@gmail.com", tool_id: "gmail.send", approval_required: true },
      ],
    },
    agent: { name: "TG-Morning Briefing Agent", purpose: "Send the daily morning briefing", instructions: "Every day at 7 AM, compose the family briefing and email it to wrhixon@gmail.com." },
    automation: { name: "TG-Daily 7AM briefing", type: "recurring", intervalMs: 86400000, runAt: null },
  },
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
const PLAN_GMAIL_RESPONSE = {
  kind: "plan",
  answer: "On it — sending the briefing to wrhixon@gmail.com.",
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
// planFromGoal (PLAN_SYS) response used by repro C: a goal-run plan that includes gmail.send.
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
    if (assistantMode === "plan-nullsend") return JSON.stringify(PLAN_NULLSEND_RESPONSE);
    if (assistantMode === "plan-gmail") return JSON.stringify(PLAN_GMAIL_RESPONSE);
    return JSON.stringify({ kind: "answer", answer: "ok" });
  }
  if (sys.includes("You execute ONE reasoning step")) return JSON.stringify({ text: "Composed the morning briefing: weather clear all week; no calendar conflicts; 5 headlines gathered.", data: null });
  if (sys.includes("fill the input fields")) return JSON.stringify({});
  if (sys.includes("completed household-assistant run revealed")) return JSON.stringify({ remember: false, text: "" });
  if (sys.includes("improvement engine") || sys.includes("change-safety judge") || sys.includes("repair a failed household-automation plan")) return JSON.stringify({ confident: false, reason: "n/a" });
  return JSON.stringify({ kind: "answer", answer: "ok" });
}

const fake = http.createServer((req, res) => {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitTerminal(owner, runId, extraTerminal = [], timeoutMs = 30000) {
  const terminal = ["completed", "failed", "cancelled", "expired", ...extraTerminal];
  const t0 = Date.now();
  let run = null;
  while (Date.now() - t0 < timeoutMs) {
    const r = await owner.req(`/api/runs/${runId}`);
    run = r.data?.run ?? null;
    if (run && terminal.includes(run.status)) return run;
    await sleep(400);
  }
  return run; // whatever we last saw (may be non-terminal — recorded honestly)
}
const compactRun = (run) => run && {
  id: run.id, status: run.status, error: run.error, title: run.title, source: run.source, sourceRef: run.sourceRef,
  steps: (run.steps ?? []).map((s) => ({ index: s.index, toolId: s.toolId, title: s.title, status: s.status, detail: String(s.detail ?? "").slice(0, 220), requiresApproval: s.requiresApproval, approvalId: s.approvalId })),
};

const ctx = await startServer();
try {
  await new Promise((r) => fake.listen(0, r));
  const port = fake.address().port;
  const owner = await makeSession(ctx, "m-alex"); // Owner
  await owner.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "tg-fake" }) });
  await owner.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });

  /* ---------------- Repro A: build seam ---------------- */
  assistantMode = "build";
  const conv = await owner.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "TG-repro build" }) });
  const convId = conv.data.conversation.id;
  const createdAt = Date.now();
  const a1 = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: USER_MSG, conversationId: convId }) });
  const build = a1.data?.build;
  const b1 = await owner.req("/api/assistant/build", { method: "POST", body: JSON.stringify({ build, conversationId: convId }) });
  const created = b1.data?.created ?? {};
  const trigList = await owner.req("/api/triggers");
  const trig = (trigList.data?.triggers ?? []).find((t) => t.id === created.automation?.id);
  const agents = await owner.req("/api/agents");
  const agent = (agents.data?.agents ?? []).find((x) => x.id === created.agent?.id);
  // fire the trigger exactly as tick() would
  const fire = await owner.req(`/api/triggers/${trig.id}/fire`, { method: "POST", body: JSON.stringify({}) });
  const runA = fire.data?.runId ? await waitTerminal(owner, fire.data.runId, ["waiting_for_approval", "waiting_for_connector"]) : null;
  const convAfterA = await owner.req(`/api/conversations/${convId}`);
  const trigAfter = (await owner.req(`/api/triggers/${trig.id}`)).data?.trigger;
  record("A_build_seam", {
    assistantResult: { ok: a1.data?.ok, kind: a1.data?.kind, answer: a1.data?.answer },
    buildResult: { ok: b1.data?.ok, created, notes: b1.data?.notes },
    trigger: trig && {
      id: trig.id, type: trig.type, enabled: trig.enabled, intervalMs: trig.intervalMs, nextRunAt: trig.nextRunAt,
      nextRunAt_iso: trig.nextRunAt ? new Date(trig.nextRunAt).toISOString() : null,
      createdAt_iso: new Date(createdAt).toISOString(),
      nextRunAt_minus_createdAt_h: trig.nextRunAt ? ((trig.nextRunAt - createdAt) / 3600000).toFixed(2) : null,
      target: trig.target,
    },
    agent: agent && { id: agent.id, status: agent.status, visibility: agent.visibility, skillIds: agent.skillIds, allowedToolIds: agent.allowedToolIds, allowedFunctionIds: agent.allowedFunctionIds },
    fire: { status: fire.status, ok: fire.data?.ok, runId: fire.data?.runId, error: fire.data?.error },
    run: compactRun(runA),
    triggerAfterFire: trigAfter && { lastStatus: trigAfter.lastStatus, lastRunId: trigAfter.lastRunId, fireCount: trigAfter.fireCount },
    conversationMessages: (convAfterA.data?.conversation?.messages ?? []).map((m) => ({ role: m.role, kind: m.kind, text: String(m.text ?? "").slice(0, 300), runId: m.runId ?? null })),
  });

  /* ---------------- Repro B: null-toolId send step ---------------- */
  assistantMode = "plan-nullsend";
  const convB = await owner.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "TG-repro nullsend" }) });
  const b = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: send me the morning briefing email right now", conversationId: convB.data.conversation.id }) });
  const runB = b.data?.run?.id ? await waitTerminal(owner, b.data.run.id) : null;
  await sleep(1500); // let run-finished hooks append the chat result
  const convBAfter = await owner.req(`/api/conversations/${convB.data.conversation.id}`);
  record("B_nullsend_plan", {
    assistantResult: { ok: b.data?.ok, kind: b.data?.kind, autoStartedRun: b.data?.run?.id ?? null },
    run: compactRun(runB),
    conversationMessages: (convBAfter.data?.conversation?.messages ?? []).map((m) => ({ role: m.role, kind: m.kind, status: m.status, text: String(m.text ?? "").slice(0, 300), runId: m.runId ?? null })),
  });

  /* ---------------- Repro B2: real gmail.send, no Google account ---------------- */
  assistantMode = "plan-gmail";
  const convB2 = await owner.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "TG-repro gmail" }) });
  const b2 = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: email me the briefing via gmail now", conversationId: convB2.data.conversation.id }) });
  const runB2 = b2.data?.run?.id ? await waitTerminal(owner, b2.data.run.id, ["waiting_for_approval", "waiting_for_connector"], 20000) : null;
  await sleep(1000);
  const convB2After = await owner.req(`/api/conversations/${convB2.data.conversation.id}`);
  record("B2_gmail_unconnected_plan", {
    assistantResult: { ok: b2.data?.ok, kind: b2.data?.kind, autoStartedRun: b2.data?.run?.id ?? null },
    run: compactRun(runB2),
    conversationMessages: (convB2After.data?.conversation?.messages ?? []).map((m) => ({ role: m.role, kind: m.kind, status: m.status, text: String(m.text ?? "").slice(0, 300), runId: m.runId ?? null })),
  });

  /* ---------------- Repro C: allow-list clamp drops the send silently ---------------- */
  const agC = await owner.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "TG-Clamp Agent", purpose: "clamp demo", instructions: "demo", allowedToolIds: ["web.search"], status: "Active" }) });
  const agCId = agC.data?.agent?.id;
  const trC = await owner.req("/api/triggers", { method: "POST", body: JSON.stringify({ name: "TG-clamp trigger", type: "manual", target: { kind: "agent", agentId: agCId, goal: "Compose and email the morning briefing to wrhixon@gmail.com" } }) });
  const fireC = await owner.req(`/api/triggers/${trC.data.trigger.id}/fire`, { method: "POST", body: JSON.stringify({}) });
  const runC = fireC.data?.runId ? await waitTerminal(owner, fireC.data.runId, ["waiting_for_approval", "waiting_for_connector"]) : null;
  record("C_clamp_seam", {
    agent: { id: agCId, allowedToolIds: ["web.search"] },
    fire: { ok: fireC.data?.ok, runId: fireC.data?.runId, error: fireC.data?.error },
    run: compactRun(runC),
    note: "planFromGoal returned 3 steps incl. gmail.send; orchestrator clamp drops disallowed steps before startRun",
  });

  results.finishedAt = new Date().toISOString();
} finally {
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  await stopServer(ctx);
  await new Promise((r) => fake.close(r));
}
console.log("WROTE", OUT.pathname);
console.log(JSON.stringify(results, null, 2));
