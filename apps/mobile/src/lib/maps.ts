// An address you can actually go to.
//
// From the 2026-07-25 walkthrough, at the event detail sheet [11:25]: "once I select the
// address it should be tappable, or a button beside it, that links me out to Google Maps or
// Apple Maps." A location that is only text is a location you have to retype into another app
// while holding a kid's hand.
//
// Apple Maps is the default because it's the platform's own and needs no install; Google Maps
// gets a real universal link (comgooglemaps:// first so it opens the app when present).
import { Linking, Platform } from "react-native";

export type MapApp = "apple" | "google";

/** Apple Maps for a free-text address (or "lat,lng"). */
export function appleMapsUrl(query: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(query)}`;
}

/** Google Maps universal link — opens the app when it's installed, the web map otherwise. */
export function googleMapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Turn-by-turn directions rather than a pin. */
export function directionsUrl(query: string, app: MapApp = "apple"): string {
  return app === "google"
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`
    : `https://maps.apple.com/?daddr=${encodeURIComponent(query)}&dirflg=d`;
}

/**
 * Open a place in a map app. Tries the Google Maps app scheme first when Google was asked
 * for (so an installed app wins over Safari), then falls back to the universal link. Never
 * throws — a failed hand-off returns false so the caller can say so instead of doing nothing.
 */
export async function openInMaps(query: string, app: MapApp = "apple"): Promise<boolean> {
  const q = query.trim();
  if (!q) return false;
  const candidates: string[] = [];
  if (app === "google") {
    if (Platform.OS === "ios") candidates.push(`comgooglemaps://?q=${encodeURIComponent(q)}`);
    candidates.push(googleMapsUrl(q));
  } else {
    candidates.push(appleMapsUrl(q));
  }
  for (const url of candidates) {
    try {
      if (url.startsWith("http") || (await Linking.canOpenURL(url))) {
        await Linking.openURL(url);
        return true;
      }
    } catch { /* try the next candidate */ }
  }
  return false;
}

/** Open directions to a place, same fallback chain. */
export async function openDirections(query: string, app: MapApp = "apple"): Promise<boolean> {
  const q = query.trim();
  if (!q) return false;
  try { await Linking.openURL(directionsUrl(q, app)); return true; } catch { return false; }
}

/** A coordinate pair reads better as a place name when we have one. */
export function mapQuery(where: string | undefined, title?: string): string {
  const w = (where ?? "").trim();
  if (!w) return (title ?? "").trim();
  // "37.77,-122.41" alone drops a pin with no label; pairing it with the name labels it.
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(w)) return title ? `${title}, ${w}` : w;
  return w;
}
