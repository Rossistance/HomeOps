// The Connections matrix — who may view, sync, change, mark as work, reassign, remove and add
// a connected calendar — agreed with the household owner and kept in ONE pure module
// (calendar-permissions.mjs). Three layers here:
//   (a) the matrix itself, every viewer role against every owner role, own and not own;
//   (b) the add rules (children never, Owner-only for others, a Limited Member's one);
//   (c) the routes, through the real server, including what a feed URL may reach;
//   plus the boot migration that names an owner on every legacy calendar.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, readStoreRecord } from "./harness.mjs";
import { calendarCan, canAddCalendar, subscriptionOwnerId, ADULT_ROLES } from "../calendar-permissions.mjs";

/* ------------------------------ (a) the matrix ------------------------------ */

// Letters: V view, S sync, E edit, W markWork, A assign, R remove, P scope.
// "own" rows exist only where viewer and owner share a role (it is the same person).
const MATRIX = {
  "Owner|Owner|own": "VSEWAR",
  "Owner|Owner|other": "VSEWAR",
  "Owner|Adult Admin|other": "VSEWAR",
  "Owner|Adult Member|other": "VSEWAR",
  "Owner|Limited Member|other": "VSEARP",
  "Owner|Child View|other": "VSEAR",

  "Adult Admin|Owner|other": "V",
  "Adult Admin|Adult Admin|own": "VSEWR",
  "Adult Admin|Adult Admin|other": "VSEW",
  "Adult Admin|Adult Member|other": "VSEW",
  "Adult Admin|Limited Member|other": "VSER",
  "Adult Admin|Child View|other": "VSER",

  "Adult Member|Owner|other": "",
  "Adult Member|Adult Admin|other": "",
  "Adult Member|Adult Member|own": "VSEWR",
  "Adult Member|Adult Member|other": "",
  "Adult Member|Limited Member|other": "",
  "Adult Member|Child View|other": "",

  "Limited Member|Owner|other": "",
  "Limited Member|Adult Admin|other": "",
  "Limited Member|Adult Member|other": "",
  "Limited Member|Limited Member|own": "VS",
  "Limited Member|Limited Member|other": "",
  "Limited Member|Child View|other": "",

  "Child View|Owner|other": "",
  "Child View|Adult Admin|other": "",
  "Child View|Adult Member|other": "",
  "Child View|Limited Member|other": "",
  "Child View|Child View|own": "",
  "Child View|Child View|other": "",

  "Guest/Helper|Owner|other": "",
  "Guest/Helper|Adult Admin|other": "",
  "Guest/Helper|Adult Member|other": "",
  "Guest/Helper|Limited Member|other": "",
  "Guest/Helper|Child View|other": "",
};
const FLAGS = { V: "view", S: "sync", E: "edit", W: "markWork", A: "assign", R: "remove", P: "scope" };

test("calendarCan: every viewer role × owner role × own/not-own matches the agreed matrix", () => {
  const VIEWERS = ["Owner", "Adult Admin", "Adult Member", "Limited Member", "Child View", "Guest/Helper"];
  const OWNERS = ["Owner", "Adult Admin", "Adult Member", "Limited Member", "Child View"];
  let checked = 0;
  for (const v of VIEWERS) for (const o of OWNERS) for (const own of [true, false]) {
    if (own && v !== o) continue;
    const key = `${v}|${o}|${own ? "own" : "other"}`;
    assert.ok(key in MATRIX, `the table covers ${key}`);
    const viewer = { actorId: "m-viewer", role: v };
    const owner = { actorId: own ? "m-viewer" : "m-someone", role: o };
    const got = calendarCan(viewer, { id: "sub_x" }, owner);
    for (const [letter, flag] of Object.entries(FLAGS)) {
      assert.equal(got[flag], MATRIX[key].includes(letter), `${key}: ${flag}`);
    }
    checked++;
  }
  assert.equal(checked, Object.keys(MATRIX).length);
});

