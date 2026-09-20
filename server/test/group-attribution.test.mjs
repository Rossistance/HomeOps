// WHO IS THIS RUN, AND WHAT DOES IT CLAIM ABOUT ITSELF.
//
// Two concerns share one file because they are the two halves of one question, and a run that
// starts in the family group chat is the first thing that had to answer both at once.
// ATTRIBUTION is who the run acts as; PROVENANCE is what the run says about where it came
// from. Get the first wrong and the wrong person's standing consent applies to a send. Get the
// second wrong and an adult approves something on the strength of a sentence that is not true.
//
// ATTRIBUTION (orchestrator.mjs). A hand-rolled plan through the manual API is deliberately
// left UNATTRIBUTED: lending it a helper's identity would lend it that helper's standing
// consent to send, which is exactly the impersonation a client must not be able to buy by
// posting a sourceRef. "group_chat" joins "chat", "schedule" and "agent" on the attributed
// side, and that is not a hole in the rule, because no part of a group run's sourceRef comes
// from a client: a secret-gated webhook, a chat an authenticated adult bound, a verified
// member's reply. The part that reads backwards is why it MUST be attributed. When a run is
// unattributed, helper is null, and a null helper means isToolStepAllowed never runs on any
// step. Attribution is not a privilege handed to the run; it is the thing that makes the
// allow-list and the policy ladder apply at all. So the manual run below is the UNGUARDED one,
// which is the opposite of how the pair looks at a glance.
//
// The third attribution test is about a floor that does not live on any record. GROUP_TOOL_IDS
// is checked at the call site BEFORE the helper record is consulted, so a widened record
// cannot buy reach that the surface never had.
//
// PROVENANCE (assistant-agent.mjs queueApprovalRun). It used to bake in source "assistant",
// via "chat" and the summary "Asked in chat: ...". Reused unchanged by the group listener, it
// would drop an approval into an adult's Inbox claiming it was asked in chat: a false system
// state in the one surface where honesty is what decides whether the action happens at all. So
// the caller now says where it came from, and the defaults keep the chat path byte for byte as
// it was. Its role floor is the other half: the group path hands it the AFFIRMING MEMBER's
// real session, so a Child View member's "yes" must not be able to queue an action.
//
// No clock injection exists in this suite. NOW is a fixed instant and every seeded timestamp is
// derived from it, so nothing here depends on how long the file takes to run.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Chosen before ../store.mjs is pulled in, since the store resolves its data dir at import
// time: orchestrate, queueApprovalRun and resolveProposal all run in THIS process, against a
// throwaway db. The spawned server below still gets its own separate dir from the harness.
process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-groupattr-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession } = await import("./harness.mjs");
const {
  runWithTenant, getRun, getAgent, patchAgent, putImessageChat, putChatProposal, getChatProposal, readAudit,
} = await import("../store.mjs");
const { orchestrate, DEFAULT_HOUSEHOLD_AGENT_ID } = await import("../orchestrator.mjs");
const { queueApprovalRun } = await import("../assistant-agent.mjs");
const {
  GROUP_TOOL_IDS, CHAT_HELPER_ID, ensureChatHelper, resolveProposal, PROPOSAL_TTL_MS,
} = await import("../group-chat.mjs");
const { isToolStepAllowed } = await import("../helper-shape.mjs");

const NOW = Date.UTC(2026, 4, 9, 14, 0, 0);
const HH = "local";                        // the household the seeded members belong to
const HH_FLOOR = "hh_grpattr_floor";       // its own household: the floor test deliberately
                                           // widens agt_chat, which no other test may inherit

let ctx, ownerClient, childClient;
before(async () => {
  ctx = await startServer();
  ownerClient = await makeSession(ctx, "m-alex");   // Owner
  childClient = await makeSession(ctx, "m-noah");   // Child View
  await runWithTenant(HH, () => ensureChatHelper(HH));
});
after(async () => { await stopServer(ctx); });

