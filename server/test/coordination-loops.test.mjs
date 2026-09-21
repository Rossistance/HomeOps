// The ask that left the group chat, and the one quiet knock that is allowed to follow it.
//
// Someone raises in the family thread that another member should book a medical visit. The
// person it concerns says no. coordination.mjs is what remains of that ask: a record that
// waits a day, checks the calendar quietly, and if nothing came of it knocks ONCE, in
// private. Both of the obvious alternatives are failures. Keep asking in the thread and the
// machine embarrasses people in front of their family; forget it and a health task the
// family surfaced on purpose disappears with no trace that it ever existed.
//
// This file exists because every one of those failures is SILENT. A loop that closes itself
// on a coincidence produces no artifact and no complaint: the dropped health task looks
// exactly like a resolved one. A loop that speaks into the group without being told to is a
// single await away in a function that already holds the chat record. So the assertions here
// are mostly about things NOT happening, which is the only shape the bug has.
//
// Three rules from the module header, and where each is pinned below:
//
// 1. TRANSCRIPT EVIDENCE MAY CLOSE A LOOP; IT MAY NEVER BE REPORTED AS COMPLETION. Pinned by
//    the test named for it: a transcript close lands as resolutionEvidence.kind "transcript",
//    and the source itself is asserted to have exactly ONE speakToChat call site, inside the
//    relay-consent branch of answerLoopReply.
// 2. THE AUDIT IS ASYMMETRIC ON PURPOSE. calendarResolution is meant to be hard to satisfy,
//    so most of part one is negative: one shared keyword is a coincidence, an undated event
//    is not an answer, and somebody else's booking is not this person's. The trap the
//    predicate was written around is withinRange, which returns true for a null stamp AND for
//    an unparseable one; an undated event run through it would match every window ever asked
//    about, which is how a health task vanishes into a "resolved" loop.
// 3. NOTHING GOES BACK TO THE GROUP WITHOUT THE TARGET SAYING SO. Silence on the consent
//    question is a no, and the sweep has to treat it as one.
//
// Time is an input, never a wall clock. sweepCoordinationLoops takes an explicit nowMs, so
// every loop here is seeded with a FUTURE dueAt and swept from a future instant: that keeps
// the live server's own 60s ladder, which runs on the real clock beside these tests, from
// touching a single record this file owns.
//
// The sweeps run in a FRESH node process (runSweep, the idiom from
// reminders-and-archive.test.mjs) against the spawned server's data dir. The pure predicates
// run in-process against their own temp dir, chosen before ../store.mjs is first imported.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer, readStoreDoc, writeStoreDoc, readStoreRecord, writeStoreRecord } from "./harness.mjs";

// Before the first import of ../store.mjs, and deliberately after the static harness import
// (which sets a dir of its own for the same reason): the in-process half of this file gets
// its own throwaway store, entirely separate from the spawned server's.
process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-loops-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {} });

const store = await import("../store.mjs");
const {
  runWithTenant, setSettings, putMember, putEvent, putCoordinationLoop, getCoordinationLoop,
  putImessageChat, getImessageChat, listImessageMessages, readAudit,
} = store;
const {
  calendarResolution, transcriptResolution, keywordsFrom, nextCheckAt,
  openLoopFromRefusal, answerLoopReply, DISMISS_COOLING_MS, MAX_NUDGES,
} = await import("../coordination.mjs");
const { recordInboundGroupMessage } = await import("../group-chat.mjs");
const { localParts, localDateKey, wallClockToUtc } = await import("../household-time.mjs");

const DAY = 86400_000;
const SRC_URL = new URL("../coordination.mjs", import.meta.url);

/* ───────────────────────── part one: the predicates, in process ─────────────────────────
 *
 * Every case gets its OWN household, because the question being asked is "did anything in
 * this family's calendar answer this", and a stray event left behind by the previous case
 * would answer it for the wrong reason. A fresh tenant is a fresh calendar. */

let hhSeq = 0;
const freshHousehold = () => `hh_loop${String(++hhSeq).padStart(6, "0")}`;

const LOOP_T0 = Date.parse("2026-05-10T15:00:00.000Z");
const NOW = LOOP_T0 + 2 * DAY;

/** A watching loop over `text`, targeted at Morgan, opened at LOOP_T0. */
function loopOver(householdId, text, over = {}) {
  return {
    id: "cl_pred", householdId,
    originChatGuid: null, originProposalId: null,
    requestedByActorId: "m-alex", targetActorId: "m-morgan",
    intent: { kind: "appointment", text, keywords: keywordsFrom(text), personName: "Morgan Harper" },
    status: "watching",
    dueAt: new Date(LOOP_T0 + DAY).toISOString(),
    expiresAt: new Date(LOOP_T0 + 14 * DAY).toISOString(),
    lastEvaluatedAt: null, nudgeCount: 0, lastNudgeAt: null,
    auditCursorAt: new Date(LOOP_T0).toISOString(),
    resolutionEvidence: null,
    createdAt: new Date(LOOP_T0).toISOString(), updatedAt: new Date(LOOP_T0).toISOString(),
    ...over,
  };
}

