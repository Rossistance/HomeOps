// Real places: address autocomplete, and the comparison the family actually asked for.
//
// Two items from 2026-07-25 land here.
//
// E1 [10:55], on the event location field: "It's just raw text. It needs address
// autocomplete — smart sorting like most web apps." Typing "526 Shadow" should offer the
// address, not leave you to get it right from memory.
//
// K4, the restaurant ask, typed in full: "give me a list of the 5 best restaurants near me,
// sort them by highest to lowest and for each give me the results on whether it is often busy
// or not right now, estimated wait time" — plus distance and drive time. The assistant's
// answer at the time was prose and two links, because it had no place data at all.
//
// HONESTY, up front, because this is where a places integration usually starts lying:
//   • rating, review count, price level, open-now, address, coordinates — real, from Google
//     Places when a key is configured.
//   • distance — computed here from coordinates. Straight-line, and labelled as such.
//   • drive time — real, from the Routes API, when that key works.
//   • "often busy right now" and "estimated wait time" — Google does NOT expose popular-times
//     or wait estimates through any official API. There is no honest way to fill those in, so
//     they are reported as UNAVAILABLE and named in `limitations`. The assistant is instructed
//     to say so. Inventing a plausible "usually busy, ~20 min" would be the exact
//     false-success failure this codebase keeps stamping out.
//
// Without GOOGLE_PLACES_API_KEY the module still does address autocomplete through
// OpenStreetMap Nominatim (keyless, no ratings) so E1 works on every deployment.
import { safeFetch } from "./net.mjs";

const PLACES_KEY = () => process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
// Nominatim's usage policy requires a real identifying User-Agent.
const NOMINATIM_UA = "FamiliOS/1.0 (family calendar; +https://homeops-ai.onrender.com)";

export function placesProvider() {
  return PLACES_KEY() ? "google" : "nominatim";
}

/** What this deployment genuinely cannot answer, in the family's words. */
export const PLACE_LIMITATIONS = {
  busy: "Live \"how busy is it right now\" isn't published by any mapping API we can call — Google shows it in its own app only.",
  waitTime: "Estimated wait time isn't available from the places API either; restaurants don't publish it.",
};

/* --------------------------------- helpers -------------------------------- */

const R_MILES = 3958.8;
function haversineMiles(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(s)));
}

