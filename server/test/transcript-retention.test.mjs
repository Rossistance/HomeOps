// A transcript that can only be read forwards, and has to be able to forget.
//
// The family's group chat is the one place FamiliOS holds a conversation it did not host, so
// what it keeps, how it finds it again, and how it lets go are one question asked three ways.
// All three answers are shaped by a single property of this database: there are no secondary
// indexes and no ORDER BY anywhere (tenant-db.mjs). The only sub-linear read is a point read
// on (collection, id). Nothing on this path may scan.
//
// So the chat record carries its own index, and every stored message joins TWO of them. The
// reason there are two is the thing most likely to be lost in a later tidy-up. The ring,
// recentMessageIds, is capped at 40 and serves the classifier, which wants the last few
// things said, cheaply, on every inbound message. The day buckets, messageIdsByDay, serve a
// coordination loop's 24-48h audit, which asks "has anyone settled this since Tuesday" and
// in a busy family chat runs straight past a 40-message cap. Drop the buckets as redundant
// and that audit silently stops seeing the message that resolved the thing: the health task
// the family raised on purpose then reads as unanswered and gets knocked about again. That
// is why the third test pushes sixty messages and asserts the audit reads all sixty while
// the ring reads forty.
//
// Retention runs the same way round. Pruning drops whole day buckets and point-deletes their
// rows; it never asks the rows which of them are old, because asking would be the scan. The
// default window is 0 days, and 0 means EPHEMERAL rather than forever: today's bucket only,
// so the classifier still has something to read and nothing outlives the conversation.
//
// The last rule is not about chat at all. pruneChatTranscript runs on the triage path, on
// family chat volume, and must write NOTHING when no bucket has expired. The CI
// data-isolation job hashes the live server's data dir and requires it byte-identical while
// this suite runs beside it, so a sweep that stamps updatedAt on every pass fails that job
// and churns every household's database every minute, forever. That one is named loudly
// below.
//
// No clock injection exists in this suite. Every instant here is derived from one fixed
// anchor and every function under test is handed an explicit nowMs, so nothing depends on
// how long the file takes to run or on which day CI runs it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Chosen before the first import of ../store.mjs, which resolves its data dir at import
// time: this whole file runs in-process against a throwaway database, with no server.
process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-transcript-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const {
  runWithTenant, setSettings, getSettings, putMember,
  putImessageChat, getImessageChat, getImessageMessage,
} = await import("../store.mjs");
const {
  recordInboundGroupMessage, recentMessages, messagesBetween, pruneChatTranscript,
} = await import("../group-chat.mjs");
const { localDateKey } = await import("../household-time.mjs");

/** Two households, because one of the rules under test IS the absence of a setting.
 *  EPHEMERAL never has chatTranscriptDays written to it, so test five reads the real
 *  default rather than a value this file put there. */
const EPHEMERAL = "hh_transcript_eph";
const KEEPS_A_WEEK = "hh_transcript_7d";
const TZ = "America/Denver";              // not UTC, so "which day" is a household question
const DAY = 86400000;
const HOUR = 3600_000;
// Midday in Denver, far from any DST edge: every derived instant below stays on the day
// the arithmetic says it is on.
const T0 = Date.UTC(2026, 4, 12, 18, 0, 0);

for (const hh of [EPHEMERAL, KEEPS_A_WEEK]) {
  await runWithTenant(hh, () => {
    setSettings(hh === KEEPS_A_WEEK ? { timezone: TZ, chatTranscriptDays: 7 } : { timezone: TZ }, hh);
    putMember({ actorId: "m-alex", displayName: "Alex Harper", role: "Owner", householdId: hh });
    putMember({ actorId: "m-morgan", displayName: "Morgan Harper", role: "Adult Admin", householdId: hh });
  });
}

let seq = 0;
/** A bound chat, in the shape notePendingChat/bindChat leave one. Fresh per test, so no
 *  test inherits another's indexes. */
