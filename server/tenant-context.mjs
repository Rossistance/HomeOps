// C1.4 tenant context — which household the current execution acts for.
//
// The store's synchronous accessors can't take a householdId parameter without
// rewriting hundreds of call sites, so the household rides on Node's
// AsyncLocalStorage instead: every HTTP request runs inside a context that
// gate() fills in from the session; engine runs, trigger fires, and boot loops
// enter the context of the household they work for. Code that runs outside any
// context (boot, seed, legacy paths) resolves to the resident household.
//
// The request wrapper uses a MUTABLE store object (not enterWith): the whole
// request runs inside als.run(), and setTenant() fills the household in once
// the session is known — no cross-request leakage, no enterWith sharp edges.
import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage();
export const RESIDENT_TENANT = "local";

/** Run fn inside a fresh, not-yet-identified context (one per HTTP request). */
export function runWithRequestContext(fn) {
  return als.run({ householdId: null }, fn);
}
/** Run fn as a specific household (engine runs, trigger fires, tenant loops). */
export function runWithTenant(householdId, fn) {
  return als.run({ householdId: householdId ?? RESIDENT_TENANT }, fn);
}
/** Identify the current request's household (called by gate() once the session resolves). */
export function setTenant(householdId) {
  const s = als.getStore();
  if (s) s.householdId = householdId ?? RESIDENT_TENANT;
}
/** The acting household, or the resident household when nothing set one. */
export function currentTenant() {
  return als.getStore()?.householdId ?? RESIDENT_TENANT;
}
