// The unattended override is only as safe as its ATTRIBUTION.
//
// policy.mjs will let a helper send unattended when `approvalPolicy.unattended.setByRole`
// says an Owner or Adult Admin chose that. Which means the whole bound rests on one claim:
// that setByRole was written by the server from a real session, and never accepted from a
// request body. These tests hold that line at the write path — the same class of hole as the
// `sourceRef.agentId` forgery the run route already strips.
//
// WHAT CHANGED, AND WHY THIS GOT STRONGER. `approvalPolicy` is no longer a thing a caller
// sends at all. A helper has one autonomy dial — "ask" / "act" / "full" — and helpers.mjs
// DERIVES the unattended block from it, stamping the session in the one place that does it
// (autonomyToApprovalPolicy). So the forgery these tests were written about is now
// structurally unavailable rather than merely rejected: there is no path from a request body
// into setByRole. That is asserted below, because "the field is ignored" is a property that
// can regress the moment someone spreads a patch over a record again.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-unattended-"));
const { createHelper, updateHelper, publicHelper, autonomyOf } = await import("../helpers.mjs");
const { runWithTenant } = await import("../store.mjs");

const HH = "local";
const owner = { householdId: HH, actorId: "m-owner", role: "Owner" };
const kid = { householdId: HH, actorId: "m-kid", role: "Limited Member" };
const T = (fn) => runWithTenant(HH, fn);

let id;
before(async () => {
  await T(async () => {
    id = createHelper({ name: "Inbox triage", instructions: "Sort the family inbox each morning and flag anything urgent." }, owner).id;
  });
});
after(() => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {} });

/** Turn the dial, as `session`. `extra` is whatever else the caller tried to send with it. */
const setAutonomy = (autonomy, session, extra = {}) => T(() => updateHelper(id, { autonomy, ...extra }, session));

test("an Owner turning it on gets the high-risk tier, attributed to them", async () => {
  const a = await setAutonomy("full", owner);
  assert.equal(a.approvalPolicy.unattended.enabled, true);
  assert.equal(a.approvalPolicy.unattended.includeHighRisk, true);
  assert.equal(a.approvalPolicy.unattended.setByRole, "Owner");
  assert.equal(a.approvalPolicy.unattended.setBy, "m-owner");
  assert.ok(a.approvalPolicy.unattended.setAt, "when it was granted is recorded");
  assert.equal(autonomyOf(a), "full", "and the dial reads back as what was actually granted");
});

test("FORGERY: a body claiming setByRole:\"Owner\" is overwritten by the real session", async () => {
  const a = await setAutonomy("full", kid, {
    // The old attack surface, sent anyway: approvalPolicy is not read from a caller at all,
    // so this has to leave no trace whatsoever.
    approvalPolicy: { autoAllow: [], alwaysApprove: [], unattended: { enabled: true, includeHighRisk: true, setByRole: "Owner", setBy: "m-owner" } },
  });
  assert.equal(a.approvalPolicy.unattended.setByRole, null, "the claim is discarded, not trusted");
  assert.equal(a.approvalPolicy.unattended.includeHighRisk, false, "and the tier it was claiming is refused");
  assert.equal(a.approvalPolicy.unattended.setBy, "m-kid", "the record names who ACTUALLY did it");
  assert.equal(autonomyOf(a), "act", "the dial reads back as the tier that really applies");
});

test("FORGERY: no session at all cannot raise the tier either", async () => {
  // Migrations, repairs and internal edits reach updateHelper with no session.
  const a = await setAutonomy("full", null);
  assert.equal(a.approvalPolicy.unattended.includeHighRisk, false);
  assert.equal(a.approvalPolicy.unattended.setByRole, null);
});

test("a lower role can still turn on the low tier — that part isn't privileged", async () => {
  const a = await setAutonomy("act", kid);
  assert.equal(a.approvalPolicy.unattended.enabled, true);
  assert.equal(a.approvalPolicy.unattended.includeHighRisk, false);
  assert.equal(autonomyOf(a), "act");
});

