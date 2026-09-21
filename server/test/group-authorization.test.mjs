// AN ALLOW-LIST ON A HELPER RECORD IS A PREFERENCE, NOT A BOUNDARY.
//
// isToolStepAllowed (helper-shape.mjs) checks the deny-list first and unconditionally, then
// checks the allow-list ONLY IF IT IS NON-EMPTY. That is deliberate and documented: every
// helper a family creates starts with no allow-list at all, and a deny-only default is what
// lets a new helper do anything before anyone has configured it. The consequence is that an
// EMPTY allow-list does not mean "nothing"; it means "everything".
//
// So the list is one UI edit away from meaning the opposite of what it looks like. A family
// clearing the rows in Helpers, a PATCH whose allowedToolIds arrives as a string and
// normalises to [], a migration that drops a column: each of those empties the list, and the
// failure direction is FULL PRIVILEGE. On the one surface where Famili speaks unprompted,
// into a thread containing people who never agreed to any of this, that is not survivable.
// The blast radius of the emptied list is not "the group listener stops working". It is the
// group listener reaching gmail.send and homeops.notify_contact.
//
// The fix does not try to make the shared gate stricter, because a deny-only default is
// right for the other twenty helpers. It puts the floor at the CALL SITE instead, in layers
// that fail in different directions:
//
//   1. PROPOSAL_TOOL_IDS, a frozen module constant in group-chat.mjs, checked before the
//      record is consulted. Widening it is a code review; editing a helper is not. It is
//      DERIVED from PROPOSAL_KINDS, so the enum and the tool set cannot drift apart.
//   2. A deny-list populated by NAME rather than by omission, so the layer that survives an
//      emptied allow-list is the layer that runs first and unconditionally.
//   3. chatHelperUsable(), which asserts INERT-NOT-PERMISSIVE: an emptied allow-list makes
//      the voice refuse to act rather than act with more reach than anyone granted it.
//      Inert is visible and recoverable. Permissive is invisible until it does something.
//   4. ROLE ATTRIBUTION, for the lane the first three do not cover.
//
// WHICH SURFACE EACH LAYER PROTECTS, because this stopped being "the group" once there were
// two lanes. Layers 1-3 govern UNINVITED speech: the passive classifier's proposals and the
// voice they are spoken with (agt_chat). They do NOT govern Lane 2, where a member addressed
// Famili by name and gets the same dense agent and full tool catalog as the app — a menu of
// three verbs cannot hold a conversation, and the voice agent this is the foundation for
// will need the range. Lane 2's safety is layer 4: the turn is attributed to agt_household,
// so the whole policy ladder applies, and policy.mjs rule 4b degrades a non-adult's
// consequential calls to an approval an adult signs. Different acts, different guards —
// not one lane trusted less than the other.
//
// The first test here is the regression itself, and it is the one that matters. The rest pin
// the authorization model around it: what the constant contains, what Object.freeze actually
// buys, and the four ways a household can (or cannot) reach the point where Famili is
// allowed to open its mouth at all.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Chosen before ../store.mjs is pulled in, since the store resolves its data dir at import
// time: every function under test here runs in THIS process, against a throwaway db.
process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-groupauthz-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const {
  runWithTenant, getAgent, patchAgent, getSettings, setSettings,
  putImessageChat, patchImessageChat,
} = await import("../store.mjs");
const {
  PROPOSAL_TOOL_IDS, PROPOSAL_KINDS, CHAT_HELPER_ID, ensureChatHelper, chatHelperUsable, speakPermission,
} = await import("../group-chat.mjs");
const { sweepGroupTriage } = await import("../group-triage.mjs");
const { isToolStepAllowed } = await import("../helper-shape.mjs");
const { autonomyToApprovalPolicy } = await import("../helpers.mjs");
const { resolveEffectivePolicy, BLOCKED } = await import("../policy.mjs");

// One household per scenario, so a dial set in one test cannot decide another. No clock
// injection exists in this suite: NOW is an explicit argument and every seeded timestamp is
// derived from it, so nothing here depends on how long the file takes to run.
const NOW = Date.UTC(2026, 2, 14, 18, 0, 0);
const HH_INERT = "hh_authz_inert1";
const HH_SILENT = "hh_authz_silent";
const HH_HELPER = "hh_authz_helper";
const HH_HOUSE = "hh_authz_house0";
const HH_KILL = "hh_authz_killsw";
const HH_DENY = "hh_authz_denied";

