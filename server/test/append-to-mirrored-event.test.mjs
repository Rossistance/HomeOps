// Q2 — "For events from outside calendars it says *edit at the source, or copy it on the
// web app*. Let me append to it here in FamiliOS without syncing it back out."
//
// A mirrored event has two halves. The calendar it came from owns WHEN and WHERE it is —
// change that here and the next sync silently undoes you, or doesn't, and this household
// ends up reading a different event from everyone else on the invite. But who's coming,
// what to bring, the reminder, the pickup note: the source calendar has never heard of
// those. They're FamiliOS's own, the sync never writes them, and there was never a reason
// to refuse them.
//
// So the refusal is narrowed to the source's half — by name — and the rest goes through.
// The tests that matter most are the two negatives: the source's fields are still refused,
// and a re-sync doesn't wipe what was added.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, writeStoreDoc, readStoreDoc } from "./harness.mjs";

const HH = "local";
let ctx, adult;

before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan");
  writeStoreDoc(ctx, "calendar_subscriptions.json", {
    sub_school: { id: "sub_school", householdId: HH, source: "ics", name: "School district calendar" },
  });
  writeStoreDoc(ctx, "events.json", {
    // An ICS mirror — the case in the video. Nobody in this household owns it.
    ev_mirror: {
      id: "ev_mirror", householdId: HH, title: "Early dismissal", startAt: new Date(2026, 8, 9, 12, 30).toISOString(),
      layer: "linked", visibility: "household", source: "School district calendar",
      notes: "Buses run two hours early.", whatToBring: [], participantIds: [],
      provenance: { via: "ics", subscriptionId: "sub_school", uid: "u-dismissal" },
    },
    ev_own: {
      id: "ev_own", householdId: HH, title: "Typed into FamiliOS", startAt: new Date(2026, 8, 10, 9).toISOString(),
      layer: "canonical", visibility: "household", ownerId: "m-morgan", provenance: { via: "user" },
    },
  });
});
after(async () => { await stopServer(ctx); });

const patch = (id, body) => adult.req(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify(body) });
const get = async (id) => (await adult.req("/api/events")).data.events.find((e) => e.id === id);

/* ---- what he asked for ---- */

test("Q2: FamiliOS's own details can be added to an event from an outside calendar", async () => {
  const r = await patch("ev_mirror", {
    localNotes: "Pickup is at the side gate, not the front.",
    participantIds: ["m-morgan"],
    whatToBring: [{ item: "Booster seat", memberId: null }],
    reminders: [{ minutesBefore: 30 }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.event.localNotes, "Pickup is at the side gate, not the front.");
  assert.deepEqual(r.data.event.participantIds, ["m-morgan"]);
  assert.equal(r.data.event.whatToBring[0].item, "Booster seat");
});

test("…and it says plainly that nothing left the app", async () => {
  const r = await patch("ev_mirror", { localNotes: "Ross is driving." });
  assert.equal(r.data.localOnly, true, "the promise in the request is the answer in the response");
});

/* ---- the source's half is still the source's ---- */

test("NEGATIVE: the time, title and place still can't be changed here", async () => {
  for (const [field, value] of [["title", "Renamed"], ["startAt", new Date(2026, 8, 9, 8).toISOString()], ["location", "Somewhere else"]]) {
    const r = await patch("ev_mirror", { [field]: value });
    assert.equal(r.status, 409, `${field} must be refused`);
    assert.equal(r.data.error, "read_only_layer");
    assert.deepEqual(r.data.fields, [field], "and the refusal names WHICH field, not just 'this event'");
  }
  const after = await get("ev_mirror");
  assert.equal(after.title, "Early dismissal", "nothing was written");
});

test("NEGATIVE: the source's own description is its own — a local note is a separate thing", async () => {
  const r = await patch("ev_mirror", { notes: "overwritten" });
  assert.equal(r.status, 409);
  const after = await get("ev_mirror");
  assert.equal(after.notes, "Buses run two hours early.", "still what the school wrote");
  assert.match(after.localNotes, /Ross is driving/, "and the household's own note is untouched beside it");
});

test("a mixed patch is refused WHOLE — half-applying an edit is worse than refusing it", async () => {
  const before = await get("ev_mirror");
  const r = await patch("ev_mirror", { title: "Renamed", localNotes: "and this too" });
  assert.equal(r.status, 409);
  const after = await get("ev_mirror");
  assert.equal(after.localNotes, before.localNotes, "the appendable half was NOT quietly applied");
});

/* ---- the point of the whole thing: it survives ---- */

test("a re-sync of the source calendar does not wipe what was added here", async () => {
  await patch("ev_mirror", { localNotes: "Side gate.", whatToBring: [{ item: "Booster seat", memberId: null }] });
  // What a sync writes back onto an existing mirror: the source's half, and nothing else.
  const events = readStoreDoc(ctx, "events.json");
  events.ev_mirror = { ...events.ev_mirror, title: "Early dismissal (updated)", startAt: new Date(2026, 8, 9, 12, 0).toISOString() };
  writeStoreDoc(ctx, "events.json", events);
  const after = await get("ev_mirror");
  assert.equal(after.title, "Early dismissal (updated)", "the source moved, as it should");
  assert.equal(after.localNotes, "Side gate.", "and the household's note is still there");
  assert.equal(after.whatToBring[0].item, "Booster seat");
});

/* ---- and the client can tell the two questions apart ---- */

test("a mirror reports editable:false and appendable:true — they are different questions", async () => {
  const e = await get("ev_mirror");
  assert.equal(e.editable, false);
  assert.equal(e.appendable, true, "otherwise the app has no way to offer what the server allows");
});

test("your own event is both", async () => {
  const e = await get("ev_own");
  assert.equal(e.editable, true);
  assert.equal(e.appendable, true);
});

test("a child still can't append to someone else's event", async () => {
  const child = await makeSession(ctx, "m-lily");
  const r = await child.req("/api/events/ev_mirror", { method: "PATCH", body: JSON.stringify({ localNotes: "hi" }) });
  assert.equal(r.status, 403, "appending is not a way around who may touch an event");
});

test("your own notes never reach the outside calendar", async () => {
  // The guarantee is structural, not a promise: the Google body is composed from `notes`
  // and the Bring list only, so a local note has no path out even on a pushed event.
  const { composeGoogleDescription } = await import("../calendar.mjs");
  const out = composeGoogleDescription({ notes: "Shared with the school", localNotes: "OUR PRIVATE NOTE", whatToBring: [] });
  assert.ok(!out.includes("OUR PRIVATE NOTE"));
  assert.match(out, /Shared with the school/);
});
