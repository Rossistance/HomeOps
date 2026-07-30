// The strongest grant in the product had the weakest gate.
//
// `requireHouseholdPin` guarded two things: re-classing a single tool, and the three
// household "runs unsupervised" settings. It did NOT guard the agents write — so turning ONE
// tool from High to Low demanded the household PIN, while `unattended.includeHighRisk`
// ("emails, texts and payments go out without asking", across every capability that helper
// can reach) needed only an Adult Admin session. A teenager promoted to Adult Admin, or
// anyone at a signed-in laptop, could grant blanket send authority with two taps and no PIN,
// and would have hit a PIN wall doing something far smaller.
//
// These tests hold three lines at once, and the third is the one that bites: a gate that
// leaks the credential it collects is worse than no gate, because now the secret is in a
// record that every member can read.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

const POLICY = { autoAllow: [], alwaysApprove: [] };
const raise = (as, id, extra = {}) => as.req(`/api/agents/${id}`, {
  method: "PATCH",
  body: JSON.stringify({ approvalPolicy: { ...POLICY, unattended: { enabled: true, includeHighRisk: true } }, ...extra }),
});
const readAgent = async (as, id) => (await as.req(`/api/agents/${id}`)).data.agent;

let ctx, owner, agentId;

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");   // Owner
  agentId = (await owner.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "Errand runner" }) })).data.agent.id;
});
after(async () => { await stopServer(ctx); });

test("with no household PIN set, the grant still works — a family can't be locked out of its own product", async () => {
  const r = await raise(owner, agentId);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.agent.approvalPolicy.unattended.includeHighRisk, true);
});

test("once a PIN exists, granting blanket send authority requires it", async () => {
  const set = await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ ownerPin: "7391" }) });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  // Start from revoked so the raise under test is a real change of state.
  const off = await owner.req(`/api/agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ approvalPolicy: { ...POLICY, unattended: { enabled: false } } }) });
  assert.equal(off.status, 200, JSON.stringify(off.data));

  const naked = await raise(owner, agentId);
  assert.equal(naked.status, 403);
  assert.equal(naked.data.error, "pin_required");
  assert.equal((await readAgent(owner, agentId)).approvalPolicy.unattended, undefined,
    "a refused request must not have half-applied the grant");
});

test("a wrong PIN changes nothing, and says so", async () => {
  const wrong = await raise(owner, agentId, { pin: "0000" });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.data.error, "pin_incorrect");
  assert.match(wrong.data.message, /Nothing was changed/);
  assert.equal((await readAgent(owner, agentId)).approvalPolicy.unattended, undefined);
});

test("the right PIN grants it", async () => {
  const ok = await raise(owner, agentId, { pin: "7391" });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.agent.approvalPolicy.unattended.includeHighRisk, true);
  assert.equal(ok.data.agent.approvalPolicy.unattended.setByRole, "Owner", "still attributed to a real session");
});

test("THE ASYMMETRY: turning it back OFF needs no PIN", async () => {
  // Deliberate, and the same shape the rest of policy.mjs runs on. Making someone prove
  // themselves in order to become MORE careful is how you teach them to leave it on — and in
  // an emergency the revoke must never be the thing that's locked.
  const off = await owner.req(`/api/agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ approvalPolicy: { ...POLICY, unattended: { enabled: false } } }) });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(off.data.agent.approvalPolicy.unattended, undefined);
});

test("the low-risk tier is not gated either — the pause is for danger, not for everything", async () => {
  const r = await owner.req(`/api/agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ approvalPolicy: { ...POLICY, unattended: { enabled: true } } }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.agent.approvalPolicy.unattended.enabled, true);
  assert.equal(r.data.agent.approvalPolicy.unattended.includeHighRisk, false);
});

test("THE LEAK: the PIN is consumed by the check and never stored on the agent", async () => {
  // partialUpdateAgent spreads the patch verbatim over the existing record, and publicAgent
  // returns every field with the comment "all fields non-secret". Without an explicit strip,
  // adding this gate would have written the household PIN onto the agent in plaintext — and
  // handed it back to anyone who can list helpers, which is every member.
  const ok = await raise(owner, agentId, { pin: "7391" });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.agent.pin, undefined, "the response must not echo it back");

  const stored = await readAgent(owner, agentId);
  assert.equal(stored.pin, undefined, "and it must not have been persisted");
  assert.ok(!JSON.stringify(stored).includes("7391"), "not under any key, anywhere in the record");

  const listed = (await owner.req("/api/agents")).data.agents;
  assert.ok(!JSON.stringify(listed).includes("7391"), "and the list every member can read stays clean");
});