const OWNER = { actorId: "m-alex", role: "Owner" };          // seed.mjs
const CHILD = { actorId: "m-noah", role: "Child View" };     // seed.mjs

/** A bound chat that is due for triage: quiet for longer than QUIET_GAP_MS, well inside
 *  STALE_WINDOW_MS, and never judged. Enough of a record for the sweep to take it. */
function seedDueChat(householdId, id, chatGuid) {
  return putImessageChat({
    id, householdId, chatGuid, service: "iMessage", displayName: "", status: "bound",
    boundBy: OWNER.actorId, boundAt: new Date(NOW - 86_400_000).toISOString(),
    announcedAt: new Date(NOW - 86_400_000).toISOString(), speakGrant: "helper_unattended",
    participantSalt: "0123456789abcdef0123456789abcdef",
    knownParticipants: [], unknownParticipantHashes: [],
    recentMessageIds: [], messageIdsByDay: {},
    lastMessageAt: new Date(NOW - 90_000).toISOString(),
    lastTriagedAt: null, triageCursorAt: null,
    lastSpokeAt: null, spokeDayKey: null, spokeCountDay: 0,
    createdAt: new Date(NOW - 86_400_000).toISOString(), updatedAt: new Date(NOW - 90_000).toISOString(),
  });
}

/* ───────────────────────────── 1. the regression ───────────────────────────── */

test("THE REGRESSION: an emptied allow-list makes the listener INERT, never permissive", async () => {
  // The premise, stated in code rather than trusted from a doc comment. This is the shared
  // gate every other helper runs through, and with an empty allow-list it waves through a
  // tool that is nowhere near the group surface.
  const wideOpen = isToolStepAllowed({ allowedToolIds: [], deniedToolIds: [] }, "gmail.send");
  assert.equal(wideOpen.ok, true, `an empty allow-list is PERMISSIVE at the shared gate: ${JSON.stringify(wideOpen)}`);

  const CHAT_ID = "ich_authz_inert";
  const GUID = "iMessage;+;chat-authz-inert";
  await runWithTenant(HH_INERT, () => {
    ensureChatHelper(HH_INERT);
    seedDueChat(HH_INERT, CHAT_ID, GUID);
  });

  // Healthy first, so the contrast below is about the allow-list and not about an absent or
  // undue chat. This chat IS due, and the sweep DOES take it.
  const healthy = await runWithTenant(HH_INERT, () => sweepGroupTriage(NOW));
  assert.equal(healthy.judged, 1, `the sweep acts on a due chat with the seed intact: ${JSON.stringify(healthy)}`);
  assert.equal(healthy.skipped, 0, JSON.stringify(healthy));

  // Now empty the list the way a UI edit or a mistyped PATCH empties it: straight onto the
  // agent record, never through ensureChatHelper, which would repair it on the way past.
  await runWithTenant(HH_INERT, () => {
    patchAgent(CHAT_HELPER_ID, { allowedToolIds: [] });
    patchImessageChat(CHAT_ID, { triageCursorAt: null, lastMessageAt: new Date(NOW - 90_000).toISOString() });
  });
  const emptied = await runWithTenant(HH_INERT, () => getAgent(CHAT_HELPER_ID));
  assert.deepEqual(emptied.allowedToolIds, [], `the record really is empty now: ${JSON.stringify(emptied.allowedToolIds)}`);
  assert.ok(emptied.deniedToolIds.length > 0, "and the deny-list is untouched, which is the layer the record cannot lose");

  // Layer 3. The assertion, not an inference: no list means no acting.
  const usable = await runWithTenant(HH_INERT, () => chatHelperUsable());
  assert.equal(usable.ok, false, `an emptied allow-list is refused, not honoured: ${JSON.stringify(usable)}`);
  assert.equal(usable.error, "chat_helper_misconfigured", JSON.stringify(usable));
  assert.match(usable.message, /Helpers/, `and the refusal says where to fix it: ${usable.message}`);

  // And the sweep stops rather than running with full privilege. Skipped, not judged: the
  // windows are still owed a verdict, which is what makes this recoverable.
  const inert = await runWithTenant(HH_INERT, () => sweepGroupTriage(NOW));
  assert.equal(inert.judged, 0, `nothing is judged while the helper is misconfigured: ${JSON.stringify(inert)}`);
  assert.equal(inert.proposed, 0, `and nothing is proposed into the family's thread: ${JSON.stringify(inert)}`);
  assert.ok(inert.skipped > 0, `the chat is counted as skipped, so a dead listener is not mistaken for an idle one: ${JSON.stringify(inert)}`);

  // The same floor holds on the other path out of this module. Speaking is not a separate
  // permission question that happens to agree; it asks chatHelperUsable first.
  const perm = await runWithTenant(HH_INERT, () => speakPermission(HH_INERT));
  assert.equal(perm.ok, false, JSON.stringify(perm));
  assert.equal(perm.error, "chat_helper_misconfigured", `inert everywhere, not just in the sweep: ${JSON.stringify(perm)}`);
});

