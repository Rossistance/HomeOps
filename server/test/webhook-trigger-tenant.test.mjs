// A signed-up family's webhook trigger never fired.
//
// Every store call in the receiver — getTrigger, getTriggerSecret, getSecret, addWebhookEvent,
// seenWebhookNonce, audit, fireWebhookTrigger — follows the ambient tenant context, and an
// inbound webhook has none. So all of them read the RESIDENT household. A trigger registered by
// any other family was invisible: its signing secret was never found, and in production the
// delivery came back `signing_secret_required` for want of a secret that existed the whole
// time, one household over.
//
// The only evidence anywhere was a 401 at the far end, in somebody else's system.
//
// A trigger id is unique across the deployment, so — unlike an inbound text — it identifies its
// household on its own. There was no ambiguity to resolve, just a lookup nobody was doing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, resident, family;
const SECRET = "s3cret-from-the-other-household";

async function signup(email, householdName) {
  const res = await ctx.fetch("/api/signup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery", ownerName: "Sam", householdName }),
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  const data = await res.json();
  return {
    householdId: data.session?.householdId,
    async req(path, init = {}) {
      const headers = { Cookie: cookie, ...(init.headers || {}) };
      if (init.method && init.method !== "GET") { headers["x-homeops-csrf"] = data.session.csrf; headers["content-type"] ??= "application/json"; }
      const r = await ctx.fetch(path, { ...init, headers });
      let out = null; try { out = await r.json(); } catch { /* non-JSON */ }
      return { status: r.status, data: out };
    },
  };
}

/** Deliver a signed webhook exactly the way an external service would. */
async function deliver(id, payload, { secret = SECRET, nonce } = {}) {
  const raw = JSON.stringify(payload);
  const headers = { "content-type": "application/json" };
  if (secret) {
    headers["x-homeops-signature"] = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    headers["x-homeops-timestamp"] = String(Date.now());
    if (nonce) headers["x-homeops-nonce"] = nonce;
  }
  const r = await ctx.fetch(`/api/webhooks/${id}`, { method: "POST", headers, body: raw });
  let out = null; try { out = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, data: out };
}

let triggerId;

before(async () => {
  ctx = await startServer();
  resident = await makeSession(ctx, "m-alex");
  family = await signup(`wh-${Date.now()}@example.test`, "The Okonkwo Family");
  // A real target, so "did it fire" means "did it start a run" rather than "did it log a line".
  const agent = await family.req("/api/agents", { method: "POST", body: JSON.stringify({ name: "Doorbell handler", status: "Active" }) });
  assert.equal(agent.status, 200, JSON.stringify(agent.data));
  const t = await family.req("/api/triggers", {
    method: "POST",
    body: JSON.stringify({
      name: "Doorbell", type: "webhook", enabled: true, secret: SECRET,
      // An agent target needs a skill or a goal — with neither, fireTrigger correctly refuses
      // as `unrunnable_target` rather than starting an empty run. A goal is the lighter of the
      // two here, and it is what a chat-built automation carries anyway.
      target: { kind: "agent", agentId: agent.data.agent.id, goal: "Note that the doorbell rang" },
    }),
  });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  triggerId = t.data.trigger.id;
});
after(async () => { await stopServer(ctx); });

test("the trigger belongs to the signed-up family, not the resident household", async () => {
  assert.match(triggerId, /^trg_/);
  assert.notEqual(family.householdId, "local");
  const theirs = (await family.req("/api/triggers")).data.triggers ?? [];
  assert.ok(theirs.some((t) => t.id === triggerId), "they can see it");
  const residentSees = (await resident.req("/api/triggers")).data.triggers ?? [];
  assert.ok(!residentSees.some((t) => t.id === triggerId), "and the resident household cannot");
});

test("THE FIX: a correctly signed delivery is accepted and verified", async () => {
  // Before the tenant lookup, getTriggerSecret(id) ran in the resident household, found
  // nothing, fell through to the resident webhook connector's secret — and in development
  // accepted the delivery as UNVERIFIED, while production rejected it outright. Either way the
  // family's own signature was never the thing being checked.
  const r = await deliver(triggerId, { pressed: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.verified, true, "their secret was found and their signature checked");
});

test("…and it actually fires THEIR trigger, which is the whole point", async () => {
  // Asserted on the trigger record rather than on a returned runId: a goal-driven agent target
  // has to be planned by a model, and there is no AI provider configured in a test run, so the
  // run legitimately doesn't start here. `fireCount` and `lastFiredAt` are written by
  // fireTriggerInner before any of that and are read back from the FAMILY'S session, which is
  // precisely the claim under test — the delivery reached and fired their trigger, in their
  // household. A runId assertion would have been testing the AI config, not the routing.
  const before = (await family.req(`/api/triggers/${triggerId}`)).data.trigger;
  const r = await deliver(triggerId, { pressed: "again" });
  assert.equal(r.status, 200);
  const after = (await family.req(`/api/triggers/${triggerId}`)).data.trigger;
  assert.equal(after.fireCount, (before.fireCount ?? 0) + 1, "their trigger fired");
  assert.ok(after.lastFiredAt, "and recorded when");
  assert.equal(after.lastTriggerType, "webhook");
});

test("a WRONG signature is refused — routing to the right household didn't weaken the check", async () => {
  const r = await deliver(triggerId, { pressed: true }, { secret: "not-the-secret" });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, "signature_failed");
});

test("the event lands in the OWNING household's log, and nobody else's", async () => {
  await deliver(triggerId, { marker: "for-okonkwo" });
  // The history read is session-gated, so each request answers from its OWN household — which
  // is exactly the comparison this needs.
  const theirs = JSON.stringify((await family.req(`/api/webhooks/${triggerId}`)).data ?? {});
  const residentEvents = JSON.stringify((await resident.req(`/api/webhooks/${triggerId}`)).data ?? {});
  assert.match(theirs, /for-okonkwo/, "the family that owns the trigger has the event");
  assert.ok(!/for-okonkwo/.test(residentEvents), "and it is not sitting in the resident household's log");
});

test("a replay nonce is caught within the owning household", async () => {
  const nonce = `n-${Date.now()}`;
  const first = await deliver(triggerId, { n: 1 }, { nonce });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const second = await deliver(triggerId, { n: 1 }, { nonce });
  assert.equal(second.status, 409);
  assert.equal(second.data.error, "replay_detected");
});

test("an unknown id is still handled by the shared connector path, unchanged", async () => {
  // The generic endpoint connectors.mjs publishes is the fixed path /api/webhooks/webhook —
  // no household anywhere in the URL, so there is nothing to route on. It keeps its existing
  // resident behaviour rather than having a tenant invented for it.
  const r = await deliver("wh_nothing_here", { hello: "world" }, { secret: null });
  assert.equal(r.status, 200, "development accepts it unsigned…");
  assert.equal(r.data.verified, false, "…and says plainly that it is unverified");
});
