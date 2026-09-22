// Helpers the family-data tools share. Moved out of internal-functions.mjs verbatim so a
// declared action (actions/events.mjs) and the tools still written by hand use the SAME
// checks — the point of the move is that there is one unknownMember, not two.
import crypto from "node:crypto";
import { getMember } from "../store.mjs";

export const eid = (p) => p + "_" + crypto.randomBytes(8).toString("hex");
export const nowISO = () => new Date().toISOString();
// The HTTP create routes refuse an unparseable stamp (ISS-105) so an event can never be
// stored on no day; these tools took the model's string verbatim, which is how "tomorrow"
// became a row that rendered nowhere and a run that still reported ok:true.
export const badStamp = (v) => v != null && v !== "" && Number.isNaN(+new Date(v));
export const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
/* A member id the model made up used to be stored as-is — an event with a participant
 * nobody can see, a task assigned to a ghost, a driver who does not exist (found by the
 * App QA helper, 2026-09-22, alongside priority "urgent" and meal slot "brunch", all
 * accepted without a word). The roster is the only source of ids (famili__list_members);
 * an id that is not on it is refused with a reason the model can act on. */
export const unknownMember = (id) => {
  if (id == null || id === "") return null;
  const m = getMember(String(id));
  return m && !m.archived ? null : String(id);
};
export const ghostMessage = (id) => `No household member has the id "${id}" — list members to find the right one.`;
