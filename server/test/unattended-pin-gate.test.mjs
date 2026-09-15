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
// WHERE THE GATE LIVES NOW. `approvalPolicy.unattended` is no longer something a family
// assembles: a helper has ONE autonomy dial with three settings, and `full` — "does
// everything on its own, including sending and spending" — is that same grant under a name a
// person can read. So the gate moved with it, onto `autonomy: "full"` at POST /api/helpers
// and PATCH /api/helpers/:id. Every line below is the line it always was; only the spelling
// of the request changed.
//
// These tests hold three at once, and the third is the one that bites: a gate that leaks the
// credential it collects is worse than no gate, because now the secret is in a record that
// every member can read.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, readStoreDoc } from "./harness.mjs";

/** Ask for the top tier. `extra` carries the PIN when a test is supplying one. */
const raise = (as, id, extra = {}) => as.req(`/api/helpers/${id}`, {
  method: "PATCH",
  body: JSON.stringify({ autonomy: "full", ...extra }),
});
const readHelper = async (as, id) => (await as.req(`/api/helpers/${id}`)).data.helper;
const storedHelper = (id) => readStoreDoc(ctx, "agents.json", {})[id];

let ctx, owner, helperId;

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");   // Owner
  const made = await owner.req("/api/helpers", {
    method: "POST",
    body: JSON.stringify({
      name: "Errand runner",
      instructions: "Run the family's errands: order whatever is on the list and confirm the deliveries.",
    }),
  });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  helperId = made.data.helper.id;
});
after(async () => { await stopServer(ctx); });

test("with no household PIN set, the grant still works — a family can't be locked out of its own product", async () => {
  const r = await raise(owner, helperId);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.helper.autonomy, "full");
  // The dial IS the old flag, said out loud — so what is being gated is unmistakable.
  assert.equal(r.data.helper.autonomyText, "Does everything on its own, including sending and spending");
  assert.equal(storedHelper(helperId).approvalPolicy.unattended.includeHighRisk, true);
});

test("once a PIN exists, granting blanket send authority requires it", async () => {
  const set = await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ ownerPin: "7391" }) });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  // Start from the middle tier so the raise under test is a real change of state.
  const off = await owner.req(`/api/helpers/${helperId}`, { method: "PATCH", body: JSON.stringify({ autonomy: "act" }) });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(off.data.helper.autonomy, "act");

  const naked = await raise(owner, helperId);
  assert.equal(naked.status, 403);
  assert.equal(naked.data.error, "pin_required");
  assert.equal((await readHelper(owner, helperId)).autonomy, "act",
    "a refused request must not have half-applied the grant");
});

test("a wrong PIN changes nothing, and says so", async () => {
  const wrong = await raise(owner, helperId, { pin: "0000" });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.data.error, "pin_incorrect");
  assert.match(wrong.data.message, /Nothing was changed/);
  assert.equal((await readHelper(owner, helperId)).autonomy, "act");
});

test("the right PIN grants it", async () => {
  const ok = await raise(owner, helperId, { pin: "7391" });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.helper.autonomy, "full");
  // policy.mjs rule 6b honours the top tier only when setByRole names a real Owner or Adult
  // Admin, so the stored record still has to carry that attribution from a real session.
  const un = storedHelper(helperId).approvalPolicy.unattended;
  assert.equal(un.includeHighRisk, true);
  assert.equal(un.setByRole, "Owner", "still attributed to a real session");
});

test("THE ASYMMETRY: turning it back DOWN needs no PIN", async () => {
  // Deliberate, and the same shape the rest of policy.mjs runs on. Making someone prove
  // themselves in order to become MORE careful is how you teach them to leave it on — and in
  // an emergency the revoke must never be the thing that's locked.
  const down = await owner.req(`/api/helpers/${helperId}`, { method: "PATCH", body: JSON.stringify({ autonomy: "ask" }) });
  assert.equal(down.status, 200, JSON.stringify(down.data));
  assert.equal(down.data.helper.autonomy, "ask");
  assert.equal(storedHelper(helperId).approvalPolicy.unattended, undefined,
    "a revoked grant must not linger in the record");
});

test("the low tier is not gated either — the pause is for danger, not for everything", async () => {
  const r = await owner.req(`/api/helpers/${helperId}`, { method: "PATCH", body: JSON.stringify({ autonomy: "act" }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.helper.autonomy, "act");
  const un = storedHelper(helperId).approvalPolicy.unattended;
  assert.equal(un.enabled, true);
  assert.equal(un.includeHighRisk, false);
});

test("the same gate stands at CREATE — a new helper can't be born holding the grant either", async () => {
  // Both doors reach the same field. Gating only the edit would make "make a new one" the
  // way around it, which is not a gate, it is a speed bump.
  const naked = await owner.req("/api/helpers", {
    method: "POST",
    body: JSON.stringify({ name: "Born loose", instructions: "Pay whatever arrives without asking anyone first.", autonomy: "full" }),
  });
  assert.equal(naked.status, 403);
  assert.equal(naked.data.error, "pin_required");
  assert.equal((await owner.req("/api/helpers")).data.helpers.some((h) => h.name === "Born loose"), false,
    "and the refused helper was never created");

  const withPin = await owner.req("/api/helpers", {
    method: "POST",
    body: JSON.stringify({ name: "Born loose", instructions: "Pay whatever arrives without asking anyone first.", autonomy: "full", pin: "7391" }),
  });
  assert.equal(withPin.status, 200, JSON.stringify(withPin.data));
  assert.equal(withPin.data.helper.autonomy, "full");
});

test("THE LEAK: the PIN is consumed by the check and never stored on the helper", async () => {
  // updateHelper spreads the patch over the existing record, and publicHelper hands that row
  // to anyone who can list helpers — which is every member, down to a Child View. Without an
  // explicit strip, adding this gate would have written the household PIN onto the helper in
  // plaintext and then published it.
  const ok = await raise(owner, helperId, { pin: "7391" });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.helper.pin, undefined, "the response must not echo it back");

  const stored = storedHelper(helperId);
  assert.equal(stored.pin, undefined, "and it must not have been persisted");
  assert.ok(!JSON.stringify(stored).includes("7391"), "not under any key, anywhere in the record");

  const listed = (await owner.req("/api/helpers")).data.helpers;
  assert.ok(!JSON.stringify(listed).includes("7391"), "and the list every member can read stays clean");

  // The read by the member with the least standing to see it is the one that matters most.
  const child = await makeSession(ctx, "m-lily");
  const theirs = await child.req("/api/helpers");
  assert.equal(theirs.status, 200);
  assert.ok(!JSON.stringify(theirs.data).includes("7391"), "including for a Child View session");
});