const PRICE_WORD = {
  PRICE_LEVEL_FREE: "Free", PRICE_LEVEL_INEXPENSIVE: "$", PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$", PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

function mapsUrlFor(p) {
  if (p.id) return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(p.id)}`;
  const q = [p.displayName?.text, p.formattedAddress].filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

/* ------------------------------ Google Places ----------------------------- */

// Places API (New) text search. The field mask is required and is billed on, so it asks for
// exactly what a card shows and nothing more.
const FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.location",
  "places.rating", "places.userRatingCount", "places.priceLevel",
  "places.currentOpeningHours.openNow", "places.primaryTypeDisplayName", "places.nationalPhoneNumber",
].join(",");

async function googleTextSearch(query, { lat, lng, limit, radiusMeters = 16000 }) {
  const body = { textQuery: query, maxResultCount: Math.min(20, Math.max(1, limit)) };
  if (lat != null && lng != null) {
    body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters } };
  }
  const r = await safeFetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": PLACES_KEY(),
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  }, { timeoutMs: 10_000, maxBytes: 1_000_000 });
  if (!r.ok || !r.httpOk) return { ok: false, error: "places_request_failed", message: r.message ?? `HTTP ${r.status}` };
  let json;
  try { json = JSON.parse(r.text); } catch { return { ok: false, error: "places_bad_response" }; }
  if (json.error) return { ok: false, error: "places_error", message: json.error.message ?? "The places API refused the request." };
  return { ok: true, places: json.places ?? [] };
}

/**
 * Drive times from one origin to many destinations, in one Routes API call.
 * Best-effort by design: a place list that lost its drive times is still a useful answer, so a
 * failure here returns an empty map rather than failing the search.
 */
async function googleDriveTimes(origin, destinations) {
  if (!origin || destinations.length === 0) return {};
  const r = await safeFetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": PLACES_KEY(),
      "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition",
    },
    body: JSON.stringify({
      origins: [{ waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } } }],
      destinations: destinations.map((d) => ({ waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } } })),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
    }),
  }, { timeoutMs: 10_000, maxBytes: 500_000 });
  if (!r.ok || !r.httpOk) return {};
  try {
    const rows = JSON.parse(r.text);
    const out = {};
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row.condition && row.condition !== "ROUTE_EXISTS") continue;
      const secs = Number(String(row.duration ?? "").replace(/s$/, ""));
      if (!Number.isFinite(secs)) continue;
      out[row.destinationIndex] = secs < 90 ? "1 min" : `${Math.round(secs / 60)} min`;
    }
    return out;
  } catch { return {}; }
}

/* -------------------------------- Nominatim ------------------------------- */

async function nominatimSearch(query, { lat, lng, limit }) {
  const params = new URLSearchParams({ q: query, format: "jsonv2", limit: String(Math.min(10, limit)), addressdetails: "1" });
  // A viewbox around the family biases results without excluding anything.
  if (lat != null && lng != null) {
    const d = 0.35;
    params.set("viewbox", `${lng - d},${lat + d},${lng + d},${lat - d}`);
  }
  const r = await safeFetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "user-agent": NOMINATIM_UA, accept: "application/json" },
  }, { timeoutMs: 8000, maxBytes: 500_000 });
  if (!r.ok || !r.httpOk) return { ok: false, error: "geocode_failed", message: r.message ?? `HTTP ${r.status}` };
  try { return { ok: true, rows: JSON.parse(r.text) }; } catch { return { ok: false, error: "geocode_bad_response" }; }
}

/* ---------------------------------- API ----------------------------------- */

/**
 * Search places. Returns row-shaped objects that assistant-runs.mjs rowCard already knows how
 * to render as cards — `name`, `address`, `rating`, `priceLevel`, `openNow`, `distance`,
 * `driveTime`, `url` — plus an explicit `limitations` list for what could not be answered.
 */
export async function searchPlaces(query, { lat = null, lng = null, limit = 5, driveTimes = true } = {}) {
  const q = String(query ?? "").trim();
  if (!q) return { ok: false, error: "invalid_input", message: "Say what to look for." };
  const origin = lat != null && lng != null ? { lat, lng } : null;
  const limitations = [PLACE_LIMITATIONS.busy, PLACE_LIMITATIONS.waitTime];

  if (PLACES_KEY()) {
    const r = await googleTextSearch(q, { lat, lng, limit });
    if (!r.ok) return r;
    const raw = r.places.slice(0, limit);
    const coords = raw.map((p) => ({ lat: p.location?.latitude, lng: p.location?.longitude }));
    const times = driveTimes && origin ? await googleDriveTimes(origin, coords.filter((c) => c.lat != null)) : {};
    const places = raw.map((p, i) => {
      const c = coords[i];
      const miles = origin ? haversineMiles(origin, c) : null;
      return {
        name: p.displayName?.text ?? "Unnamed place",
        address: p.formattedAddress ?? null,
        rating: p.rating ?? null,
        reviewCount: p.userRatingCount ?? null,
        priceLevel: PRICE_WORD[p.priceLevel] ?? null,
        openNow: p.currentOpeningHours?.openNow ?? null,
        category: p.primaryTypeDisplayName?.text ?? null,
        phone: p.nationalPhoneNumber ?? null,
        // Labelled "straight line" so nobody reads it as a driving distance.
        distance: miles == null ? null : `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi straight line`,
        driveTime: times[i] ?? null,
        lat: c.lat ?? null, lng: c.lng ?? null,
        url: mapsUrlFor(p),
      };
    });
    // "sort them by highest to lowest" — his words. Unrated places sink rather than being
    // dropped, so the count the family sees is the count they asked for.
    places.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    return { ok: true, provider: "google", query: q, places, limitations };
  }

  const g = await nominatimSearch(q, { lat, lng, limit });
  if (!g.ok) return g;
  const places = g.rows.map((row) => {
    const c = { lat: Number(row.lat), lng: Number(row.lon) };
    const miles = origin ? haversineMiles(origin, c) : null;
    return {
      name: row.name || String(row.display_name ?? "").split(",")[0] || "Unnamed place",
      address: row.display_name ?? null,
      category: row.type ? String(row.type).replace(/_/g, " ") : null,
      distance: miles == null ? null : `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi straight line`,
      lat: c.lat, lng: c.lng,
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.display_name ?? row.name ?? q)}`,
      rating: null, priceLevel: null, openNow: null, driveTime: null,
    };
  });
  return {
    ok: true, provider: "nominatim", query: q, places,
    limitations: [
      ...limitations,
      "Ratings, prices and opening hours need a Google Places key (GOOGLE_PLACES_API_KEY) — this deployment is using the free map data, which has addresses only.",
    ],
  };
}

/**
 * Address autocomplete for the event location field (E1). Deliberately thinner than
 * searchPlaces: a short list of "label + full address", no ratings, no drive times, cheap
 * enough to fire on every few keystrokes.
 */
export async function suggestAddresses(query, { lat = null, lng = null, limit = 6 } = {}) {
  const q = String(query ?? "").trim();
  // Two characters can only produce noise, and this runs on a keystroke.
  if (q.length < 3) return { ok: true, suggestions: [] };

  if (PLACES_KEY()) {
    const r = await safeFetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": PLACES_KEY() },
      body: JSON.stringify({
        input: q,
        ...(lat != null && lng != null
          ? { locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 30000 } } }
          : {}),
      }),
    }, { timeoutMs: 6000, maxBytes: 300_000 });
    if (r.ok && r.httpOk) {
      try {
        const j = JSON.parse(r.text);
        const suggestions = (j.suggestions ?? [])
          .map((s) => s.placePrediction)
          .filter(Boolean)
          .slice(0, limit)
          .map((p) => ({
            // What the family recognises first ("St. Jude Catholic Church"), then the address
            // underneath — the same shape the walkthrough praised on other apps.
            label: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
            detail: p.structuredFormat?.secondaryText?.text ?? "",
            // The full string that goes INTO the field, because a label alone won't navigate.
            value: p.text?.text ?? "",
            placeId: p.placeId ?? null,
          }))
          .filter((s) => s.value);
        return { ok: true, provider: "google", suggestions };
      } catch { /* fall through to the keyless path */ }
    }
  }

  const g = await nominatimSearch(q, { lat, lng, limit });
  if (!g.ok) return { ok: true, suggestions: [], degraded: g.error };  // a dead lookup must not break typing
  const suggestions = g.rows.slice(0, limit).map((row) => {
    const full = String(row.display_name ?? "");
    const head = row.name || full.split(",")[0] || full;
    return { label: head, detail: full.startsWith(head) ? full.slice(head.length).replace(/^,\s*/, "") : full, value: full, placeId: null };
  });
  return { ok: true, provider: "nominatim", suggestions };
}