/* ─────────────────────── 2. the constant the record cannot widen ─────────────────────── */

test("PROPOSAL_TOOL_IDS is a frozen module constant, it is narrow, and it is DERIVED", () => {
  assert.equal(Object.isFrozen(PROPOSAL_TOOL_IDS), true, "the floor is code, so it is declared as code that cannot be reassigned");
  assert.equal(PROPOSAL_TOOL_IDS.size, 3, `exactly three ids a passive proposal may become: ${JSON.stringify([...PROPOSAL_TOOL_IDS])}`);

  /* DERIVED, NOT RESTATED. The classifier answers with a kind from PROPOSAL_KINDS and the
   * server maps it to a tool id; if this set were written out by hand, adding a kind would
   * silently produce a proposal that openProposal then refuses as out of scope. Asserting
   * the relationship rather than the contents makes that class of drift impossible instead
   * of merely unlikely — and it is why this test does not need updating when a kind is
   * added. sms.send is deliberately NOT here: it is the voice, held by agt_chat's own
   * allow-list, and a proposal must never be able to become "send a message". */
  assert.deepEqual([...PROPOSAL_TOOL_IDS].sort(), Object.values(PROPOSAL_KINDS).sort(),
    `the set is exactly the enum's values: ${JSON.stringify([...PROPOSAL_TOOL_IDS])} vs ${JSON.stringify(Object.values(PROPOSAL_KINDS))}`);
  assert.equal(PROPOSAL_TOOL_IDS.has("sms.send"), false, "speaking is not a proposal outcome");

  // The point of the list is what is NOT on it. Each of these is reachable by an ordinary
  // helper and would be reachable here too if the emptied allow-list were the only gate.
  for (const loud of ["gmail.send", "homeops.notify_contact", "http.post", "browser.open", "homeops.write_memory", "calendar.create"]) {
    assert.equal(PROPOSAL_TOOL_IDS.has(loud), false, `${loud} is not a proposal outcome`);
  }
});

test("Object.freeze seals the constant's properties; a Set's contents are not properties", () => {
  // Worth pinning because the guarantee is narrower than the word "frozen" suggests, and the
  // narrower guarantee is still the right one: a Set's entries live in internal slots that
  // Object.freeze does not reach, so .add() works. What cannot happen is the thing this
  // constant exists to prevent, which is DATA widening it. Reaching .add() at all takes a
  // code change to group-chat.mjs; a helper record, a request body and a migration cannot.
  assert.throws(() => { PROPOSAL_TOOL_IDS.extra = "homeops.notify_contact"; }, TypeError,
    "the object itself is not extensible, so no property can be hung off it");

  const probe = "gmail.send";
  PROPOSAL_TOOL_IDS.add(probe);
  assert.equal(PROPOSAL_TOOL_IDS.has(probe), true, "freeze does not reach a Set's internal slots: add() neither throws nor no-ops");
  PROPOSAL_TOOL_IDS.delete(probe);
  assert.equal(PROPOSAL_TOOL_IDS.has(probe), false, "restored, so no later test inherits a widened floor");
  assert.equal(PROPOSAL_TOOL_IDS.size, 3, "and back to three");
});

/* ─────────────────────── 3. the listener ships silent ─────────────────────── */

