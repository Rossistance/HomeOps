// E1 + K4 — real places, and an honest account of what places data cannot answer.
//
// K4, typed in full during the 2026-07-25 chat recordings: "give me a list of the 5 best
// restaurants near me, sort them by highest to lowest and for each give me the results on
// whether it is often busy or not right now, estimated wait time." Two of those four things
// are genuinely not published by any mapping API. The temptation is to produce a plausible
// "usually busy, ~20 min wait" — which is the false-success class this codebase exists to
// stamp out. So the contract under test is: return everything real, and NAME the gap.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-places-"));
const { PLACE_LIMITATIONS, placesProvider, searchPlaces, suggestAddresses } = await import("../places.mjs");
const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
const { rowCard } = await import("../assistant-runs.mjs");

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
  try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {}
});

/** Stand in for the upstream so these tests never touch the network. */
function stubFetch(handler) {
  globalThis.fetch = async (url, init) => {
    const body = handler(String(url), init);
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      body: null,
      text: async () => JSON.stringify(body),
    };
  };
}

const GOOGLE_PLACES = {
  places: [
    {
      id: "p1", displayName: { text: "Hearth" }, formattedAddress: "88 Oak Ave",
      location: { latitude: 34.79, longitude: -92.20 },
      rating: 4.5, userRatingCount: 812, priceLevel: "PRICE_LEVEL_MODERATE",
      currentOpeningHours: { openNow: true }, primaryTypeDisplayName: { text: "Restaurant" },
    },
    {
      id: "p2", displayName: { text: "Terra & Vine" }, formattedAddress: "12 Main St",
      location: { latitude: 34.80, longitude: -92.21 },
      rating: 4.8, userRatingCount: 1200, priceLevel: "PRICE_LEVEL_EXPENSIVE",
      currentOpeningHours: { openNow: false },
    },
  ],
};

before(() => { delete process.env.GOOGLE_PLACES_API_KEY; delete process.env.GOOGLE_MAPS_API_KEY; });

/* ---- the honesty contract ---- */

test("THE POINT: busy-now and wait-time are reported as UNAVAILABLE, never invented", async () => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  stubFetch((u) => (u.includes("searchText") ? GOOGLE_PLACES : []));
  const r = await searchPlaces("best restaurants", { lat: 34.8, lng: -92.2, limit: 5 });
  process.env.GOOGLE_PLACES_API_KEY = "";
  assert.equal(r.ok, true);
  assert.ok(r.limitations.includes(PLACE_LIMITATIONS.busy), "the busy-ness gap is declared");
  assert.ok(r.limitations.includes(PLACE_LIMITATIONS.waitTime), "so is the wait-time gap");
  for (const p of r.places) {
    assert.equal(p.busy, undefined, `${p.name}: a busy value here would be fabricated`);
    assert.equal(p.waitTime, undefined, `${p.name}: same for wait time`);
  }
});

test("distance is labelled straight-line — not passed off as a driving distance", async () => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  stubFetch((u) => (u.includes("searchText") ? GOOGLE_PLACES : []));
  const r = await searchPlaces("restaurants", { lat: 34.8, lng: -92.2, limit: 5 });
  process.env.GOOGLE_PLACES_API_KEY = "";
  assert.match(r.places[0].distance, /straight line/);
});

/* ---- what it does return ---- */

test("\"sort them by highest to lowest\" — his words, and the actual order", async () => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  stubFetch((u) => (u.includes("searchText") ? GOOGLE_PLACES : []));
  const r = await searchPlaces("restaurants", { lat: 34.8, lng: -92.2, limit: 5 });
  process.env.GOOGLE_PLACES_API_KEY = "";
  assert.deepEqual(r.places.map((p) => p.name), ["Terra & Vine", "Hearth"]);
  assert.equal(r.places[0].rating, 4.8);
  assert.equal(r.places[0].priceLevel, "$$$");
  assert.equal(r.places[1].openNow, true);
});

