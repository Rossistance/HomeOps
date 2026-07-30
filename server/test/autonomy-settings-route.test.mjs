// Choosing the stance: who may, what it costs, and what is written down.
//
// autonomy-presets.test.mjs holds the RULE. This holds the WRITE — because rule 7 honours
// Trusted only when `autonomySetByRole` names someone with the standing to have chosen it, and
// that claim is worth exactly as much as the route that stamps it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, member;
const settings = (as) => as.req("/api/settings");
const setStance = (as, autonomy, extra = {}) => as.req("/api/settings", { method: "POST", body: JSON.stringify({ autonomy, ...extra }) });

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");    // Owner
  const made = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Jamie", role: "Adult Admin", relationship: "parent" }) });
  member = await makeSession(ctx, made.data.member.actorId);
});
after(async () => { await stopServer(ctx); });

test("a household nobody has answered for reports Cautious, and says nobody answered", async () => {
  const r = await settings(owner);
  assert.equal(r.data.settings.autonomy, "Cautious");
  assert.equal(r.data.settings.autonomyDefaulted, true,
    "so onboarding can ask, instead of showing a setting that looks deliberate and isn't");
});

test("Balanced needs no PIN — it cannot reach anything that leaves the house", async () => {
  const r = await setStance(owner, "Balanced");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = (await settings(owner)).data.settings;
  assert.equal(s.autonomy, "Balanced");
  assert.equal(s.autonomyDefaulted, false, "now someone HAS answered");
});

test("the WRITE answers with the same shape as the read", async () => {
  // Caught live, not in review: the GET and the POST were two hand-maintained copies of one
  // object literal, and adding `autonomy` to only one meant a client that trusted the write
  // response — as clients should — rendered the OLD stance immediately after successfully
  // changing it. Saved, and the screen said otherwise. One projection now serves both.
  // Re-asserts the stance already in place, so this check doesn't move state the tests below
  // depend on.
  const posted = (await setStance(owner, "Balanced")).data.settings;
  const got = (await settings(owner)).data.settings;
  assert.deepEqual(Object.keys(posted).sort(), Object.keys(got).sort(),
    "a response a client renders from must not be a smaller object than the one it polls");
  assert.equal(posted.autonomy, got.autonomy);
});

test("a nonsense stance is refused rather than stored", async () => {
  const r = await setStance(owner, "Whatever");
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "invalid_autonomy");
  assert.equal((await settings(owner)).data.settings.autonomy, "Balanced", "and the real one is untouched");
});

test("raising to Trusted asks for the household PIN", async () => {
  const set = await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ ownerPin: "5150" }) });
  assert.equal(set.status, 200, JSON.stringify(set.data));

  const naked = await setStance(owner, "Trusted");
  assert.equal(naked.status, 403);
  assert.equal(naked.data.error, "pin_required");
  assert.equal((await settings(owner)).data.settings.autonomy, "Balanced", "a refused request changes nothing");

  const wrong = await setStance(owner, "Trusted", { pin: "0000" });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.data.error, "pin_incorrect");

  const ok = await setStance(owner, "Trusted", { pin: "5150" });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const s = (await settings(owner)).data.settings;
  assert.equal(s.autonomy, "Trusted");
  assert.equal(s.autonomySetByRole, "Owner", "and rule 7 has the attribution it requires");
  assert.ok(s.autonomySetAt, "and when");
});

test("THE ASYMMETRY: coming back DOWN needs no PIN", async () => {
  // The careful direction is never the locked one. In a moment where a family wants to pull
  // everything back, a forgotten PIN must not be what stands between them and doing it.
  const r = await setStance(owner, "Cautious");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await settings(owner)).data.settings.autonomy, "Cautious");
});

test("the attribution is dropped when the stance leaves Trusted", async () => {
  const s = (await settings(owner)).data.settings;
  assert.equal(s.autonomySetByRole, null,
    "a stale \"an Owner allowed this\" must not survive the thing it was allowing");
});

test("FORGERY: the body cannot claim who chose it", async () => {
  const r = await member.req("/api/settings", { method: "POST", body: JSON.stringify({ autonomy: "Trusted", autonomySetByRole: "Owner", autonomySetBy: "m-alex", pin: "5150" }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = (await settings(owner)).data.settings;
  assert.equal(s.autonomySetByRole, "Adult Admin", "the record names the role of whoever ACTUALLY did it");
});

test("a Limited Member cannot set the household's stance at all", async () => {
  const made = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Kit", role: "Limited Member", relationship: "child" }) });
  const kid = await makeSession(ctx, made.data.member.actorId);
  const r = await setStance(kid, "Trusted", { pin: "5150" });
  assert.ok(r.status === 403 || r.status === 401, `expected a refusal, got ${r.status}`);
});