test("agt_chat ships with no unattended grant, and the refusal names where to grant it", async () => {
  const perm = await runWithTenant(HH_SILENT, () => {
    ensureChatHelper(HH_SILENT);
    return speakPermission(HH_SILENT);
  });
  assert.equal(perm.ok, false, `a freshly seeded helper cannot speak: ${JSON.stringify(perm)}`);
  assert.equal(perm.error, "speak_not_authorized", JSON.stringify(perm));
  // Named, not implied. An adult told only "not authorized" has four dials to guess between.
  assert.match(perm.message, /Owner/, perm.message);
  assert.match(perm.message, /Helpers/, perm.message);
  assert.match(perm.message, /Famili in chat/, perm.message);

  // The seed itself, so this is a property of what ships rather than an accident of settings.
  const agent = await runWithTenant(HH_SILENT, () => getAgent(CHAT_HELPER_ID));
  assert.equal(agent.approvalPolicy.unattended.enabled, false, `nothing grants itself anything: ${JSON.stringify(agent.approvalPolicy)}`);
  assert.deepEqual(agent.approvalPolicy.autoAllow, [], JSON.stringify(agent.approvalPolicy));
  assert.deepEqual(agent.approvalPolicy.alwaysApprove, [], JSON.stringify(agent.approvalPolicy));
});

/* ─────────────────────── 4. the helper-level grant ─────────────────────── */

test("an Owner's 'full' autonomy on agt_chat grants the speak; a Child View's does not", async () => {
  await runWithTenant(HH_HELPER, () => ensureChatHelper(HH_HELPER));

  // The same dial, asked for by someone without the standing to raise it. helpers.mjs stamps
  // the role from the session rather than the body, and policy.mjs re-checks it.
  const refused = await runWithTenant(HH_HELPER, () => {
    patchAgent(CHAT_HELPER_ID, { approvalPolicy: autonomyToApprovalPolicy("full", CHILD) });
    return speakPermission(HH_HELPER);
  });
  assert.equal(refused.ok, false, `sms.send is high-risk, so the top tier needs an adult: ${JSON.stringify(refused)}`);
  assert.equal(refused.error, "speak_not_authorized", JSON.stringify(refused));

  const granted = await runWithTenant(HH_HELPER, () => {
    patchAgent(CHAT_HELPER_ID, { approvalPolicy: autonomyToApprovalPolicy("full", OWNER) });
    return speakPermission(HH_HELPER);
  });
  assert.equal(granted.ok, true, JSON.stringify(granted));
  assert.equal(granted.grant, "helper_unattended", `the answer names WHICH grant applied: ${JSON.stringify(granted)}`);
  assert.equal(granted.rule, "agent.unattended_high_risk", `and carries the policy rule underneath it: ${JSON.stringify(granted)}`);
});

/* ─────────────────────── 5. the household-level dials ─────────────────────── */

test("a household that flips to Trusted grants it too, and the answer says so", async () => {
  await runWithTenant(HH_HOUSE, () => ensureChatHelper(HH_HOUSE));

  // Balanced is bounded by reachesOutside, and a text leaves the house. This is the half of
  // the dial that must NOT reach the group surface.
  const balanced = await runWithTenant(HH_HOUSE, () => {
    setSettings({ autonomy: "Balanced", autonomySetByRole: "Owner" }, HH_HOUSE);
    return speakPermission(HH_HOUSE);
  });
  assert.equal(balanced.ok, false, `Balanced clears local writes, never a send: ${JSON.stringify(balanced)}`);
  assert.equal(balanced.error, "speak_not_authorized", JSON.stringify(balanced));

  // Trusted, asked for by someone who could not have granted it, is reported as refused
  // rather than silently downgraded.
  const unauthorized = await runWithTenant(HH_HOUSE, () => {
    setSettings({ autonomy: "Trusted", autonomySetByRole: "Child View" }, HH_HOUSE);
    return speakPermission(HH_HOUSE);
  });
  assert.equal(unauthorized.ok, false, `Trusted still needs an Owner behind it: ${JSON.stringify(unauthorized)}`);
  assert.equal(unauthorized.error, "speak_not_authorized", JSON.stringify(unauthorized));

  const trusted = await runWithTenant(HH_HOUSE, () => {
    setSettings({ autonomy: "Trusted", autonomySetByRole: "Owner" }, HH_HOUSE);
    return speakPermission(HH_HOUSE);
  });
  assert.equal(trusted.ok, true, JSON.stringify(trusted));
  assert.equal(trusted.grant, "household_trusted", `not helper_unattended: the grant is named for where it came from: ${JSON.stringify(trusted)}`);
  assert.equal(trusted.rule, "household.autonomy_trusted", JSON.stringify(trusted));

  // Which is the whole reason the answer carries WHICH: nobody opened this helper. Its own
  // unattended grant is still off, and Famili can now speak into the family's group thread.
  const agent = await runWithTenant(HH_HOUSE, () => getAgent(CHAT_HELPER_ID));
  assert.equal(agent.approvalPolicy.unattended.enabled, false, `granted without the helper ever being touched: ${JSON.stringify(agent.approvalPolicy)}`);
});