/** The session shape orchestrate and queueApprovalRun actually read, built from a REAL
 *  session the server minted rather than from a role string this file invented. */
const sessionOf = (client, householdId = HH) => ({ actorId: client.actorId, householdId, role: client.role });

const planWith = (title, steps) => ({ title, summary: "", steps });
const addTaskStep = () => ({
  toolId: "homeops.create_task", title: "Add the task", detail: "",
  input: { title: "Bring the cooler", visibility: "household" },
});
/** On agt_chat's deny-list BY NAME, and nowhere near GROUP_TOOL_IDS. */
const sendMailStep = () => ({
  toolId: "gmail.send", title: "Email the league", detail: "",
  input: { to: "coach@example.invalid", subject: "Saturday", body: "A body long enough to look real." },
});

/* ───────────────────────── grounding ───────────────────────── */

test("the roles this file leans on are the seeded ones, resolved server-side", async () => {
  // Both sessions come from the real /api/session path, so the role each test uses below is
  // the registry's answer and not a constant this file made up. A Child View "yes" refused by
  // a role the test itself supplied would prove nothing.
  assert.equal(ownerClient.status, 200, JSON.stringify(ownerClient.raw));
  assert.equal(ownerClient.role, "Owner", `m-alex is the Owner: ${JSON.stringify(ownerClient.raw)}`);
  assert.equal(childClient.status, 200, JSON.stringify(childClient.raw));
  assert.equal(childClient.role, "Child View", `m-noah is Child View: ${JSON.stringify(childClient.raw)}`);
});

/* ───────────────── 1. attribution: who the run acts as ───────────────── */

test("a group_chat run acts as agt_chat; the same plan through the manual API acts as NOBODY", async () => {
  const group = await runWithTenant(HH, () => orchestrate({
    source: "group_chat", via: "group_chat", agentId: CHAT_HELPER_ID,
    plan: planWith("Group ask", [addTaskStep()]), session: sessionOf(ownerClient),
    goal: "Put the swim meet on the calendar",
  }));
  assert.ok(group.ok, JSON.stringify(group));
  const groupRun = await runWithTenant(HH, () => getRun(group.run.id));
  assert.equal(groupRun.sourceRef.via, "group_chat", `the via label survives verbatim: ${JSON.stringify(groupRun.sourceRef)}`);
  assert.equal(groupRun.sourceRef.agentId, CHAT_HELPER_ID,
    `an attributed via resolves a real acting helper: ${JSON.stringify(groupRun.sourceRef)}`);

  // The same request body, the same named helper, one word different. A hand-rolled plan is
  // left unattributed on purpose, because the manual API takes its sourceRef from a request:
  // a caller who could name a helper would inherit that helper's standing consent to send.
  const manual = await runWithTenant(HH, () => orchestrate({
    source: "manual", via: "manual", agentId: CHAT_HELPER_ID,
    plan: planWith("Hand-rolled ask", [addTaskStep()]), session: sessionOf(ownerClient),
  }));
  assert.ok(manual.ok, JSON.stringify(manual));
  const manualRun = await runWithTenant(HH, () => getRun(manual.run.id));
  assert.equal(manualRun.sourceRef.via, "manual", JSON.stringify(manualRun.sourceRef));
  assert.equal(manualRun.sourceRef.agentId, null,
    `a manual plan carries no identity, even when the caller asked for one: ${JSON.stringify(manualRun.sourceRef)}`);
});