test("calendarCan: a legacy calendar with no owner — Owner everything, Admin view/sync/edit, nobody else", () => {
  const sub = { id: "sub_legacy" };
  const o = calendarCan({ actorId: "a", role: "Owner" }, sub, null);
  assert.ok(o.view && o.sync && o.edit && o.assign && o.remove);
  assert.equal(o.markWork, false, "Work needs an adult OWNER, and a legacy calendar has none until assigned");
  assert.deepEqual(calendarCan({ actorId: "m", role: "Adult Admin" }, sub, null),
    { view: true, sync: true, edit: true, markWork: false, assign: false, remove: false, scope: false });
  for (const role of ["Adult Member", "Limited Member", "Child View", "Guest/Helper"]) {
    assert.ok(Object.values(calendarCan({ actorId: "x", role }, sub, null)).every((f) => f === false), role);
  }
});

test("subscriptionOwnerId: assignment, then the connecting account, then the adder", () => {
  assert.equal(subscriptionOwnerId({ ownerActorId: "m-a", createdBy: "m-c" }, { connectedByActorId: "m-b" }), "m-a");
  assert.equal(subscriptionOwnerId({ createdBy: "m-c" }, { connectedByActorId: "m-b" }), "m-b");
  assert.equal(subscriptionOwnerId({ createdBy: "m-c" }, null), "m-c");
  assert.equal(subscriptionOwnerId({}, null), null);
  assert.deepEqual(ADULT_ROLES, ["Owner", "Adult Admin", "Adult Member"]);
});

/* ------------------------------ (b) adding ------------------------------ */

test("canAddCalendar: children and guests never; others for themselves; Owner for anyone; a Limited Member's one", () => {
  for (const role of ["Child View", "Guest/Helper"]) {
    const r = canAddCalendar({ actorId: "k", role }, { ownedCount: 0 });
    assert.equal(r.ok, false); assert.equal(r.status, 403); assert.equal(r.error, "insufficient_role");
  }
  for (const role of ["Owner", "Adult Admin", "Adult Member"]) {
    assert.equal(canAddCalendar({ actorId: "me", role }, { ownedCount: 7 }).ok, true, `${role} is uncapped for themselves`);
  }
  assert.equal(canAddCalendar({ actorId: "lm", role: "Limited Member" }, { ownedCount: 0 }).ok, true);
  const cap = canAddCalendar({ actorId: "lm", role: "Limited Member" }, { ownedCount: 1 });
  assert.equal(cap.ok, false); assert.equal(cap.status, 403); assert.equal(cap.error, "calendar_limit");
  assert.equal(cap.message, "Limited members can connect one calendar. Ask the Owner if you need another.");
  // Naming yourself as the target is just adding for yourself — the cap still applies.
  assert.equal(canAddCalendar({ actorId: "lm", role: "Limited Member" }, { forMember: { actorId: "lm" }, ownedCount: 1 }).error, "calendar_limit");
  for (const role of ["Adult Admin", "Adult Member", "Limited Member"]) {
    const r = canAddCalendar({ actorId: "me", role }, { forMember: { actorId: "them" }, ownedCount: 0 });
    assert.equal(r.error, "owner_only", role);
    assert.equal(r.message, "Only the Owner can add a calendar for someone else.");
  }
  assert.equal(canAddCalendar({ actorId: "o", role: "Owner" }, { forMember: { actorId: "lm" }, ownedCount: 5 }).ok, true,
    "the cap limits what a Limited Member adds themselves; the Owner may add more for them");
});

/* ------------------------------ (c) the routes ------------------------------ */

