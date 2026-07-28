// A nest's approval rules are its own — and the PIN is the pause.
//
// Cluster W: "If there's nests, then both nest members will have access to this for their
// particular nest, and these will not apply to anybody outside of their nest. They don't
// apply family-wide." And: "The advanced mode should come with a warning… possibly a pin
// input. And the same here on the advanced builders — this should require a pin input."
//
// The trap this pins: risk overrides used to key on household:tool, so ONE id existed per
// tool for the whole family. Scoping them per nest changes the id shape, and every reader
// (run steps, planner, agent policy) looks them up by that id — so a scoped write with an
// unscoped read would silently disable every override in the app. The legacy id is still
// read for exactly that reason.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { startServer, stopServer, makeSession, writeStoreDoc, readStoreDoc } from "./harness.mjs";

/* Resolve an override the way the RUN ENGINE does, in a fresh process against the same data
 * dir. Importing store.mjs in the test process gets a different engine instance than the
 * spawned server — it would answer from its own snapshot and pass or fail for reasons that
 * have nothing to do with the code under test. */
function effectiveOverride(dataDir, householdId, toolId, actorId) {
  const url = new URL("../store.mjs", import.meta.url).href;
  const script = `import { getRiskOverride, runWithTenant } from ${JSON.stringify(url)};`
    + `const out = await runWithTenant(${JSON.stringify(householdId)}, () => getRiskOverride(${JSON.stringify(householdId)}, ${JSON.stringify(toolId)}, ${JSON.stringify(actorId)}));`
    + `console.log(JSON.stringify(out));`;
  const res = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, HOMEOPS_DATA_DIR: dataDir, NODE_TEST_CONTEXT: "" },
    encoding: "utf8",
  });
  return JSON.parse(res.trim().split(/[\r\n]+/).pop());
}

const TOOL = "gmail.modifyLabels";   // a real, approval-gated tool (see risk-overrides.test.mjs)
let ctx, owner, adult, outsider;

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");        // Owner, no nest
  adult = await makeSession(ctx, "m-morgan");      // Adult Admin, will nest
  const made = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Sam", role: "Adult Admin", relationship: "parent" }) });
  outsider = await makeSession(ctx, made.data.member.actorId);
  // Morgan + Sam form a nest; Sam accepts.
  const nest = await adult.req("/api/nests", { method: "POST", body: JSON.stringify({ name: "The pair", inviteActorIds: [outsider.actorId] }) });
  await outsider.req(`/api/nests/${nest.data.nest.id}/accept`, { method: "POST", body: "{}" });
});
after(async () => { await stopServer(ctx); });

const setOverride = (as, body) => as.req("/api/risk-overrides", { method: "PUT", body: JSON.stringify({ toolId: TOOL, ...body }) });

test("with no household PIN set, the switch still works — a family can't be locked out", async () => {
  const r = await setOverride(adult, { riskClass: "Low", skipApproval: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.override.scope, `nest:${(await adult.req("/api/nests")).data.nests[0].id}`,
    "an override set from inside a nest belongs to that nest");
});

test("THE SCOPE: the nest's rule is invisible to someone outside it", async () => {
  const theirs = (await owner.req("/api/risk-overrides")).data.overrides;
  assert.ok(!theirs.some((o) => o.toolId === TOOL), "the Owner is not in that nest — its rules are none of their business");
  const mine = (await adult.req("/api/risk-overrides")).data.overrides;
  assert.ok(mine.some((o) => o.toolId === TOOL), "…while both nest members see it");
  const theirPartner = (await outsider.req("/api/risk-overrides")).data.overrides;
  assert.ok(theirPartner.some((o) => o.toolId === TOOL), "both, not just the one who set it");
});

test("a household rule reaches everyone who has no nest rule of their own", async () => {
  const r = await setOverride(owner, { riskClass: "High", skipApproval: false });
  assert.equal(r.status, 200);
  assert.equal(r.data.override.scope, "household", "the Owner has no nest — their rule is the household's");
  const ownerSees = (await owner.req("/api/risk-overrides")).data.overrides.filter((o) => o.toolId === TOOL);
  assert.equal(ownerSees.length, 1);
  assert.equal(ownerSees[0].riskClass, "High");
});

test("a nest may TIGHTEN but not waive what the household required", async () => {
  // The household just set skipApproval:false. The nest's earlier rule said true.
  // Letting a nest waive a family-wide gate would make the household setting decorative.
  const hh = owner.raw?.session?.householdId;
  const effective = effectiveOverride(ctx.dataDir, hh, TOOL, adult.actorId);
  assert.equal(effective.skipApproval, false, "the household's gate stands; the nest can only be stricter");
});

test("PIN GATE: once a household PIN exists, changing a risk rule requires it", async () => {
  const set = await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ ownerPin: "4821" }) });
  assert.equal(set.status, 200, JSON.stringify(set.data));

  const naked = await setOverride(owner, { riskClass: "Low", skipApproval: true });
  assert.equal(naked.status, 403);
  assert.equal(naked.data.error, "pin_required");

  const wrong = await setOverride(owner, { riskClass: "Low", skipApproval: true, pin: "0000" });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.data.error, "pin_incorrect");
  assert.match(wrong.data.message, /Nothing was changed/, "a refused PIN must say nothing moved");

  const right = await setOverride(owner, { riskClass: "Low", skipApproval: true, pin: "4821" });
  assert.equal(right.status, 200);
});

test("…and so does flipping the switches that let things run without asking", async () => {
  const naked = await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ calendarAutoSync: true }) });
  assert.equal(naked.status, 403);
  assert.equal(naked.data.error, "pin_required");
  const ok = await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ calendarAutoSync: true, pin: "4821" }) });
  assert.equal(ok.status, 200);
});

test("a harmless setting is NOT gated — the pause is for danger, not for everything", async () => {
  const r = await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ timezone: "America/New_York" }) });
  assert.equal(r.status, 200, "asking for a PIN to set a timezone teaches people to type it without reading");
});

test("REGRESSION: an override written before scoping is still honoured", async () => {
  // The whole app reads overrides by id. A scoped write with an unscoped read would have
  // silently disabled every pre-existing rule — failing safe, but looking broken.
  const hh = owner.raw?.session?.householdId;
  const all = readStoreDoc(ctx, "risk_overrides.json", {});
  all[`${hh}:legacy.tool`] = { id: `${hh}:legacy.tool`, householdId: hh, toolId: "legacy.tool", riskClass: "Sensitive", skipApproval: false };
  writeStoreDoc(ctx, "risk_overrides.json", all);
  const found = effectiveOverride(ctx.dataDir, hh, "legacy.tool", owner.actorId);
  assert.ok(found, "the two-part legacy id must still resolve");
  assert.equal(found.riskClass, "Sensitive");
});
