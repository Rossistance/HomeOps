// Coarse location context for locally-tailored assistant requests ("weather
// tomorrow", "pizza near us", "local news"). When-in-use permission, city-level
// precision, cached for 10 minutes. Denial is respected silently — the
// assistant simply works without a location, and we never re-nag mid-session.
import * as Location from "expo-location";

export interface LocationContext {
  latitude: number;
  longitude: number;
  city: string | null;
  region: string | null;
  country: string | null;
}

let cache: { at: number; value: LocationContext | null } | null = null;
let askedThisSession = false;
const TTL_MS = 10 * 60 * 1000;

export async function getLocationContext(): Promise<LocationContext | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") {
      if (askedThisSession) { cache = { at: Date.now(), value: null }; return null; }
      askedThisSession = true;
      ({ status } = await Location.requestForegroundPermissionsAsync());
    }
    if (status !== "granted") { cache = { at: Date.now(), value: null }; return null; }
    const pos = await Location.getLastKnownPositionAsync() ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    if (!pos) { cache = { at: Date.now(), value: null }; return null; }
    const { latitude, longitude } = pos.coords;
    let city: string | null = null, region: string | null = null, country: string | null = null;
    try {
      const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
      city = place?.city ?? place?.subregion ?? null;
      region = place?.region ?? null;
      country = place?.country ?? null;
    } catch { /* coordinates alone still help */ }
    const value: LocationContext = {
      // City-level precision on purpose: ~1km rounding, plenty for weather/nearby.
      latitude: Math.round(latitude * 100) / 100,
      longitude: Math.round(longitude * 100) / 100,
      city, region, country,
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    cache = { at: Date.now(), value: null };
    return null;
  }
}
