// How an event is SHOWN to the person holding this phone (ADR-005).
//
// The server has already decided what this person may know (server/event-privacy.mjs):
//  - someone else's hidden time arrives as a BLOCK — a stand-in record with `block`, an id
//    starting "blk_", a title like "Beannie working", and nothing else of the events inside;
//  - the viewer's OWN events carry `privacy` — obscured (hidden from the family), why
//    ("work" calendar or hidden by hand = "busy"), whether it looks like a surprise, and
//    whether they may flip it (canToggle).
// This file only turns that into one of three faces, so every screen draws the same thing:
//   full       an ordinary card
//   ownHidden  the owner's own hidden event: blurred until they share it, eye-slash on top
//   block      someone else's hidden time: frosted, their photo + "<Name> working"
import type { EventRecord } from "@/generated/actions";

type Ev = Pick<EventRecord, "id" | "title" | "ownerId"> & Partial<Pick<EventRecord, "privacy" | "block">>;

export type HiddenKind = "work" | "busy";
export type EventFace =
  | { mode: "full"; canHide: boolean; secret: boolean }
  | { mode: "ownHidden"; kind: HiddenKind; secret: boolean }
  | { mode: "block"; kind: HiddenKind; label: string; ownerId: string | null };

/** A stand-in for someone else's hidden time — not a real event: never open, edit or act on it. */
export function isBlock(e: Pick<Ev, "id"> & Partial<Pick<Ev, "block">>): boolean {
  return !!e.block || String(e.id ?? "").startsWith("blk_");
}

export function eventFace(e: Ev): EventFace {
  if (isBlock(e)) {
    const kind: HiddenKind = e.block?.kind === "busy" ? "busy" : "work";
    return { mode: "block", kind, label: e.title || (kind === "work" ? "Working" : "Busy"), ownerId: e.ownerId ?? null };
  }
  const p = e.privacy;
  if (p?.obscured && !p.withheld) return { mode: "ownHidden", kind: p.kind === "busy" ? "busy" : "work", secret: p.secret === true };
  return { mode: "full", canHide: p?.canToggle === true, secret: p?.secret === true };
}

/** May the person holding the phone flip this event between hidden and shared? */
export function canToggleSharing(e: Ev): boolean {
  return !isBlock(e) && e.privacy?.canToggle === true;
}

/** The accessibility sentence for the eye button, in the state it would switch TO. */
export function eyeLabel(face: EventFace): string {
  return face.mode === "ownHidden" ? "Share with family" : "Hide from family";
}
