// UC.1 — the unified chat-builder materialize endpoint stands up durable entities
// (skill + agent + automation) from a single build spec, via the real registry paths.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, admin, child;
before(async () => {
  ctx = await startServer();
  admin = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");   // Child View
});
after(async () => { await stopServer(ctx); });

const SPEC = {
  build: {
    summary: "Sunday family briefing text",
    skill: { name: "Sunday Briefing", description: "Summarize next week + what to bring", domain: "Family",
      planner_guidance: "List next week's events and each kid's what-to-bring, then text it.",
      steps: [{ name: "Gather events", tool_id: "homeops.create_artifact", approval_required: false }], risk_level: "Medium" },
    agent: { name: "Briefing Bot", purpose: "Owns the Sunday family briefing", instructions: "Be concise and warm." },
    automation: { name: "Sunday 8pm briefing", type: "recurring", intervalMs: 604800000 },
  },
};

test("a child cannot build (create durable entities) from chat", async () => {
  const r = await child.req("/api/assistant/build", { method: "POST", body: JSON.stringify(SPEC) });
  assert.equal(r.status, 403);
});

test("an empty build spec is rejected", async () => {
  const r = await admin.req("/api/assistant/build", { method: "POST", body: JSON.stringify({ build: { summary: "nothing" } }) });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "empty_build");
});

test("an admin builds skill + agent + automation in one approved step, wired together", async () => {
  const r = await admin.req("/api/assistant/build", { method: "POST", body: JSON.stringify(SPEC) });
  assert.equal(r.status, 200);
  const c = r.data.created;
  assert.ok(c.skill?.id?.startsWith("skl_"), "skill created");
  assert.ok(c.agent?.id?.startsWith("agt_"), "agent created");
  assert.ok(c.automation?.id?.startsWith("trg_"), "automation created");
  // Honest posture: the new skill is a draft (tools not yet verified available).
  assert.equal(c.skill.status, "draft");
  assert.ok(r.data.notes.some((n) => /draft/i.test(n)), "notes flag the draft state");

  // The entities really persist and are wired: the agent owns the new skill; the
  // automation targets the new agent.
  const skills = (await admin.req("/api/skills")).data.skills;
  const agents = (await admin.req("/api/agents")).data.agents;
  const triggers = (await admin.req("/api/triggers")).data.triggers;
  const agent = agents.find((a) => a.id === c.agent.id);
  assert.ok(skills.some((s) => s.id === c.skill.id), "skill persisted");
  assert.ok(agent.skillIds.includes(c.skill.id), "agent is wired to the new skill");
  const trig = triggers.find((t) => t.id === c.automation.id);
  assert.equal(trig.target.agentId, c.agent.id, "automation targets the new agent");
});

test("a skill-only build works (no agent/automation required)", async () => {
  const r = await admin.req("/api/assistant/build", { method: "POST", body: JSON.stringify({ build: { skill: { name: "Just a skill" } } }) });
  assert.equal(r.status, 200);
  assert.ok(r.data.created.skill?.id);
  assert.equal(r.data.created.agent, undefined);
});

test("chat can EDIT an existing skill (versioned), not just create", async () => {
  // The seeded skill skl_morning_brief exists; bump its guidance via an edit-only build.
  const before = (await admin.req("/api/skills")).data.skills.find((s) => s.id === "skl_morning_brief");
  const r = await admin.req("/api/assistant/build", { method: "POST", body: JSON.stringify({
    build: { summary: "Tweak the briefing", edits: [{ kind: "skill", id: "skl_morning_brief", summary: "warmer tone", patch: { planner_guidance: "Lead with the kids' schedules; keep it warm." } }] },
  }) });
  assert.equal(r.status, 200);
  const u = r.data.updated?.find((x) => x.id === "skl_morning_brief");
  assert.ok(u?.ok, "edit applied");
  assert.equal(u.version, (before.version ?? 1) + 1, "edit bumped the version (snapshotted)");
  const after = (await admin.req("/api/skills")).data.skills.find((s) => s.id === "skl_morning_brief");
  assert.equal(after.planner_guidance, "Lead with the kids' schedules; keep it warm.");
});

