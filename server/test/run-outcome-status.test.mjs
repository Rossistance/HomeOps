// FamiliOS — WP-101 slice 3 (ISS-110): honest terminal status aggregation.
//
// The bug: server/engine.mjs's driver had exactly two endings — any hard failure went
// through finishFailed ("failed"), and reaching the end of the plan wrote "completed"
// UNCONDITIONALLY. The soft-fail rule (a failing read-only enrichment step does not kill
// a plan that still has later steps) is right, but it left a step honestly marked
// `failed` inside a run whose own status claimed success. Every consumer above the engine
// — the trigger's lastStatus, the run chip, the digest — read that as "it worked".
//
// The truth table this suite pins (in the engine's existing vocabulary, where "completed"
// IS the success terminal):
//   • all required children succeeded              → completed
//   • ANY required child failed                    → failed             (never success)
//   • only optional / soft-failed children failed  → partially_failed   (never success)
// Optional-ness is not inferred: the engine stamps `softFailed: true` on a step at the
// moment it decides to continue past that step's failure. A failed step without that
// stamp is required by definition, and lands the run on `failed` — fail-closed.
//
// Hermetic: the truth table runs against the pure exported classifier in an isolated
// mkdtemp store; the live half boots the real server (harness.mjs) and drives runs whose
// read step fails locally (an unparseable URL — no network egress, the same fixture
// server/test/engine-soft-fail.test.mjs has always used).
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-wp101-outcome-"));
const { classifyRunOutcome, TERMINAL_RUN_STATUSES } = await import("../engine.mjs");
const { startServer, stopServer, makeSession } = await import("./harness.mjs");

const step = (over = {}) => ({ index: 0, title: "Step", toolId: "web.read", status: "succeeded", softFailed: false, ...over });

/* ================================================================= *
 * The truth table itself (pure, no server)
 * ================================================================= */
describe("WP-101 slice 3 — run outcome truth table", () => {
  test("all required children succeeded → completed", () => {
    const run = { steps: [step(), step({ index: 1 }), step({ index: 2, toolId: null })] };
    const o = classifyRunOutcome(run);
    assert.equal(o.status, "completed");
    assert.equal(o.error, null);
  });

  test("a REQUIRED child failed → failed, never succeeded", () => {
    const run = { steps: [step(), step({ index: 1, status: "failed" })] };
    const o = classifyRunOutcome(run);
    assert.equal(o.status, "failed", "a required failure can never round up to a success terminal");
    assert.equal(o.error, "required_step_failed");
    assert.equal(o.required.length, 1);
  });

  test("only OPTIONAL (soft-failed) children failed → partially_failed, never succeeded", () => {
    const run = { steps: [step({ status: "failed", softFailed: true }), step({ index: 1 })] };
    const o = classifyRunOutcome(run);
    assert.equal(o.status, "partially_failed");
    assert.notEqual(o.status, "completed", "the whole point: a partial failure is not a success");
    assert.equal(o.optional.length, 1);
    assert.equal(o.required.length, 0);
  });

  test("a required failure ALONGSIDE an optional one is still failed (required wins)", () => {
    const run = { steps: [step({ status: "failed", softFailed: true }), step({ index: 1, status: "failed" })] };
    assert.equal(classifyRunOutcome(run).status, "failed");
  });

  test("non-failure statuses are not failures: skipped / skipped_no_tool / expired steps leave the terminal alone", () => {
    // WP-003 owns the honesty of these three (a visible policy skip, a toolless step that
    // claimed to send, an approval that lapsed) at the STEP level and in the run summary,
    // and a fully-clamped plan is contractually still a completed run. Slice 3 changes
    // only what a FAILED child does to the parent's terminal.
    const run = { steps: [
      step({ status: "skipped" }),
      step({ index: 1, status: "skipped_no_tool" }),
      step({ index: 2, status: "succeeded" }),
    ] };
    assert.equal(classifyRunOutcome(run).status, "completed");
  });

  test("partially_failed is a TERMINAL state", () => {
    assert.ok(TERMINAL_RUN_STATUSES.includes("partially_failed"));
    assert.ok(TERMINAL_RUN_STATUSES.includes("completed") && TERMINAL_RUN_STATUSES.includes("failed"));
  });

  test("an empty or malformed run never throws and never claims failure", () => {
    assert.equal(classifyRunOutcome({ steps: [] }).status, "completed");
    assert.equal(classifyRunOutcome({}).status, "completed");
    assert.equal(classifyRunOutcome(null).status, "completed");
  });
});

