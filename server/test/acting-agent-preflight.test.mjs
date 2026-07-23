// FamiliOS — WP-101 slices 1+2 (ISS-102): no run may start with a null acting agent.
//
// The bug: server/orchestrator.mjs runSkill computed its identity as
//     agentId: agentId ?? skill.defaultAgentId ?? null
// so a skill with no default helper — every skill created through POST /api/skills, and
// most seeded use-case skills (seed.mjs: `defaultAgentId: null`) — started a durable run
// whose sourceRef.agentId was NULL. Nothing refused it at creation. The consequence only
// surfaced mid-run, at TOOL EXECUTION time: homeops.notify_contact
// (server/internal-functions.mjs) refuses `no_acting_agent` because its recipient
// allowlist is granted per helper. By then the run had started and burned earlier steps.
//
// This suite proves:
//   1. an unresolvable acting agent is a TYPED CREATION-TIME error and NO run is
//      persisted (slice 1: the null-agent run row is unreachable through this path),
//   2. a resolvable household default is self-healed and stamped on the run (the same
//      ensureOpenDefaultAgent helper chat already uses — never a second mechanism),
//   3. the refusal happens BEFORE any step is consumed (slice 2: a preflight class), and
//      the late internal-functions.mjs guard it replaces is now unreachable from here
//      (a notify_contact skill step with no default helper actually DELIVERS), and
//   4. HOMEOPS_REQUIRE_ACTING_AGENT=off restores the exact pre-WP-101 shape.
// Hermetic: the in-process half runs against an isolated mkdtemp store in throwaway
// tenants; the HTTP half boots the real server through harness.mjs. No network, no LLM.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

// The isolated store MUST be chosen before the first import of ../store.mjs (see the
// hard guard in store.mjs / the same pattern in harness.mjs).
process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-wp101-preflight-"));
const store = await import("../store.mjs");
const { runWithTenant } = await import("../tenant-context.mjs");
const orch = await import("../orchestrator.mjs");
const { startServer, stopServer, makeSession } = await import("./harness.mjs");

// A deterministic skill with ONE toolless, non-effect-claiming step: it needs no AI
// provider (the engine records "reasoning skipped") and no connector, so nothing here
// touches the network. `defaultAgentId: null` is the whole point of the fixture.
function tgSkill({ id, householdId }) {
  return {
    id, householdId,
    name: "TG-WP101 skill with no default helper",
    description: "TG fixture", domain: "Family", type: "custom", mode: "deterministic",
    defaultAgentId: null,
    planner_guidance: "", input_schema: [], output_schema: [],
    required_connectors: [], required_tools: [], required_functions: [],
    optional_tools: [], optional_functions: [],
    steps: [{ step_id: "s1", name: "Consider the week ahead", description: "Think it through.", tool_id: null, input_mapping: {} }],
    approval_policy: {}, risk_level: "Low", memory_policy: {}, test_cases: [],
    version: 1, status: "available", system: false,
    createdAt: Date.now(), updatedAt: new Date().toISOString(),
  };
}

/* ================================================================= *
 * In-process: the creation-time verdict itself
 * ================================================================= */