const ics = (tag) => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:evt-1@${tag}
SUMMARY:${tag} one
DTSTART:20260310T160000Z
END:VEVENT
BEGIN:VEVENT
UID:evt-2@${tag}
SUMMARY:${tag} two
DTSTART:20260311T160000Z
END:VEVENT
END:VCALENDAR`;

let ctx, owner, admin, member, limited, child;
const subs = {}; // name → id
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");    // Owner
  admin = await makeSession(ctx, "m-morgan");  // Adult Admin
  child = await makeSession(ctx, "m-noah");    // Child View
  const am = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Casey Quinn", role: "Adult Member" }) });
  const lm = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Riley Quinn", role: "Limited Member" }) });
  member = await makeSession(ctx, am.data.member.actorId);
  limited = await makeSession(ctx, lm.data.member.actorId);
  assert.equal(member.role, "Adult Member");
  assert.equal(limited.role, "Limited Member");
  const add = async (who, name, body = {}) => {
    const r = await who.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name, ics: ics(name.replace(/\W/g, "")), ...body }) });
    assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.data)}`);
    subs[name] = r.data.subscription.id;
    return r;
  };
  await add(owner, "Alex own");
  await add(admin, "Morgan own");
  await add(member, "Casey own");
  await add(admin, "Noah school"); // re-assigned to Noah below by the Owner
  await owner.req(`/api/calendar/subscriptions/${subs["Noah school"]}`, { method: "PATCH", body: JSON.stringify({ ownerActorId: "m-noah" }) });
});
after(async () => { await stopServer(ctx); });

test("a Limited Member adds ONE calendar for themselves; the second is calendar_limit", async () => {
  const first = await limited.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "Riley own", ics: ics("rileyown") }) });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  subs["Riley own"] = first.data.subscription.id;
  assert.equal(first.data.subscription.ownerActorId, limited.actorId);
  assert.equal(first.data.subscription.isWork, false);
  assert.deepEqual(first.data.subscription.can, { view: true, sync: true, edit: false, markWork: false, assign: false, remove: false, scope: false });
  const second = await limited.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "Riley two", ics: ics("rileytwo") }) });
  assert.equal(second.status, 403);
  assert.equal(second.data.error, "calendar_limit");
  const list = (await limited.req("/api/calendar/subscriptions")).data;
  assert.deepEqual(list.canAdd, { self: false, limitReached: true, forMembers: [] });
});

test("the Owner adds a calendar FOR the Limited Member (past their cap); it is theirs", async () => {
  const r = await owner.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "Riley club", ics: ics("rileyclub"), forMemberId: limited.actorId }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  subs["Riley club"] = r.data.subscription.id;
  assert.equal(r.data.subscription.ownerActorId, limited.actorId);
  assert.equal(r.data.subscription.ownerName, "Riley Quinn");
  assert.equal(r.data.subscription.can.scope, true, "the Owner may scope a Limited Member's calendar");
  // Its events are the Limited Member's — createdBy too, not the Owner who added it.
  const evs = (await owner.req("/api/events")).data.events.filter((e) => e.provenance?.subscriptionId === r.data.subscription.id);
  assert.equal(evs.length, 2);
  for (const e of evs) {
    const rec = readStoreRecord(ctx, "events", e.id);
    assert.equal(rec.ownerId, limited.actorId);
    assert.equal(rec.createdBy, limited.actorId);
  }
  const bad = await owner.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ ics: ics("nobody"), forMemberId: "m-nobody" }) });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, "bad_member");
  const list = (await owner.req("/api/calendar/subscriptions")).data;
  assert.equal(list.canAdd.self, true);
  assert.ok(list.canAdd.forMembers.includes(limited.actorId) && !list.canAdd.forMembers.includes(owner.actorId));
});

test("a calendar the Owner added for a Limited Member does not use up their own one", async () => {
  const lm2 = await owner.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Jo Quinn", role: "Limited Member" }) });
  const jo = await makeSession(ctx, lm2.data.member.actorId);
  const forJo = await owner.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "Jo school", ics: ics("joschool"), forMemberId: jo.actorId }) });
  assert.equal(forJo.status, 200, JSON.stringify(forJo.data));
  assert.equal((await jo.req("/api/calendar/subscriptions")).data.canAdd.self, true, "the cap limits what they add themselves");
  const own = await jo.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "Jo own", ics: ics("joown") }) });
  assert.equal(own.status, 200, JSON.stringify(own.data));
  const again = await jo.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "Jo two", ics: ics("jotwo") }) });
  assert.equal(again.data.error, "calendar_limit");
});

