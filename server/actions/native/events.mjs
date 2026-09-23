// The native event WRITES (ADR-004 Stage 1): famili.update_event and famili.delete_event.
//
// Same visibility and ownership rules as the HTTP routes in index.mjs, mirrored here so chat
// can never do more than the app — the bodies are the ones that lived inline in
// assistant-agent.mjs nativeTools(), moved unchanged but for one thing: the kill switch.
// Each of them used to read getSettings().externalActionsEnabled by hand before a Google
// call; they now ask googleReachAllowed() (calendar.mjs), the one helper plan_meal's push
// and retireMeal already use, with the same sentence and the same outcome.
import { getEvent, patchEvent, deleteEventRec, getMember, isAdultRole, getSettings, appendAudit } from "../../store.mjs";
import { isEditableLinkedGoogle, editLinkedGoogleEvent, pushEventToGoogle, deleteLinkedGoogleEvent, deleteGoogleCopy, googleReachAllowed } from "../../calendar.mjs";
import { defineAction } from "../define-action.mjs";
import { badStamp } from "../shared.mjs";
import { KEY_HINTS, publicEvent, readOnly, nativeScope, always, PROJECTION } from "./shared.mjs";

const NATIVE = { requiresApproval: false, delivers: false, lane: "native", timeoutMs: 60_000, available: always };
// What editLinkedGoogleEvent / deleteLinkedGoogleEvent can answer, passed through as is.
const GOOGLE_ERRORS = ["not_linked_google", "needs_reconnect", "google_error"];