/* ─────────────────────── 6. the ceiling ─────────────────────── */

test("the household kill switch blocks the speak, in the canonical sentence", async () => {
  const perm = await runWithTenant(HH_KILL, () => {
    ensureChatHelper(HH_KILL);
    // Both grants at once, so what refuses below is the ceiling and not an absent permission.
    patchAgent(CHAT_HELPER_ID, { approvalPolicy: autonomyToApprovalPolicy("full", OWNER) });
    setSettings({ autonomy: "Trusted", autonomySetByRole: "Owner", externalActionsEnabled: false }, HH_KILL);
    return speakPermission(HH_KILL);
  });
  assert.equal(perm.ok, false, `no grant reaches past rule 1: ${JSON.stringify(perm)}`);
  assert.equal(perm.error, "speak_blocked", JSON.stringify(perm));
  // The exact sentence, not a match: notify.mjs, engine.mjs and policy.mjs all surface this
  // same refusal to a family, and three layers inventing three phrasings for one concept is
  // how a person concludes three different things are broken.
  assert.equal(perm.message, "External actions are paused by the household kill switch.", perm.message);

  // And it lifts cleanly, so the switch is a pause rather than a state the family has to
  // repair afterwards.
  const back = await runWithTenant(HH_KILL, () => {
    setSettings({ externalActionsEnabled: true }, HH_KILL);
    return speakPermission(HH_KILL);
  });
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.equal(back.grant, "helper_unattended", JSON.stringify(back));
});

/* ─────────────────────── 7. the layer that survives the edit ─────────────────────── */

test("the deny-list is populated by NAME, and a deny beats an intact allow-list", async () => {
  const agent = await runWithTenant(HH_DENY, () => ensureChatHelper(HH_DENY));
  /* agt_chat is the VOICE now, and nothing else: Lane 2's work is attributed to
   * agt_household, so the only id this identity needs is the one it speaks with. Lane 1's
   * proposals execute as it too and are separately held to PROPOSAL_TOOL_IDS. */
  assert.deepEqual(agent.allowedToolIds.slice().sort(), ["sms.send"],
    `the seed's allow-list is just the voice: ${JSON.stringify(agent.allowedToolIds)}`);

  // Named rather than left to omission. Omission is what an emptied list destroys; a name
  // survives it, because isToolStepAllowed checks denies first and unconditionally.
  for (const id of ["homeops.notify_contact", "gmail.send"]) {
    assert.equal(agent.deniedToolIds.includes(id), true, `${id} is denied by name: ${JSON.stringify(agent.deniedToolIds)}`);
  }
  assert.equal(agent.deniedToolIds.includes("sms.send"), false,
    "and the one tool this surface exists to use is not denied, or the listener could never speak");

  // The allow-list here is fully intact, so this is the deny-list acting on its own account
  // rather than a not_permitted refusal wearing its coat.
  const gate = isToolStepAllowed(agent, "gmail.send");
  assert.equal(gate.ok, false, JSON.stringify(gate));
  assert.equal(gate.reason, "denied", `denied, not not_permitted: ${JSON.stringify(gate)}`);

  // The same answer from the layer that actually decides whether a step runs.
  const decision = resolveEffectivePolicy({
    cap: { id: "gmail.send", name: "Send email", requiresApproval: true, risk: "High", action: "Send", delivers: true, external: true },
    agent,
    settings: getSettings(HH_DENY),
    override: null,
  });
  assert.equal(decision.decision, BLOCKED, JSON.stringify(decision));
  assert.equal(decision.rule, "agent.denied", `blocked by the deny-list, ahead of every relaxation below it: ${JSON.stringify(decision)}`);
});