function seedChat(householdId) {
  const n = ++seq;
  const stamp = new Date(T0).toISOString();
  return putImessageChat({
    id: `ch_transcript_${n}`, householdId, chatGuid: `iMessage;+;chat-transcript-${n}`,
    service: "iMessage", displayName: "Harpers", status: "bound",
    boundBy: "m-alex", boundAt: stamp, announcedAt: stamp, speakGrant: "household",
    participantSalt: "0123456789abcdef", knownParticipants: [], unknownParticipantHashes: [],
    recentMessageIds: [], messageIdsByDay: {},
    lastMessageAt: stamp, lastTriagedAt: null, triageCursorAt: null,
    lastSpokeAt: null, spokeDayKey: null, spokeCountDay: 0,
    createdAt: stamp, updatedAt: stamp,
  });
}

/** One member message through the real recorder, always from a FRESH read of the chat:
 *  recordInboundGroupMessage builds its patch from the record it is handed, so passing a
 *  stale one would quietly rewind both indexes. */
function say(chatId, text, atMs, memberId = "m-alex") {
  const chat = getImessageChat(chatId);
  const address = memberId === "m-alex" ? "+15550101" : "+15550102";
  const res = recordInboundGroupMessage({
    chat, msg: { address, text, guid: `bb_${chatId}_${text}` }, memberId, atMs,
  });
  assert.equal(res.stored, true, `a member's message must be stored: ${text}`);
  return res.row;
}

/* ───────────────── arrival: one message, two indexes ───────────────── */

test("a member's message lands on BOTH indexes, in the household's own day", async () => {
  await runWithTenant(EPHEMERAL, () => {
    const chat = seedChat(EPHEMERAL);
    const row = say(chat.id, "soccer moved to 4", T0);

    const fresh = getImessageChat(chat.id);
    assert.deepEqual(fresh.recentMessageIds, [row.id], "the ring the classifier reads");
    assert.deepEqual(fresh.messageIdsByDay, { "2026-05-12": [row.id] }, "and the day bucket the audit reads");

    const stored = getImessageMessage(row.id);
    assert.equal(stored.text, "soccer moved to 4", "the row itself is durable, not just the index entry");
    assert.equal(stored.fromMemberId, "m-alex", "and it knows who said it");
    assert.equal(stored.direction, "in", "inbound");

    // 03:00 UTC the next calendar day is still 21:00 the same evening in Denver. The bucket
    // key is the FAMILY's day, which is the only day boundary a 24-48h audit can mean.
    const lateRow = say(chat.id, "and bring the shin pads", T0 + 9 * HOUR);
    const after = getImessageChat(chat.id);
    assert.equal(localDateKey(T0 + 9 * HOUR, "UTC"), "2026-05-13", "the fixture really does cross midnight UTC");
    assert.deepEqual(Object.keys(after.messageIdsByDay), ["2026-05-12"],
      "a late-evening message stays on the family's day, not the server's");
    assert.deepEqual(after.messageIdsByDay["2026-05-12"], [row.id, lateRow.id], "appended in arrival order");
  });
});

/* ───────────────── the ring is a ring ───────────────── */

test("the ring is capped at 40 and holds the LAST 40", async () => {
  await runWithTenant(EPHEMERAL, () => {
    const chat = seedChat(EPHEMERAL);
    const ids = [];
    for (let i = 0; i < 50; i++) ids.push(say(chat.id, `line ${String(i).padStart(2, "0")}`, T0 + i * 60_000).id);

    const fresh = getImessageChat(chat.id);
    assert.equal(fresh.recentMessageIds.length, 40, "fifty in, forty held");
    assert.deepEqual(fresh.recentMessageIds, ids.slice(-40), "the newest forty, in order, and the oldest ten gone");
    assert.deepEqual(recentMessages(fresh).map((m) => m.id), ids.slice(-40),
      "recentMessages resolves the ring by point read and returns it whole");

    assert.equal(fresh.messageIdsByDay["2026-05-12"].length, 50, "the day bucket kept all fifty");
    assert.ok(getImessageMessage(ids[0]), "falling off the ring is not deletion: the row is still there");
  });
});

/* ───────────────── why the buckets exist at all ───────────────── */

