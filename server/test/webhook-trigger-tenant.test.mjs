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
//
// WHAT A TRIGGER POINTS AT NOW. There is one target shape left: `{kind:"helper", helperId}`
// (sanitizeTarget still reads `agentId`, because helpers live in the agents collection and
// older rows spell it that way). A fire no longer starts a plan for a model to invent — it
// runs the helper through the same tool loop a chat message uses, and finishes inside the
// call. So this suite now points a real fake model at the FAMILY'S household, which makes the
// tenancy claim stronger than it was: the delivery is proved to have run their helper, in
// their household, with their model configuration.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { useFakeModel } from "./fake-model.mjs";

let ctx, resident, family, fake;
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

let triggerId, helperId;

before(async () => {
  ctx = await startServer();
  resident = await makeSession(ctx, "m-alex");
  family = await signup(`wh-${Date.now()}@example.test`, "The Okonkwo Family");
  // The fake model is configured in the FAMILY'S household, not the resident one — so a fire
  // that reached the wrong tenant would find no provider and fail, which is the point.
  fake = await useFakeModel(family);

  // A real target, so "did it fire" means "did it run the helper" rather than "did it log a
  // line". A helper needs instructions — that IS the helper — or runHelper refuses it.
  const helper = await family.req("/api/helpers", {
    method: "POST",
    body: JSON.stringify({
      name: "Doorbell handler",
      instructions: "When the doorbell rings, note who called and add a task to follow it up if nobody was home.",
    }),
  });
  assert.equal(helper.status, 200, JSON.stringify(helper.data));
  helperId = helper.data.helper.id;

  const t = await family.req("/api/triggers", {
    method: "POST",
    body: JSON.stringify({
      name: "Doorbell", type: "webhook", enabled: true, secret: SECRET,
      target: { kind: "helper", helperId },
    }),
  });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  triggerId = t.data.trigger.id;
});
after(async () => { await stopServer(ctx); await new Promise((r) => fake.server.close(r)); });

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
  /* Stronger than it used to be. A goal-driven agent target had to be planned by a model that
   * no test run had, so the old assertion could only reach for `fireCount` — the counter
   * written before the planning even started. A helper run finishes INSIDE the fire, so the
   * trigger row now carries the real outcome the instant the delivery returns, and the
   * helper's own record says what it did. Both are read back from the FAMILY'S session,
   * which is precisely the claim under test. */
  const before = (await family.req(`/api/triggers/${triggerId}`)).data.trigger;
  const r = await deliver(triggerId, { pressed: "again" });
  assert.equal(r.status, 200);

  const after = (await family.req(`/api/triggers/${triggerId}`)).data.trigger;
  assert.equal(after.fireCount, (before.fireCount ?? 0) + 1, "their trigger fired");
  assert.ok(after.lastFiredAt, "and recorded when");
  assert.equal(after.lastTriggerType, "webhook");
  assert.equal(after.lastStatus, "completed", "the helper really ran, in their household, on their model");

  const helper = (await family.req(`/api/helpers/${helperId}`)).data.helper;
  assert.equal(helper.lastRun.ok, true);
  assert.equal(helper.lastRun.reason, "webhook", "and the helper's own record says what woke it");

  // What arrived is handed to the helper, not thrown away: the thread is the record of it.
  const hist = (await family.req(`/api/helpers/${helperId}/history`)).data.messages;
  assert.match(hist.at(-2).text, /Something came in/);
  assert.match(hist.at(-2).text, /again/, "the payload reaches the helper that was woken for it");
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
