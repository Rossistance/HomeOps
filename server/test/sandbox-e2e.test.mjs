// WP-006 slice 3 — the connector SANDBOX, exercised through the REAL server (a spawned
// child process, isolated temp data dir — never the live dev stack on :8787/:5173).
//
// sandbox-connectors.test.mjs proves the module and its two hook points in isolation.
// This file proves the seam holds at the level that actually matters: a full run
// through the durable engine and through notify.mjs's consent gates, with
// HOMEOPS_CONNECTOR_SANDBOX=1 set on the server process the way a deployment would set
// it — not by calling sandbox-connectors.mjs functions directly.
//
// Central proof: seedSandboxAccounts() is NOT wired to run automatically anywhere yet
// (index.mjs owns that boot wiring — see the HANDOFF note in the final report). So this
// suite seeds an account the same way accounts.test.mjs already does for the real
// provider platform: writing accounts.json directly into the spawned server's data dir.
// That is not a workaround — it is the documented, current, honest state: sandbox mode
// makes a SEEDED account's tools/tokens deterministic; it does not conjure accounts.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, writeStoreDoc, readStoreDoc } from "./harness.mjs";
import "../loadEnv.mjs"; // match the spawned child's env exactly (it loads the same .env)
import { providerById, providerConfigured } from "../providers.mjs";

let ctx, alex, morgan;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seedSandboxGoogleAccount(actorId) {
  const def = providerById("google");
  writeStoreDoc(ctx, "accounts.json", [
    {
      id: `sbx_google_${actorId}`, provider: "google", householdId: "local", connectedByActorId: actorId,
      externalAccountId: "sbx-google-uid", displayName: "family.sandbox@gmail.com",
      scopes: def.scopes.map((s) => s.key), status: "connected",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      lastHealthAt: null, lastHealthOk: null, sandbox: true,
    },
  ]);
}

async function waitTerminal(client, runId, extra = [], timeoutMs = 20000) {
  const terminal = ["completed", "failed", "cancelled", "expired", ...extra];
  const t0 = Date.now();
  let run = null;
  while (Date.now() - t0 < timeoutMs) {
    const r = await client.req(`/api/runs/${runId}`);
    run = r.data?.run ?? null;
    if (run && terminal.includes(run.status)) return run;
    await sleep(200);
  }
  return run;
}

before(async () => {
  ctx = await startServer({ env: { HOMEOPS_CONNECTOR_SANDBOX: "1" } });
  alex = await makeSession(ctx, "m-alex"); // Owner
  morgan = await makeSession(ctx, "m-morgan"); // Adult, deliberately given NO sandbox account
});
after(async () => { await stopServer(ctx); });

describe("sandbox mode, seen through the real server — connector readiness", () => {
  test("GET /api/connectors: sms reports 'connected' with zero Twilio config, because the flag is set", async () => {
    const r = await alex.req("/api/connectors");
    const sms = r.data.connectors.find((c) => c.id === "sms");
    assert.equal(sms.readiness, "connected");
    assert.equal(sms.live, true);
  });
  test("GET /api/providers: every provider is annotated sandbox:true, and readiness still reflects this environment's REAL deployment credentials (sandbox never overrides that signal)", async () => {
    const r = await alex.req("/api/providers");
    for (const p of r.data.providers) {
      assert.equal(p.sandbox, true, `${p.id} should carry the sandbox flag`);
      const def = providerById(p.id);
      const expected = providerConfigured(def) ? "configured" : "not_configured_by_deployment";
      assert.equal(p.readiness, expected, `${p.id} readiness must reflect real env credentials, not be faked by sandbox mode`);
    }
  });
});