/* ================================================================= *
 * The real engine, end to end
 * ================================================================= */
describe("WP-101 slice 3 — the durable runtime settles the honest terminal", () => {
  let ctx, owner;
  before(async () => { ctx = await startServer(); owner = await makeSession(ctx, "m-alex"); });
  after(async () => { await stopServer(ctx); });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function runPlan(plan, timeoutMs = 25000) {
    const started = await owner.req("/api/runs/start", { method: "POST", body: JSON.stringify({ source: "manual", plan }) });
    assert.equal(started.status, 200, JSON.stringify(started.data));
    const id = started.data.run.id;
    const t0 = Date.now();
    let run = null;
    while (Date.now() - t0 < timeoutMs) {
      const r = await owner.req(`/api/runs/${id}`);
      run = r.data?.run ?? null;
      if (run && TERMINAL_RUN_STATUSES.includes(run.status)) return run;
      await sleep(150);
    }
    return run;
  }
  const trace = (run) => JSON.stringify(run?.steps?.map((s) => ({ t: s.toolId, st: s.status, d: s.detail })));

  test("a soft-failed read with later steps → partially_failed (at HEAD this said completed)", async () => {
    const run = await runPlan({
      title: "TG-WP101 enrich then record",
      summary: "A read that will fail, then a write that must still happen.",
      steps: [
        { toolId: "web.read", title: "Read a page that cannot load", detail: "Fetch enrichment", input: { url: "not-a-real-url" } },
        { toolId: "homeops.write_memory", title: "Record the note anyway", detail: "TG-WP101 partial", input: { text: "TG-WP101 partial-failure fact", scope: "household" } },
      ],
    });
    assert.equal(run.status, "partially_failed", trace(run));
    assert.notEqual(run.status, "completed", "a run carrying a failed child must never report success");
    assert.equal(run.steps[0].status, "failed", "the soft-failed step keeps its honest step status");
    assert.match(String(run.steps[0].detail ?? ""), /continued without/i);
    assert.equal(run.steps[1].status, "succeeded", "and the later work still ran — soft-fail behavior is preserved");
    assert.equal(run.error, "partial_step_failure", "the run names its own partial class");
  });

  test("an all-succeeded run still reports completed", async () => {
    const run = await runPlan({
      title: "TG-WP101 clean run", summary: "",
      steps: [{ toolId: "homeops.write_memory", title: "Remember", detail: "", input: { text: "TG-WP101 clean fact", scope: "household" } }],
    });
    assert.equal(run.status, "completed", trace(run));
    assert.equal(run.error ?? null, null);
  });

  test("a REQUIRED failure (a failing final read, nothing left to salvage it) is still failed", async () => {
    const run = await runPlan({
      title: "TG-WP101 read only", summary: "",
      steps: [{ toolId: "web.read", title: "Read a page that cannot load", detail: "", input: { url: "not-a-real-url" } }],
    });
    assert.equal(run.status, "failed", trace(run));
  });
});

/* ================================================================= *
 * Rollback
 * ================================================================= */
describe("WP-101 slice 3 rollback (HOMEOPS_PARTIAL_FAILURE_STATUS=off)", () => {
  let ctx, owner;
  before(async () => {
    ctx = await startServer({ env: { HOMEOPS_PARTIAL_FAILURE_STATUS: "off" } });
    owner = await makeSession(ctx, "m-alex");
  });
  after(async () => { await stopServer(ctx); });

  test("the pre-WP-101 terminal is restored exactly — a soft failure ends completed", async () => {
    const started = await owner.req("/api/runs/start", {
      method: "POST",
      body: JSON.stringify({ source: "manual", plan: { title: "TG-WP101 rollback", summary: "", steps: [
        { toolId: "web.read", title: "Read a page that cannot load", detail: "", input: { url: "not-a-real-url" } },
        { toolId: "homeops.write_memory", title: "Record anyway", detail: "", input: { text: "TG-WP101 rollback fact", scope: "household" } },
      ] } }),
    });
    const id = started.data.run.id;
    let run = null;
    for (let i = 0; i < 160; i++) {
      const r = await owner.req(`/api/runs/${id}`);
      run = r.data?.run ?? null;
      if (run && TERMINAL_RUN_STATUSES.includes(run.status)) break;
      await new Promise((res) => setTimeout(res, 150));
    }
    assert.equal(run.status, "completed", "the flag must reproduce the old (dishonest) terminal byte for byte");
    assert.equal(run.steps[0].status, "failed", "the step-level honesty predates this WP and is unaffected");
  });
});