test("THE BUCKETS EARN THEIR KEEP: a multi-day audit reads past the ring's last 40", async () => {
  await runWithTenant(EPHEMERAL, () => {
    const chat = seedChat(EPHEMERAL);
    const expected = [];
    for (let d = 0; d < 3; d++) {
      for (let i = 0; i < 20; i++) {
        const text = `day ${d} line ${String(i).padStart(2, "0")}`;
        say(chat.id, text, T0 + d * 2 * DAY + i * 60_000);
        expected.push(text);
      }
    }

    const fresh = getImessageChat(chat.id);
    assert.deepEqual(Object.keys(fresh.messageIdsByDay).sort(), ["2026-05-12", "2026-05-14", "2026-05-16"],
      "three days, two apart, so the walk between them has to cross empty days");

    const span = messagesBetween(fresh, T0 - DAY, T0 + 5 * DAY);
    assert.equal(span.length, 60, "all sixty, across three buckets");
    assert.deepEqual(span.map((m) => m.text), expected, "and in the order they were said, oldest first");

    assert.equal(recentMessages(fresh).length, 40, "meanwhile the ring still sees forty, which is its job");

    // This is the assertion the buckets exist for. Twenty of those messages are invisible to
    // the classifier's window, and a coordination loop's 24-48h audit still reads every one.
    const ring = new Set(fresh.recentMessageIds);
    const beyondRing = span.filter((m) => !ring.has(m.id));
    assert.equal(beyondRing.length, 20, "twenty messages the ring can no longer reach, all readable by day");
    assert.deepEqual(beyondRing.map((m) => m.text), expected.slice(0, 20), "and they are the OLDEST twenty");
  });
});

test("messagesBetween filters by instant, not just by bucket", async () => {
  await runWithTenant(EPHEMERAL, () => {
    const chat = seedChat(EPHEMERAL);
    say(chat.id, "before the window", T0);
    say(chat.id, "exactly at the lower bound", T0 + 1 * HOUR);
    say(chat.id, "inside", T0 + 6 * HOUR);
    say(chat.id, "exactly at the upper bound", T0 + 12 * HOUR);
    say(chat.id, "a different day entirely", T0 + 2 * DAY);

    const got = messagesBetween(getImessageChat(chat.id), T0 + 1 * HOUR, T0 + 12 * HOUR);
    assert.deepEqual(got.map((m) => m.text),
      ["exactly at the lower bound", "inside", "exactly at the upper bound"],
      "the bucket is a coarse index; both bounds are inclusive and the timestamp decides");
  });
});

/* ───────────────── retention ───────────────── */

test("chatTranscriptDays defaults to 0, and 0 means EPHEMERAL: only today survives", async () => {
  await runWithTenant(EPHEMERAL, () => {
    assert.equal(getSettings(EPHEMERAL).chatTranscriptDays, undefined,
      "nothing set it on this household: the default is what is under test");

    const chat = seedChat(EPHEMERAL);
    const yesterday = say(chat.id, "who is driving tomorrow", T0);
    const today = say(chat.id, "I am", T0 + DAY);
    assert.deepEqual(Object.keys(getImessageChat(chat.id).messageIdsByDay).sort(),
      ["2026-05-12", "2026-05-13"], "two days on the record before the prune");

    const res = pruneChatTranscript(getImessageChat(chat.id), T0 + DAY);
    assert.deepEqual(res, { dropped: 1, buckets: 1 }, "one bucket expired, one row deleted with it");

    const after = getImessageChat(chat.id);
    assert.deepEqual(Object.keys(after.messageIdsByDay), ["2026-05-13"], "today's bucket, and only today's");
    assert.ok(!getImessageMessage(yesterday.id), "the ROW is gone, not merely unindexed: ephemeral has to mean deleted");
    assert.equal(getImessageMessage(today.id)?.text, "I am", "and today's message is still readable");
  });
});