/** An event in that household, on Morgan, booked the day after the loop opened. */
function eventOn(householdId, over = {}) {
  return putEvent({
    id: `ev_${Math.random().toString(16).slice(2, 10)}`, householdId,
    title: "Untitled", location: "", status: "confirmed", deletedAt: null,
    ownerId: "m-morgan", createdBy: "m-morgan", participantIds: ["m-morgan"],
    startAt: new Date(LOOP_T0 + 5 * DAY).toISOString(),
    createdAt: new Date(LOOP_T0 + DAY).toISOString(),
    ...over,
  });
}

test("calendarResolution: an exact normalised title is an answer", async () => {
  const hh = freshHousehold();
  await runWithTenant(hh, () => {
    // "Dentist" yields ONE keyword, so nothing here can reach the two-keyword bar: the only
    // door left open is the exact-title one, which is what this case is about.
    eventOn(hh, { title: "  Dentist!  " });
    const hit = calendarResolution(loopOver(hh, "Dentist"), NOW);
    assert.ok(hit, "the booking the family asked for is on the calendar, under the same name");
    assert.equal(hit.title, "  Dentist!  ", "and it is that event that is reported back");
  });
});

test("calendarResolution: two overlapping keywords are an answer", async () => {
  const hh = freshHousehold();
  await runWithTenant(hh, () => {
    // Title and location together carry both words; neither alone would.
    eventOn(hh, { title: "Teeth cleaning", location: "Bright Smiles Dentist" });
    const hit = calendarResolution(loopOver(hh, "book a dentist cleaning for Noah"), NOW);
    assert.ok(hit, "'cleaning' plus 'dentist' is two independent hits, not a coincidence");
  });
});

test("calendarResolution: ONE shared keyword is a coincidence and closes nothing", async () => {
  const hh = freshHousehold();
  await runWithTenant(hh, () => {
    eventOn(hh, { title: "Teeth cleaning", location: "Uptown" });
    assert.equal(calendarResolution(loopOver(hh, "book a dentist cleaning for Noah"), NOW), null,
      "a permissive match here silently drops a health task, so one word is not enough");
  });
});

test("calendarResolution: an UNDATED event never matches, which is the trap this predicate was written around", async () => {
  const hh = freshHousehold();
  await runWithTenant(hh, () => {
    // withinRange returns true for a null stamp and for an unparseable one alike, so an
    // undated event run through it would satisfy every window ever asked about. Both of
    // these carry the exact title, and both must still be nothing.
    eventOn(hh, { title: "Dentist", startAt: null });
    eventOn(hh, { title: "Dentist", startAt: "sometime next week" });
    assert.equal(calendarResolution(loopOver(hh, "Dentist"), NOW), null,
      "an event with no finite startAt cannot answer a question about a window");
  });
});

test("calendarResolution: somebody else's booking is not this person's answer", async () => {
  const hh = freshHousehold();
  await runWithTenant(hh, () => {
    eventOn(hh, { title: "Dentist", ownerId: "m-alex", createdBy: "m-alex", participantIds: ["m-alex"] });
    assert.equal(calendarResolution(loopOver(hh, "Dentist"), NOW), null,
      "the loop is about Morgan; Alex's dentist visit says nothing about whether Morgan went");
  });
});

test("calendarResolution: an event that was already there is not news", async () => {
  const hh = freshHousehold();
  await runWithTenant(hh, () => {
    eventOn(hh, { title: "Dentist", createdAt: new Date(LOOP_T0 - DAY).toISOString() });
    assert.equal(calendarResolution(loopOver(hh, "Dentist"), NOW), null,
      "it predates the ask, so it cannot be the thing the ask produced");
  });
});

test("keywordsFrom keeps what identifies the ask and drops the words every sentence has", () => {
  assert.deepEqual(keywordsFrom("Book the dentist appointment for my son"), ["dentist", "son"],
    "book/the/appointment/for/my are in every version of this sentence and identify nothing");
  assert.deepEqual(keywordsFrom("Go to Dr Ng re MRI"), ["mri"],
    "two-letter fragments match half the calendar, so length 3 is the floor");
  assert.deepEqual(keywordsFrom("Noah's dentist, Noah's dentist"), ["noah", "dentist"],
    "punctuation is stripped and repeats collapse, so a keyword cannot be counted twice");
  assert.deepEqual(keywordsFrom(null), [], "no text is no keywords, not a crash");
  assert.ok(keywordsFrom("alpha bravo charlie delta echo foxtrot golf hotel india juliet").length <= 8,
    "capped, because the two-hit bar gets easier with every extra word");
});

