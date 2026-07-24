// WP-105 / ISS-124: "Six executed, six permitted. Okay, five permitted. That doesn't
// make any sense."
//
// The arithmetic was never wrong — the SCREEN was. Every count comes from one
// agentContext computation, but "permitted" means allowed BY POLICY, and with an open
// allow-list that is every capability except the denied ones. So the number legitimately
// falls the moment a family starts listing tools explicitly, while the rows next to it
// render explicit-vs-inherited state. Two different notions of "permitted", one screen.
//
// These lock the invariants the UI now labels, so the three counts can never drift apart
// again: they are derived from the same sets, and executable is exactly their overlap.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, agentId;

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
  const created = await owner.req("/api/agents", {
    method: "POST",
    body: JSON.stringify({ name: "Counts Agent", instructions: "counts" }),
  });
  agentId = created.data.agent?.id;
  assert.ok(agentId, "agent created");
});
after(async () => { await stopServer(ctx); });

const context = async () => (await owner.req(`/api/agents/${agentId}/context`)).data.context;

test("ISS-124: all three counts derive from the SAME tool/function sets", async () => {
  const c = await context();
  const all = [...c.tools, ...c.functions];

  assert.equal(c.availableCount, all.filter((x) => x.available).length, "available = could run now");
  assert.equal(c.permittedCount, all.filter((x) => x.permitted).length, "permitted = allowed by policy");
  assert.equal(c.executableCount, all.filter((x) => x.permitted && x.available).length, "executable = the overlap");
});

test("ISS-124: executable can never exceed either set it is the overlap of", async () => {
  const c = await context();
  assert.ok(c.executableCount <= c.permittedCount, `${c.executableCount} executable > ${c.permittedCount} permitted`);
  assert.ok(c.executableCount <= c.availableCount, `${c.executableCount} executable > ${c.availableCount} available`);
});

test("ISS-124: an OPEN allow-list permits everything not denied — that is why the number is high", async () => {
  const c = await context();
  assert.equal(c.openAllowList, true, "a fresh agent starts deny-only");
  const all = [...c.tools, ...c.functions];
  assert.equal(c.permittedCount, all.filter((x) => !x.denied).length, "open list ⇒ permitted is everything undenied");
});

test("ISS-124: switching to an EXPLICIT allow-list lowers the count for a stateable reason", async () => {
  const before = await context();
  const pick = before.tools.find((t) => !t.denied);
  assert.ok(pick, "there is a tool to allow");

  const r = await owner.req(`/api/agents/${agentId}`, {
    method: "PATCH", body: JSON.stringify({ allowedToolIds: [pick.toolId] }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const after = await context();
  assert.equal(after.openAllowList, false, "not BOTH lists are open any more");
  // Allow-lists are PER KIND. Restricting tools leaves functions open, so the honest
  // reading is "1 tool + every function" — not "1 capability". A single openAllowList
  // boolean would have claimed the whole agent was explicit, which is the half-true
  // story this issue is about; the per-kind flags are what the UI labels itself with.
  assert.equal(after.openToolAllowList, false, "tools are now explicit");
  assert.equal(after.openFunctionAllowList, true, "functions were never restricted");
  assert.equal(after.tools.filter((t) => t.permitted).length, 1, "exactly the one tool listed");
  assert.equal(after.functions.filter((f) => f.permitted).length, after.functions.length, "functions stay open");
  assert.ok(after.permittedCount < before.permittedCount, "the drop the reporter saw — correct, and now explained");
  // Still one derivation: the invariant holds in the explicit mode too.
  const all = [...after.tools, ...after.functions];
  assert.equal(after.executableCount, all.filter((x) => x.permitted && x.available).length);
});

test("ISS-124: a denied capability is never counted as permitted", async () => {
  const c0 = await context();
  const victim = c0.tools.find((t) => t.permitted);
  assert.ok(victim, "something is permitted to deny");
  const r = await owner.req(`/api/agents/${agentId}`, {
    method: "PATCH", body: JSON.stringify({ allowedToolIds: [], deniedToolIds: [victim.toolId] }),
  });
  assert.equal(r.status, 200);

  const c = await context();
  const row = [...c.tools, ...c.functions].find((x) => (x.toolId ?? x.id) === victim.toolId);
  assert.equal(row.permitted, false, "denied beats the open default");
  assert.equal(c.permittedCount, [...c.tools, ...c.functions].filter((x) => x.permitted).length);
  assert.ok(!c.executable.includes(victim.toolId), "and it cannot be executable");
});

/* ---- WP-105 / ISS-107: the effective-policy view ----
 * "One effective-policy view states allowed/blocked/needs-approval and names the rule
 * that produced it." Computed in the same agentContext pass as the counts above, so a
 * row and a count can never tell different stories. */

test("ISS-107: every capability carries a decision AND the rule that produced it", async () => {
  const c = await context();
  const all = [...c.tools, ...c.functions];
  assert.ok(all.length > 0, "there are capabilities to describe");
  for (const x of all) {
    assert.ok(x.policy, `${x.toolId ?? x.id} has an effective policy`);
    assert.ok(["allowed", "needs_approval", "blocked"].includes(x.policy.decision), `${x.policy.decision} is one of the three states`);
    assert.ok(x.policy.rule && x.policy.reason, "the rule and a human reason are both named");
  }
});

test("ISS-107: denying a capability shows as blocked, and says why", async () => {
  const c0 = await context();
  const victim = c0.tools.find((t) => t.policy.decision !== "blocked");
  assert.ok(victim, "something to deny");
  await owner.req(`/api/agents/${agentId}`, {
    method: "PATCH", body: JSON.stringify({ allowedToolIds: [], deniedToolIds: [victim.toolId] }),
  });
  const c = await context();
  const row = c.tools.find((t) => t.toolId === victim.toolId);
  assert.equal(row.policy.decision, "blocked");
  assert.equal(row.policy.rule, "agent.denied");
  assert.match(row.policy.reason, /denied/i);
});

test("ISS-107: the agent's alwaysApprove list is REFLECTED in the view (it used to be inert)", async () => {
  const c0 = await context();
  const pick = c0.tools.find((t) => !t.denied && t.policy.decision === "allowed");
  assert.ok(pick, "an allowed capability to tighten");
  await owner.req(`/api/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify({ deniedToolIds: [], approvalPolicy: { autoAllow: [], alwaysApprove: [pick.toolId] } }),
  });
  const c = await context();
  const row = c.tools.find((t) => t.toolId === pick.toolId);
  assert.equal(row.policy.decision, "needs_approval", "the toggle a family edits now actually shows up");
  assert.equal(row.policy.rule, "agent.always_approve");
});