describe("WP-101 slice 1 — runSkill preflights the acting agent", () => {
  test("NO resolvable acting agent → typed error, and NOT ONE run is persisted", async () => {
    // A household whose runs would belong to "hh_wp101_stranger" while the store we can
    // reach belongs to "hh_wp101_orphan": no agent in scope, and self-healing one HERE
    // would create it in the wrong household — an identity engine.mjs would reject at
    // step 1 ("this run names a helper that no longer exists in this household"). That
    // late rejection is exactly what slice 2 moves forward, so the honest answer is to
    // refuse before anything durable exists.
    await runWithTenant("hh_wp101_orphan", async () => {
      const skillId = "skl_tg_wp101_orphan";
      store.putSkill(tgSkill({ id: skillId, householdId: "hh_wp101_stranger" }));
      const session = { householdId: "hh_wp101_stranger", actorId: "m-tg", role: "Owner" };

      const out = await orch.runSkill({ skillId, session });

      assert.equal(out.error, "no_acting_agent", `expected the typed refusal, got ${JSON.stringify(out).slice(0, 200)}`);
      assert.equal(out.ok, undefined, "a refusal must not also claim ok");
      assert.equal(out.run, undefined, "a refusal must not hand back a run");
      assert.match(String(out.message), /helper/i, "the message must be plain language and name the fix");
      assert.match(String(out.message), /Skills|household assistant/i, "…and say where to fix it");

      // Slice 1's actual invariant: the null-agent run row is unreachable through here.
      const runs = store.listRuns({ limit: 100 });
      assert.equal(runs.length, 0, `no run may be created by a refused start: ${JSON.stringify(runs.map((r) => r.sourceRef))}`);
      assert.equal(runs.filter((r) => (r.sourceRef?.agentId ?? null) === null).length, 0);
      // …and we must not have papered over it by minting an identity in the wrong tenant.
      const stray = store.getAgent("agt_household");
      assert.equal(stray ?? null, null, "the self-heal must never create the default agent for another household");
    });
  });

  test("a resolvable household default → the run persists with a REAL agentId (self-healed)", async () => {
    await runWithTenant("hh_wp101_home", async () => {
      const skillId = "skl_tg_wp101_home";
      store.putSkill(tgSkill({ id: skillId, householdId: "hh_wp101_home" }));
      const session = { householdId: "hh_wp101_home", actorId: "m-tg", role: "Owner" };
      assert.equal(store.getAgent("agt_household") ?? null, null, "fresh household starts with no default agent");

      const out = await orch.runSkill({ skillId, session });

      assert.equal(out.ok, true, `expected a run, got ${JSON.stringify(out).slice(0, 200)}`);
      assert.equal(out.run.sourceRef.agentId, "agt_household", "the run must carry a real acting identity");
      assert.equal(out.run.sourceRef.skillId, skillId);
      const healed = store.getAgent("agt_household");
      assert.ok(healed, "the household default is self-created by the SAME helper chat uses");
      assert.equal(healed.householdId, "hh_wp101_home", "and it belongs to THIS household, never 'local'");
      assert.deepEqual(healed.allowedToolIds, [], "open (deny-only) allow-list — attribution must not shrink capability");
      // The stored run — not just the returned object — carries the identity.
      const stored = store.getRun(out.run.id);
      assert.equal(stored.sourceRef.agentId, "agt_household");
    });
  });

  test("an explicit caller agentId and a skill's own defaultAgentId still win, in that order", async () => {
    await runWithTenant("hh_wp101_order", async () => {
      const session = { householdId: "hh_wp101_order", actorId: "m-tg", role: "Owner" };
      const mkAgent = (id) => store.putAgent({
        id, householdId: "hh_wp101_order", name: id, status: "Active", system: false,
        skillIds: [], allowedToolIds: [], allowedFunctionIds: [], deniedToolIds: [], deniedFunctionIds: [],
        version: 1, createdAt: Date.now(), updatedAt: new Date().toISOString(),
      });
      mkAgent("agt_tg_skill_default");
      mkAgent("agt_tg_explicit");
      const skill = tgSkill({ id: "skl_tg_wp101_order", householdId: "hh_wp101_order" });
      skill.defaultAgentId = "agt_tg_skill_default";
      store.putSkill(skill);

      const bySkillDefault = await orch.runSkill({ skillId: skill.id, session });
      assert.equal(bySkillDefault.run.sourceRef.agentId, "agt_tg_skill_default", "the skill's own helper is preferred over the household default");

      const byCaller = await orch.runSkill({ skillId: skill.id, agentId: "agt_tg_explicit", session });
      assert.equal(byCaller.run.sourceRef.agentId, "agt_tg_explicit", "an explicit caller identity wins over both");
    });
  });

  test("ROLLBACK (HOMEOPS_REQUIRE_ACTING_AGENT=off) restores the exact pre-WP-101 shape", async () => {
    const prev = process.env.HOMEOPS_REQUIRE_ACTING_AGENT;
    process.env.HOMEOPS_REQUIRE_ACTING_AGENT = "off";
    try {
      await runWithTenant("hh_wp101_rollback", async () => {
        const skillId = "skl_tg_wp101_rollback";
        store.putSkill(tgSkill({ id: skillId, householdId: "hh_wp101_stranger" }));
        const session = { householdId: "hh_wp101_stranger", actorId: "m-tg", role: "Owner" };
        const out = await orch.runSkill({ skillId, session });
        assert.equal(out.ok, true, "with the flag off the pre-WP-101 run still starts");
        assert.equal(out.run.sourceRef.agentId ?? null, null, "…carrying the old null acting agent, verbatim");
      });
    } finally {
      if (prev === undefined) delete process.env.HOMEOPS_REQUIRE_ACTING_AGENT;
      else process.env.HOMEOPS_REQUIRE_ACTING_AGENT = prev;
    }
  });

  test("resolveActingAgent is a pure preflight — it answers without starting anything", async () => {
    await runWithTenant("hh_wp101_probe", async () => {
      const session = { householdId: "hh_wp101_nobody", actorId: "m-tg", role: "Owner" };
      assert.equal(orch.resolveActingAgent({ session }), null, "unresolvable → null, no run, no side effect");
      const ok = orch.resolveActingAgent({ session: { householdId: "hh_wp101_probe", actorId: "m-tg" } });
      assert.equal(ok?.id, "agt_household");
      assert.equal(store.listRuns({ limit: 10 }).length, 0, "a preflight must never create a run");
    });
  });
});