test("turning it off removes the grant instead of leaving a stale one behind", async () => {
  await setAutonomy("full", owner);
  const a = await setAutonomy("ask", owner);
  assert.equal(a.approvalPolicy.unattended, undefined, "a revoked grant must not linger in the record");
  assert.equal(autonomyOf(a), "ask");
});

test("an edit that doesn't mention autonomy leaves an existing grant alone", async () => {
  await setAutonomy("full", owner);
  const a = await T(() => updateHelper(id, { purpose: "Sort the family inbox" }, owner));
  assert.equal(a.approvalPolicy.unattended?.includeHighRisk, true, "an unrelated edit must not silently revoke it");
  assert.equal(a.purpose, "Sort the family inbox");
  assert.equal(a.approvalPolicy.unattended.setBy, "m-owner",
    "and must not re-attribute the grant to whoever happened to make that edit");
});

test("a WHOLE-RECORD write is stamped too — not just a one-field patch", async () => {
  // The route accepts PUT as well as PATCH, and both land in updateHelper, so a caller
  // resubmitting the entire helper is the same hole in a different shape.
  const a = await T(() => updateHelper(id, {
    name: "Inbox triage", purpose: "Sort the family inbox", instructions: "Sort the family inbox each morning.",
    schedule: { kind: "daily", time: "07:00" }, autonomy: "full",
    approvalPolicy: { unattended: { enabled: true, includeHighRisk: true, setByRole: "Owner" } },
  }, kid));
  assert.equal(a.approvalPolicy.unattended.includeHighRisk, false);
  assert.equal(a.approvalPolicy.unattended.setByRole, null);
});

test("the public view reports the grant that ACTUALLY applies, so the UI can't over-promise", async () => {
  // agentContext used to compute this alongside a capability matrix; publicHelper says it in
  // one word plus one sentence, which is all a family was ever going to read.
  const a = await setAutonomy("full", kid);
  const view = await T(() => publicHelper(a, kid));
  assert.equal(view.autonomy, "act", "the screen must show the refused tier as refused");
  assert.equal(view.autonomyText, "Does everyday things on its own, asks before sending or spending");
  assert.equal(view.autonomyDowngraded, true, "and say plainly that what was asked for was not what was granted");

  const raised = await setAutonomy("full", owner);
  const granted = await T(() => publicHelper(raised, owner));
  assert.equal(granted.autonomy, "full");
  assert.equal(granted.autonomyText, "Does everything on its own, including sending and spending");
  assert.equal(granted.autonomyDowngraded, false);
});

test("the helper's job is the helper — [18:06] \"what IS that skill?\"", async () => {
  /* This used to assert that agentContext named the helper's SKILLS, their step counts and
   * their step names, because a family could not otherwise find out what the thing they had
   * assembled would actually do. There are no skills now: a helper's job is its instructions,
   * in the family's own words, and they are on the record the screen already reads. The
   * question the test was named for is answered by looking. */
  const a = await T(() => updateHelper(id, {
    instructions: "Every morning, read the family's inbox and flag anything that needs a reply today.",
  }, owner));
  const view = await T(() => publicHelper(a, owner));
  assert.match(view.instructions, /read the family's inbox/);
  assert.equal(view.scheduleText, "Every day at 7:00 AM", "and when it will do it, in words");
});

test("…and there is no second record left to go missing", async () => {
  /* The other half of the old pair: a skill that had been deleted had to be reported as
   * MISSING rather than silently dropped, because a helper could name one that no longer
   * existed. Deleting the concept deleted the failure mode — nothing a helper points at can
   * dangle, because it points at nothing. Pinned so a future "recipe" field cannot quietly
   * reintroduce a reference the family has no way to see is broken. */
  const a = await T(() => createHelper({ name: "Ad hoc", instructions: "Do one thing, once, when asked." }, owner));
  const view = await T(() => publicHelper(a, owner));
  for (const gone of ["skills", "skillIds", "functionIds", "playbooks", "steps"]) {
    assert.equal(view[gone], undefined, `a helper must not carry a ${gone} reference that can dangle`);
  }
  assert.equal(view.scheduleText, "Only when you ask");
  assert.equal(view.autonomy, "ask", "and an un-configured helper starts at the most careful setting");
});