test("ATTRIBUTION IS WHAT MAKES THE ALLOW-LIST APPLY: a denied tool is clamped, and only in the attributed run", async () => {
  const agent = await runWithTenant(HH, () => getAgent(CHAT_HELPER_ID));
  assert.ok(agent.deniedToolIds.includes("gmail.send"),
    `the premise, read off the record rather than assumed: ${JSON.stringify(agent.deniedToolIds)}`);

  const group = await runWithTenant(HH, () => orchestrate({
    source: "group_chat", via: "group_chat", agentId: CHAT_HELPER_ID,
    plan: planWith("Add it, then tell the league", [addTaskStep(), sendMailStep()]),
    session: sessionOf(ownerClient), goal: "Add it and email the league",
  }));
  assert.ok(group.ok, JSON.stringify(group));
  assert.equal(group.droppedSteps, 1, `exactly the one step the helper may not reach: ${JSON.stringify(group.run.steps.map((s) => s.toolId))}`);
  assert.equal(group.run.steps[0].clampedOut, null, "the step that IS on the group surface is untouched");
  const clamped = group.run.steps[1].clampedOut;
  assert.ok(clamped, `gmail.send is clamped rather than run: ${JSON.stringify(group.run.steps[1])}`);
  assert.equal(clamped.reason, "denied", `denied by name, not merely absent from an allow-list: ${JSON.stringify(clamped)}`);
  assert.match(clamped.message, /blocked list/i, `and it carries the reason a person can read: ${clamped.message}`);

  // The refusal SURVIVES into the durable run rather than being filtered out before it starts.
  // A step deleted on the way in is a run that reports success while the one thing the family
  // cared about left no trace.
  const durable = await runWithTenant(HH, () => getRun(group.run.id));
  assert.equal(durable.steps.length, 2, "both steps are in the record");
  assert.equal(durable.steps[1].clampedOut.reason, "denied", JSON.stringify(durable.steps[1].clampedOut));

  /* The same plan, via "manual", is NOT CLAMPED AT ALL, and that is the point of this pair
   * rather than a gap in it. An unattributed run has helper === null, and orchestrate skips
   * the allow-list check entirely when there is no helper to check against. Leaving a group
   * run unattributed would not have been the cautious choice; it would have removed the only
   * layer that stops gmail.send from a surface that may reach four tool ids. */
  const manual = await runWithTenant(HH, () => orchestrate({
    source: "manual", via: "manual", agentId: CHAT_HELPER_ID,
    plan: planWith("Same plan, no identity", [addTaskStep(), sendMailStep()]),
    session: sessionOf(ownerClient),
  }));
  assert.equal(manual.droppedSteps, 0, `nothing is clamped when nobody is acting: ${JSON.stringify(manual)}`);
  assert.equal(manual.run.steps[1].clampedOut, null,
    "the identical gmail.send step passes the orchestrator untouched, because no allow-list ran");
});