describe("sandbox mode does not conjure accounts — only a seeded account resolves", () => {
  test("an actor with NO sandbox account still gets a real not_connected, even with the flag set", async () => {
    const created = await morgan.req("/api/approvals", { method: "POST", body: JSON.stringify({ toolId: "gmail.send", input: { to: "x@y.example", subject: "Hi", body: "Hi there, long enough body." } }) });
    const id = created.data.approval.id;
    await morgan.req(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
    const exec = await morgan.req("/api/tools/gmail.send/execute", { method: "POST", body: JSON.stringify({ input: { to: "x@y.example", subject: "Hi", body: "Hi there, long enough body." }, approvalId: id }) });
    assert.equal(exec.data.error, "not_connected", "the sandbox transport swap never runs without a connected account to swap under");
  });
});

describe("sandbox mode, once an account IS seeded — provider tools resolve and record effects", () => {
  before(() => seedSandboxGoogleAccount("m-alex"));

  test("gmail.send via /api/tools/gmail.send/execute succeeds and records a sandbox_effects row", async () => {
    const created = await alex.req("/api/approvals", { method: "POST", body: JSON.stringify({ toolId: "gmail.send", input: { to: "school@example.invalid", subject: "Sandbox e2e", body: "Field trip form attached — please sign." } }) });
    const id = created.data.approval.id;
    await alex.req(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
    const exec = await alex.req("/api/tools/gmail.send/execute", { method: "POST", body: JSON.stringify({ input: { to: "school@example.invalid", subject: "Sandbox e2e", body: "Field trip form attached — please sign." }, approvalId: id }) });
    assert.equal(exec.status, 200);
    assert.equal(exec.data.ok, true);
    assert.equal(exec.data.result.sent, true);
    const effects = readStoreDoc(ctx, "sandbox_effects.json", []);
    const mine = effects.filter((e) => e.recipient === "school@example.invalid");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].channel, "email");
    assert.equal(mine[0].content, "Field trip form attached — please sign.");
  });

  test("sms.send via the connector platform succeeds with zero Twilio config, and records a sandbox_effects row", async () => {
    const created = await alex.req("/api/approvals", { method: "POST", body: JSON.stringify({ toolId: "sms.send", input: { to: "+15559998888", body: "Practice moved to 5pm." } }) });
    const id = created.data.approval.id;
    await alex.req(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
    const exec = await alex.req("/api/tools/sms.send/execute", { method: "POST", body: JSON.stringify({ input: { to: "+15559998888", body: "Practice moved to 5pm." }, approvalId: id }) });
    assert.equal(exec.data.ok, true);
    assert.equal(exec.data.sandbox, true);
    const effects = readStoreDoc(ctx, "sandbox_effects.json", []);
    const mine = effects.filter((e) => e.recipient === "+15559998888");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].channel, "sms");
  });

  test("the household kill switch still stops a sandbox send at the connector platform", async () => {
    await alex.req("/api/settings", { method: "POST", body: JSON.stringify({ externalActionsEnabled: false }) });
    try {
      const created = await alex.req("/api/approvals", { method: "POST", body: JSON.stringify({ toolId: "gmail.send", input: { to: "paused@example.invalid", subject: "Hi", body: "Should not send while paused." } }) });
      const id = created.data.approval.id;
      await alex.req(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
      const exec = await alex.req("/api/tools/gmail.send/execute", { method: "POST", body: JSON.stringify({ input: { to: "paused@example.invalid", subject: "Hi", body: "Should not send while paused." }, approvalId: id }) });
      assert.equal(exec.data.ok, false);
      assert.equal(exec.data.error, "external_actions_disabled");
      const effects = readStoreDoc(ctx, "sandbox_effects.json", []);
      assert.equal(effects.filter((e) => e.recipient === "paused@example.invalid").length, 0, "a paused household must produce no effect, sandboxed or not");
    } finally {
      await alex.req("/api/settings", { method: "POST", body: JSON.stringify({ externalActionsEnabled: true }) });
    }
  });
});

// homeops.notify_contact's registry gates (verified / opted-in / per-agent allowlist),
// run through the SAME full path as WP-005's adversarial suite (notify-contact-delivery
// .test.mjs) — but this time with a sandbox Google account connected for the owner, so
// the only thing standing between "gate refuses" and "delivers" is the gate itself.
describe("sandbox mode does not relax homeops.notify_contact's consent gates", () => {
  let agent;
  before(async () => {
    const a = await alex.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "TG-Sandbox Agent", purpose: "TG sandbox e2e", instructions: "test", status: "Active", allowedFunctionIds: ["homeops.notify_contact"] }) });
    agent = a.data.agent;
  });

  async function notifyStep(input) {
    const skill = await alex.req("/api/skills", {
      method: "POST",
      body: JSON.stringify({ name: `TG-sbx-${Math.random().toString(16).slice(2, 8)}`, description: "TG sandbox e2e", domain: "Family", steps: [{ step_id: "s1", name: "Send", tool_id: "homeops.notify_contact", approval_required: false, input_mapping: input }] }),
    });
    const skillId = skill.data?.skill?.id;
    const tr = await alex.req("/api/triggers", { method: "POST", body: JSON.stringify({ name: "TG-sbx trigger", type: "manual", target: { kind: "agent", agentId: agent.id, skillId } }) });
    const fire = await alex.req(`/api/triggers/${tr.data.trigger.id}/fire`, { method: "POST", body: JSON.stringify({}) });
    const run = await waitTerminal(alex, fire.data.runId, ["waiting_for_approval", "waiting_for_connector"]);
    return run?.steps?.[0];
  }
  async function makeMethod(fields) {
    const r = await alex.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ label: "TG-sbx", type: "Email", allowedAgentIds: [agent.id], ...fields }) });
    return r.data.contactMethod;
  }

  test("an UNVERIFIED contact is still refused, even though the transport would succeed", async () => {
    const m = await makeMethod({ value: "tg-sbx-unverified@example.invalid", verified: false, optInStatus: "Opted In" });
    const step = await notifyStep({ methodId: m.id, subject: "TG", body: "TG sandbox unverified body long enough." });
    assert.equal(step.status, "failed");
    assert.match(String(step.detail), /verif/i);
  });

  test("a contact that has NOT opted in is still refused, even though the transport would succeed", async () => {
    const m = await makeMethod({ value: "tg-sbx-nooptin@example.invalid", verified: true, optInStatus: "Pending" });
    const step = await notifyStep({ methodId: m.id, subject: "TG", body: "TG sandbox opt-in body long enough." });
    assert.equal(step.status, "failed");
    assert.match(String(step.detail), /opted in/i);
  });

  test("with every registry gate satisfied, the sandboxed Google account actually delivers and records the effect", async () => {
    const m = await makeMethod({ value: "tg-sbx-ready@example.invalid", verified: true, optInStatus: "Opted In" });
    const step = await notifyStep({ methodId: m.id, subject: "TG sandbox briefing", body: "TG sandbox all-gates-pass body long enough." });
    assert.equal(step.status, "succeeded", "with a sandbox Google account connected, this must now actually deliver — not park on 'connect Google'");
    assert.equal(step.result?.delivered, true);
    assert.equal(step.result?.channel, "email");
    const effects = readStoreDoc(ctx, "sandbox_effects.json", []);
    const mine = effects.filter((e) => e.recipient === "tg-sbx-ready@example.invalid");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].subject, "TG sandbox briefing");
  });
});