test("nextCheckAt clamps into waking hours: a loop opened at 11pm is not due at 11pm", async () => {
  const hh = freshHousehold();
  const tz = "America/Denver";
  await runWithTenant(hh, () => {
    setSettings({ timezone: tz }, hh);

    // Explicit epoch millis, built from a Denver wall clock so the input is unambiguous.
    const wall = (day, hour, minute = 0) => wallClockToUtc({ year: 2026, month: 5, day, hour, minute, second: 0 }, tz);

    // 11:10pm Friday. Naive arithmetic lands the check at 11:10pm Saturday.
    const lateNight = localParts(nextCheckAt(hh, wall(15, 23, 10)), tz);
    assert.equal(lateNight.hour, 9, "past bedtime rolls to the next morning, the first moment it is welcome");
    assert.equal(lateNight.day, 17, "…which is the day AFTER the naive +24h, not the same night");

    // 2:30am. The naive check is the small hours of the next night.
    const smallHours = localParts(nextCheckAt(hh, wall(15, 2, 30)), tz);
    assert.equal(smallHours.hour, 9, "before waking hours is pulled forward to the start of them");
    assert.equal(smallHours.day, 16, "…on the same day, because it has not gone past bedtime");

    // 2pm. Nothing to clamp; the household's afternoon is exactly when to ask.
    const afternoon = localParts(nextCheckAt(hh, wall(15, 14)), tz);
    assert.equal(afternoon.hour, 14, "an ordinary hour is left alone");
    assert.equal(afternoon.day, 16);

    for (const [label, ms] of [["late night", wall(15, 23, 10)], ["small hours", wall(15, 2, 30)], ["afternoon", wall(15, 14)], ["8pm exactly", wall(15, 20)]]) {
      const h = localParts(nextCheckAt(hh, ms), tz).hour;
      assert.ok(h >= 9 && h < 20, `${label}: due at local hour ${h}, outside waking hours`);
    }
  });
});

/* ───────────────────────── part two: the transition table, through a sweep ─────────────────
 *
 * The sweeps run in a FRESH node process against the spawned server's data dir. Importing
 * coordination.mjs in THIS process would read the temp store chosen above, which the server
 * never writes to: a sweep over nothing, passing vacuously. A subprocess gets a cold engine
 * pointed at the same disk the assertions read back from. */

