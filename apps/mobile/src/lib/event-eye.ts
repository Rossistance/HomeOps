// The small pure rules the event cards need beside event-face.ts (ADR-005):
//  - a block's time range, for its card and its accessibility sentence;
//  - when a shared event earns the little open-eye button (the owner can hide it again);
//  - the caption drawn above the blur of the owner's own hidden event.
// No React here, so node --test can hold it.
import type { EventFace } from "./event-face";

type Timed = { startAt?: string | null; endAt?: string | null; allDay?: boolean | null };

const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "9:00 AM – 5:00 PM", "All day", or "9:00 AM" when there is no end. A span that runs past
 *  midnight names the day it ends on, so an overnight block does not read as a 7-hour day. */
export function timeRangeLabel(e: Timed): string {
  if (!e.startAt || e.allDay) return "All day";
  const s = new Date(e.startAt);
  if (isNaN(+s)) return "All day";
  const en = e.endAt ? new Date(e.endAt) : null;
  if (!en || isNaN(+en) || +en <= +s) return clock(s);
  const endText = sameDay(s, en) ? clock(en) : `${en.toLocaleDateString(undefined, { weekday: "short" })} ${clock(en)}`;
  return `${clock(s)} – ${endText}`;
}

/** The accessibility sentence of a block card: "<label>, <time range>". */
export function blockA11yLabel(label: string, e: Timed): string {
  return `${label}, ${timeRangeLabel(e)}`;
}

type SubLike = { id: string; isWork?: boolean };
type EvLike = { provenance?: { subscriptionId?: unknown } | null };

/** A shared event of the viewer's own that came from a Work calendar: it shows a small open
 *  eye so its owner can hide it again. The face (eventFace(e)) says it is theirs to hide; the
 *  calendar it came from says it is work. Anything else hides from the event form, not the card. */
export function showsHideEye(face: EventFace, e: EvLike, subs: readonly SubLike[]): boolean {
  if (face.mode !== "full" || !face.canHide) return false;
  const subId = e.provenance?.subscriptionId;
  if (typeof subId !== "string") return false;
  return subs.find((s) => s.id === subId)?.isWork === true;
}

/** What the owner reads above the blur of their own hidden event. */
export function hiddenCaption(face: Extract<EventFace, { mode: "ownHidden" }>): string {
  if (face.secret) return "A surprise, hidden from the family";
  return face.kind === "work" ? "Work, hidden from the family" : "Hidden from the family";
}