test("GROUP_TOOL_IDS is the call-site floor: the record cannot widen what this surface reaches", async () => {
  const GUID = "iMessage;+;chat-groupattr-floor";
  const CHAT_ID = "ich_groupattr_floor";
  const PROPOSAL_ID = "prp_groupattr_floor";

  await runWithTenant(HH_FLOOR, () => {
    ensureChatHelper(HH_FLOOR);
    // Widen the record as far as it goes: gmail.send allowed by name, and off the deny-list.
    // This is the state a UI edit, a mistyped PATCH or a bad migration could produce, and it
    // is the state the floor exists to survive.
    patchAgent(CHAT_HELPER_ID, {
      allowedToolIds: [...GROUP_TOOL_IDS, "gmail.send"],
      deniedToolIds: [],
    });
    putImessageChat({
      id: CHAT_ID, householdId: HH_FLOOR, chatGuid: GUID, service: "iMessage", displayName: "",
      status: "bound", boundBy: "m-alex", boundAt: new Date(NOW - 86_400_000).toISOString(),
      announcedAt: new Date(NOW - 86_400_000).toISOString(), speakGrant: "helper_unattended",
      participantSalt: "0123456789abcdef0123456789abcdef",
      knownParticipants: [], unknownParticipantHashes: [],
      recentMessageIds: [], messageIdsByDay: {},
      lastMessageAt: new Date(NOW - 60_000).toISOString(),
      lastTriagedAt: null, triageCursorAt: null,
      lastSpokeAt: null, spokeDayKey: null, spokeCountDay: 0,
      createdAt: new Date(NOW - 86_400_000).toISOString(), updatedAt: new Date(NOW - 60_000).toISOString(),
    });
    // A stored proposal naming a tool the group surface has never had. Seeded directly because
    // openProposal would refuse to create it: the floor is checked there too, and this test is
    // about the SECOND check, the one that runs when a yes comes back.
    putChatProposal({
      id: PROPOSAL_ID, householdId: HH_FLOOR, chatGuid: GUID,
      toolId: "gmail.send", kind: "task", title: "Email the league",
      input: { to: "coach@example.invalid", subject: "Saturday", body: "A body long enough to look real." },
      spanMemberId: "m-alex", requestedByActorId: "m-alex", decisionId: null,
      status: "open", proposedAt: new Date(NOW - 60_000).toISOString(),
      expiresAt: new Date(NOW + PROPOSAL_TTL_MS).toISOString(),
      decidedBy: null, decidedAt: null, runId: null, loopId: null,
    });
  });

  // The record really would allow it now, so what refuses below is the floor and not the
  // helper gate wearing its coat.
  const widened = await runWithTenant(HH_FLOOR, () => getAgent(CHAT_HELPER_ID));
  const wouldAllow = isToolStepAllowed(widened, "gmail.send");
  assert.equal(wouldAllow.ok, true, `the helper record permits gmail.send: ${JSON.stringify(wouldAllow)}`);
  assert.equal(GROUP_TOOL_IDS.has("gmail.send"), false, "and the frozen constant never has");

  const chat = { id: CHAT_ID, householdId: HH_FLOOR, chatGuid: GUID };
  const out = await runWithTenant(HH_FLOOR, () => resolveProposal({
    chat, proposal: getChatProposal(PROPOSAL_ID), answer: "yes",
    memberSession: sessionOf(ownerClient, HH_FLOOR), atMs: NOW,
  }));
  assert.equal(out.ok, false, `a yes on an out-of-scope proposal executes nothing: ${JSON.stringify(out)}`);
  assert.equal(out.error, "tool_not_in_group_scope", JSON.stringify(out));

  // Nothing was accepted and nothing was run: the offer is left exactly as it was found.
  const after = await runWithTenant(HH_FLOOR, () => getChatProposal(PROPOSAL_ID));
  assert.equal(after.status, "open", `the record is untouched: ${JSON.stringify(after)}`);
  assert.equal(after.runId, null, "and no run was started off the back of it");

  // Refused out loud, in the audit trail, because a floor that refuses silently is a floor
  // nobody can tell is holding.
  const audited = await runWithTenant(HH_FLOOR, () => readAudit(50)).then((rows) =>
    rows.find((a) => a.type === "imessage.tool_out_of_scope" && a.toolId === "gmail.send"));
  assert.ok(audited, "the out-of-scope refusal is written down");
});

/* ───────────────── 2. provenance: what the run says about itself ───────────────── */

test("queueApprovalRun is exported and takes its provenance, and the group values reach the Inbox summary", async () => {
  assert.equal(typeof queueApprovalRun, "function",
    "the group listener reaches it as a module export, not by re-implementing the approval path");

  const ask = "Swim meet Saturday at 9";
  const q = await runWithTenant(HH, () => queueApprovalRun({
    toolId: "homeops.create_task", input: { title: ask, visibility: "household" }, title: "Create a task",
    session: sessionOf(ownerClient), conversationId: null, goal: ask, visibility: "household",
    source: "group_chat", via: "group_chat", summaryPrefix: "Asked in the family chat",
  }));
  assert.ok(q.ok, JSON.stringify(q));

  const run = await runWithTenant(HH, () => getRun(q.runId));
  assert.ok(run.plan.summary.startsWith("Asked in the family chat"),
    `the sentence an adult reads says where it came from: ${JSON.stringify(run.plan.summary)}`);
  assert.equal(run.plan.summary.startsWith("Asked in chat"), false,
    `and never the chat claim, which is the false system state this parameter exists to prevent: ${JSON.stringify(run.plan.summary)}`);
  assert.equal(run.plan.summary, `Asked in the family chat: ${ask}`, run.plan.summary);
  assert.equal(run.source, "group_chat", `the durable record agrees with the summary: ${JSON.stringify(run.sourceRef)}`);
  assert.equal(run.sourceRef.via, "group_chat", JSON.stringify(run.sourceRef));

  /* DISCREPANCY, asserted as it actually behaves. queueApprovalRun does not forward an
   * agentId, so this run resolves to the household default helper rather than to agt_chat:
   * its via says group_chat while its identity says agt_household. It is attributed, so the
   * ladder does apply, and the only toolId that can arrive here has already passed the
   * GROUP_TOOL_IDS floor in resolveProposal; what it does NOT get is agt_chat's own
   * deny-list. Pinned rather than glossed, so a later change to either side is visible. */
  assert.equal(run.sourceRef.agentId, DEFAULT_HOUSEHOLD_AGENT_ID,
    `a group-originated approval acts as the household default, not as agt_chat: ${JSON.stringify(run.sourceRef)}`);
});