function runSweep(nowMs, dataDir) {
  const script = `import { sweepCoordinationLoops } from ${JSON.stringify(SRC_URL.href)};`
    + ` const r = await sweepCoordinationLoops(${nowMs}); console.log(JSON.stringify(r));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, HOMEOPS_DATA_DIR: dataDir, NODE_TEST_CONTEXT: "" },
    encoding: "utf8",
  });
  return JSON.parse(out.trim().split(/[\r\n]+/).pop());
}

let ctx;
let T0;              // the instant every seeded loop is opened at
let SWEEP_AT;        // the instant every sweep is run from: two days later

/** Audit lines the spawned server and the sweep subprocess wrote, newest first. */
function auditLines() {
  const p = path.join(ctx.dataDir, "tenants", "local", "audit.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const auditFor = (loopId) => auditLines().filter((a) => a.loopId === loopId);
const loopBack = (id) => readStoreRecord(ctx, "coordination_loops", id);

/** Seed a watching loop in the served household. dueAt is a DAY OUT on the real clock, so the
 *  server's own ladder never sees it; the sweep reaches it by being handed a future nowMs. */
function seedLoop(id, over = {}) {
  const text = over.text ?? "Dentist checkup";
  delete over.text;
  const rec = {
    id, householdId: "local",
    originChatGuid: null, originProposalId: "cp_seed",
    requestedByActorId: "m-alex", targetActorId: "m-morgan",
    intent: { kind: "appointment", text, keywords: keywordsFrom(text), personName: "Morgan Harper" },
    status: "watching",
    dueAt: new Date(T0 + DAY).toISOString(),
    expiresAt: new Date(T0 + 14 * DAY).toISOString(),
    lastEvaluatedAt: null, nudgeCount: 0, lastNudgeAt: null,
    auditCursorAt: new Date(T0).toISOString(),
    resolutionEvidence: null,
    createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0).toISOString(),
    ...over,
  };
  writeStoreRecord(ctx, "coordination_loops", id, rec);
  return rec;
}

function seedBoundChat(id, chatGuid, over = {}) {
  const rec = {
    id, householdId: "local", chatGuid, service: "iMessage",
    displayName: "Harpers", status: "bound",
    boundBy: "m-alex", boundAt: new Date(T0).toISOString(), announcedAt: new Date(T0).toISOString(),
    speakGrant: null, participantSalt: "0123456789abcdef",
    knownParticipants: [], unknownParticipantHashes: [],
    recentMessageIds: [], messageIdsByDay: {},
    lastMessageAt: new Date(T0).toISOString(),
    lastTriagedAt: null, triageCursorAt: null,
    lastSpokeAt: null, spokeDayKey: null, spokeCountDay: 0,
    createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0).toISOString(),
    ...over,
  };
  writeStoreRecord(ctx, "imessage_chats", id, rec);
  return rec;
}

/** Outbound rows are the durable trace of Famili having spoken in a thread. */
const outboundRows = (chatGuid) =>
  Object.values(readStoreDoc(ctx, "imessage_messages.json", {}))
    .filter((m) => m.chatGuid === chatGuid && m.direction === "out");

before(async () => {
  ctx = await startServer();
  T0 = Date.now();
  SWEEP_AT = T0 + 2 * DAY;
  // An explicit zone, so the transcript day buckets this file builds by hand are keyed the
  // same way group-chat.mjs would key them, and a transcript audit is actually possible.
  writeStoreDoc(ctx, "settings.json", { ...readStoreDoc(ctx, "settings.json", {}), timezone: "UTC", chatTranscriptDays: 14 });
});
after(async () => { await stopServer(ctx); });

test("watching + the booking is on the calendar: closed quietly, and NOTHING is sent", () => {
  writeStoreRecord(ctx, "events", "ev_resolved", {
    id: "ev_resolved", householdId: "local", title: "Dentist checkup", location: "",
    status: "confirmed", deletedAt: null,
    ownerId: "m-morgan", createdBy: "m-morgan", participantIds: ["m-morgan"],
    startAt: new Date(T0 + 5 * DAY).toISOString(),
    createdAt: new Date(T0 + DAY).toISOString(),
  });
  seedLoop("cl_resolved", { text: "Dentist checkup" });

  const r = runSweep(SWEEP_AT, ctx.dataDir);
  const loop = loopBack("cl_resolved");
  assert.equal(loop.status, "closed_resolved", JSON.stringify(r));
  assert.equal(loop.closedReason, "calendar");
  assert.equal(loop.resolutionEvidence.kind, "calendar", "the one kind of evidence that may ever be reported to another person");
  assert.equal(loop.resolutionEvidence.ref, "ev_resolved", "and it names the fact the system owns");
  assert.equal(loop.dueAt, null, "a closed loop is never due again");

  assert.equal(r.nudged, 0, "resolved means resolved: nobody was asked anything");
  assert.equal(r.skipped, 0, "…and no send was even attempted and failed");
  assert.equal(auditFor("cl_resolved").filter((a) => a.type === "coordination.nudged").length, 0,
    "the whole point of checking first is that the private knock never happens");
  assert.ok(auditFor("cl_resolved").some((a) => a.type === "coordination.resolved_silently" && a.via === "calendar"),
    "closing quietly is still written down, or a dead sweep is indistinguishable from a tidy one");
});

test("watching + nothing came of it: ONE private knock, and the record is stamped before it", () => {
  seedLoop("cl_nudge", { text: "Optometrist visit" });

  const r = runSweep(SWEEP_AT, ctx.dataDir);
  const loop = loopBack("cl_nudge");
  assert.equal(loop.status, "nudged", JSON.stringify(r));
  assert.equal(loop.nudgeCount, 1);
  assert.equal(loop.nudgeCount, MAX_NUDGES, "one is the whole allowance");
  assert.ok(loop.lastNudgeAt, "stamped, so a restart mid-send cannot knock twice about someone's health");
  assert.ok(Date.parse(loop.dueAt) > SWEEP_AT, "and re-armed for the follow-up window, not left due");

  const nudges = auditFor("cl_nudge").filter((a) => a.type === "coordination.nudged");
  assert.equal(nudges.length, 1, "exactly one attempt, audited whether or not it landed");
  assert.equal(nudges[0].delivered, false, "no verified, opted-in text method exists on the seed…");
  assert.equal(nudges[0].error, "no_verified_method", "…and the consent chain says so instead of sending anyway");
});

test("watching + past its expiry: closed_expired, however unresolved it still is", () => {
  // Expires between the loop's due time and the instant the sweep is handed.
  seedLoop("cl_expired", { text: "Physio referral", expiresAt: new Date(T0 + 1.5 * DAY).toISOString() });

  const r = runSweep(SWEEP_AT, ctx.dataDir);
  const loop = loopBack("cl_expired");
  assert.equal(loop.status, "closed_expired", JSON.stringify(r));
  assert.equal(loop.closedReason, "loop_expired", "retirement comes before the audit: there is nothing left to ask");
  assert.equal(auditFor("cl_expired").filter((a) => a.type === "coordination.nudged").length, 0);
});

test("watching + the person it is about has left the household: closed_expired, never delivered", () => {
  const members = readStoreDoc(ctx, "members.json", {});
  writeStoreDoc(ctx, "members.json", { ...members, "m-noah": { ...members["m-noah"], archived: true } });
  try {
    seedLoop("cl_gone", { text: "Hearing check", targetActorId: "m-noah" });
    const r = runSweep(SWEEP_AT, ctx.dataDir);
    const loop = loopBack("cl_gone");
    assert.equal(loop.status, "closed_expired", JSON.stringify(r));
    assert.equal(loop.closedReason, "loop_target_gone", "a loop whose person is gone has nobody to ask");
    assert.equal(auditFor("cl_gone").filter((a) => a.type === "coordination.nudged").length, 0,
      "an archived member must not be messaged about a health task on their way out");
  } finally {
    writeStoreDoc(ctx, "members.json", { ...readStoreDoc(ctx, "members.json", {}), "m-noah": members["m-noah"] });
  }
});

test("nudged + due again: it ends there, because a second private nudge is nagging in a smaller room", () => {
  seedLoop("cl_twice", {
    text: "Blood test", status: "nudged", nudgeCount: 1,
    lastNudgeAt: new Date(T0 + 12 * 3600_000).toISOString(),
  });

  const r = runSweep(SWEEP_AT, ctx.dataDir);
  const loop = loopBack("cl_twice");
  assert.equal(loop.status, "closed_expired", JSON.stringify(r));
  assert.equal(loop.closedReason, "no_answer");
  assert.equal(loop.nudgeCount, 1, "the count did not move, because no second knock happened");
  assert.equal(auditFor("cl_twice").filter((a) => a.type === "coordination.nudged").length, 0,
    "silence after one private ask is an answer, and it is respected");
});

test("awaiting_relay_consent + due: silence is a NO, and the group is told nothing", () => {
  const guid = "iMessage;+;chat-relay-consent";
  seedBoundChat("ch_relay", guid);
  seedLoop("cl_relay", {
    text: "Eye test", status: "awaiting_relay_consent", originChatGuid: guid,
    nudgeCount: 1, lastNudgeAt: new Date(T0 + 12 * 3600_000).toISOString(),
  });

  const r = runSweep(SWEEP_AT, ctx.dataDir);
  const loop = loopBack("cl_relay");
  assert.equal(loop.status, "closed_completed", JSON.stringify(r));
  assert.equal(loop.closedReason, "relay_not_consented",
    "the task may well be done; what was never given is permission to say so");
  assert.equal(loop.resolutionEvidence, null, "and nothing is recorded as proof of a completion nobody confirmed");

  const chat = readStoreRecord(ctx, "imessage_chats", "ch_relay");
  assert.equal(chat.lastSpokeAt, null, "Famili did not speak in the thread");
  assert.equal(chat.spokeCountDay, 0);
  assert.equal(outboundRows(guid).length, 0, "no outbound row, which is the durable trace speaking leaves");
  assert.equal(auditLines().filter((a) => a.type === "imessage.spoke" && a.chatId === "ch_relay").length, 0);
});

/* ───────────────────────── part three: answering the knock ───────────────────────── */

/** A nudged loop waiting on Morgan, in a household of its own. */
async function withNudgedLoop(fn, over = {}) {
  const hh = freshHousehold();
  return await runWithTenant(hh, async () => {
    putMember({ actorId: "m-alex", displayName: "Alex Harper", role: "Owner", householdId: hh });
    putMember({ actorId: "m-morgan", displayName: "Morgan Harper", role: "Adult Admin", householdId: hh });
    const loop = putCoordinationLoop({
      ...loopOver(hh, "Dentist checkup"),
      id: `cl_${hh}`, status: "nudged", nudgeCount: 1,
      lastNudgeAt: new Date(LOOP_T0 + DAY).toISOString(),
      ...over,
    });
    return await fn({ hh, loop });
  });
}

test("a nudged loop plus YES moves to the consent question, because the asker is still waiting", async () => {
  await withNudgedLoop(async ({ loop }) => {
    const reply = await answerLoopReply({ actorId: "m-morgan", text: "yes", nowMs: NOW });
    const after = getCoordinationLoop(loop.id);
    assert.equal(after.status, "awaiting_relay_consent",
      "accepting help is not the same as agreeing that Alex gets told");
    assert.ok(Date.parse(after.dueAt) > NOW, "the consent question has its own deadline, and silence will close it");
    assert.match(reply, /Alex Harper/, "the question names who would be told");
    assert.match(reply, /family chat/, "and where it would be said");
  });
});

test("a nudged loop plus NO closes it, with no consent question left hanging", async () => {
  await withNudgedLoop(async ({ loop }) => {
    const reply = await answerLoopReply({ actorId: "m-morgan", text: "no", nowMs: NOW });
    const after = getCoordinationLoop(loop.id);
    assert.equal(after.status, "closed_dismissed");
    assert.equal(after.closedReason, "declined");
    assert.equal(after.dueAt, null, "declined and done, not scheduled to come back");
    assert.equal(reply, "No problem.");
  });
});

test("a nudged loop plus STOP closes it and says the sentence that promises it is over", async () => {
  await withNudgedLoop(async ({ loop }) => {
    const reply = await answerLoopReply({ actorId: "m-morgan", text: "stop asking", nowMs: NOW });
    const after = getCoordinationLoop(loop.id);
    assert.equal(after.status, "closed_dismissed");
    assert.equal(after.closedReason, "loop_dismissed", "the reason the cooling period is keyed on");
    assert.match(reply, /I won't bring this up again\./,
      "a promise in plain words, because the person has to be able to trust it");
  });
});

test("an awaiting_relay_consent loop plus NO closes it and the group learns nothing", async () => {
  const hh = freshHousehold();
  await runWithTenant(hh, async () => {
    putMember({ actorId: "m-alex", displayName: "Alex Harper", role: "Owner", householdId: hh });
    putMember({ actorId: "m-morgan", displayName: "Morgan Harper", role: "Adult Admin", householdId: hh });
    const guid = `iMessage;+;chat-${hh}`;
    putImessageChat({
      id: `ch_${hh}`, householdId: hh, chatGuid: guid, service: "iMessage", displayName: "Harpers",
      status: "bound", boundBy: "m-alex", boundAt: new Date(LOOP_T0).toISOString(), announcedAt: null,
      speakGrant: null, participantSalt: "abcdef0123456789",
      knownParticipants: [], unknownParticipantHashes: [],
      recentMessageIds: [], messageIdsByDay: {},
      lastMessageAt: new Date(LOOP_T0).toISOString(), lastTriagedAt: null, triageCursorAt: null,
      lastSpokeAt: null, spokeDayKey: null, spokeCountDay: 0,
      createdAt: new Date(LOOP_T0).toISOString(), updatedAt: new Date(LOOP_T0).toISOString(),
    });
    const loop = putCoordinationLoop({
      ...loopOver(hh, "Dentist checkup"),
      id: `cl_${hh}`, status: "awaiting_relay_consent", originChatGuid: guid,
      nudgeCount: 1, lastNudgeAt: new Date(LOOP_T0 + DAY).toISOString(),
    });

    const reply = await answerLoopReply({ actorId: "m-morgan", text: "no", nowMs: NOW });
    const after = getCoordinationLoop(loop.id);
    assert.equal(after.status, "closed_completed");
    assert.equal(after.closedReason, "relay_not_consented");
    assert.equal(reply, "Kept between us.");

    const chat = getImessageChat(`ch_${hh}`);
    assert.equal(chat.lastSpokeAt, null, "nothing went into the thread");
    assert.equal(chat.spokeCountDay, 0);
    assert.equal(listImessageMessages((m) => m.chatGuid === guid && m.direction === "out").length, 0,
      "and no outbound row, which is what speaking would have left behind");
    assert.equal(readAudit(200).filter((a) => a.type === "coordination.relayed").length, 0);
  });
});

test("a YES to the relay question reports what actually happened, not what was asked for", async () => {
  // This test was written to pin a BUG and now pins its fix, which is worth saying out loud
  // because the bug was the module's own first principle inverted.
  //
  // The relay-consent YES branch used to do `await speakToChat({...}).catch(() => ({ok:false}))`
  // and DISCARD the result. speakToChat refuses BY VALUE rather than by throwing, for
  // chat_helper_misconfigured, speak_not_authorized, speak_budget_exhausted and send_failed, so
  // every one of those landed as a success: closedReason "relayed", a coordination.relayed audit
  // row, and the person who was asked told "Told <asker>." while nothing left the house.
  //
  // It did not breach rule 3 (nothing reached the group without consent; nothing reached the
  // group at all). It was the other honesty failure, a claim of having spoken, and the person
  // who said yes is precisely the one who needs to know it did not land, because they are the
  // only one who can go and tell the other person themselves.
  const hh = freshHousehold();
  await runWithTenant(hh, async () => {
    putMember({ actorId: "m-alex", displayName: "Alex Harper", role: "Owner", householdId: hh });
    putMember({ actorId: "m-morgan", displayName: "Morgan Harper", role: "Adult Admin", householdId: hh });
    const guid = `iMessage;+;chat-${hh}`;
    putImessageChat({
      id: `ch_${hh}`, householdId: hh, chatGuid: guid, service: "iMessage", displayName: "Harpers",
      status: "bound", boundBy: "m-alex", boundAt: new Date(LOOP_T0).toISOString(), announcedAt: null,
      speakGrant: null, participantSalt: "abcdef0123456789",
      knownParticipants: [], unknownParticipantHashes: [],
      recentMessageIds: [], messageIdsByDay: {},
      lastMessageAt: new Date(LOOP_T0).toISOString(), lastTriagedAt: null, triageCursorAt: null,
      lastSpokeAt: null, spokeDayKey: null, spokeCountDay: 0,
      createdAt: new Date(LOOP_T0).toISOString(), updatedAt: new Date(LOOP_T0).toISOString(),
    });
    const loop = putCoordinationLoop({
      ...loopOver(hh, "Dentist checkup"),
      id: `cl_${hh}`, status: "awaiting_relay_consent", originChatGuid: guid,
      nudgeCount: 1, lastNudgeAt: new Date(LOOP_T0 + DAY).toISOString(),
    });

    // There is no chat helper on this household, so speakToChat refuses by value.
    const reply = await answerLoopReply({ actorId: "m-morgan", text: "yes", nowMs: NOW });
    const after = getCoordinationLoop(loop.id);

    assert.equal(listImessageMessages((m) => m.chatGuid === guid && m.direction === "out").length, 0,
      "nothing was said in the thread");
    assert.equal(getImessageChat(`ch_${hh}`).lastSpokeAt, null);
    assert.match(reply ?? "", /couldn't get a message into the family chat/i,
      "the person who said yes is told the send failed, because they are the one who can act on it");
    assert.match(reply ?? "", /Alex Harper hasn't been told/,
      "and told specifically who did NOT hear it");
    assert.equal(after.closedReason, "relay_failed",
      "a relay that did not happen is not recorded as one");
    assert.equal(readAudit(200).filter((a) => a.type === "coordination.relayed").length, 0,
      "no relayed audit row for a message that does not exist");
    assert.equal(readAudit(200).filter((a) => a.type === "coordination.relay_failed").length, 1,
      "the failure is its own audit row, so downstream can tell the difference");
    assert.equal(after.status, "closed_completed",
      "the loop is still finished: the task was done, only the telling failed");
  });
});

/* ───────────────────────── part four: the invariant ───────────────────────── */

test("transcriptResolution says UNAVAILABLE rather than implying a check it could not run", async () => {
  const hh = freshHousehold();
  await runWithTenant(hh, () => {
    const guid = `iMessage;+;chat-${hh}`;
    setSettings({ chatTranscriptDays: 0, timezone: "UTC" }, hh);
    const loop = loopOver(hh, "Dentist checkup", { originChatGuid: guid });
    assert.deepEqual(transcriptResolution(loop, NOW), { unavailable: true },
      "an ephemeral transcript means 'I could not look', which is not the same as 'nothing was said'");

    assert.equal(transcriptResolution(loopOver(hh, "Dentist checkup"), NOW), null,
      "a loop that never came from a chat has no transcript to be unavailable");
  });
});

test("transcriptResolution reads a later message from THE TARGET, and only from the target", async () => {
  const hh = freshHousehold();
  await runWithTenant(hh, () => {
    setSettings({ chatTranscriptDays: 14, timezone: "UTC" }, hh);
    putMember({ actorId: "m-morgan", displayName: "Morgan Harper", role: "Adult Admin", householdId: hh });
    putMember({ actorId: "m-alex", displayName: "Alex Harper", role: "Owner", householdId: hh });
    const guid = `iMessage;+;chat-${hh}`;
    const chat = putImessageChat({
      id: `ch_${hh}`, householdId: hh, chatGuid: guid, service: "iMessage", displayName: "Harpers",
      status: "bound", boundBy: "m-alex", boundAt: new Date(LOOP_T0).toISOString(), announcedAt: null,
      speakGrant: null, participantSalt: "abcdef0123456789",
      knownParticipants: [], unknownParticipantHashes: [],
      recentMessageIds: [], messageIdsByDay: {},
      lastMessageAt: new Date(LOOP_T0).toISOString(), lastTriagedAt: null, triageCursorAt: null,
      lastSpokeAt: null, spokeDayKey: null, spokeCountDay: 0,
      createdAt: new Date(LOOP_T0).toISOString(), updatedAt: new Date(LOOP_T0).toISOString(),
    });
    // Alex says it is handled. Alex is not the person it is about.
    recordInboundGroupMessage({ chat: getImessageChat(chat.id), msg: { address: "+15550101", text: "all set, I called them" }, memberId: "m-alex", atMs: LOOP_T0 + 6 * 3600_000 });
    const loop = loopOver(hh, "Dentist checkup", { originChatGuid: guid });
    assert.equal(transcriptResolution(loop, NOW), null,
      "somebody else's 'all set' is hearsay about another person's health task");

    recordInboundGroupMessage({ chat: getImessageChat(chat.id), msg: { address: "+15550102", text: "all set, I called them" }, memberId: "m-morgan", atMs: LOOP_T0 + 12 * 3600_000 });
    const hit = transcriptResolution(loop, NOW);
    assert.ok(hit && hit.fromMemberId === "m-morgan", "the target's own word is enough to stop asking");
  });
});

test("THE INVARIANT: transcript evidence may CLOSE a loop and may NEVER be reported as completion", () => {
  // Half one, behavioural: a loop closed on the transcript is stamped as transcript evidence,
  // and closing it puts nothing into the group thread.
  const guid = "iMessage;+;chat-transcript";
  const at = T0 + 12 * 3600_000;
  const dayKey = localDateKey(at, "UTC");
  writeStoreRecord(ctx, "imessage_messages", "im_tr1", {
    id: "im_tr1", householdId: "local", chatGuid: guid, guid: null,
    fromMemberId: "m-morgan", text: "All set, I called them.",
    at: new Date(at).toISOString(), direction: "in",
  });
  seedBoundChat("ch_tr", guid, { recentMessageIds: ["im_tr1"], messageIdsByDay: { [dayKey]: ["im_tr1"] } });
  seedLoop("cl_tr", { text: "Podiatrist referral", originChatGuid: guid });

  const r = runSweep(SWEEP_AT, ctx.dataDir);
  const loop = loopBack("cl_tr");
  assert.equal(loop.status, "closed_resolved", JSON.stringify(r));
  assert.equal(loop.closedReason, "transcript");
  assert.equal(loop.resolutionEvidence.kind, "transcript",
    "recorded for what it is, so nothing downstream can mistake it for a calendar fact");
  assert.equal(loop.resolutionEvidence.ref, "im_tr1");
  assert.equal(r.nudged, 0, "she already said she handled it, so she is not asked again");

  const chat = readStoreRecord(ctx, "imessage_chats", "ch_tr");
  assert.equal(chat.lastSpokeAt, null, "and the family was told nothing on the strength of it");
  assert.equal(outboundRows(guid).length, 0);
  assert.equal(auditLines().filter((a) => a.type === "imessage.spoke" && a.chatId === "ch_tr").length, 0);

  // Half two, structural: there is exactly ONE place in this module that can speak into the
  // group, and it sits behind the target's explicit yes. A second call site anywhere else is
  // the bug this invariant exists to prevent, and it would be invisible at runtime until the
  // day it embarrassed somebody in front of their family.
  const src = fs.readFileSync(SRC_URL, "utf8");
  const callSites = [...src.matchAll(/\bspeakToChat\(/g)].map((m) => m.index);
  assert.equal(callSites.length, 1, "exactly one way into the group thread, or the rule is not enforced by the code");
  const answerAt = src.indexOf("export async function answerLoopReply");
  const relayBranchAt = src.indexOf('loop.status === "awaiting_relay_consent"', answerAt);
  assert.ok(answerAt > 0 && relayBranchAt > answerAt, "answerLoopReply owns the relay-consent branch");
  assert.ok(callSites[0] > relayBranchAt, "and the only speaking call site is inside it");
  assert.equal(src.lastIndexOf("\nexport ", callSites[0]) + 1, answerAt,
    "no other exported function encloses it: not the sweep, not the opener");
});

/* ───────────────────────── part five: not asking again ───────────────────────── */

test("openLoopFromRefusal will not reopen an intent class this person already dismissed", async () => {
  const hh = freshHousehold();
  await runWithTenant(hh, () => {
    putMember({ actorId: "m-alex", displayName: "Alex Harper", role: "Owner", householdId: hh });
    putMember({ actorId: "m-morgan", displayName: "Morgan Harper", role: "Adult Admin", householdId: hh });
    const chat = { id: `ch_${hh}`, householdId: hh, chatGuid: `iMessage;+;chat-${hh}` };

    // "Stop asking me about the dentist", ten days ago.
    putCoordinationLoop({
      ...loopOver(hh, "Book the dentist appointment"),
      id: `cl_${hh}_old`, status: "closed_dismissed", closedReason: "loop_dismissed", dueAt: null,
      updatedAt: new Date(NOW - 10 * DAY).toISOString(),
    });

    const again = openLoopFromRefusal({
      chat, proposal: { id: "cp_1", kind: "event", title: "Get the dentist booked" },
      requestedByActorId: "m-alex", targetActorId: "m-morgan", nowMs: NOW,
    });
    assert.equal(again.ok, false, "a new record for the same ask is the same ask");
    assert.equal(again.error, "loop_dismissed",
      "dismissal is remembered by intent class, not by instance, or next month's loop asks again");
  });
});

test("…but a different ask still opens, and the dismissal lapses once the cooling period has run", async () => {
  const hh = freshHousehold();
  await runWithTenant(hh, () => {
    putMember({ actorId: "m-alex", displayName: "Alex Harper", role: "Owner", householdId: hh });
    putMember({ actorId: "m-morgan", displayName: "Morgan Harper", role: "Adult Admin", householdId: hh });
    setSettings({ timezone: "UTC" }, hh);
    const chat = { id: `ch_${hh}`, householdId: hh, chatGuid: `iMessage;+;chat-${hh}` };
    const dismissed = putCoordinationLoop({
      ...loopOver(hh, "Book the dentist appointment"),
      id: `cl_${hh}_old`, status: "closed_dismissed", closedReason: "loop_dismissed", dueAt: null,
      updatedAt: new Date(NOW - 10 * DAY).toISOString(),
    });

    const other = openLoopFromRefusal({
      chat, proposal: { id: "cp_2", kind: "task", title: "Call the plumber about the boiler" },
      requestedByActorId: "m-alex", targetActorId: "m-morgan", nowMs: NOW,
    });
    assert.equal(other.ok, true, JSON.stringify(other));
    assert.equal(other.loop.status, "watching", "an unrelated ask was never refused, so it opens");
    assert.ok(Date.parse(other.loop.dueAt) > NOW, "and it waits a day before looking, on the household's clock");
    assert.equal(other.loop.nudgeCount, 0);
    assert.equal(other.loop.resolutionEvidence, null);

    // Push the dismissal just past the cooling window and the same ask is allowed back.
    putCoordinationLoop({ ...dismissed, updatedAt: new Date(NOW - DISMISS_COOLING_MS - DAY).toISOString() });
    const lapsed = openLoopFromRefusal({
      chat, proposal: { id: "cp_3", kind: "event", title: "Get the dentist booked" },
      requestedByActorId: "m-alex", targetActorId: "m-morgan", nowMs: NOW,
    });
    assert.equal(lapsed.ok, true, "a no is honoured for a season, not forever");

    // And a loop about somebody who is no longer here is never opened at all.
    const gone = openLoopFromRefusal({
      chat, proposal: { id: "cp_4", kind: "event", title: "Get the optician booked" },
      requestedByActorId: "m-alex", targetActorId: "m-nobody", nowMs: NOW,
    });
    assert.equal(gone.ok, false);
    assert.equal(gone.error, "loop_target_gone");
  });
});
