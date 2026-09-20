// FamiliOS — which model answers which question.
//
// The household has always had exactly ONE active provider and one model, used by every
// call site: chat, helper runs, the engine's reasoning step, input fill, the memory judge.
// That is right for work a person is waiting on and wrong for work nobody asked for.
//
// The passive group-chat listener runs on family chat volume and returns an empty answer
// almost every time. Paying frontier prices to be told "nothing here" a few hundred times a
// day is how the unit economics stop working, so it gets its own cheap tier.
//
// The rule that matters is the one this module refuses to break: THERE IS NO FALLBACK FROM
// THE TRIAGE TIER TO THE DENSE ONE. An unconfigured triage tier makes the listener inert
// and says so. A silent fallback would quietly bill the expensive model for every message
// in a family group chat, and the family would find out from an invoice — which is exactly
// the fabricated readiness this codebase refuses everywhere else.
//
// Autonomy is a separate question answered by policy.mjs; this only says which brain.
import { getSettings } from "./store.mjs";
import { aiProviderById, providerReadiness } from "./ai.mjs";

/** Is a provider id actually usable right now (configured, not merely named)? */
function usable(providerId) {
  const p = aiProviderById(providerId);
  if (!p) return false;
  return ["healthy", "configured", "needs_health_check"].includes(providerReadiness(p));
}

/**
 * The cheap classifier tier.
 * @returns {{ok:true, providerId:string, model:string|null} | {ok:false, error:string, message:string}}
 */
export function triageTier(householdId) {
  const s = getSettings(householdId);
  const providerId = s.aiTriageProvider;
  if (!providerId) {
    return { ok: false, error: "triage_not_configured", message: "No triage model is set up, so Famili is not listening in chats." };
  }
  if (!usable(providerId)) {
    // Named but not configured is a different failure from not named, and the difference
    // is actionable: one needs a choice, the other needs a key.
    return { ok: false, error: "triage_not_configured", message: `The triage provider (${aiProviderById(providerId)?.name ?? providerId}) has no key yet, so Famili is not listening in chats.` };
  }
  const model = String(s.aiTriageModel ?? "").trim() || aiProviderById(providerId)?.defaultModel || null;
  return { ok: true, providerId, model };
}

/**
 * The household's ordinary provider — the one a person waits on. Named here so call sites
 * read as intent ("the dense tier") rather than as a settings key lookup, and so the two
 * tiers are visibly two decisions rather than one setting used twice.
 * @returns {{ok:true, providerId:string, model:string|null} | {ok:false, error:string, message:string}}
 */
export function denseTier(householdId) {
  const s = getSettings(householdId);
  const providerId = s.aiActiveProvider;
  if (!providerId) return { ok: false, error: "no_provider", message: "No AI provider is set up for this household yet." };
  if (!usable(providerId)) return { ok: false, error: "no_provider", message: `The active provider (${aiProviderById(providerId)?.name ?? providerId}) isn't configured.` };
  // `model: null` means "whatever this provider is configured with" — the dense tier's
  // model lives on the provider config (ai.<id>.fields.model), not in settings, and
  // providerChat already resolves it. Only the triage tier carries a model in settings,
  // because it is a second choice against a provider the household may not otherwise use.
  return { ok: true, providerId, model: null };
}

/** Default ceiling for triage calls per household per day when nothing is set. Sized for a
 *  busy family group chat at roughly one call per debounced window, not per message. */
export const DEFAULT_TRIAGE_DAILY_BUDGET = 400;

/** The usage `kind` triage records under. Kept here so the meter and the budget check can
 *  never drift apart by a typo. */
export const TRIAGE_USAGE_KIND = "triage";
