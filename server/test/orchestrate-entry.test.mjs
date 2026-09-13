// LEGACY ENGINE: this suite pins the previous single-shot assistant brain (JSON envelope
// answer|lookup|plan|build). The default Ask Famili engine is now the AI SDK agent loop
// (server/assistant-agent.mjs, server/test/assistant-agent.test.mjs); every server here is
// spawned with HOMEOPS_ASSISTANT_ENGINE=legacy so the rollback path stays proven.
// FamiliOS — WP-006 slice 1: the single orchestrate() entry.
//
// orchestrate() (server/orchestrator.mjs) is THE choke point every run source funnels
// through — chat (the assistant routes), an agent "Run now", a trigger fire, and the
// manual POST /api/runs/start. This suite proves, against the REAL server (harness.mjs),
// that a run from each source:
//   • is created exactly ONCE per request (no double-start),
//   • carries a consistent sourceRef.via (chat|agent|webhook|schedule) and correct,
//     SERVER-verified attribution (ISS-018: an agent "Run now" is filterable by agentId;
//     a manual start can NOT smuggle an agentId in via the request body),
//   • still gets the WP-003 visible-skip policy clamp (a denied step is skipped, not run,
//     and not a hard failure), and
//   • falls back to the exact pre-WP-006 sourceRef (no via) under HOMEOPS_ORCHESTRATE_ENTRY=off.
// No AI provider is real: a scripted local HTTP server stands in for Ollama for the chat
// path; the agent/manual/trigger paths use deterministic skills/read-passes (no LLM).
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession, readStoreDoc, writeStoreDoc } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitTerminal(owner, runId, timeoutMs = 20000) {
  const terminal = ["completed", "failed", "cancelled", "expired"];
  const t0 = Date.now();
  let run = null;
  while (Date.now() - t0 < timeoutMs) {
    const r = await owner.req(`/api/runs/${runId}`);
    run = r.data?.run ?? null;
    if (run && terminal.includes(run.status)) return run;
    await sleep(150);
  }
  return run;
}
async function findTriggerRun(owner, triggerId, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await owner.req(`/api/runs?source=trigger`);
    const hit = (r.data?.runs ?? []).find((x) => x.sourceRef?.triggerId === triggerId);
    if (hit) return hit;
    await sleep(150);
  }
  return null;
}

// A scripted assistant brain that returns a fixed chat plan (same pattern as
// chat-agent-attribution.test.mjs). Ollama is a LOCAL provider, exercising slice-2's
// budget path harmlessly (the fake ignores the catalog it is handed).
let nextPlan = null;
function fakeModelServer() {
  return http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/api/tags") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ models: [{ name: "tg-fake" }] })); return; }
      let messages = [];
      try { messages = JSON.parse(body).messages ?? []; } catch { /* ignore */ }
      const sys = String(messages?.[0]?.content ?? "");
      const reply = (sys.includes("You are FamiliOS, a warm, capable assistant") && nextPlan)
        ? JSON.stringify({ kind: "plan", answer: "On it.", plan: nextPlan })
        : JSON.stringify({ kind: "answer", answer: "ok" });
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { content: reply } }) + "\n");
    });
  });
}
async function wireFakeProvider(ctx, owner) {
  const fake = fakeModelServer();
  await new Promise((r) => fake.listen(0, r));
  const port = fake.address().port;
  await owner.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "tg-fake" }) });
  await owner.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });
  return fake;
}
function taskPlan(suffix) {
  return {
    title: `TG-orch chat ${suffix}`, summary: "Add a household task.",
    icon: "Bot", spaceType: "Personal", instructions: "", trigger: { type: "Manual", detail: "" },
    steps: [{ toolId: "homeops.create_task", title: "Add a task", detail: "", input: { title: `TG-orch ${suffix}` }, requiresApproval: false }],
    approvalGates: [], risk: "Low",
  };
}
// A deterministic skill with one always-available step — no provider needed.
async function makeMemorySkill(owner, suffix) {
  const r = await owner.req("/api/skills", {
    method: "POST",
    body: JSON.stringify({ name: `TG-orch skill ${suffix}`, type: "custom", steps: [{ name: "Remember", tool_id: "homeops.write_memory", input_mapping: { text: `TG-orch skill fact ${suffix}`, scope: "household" } }] }),
  });
  assert.ok(r.data?.skill?.id, `skill create failed: ${JSON.stringify(r.data)}`);
  return r.data.skill.id;
}
async function countRuns(owner) {
  const r = await owner.req(`/api/runs?limit=500`);
  return (r.data?.runs ?? []).length;
}

