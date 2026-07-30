// The green bolt that meant "not set up yet".
//
// `runsUnattended` counted only capabilities that were permitted AND AVAILABLE. A capability
// that isn't connected can't be counted as a gate — so the gate list came back empty for a
// helper that couldn't run its own job, and the detail screen showed the green bolt with "Runs
// start to finish without you". Connecting the account later flipped the answer, which means
// whichever claim the family read first was wrong.
//
// The reachable shape is the ordinary one. A helper built from chat gets an allow-list DERIVED
// from its skill's steps, so a two-step skill — look something up, then email it — permits
// exactly [web.search, gmail.send]. web.search is connected and needs no approval, so
// something is executable; gmail.send is unconnected, so it cannot appear as a gate. Empty gate
// list + something executable was the entire test for "runs start to finish without you", and
// both halves were true about a helper whose actual purpose could not run at all.
//
// (With the DEFAULT open allow-list this never surfaced, because "permitted" then means the
// whole 56-tool catalogue and the connected internal gating tools keep the list non-empty. So
// the lie was reserved for the helpers a family builds by talking to it.)
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-unattended-honesty-"));
const { createAgent, partialUpdateAgent, agentContext } = await import("../agents.mjs");
const { createSkill } = await import("../skills.mjs");
const { runWithTenant } = await import("../store.mjs");

const HH = "local";
const owner = { householdId: HH, actorId: "m-owner", role: "Owner" };
const T = (fn) => runWithTenant(HH, fn);

after(() => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {} });

/** A helper with one skill over `toolIds`, and the allow-list a chat-built helper would get. */
async function helperWith(name, toolIds) {
  return T(() => {
    const s = createSkill({
      name: `${name} skill`,
      description: "for the honesty test",
      steps: toolIds.map((tid, i) => ({ step_id: `s${i + 1}`, name: `Step ${i + 1}`, tool_id: tid })),
    }, owner);
    const a = createAgent({ name, status: "Active" }, owner);
    return partialUpdateAgent(a.id, { skillIds: [s.id], allowedToolIds: toolIds }, owner);
  });
}

test("THE FALSE BOLT: look-up-then-email is not 'runs start to finish without you'", async () => {
  const a = await helperWith("Mailer", ["web.search", "gmail.send"]);
  const ctx = await T(() => agentContext(a, owner));
  assert.equal(ctx.executableCount > 0, true, "the precondition the old boolean relied on…");
  assert.equal(ctx.gatedCount, 0, "…and the empty gate list that made it look autonomous");
  assert.equal(ctx.runsUnattended, false,
    "the thing it exists to do can't run yet, so this is the one claim it must not make");
  assert.equal(ctx.notReady, true, "and the screen is told which state it IS in");
});

test("…and the reason names the capability rather than leaving the family to guess", async () => {
  const a = await helperWith("Texter", ["web.search", "gmail.send"]);
  const ctx = await T(() => agentContext(a, owner));
  assert.match(ctx.gatedWhenReadyNames.join(" "), /send|email|gmail/i,
    "\"will wait for you once connected\" has to say what will wait");
});

test("SCOPE: an unconnected tool the helper never touches is not charged against it", async () => {
  // The over-correction to avoid: 54 of the 56 catalogue tools are unconnected in a new
  // household, so measuring against everything permitted would report every helper as blocked
  // by connectors it was never going to use. Only what its own skills reference counts.
  const a = await helperWith("Lookerupper", ["web.search"]);
  const ctx = await T(() => agentContext(a, owner));
  assert.equal(ctx.notReady, false);
  assert.deepEqual(ctx.notReadySkillNames, []);
  assert.deepEqual(ctx.gatedWhenReadyNames, []);
  assert.equal(ctx.runsUnattended, true, "this one genuinely does run start to finish, and still says so");
});

test("a gate that CAN run still reads as a gate, not as 'not ready'", async () => {
  const a = await helperWith("Asker", ["web.search", "homeops.create_approval"]);
  const ctx = await T(() => agentContext(a, owner));
  assert.ok(ctx.gatedCount > 0, "a connected approval-gated step is a real gate today");
  assert.equal(ctx.notReady, false, "…which is a different sentence from 'it isn't set up'");
  assert.equal(ctx.runsUnattended, false);
});

test("a half-built step — no capability behind it — is reported as not ready, not as autonomous", async () => {
  // WP-108's other failure mode, the same lie in a different shape: a skill naming a capability
  // the household doesn't have cannot gate on anything either.
  const a = await helperWith("Half built", ["web.search", "homeops.does_not_exist"]);
  const ctx = await T(() => agentContext(a, owner));
  assert.equal(ctx.runsUnattended, false);
  assert.equal(ctx.notReady, true);
  assert.deepEqual(ctx.notReadySkillNames, ["Half built skill"]);
});

test("a helper with no skills at all is still answered from what it can execute", async () => {
  // The ad-hoc case: nothing to be outstanding, so the original computation stands.
  const a = await T(() => createAgent({ name: "Ad hoc", status: "Active" }, owner));
  const ctx = await T(() => agentContext(a, owner));
  assert.equal(ctx.notReady, false);
  assert.equal(typeof ctx.runsUnattended, "boolean");
});

test("the states are mutually exclusive — no helper is both running alone and not ready", async () => {
  const cases = [["A", ["web.search", "gmail.send"]], ["B", ["web.search"]], ["C", ["homeops.create_approval"]], ["D", []]];
  for (const [name, tools] of cases) {
    const a = await helperWith(name, tools);
    const ctx = await T(() => agentContext(a, owner));
    assert.ok(!(ctx.runsUnattended && ctx.notReady), `${name}: a screen must never have to choose between two true answers`);
  }
});
