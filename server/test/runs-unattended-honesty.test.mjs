// The green bolt that meant "not set up yet".
//
// `runsUnattended` counted only capabilities that were permitted AND AVAILABLE. A capability
// that isn't connected can't be counted as a gate — so the gate list came back empty for a
// helper that couldn't run its own job, and the detail screen showed the green bolt with "Runs
// start to finish without you". Connecting the account later flipped the answer, which means
// whichever claim the family read first was wrong.
//
// The reachable shape was the ordinary one. A helper built from chat got an allow-list DERIVED
// from its skill's steps, so a two-step skill — look something up, then email it — permitted
// exactly [web.search, gmail.send]. web.search is connected and needs no approval, so
// something was executable; gmail.send was unconnected, so it could not appear as a gate.
// Empty gate list + something executable was the ENTIRE test for "runs start to finish
// without you", and both halves were true about a helper whose actual purpose could not run.
//
// WHAT THIS FILE IS NOW. Skills are gone, so a helper no longer derives an allow-list from
// steps, and `agentContext` — which computed runsUnattended / notReady / gatedWhenReadyNames
// for the detail screen — went with it. What survives is the thing the bolt was lying about:
// a helper SAYS what it will do on its own, in one sentence a family reads, and policy.mjs
// decides what it may actually do. These tests hold those two together. A sentence the policy
// engine will not keep is the same bug in a shorter form, and it is now one comparison rather
// than a screen's worth of counters.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-unattended-honesty-"));
const { autonomyToApprovalPolicy, autonomyOf, AUTONOMY_TEXT, publicHelper } = await import("../helpers.mjs");
const { resolveEffectivePolicy, ALLOWED, NEEDS_APPROVAL, BLOCKED } = await import("../policy.mjs");

const owner = { householdId: "local", actorId: "m-owner", role: "Owner" };
const kid = { householdId: "local", actorId: "m-kid", role: "Limited Member" };

/* Real capabilities, with their real classifications from providers.mjs — a synthetic one
 * would let this file agree with itself instead of with the product. */
const SENDS = { id: "gmail.send", name: "Send email", action: "Send", risk: "High", requiresApproval: true, delivers: true };
const LOOKS = { id: "calendar.list", name: "List events", action: "Read", risk: "Low", requiresApproval: false, delivers: false };

/** A helper carrying nothing but the autonomy dial, set by `session`. */
const helperAt = (autonomy, session = owner) => ({
  id: "agt_probe", name: "Probe", instructions: "Look something up, then email it.",
  schedule: { kind: "manual" },
  approvalPolicy: autonomyToApprovalPolicy(autonomy, session),
});
const verdict = (helper, cap, settings = {}) => resolveEffectivePolicy({ cap, agent: helper, settings });

after(() => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {} });

test("THE FALSE BOLT: look-up-then-email is not 'runs start to finish without you'", async () => {
  // The same helper the old test built, expressed the way a family now builds it: it may act
  // on its own, and it emails. The sentence it shows must not promise the send.
  const h = helperAt("act");
  assert.equal(autonomyOf(h), "act");
  assert.equal(AUTONOMY_TEXT[autonomyOf(h)], "Does everyday things on its own, asks before sending or spending");

  const lookup = verdict(h, LOOKS);
  assert.equal(lookup.decision, ALLOWED, "the precondition the old boolean relied on — something IS executable…");

  const send = verdict(h, SENDS);
  assert.equal(send.decision, NEEDS_APPROVAL,
    "…and the thing it exists to do still stops for a person, so this is the claim it must not make");
  assert.equal(send.rule, "agent.unattended_refused");
});

test("…and the reason names the capability rather than leaving the family to guess", async () => {
  const send = verdict(helperAt("act"), SENDS);
  assert.match(send.reason, /send|email/i, "\"will wait for you\" has to say what will wait, and why");
  assert.match(send.reason, /an Owner has to allow that separately/i, "and name the one thing that would change it");
});

test("SCOPE: a capability the helper never has to stop for is not charged against it", async () => {
  // The over-correction to avoid: most of the catalogue needs no approval at all, and a
  // helper that only looks things up really does run start to finish. It must still say so.
  const h = helperAt("act");
  assert.equal(verdict(h, LOOKS).decision, ALLOWED);
  assert.equal(verdict(h, LOOKS).requiresApproval, false, "this one genuinely does run start to finish");
});

test("a gate that CAN run still reads as a gate, not as 'it isn't set up'", async () => {
  // The most careful setting is a REAL state with its own sentence — a connected, gated
  // capability waiting for a person is not the same thing as a helper that cannot run.
  const h = helperAt("ask");
  assert.equal(AUTONOMY_TEXT[autonomyOf(h)], "Asks before it does anything");
  const send = verdict(h, SENDS);
  assert.equal(send.decision, NEEDS_APPROVAL, "a connected approval-gated step is a real gate today");
  assert.equal(send.rule, "capability.requires_approval", "…and it stops on the capability's own gate, not on a refused grant");
  assert.equal(verdict(h, LOOKS).decision, ALLOWED, "which is a different sentence from 'nothing works'");
});

test("the top tier is honoured only when someone with the standing granted it", async () => {
  const granted = verdict(helperAt("full", owner), SENDS);
  assert.equal(granted.decision, ALLOWED, "an Owner really can turn a helper loose");
  assert.equal(granted.rule, "agent.unattended_high_risk");
  assert.match(granted.reason, /Owner chose/i, "and the record of who said so is what policy reads");

  // Asked for by someone who cannot grant it, the tier is not stored — so there is never a
  // gap between the promise and the behaviour for the policy engine to fall into.
  const asked = helperAt("full", kid);
  assert.equal(autonomyOf(asked), "act", "the record holds what was actually granted");
  assert.equal(verdict(asked, SENDS).decision, NEEDS_APPROVAL);
});

test("THE SCREEN AND THE ENGINE AGREE — the claim is never one the policy will not keep", async () => {
  /* This is the old "the states are mutually exclusive" check, aimed at the thing that was
   * actually wrong: a screen must never have to choose between two true answers. The sentence
   * says "on its own, including sending" if and only if a send really goes through. */
  for (const [autonomy, session] of [["ask", owner], ["act", owner], ["act", kid], ["full", owner], ["full", kid]]) {
    const h = helperAt(autonomy, session);
    const view = publicHelper({ ...h, householdId: "local", createdBy: session.actorId }, session);
    const sendGoesThrough = verdict(h, SENDS).decision === ALLOWED;
    const claimsSending = view.autonomyText === AUTONOMY_TEXT.full;
    assert.equal(claimsSending, sendGoesThrough,
      `${autonomy} as ${session.role}: the sentence says "${view.autonomyText}" while the send ${sendGoesThrough ? "goes" : "waits"}`);
    // And when what was asked for was not what was granted, the screen says so out loud
    // rather than showing the family a promise nothing will keep.
    assert.equal(view.autonomyDowngraded, autonomy === "full" && session === kid);
  }
});

test("the household kill switch outranks every sentence a helper shows", async () => {
  // The one refusal that is not the helper's to make, and the reason the claim is scoped to
  // the helper: even "does everything on its own" stops at a paused household, and the
  // refusal says which switch did it instead of blaming the helper.
  const v = verdict(helperAt("full", owner), SENDS, { externalActionsEnabled: false });
  assert.equal(v.decision, BLOCKED);
  assert.equal(v.rule, "household.kill_switch");
  assert.match(v.reason, /kill switch/i);
});