test("a place row renders as a card with no extra mapping (K2 pairing)", async () => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  stubFetch((u) => (u.includes("searchText") ? GOOGLE_PLACES : []));
  const r = await searchPlaces("restaurants", { lat: 34.8, lng: -92.2, limit: 5 });
  process.env.GOOGLE_PLACES_API_KEY = "";
  const card = rowCard(r.places[0]);
  assert.equal(card.title, "Terra & Vine");
  assert.equal(card.where, "12 Main St");
  assert.match(card.url, /^https:\/\//);
  const labels = card.meta.map((m) => m.label);
  assert.ok(labels.includes("Rating") && labels.includes("Price") && labels.includes("Distance"));
});

test("without a key it still answers with addresses, and says what's missing", async () => {
  assert.equal(placesProvider(), "nominatim");
  stubFetch(() => ([{ name: "Terra & Vine", display_name: "Terra & Vine, 12 Main St, Little Rock", lat: "34.80", lon: "-92.21", type: "restaurant" }]));
  const r = await searchPlaces("terra and vine", { lat: 34.8, lng: -92.2 });
  assert.equal(r.ok, true);
  assert.equal(r.places[0].name, "Terra & Vine");
  assert.equal(r.places[0].rating, null, "no rating is invented from map data that has none");
  assert.ok(r.limitations.some((l) => /GOOGLE_PLACES_API_KEY/.test(l)), "and it names what would fix that");
});

/* ---- E1: address autocomplete ---- */

test("autocomplete offers the name first, then the address underneath", async () => {
  stubFetch(() => ([{ name: "St. Jude Catholic Church", display_name: "St. Jude Catholic Church, 526 Shadow Pkwy, Jacksonville", lat: "34.8", lon: "-92.2" }]));
  const r = await suggestAddresses("526 Shadow");
  assert.equal(r.ok, true);
  assert.equal(r.suggestions[0].label, "St. Jude Catholic Church");
  assert.match(r.suggestions[0].detail, /526 Shadow Pkwy/);
  assert.match(r.suggestions[0].value, /St\. Jude/, "the value written into the field is navigable on its own");
});

test("a short query is answered locally — no request on every keystroke", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("should not be called"); };
  const r = await suggestAddresses("52");
  assert.deepEqual(r.suggestions, []);
  assert.equal(calls, 0);
});

test("a dead lookup returns no suggestions instead of breaking typing", async () => {
  globalThis.fetch = async () => { throw new Error("network down"); };
  const r = await suggestAddresses("526 Shadow Parkway");
  assert.equal(r.ok, true, "the caller must never see an error mid-keystroke");
  assert.deepEqual(r.suggestions, []);
});

/* ---- the assistant tool ---- */

test("the assistant now HAS a places tool — the restaurant ask had no capability behind it", async () => {
  assert.ok(INTERNAL_FUNCTIONS["homeops.find_places"], "this is what was missing");
  stubFetch(() => ([{ name: "Hearth", display_name: "Hearth, 88 Oak Ave", lat: "34.79", lon: "-92.20" }]));
  const out = await INTERNAL_FUNCTIONS["homeops.find_places"].run({ householdId: "local", actorId: "m-owner" }, { query: "restaurants near me", lat: 34.8, lng: -92.2 });
  assert.equal(out.ok, true);
  assert.equal(out.result.places[0].name, "Hearth");
  assert.ok(out.result.limitations.length > 0, "the limitations travel with the answer, into the chat");
});

test("it refuses an empty query rather than searching for nothing", async () => {
  const out = await INTERNAL_FUNCTIONS["homeops.find_places"].run({ householdId: "local" }, {});
  assert.equal(out.ok, false);
  assert.equal(out.error, "query_required");
});

test("find_places is a READ — it must not sit behind an approval gate", () => {
  const f = INTERNAL_FUNCTIONS["homeops.find_places"];
  assert.equal(f.requiresApproval, false, "asking where the nearest pharmacy is should not need permission");
  assert.equal(f.delivers, false, "and it reaches nobody outside the household");
});