/* ================================================================= *
 * Flag ON (default) — one entry, correct via + attribution per source
 * ================================================================= */
describe("orchestrate() single entry (HOMEOPS_ORCHESTRATE_ENTRY default ON)", () => {
  let ctx, owner, fake;
  before(async () => {
    ctx = await startServer({ env: { HOMEOPS_ASSISTANT_ENGINE: "legacy" } });
    owner = await makeSession(ctx, "m-alex");
    fake = await wireFakeProvider(ctx, owner);
  });
  after(async () => { await stopServer(ctx); await new Promise((r) => fake.close(r)); });

  test("CHAT source: one run, via=chat, attributed to agt_household", async () => {
    const before = await countRuns(owner);
    nextPlan = taskPlan("chat");
    const posted = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: add a task" }) });
    assert.equal(posted.status, 200);
    const runId = posted.data?.run?.id;
    assert.ok(runId, `chat did not auto-start a run: ${JSON.stringify(posted.data)}`);
    const run = await waitTerminal(owner, runId);
    assert.equal(run.status, "completed");
    assert.equal(run.source, "assistant");
    assert.equal(run.sourceRef?.via, "chat");
    assert.equal(run.sourceRef?.agentId, "agt_household");
    assert.equal(await countRuns(owner), before + 1, "exactly one run created per chat request");
  });

  test("AGENT source (ISS-018): one run, via=agent, server-verified agentId, filterable by GET /api/runs?agentId", async () => {
    const before = await countRuns(owner);
    // A read-only status pass — no goal, no skill, no provider needed.
    const posted = await owner.req("/api/agents/agt_household/run", { method: "POST", body: JSON.stringify({}) });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    const runId = posted.data?.run?.id;
    assert.ok(runId, `agent run did not start: ${JSON.stringify(posted.data)}`);
    const run = await waitTerminal(owner, runId);
    assert.equal(run.source, "agent");
    assert.equal(run.sourceRef?.via, "agent");
    assert.equal(run.sourceRef?.agentId, "agt_household", "the agent run must carry its own server-verified agentId");
    assert.equal(await countRuns(owner), before + 1, "exactly one run created per agent request");
    const filtered = await owner.req(`/api/runs?agentId=agt_household`);
    assert.ok((filtered.data?.runs ?? []).some((x) => x.id === runId), "the agent run must be filterable by agentId (Run History)");
  });

  test("MANUAL source: raw plan runs as-is; a smuggled body agentId gains NO attribution (ISS-018)", async () => {
    const plan = { title: "TG-orch manual", summary: "", steps: [{ toolId: "homeops.write_memory", title: "Remember", input: { text: "TG-orch manual fact", scope: "household" } }] };
    // Smuggle an agentId into the client sourceRef — the server MUST strip it.
    const posted = await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ plan, sourceRef: { agentId: "agt_smuggled", note: "kept" } }) });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    const run = await waitTerminal(owner, posted.data.run.id);
    assert.equal(run.status, "completed");
    assert.equal(run.source, "manual");
    assert.equal(run.sourceRef?.via, "manual", "a manual start stamps via=manual");
    assert.equal(run.sourceRef?.agentId ?? null, null, "a client-supplied agentId must never attribute a manual run");
    assert.equal(run.sourceRef?.note, "kept", "non-privileged client sourceRef fields still pass through");
    const filtered = await owner.req(`/api/runs?agentId=agt_smuggled`);
    assert.equal((filtered.data?.runs ?? []).length, 0, "the smuggled agentId must not make the run filterable as that agent's");
  });

  test("TRIGGER source (webhook): one run, source=trigger, via=webhook, triggerId stamped", async () => {
    const skillId = await makeMemorySkill(owner, "webhook");
    const made = await owner.req("/api/triggers", { method: "POST", body: JSON.stringify({ name: "TG-orch webhook", type: "webhook", target: { kind: "skill", skillId } }) });
    const trg = made.data?.trigger;
    assert.ok(trg?.id, `trigger create failed: ${JSON.stringify(made.data)}`);
    // Unsigned inbound webhook (accepted in development).
    const hook = await ctx.fetch(`/api/webhooks/${trg.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hello: "world" }) });
    assert.ok(hook.status >= 200 && hook.status < 300, `webhook POST failed: ${hook.status}`);
    const run = await findTriggerRun(owner, trg.id);
    assert.ok(run, "a webhook fire must create a durable run");
    assert.equal(run.source, "trigger");
    assert.equal(run.sourceRef?.via, "webhook");
    assert.equal(run.sourceRef?.triggerId, trg.id);
    assert.equal(run.sourceRef?.skillId, skillId, "the skill target is attributed");
  });

  test("TRIGGER source (manual fire of a schedule): via=schedule", async () => {
    const skillId = await makeMemorySkill(owner, "sched");
    const made = await owner.req("/api/triggers", { method: "POST", body: JSON.stringify({ name: "TG-orch sched", type: "schedule", runAt: new Date(Date.now() + 3600_000).toISOString(), target: { kind: "skill", skillId } }) });
    const trg = made.data?.trigger;
    assert.ok(trg?.id, `trigger create failed: ${JSON.stringify(made.data)}`);
    const fired = await owner.req(`/api/triggers/${trg.id}/fire`, { method: "POST", body: JSON.stringify({}) });
    assert.ok(fired.status >= 200 && fired.status < 300, `manual fire failed: ${JSON.stringify(fired.data)}`);
    const run = await findTriggerRun(owner, trg.id);
    assert.ok(run, "a manual fire must create a durable run");
    assert.equal(run.source, "trigger");
    assert.equal(run.sourceRef?.via, "schedule");
  });

  test("POLICY CLAMP preserved through orchestrate: a denied step is a visible skip, not a run and not a hard failure", async () => {
    // Deny homeops.create_task on agt_household (a household's own deliberate choice).
    const agents = readStoreDoc(ctx, "agents.json", {});
    agents["agt_household"] = { ...agents["agt_household"], deniedToolIds: ["homeops.create_task"] };
    writeStoreDoc(ctx, "agents.json", agents);
    try {
      nextPlan = taskPlan("denied");
      const posted = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: add a denied task" }) });
      const run = await waitTerminal(owner, posted.data.run.id);
      assert.equal(run.status, "completed", "a fully-clamped plan still completes, never hard-fails");
      const step = run.steps[0];
      assert.equal(step.status, "skipped", "a policy-denied step is a visible skip");
      assert.equal(step.clampedOut?.reason, "denied");
    } finally {
      const restore = readStoreDoc(ctx, "agents.json", {});
      restore["agt_household"] = { ...restore["agt_household"], deniedToolIds: [] };
      writeStoreDoc(ctx, "agents.json", restore);
    }
  });
});

/* ================================================================= *
 * Flag OFF — legacy sourceRef restored (no unified `via`)
 * ================================================================= */
describe("orchestrate() rollback (HOMEOPS_ORCHESTRATE_ENTRY=off)", () => {
  let ctx, owner, fake;
  before(async () => {
    ctx = await startServer({ env: { HOMEOPS_ASSISTANT_ENGINE: "legacy",  HOMEOPS_ORCHESTRATE_ENTRY: "off" } });
    owner = await makeSession(ctx, "m-alex");
    fake = await wireFakeProvider(ctx, owner);
  });
  after(async () => { await stopServer(ctx); await new Promise((r) => fake.close(r)); });

  test("AGENT run carries the pre-WP-006 sourceRef — agentId present, NO via stamp", async () => {
    const posted = await owner.req("/api/agents/agt_household/run", { method: "POST", body: JSON.stringify({}) });
    const run = await waitTerminal(owner, posted.data.run.id);
    assert.equal(run.source, "agent");
    assert.equal(run.sourceRef?.agentId, "agt_household", "attribution itself is unchanged by the flag");
    assert.equal(run.sourceRef?.via ?? null, null, "the unified via stamp is dropped under rollback");
  });

  test("CHAT run is unchanged by this flag — via=chat still (it predates WP-006)", async () => {
    nextPlan = taskPlan("flag-off");
    const posted = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "TG: add a task flag off" }) });
    const run = await waitTerminal(owner, posted.data.run.id);
    assert.equal(run.status, "completed");
    assert.equal(run.sourceRef?.via, "chat", "chat attribution is independent of the orchestrate-entry flag");
  });
});