/* ================================================================= *
 * Through the REAL server: the path a family actually takes
 * ================================================================= */
describe("WP-101 slice 2 — the failure is a preflight, not a late runtime surprise", () => {
  let ctx, owner;
  before(async () => {
    ctx = await startServer();
    owner = await makeSession(ctx, "m-alex"); // Owner
  });
  after(async () => { await stopServer(ctx); });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitTerminal(runId, extra = [], timeoutMs = 20000) {
    const terminal = ["completed", "partially_failed", "failed", "cancelled", "expired", ...extra];
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
  async function makeSkill(body) {
    const r = await owner.req("/api/skills", { method: "POST", body: JSON.stringify(body) });
    assert.ok(r.data?.skill?.id, `skill create failed: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.skill.defaultAgentId ?? null, null, "the fixture must have NO default helper — that is the bug's precondition");
    return r.data.skill.id;
  }

  test("a skill with no default helper starts an ATTRIBUTED run (ISS-102 repro)", async () => {
    const skillId = await makeSkill({
      name: "TG-WP101 memory skill", type: "custom",
      steps: [{ step_id: "s1", name: "Remember", tool_id: "homeops.write_memory", input_mapping: { text: "TG-WP101 attributed skill fact", scope: "household" } }],
    });
    const started = await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ skillId }) });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const run = await waitTerminal(started.data.run.id);
    assert.equal(run.status, "completed", JSON.stringify(run.steps?.map((s) => ({ t: s.toolId, st: s.status, d: s.detail }))));
    assert.equal(run.sourceRef?.agentId, "agt_household", "at HEAD this was null — the exact ISS-102 run row");
    assert.equal(run.steps[0].status, "succeeded", "attribution must not clamp a skill that used to run unattributed");
  });

  test("the LATE no_acting_agent refusal is unreachable from a skill run: notify_contact now delivers", async () => {
    // In-App methods are born verified/opted-in and never leave the device, so the real
    // per-agent allowlist gate in deliverNotification is exercised fully hermetically.
    const made = await owner.req("/api/contact-methods", {
      method: "POST",
      body: JSON.stringify({ label: "TG-WP101 in-app", type: "In-App", allowedAgentIds: ["agt_household"] }),
    });
    const methodId = made.data?.contactMethod?.id;
    assert.ok(methodId, `contact method creation failed: ${JSON.stringify(made.data)}`);
    const skillId = await makeSkill({
      name: "TG-WP101 notify skill", type: "custom",
      steps: [{ step_id: "s1", name: "Send to a contact method", tool_id: "homeops.notify_contact", input_mapping: { methodId, subject: "TG-WP101", body: "TG-WP101 preflight delivery body, long enough to pass validation." } }],
    });
    const started = await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ skillId }) });
    const run = await waitTerminal(started.data.run.id, ["waiting_for_approval", "waiting_for_connector"]);
    const step = run.steps[0];
    assert.doesNotMatch(String(step.detail ?? ""), /no_acting_agent|needs to run as a specific helper/i,
      "the late runtime refusal is what this WP moves to creation time — it must not appear on this path at all");
    assert.equal(step.status, "succeeded", `notify_contact must deliver from an attributed skill run: ${step.detail}`);
    assert.equal(step.result?.delivered, true);
  });

  test("a refused start returns a typed 422 and leaves no run behind", async () => {
    // The route surfaces the orchestrator's typed error verbatim; unknown_skill is the
    // sibling class that proves the shape without needing an unresolvable household on a
    // real, seeded server (where the default assistant always resolves — by design).
    const before = (await owner.req("/api/runs?limit=500")).data.runs.length;
    const bad = await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ skillId: "skl_tg_does_not_exist" }) });
    assert.equal(bad.status, 404);
    assert.equal((await owner.req("/api/runs?limit=500")).data.runs.length, before, "a refused start creates nothing");
  });

});

/* ================================================================= *
 * Regression: WP-002 slice 2 chat attribution still behaves exactly as before
 * ================================================================= */
describe("WP-101 regression — chat-run agent attribution is unchanged", () => {
  // runAssistantPlan now resolves its identity through the SHARED resolveActingAgent
  // helper instead of an inline ensureOpenDefaultAgent call. Everything the WP-002 slice-2
  // contract promised must still hold: the default agent is self-healed into THIS
  // household, its pristine-seed allow-list is widened to the open default, a denied tool
  // becomes a visible clamp (never a silent drop), and the rollback flag still produces a
  // completely unattributed run. (The full end-to-end chat path stays covered by
  // server/test/chat-agent-attribution.test.mjs; this pins the shared helper itself.)
  // A toolless, non-effect-claiming step: it exercises attribution + the clamp pass
  // without executing a tool in this process (an executed step leaves the engine's 60s
  // step-timeout timer pending, which would hold the test process open).
  const plan = { title: "TG-WP101 chat plan", summary: "", steps: [{ toolId: null, title: "Consider the week ahead", detail: "Think it through.", input: {} }] };
  // The clamp fixture needs a real tool id to deny — it is skipped, never executed.
  const denyPlan = { title: "TG-WP101 chat plan (denied)", summary: "", steps: [{ toolId: "homeops.create_task", title: "Add a task", detail: "", input: { title: "TG-WP101 chat task" } }] };

  test("attribution ON: the chat run carries agt_household, self-healed and open", async () => {
    await runWithTenant("hh_wp101_chat", async () => {
      const session = { householdId: "hh_wp101_chat", actorId: "m-tg", role: "Owner" };
      const out = await orch.runAssistantPlan({ plan, session, conversationId: null });
      assert.equal(out.ok, true, JSON.stringify(out).slice(0, 200));
      assert.equal(out.run.sourceRef.agentId, "agt_household");
      assert.equal(out.run.sourceRef.via, "chat");
      assert.equal(out.droppedSteps, 0, "an open allow-list clamps nothing");
      assert.deepEqual(store.getAgent("agt_household").allowedToolIds, []);
    });
  });

  test("attribution ON: a household's explicit DENY is still a visible clamp, not a silent drop", async () => {
    await runWithTenant("hh_wp101_chat_deny", async () => {
      const session = { householdId: "hh_wp101_chat_deny", actorId: "m-tg", role: "Owner" };
      orch.ensureOpenDefaultAgent("agt_household");
      const agent = store.getAgent("agt_household");
      store.putAgent({ ...agent, deniedToolIds: ["homeops.create_task"] });
      const out = await orch.runAssistantPlan({ plan: denyPlan, session, conversationId: null });
      assert.equal(out.droppedSteps, 1, "the denied step must be clamped, visibly");
      const step = store.getRun(out.run.id).steps[0];
      assert.equal(step.clampedOut?.reason, "denied");
    });
  });

  test("rollback (HOMEOPS_CHAT_AGENT_ATTRIBUTION=off) still yields a fully unattributed chat run", async () => {
    const prev = process.env.HOMEOPS_CHAT_AGENT_ATTRIBUTION;
    process.env.HOMEOPS_CHAT_AGENT_ATTRIBUTION = "off";
    try {
      await runWithTenant("hh_wp101_chat_off", async () => {
        const session = { householdId: "hh_wp101_chat_off", actorId: "m-tg", role: "Owner" };
        const out = await orch.runAssistantPlan({ plan, session, conversationId: null });
        assert.equal(out.ok, true, "the acting-agent preflight must NOT hijack the WP-002 rollback");
        assert.equal(out.run.sourceRef.agentId ?? null, null, "the pre-WP-002 unattributed shape, verbatim");
      });
    } finally {
      if (prev === undefined) delete process.env.HOMEOPS_CHAT_AGENT_ATTRIBUTION;
      else process.env.HOMEOPS_CHAT_AGENT_ATTRIBUTION = prev;
    }
  });
});