test("only the Owner adds for someone else: an Adult Admin with forMemberId is owner_only", async () => {
  const r = await admin.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ ics: ics("adminfor"), forMemberId: limited.actorId }) });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "owner_only");
  assert.equal(r.data.message, "Only the Owner can add a calendar for someone else.");
});

test("an Adult Member lists only their own calendars in full; everyone else's is a legend row", async () => {
  const r = await member.req("/api/calendar/subscriptions");
  assert.equal(r.status, 200);
  const rows = r.data.subscriptions;
  const mine = rows.filter((s) => s.ownerActorId === member.actorId);
  assert.equal(mine.length, 1);
  assert.ok(mine[0].can && mine[0].can.remove && "url" in mine[0] && "lastSyncAt" in mine[0]);
  const others = rows.filter((s) => s.ownerActorId !== member.actorId);
  assert.ok(others.length >= 4);
  for (const s of others) {
    assert.deepEqual(Object.keys(s).sort(), ["assigned", "color", "id", "isWork", "name", "ownerActorId", "ownerName", "source"], s.name);
  }
  assert.deepEqual(r.data.canAdd, { self: true, limitReached: false, forMembers: [] });
});

test("a feed URL never reaches a member who cannot view it; webcal:// is stored as https://", async () => {
  // Loopback egress is refused in the harness, so the sync fails (422) — the record stays.
  const r = await owner.req("/api/calendar/subscriptions", { method: "POST", body: JSON.stringify({ name: "Secret feed", url: "WebCal://127.0.0.1/x.ics?token=s3cret-feed-token" }) });
  assert.ok(r.data?.subscription, JSON.stringify(r.data));
  subs["Secret feed"] = r.data.subscription.id;
  assert.equal(r.data.subscription.url, "https://127.0.0.1/x.ics?token=s3cret-feed-token");
  const plain = await owner.req("/api/calendar/subscriptions", { method: "POST", body: JSON.stringify({ url: "webcal://127.0.0.1/x.ics" }) });
  assert.equal(plain.data.subscription.url, "https://127.0.0.1/x.ics");
  await owner.req(`/api/calendar/subscriptions/${plain.data.subscription.id}`, { method: "DELETE" });

  // Child View: the legend (the calendar screen colours events with it), and nothing else.
  const kid = await child.req("/api/calendar/subscriptions");
  assert.equal(kid.status, 200);
  assert.ok(kid.data.subscriptions.length >= 5);
  for (const s of kid.data.subscriptions) {
    assert.ok(!("url" in s) && !("can" in s) && !("icsText" in s), JSON.stringify(s));
  }
  assert.deepEqual(kid.data.canAdd, { self: false, limitReached: false, forMembers: [] });
  for (const who of [child, member, limited]) {
    const raw = JSON.stringify((await who.req("/api/calendar/subscriptions")).data);
    assert.ok(!raw.includes("s3cret-feed-token"), `${who.actorId} never sees the Owner's feed address`);
    assert.ok(!raw.includes("BEGIN:VCALENDAR"), "nor anybody's pasted .ics");
  }
});

test("an Adult Admin cannot change the Owner's calendar", async () => {
  const r = await admin.req(`/api/calendar/subscriptions/${subs["Alex own"]}`, { method: "PATCH", body: JSON.stringify({ name: "Mine now" }) });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "not_your_calendar");
  assert.match(r.data.message, /Alex \(the Owner\)/);
});

test("an Adult Admin removes a Limited Member's calendar but not an Adult Member's", async () => {
  const no = await admin.req(`/api/calendar/subscriptions/${subs["Casey own"]}`, { method: "DELETE" });
  assert.equal(no.status, 403);
  assert.equal(no.data.error, "not_your_calendar");
  assert.equal(no.data.message, "Only Casey or the Owner can remove this calendar.");
  const yes = await admin.req(`/api/calendar/subscriptions/${subs["Riley club"]}`, { method: "DELETE" });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
});

