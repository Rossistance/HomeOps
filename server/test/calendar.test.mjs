// CAL — ICS parser + calendar subscriptions (the read-only "linked" calendar layer).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { parseICS } from "../ics.mjs";
import { mapGoogleEvents } from "../calendar.mjs";

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:evt-1@school
SUMMARY:Picture Day
DTSTART;VALUE=DATE:20260115
LOCATION:Riverside Elementary
END:VEVENT
BEGIN:VEVENT
UID:evt-2@school
SUMMARY:Parent-Teacher Conference\, room 12
DTSTART:20260120T163000Z
DTEND:20260120T170000Z
END:VEVENT
END:VCALENDAR`;

/** Unique two-event ICS per test — re-importing the SAME feed content under a new
 * subscription now DEDUPES into the first subscription's events (shared-event
 * merging), so tests that want independent events need distinct content. */
function uniqueIcs(tag) {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:evt-1@${tag}
SUMMARY:${tag} kickoff
DTSTART:20260210T160000Z
END:VEVENT
BEGIN:VEVENT
UID:evt-2@${tag}
SUMMARY:${tag} wrap-up
DTSTART:20260211T160000Z
END:VEVENT
END:VCALENDAR`;
}

test("parseICS reads VEVENTs, dates (all-day + UTC), and unescapes text", () => {
  const events = parseICS(ICS);
  assert.equal(events.length, 2);
  const pic = events.find((e) => e.uid === "evt-1@school");
  assert.equal(pic.title, "Picture Day");
  assert.equal(pic.startAt, "2026-01-15");
  assert.equal(pic.allDay, true);
  assert.equal(pic.location, "Riverside Elementary");
  const ptc = events.find((e) => e.uid === "evt-2@school");
  assert.equal(ptc.title, "Parent-Teacher Conference, room 12"); // \, unescaped
  assert.equal(ptc.startAt, "2026-01-20T16:30:00.000Z");
  assert.equal(ptc.endAt, "2026-01-20T17:00:00.000Z");
});

let ctx, adult, child;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");    // Child View
});
after(async () => { await stopServer(ctx); });

test("a child cannot subscribe to a calendar", async () => {
  const r = await child.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ ics: ICS }) });
  assert.equal(r.status, 403);
});

test("importing an .ics creates read-only linked events, then re-import updates (no dupes)", async () => {
  const imp = await adult.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "School", ics: ICS }) });
  assert.equal(imp.status, 200);
  assert.equal(imp.data.sync.imported, 2);
  const subId = imp.data.subscription.id;

  // The events show up in the household calendar, tagged linked + from the feed.
  const events = (await adult.req("/api/events")).data.events;
  const linked = events.filter((e) => e.layer === "linked" && e.provenance?.subscriptionId === subId);
  assert.equal(linked.length, 2, "two linked events imported");
  const pic = linked.find((e) => e.title === "Picture Day");

  // Linked events are read-only — editing is refused (copy-to-edit).
  const edit = await adult.req(`/api/events/${pic.id}`, { method: "PATCH", body: JSON.stringify({ title: "hacked" }) });
  assert.equal(edit.status, 409);
  assert.equal(edit.data.error, "read_only_layer");

  // Re-syncing the same feed updates by UID — does NOT duplicate.
  const resync = await adult.req(`/api/calendar/subscriptions/${subId}/sync`, { method: "POST" });
  assert.equal(resync.status, 200);
  const after = (await adult.req("/api/events")).data.events.filter((e) => e.provenance?.subscriptionId === subId);
  assert.equal(after.length, 2, "still two — updated, not duplicated");
});

test("the same event arriving via two subscriptions merges into one card", async () => {
  const ics = uniqueIcs("shared");
  const a = (await adult.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "Ross's calendar", ics }) })).data;
  assert.equal(a.sync.imported, 2);
  const b = (await adult.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "Melissa's calendar", ics }) })).data;
  assert.equal(b.sync.imported, 0, "second subscription creates no duplicates");
  assert.equal(b.sync.merged, 2, "both events attached to the existing cards");
  const events = (await adult.req("/api/events")).data.events.filter((e) => /shared (kickoff|wrap-up)/.test(e.title));
  assert.equal(events.length, 2, "one card per real-world event");
  for (const e of events) {
    assert.equal(e.provenance.subscriptionId, a.subscription.id);
    assert.deepEqual(e.provenance.alsoSubscriptionIds, [b.subscription.id], "second calendar rides along on the same card");
  }
  // Removing the OWNING subscription hands the card to the other one instead of deleting it.
  await adult.req(`/api/calendar/subscriptions/${a.subscription.id}`, { method: "DELETE" });
  const after = (await adult.req("/api/events")).data.events.filter((e) => /shared (kickoff|wrap-up)/.test(e.title));
  for (const e of after) assert.equal(e.provenance.subscriptionId, b.subscription.id, "ownership transferred, event survives");
  await adult.req(`/api/calendar/subscriptions/${b.subscription.id}`, { method: "DELETE" }); // cleanup
});

