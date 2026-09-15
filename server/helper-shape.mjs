// FamiliOS — the shape of a helper, with no dependencies.
//
// A leaf module on purpose: helpers.mjs (which runs them), context.mjs (which describes
// them to the model) and the route layer all need the same answer to "when does this run"
// and "what is it allowed to do", and a shared leaf is what keeps those three from
// importing each other in a circle.
//
// Everything here is a pure function of a stored helper record (plus, for the nest check,
// one membership lookup).
import { actorInNest } from "./store.mjs";

export const AUTONOMY = ["ask", "act", "full"];
export const AUTONOMY_TEXT = {
  ask: "Asks before it does anything",
  act: "Does everyday things on its own, asks before sending or spending",
  full: "Does everything on its own, including sending and spending",
};
export const SCHEDULE_KINDS = ["manual", "hourly", "daily", "weekly"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "7:30" / "07:30" → { hour, minute, text:"07:30" }; anything else → null. */
export function parseClock(v) {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]), minute = Number(m[2]);
  if (!(hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)) return null;
  return { hour, minute, text: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

/** "07:00" → "7:00 AM". The anchor already IS the household's wall clock, so this is string
 *  formatting, not a timezone conversion — running it through one would shift the hour the
 *  family typed. */
export function clockText(hhmm) {
  const a = parseClock(hhmm);
  if (!a) return String(hhmm ?? "");
  const h12 = a.hour % 12 === 0 ? 12 : a.hour % 12;
  return `${h12}:${String(a.minute).padStart(2, "0")} ${a.hour < 12 ? "AM" : "PM"}`;
}

export function normalizeSchedule(input) {
  const s = input && typeof input === "object" ? input : {};
  const kind = SCHEDULE_KINDS.includes(s.kind) ? s.kind : "manual";
  if (kind === "manual") return { kind: "manual" };
  if (kind === "hourly") return { kind: "hourly" };
  const time = parseClock(s.time)?.text ?? "07:00";
  if (kind === "daily") return { kind: "daily", time };
  const weekday = Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6 ? s.weekday : 1;
  return { kind: "weekly", time, weekday };
}

/** Plain-English schedule, on the household's clock. Never an interval in milliseconds. */
export function scheduleText(schedule) {
  const s = normalizeSchedule(schedule);
  if (s.kind === "manual") return "Only when you ask";
  if (s.kind === "hourly") return "Every hour";
  if (s.kind === "daily") return `Every day at ${clockText(s.time)}`;
  return `Every ${WEEKDAYS[s.weekday]} at ${clockText(s.time)}`;
}

/** Read the autonomy dial off a stored record, including one written by the old registry
 *  (where it was an `unattended` object nobody could find). */
export function autonomyOf(helper) {
  const un = helper?.approvalPolicy?.unattended;
  if (!un || un.enabled !== true) return "ask";
  return un.includeHighRisk === true ? "full" : "act";
}

export function autonomyText(helper) {
  return AUTONOMY_TEXT[autonomyOf(helper)];
}

/* ------------------------------ who can see it ------------------------------ */

/** A PERSONAL helper exists only for the member who made it; a NEST helper for that nest
 *  and nobody else, not the Owner and not an Adult Admin. Its creator keeps it either way,
 *  so leaving a nest never loses you your own work. */
export function helperVisibleTo(h, session) {
  if (!h) return false;
  if (h.visibility === "nest") {
    return h.createdBy === session?.actorId || actorInNest(h.nestId, session?.householdId, session?.actorId);
  }
  return !(h.visibility === "personal" && h.createdBy && h.createdBy !== session?.actorId);
}

/* --------------------------- what it may reach ------------------------------ */

/** The engine-facing policy guard, re-validated at run time. A denied id is always
 *  blocked; with a non-empty allow-list only listed ids pass; an empty allow-list is
 *  permissive (deny-only), which is the default every helper now starts from.
 *
 *  Autonomy is a SEPARATE question answered by policy.mjs: this says what a helper may
 *  touch at all, that says what it may do without asking. Keeping them apart is what lets
 *  a family reason about one dial instead of a matrix. */
export function isToolStepAllowed(agent, toolId) {
  if (!toolId) return { ok: true };
  if ((agent?.deniedToolIds ?? []).includes(toolId) || (agent?.deniedFunctionIds ?? []).includes(toolId)) {
    return { ok: false, reason: "denied", message: `"${toolId}" is on this helper's blocked list.` };
  }
  const allow = [...(agent?.allowedToolIds ?? []), ...(agent?.allowedFunctionIds ?? [])];
  if (allow.length > 0 && !allow.includes(toolId)) {
    return { ok: false, reason: "not_permitted", message: `"${toolId}" is not something this helper is allowed to use.` };
  }
  return { ok: true };
}
