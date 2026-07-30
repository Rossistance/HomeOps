// Two buttons that handed out authority nobody granted.
//
// unattended-stamp.test.mjs holds the line at PATCH and PUT: `unattended.setByRole` is
// written by the server from a real session, never accepted from a body, because that claim is
// the whole basis on which policy.mjs rule 6b lets a helper send without asking.
//
// Duplicate and Rollback both wrote agents WITHOUT going through that stamp. Duplicate spread
// the source record verbatim, so a copy arrived already holding the Owner's blanket send
// authority, stamped with the Owner's name and a timestamp from before the copy existed —
// created by whoever clicked the button, with no PIN and no re-decision. Rollback restored a
// snapshot verbatim, so because REVOKING the grant is itself recorded as a new version,
// "restore previous version" turned it back on. Revocation another button silently undoes is
// not revocation.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-laundering-"));
const { createAgent, partialUpdateAgent, duplicateAgent, rollbackAgent } = await import("../agents.mjs");
const { runWithTenant } = await import("../store.mjs");

const HH = "local";
const owner = { householdId: HH, actorId: "m-owner", role: "Owner" };
const kid = { householdId: HH, actorId: "m-kid", role: "Limited Member" };
const T = (fn) => runWithTenant(HH, fn);
const POLICY = { autoAllow: [], alwaysApprove: [] };

after(() => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {} });

/** A helper the Owner has granted blanket send authority. */
async function granted(name) {
  return T(() => {
    const a = createAgent({ name }, owner);
    return partialUpdateAgent(a.id, { approvalPolicy: { ...POLICY, unattended: { enabled: true, includeHighRisk: true } } }, owner);
  });
}

test("the grant this suite is about is real to begin with", async () => {
  const a = await granted("Errand runner");
  assert.equal(a.approvalPolicy.unattended.includeHighRisk, true);
  assert.equal(a.approvalPolicy.unattended.setByRole, "Owner");
});

test("DUPLICATE: the copy does not inherit blanket send authority", async () => {
  const src = await granted("Bill payer");
  const copy = await T(() => duplicateAgent(src.id, owner));
  assert.equal(copy.approvalPolicy.unattended.includeHighRisk, false,
    "includeHighRisk is decided per-helper, about a specific reach — a new helper has to be asked for again");
  assert.equal(copy.approvalPolicy.unattended.setByRole, null,
    "and no copy may carry a claim that an Owner authorised THIS helper");
  assert.equal(copy.approvalPolicy.unattended.enabled, true,
    "the low tier carries over, so duplicating doesn't silently lose the configuration");
});

test("DUPLICATE: a member without standing cannot launder the Owner's grant into a new helper", async () => {
  const src = await granted("Grocery orderer");
  const copy = await T(() => duplicateAgent(src.id, kid));
  assert.equal(copy.approvalPolicy.unattended.includeHighRisk, false);
  assert.equal(copy.approvalPolicy.unattended.setByRole, null);
  assert.equal(copy.approvalPolicy.unattended.setBy, "m-kid", "the record names who actually made it");
});

test("DUPLICATE: attribution is re-stamped, not inherited", async () => {
  const src = await granted("Reminder sender");
  const copy = await T(() => duplicateAgent(src.id, owner));
  assert.notEqual(copy.approvalPolicy.unattended.setAt, src.approvalPolicy.unattended.setAt,
    "a copy's grant is dated when the copy was made, not when the original was granted");
});

test("ROLLBACK: restoring an old version does NOT bring a revoked grant back", async () => {
  const a = await granted("Package tracker");
  const revoked = await T(() => partialUpdateAgent(a.id, { approvalPolicy: { ...POLICY, unattended: { enabled: false } } }, owner));
  assert.equal(revoked.approvalPolicy.unattended, undefined, "revoked");

  const back = await T(() => rollbackAgent(a.id, null));
  assert.equal(back.approvalPolicy.unattended, undefined,
    "undo restores what a helper DOES, not what it is allowed to do");
});

test("ROLLBACK: …and does not silently STRIP a grant the family does want", async () => {
  // The mirror-image error, and the reason this isn't derived from the session: the
  // AI-change revert path (evolution-revert.mjs) calls rollbackAgent with no session at all.
  // Deriving authority from the caller would have quietly downgraded a tier the Owner set,
  // just because they reverted an unrelated wording change.
  const a = await granted("School run");
  await T(() => partialUpdateAgent(a.id, { purpose: "Drive the kids" }, owner));
  const back = await T(() => rollbackAgent(a.id, null));   // undo the purpose edit
  assert.equal(back.approvalPolicy.unattended?.includeHighRisk, true, "the live grant survives an unrelated undo");
  assert.equal(back.purpose, "", "…while the configuration really did roll back");
});

test("ROLLBACK: configuration still rolls back — this isn't a no-op", async () => {
  const a = await T(() => createAgent({ name: "Meal planner", purpose: "original" }, owner));
  await T(() => partialUpdateAgent(a.id, { purpose: "changed", instructions: "new rules" }, owner));
  const back = await T(() => rollbackAgent(a.id, null));
  assert.equal(back.purpose, "original");
  assert.equal(back.instructions, "");
  assert.equal(back.version, 3, "and the restore is itself a new version, not a rewrite of history");
});

test("ROLLBACK: an autoAllow list is authority too and does not travel back either", async () => {
  const a = await T(() => createAgent({ name: "Inbox sorter" }, owner));
  await T(() => partialUpdateAgent(a.id, { approvalPolicy: { autoAllow: ["gmail.send"], alwaysApprove: [] } }, owner));
  const cleared = await T(() => partialUpdateAgent(a.id, { approvalPolicy: { ...POLICY } }, owner));
  assert.deepEqual(cleared.approvalPolicy.autoAllow, []);
  const back = await T(() => rollbackAgent(a.id, null));
  assert.deepEqual(back.approvalPolicy.autoAllow, [],
    "\"this capability never asks\" is a permission, and undo must not re-grant it");
});