test("unsubscribing removes the subscription's linked events", async () => {
  const imp = (await adult.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "Sports", ics: uniqueIcs("sports") }) })).data;
  const subId = imp.subscription.id;
  const before = (await adult.req("/api/events")).data.events.filter((e) => e.provenance?.subscriptionId === subId);
  assert.equal(before.length, 2);
  const del = await adult.req(`/api/calendar/subscriptions/${subId}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  assert.equal(del.data.removedEvents, 2);
  const after = (await adult.req("/api/events")).data.events.filter((e) => e.provenance?.subscriptionId === subId);
  assert.equal(after.length, 0, "linked events removed with the subscription");
});

test("garbage input is rejected as not-a-calendar", async () => {
  const r = await adult.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ ics: "hello world" }) });
  assert.equal(r.status, 422);
});

test("mapGoogleEvents normalizes Google Calendar items (timed, all-day, cancelled)", () => {
  const items = [
    { id: "g1", summary: "Soccer", start: { dateTime: "2026-03-01T17:00:00Z" }, end: { dateTime: "2026-03-01T18:00:00Z" }, location: "Field 3" },
    { id: "g2", summary: "Spring Break", start: { date: "2026-03-16" }, end: { date: "2026-03-20" } },
    { id: "g3", summary: "Cancelled thing", status: "cancelled", start: { dateTime: "2026-03-02T10:00:00Z" } },
  ];
  const mapped = mapGoogleEvents(items);
  assert.equal(mapped.length, 2, "cancelled events are dropped");
  assert.equal(mapped[0].uid, "g1");
  assert.equal(mapped[0].startAt, "2026-03-01T17:00:00Z");
  assert.equal(mapped[0].allDay, false);
  assert.equal(mapped[1].allDay, true, "date-only start is all-day");
  assert.equal(mapped[1].startAt, "2026-03-16");
});

test("connect-google without a connected Google account returns a helpful 422", async () => {
  const r = await adult.req("/api/calendar/connect-google", { method: "POST" });
  assert.equal(r.status, 422);
  assert.equal(r.data.error, "connect_google_first");
});

test("a child cannot connect Google Calendar", async () => {
  const r = await child.req("/api/calendar/connect-google", { method: "POST" });
  assert.equal(r.status, 403);
});

/* ---- GC.3: push (FamiliOS → Google), approval-gated + deduped ---- */
test("pushing a synced (linked) event is refused", async () => {
  // Import creates linked events; those can't be pushed back to Google.
  const imp = (await adult.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ ics: uniqueIcs("pushcheck") }) })).data;
  const linked = (await adult.req("/api/events")).data.events.find((e) => e.provenance?.subscriptionId === imp.subscription.id);
  const r = await adult.req(`/api/calendar/push/${linked.id}`, { method: "POST" });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "not_pushable");
  await adult.req(`/api/calendar/subscriptions/${imp.subscription.id}`, { method: "DELETE" }); // cleanup
});

test("pushing a canonical event with no Google account returns a helpful 422", async () => {
  const ev = (await adult.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Dentist", startAt: "2026-04-01T15:00:00.000Z" }) })).data.event;
  const r = await adult.req(`/api/calendar/push/${ev.id}`, { method: "POST" });
  assert.equal(r.status, 422);
  assert.equal(r.data.error, "connect_google_first");
  await adult.req(`/api/events/${ev.id}`, { method: "DELETE" });
});

test("pushing a canonical event WITH a Google account requires approval first (approval-gated write)", async () => {
  // Seed a Google account (with calendar scope) owned by m-morgan directly into the store.
  const { writeStoreDoc } = await import("./harness.mjs");
  writeStoreDoc(ctx, "accounts.json", [
    { id: "acct_morgan_google", provider: "google", displayName: "morgan@harper.example", scopes: ["https://www.googleapis.com/auth/calendar.events"], status: "connected", connectedByActorId: "m-morgan", householdId: "local", createdAt: Date.now(), updatedAt: new Date().toISOString() },
  ]);
  const ev = (await adult.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Soccer game", startAt: "2026-04-02T17:00:00.000Z", location: "Field 3" }) })).data.event;
  const r = await adult.req(`/api/calendar/push/${ev.id}`, { method: "POST" });
  assert.equal(r.status, 200);
  assert.equal(r.data.needsApproval, true, "writing to the real Google calendar needs sign-off first");
  assert.ok(r.data.approval?.id, "an approval was created");
  assert.equal(r.data.approval.toolId, "calendar.create");
  await adult.req(`/api/events/${ev.id}`, { method: "DELETE" });
});

test("a child cannot push an event to Google", async () => {
  const ev = (await adult.req("/api/events", { method: "POST", body: JSON.stringify({ title: "X", startAt: "2026-04-03T10:00:00.000Z" }) })).data.event;
  const r = await child.req(`/api/calendar/push/${ev.id}`, { method: "POST" });
  assert.equal(r.status, 403);
  await adult.req(`/api/events/${ev.id}`, { method: "DELETE" });
});