test("the defaults keep the chat path exactly as it was", async () => {
  // The other half of making provenance a parameter: an ordinary chat approval must read the
  // same as it always did, with nothing at the call site saying so.
  const ask = "Book the dentist for the 14th";
  const q = await runWithTenant(HH, () => queueApprovalRun({
    toolId: "homeops.create_task", input: { title: ask, visibility: "household" }, title: "Create a task",
    session: sessionOf(ownerClient), conversationId: null, goal: ask, visibility: "household",
  }));
  assert.ok(q.ok, JSON.stringify(q));

  const run = await runWithTenant(HH, () => getRun(q.runId));
  assert.equal(run.plan.summary, `Asked in chat: ${ask}`, run.plan.summary);
  assert.equal(run.source, "assistant", JSON.stringify(run.sourceRef));
  assert.equal(run.sourceRef.via, "chat", JSON.stringify(run.sourceRef));
  assert.equal(run.sourceRef.agentId, DEFAULT_HOUSEHOLD_AGENT_ID,
    `and a chat run is still attributed to the household assistant: ${JSON.stringify(run.sourceRef)}`);
});

test("A CHILD VIEW MEMBER'S YES CANNOT QUEUE AN ACTION", async () => {
  /* This is not a chat-path nicety carried along by accident. The group path passes the
   * AFFIRMING member's real session, so whoever types "yes" into the family thread is the
   * session this role floor is asked about. Without it, a six-year-old agreeing with an offer
   * would put a real action in front of the adults with their own name on it. */
  const q = await runWithTenant(HH, () => queueApprovalRun({
    toolId: "homeops.create_task", input: { title: "Buy the sweets", visibility: "household" }, title: "Create a task",
    session: sessionOf(childClient), conversationId: null, goal: "Buy the sweets", visibility: "household",
    source: "group_chat", via: "group_chat", summaryPrefix: "Asked in the family chat",
  }));
  assert.equal(q.ok, false, `refused before anything is created: ${JSON.stringify(q)}`);
  assert.equal(q.error, "insufficient_role", JSON.stringify(q));
  assert.equal(q.runId, undefined, "and no run id comes back, because no run was started");
  assert.match(q.message, /can't start actions/i, `the refusal is a sentence, not a code: ${q.message}`);

  // The floor is at Limited Member, so the adult above it is unaffected: a role check that
  // refused everyone would pass this test and break the feature.
  const allowed = await runWithTenant(HH, () => queueApprovalRun({
    toolId: "homeops.create_task", input: { title: "Buy the sweets", visibility: "household" }, title: "Create a task",
    session: { ...sessionOf(ownerClient), role: "Limited Member" },
    conversationId: null, goal: "Buy the sweets", visibility: "household",
    source: "group_chat", via: "group_chat", summaryPrefix: "Asked in the family chat",
  }));
  assert.equal(allowed.ok, true, `Limited Member is the floor, not a wall: ${JSON.stringify(allowed)}`);
});
