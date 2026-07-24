// WP-103 slice 5 (ISS-121): a Google account stuck in `needs_reconnect` went on
// contributing its already-synced events, which rendered exactly like live ones — so the
// calendar quietly showed copies that could no longer refresh, compounding the ISS-104
// date confusion with stale data.
//
// The reported case is cross-member: Melissa's account sat in needs_reconnect while
// Ross's kept syncing 36 events, and her stale events rendered for everyone. So the check
// must resolve an account the VIEWER does not own — listAccountsFor (actor-scoped) can't
// see it, which is why the lookup goes through accountStatusById.
//
// Marked, never hidden: silently deleting a family's events would be a worse lie than
// showing them with an honest "this calendar can't refresh" flag.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, writeStoreDoc } from "./harness.mjs";

const HH = "local";
let ctx, adult;

before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // signed in as Morgan…

  writeStoreDoc(ctx, "accounts.json", [
    // …while THIS account belongs to someone else and can no longer refresh.
    { id: "acc_stale", householdId: HH, provider: "google", displayName: "melissa@example.com", status: "needs_reconnect", connectedByActorId: "m-alex", scopes: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "acc_live", householdId: HH, provider: "google", displayName: "morgan@example.com", status: "connected", connectedByActorId: "m-morgan", scopes: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  ]);
  writeStoreDoc(ctx, "calendar_subscriptions.json", {
    sub_stale: { id: "sub_stale", householdId: HH, source: "google", accountId: "acc_stale", name: "Melissa's calendar" },
    sub_live: { id: "sub_live", householdId: HH, source: "google", accountId: "acc_live", name: "Morgan's calendar" },
  });
  writeStoreDoc(ctx, "events.json", {
    ev_stale: { id: "ev_stale", householdId: HH, title: "From the expired calendar", startAt: new Date(2026, 7, 3, 9).toISOString(), layer: "linked", visibility: "household", provenance: { via: "google", subscriptionId: "sub_stale", uid: "u1" } },
    ev_live: { id: "ev_live", householdId: HH, title: "From the healthy calendar", startAt: new Date(2026, 7, 4, 9).toISOString(), layer: "linked", visibility: "household", provenance: { via: "google", subscriptionId: "sub_live", uid: "u2" } },
    ev_own: { id: "ev_own", householdId: HH, title: "Typed into FamiliOS", startAt: new Date(2026, 7, 5, 9).toISOString(), layer: "canonical", visibility: "household", ownerId: "m-morgan", provenance: { via: "user" } },
  });
});
after(async () => { await stopServer(ctx); });

const find = (events, id) => (events ?? []).find((e) => e.id === id);

test("ISS-121: an event from a needs_reconnect account is flagged, not passed off as current", async () => {
  const r = await adult.req("/api/events");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const e = find(r.data.events, "ev_stale");
  assert.ok(e, "still returned — marked, not silently deleted");
  assert.ok(e.staleSource, "a disconnected calendar must not contribute SILENTLY");
  assert.equal(e.staleSource.status, "needs_reconnect");
  assert.equal(e.staleSource.accountId, "acc_stale");
  assert.equal(e.staleSource.provider, "google");
});

test("ISS-121: the flag resolves an account the viewer does NOT own (the reported case)", async () => {
  const r = await adult.req("/api/events");
  const e = find(r.data.events, "ev_stale");
  // Morgan is signed in; the stale account was connected by m-alex. An actor-scoped
  // lookup would have missed this entirely and left the events looking healthy.
  assert.equal(e.staleSource.connectedByActorId, "m-alex");
});

test("ISS-121: a healthy account's events carry no flag", async () => {
  const r = await adult.req("/api/events");
  assert.equal(find(r.data.events, "ev_live").staleSource, undefined);
});

test("ISS-121: a FamiliOS-owned event is never flagged", async () => {
  const r = await adult.req("/api/events");
  assert.equal(find(r.data.events, "ev_own").staleSource, undefined);
});

test("ISS-121: reconnecting clears the flag without re-syncing", async () => {
  writeStoreDoc(ctx, "accounts.json", [
    { id: "acc_stale", householdId: HH, provider: "google", displayName: "melissa@example.com", status: "connected", connectedByActorId: "m-alex", scopes: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "acc_live", householdId: HH, provider: "google", displayName: "morgan@example.com", status: "connected", connectedByActorId: "m-morgan", scopes: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  ]);
  const r = await adult.req("/api/events");
  assert.equal(find(r.data.events, "ev_stale").staleSource, undefined, "the flag is derived, not stored — it clears the moment the account is healthy");
});