test("with chatTranscriptDays 7, seven days survive and the eighth does not", async () => {
  await runWithTenant(KEEPS_A_WEEK, () => {
    assert.equal(getSettings(KEEPS_A_WEEK).chatTranscriptDays, 7, "this household asked to keep a week");
    const chat = seedChat(KEEPS_A_WEEK);
    const now = T0 + 10 * DAY;

    const tenDaysOld = say(chat.id, "ten days ago", now - 10 * DAY);
    const eightDaysOld = say(chat.id, "eight days ago", now - 8 * DAY);
    const onTheEdge = say(chat.id, "seven days ago", now - 7 * DAY);
    const recent = say(chat.id, "three days ago", now - 3 * DAY);
    const today = say(chat.id, "this morning", now);

    const res = pruneChatTranscript(getImessageChat(chat.id), now);
    assert.deepEqual(res, { dropped: 2, buckets: 2 }, "the two buckets outside the week, and nothing else");

    for (const row of [onTheEdge, recent, today]) {
      assert.ok(getImessageMessage(row.id), `inside the window and still here: ${row.text}`);
    }
    assert.ok(!getImessageMessage(tenDaysOld.id), "ten days is past a seven-day window");
    assert.ok(!getImessageMessage(eightDaysOld.id), "and so is eight, which is the boundary that matters");

    const after = getImessageChat(chat.id);
    assert.deepEqual(Object.keys(after.messageIdsByDay).sort(), ["2026-05-15", "2026-05-19", "2026-05-22"],
      "three buckets left, each one a day the family is still inside");
  });
});

test("A PRUNE THAT DROPS NOTHING WRITES NOTHING: an idle household must produce no writes at all", async () => {
  // The loud one. The CI data-isolation job hashes the live server's data dir and requires it
  // byte-identical while this suite runs beside it. pruneChatTranscript is called on the
  // triage path, so a version that patches unconditionally would fail that job and, worse,
  // rewrite every household's chat record every minute for as long as the deployment lives.
  await runWithTenant(KEEPS_A_WEEK, () => {
    const chat = seedChat(KEEPS_A_WEEK);
    const row = say(chat.id, "nothing here is old yet", T0);
    const before = getImessageChat(chat.id);

    const res = pruneChatTranscript(before, T0 + 2 * HOUR);
    assert.deepEqual(res, { dropped: 0, buckets: 0 }, "it reports having done nothing");
    assert.deepEqual(getImessageChat(chat.id), before,
      "and the whole record is byte-identical: no updatedAt stamp, no rewritten index, no write");
    assert.equal(getImessageMessage(row.id)?.text, "nothing here is old yet", "the rows are untouched too");

    // The same must hold for the emptiest case there is, which is most households most days.
    const empty = seedChat(KEEPS_A_WEEK);
    const emptyBefore = getImessageChat(empty.id);
    assert.deepEqual(pruneChatTranscript(emptyBefore, T0 + 30 * DAY), { dropped: 0, buckets: 0 },
      "a chat with no buckets has nothing to expire, however far the clock has moved");
    assert.deepEqual(getImessageChat(empty.id), emptyBefore, "and it is not written either");
  });
});

test("the ring is repaired by a prune: no id may point at a row that was deleted", async () => {
  await runWithTenant(EPHEMERAL, () => {
    const chat = seedChat(EPHEMERAL);
    const older = [];
    for (let i = 0; i < 5; i++) older.push(say(chat.id, `day one ${i}`, T0 + i * 60_000).id);
    const newer = [];
    for (let i = 0; i < 3; i++) newer.push(say(chat.id, `day two ${i}`, T0 + DAY + i * 60_000).id);

    const before = getImessageChat(chat.id);
    assert.deepEqual(before.recentMessageIds, [...older, ...newer],
      "the ring spans both days while both days exist");

    pruneChatTranscript(before, T0 + DAY);

    const after = getImessageChat(chat.id);
    assert.deepEqual(after.recentMessageIds, newer,
      "every id whose row was deleted left the ring with it, rather than lingering as a dangling point read");
    assert.deepEqual(recentMessages(after).map((m) => m.id), newer,
      "so the classifier's window is what the record says it is, with nothing quietly filtered out on read");
  });
});