export const familiUpdateEvent = defineAction({
  id: "famili.update_event",
  name: "Change an existing event",
  description: "Move, rename, or edit a calendar event the asker owns (time, end, all-day, location, notes, participants, driver, status confirmed|draft). Look the event up first. Someone else's event, or one mirrored from an outside calendar, can't have its time/title changed here — the result says so.",
  action: "Write", risk: "Low", ...NATIVE,
  input: { type: "object", properties: { eventId: KEY_HINTS.eventId, title: KEY_HINTS.title, startAt: KEY_HINTS.startAt, endAt: KEY_HINTS.endAt, allDay: { type: "boolean" }, location: KEY_HINTS.location, notes: KEY_HINTS.notes, participantIds: KEY_HINTS.participantIds, driverId: KEY_HINTS.driverId, status: { type: "string", enum: ["draft", "confirmed", "cancelled"] } }, required: ["eventId"], additionalProperties: false },
  output: {
    type: "object",
    properties: { event: PROJECTION, localOnly: { type: "boolean" }, google: { type: "string" } },
    required: ["event"], additionalProperties: false,
  },
  errorCodes: ["invalid_input", "read_only_profile", "event_not_found", "forbidden", "invalid_startAt", "invalid_endAt", "unknown_member", "not_event_owner", "read_only_layer", "external_actions_disabled", ...GOOGLE_ERRORS],
  async run(ctx, input) {
    const { session, hh, channel, seeable, canWrite } = nativeScope(ctx);
    if (!canWrite) return readOnly();
    const ev = getEvent(String(input?.eventId ?? ""));
    /* In the group thread an event the channel may not show is answered exactly as a missing
     * one: "isn't visible" would tell the thread it exists. Elsewhere unchanged. (ADR-004.) */
    if (!ev || ev.householdId !== hh || (channel === "group" && !seeable(ev))) return { ok: false, error: "event_not_found", message: "No such event — list events to find the right id." };
    if (!seeable(ev)) return { ok: false, error: "forbidden", message: "That event isn't visible to this person." };
    const { eventId, ...patch } = input ?? {};
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
    if (badStamp(patch.startAt)) return { ok: false, error: "invalid_startAt", message: "startAt isn't a valid timestamp." };
    if (badStamp(patch.endAt)) return { ok: false, error: "invalid_endAt", message: "endAt isn't a valid timestamp." };
    // A made-up member id is refused here for the same reason as at creation: an event
    // with a participant nobody can see is a record the family cannot reason about.
    for (const id of Array.isArray(patch.participantIds) ? patch.participantIds : []) {
      const m = getMember(String(id));
      if (!m || m.archived) return { ok: false, error: "unknown_member", message: `No household member has the id "${id}" — list members to find the right one.` };
    }
    if (patch.driverId != null && patch.driverId !== "") {
      const m = getMember(String(patch.driverId));
      if (!m || m.archived) return { ok: false, error: "unknown_member", message: `No household member has the id "${patch.driverId}" — list members to find the right one.` };
    }
    const linkedGoogle = ev.layer === "linked" && isEditableLinkedGoogle(ev, hh, session.actorId);
    const ownerMember = ev.ownerId ? getMember(ev.ownerId) : null;
    const isOwner = ownerMember ? (ev.ownerId === session.actorId || linkedGoogle) : (ev.createdBy === session.actorId || linkedGoogle || isAdultRole(session.role));
    if (!isOwner) {
      const who = getMember(ev.ownerId ?? ev.createdBy)?.displayName ?? "its owner";
      return { ok: false, error: "not_event_owner", message: `This is ${who}'s event — only they can change it. Offer to draft a message to them instead.` };
    }
    if (ev.layer && ev.layer !== "canonical" && !linkedGoogle) {
      const SOURCE = ["title", "startAt", "endAt", "allDay", "location"];
      const claimed = Object.keys(patch).filter((k) => SOURCE.includes(k));
      if (claimed.length) return { ok: false, error: "read_only_layer", message: `This event comes from a calendar outside FamiliOS, so its ${claimed.join(", ")} can only change there. Notes, who's going and a driver can still be added here.` };
      const updated = patchEvent(ev.id, patch);
      appendAudit({ type: "event.append", eventId: ev.id, fields: Object.keys(patch), via: "assistant", householdId: hh, actorId: session.actorId });
      return { ok: true, result: { event: publicEvent(hh, updated), localOnly: true } };
    }
    if (linkedGoogle) {
      const { title, startAt, endAt, location, notes, ...localOnly } = patch;
      const gPatch = Object.fromEntries(Object.entries({ title, startAt, endAt, location, notes }).filter(([, v]) => v !== undefined));
      if (Object.keys(gPatch).length) {
        if (!googleReachAllowed(hh)) return { ok: false, error: "external_actions_disabled", message: "External actions are paused by the household kill switch, so the Google copy can't be changed right now." };
        const r = await editLinkedGoogleEvent({ ev, patch: gPatch, householdId: hh, actorId: session.actorId });
        appendAudit({ type: "event.update", eventId: ev.id, ok: r.ok, target: "google-linked", via: "assistant", householdId: hh, actorId: session.actorId });
        if (!r.ok) return { ok: false, error: r.error, message: r.message ?? "Google rejected the change." };
      }
      const updated = Object.keys(localOnly).length ? patchEvent(ev.id, localOnly) : getEvent(ev.id);
      return { ok: true, result: { event: publicEvent(hh, updated), google: "updated" } };
    }
    const updated = patchEvent(ev.id, patch);
    appendAudit({ type: "event.update", eventId: ev.id, fields: Object.keys(patch), via: "assistant", householdId: hh, actorId: session.actorId });
    let google;
    if (getSettings(hh).calendarAutoSync === true && updated.provenance?.googleEventId && googleReachAllowed(hh)) {
      const r = await pushEventToGoogle({ ev: updated, householdId: hh, actorId: session.actorId }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
      google = r.ok ? "updated" : `not updated (${r.error})`;
    }
    return { ok: true, result: { event: publicEvent(hh, updated), ...(google ? { google } : {}) } };
  },
});

export const familiDeleteEvent = defineAction({
  id: "famili.delete_event",
  name: "Delete an event",
  description: "Remove a calendar event the asker owns (or any event, for an adult). Look it up first and confirm it is the right one. Events mirrored from an outside calendar can't be deleted here.",
  action: "Write", risk: "Medium", ...NATIVE,
  input: { type: "object", properties: { eventId: KEY_HINTS.eventId }, required: ["eventId"], additionalProperties: false },
  output: {
    type: "object",
    properties: { deleted: { type: "boolean" }, title: { type: "string" }, google: { type: "string" } },
    required: ["deleted", "title"], additionalProperties: false,
  },
  errorCodes: ["invalid_input", "read_only_profile", "event_not_found", "forbidden", "read_only_layer", "external_actions_disabled", ...GOOGLE_ERRORS],
  async run(ctx, input) {
    const { session, hh, channel, seeable, canWrite } = nativeScope(ctx);
    if (!canWrite) return readOnly();
    const ev = getEvent(String(input?.eventId ?? ""));
    /* In the group thread an event the channel may not show is answered exactly as a missing
     * one — same code, same words — so nothing about someone's private event (that it exists,
     * whose it is, its title in the result) reaches a thread people outside the household read.
     * Elsewhere unchanged: the ownership rule below is the app's. (ADR-004 decision C.) */
    if (!ev || ev.householdId !== hh || (channel === "group" && !seeable(ev))) return { ok: false, error: "event_not_found", message: "No such event." };
    if (!isAdultRole(session.role) && ev.ownerId !== session.actorId) return { ok: false, error: "forbidden", message: "Only the event's owner or an adult can delete it." };
    const editableLinked = isEditableLinkedGoogle(ev, hh, session.actorId);
    if (ev.layer && ev.layer !== "canonical" && !editableLinked) return { ok: false, error: "read_only_layer", message: "This event is synced from another calendar and can't be deleted here." };
    const external = googleReachAllowed(hh);
    if (ev.layer === "linked" && editableLinked) {
      if (!external) return { ok: false, error: "external_actions_disabled", message: "External actions are paused by the household kill switch." };
      const r = await deleteLinkedGoogleEvent({ ev, householdId: hh, actorId: session.actorId });
      appendAudit({ type: "event.delete", eventId: ev.id, ok: r.ok, target: "google-linked", via: "assistant", householdId: hh, actorId: session.actorId });
      if (!r.ok) return { ok: false, error: r.error, message: r.message ?? "Google rejected the delete." };
      return { ok: true, result: { deleted: true, title: ev.title, google: "deleted" } };
    }
    let google = null;
    if (ev.provenance?.googleEventId) {
      if (!external) google = "kept (external actions paused)";
      else { const r = await deleteGoogleCopy({ ev, householdId: hh, actorId: session.actorId }); google = r.ok ? "deleted" : `kept (${r.error ?? "google error"})`; }
    }
    deleteEventRec(ev.id);
    appendAudit({ type: "event.delete", eventId: ev.id, ok: true, via: "assistant", ...(google ? { google } : {}), householdId: hh, actorId: session.actorId });
    return { ok: true, result: { deleted: true, title: ev.title, ...(google ? { google } : {}) } };
  },
});
