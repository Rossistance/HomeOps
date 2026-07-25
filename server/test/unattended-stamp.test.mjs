// The unattended override is only as safe as its ATTRIBUTION.
//
// policy.mjs will let a helper send unattended when `approvalPolicy.unattended.setByRole`
// says an Owner or Adult Admin chose that. Which means the whole bound rests on one claim:
// that setByRole was written by the server from a real session, and never accepted from a
// request body. These tests hold that line at the write path — the same class of hole as the
// `sourceRef.agentId` forgery the run route already strips.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-unattended-"));
const { createAgent, partialUpdateAgent, replaceAgent, agentContext } = await import("../agents.mjs");
const { runWithTenant } = await import("../store.mjs");

const HH = "local";
const owner = { householdId: HH, actorId: "m-owner", role: "Owner" };
const kid = { householdId: HH, actorId: "m-kid", role: "Limited Member" };
const T = (fn) => runWithTenant(HH, fn);

let id;
before(async () => {
  await T(async () => { id = createAgent({ name: "Inbox triage" }, owner).id; });
});
after(() => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {} });

const turnOn = (patch, session) => T(() => partialUpdateAgent(id, { approvalPolicy: { autoAllow: [], alwaysApprove: [], ...patch } }, session));

test("an Owner turning it on gets the high-risk tier, attributed to them", async () => {
  const a = await turnOn({ unattended: { enabled: true, includeHighRisk: true } }, owner);
  assert.equal(a.approvalPolicy.unattended.enabled, true);
  assert.equal(a.approvalPolicy.unattended.includeHighRisk, true);
  assert.equal(a.approvalPolicy.unattended.setByRole, "Owner");
  assert.equal(a.approvalPolicy.unattended.setBy, "m-owner");
  assert.ok(a.approvalPolicy.unattended.setAt, "when it was granted is recorded");
});

test("FORGERY: a body claiming setByRole:\"Owner\" is overwritten by the real session", async () => {
  const a = await turnOn({ unattended: { enabled: true, includeHighRisk: true, setByRole: "Owner", setBy: "m-owner" } }, kid);
  assert.equal(a.approvalPolicy.unattended.setByRole, null, "the claim is discarded, not trusted");
  assert.equal(a.approvalPolicy.unattended.includeHighRisk, false, "and the tier it was claiming is refused");
  assert.equal(a.approvalPolicy.unattended.setBy, "m-kid", "the record names who ACTUALLY did it");
});

test("FORGERY: no session at all cannot raise the tier either", async () => {
  // The repair path, migrations, and internal edits reach partialUpdateAgent with no session.
  const a = await turnOn({ unattended: { enabled: true, includeHighRisk: true, setByRole: "Owner" } }, null);
  assert.equal(a.approvalPolicy.unattended.includeHighRisk, false);
  assert.equal(a.approvalPolicy.unattended.setByRole, null);
});

test("a lower role can still turn on the low-risk tier — that part isn't privileged", async () => {
  const a = await turnOn({ unattended: { enabled: true } }, kid);
  assert.equal(a.approvalPolicy.unattended.enabled, true);
  assert.equal(a.approvalPolicy.unattended.includeHighRisk, false);
});

test("turning it off removes the grant instead of leaving a stale one behind", async () => {
  await turnOn({ unattended: { enabled: true, includeHighRisk: true } }, owner);
  const a = await turnOn({ unattended: { enabled: false } }, owner);
  assert.equal(a.approvalPolicy.unattended, undefined, "a revoked grant must not linger in the record");
});

test("a PATCH that doesn't mention unattended leaves an existing grant alone", async () => {
  await turnOn({ unattended: { enabled: true, includeHighRisk: true } }, owner);
  const a = await T(() => partialUpdateAgent(id, { purpose: "Sort the family inbox" }, owner));
  assert.equal(a.approvalPolicy.unattended?.includeHighRisk, true, "an unrelated edit must not silently revoke it");
  assert.equal(a.purpose, "Sort the family inbox");
});

test("PUT (replaceAgent) is stamped too — not just PATCH", async () => {
  const a = await T(() => replaceAgent(id, {
    name: "Inbox triage", approvalPolicy: { unattended: { enabled: true, includeHighRisk: true, setByRole: "Owner" } },
  }, kid));
  assert.equal(a.approvalPolicy.unattended.includeHighRisk, false);
  assert.equal(a.approvalPolicy.unattended.setByRole, null);
});

test("agentContext reports the grant that ACTUALLY applies, so the UI can't over-promise", async () => {
  const a = await turnOn({ unattended: { enabled: true, includeHighRisk: true, setByRole: "Owner" } }, kid);
  const ctx = await T(() => agentContext(a, kid));
  assert.equal(ctx.unattended.enabled, true);
  assert.equal(ctx.unattended.includeHighRisk, false, "the screen must show the refused tier as refused");
  assert.equal(typeof ctx.runsUnattended, "boolean");
  assert.ok(Array.isArray(ctx.gatedCapabilityNames), "and name the steps that would still stop and wait");
});

test("agentContext names the helper's actual SKILLS — [18:06] \"what IS that skill?\"", async () => {
  const { createSkill } = await import("../skills.mjs");
  const out = await T(async () => {
    const s = createSkill({ name: "Morning briefing", description: "Read the day", steps: [{ step_id: "s1", name: "Read events", tool_id: "homeops.list_events" }] }, owner);
    const withSkill = partialUpdateAgent(id, { skillIds: [s.id] }, owner);
    return agentContext(withSkill, owner);
  });
  assert.equal(out.skills.length, 1);
  assert.equal(out.skills[0].name, "Morning briefing");
  assert.equal(out.skills[0].stepCount, 1);
  assert.deepEqual(out.skills[0].stepNames, ["Read events"]);
});

test("a skill that was deleted is reported as missing, not silently dropped", async () => {
  const out = await T(() => agentContext(partialUpdateAgent(id, { skillIds: ["sk_gone"] }, owner), owner));
  assert.equal(out.skills.length, 1);
  assert.equal(out.skills[0].ready, false);
  assert.match(out.skills[0].name, /Missing/i);
});