test("an edit targeting an unknown id is reported, not fatal", async () => {
  const r = await admin.req("/api/assistant/build", { method: "POST", body: JSON.stringify({
    build: { summary: "x", edits: [{ kind: "agent", id: "agt_does_not_exist", patch: { instructions: "x" } }] },
  }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.updated[0].ok, false);
  assert.equal(r.data.updated[0].error, "not_found");
});

test("a child cannot edit entities via chat-build", async () => {
  const r = await child.req("/api/assistant/build", { method: "POST", body: JSON.stringify({ build: { edits: [{ kind: "skill", id: "skl_morning_brief", patch: { planner_guidance: "hacked" } }] } }) });
  assert.equal(r.status, 403);
});

// Item 8 (2026-07-03): a chat-built agent must inherit the capabilities its skill's
// steps reference. Previously allowedToolIds/allowedFunctionIds shipped empty, so the
// agent was "created" but permitted∩available made it unable to execute anything.
test("a chat-built agent inherits its skill steps' tools/functions (intelligent preselection)", async () => {
  const r = await admin.req("/api/assistant/build", { method: "POST", body: JSON.stringify({
    build: {
      summary: "Gmail triage helper",
      skill: { name: "Promo triage", domain: "Family", steps: [
        { name: "Find promos", tool_id: "gmail.search", approval_required: false },
        { name: "Label them", tool_id: "gmail.modifyLabels", approval_required: true },
        { name: "Note it", tool_id: "homeops.write_memory", approval_required: false },
        { name: "Think", tool_id: null, approval_required: false },
      ] },
      agent: { name: "Promo Triager", purpose: "Keeps the inbox clean" },
    },
  }) });
  assert.equal(r.status, 200);
  const agent = (await admin.req("/api/agents")).data.agents.find((a) => a.id === r.data.created.agent.id);
  assert.ok(agent.allowedToolIds.includes("gmail.search"), "search tool preselected");
  assert.ok(agent.allowedToolIds.includes("gmail.modifyLabels"), "label tool preselected");
  assert.ok(agent.allowedFunctionIds.includes("homeops.write_memory"), "internal function routed to allowedFunctionIds");
  assert.ok(!agent.allowedToolIds.includes("homeops.write_memory"), "function id not duplicated into tools");
  assert.ok(r.data.notes.some((n) => /preselected/i.test(n)), "notes surface the preselection");
});

test("a build with a conversationId durably records the outcome on the conversation", async () => {
  const conv = await admin.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Build chat" }) });
  const convId = conv.data.conversation.id;
  const r = await admin.req("/api/assistant/build", { method: "POST", body: JSON.stringify({
    conversationId: convId,
    build: { summary: "x", skill: { name: "Persisted-outcome skill" } },
  }) });
  assert.equal(r.status, 200);
  const after = (await admin.req(`/api/conversations/${convId}`)).data.conversation;
  const result = after.messages.find((m) => m.kind === "build_result");
  assert.ok(result, "a durable build_result message was appended");
  assert.ok(result.text.includes("Persisted-outcome skill"), "confirmation names the created entity");
  assert.equal(result.builtIds.skillId, r.data.created.skill.id, "confirmation carries the created ids");
});

test("a build against someone ELSE's conversation id does not write into it", async () => {
  const conv = await admin.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Admin's chat" }) });
  const convId = conv.data.conversation.id;
  const owner = await makeSession(ctx, "m-alex"); // a DIFFERENT adult
  const r = await owner.req("/api/assistant/build", { method: "POST", body: JSON.stringify({
    conversationId: convId, build: { summary: "x", skill: { name: "Cross-actor skill" } },
  }) });
  assert.equal(r.status, 200, "the build itself succeeds");
  const after = (await admin.req(`/api/conversations/${convId}`)).data.conversation;
  assert.ok(!after.messages.some((m) => m.kind === "build_result"), "no message written into another actor's conversation");
});

test("the streaming build endpoint emits a progress event per entity, then done", async () => {
  // Drive the SSE endpoint with the admin's cookie + CSRF (mirror harness req()).
  const res = await ctx.fetch("/api/assistant/build/stream", {
    method: "POST",
    headers: { Cookie: admin.cookie, "x-homeops-csrf": admin.csrf, "content-type": "application/json" },
    body: JSON.stringify({ build: { summary: "stream test", skill: { name: "Streamed skill" }, agent: { name: "Streamed agent" } } }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  const events = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
  const progress = events.filter((e) => e.type === "progress");
  const done = events.find((e) => e.type === "done");
  assert.ok(progress.some((e) => e.entity === "skill" && e.action === "created"), "emitted skill progress");
  assert.ok(progress.some((e) => e.entity === "agent" && e.action === "created"), "emitted agent progress");
  assert.ok(done?.result?.ok, "emitted a done event with the result");
  assert.ok(done.result.created.skill?.id && done.result.created.agent?.id, "done carries created ids");
});