test("an Adult Member marks their own calendar as work; a Limited Member cannot rename theirs", async () => {
  const r = await member.req(`/api/calendar/subscriptions/${subs["Casey own"]}`, { method: "PATCH", body: JSON.stringify({ isWork: true }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.subscription.isWork, true);
  assert.equal((await member.req(`/api/calendar/subscriptions/${subs["Casey own"]}`, { method: "PATCH", body: JSON.stringify({ isWork: "yes" }) })).status, 400);
  const rename = await limited.req(`/api/calendar/subscriptions/${subs["Riley own"]}`, { method: "PATCH", body: JSON.stringify({ name: "Riley's" }) });
  assert.equal(rename.status, 403);
  assert.equal(rename.data.error, "not_your_calendar");
  // Nor may they remove it — they ask the Owner — but they may refresh it.
  assert.equal((await limited.req(`/api/calendar/subscriptions/${subs["Riley own"]}`, { method: "DELETE" })).status, 403);
  assert.equal((await limited.req(`/api/calendar/subscriptions/${subs["Riley own"]}/sync`, { method: "POST" })).status, 200);
  // A child's calendar can never be "work", not even by the Owner.
  const kid = await owner.req(`/api/calendar/subscriptions/${subs["Noah school"]}`, { method: "PATCH", body: JSON.stringify({ isWork: true }) });
  assert.equal(kid.status, 403);
  assert.equal(kid.data.message, "Only an adult's calendar can be marked as work.");
});

test("saving with the SAME owner is not a reassignment (the build-79 edit sheet always sends it)", async () => {
  const r = await member.req(`/api/calendar/subscriptions/${subs["Casey own"]}`, { method: "PATCH", body: JSON.stringify({ name: "Casey work", ownerActorId: member.actorId }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.subscription.name, "Casey work");
});

test("a shared card handed to another calendar becomes that calendar owner's event (createdBy too)", async () => {
  const a = await member.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "Shared A", ics: ics("sharedtag") }) });
  const b = await admin.req("/api/calendar/import-ics", { method: "POST", body: JSON.stringify({ name: "Shared B", ics: ics("sharedtag") }) });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(b.status, 200, JSON.stringify(b.data));
  const aId = a.data.subscription.id, bId = b.data.subscription.id;
  const cards = (await owner.req("/api/events")).data.events.filter((e) => e.provenance?.subscriptionId === aId);
  assert.equal(cards.length, 2, "one card per event, owned by the first calendar");
  assert.ok(cards.every((e) => (e.provenance.alsoSubscriptionIds ?? []).includes(bId)), "the second calendar rides along");
  assert.equal((await member.req(`/api/calendar/subscriptions/${aId}`, { method: "DELETE" })).status, 200);
  for (const c of cards) {
    const rec = readStoreRecord(ctx, "events", c.id);
    assert.equal(rec.provenance.subscriptionId, bId);
    assert.equal(rec.ownerId, admin.actorId);
    assert.equal(rec.createdBy, admin.actorId, "canSeeEntity counts createdBy as ownership — it must not keep naming Casey");
  }
});

test("an Adult Admin cannot reassign a calendar", async () => {
  const r = await admin.req(`/api/calendar/subscriptions/${subs["Morgan own"]}`, { method: "PATCH", body: JSON.stringify({ ownerActorId: member.actorId }) });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "not_your_calendar");
  assert.equal(r.data.message, "Only the Owner can change whose calendar this is.");
});

test("the Owner reassigns a Work calendar to a Limited Member: isWork clears, events restamped", async () => {
  const id = subs["Casey own"];
  const r = await owner.req(`/api/calendar/subscriptions/${id}`, { method: "PATCH", body: JSON.stringify({ ownerActorId: limited.actorId }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.subscription.ownerActorId, limited.actorId);
  assert.equal(r.data.subscription.isWork, false, "a Limited Member's calendar is not a work calendar");
  assert.equal(r.data.restamped, 2);
  const evs = (await owner.req("/api/events")).data.events.filter((e) => e.provenance?.subscriptionId === id);
  assert.equal(evs.length, 2);
  for (const e of evs) {
    const rec = readStoreRecord(ctx, "events", e.id);
    assert.equal(rec.ownerId, limited.actorId);
    assert.equal(rec.createdBy, limited.actorId, "createdBy is ownership in canSeeEntity — it must follow the calendar");
  }
  // Casey no longer sees it in full.
  const row = (await member.req("/api/calendar/subscriptions")).data.subscriptions.find((s) => s.id === id);
  assert.ok(!("can" in row));
});

test("connect-google picks only among the caller's OWN Google accounts; children never start OAuth", async () => {
  const r = await owner.req("/api/calendar/connect-google", { method: "POST", body: JSON.stringify({ accountId: "acct_someone_elses" }) });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "bad_account");
  const kid = await child.req("/api/calendar/connect-google", { method: "POST", body: JSON.stringify({}) });
  assert.equal(kid.status, 403);
  assert.equal(kid.data.error, "insufficient_role");
  const start = await child.req("/api/oauth/google/start");
  assert.equal(start.status, 403, "a child never begins connecting an account");
  assert.equal(start.data.error, "insufficient_role");
});

/* ------------------------------ the migration ------------------------------ */

test("boot migration: names the owner of every legacy calendar and restamps its events — idempotently", async () => {
  // In-process against the test process's own throwaway data dir (harness.mjs set it).
  const store = await import("../store.mjs");
  const { backfillCalendarOwners } = await import("../calendar-owners.mjs");
  const HH = "hh_calmigration";
  await store.runWithTenant(HH, async () => {
    store.putAccount({ id: "acct_mig", provider: "google", householdId: HH, connectedByActorId: "m-google", displayName: "g@example.com", status: "connected" });
    store.putSubscription({ id: "sub_ics_legacy", householdId: HH, source: "url", name: "Legacy feed", createdBy: "m-adder" });
    store.putSubscription({ id: "sub_g_legacy", householdId: HH, source: "google", name: "Legacy Google", accountId: "acct_mig", createdBy: "m-adder" });
    store.putSubscription({ id: "sub_assigned", householdId: HH, source: "import", name: "Assigned", ownerActorId: "m-kid", createdBy: "m-adder" });
    const ev = (id, subId, extra = {}) => store.putEvent({ id, householdId: HH, title: id, startAt: "2026-05-01T10:00:00Z", layer: "linked", createdBy: "m-syncer", ownerId: null, provenance: { subscriptionId: subId, uid: id }, ...extra });
    ev("e1", "sub_ics_legacy");
    ev("e2", "sub_g_legacy");
    ev("e3", "sub_g_legacy", { ownerId: "m-google" });
    ev("e4", "sub_assigned", { ownerId: "m-kid" });
    ev("e5", "sub_assigned", { layer: "canonical", createdBy: "m-someone" }); // not a linked copy — untouched

    const first = backfillCalendarOwners(HH);
    assert.deepEqual(first, { subscriptions: 2, events: 4 });
    assert.equal(store.getSubscription("sub_ics_legacy").ownerActorId, "m-adder");
    assert.equal(store.getSubscription("sub_g_legacy").ownerActorId, "m-google", "a Google calendar belongs to whoever connected the account");
    assert.equal(store.getSubscription("sub_assigned").ownerActorId, "m-kid");
    const e = (id) => store.getEvent(id);
    assert.deepEqual([e("e1").createdBy, e("e1").ownerId], ["m-adder", "m-adder"]);
    assert.deepEqual([e("e2").createdBy, e("e2").ownerId], ["m-google", "m-google"]);
    assert.deepEqual([e("e3").createdBy, e("e3").ownerId], ["m-google", "m-google"]);
    assert.deepEqual([e("e4").createdBy, e("e4").ownerId], ["m-kid", "m-kid"]);
    assert.equal(e("e5").createdBy, "m-someone");

    assert.deepEqual(backfillCalendarOwners(HH), { subscriptions: 0, events: 0 }, "a second boot changes nothing");
  });
});
