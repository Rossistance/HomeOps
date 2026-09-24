// FamiliOS AI — backend control plane (Node built-in http; no extra dependencies).
// Deny-by-default authority: origin allowlist, authenticated sessions, CSRF on
// mutations, role checks, server-side approval records (consume-once), PKCE OAuth,
// HMAC webhooks, SSRF-guarded egress, a real job scheduler, AI provider adapters,
// and audit logging with actor/origin/request identity.
import "./loadEnv.mjs"; // must run before modules that read env at import time (auth.mjs)
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getConnectorConfig, setConnectorConfig, revokeConnector, getSecret,
  appendAudit, readAudit, getWebhookEvents, addWebhookEvent, getSettings, setSettings, getDataRev,
  getDataRevForTenant, revEmitter,
  quarantinedCollections, acknowledgeQuarantine, CURRENT_TENANT, forEachTenant, runWithTenant, currentTenant,
  migrateVaultToTenantKeys, getAiUsage,
  tenantEngine, sysDoc, putSysDoc, deleteSessionsForHousehold, getPlan, setPlanFromEntitlement,
  createSession, deleteSession, deleteSessionsForActor, deleteElevatedSessions, BREAK_GLASS_LIFETIME_MS, createApproval, getApproval, decideApproval, consumeApproval, listApprovals,
  putOAuthState, takeOAuthState, getHealth, setHealth, getJobState, setJobState, seenWebhookNonce,
  getPushTokens, addPushToken, removePushToken,
  getRun, listRuns,
  getMember, listMembers, putMember, canApprove, isAdultRole,
  listEvents, getEvent, putEvent, patchEvent, deleteEventRec,
  listTasks, getTask, putTask, patchTask, deleteTaskRec, listTaskLists, addTaskList, markTaskListDeleted,
  listSubscriptions, getSubscription, putSubscription, patchSubscription, deleteSubscriptionRec,
  listMeals, getMeal, putMeal, patchMeal,
  listKnowledge, getKnowledge, addKnowledge, patchKnowledge, removeKnowledge, normalizeVisibility,
  listConversations, getConversation, putConversation, appendConversationMessage, deleteConversationRec,
  canSeeEntity, listMemory, listArtifacts, getMemoryEntry, deleteMemoryEntry,
  listRiskOverrides, putRiskOverride, deleteRiskOverrideRec, getRiskOverride,
  listNotifications, markNotificationRead,
  listContactMethods, getContactMethod, putContactMethod, patchContactMethod, deleteContactMethodRec,
  getContactVerification, putContactVerification, patchContactVerification, deleteContactVerification,
  listFiles, getFileRec, putFileRec, patchFileRec, writeFileBlob, readFileBlob, deleteFileRec,
  listHelpRequests, getHelpRequest, putHelpRequest, patchHelpRequest,
  addNotification, getAccountRaw,
  clearCollection,
  assistantTurnKey, claimAssistantTurn, finishAssistantTurn, releaseAssistantTurn,
} from "./store.mjs";
import { startRun, resumeRun, cancelRun, recoverRuns, findRunByApprovalId, runEmitter, expireStaleRuns, setDraining, releaseAllLeases } from "./engine.mjs";
import { createBackup, listBackups, readBackup, restoreBackup, backupTick, deleteBackupsFor, listLegacyBackups, readLegacyBackup, restoreLegacyBundle } from "./backup.mjs";
import { exportHouseholdWithAudit } from "./export.mjs";
import { registerAssistantRunHooks } from "./assistant-runs.mjs";
import { platformMailReady, sendPlatformEmail, platformMailStatus } from "./mailer.mjs";
import { closeBrowser } from "./browser.mjs";
import { orchestrate, ensureDefaultHelper, clientSourceRef } from "./orchestrator.mjs";
import { sandboxEnabled, seedSandboxAccounts, listSandboxEffects } from "./sandbox-connectors.mjs";
import { seedDefaults } from "./seed.mjs";
import { calendarCan, canAddCalendar, subscriptionOwnerId, ADULT_ROLES } from "./calendar-permissions.mjs";
import { backfillCalendarOwners, restampSubscriptionEvents } from "./calendar-owners.mjs";
import { syncSubscription, removeSubscriptionEvents, pullGoogleEdits, resolveConflictPatch, pushEventToGoogle, autoSyncGoogle, isEditableLinkedGoogle, editLinkedGoogleEvent, deleteLinkedGoogleEvent, deleteGoogleCopy } from "./calendar.mjs";
import { refreshHouseholdCalendars, kickCalendarRefresh, awaitCalendarRefresh } from "./calendar-refresh.mjs";
import { handleInboundSms, replyToSender, setLoopReplyHandler } from "./sms.mjs";
import { bluebubblesConfig, parseInboundWebhook, webhookSecretPresented, secretMatches } from "./bluebubbles.mjs";
import {
  handleInboundGroup, withChatLock, speakPermission, bindChat, revokeChat, setCoordinationOpener, announceStoragePolicy, dropNonMemberMessages,
} from "./group-chat.mjs";
import { runWakeTurn } from "./group-agent.mjs";
import { triageTier } from "./ai-tier.mjs";
import { sweepGroupTriageAllTenants, pruneChatDecisions } from "./group-triage.mjs";
import { openLoopFromRefusal, sweepCoordinationLoopsAllTenants, answerLoopReply } from "./coordination.mjs";
import {
  createHelper, updateHelper, deleteHelper, listHelpers, getHelper, publicHelper,
  runHelper, mayWriteHelper, helperTemplates, reanchorHelperSchedules,
} from "./helpers.mjs";
import { AUTONOMY, SCHEDULE_KINDS } from "./helper-shape.mjs";
import { nameConversation } from "./context.mjs";
import { suggestAddresses, placesProvider } from "./places.mjs";
import { hashPin, verifyPin, needsRehash, matchesPlainSecret } from "./pin.mjs";
import { createNest, inviteToNest, respondToNest, leaveNest, nestsFor, nestInvitesFor, canSeeNest, canSeeMemory, canForgetMemory, publicNest, nestLabel, listNests, resolveVisibility } from "./nests.mjs";
import { understandFile } from "./file-understanding.mjs";
import { isValidReminder, isValidReminderList, sweepTaskReminders, sweepTaskArchive, sweepEventReminders } from "./reminders.mjs";
import { householdTimeZone, formatForHousehold } from "./household-time.mjs";
import { addEventTombstone } from "./store.mjs";
import { listImessageChats, getImessageChat } from "./store.mjs";
import { readPreviewToken, renderPreviewCard, renderPreviewGone } from "./preview-token.mjs";
import { resolvePreview } from "./share-preview.mjs";
import { privacyContext as eventPrivacyContext, obscureStateOf, obscuredLabel } from "./event-privacy.mjs";

/** Which household owns the record a preview token names. resolvePreview gates on
 *  canSeeEntity, which never compares householdId, so this is the check that actually
 *  confines a signed token to the household it was minted for. */
function previewOwnerHousehold(type, id) {
  try {
    if (type === "event") return getEvent(id)?.householdId ?? null;
    if (type === "task" || type === "list_item") return getTask(id)?.householdId ?? null;
    if (type === "meal") return getMeal(id)?.householdId ?? null;
    if (type === "file") return getFileRec(id)?.householdId ?? null;
    if (type === "help_request") return getHelpRequest(id)?.householdId ?? null;
  } catch { /* a missing record is a missing preview, handled by the caller */ }
  return null;
}
import { getAgent, getViewerNote, putViewerNote } from "./store.mjs";
import { captureMemoryFromExchange } from "./memory-capture.mjs";
import {
  createTrigger, updateTrigger, deleteTrigger, fireTrigger, fireWebhookTrigger, fireConnectorEvent,
  publicTrigger, listPublicTriggers, getTriggerSecret, tick, TRIGGER_TYPES, registerTriggerRunHooks, scheduleTextFor,
  reanchorTriggersForHousehold, setHelperRunner,
} from "./triggers.mjs";
import { getTrigger } from "./store.mjs";
import { pushApprovalNotification, deliverNotification, sendVerificationCode, sendRecoveryCode, pushToMember } from "./notify.mjs";
import { handleFamilyMessageRoutes } from "./family-messages-routes.mjs";
import { handleActionRoutes } from "./actions/routes.mjs";
import { hiddenEventRefusal, privacyContext, normalizeCalendarScope } from "./event-privacy.mjs";
import { newEventRecord } from "./actions/schemas/event.mjs";
import { newTaskRecord } from "./actions/schemas/task.mjs";
import { syncMealGroceries, mealEventFields, retireMeal } from "./actions/meals.mjs";
import { createHelpRequest } from "./help-requests.mjs";
import { postMessage as postFamilyMessage } from "./family-messages.mjs";
import { listConnectors, connectorById, publicConnector, healthCheck, executeTool, readinessOf } from "./connectors.mjs";
import { gate, corsHeaders, sessionCookie, clearSessionCookie, isAllowedOrigin, ALLOWED_ORIGINS, IS_PROD, roleAtLeast, sessionFromReq } from "./auth.mjs";
import { memoryProvider } from "./memory-provider.mjs";

// Sliding-window rate-limit buckets (in-process; per-IP pre-auth, per-actor assistant).
const _rateBuckets = new Map();
setInterval(() => { if (_rateBuckets.size > 5000) _rateBuckets.clear(); }, 10 * 60_000).unref();
import { listProviders as listAIProviders, aiProviderById, setProviderConfig, revokeProvider, setActiveProvider, providerHealth, providerModels, providerChat, bootstrapAIFromEnv } from "./ai.mjs";
import { listProviders as listConnectorProviders, providerById as connectorProviderById, providerConfigured, publicProvider as publicConnectorProvider, findToolGlobal } from "./providers.mjs";
import { buildAuthUrl, exchangeCode, apiForAccount } from "./oauth.mjs";
import { listAccountsFor, getOwnedAccount, upsertAccount, revokeAccount, checkAccountHealth, sweepAccountHealth, publicAccount, accountStatusById } from "./accounts.mjs";
import { generateMiniApp, toolCatalog } from "./context.mjs";
import { runAssistantAgent, askAudience } from "./assistant-agent.mjs";
// The assistant message the durable thread keeps for one turn — shared by both routes so
// the streaming and non-streaming paths can never persist different shapes.
function assistantTurnMessage(out, at) {
  if (!out.ok) {
    return { role: "assistant", kind: "error", text: out.message || "I couldn't respond — no AI provider is available for this household yet.", error: out.error ?? "assistant_error", at };
  }
  return {
    role: "assistant", kind: "answer", text: out.answer ?? "",
    runId: out.run?.id ?? out.runId ?? null, model: out.model ?? null, at,
    ...(Array.isArray(out.toolCalls) && out.toolCalls.length ? { toolCalls: out.toolCalls } : {}),
    ...(Array.isArray(out.runIds) && out.runIds.length ? { runIds: out.runIds } : {}),
    ...(out.degraded ? { degraded: true, fellBackFrom: out.fellBackFrom ?? null } : {}),
  };
}
/* A client names a turn with `clientTurnId`; the name is scoped to the session and the
 * conversation, so two people (or two threads) reusing an id can never collide. An unnamed
 * turn is unguarded — a caller that wants at-most-once has to ask for it. */
function assistantTurnKeyFor(session, body) {
  const id = typeof body?.clientTurnId === "string" ? body.clientTurnId.trim().slice(0, 80) : "";
  return id ? assistantTurnKey(session, body?.conversationId ?? null, id) : null;
}
const TURN_IN_PROGRESS = { ok: false, error: "turn_in_progress", message: "That message is still being handled — it will show up in the thread in a moment." };
// An agent turn that queued an approval-gated step reports the durable run the way a
// legacy plan did, so both clients attach to it and watch it to a terminal state.
function attachAgentRun(out) {
  if (out?.ok && !out.run && out.runId) {
    const r = getRun(out.runId);
    if (r) out.run = publicRun(r);
  }
}

const PORT = Number(process.env.PORT || 8787);
const VERSION = "1.5.0"; // 1.5.0: calendar connections by role (who sees, syncs, edits, assigns, removes which calendar) and household auto-refresh. 1.4.1: a session in use renews (12h is an idle limit, a week absolute; a role or PIN change ends sessions). 1.4: Rung 4 (ADR-004) — native tools behind the gate, plan_meal declared, a child's group write waits for an adult

// WP-006 s3 (connector sandbox): when HOMEOPS_CONNECTOR_SANDBOX=1, an OWNER
// session seeds deterministic sandbox connector accounts for its household, so
// OAuth-gated tools run against in-process mocks (transport only — consent gates,
// approvals, and policy clamps still run for real; see server/sandbox-connectors.mjs).
// Owner-only on purpose: connections are per-actor in this app, and sandbox mode
// must not conjure accounts for actors who never connected anything (the
// sandbox-e2e "no conjure" invariant) — other actors stay truthfully
// not_connected until seeded explicitly. Idempotent; a no-op in real mode.
/* ---- D5 [02:25] — "I am the inventor and owner. I need an interface to generate invite
 * codes for any household. New households do not get this."
 *
 * That is a PLATFORM role, not a household role: no value of `session.role` can express it,
 * because every role is scoped to one household by design and inventing a role that reaches
 * across tenants would put a cross-household capability inside the same field a household
 * Owner controls.
 *
 * So it lives where no household can reach it: a deployment env listing the operator's own
 * sign-in email(s). An empty env means NOBODY is an operator and the routes 404 — which is
 * exactly right for the "new households do not get this" half of the ask, and it means a
 * self-hosted copy of FamiliOS has the surface switched off unless its own operator turns it
 * on. Every use is audited.
 */
function operatorEmails() {
  return String(process.env.HOMEOPS_OPERATOR_EMAILS ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}
/** The signed-in session's own email, read from the identity registry — never from a body. */
function sessionEmail(session) {
  if (!session?.householdId || !session?.actorId) return null;
  const idn = listIdentitiesForHousehold(session.householdId).find((i) => i.actorId === session.actorId);
  return idn?.email ? String(idn.email).toLowerCase() : null;
}
function isOperator(session) {
  const allow = operatorEmails();
  if (allow.length === 0) return false;
  const email = sessionEmail(session);
  return !!email && allow.includes(email);
}

// Break-glass recovery: the sha256 of HOMEOPS_BOOTSTRAP_PIN (operator-only env), or null when
// unset. While present it is accepted as an alternative Owner/Adult-Admin PIN on both sign-in
// paths — seeding the gate before a first PIN exists AND recovering a forgotten one. Every
// break-glass sign-in is audited (session.login.breakglass); the operator clears the env after.
function bootstrapPin() {
  return process.env.HOMEOPS_BOOTSTRAP_PIN || null;
}
/** Is a break-glass PIN configured? There is no digest to keep — the env var IS the secret. */
function hasBootstrapPin() {
  return !!bootstrapPin();
}

/**
 * Re-store a PIN we just verified, in the current format.
 *
 * Called only on a SUCCESSFUL sign-in, so the plaintext is known to be right and the write
 * can't lock anyone out. A failure here is swallowed on purpose: the sign-in already
 * succeeded, and turning a storage hiccup into a refused login would be a worse outcome than
 * upgrading on the next attempt instead.
 */
async function upgradeStoredPin(householdId, pin) {
  try {
    const next = await hashPin(pin);
    setSettings({ ownerPinHash: next }, householdId);
    appendAudit({ type: "settings.pin.rehash", household: householdId, ok: true });
  } catch {
    /* keep the working legacy hash and try again next time */
  }
}
function maybeSeedSandbox(s) {
  if (!sandboxEnabled() || !s?.actorId || s.role !== "Owner") return;
  try { seedSandboxAccounts({ householdId: s.householdId, actorId: s.actorId }); }
  catch (e) { console.warn("[sandbox] account seed failed:", e?.message ?? e); }
}
// ISS-105 ("a created event never appears"): an event whose stamp can't parse renders on
// NO day in either client — apps/mobile event-days.ts `coversDay` and calendar.tsx
// `dayKeys` both drop it — so storing one produced a create that returned 200, sat in the
// GET payload, and was still absent after add, after nav, and after sync. Refuse it at the
// boundary instead. `null` and `""` stay legal: the mobile form's "scheduled" toggle sends
// startAt:null on purpose, and the web store represents an unscheduled event as "".
/* Cluster W — "the advanced mode should come with a warning saying that if you do choose to
 * use this, you risk screwing up agent configuration — possibly a pin input. And the same
 * here on the advanced builders. This should require a pin input."
 *
 * The household PIN, re-entered at the moment of the dangerous act. Not a session flag: the
 * point is a deliberate pause by the person actually holding the phone, and a flag set
 * twenty minutes ago proves nothing about who is holding it now.
 *
 * Returns null when satisfied, or a ready-to-send refusal. A household with no PIN set
 * cannot be gated by one, so it falls back to role — refusing everyone until someone sets
 * a PIN would lock a family out of their own settings. */
/* The three autonomy stances, and what an unset one means.
 *
 * ABSENT READS AS CAUTIOUS, not as the new default. Balanced is the right stance for a family
 * starting today and is written explicitly at signup — but flipping the meaning of "unset"
 * would loosen approvals for every household already running, retroactively, without anyone
 * choosing it. A default may only apply to households that didn't have a behaviour yet. */
/** Which household registered this webhook trigger id, if any?
 *
 * A trigger id is `trg_` + 20 hex, unique across the deployment, so — unlike an inbound text —
 * it identifies its household on its own. There is no ambiguity to resolve here, just a lookup
 * nobody was doing. Returns null for anything that isn't a registered trigger, which is how the
 * shared `/api/webhooks/webhook` connector path keeps its existing resident behaviour.
 *
 * One doc read per household per delivery; the search stops at the first hit. */
async function householdForTriggerId(id) {
  if (!/^trg_[a-f0-9]+$/i.test(String(id))) return null;   // cheap reject: not a trigger id shape
  let found = null;
  await forEachTenant((t) => { if (!found && getTrigger(id)) found = t; });
  return found;
}

/** Inbound-text replay guard (see the /api/webhooks/bluebubbles route). Lives in the _system
 *  tenant: a text is deduplicated before we know whose it is, and a keyword fans out across
 *  households, so the record cannot belong to any single one. The file name predates the
 *  bridge and is kept so an upgrade does not re-answer the last day's texts. */
const SMS_SEEN_FILE = "sms-inbound-seen.json";
const SMS_SEEN_TTL_MS = 24 * 60 * 60 * 1000;

const STANCES_LIST = ["Cautious", "Balanced", "Trusted"];
const DEFAULT_STANCE_FOR_NEW_HOUSEHOLDS = "Balanced";
const STANCE_OR_DEFAULT = (s) => STANCES_LIST.includes(String(s?.autonomy)) ? String(s.autonomy) : "Cautious";

/* ONE projection for both the GET and the POST response.
 *
 * These were two hand-maintained copies of the same object literal, and they drifted the
 * moment a field was added: the write returned a settings object with no `autonomy` in it, so
 * a client that trusted the response — as clients should — rendered the OLD stance straight
 * after successfully changing it. The value was saved and the screen said otherwise, which is
 * this codebase's recurring defect in miniature. Now there is one shape and one place. */
function settingsView(s, session) {
  return {
    externalActionsEnabled: s.externalActionsEnabled !== false,
    ownerPinSet: !!s.ownerPinHash,
    /* breakGlassActive — say out loud that a PIN set in the deployment's environment is ALSO
     * being accepted right now. It's a single shared secret that opens every Owner and Adult
     * Admin account in the resident household, and while it's set there is no way to tell from
     * inside the app that your sign-in went through it. A household shouldn't have to take my
     * word for who can get in. */
    breakGlassActive: !!hasBootstrapPin() && session.householdId === CURRENT_TENANT,
    /* Which places provider is actually answering. There was no way to tell from inside the
     * app whether a Places key had taken — you set one, and found out later by noticing a
     * restaurant had no rating. Here rather than on /api/health because an unauthenticated
     * endpoint should not enumerate which third-party keys a deployment holds. */
    placesProvider: placesProvider(),
    aiActiveProvider: s.aiActiveProvider ?? null,
    /* The cheap tier the passive group-chat listener runs on. Reported separately from the
     * active provider because they are two decisions, and because a household that has not
     * made the second one should see that rather than see a blank. */
    aiTriageProvider: s.aiTriageProvider ?? null,
    aiTriageModel: s.aiTriageModel ?? null,
    aiTriageDailyBudget: Number(s.aiTriageDailyBudget ?? 0) || 0,
    chatProposalsEnabled: s.chatProposalsEnabled === true,
    storeAllChatParticipants: s.storeAllChatParticipants === true,
    chatTranscriptDays: Number(s.chatTranscriptDays ?? 0) || 0,
    calendarAutoSync: s.calendarAutoSync === true,
    autoApproveImprovements: s.autoApproveImprovements !== false,
    autoApproveImprovementsDefaulted: typeof s.autoApproveImprovements !== "boolean",
    timezone: s.timezone ?? null,
    hideProfilesPreAuth: s.hideProfilesPreAuth === true,
    /* The household's autonomy stance (policy.mjs rule 7). Absent reads as Cautious, and
     * `autonomyDefaulted` says whether anyone has actually chosen — so the UI can invite a
     * decision instead of showing a setting that looks deliberate and isn't. */
    autonomy: STANCE_OR_DEFAULT(s),
    autonomyDefaulted: !s.autonomySetAt,
    autonomySetByRole: s.autonomySetByRole ?? null,
    autonomySetAt: s.autonomySetAt ?? null,
    /* The daily AI cap, and today's count against it. A budget you can set but can't watch is
     * only half a control — the number that matters is how close you are to it. Null is
     * unmetered, which is the default. */
    aiDailyCallBudget: Number.isFinite(Number(s.aiDailyCallBudget)) && Number(s.aiDailyCallBudget) > 0 ? Math.floor(Number(s.aiDailyCallBudget)) : null,
    aiCallsToday: getAiUsage(session.householdId)?.total ?? 0,
    /* Does THIS profile sign in with an email account? Only those can be deleted — the resident
     * family's PIN profiles have no identity behind them, and DELETE /api/account tells them so.
     * Surfaced here so a client can omit the button entirely instead of offering one that can
     * only ever refuse, which is the shape of dead control this release has been removing. */
    hasIdentity: !!listIdentitiesForHousehold(session.householdId).find((i) => i.actorId === session.actorId),
  };
}

async function requireHouseholdPin(session, pin) {
  const s = getSettings(session.householdId);
  if (!s.ownerPinHash) return null;                 // nothing to check against
  if (!pin) return { error: "pin_required", message: "Enter your household PIN to change this." };
  const ok = await verifyPin(String(pin), s.ownerPinHash);
  if (!ok) return { error: "pin_incorrect", message: "That PIN didn't match. Nothing was changed." };
  return null;
}

/** The room a chat-born run belongs to.
 *
 * runAssistantPlan never forwarded a visibility, so every chat run took startRun's
 * "household" default — including plans born in a PERSONAL conversation, whose approvals
 * then fanned out to every approver in the family. Someone's private ask announced itself to
 * everyone. memory-capture.mjs already inherits the room an exchange happened in; runs now
 * do too.
 *
 * startRun distinguishes only personal from household, so a NEST conversation resolves to
 * household rather than silently narrowing to one person — a nest's approvers are
 * household-level, and under-notifying an approval is the worse of the two errors. */
function chatRunVisibility(conversationId) {
  if (!conversationId) return undefined;
  const v = getConversation(conversationId)?.visibility;
  return (v === "personal" || v === "private") ? "personal" : undefined;
}

/* Cluster W's reach, applied to contact methods: Owner → everyone; adults → self + nest;
 * everyone else → self. A closure over the session so list filters read cleanly. */
function contactReach(session) {
  if (session.role === "Owner") return () => true;
  const mine = new Set([session.actorId]);
  if (isAdultRole(session.role)) {
    for (const n of nestsFor(session.householdId, session.actorId)) {
      for (const m of (n.members ?? [])) if (m.status === "joined") mine.add(m.actorId);
    }
  }
  return (memberId) => mine.has(memberId);
}

function badTimestamp(v) {
  return v != null && v !== "" && isNaN(+new Date(v));
}

/* resolveVisibility — "who can see it, decided ONCE" — now lives in nests.mjs, because a
 * declared action (actions/events.mjs) needs the same answer the routes get. Imported above. */

/**
 * Which Library space does this document belong in, judged from what it SAYS?
 *
 * Mirrors apps/mobile/src/lib/spaces.ts so the client's preview of where something will land
 * and the server's decision agree — two copies of a rule is how you get a toast that says one
 * thing and a library that shows another.
 *
 * Scored rather than first-match, and "home" is excluded from scoring entirely: a Home Depot
 * receipt contains the word "home", and a naive contents match would file it exactly where it
 * was wrongly filed before. Home is only ever the fallback.
 */
const SPACE_PATTERNS = [
  { tag: "school", re: /school|class|teacher|homework|permission/gi },
  { tag: "medical-ids", re: /medic|health|passport|ids?|insurance|prescription|doctor|dental/gi },
  { tag: "bills-receipts", re: /receipt|invoice|bill|billing|utilit|statement|subtotal|total\s*\$|order\s*#|purchase/gi },
];
/* Every tag that means "which space is this filed in" — including `home`, which is NOT scored
 * above (its pattern matches everything, so it can only ever be the fallback) but IS a filing
 * tag the client sends. Auto-filing replaces whatever is in this set and leaves every other
 * tag alone. Must stay in step with EXPLICIT_TAG in apps/mobile/src/lib/spaces.ts, which is
 * what reads them back. */
const SPACE_TAGS = new Set(["home", "school", "medical-ids", "bills-receipts"]);
function decideSpaceFromText(text, name = "") {
  const body = `${String(text ?? "").slice(0, 6000)} ${name}`;
  let best = null;
  for (const p of SPACE_PATTERNS) {
    const hits = (body.match(p.re) ?? []).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { tag: p.tag, hits };
  }
  return best?.tag ?? null;
}

/* The half of a mirrored event that belongs to the calendar it came from (Q2).
 *
 * These are the fields a re-sync overwrites, and the fields everyone else on that invite
 * is also reading — so changing them here would either be undone without warning or make
 * this household quietly disagree with the source. Everything NOT in this set is a
 * FamiliOS concept the sync has never heard of (who's coming, what to bring, reminders,
 * your own notes), so it is appendable on any event, mirrored or not, and never leaves. */
const SOURCE_OWNED_FIELDS = new Set([
  "title", "startAt", "endAt", "allDay", "location", "notes",
  "recurrence", "rrule", "status", "layer", "source", "provenance",
]);
const FIELD_LABELS = {
  title: "title", startAt: "start time", endAt: "end time", allDay: "all-day setting",
  location: "location", notes: "description", recurrence: "repeat", rrule: "repeat",
  status: "status", layer: "calendar", source: "calendar", provenance: "calendar",
};
const fieldLabel = (k) => FIELD_LABELS[k] ?? k;
const andList = (xs) => {
  const u = [...new Set(xs)];
  return u.length <= 1 ? (u[0] ?? "") : `${u.slice(0, -1).join(", ")} and ${u[u.length - 1]}`;
};

// Per-member accent color: one of the app accent names, or a hex string. Optional and
// back-compat — an unrecognized value is ignored (never stored) rather than erroring.
/* Every accent the app offers, with its canonical (light-theme) hex — kept in step with
 * apps/mobile/src/theme/colors-data.ts. The old six-name list silently DROPPED the newer
 * hues: the picker showed teal chosen, normalize returned undefined, the patch skipped the
 * field, and the picker's confirmation was a false success about a colour that never saved. */
const MEMBER_COLOR_HEX = {
  ink: "#5C554A", sage: "#3F7A4F", coral: "#C6482E", amber: "#B4791E", sky: "#2E6FA3", lavender: "#7C5CA8",
  ember: "#CE5D1D", teal: "#1F7A72", indigo: "#3C4E9E", rose: "#B03A55", moss: "#5A7A2E", clay: "#9A5A2B", plum: "#7A3E7E",
};
const MEMBER_COLORS = Object.keys(MEMBER_COLOR_HEX);
function normalizeMemberColor(v) {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (MEMBER_COLORS.includes(s)) return s;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return s;
  return undefined;
}
/* "The colors have to be strict." One person, one colour, family-wide — enforced HERE, not
 * only in the picker, because the Settings editor proved a second client can undo a rule
 * that lives client-side. Distance mirrors lib/member-colors: rgb-manhattan, same threshold,
 * so what the picker dims is exactly what the API refuses. */
function memberColorHex(c) {
  if (!c) return null;
  if (MEMBER_COLOR_HEX[c]) return MEMBER_COLOR_HEX[c];
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(c);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  return `#${h}`;
}
const COLOR_TOO_CLOSE = 90;
function colorHeldBy(candidate, householdId, exceptActorId) {
  const mine = memberColorHex(candidate);
  if (!mine) return null;
  const a = parseInt(mine.slice(1), 16);
  for (const m of listMembers({ householdId })) {
    if (m.archived || m.actorId === exceptActorId || !m.color) continue;
    const theirs = memberColorHex(m.color);
    if (!theirs) continue;
    const b = parseInt(theirs.slice(1), 16);
    const d = Math.abs(((a >> 16) & 255) - ((b >> 16) & 255)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255));
    if (d < COLOR_TOO_CLOSE) return m;
  }
  return null;
}
// Per-calendar-subscription accent: each connected calendar (a Google account's
// calendar, an ICS feed, a pasted import) gets the next unused accent so its
// events render as distinctly colored cards. Cycles when a household outgrows
// the palette.
const SUB_COLORS = ["sky", "sage", "amber", "lavender", "coral", "ember"];
function nextSubscriptionColor(householdId) {
  const used = listSubscriptions((s) => s.householdId === householdId).map((s) => s.color).filter(Boolean);
  return SUB_COLORS.find((c) => !used.includes(c)) ?? SUB_COLORS[used.length % SUB_COLORS.length];
}
/* Calendar subscriptions: whose it is, what the viewer may do, and what they may SEE.
 * The owner is resolved once here so every route (list, add, sync, patch, delete) applies
 * the same calendarCan matrix to the same person. An owner outside this household (a stale
 * id) counts as no owner — the legacy branch — rather than lending a stranger's role. */
function subscriptionOwnerOf(sub) {
  const account = sub.accountId ? getAccountRaw(sub.accountId) : null;
  const ownerActorId = subscriptionOwnerId(sub, account);
  const m = ownerActorId ? getMember(ownerActorId) : null;
  const owner = m && m.householdId === sub.householdId ? { actorId: m.actorId, role: m.role, displayName: m.displayName ?? null } : null;
  return { account, ownerActorId, owner };
}
const viewerOf = (session) => ({ actorId: session.actorId, role: session.role });
/* The ONLY shape a subscription leaves the server in. The raw record carries icsText and the
 * feed URL, and a feed URL is often a capability in itself (Google's "secret address",
 * school portals' tokenised links) — so a member who may not view a calendar gets only the
 * legend row the calendar screen colours events with, never the address. */
function subscriptionView(sub, session) {
  const { account, ownerActorId, owner } = subscriptionOwnerOf(sub);
  const row = {
    id: sub.id, name: sub.name, source: sub.source, color: sub.color ?? null,
    ownerActorId, ownerName: owner?.displayName ?? (ownerActorId ? (getMember(ownerActorId)?.displayName ?? null) : null),
    isWork: !!sub.isWork, assigned: !!sub.ownerActorId,
  };
  const can = calendarCan(viewerOf(session), sub, owner);
  if (!can.view) return row;
  return {
    ...row,
    url: sub.url ?? null, lastSyncAt: sub.lastSyncAt ?? null, lastResult: sub.lastResult ?? null, eventCount: sub.eventCount ?? 0,
    createdAt: sub.createdAt, accountId: sub.accountId ?? null, accountEmail: account?.displayName ?? null,
    createdBy: sub.createdBy ?? null, can,
  };
}
/* A refusal that says who CAN do it, derived from the same matrix so the sentence can never
 * disagree with the rule. Error code stays not_your_calendar: clients and tests key on it. */
const CAL_ACTION_PHRASE = { sync: "sync this calendar", edit: "change this calendar", markWork: "mark this calendar as work", assign: "change whose calendar this is", remove: "remove this calendar" };
function calendarRefusal(action, sub, owner) {
  const phrase = CAL_ACTION_PHRASE[action] ?? "change this calendar";
  // Not even the Owner may: the only such case is marking a non-adult's calendar as work.
  if (!calendarCan({ actorId: "\u0000owner", role: "Owner" }, sub, owner)[action]) return "Only an adult's calendar can be marked as work.";
  const first = owner ? (String(owner.displayName ?? "").trim().split(/\s+/)[0] || "Another member") : null;
  if (owner?.role === "Owner") return `Only ${first} (the Owner) can ${phrase}.`;
  const who = [];
  if (owner && calendarCan({ actorId: owner.actorId, role: owner.role }, sub, owner)[action]) who.push(first);
  if (calendarCan({ actorId: "\u0000admin", role: "Adult Admin" }, sub, owner)[action]) who.push("an Adult Admin");
  who.push("the Owner");
  const list = who.length === 1 ? who[0] : `${who.slice(0, -1).join(", ")} or ${who[who.length - 1]}`;
  return `Only ${list} can ${phrase}.`;
}
/* The shared front half of the three "add a calendar" routes: who the calendar is FOR, and
 * whether the caller may add it. ownedCount counts calendars the TARGET already owns (the
 * Limited Member cap is about what they have, not who added it). Returns { ok, target } or
 * { ok:false, status, body }. `countCap: false` runs only the role/owner_only checks — used
 * by connect-google before it knows whether it is adding or just re-syncing. */
function resolveCalendarAddTarget(session, body, { countCap = true } = {}) {
  const forMemberId = body?.forMemberId != null && String(body.forMemberId).trim() ? String(body.forMemberId).trim() : null;
  const target = forMemberId ?? session.actorId;
  // The Limited Member cap limits what they add THEMSELVES (ADR-005 decision 3): a calendar
  // the Owner connected for them does not use it up, so only self-added ones are counted.
  const ownedCount = countCap
    ? listSubscriptions((s) => s.householdId === session.householdId).filter((s) => subscriptionOwnerId(s, s.accountId ? getAccountRaw(s.accountId) : null) === target && (forMemberId ? true : (s.createdBy ?? null) === session.actorId)).length
    : 0;
  const can = canAddCalendar(viewerOf(session), { forMember: forMemberId ? { actorId: forMemberId } : null, ownedCount });
  if (!can.ok) return { ok: false, status: can.status, body: { error: can.error, message: can.message } };
  // Validated after the permission check so a caller who may not add for others learns
  // nothing about which member ids exist.
  if (forMemberId) {
    const m = getMember(forMemberId);
    if (!m || m.householdId !== session.householdId || m.archived) return { ok: false, status: 400, body: { error: "bad_member", message: "That member isn't in this household." } };
  }
  return { ok: true, target };
}
// Chat spaces: a conversation lives in its creator's PERSONAL space (private to
// them — the long-standing behavior and the default) or in the FAMILY space
// (visibility "household"), where any household member can read and continue it.
// canSeeMemory lives in nests.mjs now — ONE predicate for the API's GET and DELETE and for
// the assistant's delete tool, so a tool can never touch a memory a route would hide.
/* A run born in a turn that handed an owner's surprise over (ADR-005, sourceRef.secret) is
 * its requester's alone — not the household's adults', not an Owner's — in the runs list, by
 * id, and on every per-run route. Answered as a missing run, so its existence says nothing. */
function secretRunHidden(r, session) {
  return r?.sourceRef?.secret === true && r.actorId !== session.actorId;
}
function canSeeConversation(c, session) {
  if (!c || c.householdId !== session.householdId) return false;
  if (c.actorId === session.actorId) return true;
  // A nest thread is visible to the nest, and to nobody else — not to an Owner, not to an
  // Adult Admin. A space the household's administrator can read is not the space he asked for.
  if (c.visibility === "nest" && c.nestId) return canSeeNest(c.nestId, session.householdId, session.actorId);
  return c.visibility === "household";
}
const APP_ORIGIN = ALLOWED_ORIGINS[0] || "http://localhost:5173";
const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC_DIR = process.env.HOMEOPS_STATIC_DIR || join(ROOT_DIR, "dist");
const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
// Single OAuth callback path; deployments register this exact URI per provider app.
// HOMEOPS_PUBLIC_URL may be a comma-separated list (localhost + LAN IP for mobile);
// the FIRST entry is the canonical one providers redirect back to.
function oauthRedirectUri() {
  const base = (process.env.HOMEOPS_PUBLIC_URL || `http://localhost:${PORT}`).split(",")[0].trim();
  return `${base.replace(/\/$/, "")}/api/oauth/callback`;
}

/* ---- Expo push notifications (fire-and-forget; non-fatal) ---- */
// Shared with the run engine (which notifies when a run parks for approval with no
// browser open) via server/notify.mjs.
const notifyApproval = pushApprovalNotification;

function json(res, code, body, req, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", ...corsHeaders(req), ...extraHeaders });
  res.end(data);
}
function staticPathFor(path) {
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const target = normalize(join(STATIC_DIR, relativePath));
  const rel = relative(STATIC_DIR, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return target;
}
function serveStatic(req, res, path) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (path === "/api" || path.startsWith("/api/")) return false;

  const target = staticPathFor(path);
  if (target && fs.existsSync(target) && fs.statSync(target).isFile()) {
    return sendStatic(req, res, target);
  }

  // SPA fallback: browser routes such as /settings should load the built shell.
  if (!extname(path)) {
    const indexFile = join(STATIC_DIR, "index.html");
    if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) return sendStatic(req, res, indexFile);
  }
  return false;
}
function sendStatic(req, res, file) {
  const ext = extname(file).toLowerCase();
  const name = basename(file);
  const isAsset = file.includes(`${sep}assets${sep}`);
  const cacheControl = name === "index.html" || name === "sw.js" || name === "registerSW.js"
    ? "public, max-age=0, must-revalidate"
    : isAsset ? "public, max-age=31536000, immutable" : "public, max-age=3600";
  res.writeHead(200, {
    "content-type": STATIC_TYPES[ext] || "application/octet-stream",
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}
/* A request body was accumulated with no ceiling at all — any caller could stream an
 * unbounded string into memory. Capped now, and generously: the cap has to clear a real
 * upload (a 25 MB file is ~34 MB of base64 plus JSON overhead) while still being a ceiling.
 * Overflow resolves to null, which every caller already treats as malformed_json. */
const MAX_BODY_BYTES = 64 * 1024 * 1024;
/*
 * Reported as "the Daily Household Briefing has some odd characters in it" — the file was
 * stored as `Daily Household Briefing ÃÂÂ July 13, 2026.pdf`. The original had an em-dash.
 *
 * The cause was here: this used to accumulate with `b += chunk`, which coerces each Buffer to
 * a string SEPARATELY. A multi-byte UTF-8 character straddling a chunk boundary is therefore
 * decoded as two half-characters, and every accent, dash and emoji in a large enough request
 * comes out mangled. Small bodies arrive in one chunk and look perfect, which is exactly why
 * this survived so long — it only bites once a request is big enough to be split, i.e. an
 * upload.
 *
 * Buffers are collected and decoded ONCE, over the whole body, so a character can no longer be
 * torn in half by the network.
 */
function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let len = 0;
    let over = false;
    req.on("data", (c) => {
      if (over) return;
      len += c.length;
      if (len > MAX_BODY_BYTES) { over = true; chunks.length = 0; try { req.destroy(); } catch { /* already gone */ } return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}
async function readBody(req) {
  const raw = await readRaw(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { return null; }
}
function externalActionsEnabled(householdId) { return getSettings(householdId).externalActionsEnabled !== false; }
// A real IANA zone the platform's ICU data recognizes — rejects junk like "PST" or
// "America/Nowhere" before it can silently break trigger scheduling (server/triggers.mjs).
function isValidTimezone(tz) {
  try {
    if (typeof Intl.supportedValuesOf === "function") return Intl.supportedValuesOf("timeZone").includes(tz);
    new Intl.DateTimeFormat("en-US", { timeZone: tz }); // throws RangeError on an unknown zone
    return true;
  } catch { return false; }
}
// C1.5 plan gate for AI-spend routes: resident household and active trials/
// subscriptions pass; an expired household gets an honest 402 with its plan
// state. Family DATA routes are never gated — data is theirs regardless.
function planGate(g, res, req) {
  const plan = getPlan(g.session.householdId);
  if (plan.active) return null;
  return json(res, 402, { error: "plan_required", plan, message: "Your free trial has ended — subscribe to FamiliOS Plus to keep using the assistant and agents. Your family's data stays fully accessible either way." }, req);
}
// Child AI gate: a Child View profile may chat with the assistant only after an adult
// flips their aiEnabled toggle (PATCH /api/members/:id). Runs after gate() so the 403
// is about the toggle, never a session/CSRF leak.
function childAiGate(g, res, req) {
  if (g.session.role !== "Child View") return null;
  if (getMember(g.session.actorId)?.aiEnabled === true) return null;
  return json(res, 403, { error: "ai_disabled", message: "Ask a parent to turn on AI chat for your profile." }, req);
}
function audit(event, req, session) {
  appendAudit({
    ...event,
    actorId: session?.actorId ?? event.actorId ?? null,
    actorName: session?.actorName ?? null,
    role: session?.role ?? null,
    origin: req?.headers?.origin ?? null,
    requestId: req?.__rid ?? null,
    ip: req?.socket?.remoteAddress ?? null,
  });
}

/* I1 — rename a thread from its first exchange, once, and only while it still carries the
 * auto-title (the truncated first message). A family that renamed a chat themselves keeps
 * their name: overwriting a deliberate title with a generated one is worse than a bad title.
 * Fire-and-forget — the turn is already saved and must not wait on, or fail because of, this. */
function maybeNameConversation(convId, { question, answer, session }) {
  const conv = getConversation(convId);
  if (!conv || conv.titleAuto === false) return;
  // Only the FIRST exchange: 2 messages means the pair we just wrote.
  if ((conv.messages ?? []).length > 2) return;
  if (!String(answer ?? "").trim()) return;      // nothing to name it from
  void nameConversation({ question, answer, session })
    .then((title) => {
      if (!title) return;
      const fresh = getConversation(convId);
      if (!fresh || fresh.titleAuto === false) return;
      putConversation({ ...fresh, title, titleAuto: true, updatedAt: new Date().toISOString() });
    })
    .catch(() => { /* the thread keeps the title it already has */ });
}

/* ----------------------------- Job scheduler ---------------------------- */
// A real in-process scheduler. Jobs check connector readiness and run an actual
// read tool; outcomes (success/failure) are audited. Unknown jobs are 404.
const JOBS = [
  { id: "rss-poll", name: "RSS feed poll", connectorId: "rss", toolId: "rss.latest", intervalMs: 15 * 60_000 },
  { id: "weather-morning", name: "Morning weather refresh", connectorId: "weather", toolId: "weather.current", intervalMs: 60 * 60_000 },
];
const jobTimers = new Map();
let schedulerStarted = false;
/* Runs as ONE household — the caller says which.
 *
 * This read `CURRENT_TENANT` for both the kill-switch check and the tool call. CURRENT_TENANT
 * is a constant, not a lookup, so `rss-poll`, `weather-morning` and every `connector_event`
 * trigger downstream of them fired only for the resident household and never for a single
 * signed-up family. The old comment said so and pointed at a ticket. It's a one-line fix now
 * that forEachTenant exists, and until it landed the scheduled half of the product simply did
 * not run for anyone who paid for it.
 *
 * The remaining tenant-sensitive calls here — setJobState, getJobState, appendAudit,
 * connectorById, readinessOf — are all store reads that follow the ambient tenant context, so
 * they come out right as long as this is invoked inside one. That is what forEachTenant and
 * the manual route below both do; the default argument keeps a bare call honest. */
async function runJob(job, trigger = "schedule", householdId = currentTenant()) {
  const c = connectorById(job.connectorId);
  const readiness = c ? readinessOf(c) : "not_configured";
  const ready = ["connected", "authorized_write", "authorized_readonly", "local_only"].includes(readiness);
  setJobState(job.id, { lastRun: Date.now(), lastTrigger: trigger, running: true });
  if (!externalActionsEnabled(householdId)) { setJobState(job.id, { running: false, lastStatus: "blocked_kill_switch" }); appendAudit({ type: "job.run", jobId: job.id, connectorId: job.connectorId, ok: false, error: "kill_switch", trigger }); return { ok: false, error: "external_actions_disabled" }; }
  if (!ready) { setJobState(job.id, { running: false, lastStatus: `connector_${readiness}` }); appendAudit({ type: "job.run", jobId: job.id, connectorId: job.connectorId, ok: false, error: `connector_${readiness}`, trigger }); return { ok: false, error: `connector_${readiness}` }; }
  const out = await executeTool(job.toolId, {}, { actorId: "scheduler", householdId });
  setJobState(job.id, { running: false, lastStatus: out.ok ? "success" : `error:${out.error}`, nextRun: Date.now() + job.intervalMs });
  appendAudit({ type: "job.run", jobId: job.id, connectorId: job.connectorId, ok: out.ok, error: out.ok ? undefined : out.error, trigger });
  // Connector-event triggers (Slice 6): fire only when the poll returns NEW data
  // (fingerprint changed since the last successful poll), so a trigger reacts to a
  // genuine event rather than every poll. Fire-and-forget through the canonical loop.
  if (out.ok) {
    const fp = crypto.createHash("sha256").update(JSON.stringify(out.result ?? {})).digest("hex").slice(0, 16);
    const prev = getJobState(job.id)?.lastHash;
    setJobState(job.id, { lastHash: fp });
    if (prev && prev !== fp) fireConnectorEvent(job.connectorId, { jobId: job.id, result: out.result }).catch(() => {});
  }
  return out;
}
function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  for (const job of JOBS) {
    // Seed each household's own state, not just the resident's — otherwise a family's jobs
    // screen reports "scheduled" for something that has never been scheduled for them.
    void forEachTenant(() => setJobState(job.id, { nextRun: Date.now() + job.intervalMs, lastStatus: getJobState(job.id)?.lastStatus ?? "scheduled" }));
    jobTimers.set(job.id, setInterval(() => { void forEachTenant((t) => runJob(job, "schedule", t).catch(() => {})); }, job.intervalMs));
  }
}
function jobView(job) {
  const st = getJobState(job.id) ?? {};
  return { id: job.id, name: job.name, connectorId: job.connectorId, intervalMs: job.intervalMs, lastRun: st.lastRun ?? null, nextRun: st.nextRun ?? null, lastStatus: st.lastStatus ?? "scheduled", enabled: true };
}

/* --------------------------------- Server ------------------------------- */
// Every request runs inside its own tenant context (C1.4): gate() fills in the
// household from the session, and every store accessor below follows it.
import { runWithRequestContext } from "./tenant-context.mjs";
import {
  createIdentity, verifyCredentials, consumeVerifyToken, beginPasswordReset, completePasswordReset,
  findByResetCode, findIdentityForRecovery,
  deleteIdentity, deleteIdentitiesForHousehold, listIdentitiesForHousehold, validEmail, validPassword,
  createInvite, getInvite, listInvites, revokeInvite, consumeInvite, INVITABLE_ROLES,
} from "./identity.mjs";
const server = http.createServer((req, res) => {
  runWithRequestContext(() => handleRequest(req, res)).catch(() => { try { res.writeHead(500); res.end(); } catch { /* socket gone */ } });
});
const handleRequest = async (req, res) => {
  req.__rid = crypto.randomUUID();
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // Preflight: reject disallowed origins outright (no ACAO emitted).
  if (method === "OPTIONS") {
    if (!isAllowedOrigin(req.headers.origin)) { res.writeHead(403); return res.end(); }
    res.writeHead(204, corsHeaders(req)); return res.end();
  }

  try {
    /* ---- Rate limits (in-process sliding window; public URL = hostile input) ----
     * Pre-auth routes limit per-IP (credential/claim probing); assistant routes
     * limit per-actor (runaway clients / cost abuse). Honest 429 + audit.
     * MUST run before any route handler — routing order is the firewall order. */
    const rlKeyIp = (req.socket?.remoteAddress ?? "unknown") + ":" + (req.headers["x-forwarded-for"] ?? "");
    const rateLimited = (bucket, key, limit, windowMs) => {
      const now = Date.now();
      const k = `${bucket}:${key}`;
      const arr = (_rateBuckets.get(k) ?? []).filter((t) => now - t < windowMs);
      if (arr.length >= limit) { _rateBuckets.set(k, arr); return true; }
      arr.push(now);
      _rateBuckets.set(k, arr);
      return false;
    };
    const AUTH_LIMITED = new Set(["/api/household/claim", "/api/signup", "/api/login", "/api/verify-email", "/api/password-reset/request", "/api/password-reset/verify-code", "/api/password-reset/complete", "/api/email-recovery/request"]);
    if ((path === "/api/session" && method === "POST") || AUTH_LIMITED.has(path)) {
      // Tunable so an operator can loosen it for a shared-NAT deployment (or a test suite
      // that legitimately signs up two dozen households in a row) without editing code.
      const authLimit = Math.max(5, parseInt(process.env.HOMEOPS_AUTH_RATE_LIMIT ?? "20", 10) || 20);
      if (rateLimited("auth", rlKeyIp, authLimit, 60_000)) {
        audit({ type: "rate.limited", route: path }, req);
        return json(res, 429, { error: "rate_limited", message: "Too many attempts — wait a minute and try again." }, req);
      }
    }
    if (path.startsWith("/api/assistant")) {
      const s0 = sessionFromReq(req);
      if (s0 && rateLimited("assistant", s0.actorId, 30, 60_000)) {
        audit({ type: "rate.limited", route: path, actorId: s0.actorId }, req);
        return json(res, 429, { error: "rate_limited", message: "That's a lot of messages at once — give it a minute." }, req);
      }
      /* …AND A LIMIT ON THE HOUSEHOLD, not just the person.
       *
       * The per-actor cap bounds one member. It does not bound a FAMILY: six members is six
       * times the ceiling, and on a shared deployment every one of those calls spends the same
       * pooled AI capacity everyone else's household is waiting on. There was no limit at that
       * level at all, so one busy household could degrade the product for every other one —
       * with nothing in the logs naming a cause, because nobody had exceeded anything.
       *
       * Deliberately generous relative to the per-actor cap: this is a backstop against a
       * runaway client or an unusual day, not a quota on a large family talking to their own
       * assistant. Tunable so an operator can raise it without editing code. */
      const hh = s0?.householdId;
      // Floor of 10, not 30: a floor exists so a typo can't lock a family out of their own
      // assistant, but set it at the DEFAULT and the knob stops being a knob — an operator who
      // needs to throttle hard could only ever loosen. Below 10 is a mistake; 10 is a choice.
      const hhLimit = Math.max(10, parseInt(process.env.HOMEOPS_HOUSEHOLD_RATE_LIMIT ?? "90", 10) || 90);
      if (hh && rateLimited("assistant_household", hh, hhLimit, 60_000)) {
        audit({ type: "rate.limited", route: path, scope: "household", actorId: s0.actorId }, req);
        return json(res, 429, { error: "rate_limited", message: "Your household has sent a lot of messages in the last minute. Give it a moment and try again." }, req);
      }
    }

    /* ---- Declared actions (ADR-003): one definition = tool + route + client type ----
     * Dispatched FIRST, so a stale hand-written copy of a declared route is dead code
     * rather than a silent winner (server/test/action-routes.test.mjs forbids one). After
     * the rate limits on purpose: routing order is the firewall order. */
    if (await handleActionRoutes({ req, res, path, method, url, gate, json, readBody, audit })) return;

    /* ---- Health (origin-allowed, no session; used to detect backend) ---- */
    if (path === "/api/health") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const browserCfg = getConnectorConfig("browser");
      const browserHealth = getHealth("browser");
      // WP-007 (DEC-014): surfaces which memory backend is actually answering (real
      // sidecar vs the local sqlite-FTS5 fallback) so Settings' runtime card can show
      // honest status instead of assuming the sidecar is up.
      const memHealth = await memoryProvider.health();
      return json(res, 200, {
        ok: true, version: VERSION, time: new Date().toISOString(), runtime: "node-http", node: process.version, env: IS_PROD ? "production" : "development",
        browserRuntime: !!(browserHealth && browserHealth.ok),
        /* Two different questions, and collapsing them into one boolean is how "offline"
         * ended up describing a runtime that works. `browserRuntime` is "serving right now";
         * this is "deployed and addressable, possibly asleep". A free service spends most of
         * its day in the second state. */
        browserRuntimeConfigured: !!(browserHealth && (browserHealth.ok || browserHealth.status === "standby")),
        memoryProvider: { ok: !!memHealth?.ok, degraded: !!memHealth?.degraded, backend: memHealth?.backend ?? memoryProvider.backend },
        externalActionsEnabled: externalActionsEnabled(CURRENT_TENANT),
        webhookBaseUrl: (process.env.HOMEOPS_PUBLIC_URL || `http://localhost:${PORT}`).split(",")[0].trim().replace(/\/$/, ""),
        /* Whether FamiliOS can send its OWN transactional mail — password resets, recovery
         * codes, email confirmation. `not_configured` here means a new household can sign up
         * and then never get back in, which is the kind of thing that should be visible on a
         * health check rather than discovered by a locked-out customer. Names the From so a
         * misconfigured sender is diagnosable; never exposes the key. */
        mail: platformMailStatus(),
        authRequired: true,
      }, req);
    }

    /* ---- OAuth callback (top-level browser redirect from provider) ----
     * The session cookie is NOT available here (provider redirects straight to the
     * backend origin), so actor/household are carried in the server-persisted state. */
    if (path === "/api/oauth/callback" && method === "GET") {
      const code = url.searchParams.get("code"); const state = url.searchParams.get("state") || "";
      const st = takeOAuthState(state);
      // Mobile detection works even when the state record is gone: mobile starts
      // mint states shaped `<provider>.m.<nonce>` (see /api/oauth/:provider/start).
      const isMobileFlow = (st && st.from === "mobile") || /^[^.]+\.m\./.test(state);
      // ASWebAuthenticationSession intercepts any navigation to the app scheme, but a
      // bare 302 to a custom scheme is dropped by some iOS versions. Serve a tiny page
      // that navigates via JS immediately AND offers a tap-through link, so the user
      // is never stranded looking at a web page inside the auth browser.
      const finishMobile = (params) => {
        const deepLink = `familios://oauth-callback?${new URLSearchParams(params).toString()}`;
        const ok = params.ok === "1";
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#f4f0e9;color:#1f2535;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;max-width:28rem;padding:1rem"><div style="font-size:40px">${ok ? "✓" : "✕"}</div><h2>${ok ? `${escapeHtml(params.provider ?? "Account")} connected` : "Connection failed"}</h2><p style="color:#4a5568">${escapeHtml(params.message ?? (ok ? "Returning to FamiliOS…" : "Return to FamiliOS and try again."))}</p><p><a href="${deepLink}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#d26420;color:#fff;text-decoration:none;font-weight:600">Return to FamiliOS</a></p></div><script>location.replace(${JSON.stringify(deepLink)})</script></body>`);
      };
      if (!st || !code) {
        audit({ type: "oauth.callback", ok: false, error: "invalid_state" }, req);
        if (isMobileFlow) return finishMobile({ ok: "0", error: "expired", message: "This authorization expired. Please try connecting again." });
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(htmlMessage("Connection failed", "This authorization link is invalid or expired. Please start again from FamiliOS."));
      }
      const provider = connectorProviderById(st.provider);
      if (!provider) {
        if (isMobileFlow) return finishMobile({ ok: "0", error: "unknown_provider", message: "Unknown provider." });
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(htmlMessage("Connection failed", "Unknown provider."));
      }
      try {
        const ex = await exchangeCode(provider, { code, codeVerifier: st.codeVerifier, redirectUri: oauthRedirectUri() });
        if (!ex.ok) {
          // Filed in the household that started the flow — a family debugging a failed
          // connection should find it in their own audit log, not the resident one's.
          runWithTenant(st.householdId, () => audit({ type: "oauth.callback", provider: st.provider, ok: false, error: "token_exchange_failed", householdId: st.householdId }, req));
          if (isMobileFlow) return finishMobile({ ok: "0", provider: provider.name, error: "exchange_failed", message: "The provider did not return an access token. Please try connecting again." });
          res.writeHead(200, { "content-type": "text/html" });
          return res.end(htmlMessage("Authorization error", "The provider did not return an access token. Please try connecting again."));
        }
        // The account and its vault tokens must land in the CONNECTING household's
        // database. This request carries no session, so nothing has set a tenant context:
        // putAccount would write into the resident household while stamping the record
        // `householdId: hh_*`, producing a connection the owning household cannot see and
        // the resident household should never have had. The state record knows whose flow
        // this is; enter that tenant explicitly.
        const acct = await runWithTenant(st.householdId, async () => {
          const a = await upsertAccount({ provider: st.provider, householdId: st.householdId, actorId: st.actorId, tokens: ex.tokens });
          appendAudit({ type: "oauth.callback", provider: st.provider, ok: true, actorId: st.actorId, accountId: a.id, householdId: st.householdId });
          return a;
        });
        // Mobile-initiated flows: hand control back to the app via the familios:// scheme.
        // Web flows: postMessage to the opener window.
        if (isMobileFlow) {
          return finishMobile({ ok: "1", provider: provider.name, displayName: acct.displayName ?? "" });
        }
        const target = st.appOrigin && isAllowedOrigin(st.appOrigin) ? st.appOrigin : APP_ORIGIN;
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#f4f0e9;color:#1f2535;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:40px">✓</div><h2>${escapeHtml(provider.name)} connected</h2><p style="color:#4a5568">Signed in as ${escapeHtml(acct.displayName)} — returning to FamiliOS…</p></div><script>try{window.opener&&window.opener.postMessage({type:"homeops-oauth",provider:${JSON.stringify(st.provider)},ok:true},${JSON.stringify(target)})}catch(e){}setTimeout(()=>window.close(),900)</script></body>`);
      } catch (e) {
        runWithTenant(st.householdId, () => appendAudit({ type: "oauth.callback", provider: st.provider, ok: false, error: "exception", householdId: st.householdId }));
        if (isMobileFlow) return finishMobile({ ok: "0", provider: provider.name, error: "server_error", message: "Something went wrong completing the connection." });
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(htmlMessage("Connection failed", "Something went wrong completing the connection."));
      }
    }

    /* ---- Two-way texting (BlueBubbles webhook; secret-gated, not session) ----
     * The cloud Mac posts every new message here. Only VERIFIED + OPTED-IN Phone/Text
     * contact methods get an answer — an unknown sender gets nothing back over the bridge
     * (and this endpoint answers 200 either way, so it never confirms a number exists).
     * BlueBubbles does not sign its webhooks: the shared secret we register in the URL
     * (or send as a header) is the whole gate — configured secret → required; no secret →
     * refused in production (fail closed), accepted in dev for local testing. */
    if (path === "/api/webhooks/bluebubbles" && method === "POST") {
      const raw = await readRaw(req);
      let payload = null;
      try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
      const bb = bluebubblesConfig();
      if (bb.webhookSecret) {
        if (!secretMatches(webhookSecretPresented(req.headers, url), bb.webhookSecret)) {
          audit({ type: "imessage.inbound", ok: false, error: "bad_secret" }, req);
          return json(res, 403, { ok: false, error: "secret_failed" }, req);
        }
      } else if (IS_PROD) {
        audit({ type: "imessage.inbound", ok: false, error: "no_webhook_secret" }, req);
        return json(res, 403, { ok: false, error: "imessage_not_configured", message: "Set BLUEBUBBLES_WEBHOOK_SECRET and register the same value in the BlueBubbles webhook URL." }, req);
      }
      if (!payload) return json(res, 400, { ok: false, error: "malformed_json" }, req);
      const msg = parseInboundWebhook(payload);
      // Typing indicators, read receipts, server hellos: acknowledged, not acted on.
      if (!msg || msg.ignored) return json(res, 200, { ok: true, ignored: msg?.type ?? "not_a_message" }, req);
      // Our own outbound messages echo back through the same webhook.
      if (msg.isFromMe) return json(res, 200, { ok: true, ignored: "from_me" }, req);
      /* Empty first, above the group fork: an empty group message is EMPTY, not
       * group-shaped, and there is nothing in it for either path to act on. It used to sit
       * below the group drop, which meant the two answers depended on which guard happened
       * to be written first. */
      if (!msg.address || !msg.text) { audit({ type: "imessage.inbound", ok: false, error: "empty" }, req); return json(res, 200, { ok: true, ignored: "empty" }, req); }
      /* A GROUP thread, and whether we say anything in it depends entirely on whether an
       * adult bound it. An unbound group chat is still ignored outright — the original
       * rule, and the one that keeps a bot number silent in a thread nobody invited it to.
       * A bound one is recorded (members only) and judged later by the triage sweep.
       *
       * Note the order against the 1:1 path below: the claim happens INSIDE the group
       * handler, under the chat lock, so a redelivered group message cannot produce a
       * second record. The 1:1 path keeps its own existing claim, unchanged. */
      if (msg.isGroup === true) {
        const g = await withChatLock(msg.chatGuid ?? "unknown", async () => {
          const sid = msg.guid;
          if (sid) {
            const seen = sysDoc(SMS_SEEN_FILE, {});
            if (seen[sid]) return { ignored: "replayed", replayed: true };
            const cutoff = Date.now() - SMS_SEEN_TTL_MS;
            for (const [k, v] of Object.entries(seen)) if (!v?.at || v.at < cutoff) delete seen[k];
            seen[sid] = { at: Date.now(), replyText: null };
            putSysDoc(SMS_SEEN_FILE, seen);
          }
          return await handleInboundGroup({ msg, atMs: Date.now() });
        });
        audit({ type: "imessage.inbound", group: true, ok: !!g.handled, kind: g.kind ?? null, error: g.handled ? undefined : (g.ignored ?? null) }, req);
        /* LANE 2, PHASE 2 — the dense turn, deliberately OUTSIDE the lock and outside the
         * response. handleInboundGroup stayed synchronous and deterministic and handed back
         * a verdict; it already took the durable lease, so a redelivery or a second wake
         * word cannot start a rival turn while this one runs. The answer arrives in the
         * thread as its own message, which is how every other outbound already works — the
         * webhook response was never the delivery channel. Answering 200 now also means the
         * bridge's own timeout and retry policy cannot influence whether the family gets an
         * answer. Errors are swallowed INSIDE runWakeTurn, which also releases the lease. */
        if (g.kind === "wake" && g.turn) {
          void runWakeTurn({ ...g.turn, atMs: Date.now() });
          return json(res, 200, { ok: true, handled: true, kind: "wake_accepted" }, req);
        }
        return json(res, 200, { ok: true, ...(g.handled ? { handled: true, kind: g.kind } : { ignored: g.ignored }) }, req);
      }
      /* …and it does not run the ASSISTANT on a thread it cannot classify either. `null` is
       * the parser saying this delivery carried no chat context at all (no `chats`, no
       * `chatGuid`). That used to collapse into `false`, so a group message in the bare
       * payload layout ran through the one-to-one path: the household assistant read it and
       * replied to the sender. Fail closed on free text, and keep honouring STOP/START/HELP
       * — those are compliance obligations that must work from any delivery shape, and
       * `keywordOnly` is what narrows this path to them. */
      const keywordOnly = msg.isGroup === null;

      /* IDEMPOTENCY. The bridge can re-deliver after a reconnect, and this handler runs the
       * assistant — an LLM call — before it answers. A duplicate must not become a second
       * conversation turn, a second plan, a second approval in the family's queue. Keyed on
       * the message GUID (the Mac's own per-message id) and stored in the _system tenant,
       * because a text is deduplicated before we know whose it is. */
      /* CLAIM BEFORE THE TURN, NOT AFTER IT.
       *
       * The check and the write used to sit on either side of handleInboundSms — which is an
       * LLM call that can run for minutes. Two deliveries arriving inside that window both
       * read an empty slot, both passed, and the family got two answers, two plans and two
       * approvals for one text. The re-delivery this guard exists for is exactly the case
       * that takes longest to arrive, so the window was not a narrow one.
       *
       * The claim is written first and the reply text patched in afterwards; a replay during
       * the turn is reported as replayed with replied:false, which is true — that delivery
       * did not produce an answer. The group branch above has always worked this way. */
      const sid = msg.guid;
      if (sid) {
        const seen = sysDoc(SMS_SEEN_FILE, {});
        const prior = seen[sid];
        if (prior) {
          audit({ type: "imessage.inbound", ok: true, replayed: true, messageGuid: sid }, req);
          return json(res, 200, { ok: true, replayed: true, replied: !!prior.replyText }, req);
        }
        // Prune on write: a busy deployment must not accumulate every message id forever.
        const cutoff = Date.now() - SMS_SEEN_TTL_MS;
        for (const [k, v] of Object.entries(seen)) if (!v?.at || v.at < cutoff) delete seen[k];
        seen[sid] = { at: Date.now(), replyText: null };
        putSysDoc(SMS_SEEN_FILE, seen);
      }
      const r = await handleInboundSms({ from: msg.address, body: msg.text, chatGuid: msg.chatGuid, keywordOnly });
      if (sid && r.replyText) {
        const seen = sysDoc(SMS_SEEN_FILE, {});
        if (seen[sid]) { seen[sid].replyText = r.replyText; putSysDoc(SMS_SEEN_FILE, seen); }
      }
      if (r.unknownSender) {
        audit({ type: "imessage.inbound", ok: false, error: "unknown_or_unverified_sender" }, req);
        return json(res, 200, { ok: true, ignored: "unknown_sender" }, req);
      }
      // A known sender whose thread we could not classify: nothing ran, so the answer must
      // not read as `handled`. The number is known — but saying so here would be the one
      // thing this endpoint never does, so the shape matches every other ignore.
      if (r.kind === "unclassified_thread") {
        audit({ type: "imessage.inbound", ok: false, error: "unclassified_thread" }, req);
        return json(res, 200, { ok: true, ignored: "unclassified_thread" }, req);
      }
      // The answer goes back over the same bridge, into the same thread.
      const delivery = r.replyText ? await replyToSender({ from: msg.address, chatGuid: msg.chatGuid, text: r.replyText }) : { ok: false, error: "no_reply" };
      audit({ type: "imessage.inbound", ok: true, actorId: r.actorId, conversationId: r.conversationId, kind: r.kind, replied: delivery.ok, replyError: delivery.ok ? undefined : delivery.error }, req);
      return json(res, 200, { ok: true, handled: true, kind: r.kind, reply: r.replyText ?? null, replied: delivery.ok, replyError: delivery.ok ? undefined : delivery.error }, req);
    }

    // RevenueCat webhook (C1.5) — the ONLY writer of plan state. Fail closed:
    // without the shared secret configured, every delivery is refused. MUST sit
    // before the generic /api/webhooks/:id trigger receiver below.
    if (path === "/api/webhooks/revenuecat" && method === "POST") {
      const secret = process.env.HOMEOPS_RC_WEBHOOK_SECRET;
      if (!secret) return json(res, 503, { error: "webhook_not_configured", message: "Set HOMEOPS_RC_WEBHOOK_SECRET and configure the same value as the webhook's Authorization header in RevenueCat." }, req);
      const auth = req.headers.authorization ?? "";
      if (auth !== secret && auth !== `Bearer ${secret}`) {
        appendAudit({ type: "billing.webhook", ok: false, error: "unauthorized" });
        return json(res, 401, { error: "unauthorized" }, req);
      }
      const body = await readBody(req); if (!body?.event) return json(res, 400, { error: "malformed_json" }, req);
      const ev = body.event;
      const hh = String(ev.app_user_id ?? "");
      // Only real stranger households are billable app_user_ids; anything else is
      // acknowledged-and-ignored so RevenueCat doesn't retry forever.
      if (!/^hh_[a-z0-9]+$/.test(hh) || !tenantEngine().tenantIds().includes(hh)) {
        appendAudit({ type: "billing.webhook", ok: true, ignored: "unknown_household", eventType: ev.type });
        return json(res, 200, { ok: true, ignored: "unknown_household" }, req);
      }
      const entitlements = ev.entitlement_ids ?? (ev.entitlement_id ? [ev.entitlement_id] : []);
      const entitled = entitlements.includes("familios_plus");
      const expiresAt = ev.expiration_at_ms ?? null;
      const ACTIVATE = ["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "NON_RENEWING_PURCHASE", "SUBSCRIPTION_EXTENDED", "TRANSFER"];
      let applied = null;
      if (ACTIVATE.includes(ev.type) && entitled) applied = setPlanFromEntitlement(hh, { active: true, expiresAt });
      else if (ev.type === "BILLING_ISSUE") applied = setPlanFromEntitlement(hh, { active: true, expiresAt, graceUntil: ev.grace_period_expiration_at_ms ?? null });
      else if (ev.type === "EXPIRATION") applied = setPlanFromEntitlement(hh, { active: false, expiresAt });
      // CANCELLATION = auto-renew turned off; access runs to expiration — no change.
      await runWithTenant(hh, () => appendAudit({ type: "billing.webhook", ok: true, eventType: ev.type, applied: applied?.tier ?? "no_change" }));
      return json(res, 200, { ok: true, applied: applied?.tier ?? "no_change" }, req);
    }

    /* ---- Webhook receiver (external inbound; signature-gated, not session) ----
     *
     * WHOSE WEBHOOK IS THIS? Every store call below — getTrigger, getTriggerSecret, getSecret,
     * addWebhookEvent, seenWebhookNonce, audit, fireWebhookTrigger — follows the ambient tenant
     * context, and an inbound webhook has none. So all of them read the RESIDENT household: a
     * trigger registered by any signed-up family was invisible here, its signing secret was
     * never found, and in production the delivery was rejected with `signing_secret_required`
     * for want of a secret that existed the whole time, one household over. The family's own
     * webhook trigger simply never fired, and the only evidence was a 401 at the far end.
     *
     * A trigger id (`trg_` + 20 hex) is unique across the deployment, so unlike an inbound text
     * it identifies its household on its own — no ambiguity to resolve, just a lookup nobody
     * was doing. One doc read per household per delivery, which is the right trade at this
     * scale and the reason the search stops at the first hit.
     *
     * The generic connector endpoint is a different matter and is deliberately left alone:
     * connectors.mjs publishes it as the fixed path `/api/webhooks/webhook`, with no household
     * anywhere in the URL, so there is nothing to route on. Non-resident households reach this
     * feature through a webhook TRIGGER, which has its own per-trigger URL and secret. Giving
     * the shared connector path a tenant would mean inventing one. */
    const whMatch = path.match(/^\/api\/webhooks\/([^/]+)$/);
    if (whMatch && method === "POST") {
      const id = whMatch[1];
      const raw = await readRaw(req);
      const owner = await householdForTriggerId(id);
      // Everything below reads and writes through the ambient tenant. Enter the owning
      // household's context once, here, rather than threading an id through six call sites —
      // several of which (seenWebhookNonce, addWebhookEvent, audit) take no household at all.
      return await runWithTenant(owner ?? CURRENT_TENANT, async () => {
      let payload;
      try { payload = raw ? JSON.parse(raw) : {}; } catch { audit({ type: "webhook.received", connectorId: id, ok: false, error: "malformed_json" }, req); return json(res, 400, { ok: false, error: "malformed_json" }, req); }
      // A webhook TRIGGER (Slice 6) registered at this id uses its own signing secret;
      // otherwise fall back to the webhook connector's secret.
      const trig = getTrigger(id);
      const isTrigger = trig && trig.type === "webhook";
      const secret = (isTrigger ? getTriggerSecret(id) : null) ?? getSecret("webhook", "signingSecret");
      const sig = req.headers["x-homeops-signature"];
      const ts = req.headers["x-homeops-timestamp"];
      const nonce = req.headers["x-homeops-nonce"];
      let verified = false;
      if (secret) {
        const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
        const a = Buffer.from(String(sig ?? ""), "utf8"); const b = Buffer.from(expected, "utf8");
        verified = a.length === b.length && crypto.timingSafeEqual(a, b);
        if (!verified) { audit({ type: "webhook.received", connectorId: id, ok: false, error: "bad_signature" }, req); return json(res, 401, { ok: false, error: "signature_failed" }, req); }
        if (ts && Math.abs(Date.now() - Number(ts)) > 5 * 60_000) { audit({ type: "webhook.received", connectorId: id, ok: false, error: "stale_timestamp" }, req); return json(res, 401, { ok: false, error: "stale_timestamp" }, req); }
        if (nonce && seenWebhookNonce(nonce)) { audit({ type: "webhook.received", connectorId: id, ok: false, error: "replay" }, req); return json(res, 409, { ok: false, error: "replay_detected" }, req); }
      } else {
        // No signing secret configured. Production requires one; dev stores as unverified.
        if (IS_PROD) { audit({ type: "webhook.received", connectorId: id, ok: false, error: "unsigned_blocked" }, req); return json(res, 401, { ok: false, error: "signing_secret_required" }, req); }
        verified = false;
      }
      const evt = addWebhookEvent(id, { payload, source: req.headers["x-homeops-test"] ? "test" : "external", verified });
      audit({ type: "webhook.received", connectorId: id, ok: true, verified, trigger: isTrigger }, req);
      // If a webhook trigger is registered here, fire a real run (no session — the
      // trigger carries the household). Fire-and-forget; the run drives async.
      let firedRunId = null;
      if (isTrigger && trig.enabled) {
        const fired = await fireWebhookTrigger(id, payload).catch(() => null);
        firedRunId = fired?.runId ?? null;
      }
      return json(res, 200, { ok: true, event: evt, verified, runId: firedRunId }, req);
      });
    }

    /* ---- Session (login / current / logout) ---- */
    if (path === "/api/session") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      if (method === "GET") {
        const g = gate(req, {});
        if (!g.ok || !g.session) return json(res, 200, { session: null }, req);
        const s = g.session;
        // isOperator is derived server-side from the deployment env + this session's own
        // registered email. The client can only ever READ it — it is not part of any body.
        return json(res, 200, { session: { actorId: s.actorId, actorName: s.actorName, role: s.role, csrf: s.csrf, householdId: s.householdId, isOperator: isOperator(s) } }, req);
      }
      if (method === "POST") {
        const body = await readBody(req);
        if (!body) return json(res, 400, { error: "malformed_json" }, req);
        const { actorId } = body;
        if (!actorId) return json(res, 400, { error: "actor_required" }, req);
        // WP-010 session-scoped picker entry into a signed-up (hh_*) household. When the
        // Lock screen remembered a household hint (client localStorage, id only — never a
        // secret), entry resolves the member from THAT household's roster instead of the
        // resident one. Two rules keep this from ever escalating privilege:
        //   1. A member who has an email+password identity (Owner, invited members) MUST
        //      authenticate via /api/login — passwordless picker entry is refused for them,
        //      so nobody enters a credentialed member's profile without their password.
        //   2. A member with NO identity (a child, or anyone an Owner added directly) enters
        //      under the SAME PIN rules as the resident household: elevated roles are
        //      PIN-gated (fail-closed in prod), low-trust roles (Child View, etc.) enter
        //      straight in — the shared family-device model, now reachable for a real family.
        // The hint must name a real, existing hh_* tenant; anything else falls through to the
        // unchanged resident path below.
        const sHintRaw = body.household;
        const sHint = (sHintRaw && /^hh_[a-z0-9]+$/.test(String(sHintRaw)) && tenantEngine().tenantIds().includes(String(sHintRaw))) ? String(sHintRaw) : null;
        if (sHint) {
          const hm = runWithTenant(sHint, () => getMember(actorId));
          if (!hm || hm.householdId !== sHint) { audit({ type: "session.login", ok: false, error: "unknown_actor", actorId, household: sHint }, req); return json(res, 403, { error: "unknown_actor", message: "This profile isn't part of that household." }, req); }
          if (hm.archived) { audit({ type: "session.login", ok: false, error: "member_archived", actorId, household: sHint }, req); return json(res, 403, { error: "member_archived", message: "This profile was removed from the household." }, req); }
          // A credentialed member (email+password identity) signs in with their password
          // via /api/login. For ELEVATED roles that is NOT the only authenticator: the
          // household Owner PIN checked just below is equally valid, and the resident
          // (non-hint) path already admits a credentialed Owner on the PIN alone. Hard-
          // refusing them only here left an Owner who forgot their signup password locked
          // out of their own household even while holding the PIN — an inconsistency
          // between the two sign-in paths, not a real security boundary. So: elevated
          // roles fall through to the Owner-PIN gate; NON-elevated credentialed members
          // (invited adults, who have no PIN gate of their own) still need their password.
          const hRole = hm.role;
          const isElevated = hRole === "Owner" || hRole === "Adult Admin";
          if (!isElevated && listIdentitiesForHousehold(sHint).some((i) => i.actorId === actorId)) {
            audit({ type: "session.login", ok: false, error: "password_required", actorId, household: sHint }, req);
            return json(res, 403, { error: "password_required", message: "This member signs in with their email and password." }, req);
          }
          const hName = hm.displayName ?? body.actorName ?? actorId;
          const hPinHash = getSettings(sHint).ownerPinHash; // that household's own PIN, never the resident's
          // Break-glass recovery: while HOMEOPS_BOOTSTRAP_PIN is set (operator-only env), it is
          // accepted as an ALTERNATIVE to the household's own PIN — even when one exists — so an
          // Owner locked out by a forgotten PIN or a lost email password can regain elevated entry,
          // reset a real PIN in Settings, then clear the env var. It is a STANDING override only
          // while the env is present; every break-glass use is audited. Remove after recovery.
          const boot = bootstrapPin();
          let hBreakGlass = false;
          if (hRole === "Owner" || hRole === "Adult Admin") {
            if (!hPinHash && !boot && IS_PROD) {
              audit({ type: "session.login", ok: false, error: "pin_not_configured", actorId, household: sHint }, req);
              return json(res, 403, { error: "pin_not_configured", message: "Elevated sign-in is locked until this household sets an Owner PIN (or the deployment sets HOMEOPS_BOOTSTRAP_PIN)." }, req);
            }
            if (hPinHash || boot) {
              const ownPinOk = hPinHash ? await verifyPin(body.pin, hPinHash) : false;
              const bootOk = matchesPlainSecret(body.pin, boot);
              if (!ownPinOk && !bootOk) { audit({ type: "session.login", ok: false, error: "bad_pin", actorId, household: sHint }, req); return json(res, 403, { error: "pin_required" }, req); }
              // Transparent upgrade: a PIN stored in the old format is re-hashed the first time
              // it's used. Nobody is asked to reset anything, and a household that never signs
              // in again keeps working exactly as it did.
              if (ownPinOk && needsRehash(hPinHash)) await upgradeStoredPin(sHint, body.pin);
              if (bootOk && !ownPinOk) { hBreakGlass = true; audit({ type: "session.login.breakglass", actorId, household: sHint }, req); }
            }
          }
          // A break-glass session keeps the old 12 hours as its absolute end (store.mjs).
          const hs = createSession({ actorId, actorName: hName, role: hRole, householdId: sHint, ...(hBreakGlass ? { lifetimeMs: BREAK_GLASS_LIFETIME_MS } : {}) });
          maybeSeedSandbox(hs);
          audit({ type: "session.login", ok: true, actorId, household: sHint }, req, hs);
          const hView = { actorId: hs.actorId, actorName: hs.actorName, role: hs.role, csrf: hs.csrf, householdId: hs.householdId };
          return json(res, 200, req.headers["x-homeops-bearer"] === "1" ? { session: hView, token: hs.token } : { session: hView }, req, { "set-cookie": sessionCookie(hs.token) });
        }
        // Authority is server-owned: the effective role is resolved from the household
        // member registry by actorId, NEVER from the client. A client may still send a
        // `role` (legacy/dev seed selector), but it is ignored for authorization — a
        // child posting role:"Owner" resolves to their real Child View role. Unknown
        // actors are rejected (no implicit account creation here).
        const member = getMember(actorId);
        if (!member) { audit({ type: "session.login", ok: false, error: "unknown_actor", actorId }, req); return json(res, 403, { error: "unknown_actor", message: "This profile isn't registered with the backend. Create your household (or ask an Owner to add you in Settings → Household)." }, req); }
        if (member.archived) { audit({ type: "session.login", ok: false, error: "member_archived", actorId }, req); return json(res, 403, { error: "member_archived", message: "This profile was removed from the household." }, req); }
        const role = member.role;
        const actorName = member.displayName ?? body.actorName ?? actorId;
        // Owner PIN gate for elevated roles (gated on the RESOLVED role). Dev keeps it
        // optional; PRODUCTION FAILS CLOSED — on a public deployment the seed actor ids
        // are public knowledge, so elevated sign-in with no PIN configured would hand
        // Owner to anyone who finds the URL. HOMEOPS_BOOTSTRAP_PIN (env) seeds the gate
        // before the first login; a PIN set later in Settings takes precedence.
        const pinHash = getSettings(CURRENT_TENANT).ownerPinHash; // login predates a session: resident household
        // Same break-glass as the hint path: HOMEOPS_BOOTSTRAP_PIN is an alternative to the
        // resident household's own PIN while set (seeds the gate before a first PIN exists AND
        // recovers a forgotten one). Break-glass uses are audited; clear the env after recovery.
        const bootR = bootstrapPin();
        let breakGlass = false;
        if (role === "Owner" || role === "Adult Admin") {
          if (!pinHash && !bootR && IS_PROD) {
            audit({ type: "session.login", ok: false, error: "pin_not_configured", actorId }, req);
            return json(res, 403, { error: "pin_not_configured", message: "Elevated sign-in is locked until an Owner PIN exists. Set HOMEOPS_BOOTSTRAP_PIN in the deployment's environment, then sign in with it." }, req);
          }
          if (pinHash || bootR) {
            const ownPinOk = pinHash ? await verifyPin(body.pin, pinHash) : false;
            const bootOk = matchesPlainSecret(body.pin, bootR);
            if (!ownPinOk && !bootOk) { audit({ type: "session.login", ok: false, error: "bad_pin", actorId }, req); return json(res, 403, { error: "pin_required" }, req); }
            if (ownPinOk && needsRehash(pinHash)) await upgradeStoredPin(CURRENT_TENANT, body.pin);
            if (bootOk && !ownPinOk) { breakGlass = true; audit({ type: "session.login.breakglass", actorId, household: CURRENT_TENANT }, req); }
          }
        }
        const s = createSession({ actorId, actorName, role, householdId: member.householdId ?? "local", ...(breakGlass ? { lifetimeMs: BREAK_GLASS_LIFETIME_MS } : {}) });
        maybeSeedSandbox(s);
        audit({ type: "session.login", ok: true, actorId }, req, s);
        const sessionView = { actorId: s.actorId, actorName: s.actorName, role: s.role, csrf: s.csrf, householdId: s.householdId };
        // Native/mobile clients can't use the httpOnly cookie — they ask for the bearer
        // token (stored in expo-secure-store). The web client omits this header and keeps
        // cookie-only auth, so its httpOnly posture is unchanged.
        const wantToken = req.headers["x-homeops-bearer"] === "1";
        return json(res, 200, wantToken ? { session: sessionView, token: s.token } : { session: sessionView }, req, { "set-cookie": sessionCookie(s.token) });
      }
      if (method === "DELETE") {
        const g = gate(req, {});
        if (!g.ok) return json(res, g.status, { error: g.error }, req);
        deleteSession(g.session.token);
        audit({ type: "session.logout", ok: true }, req, g.session);
        return json(res, 200, { ok: true }, req, { "set-cookie": clearSessionCookie() });
      }
    }

    /* ---- Profile picker (pre-auth) + one-time household claim ----
     * A family device must show who can sign in BEFORE anyone is signed in — same
     * information the lock screen displays. Origin-gated; no secrets (names/roles only). */
    const VALID_ROLES = ["Owner", "Adult Admin", "Adult Member", "Limited Member", "Child View", "Guest/Helper"];
    const SEED_ACTOR_IDS = ["m-alex", "m-morgan", "m-lily", "m-noah", "m-elaine", "m-sam"];
    // Contact-method vocabulary (mirrors the web ContactMethod type). In-App and
    // Family Dashboard aren't external addresses — their value is a fixed channel tag.
    const CONTACT_METHOD_TYPES = ["Email", "Phone/Text", "In-App", "Family Dashboard"];
    const CONTACT_FIXED_VALUES = { "In-App": "in-app", "Family Dashboard": "dashboard" };
    // "Opted Out" is a real, terminal-until-reversed state, not the absence of consent.
    // A recipient who texts STOP must be distinguishable from one who simply hasn't
    // answered yet ("Pending"): the first is a withdrawal we are legally obliged to honour
    // and to be able to evidence, the second is an invitation still open. Carriers block
    // the transport either way; this is FamiliOS's own record telling the truth about it.
    const OPT_IN_STATES = ["Opted In", "Pending", "Not Set", "Opted Out"];
    const validContactValue = (type, value) =>
      type === "Email" ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      : type === "Phone/Text" ? String(value).replace(/\D/g, "").length >= 7
      : true;
    if (path === "/api/profiles" && method === "GET") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      // WP-010 session-scoped picker (ISS-012): a returning member's browser remembers
      // the household it last signed into and asks for THAT household's roster via a
      // `?household=hh_...` hint, so the Lock screen offers the family's own members
      // after sign-out instead of the resident household's. The hint must name a real,
      // existing signed-up (hh_*) tenant; anything else falls back to the resident
      // household — the unchanged fresh-browser behavior. The hint is only an id (never
      // a secret); it grants the picker roster, not a session (entry still needs the
      // member's PIN/password, see /api/session).
      const pHintRaw = url.searchParams.get("household");
      const pHint = (pHintRaw && /^hh_[a-z0-9]+$/.test(pHintRaw) && tenantEngine().tenantIds().includes(pHintRaw)) ? pHintRaw : null;
      const pTarget = pHint ?? CURRENT_TENANT;
      // Pre-auth privacy (ISS-015): `hideProfilesPreAuth` hides a household's roster from
      // anyone who lacks a session for it. It is a per-household setting, plus a deployment
      // env override that covers the RESIDENT household on a shared/public deployment.
      // Default OFF everywhere — the resident picker (ISS-009: names+roles+pinRequired the
      // Lock screen needs) is preserved verbatim until an Owner opts their family out.
      const pFlagOn = getSettings(pTarget).hideProfilesPreAuth === true
        || (pTarget === CURRENT_TENANT && /^(1|true|yes|on)$/i.test(String(process.env.HOMEOPS_HIDE_PROFILES_PREAUTH ?? "")));
      const pSess = sessionFromReq(req);
      if (pFlagOn && !(pSess && pSess.householdId === pTarget)) {
        audit({ type: "profiles.hidden", household: pTarget }, req);
        return json(res, 200, { profiles: [], hidden: true, claimed: false, householdName: null }, req);
      }
      // Pre-auth exposure: this endpoint answers BEFORE any session exists, so it carries
      // the minimum the Lock screen needs — actorId, displayName, role, pinRequired.
      // Relationship strings (which include child ages, e.g. "Child (age 9)", and caregiver
      // details) are deliberately excluded; they are available post-auth via /api/members.
      const pSettings = getSettings(pTarget);
      const pPinSet = !!(pSettings.ownerPinHash || (pTarget === CURRENT_TENANT && process.env.HOMEOPS_BOOTSTRAP_PIN));
      const rosterOf = () => listMembers({ householdId: pTarget }).filter((m) => !m.archived).map((m) => ({
        actorId: m.actorId, displayName: m.displayName, role: m.role,
        pinRequired: pPinSet && (m.role === "Owner" || m.role === "Adult Admin"),
        // The Lock screen showed flat, identical letter tiles. From the owner walkthrough:
        // "the individual profiles do not reuse the profile images for the actual profiles
        // inside the app — I actually would like them to, and it makes sense that they
        // should", and "these are not colored properly to match what's inside of the
        // application and they need to be."
        //
        // `color` is a display accent, not PII. `photoFileId` is an opaque id — the bytes
        // are served by /api/profiles/:actorId/avatar below, behind the SAME
        // hideProfilesPreAuth gate that already governs whether this roster is visible at
        // all, so a family that opts out of a public roster stays fully opted out.
        color: m.color ?? null,
        photoFileId: m.photoFileId ?? null,
      }));
      const profiles = pHint ? runWithTenant(pHint, rosterOf) : rosterOf();
      return json(res, 200, {
        profiles,
        claimed: profiles.some((p) => !SEED_ACTOR_IDS.includes(p.actorId)),
        householdName: pSettings.householdName ?? null,
      }, req);
    }
    /* ---- Pre-auth profile avatar (Lock screen) --------------------------------------
     * Serves ONLY the photo of a member who already appears in the pre-auth roster above,
     * for the SAME household, behind the SAME hideProfilesPreAuth gate. Nothing new is
     * disclosed: if the roster is public this face is already named on that screen, and if
     * a family hid the roster this 404s with it.
     *
     * Deliberately narrow: it resolves the member's OWN photoFileId and refuses any other
     * id, so it can never become a general unauthenticated file reader. */
    /* PREVIEW CARD — the page the headless renderer screenshots so a confirmation in the
     * family's group chat is evidence rather than a claim.
     *
     * Under /api/ deliberately. serveStatic returns false for /api/* but otherwise serves
     * the SPA shell for ANY extensionless path, so a preview route living at /preview/card
     * that was misspelled or registered after the static handler would answer HTTP 200 with
     * the app shell and a status-code test would prove nothing.
     *
     * No gate() here, which means no tenant is set and none of the usual protections apply:
     * currentTenant() would be the resident household whatever the token says, and
     * canSeeEntity defaults its session to {} — which makes `entity.ownerId === actorId`
     * compare undefined to undefined and return true, and it never checks householdId at
     * all. So the token drives runWithTenant, the synthetic session is complete, and the
     * household is re-checked on the record. Same three steps as the avatar route below. */
    if (path === "/api/preview/card" && method === "GET") {
      const sendPage = (html, status = 200) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, private", "x-robots-tag": "noindex" });
        return res.end(html);
      };
      const tok = readPreviewToken(url.searchParams.get("t"), Date.now());
      if (!tok.ok) return sendPage(renderPreviewGone(), 200);
      // The household in a signed token still has to be a household that exists — a stale
      // token for a deleted tenant must not open a database by name.
      if (!/^(hh_[a-z0-9]+|local)$/.test(tok.householdId) || !(tok.householdId === CURRENT_TENANT || tenantEngine().tenantIds().includes(tok.householdId))) {
        return sendPage(renderPreviewGone(), 200);
      }
      const card = runWithTenant(tok.householdId, () => {
        const session = { actorId: tok.actorId, householdId: tok.householdId, role: tok.role };
        const member = getMember(tok.actorId);
        if (!member || member.archived || member.householdId !== tok.householdId) return null;
        const p = resolvePreview({ type: tok.type, id: tok.id }, session);
        if (!p || p.hidden) return null;
        // resolvePreview's event/task/file/meal branches gate on canSeeEntity, which never
        // compares householdId. Re-check it here against the record itself.
        const owner = previewOwnerHousehold(tok.type, tok.id);
        if (owner && owner !== tok.householdId) return null;
        return p;
      });
      if (!card) return sendPage(renderPreviewGone(), 200);
      const kindLabel = { event: "On the calendar", task: "On the list", list_item: "On the list", meal: "Meal plan", file: "In the library", help_request: "Asked" }[tok.type] ?? "In FamiliOS";
      return sendPage(renderPreviewCard({
        title: card.title ?? "", when: card.when ? formatForHousehold(card.when, tok.householdId) : null,
        where: card.where ?? null, who: card.who ?? null, status: card.status ?? null, kindLabel,
      }));
    }

    const preAuthAvatar = path.match(/^\/api\/profiles\/([^/]+)\/avatar$/);
    if (preAuthAvatar && method === "GET") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const aHintRaw = url.searchParams.get("household");
      const aHint = (aHintRaw && /^hh_[a-z0-9]+$/.test(aHintRaw) && tenantEngine().tenantIds().includes(aHintRaw)) ? aHintRaw : null;
      const aTarget = aHint ?? CURRENT_TENANT;
      const aFlagOn = getSettings(aTarget).hideProfilesPreAuth === true
        || (aTarget === CURRENT_TENANT && /^(1|true|yes|on)$/i.test(String(process.env.HOMEOPS_HIDE_PROFILES_PREAUTH ?? "")));
      const aSess = sessionFromReq(req);
      if (aFlagOn && !(aSess && aSess.householdId === aTarget)) return json(res, 404, { error: "not_found" }, req);
      const readAvatar = () => {
        const m = listMembers({ householdId: aTarget }).find((x) => x.actorId === preAuthAvatar[1] && !x.archived);
        const pid = m?.photoFileId ?? null;
        // "emoji:" avatars carry no blob — the client renders the glyph itself.
        if (!pid || pid.startsWith("emoji:")) return null;
        const f = getFileRec(pid);
        if (!f || f.householdId !== aTarget) return null;
        const blobIds = Array.isArray(f.pageBlobIds) && f.pageBlobIds.length ? f.pageBlobIds : [f.id];
        const buf = readFileBlob(blobIds[0]);
        return buf ? { buf, mime: f.mime ?? "image/jpeg" } : null;
      };
      const out = aHint ? runWithTenant(aHint, readAvatar) : readAvatar();
      if (!out) return json(res, 404, { error: "not_found" }, req);
      res.writeHead(200, { "content-type": out.mime, "cache-control": "private, max-age=300", ...corsHeaders(req) });
      return res.end(out.buf);
    }
    // Claim the household: replace the demo Harper roster with YOUR owner profile.
    // Unauthenticated by necessity (a new household has nobody to sign in as), but
    // origin-gated and one-time: it only works while every non-archived member is
    // still the demo seed. After the claim, membership changes require an Owner.
    if (path === "/api/household/claim" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const ownerName = String(body.ownerName ?? "").trim();
      if (!ownerName) return json(res, 400, { error: "owner_name_required" }, req);
      const actorId = String(body.actorId ?? "m-owner").trim();
      if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(actorId)) return json(res, 400, { error: "bad_actor_id" }, req);
      const live = listMembers({ householdId: "local" }).filter((m) => !m.archived);
      if (live.some((m) => !SEED_ACTOR_IDS.includes(m.actorId))) {
        audit({ type: "household.claim", ok: false, error: "already_claimed" }, req);
        return json(res, 409, { error: "already_claimed", message: "This household already has its own members. Sign in as an Owner to manage them." }, req);
      }
      // Archive the demo roster (kept on disk so the boot seed can't resurrect it),
      // then register the real owner.
      for (const m of live) putMember({ actorId: m.actorId, archived: true });
      const owner = putMember({ actorId, displayName: ownerName, role: "Owner", relationship: body.relationship ?? "Account owner", householdId: "local" });
      const claimedName = String(body.householdName ?? "").trim();
      if (claimedName) setSettings({ householdName: claimedName.slice(0, 60) }, CURRENT_TENANT);
      const s = createSession({ actorId, actorName: ownerName, role: "Owner", householdId: "local" });
      maybeSeedSandbox(s);
      audit({ type: "household.claim", ok: true, actorId, archivedDemo: live.length }, req, s);
      const sessionView = { actorId: s.actorId, actorName: s.actorName, role: s.role, csrf: s.csrf, householdId: s.householdId };
      const wantToken = req.headers["x-homeops-bearer"] === "1";
      return json(res, 200, {
        member: { actorId: owner.actorId, displayName: owner.displayName, role: owner.role },
        session: sessionView, ...(wantToken ? { token: s.token } : {}),
      }, req, { "set-cookie": sessionCookie(s.token) });
    }

    /* ---- Self-serve identity (C1.4): stranger households ----
     * Email+password accounts create and sign into their OWN household — a
     * fresh tenant database, physically separate from every other family's.
     * The resident household's profile-picker + PIN flow is untouched. */
    if (path === "/api/signup" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const email = String(body.email ?? "").trim().toLowerCase();
      const ownerName = String(body.ownerName ?? "").trim();
      if (!validEmail(email)) return json(res, 400, { error: "invalid_email" }, req);
      if (!validPassword(body.password)) return json(res, 400, { error: "weak_password", message: "Use at least 8 characters." }, req);
      if (!ownerName) return json(res, 400, { error: "owner_name_required" }, req);
      // Invite redemption: join the inviter's EXISTING household with the
      // invited role instead of creating a new one. Consume-once; never Owner.
      let householdId, actorId, role, relationship;
      const invite = body.inviteToken ? getInvite(body.inviteToken) : null;
      if (body.inviteToken && !invite) return json(res, 400, { error: "invalid_invite", message: "That invite code is invalid, used, or expired — ask for a new one." }, req);
      // D3 [02:12] — "the household name should be REQUIRED." It was optional, and the
      // fallback ("Ross's household") is the name the family then lived with everywhere the
      // household is named. Enforced here as well as in the form, because the form is not
      // the only caller. D4: the invite code stays optional — someone JOINING a household
      // isn't naming it, so the requirement applies only to creating one.
      if (!invite && !String(body.householdName ?? "").trim()) {
        return json(res, 400, { error: "household_name_required", message: "Give your household a name — it's what the family sees everywhere." }, req);
      }
      if (invite) {
        householdId = invite.householdId; actorId = "m-" + crypto.randomBytes(4).toString("hex");
        role = invite.role; relationship = "Invited member";
      } else {
        householdId = "hh_" + crypto.randomBytes(6).toString("hex"); actorId = "m-owner";
        role = "Owner"; relationship = "Account owner";
      }
      const made = createIdentity({ email, password: body.password, householdId, actorId, displayName: ownerName });
      if (made.error) return json(res, 409, { error: "email_taken", message: "An account with this email already exists — sign in instead." }, req);
      if (invite) consumeInvite(invite.token);
      await runWithTenant(householdId, () => {
        putMember({ actorId, displayName: ownerName, role, relationship, householdId });
        /* A brand-new household gets the stance a family starting today should have: low-risk
         * work just happens, anything that sends or spends still asks. Written HERE, at
         * creation, rather than as the meaning of an unset field — that distinction is the
         * whole point (see STANCE_OR_DEFAULT). No attribution is stamped: nobody chose this
         * yet, so `autonomyDefaulted` stays true and onboarding can still ask. */
        if (!invite) setSettings({ householdName: String(body.householdName).trim().slice(0, 60), householdCreatedAt: Date.now(), autonomy: DEFAULT_STANCE_FOR_NEW_HOUSEHOLDS }, householdId);
        // The deployment's AI keys, for this household, now — not at the next restart. A
        // family that signs up and finds the assistant unable to think has no reason to
        // come back, and "wait for a deploy" is not an onboarding step.
        try { bootstrapAIFromEnv(householdId); } catch { /* non-fatal: Settings can still add one */ }
        appendAudit({ type: invite ? "household.join" : "household.signup", email, actorId, role });
      });
      // The deployment's built-in skills, for a household that would otherwise have none —
      // the pre-built use cases the agent templates reference. Outside the block above
      // because it enters the resident tenant to read the template set. Non-fatal: an empty
      // catalogue is a poorer first run, not a broken one.
      const s = createSession({ actorId, actorName: ownerName, role, householdId });
      maybeSeedSandbox(s);
      const sessionView = { actorId: s.actorId, actorName: s.actorName, role: s.role, csrf: s.csrf, householdId: s.householdId };
      const wantToken = req.headers["x-homeops-bearer"] === "1";
      // The verification email now actually goes out — over the PLATFORM sender, because a
      // household one second old has no Google connection and never could have. Still
      // non-blocking: an unverified account works, so a mail outage can't wall someone out
      // of the product they just signed up for. Reported honestly either way, with the
      // reason named, so the client never claims a send that didn't happen.
      let emailVerification = { sent: false, required: false, reason: "mail_not_configured" };
      const verifyToken = made.identity?.verifyToken;
      if (platformMailReady() && verifyToken) {
        const link = `${(process.env.HOMEOPS_PUBLIC_URL || `http://localhost:${PORT}`).split(",")[0].trim().replace(/\/$/, "")}/api/verify-email?token=${encodeURIComponent(verifyToken)}`;
        const sent = await sendPlatformEmail({
          to: email,
          subject: "Confirm your email for FamiliOS",
          text: `Welcome to FamiliOS, ${ownerName}.\n\nConfirm this address so we can reach you about your household — password resets and account notices go here:\n\n${link}\n\nIf you didn't create a FamiliOS account, you can ignore this email.`,
        });
        emailVerification = sent.ok
          ? { sent: true, required: false }
          : { sent: false, required: false, reason: sent.error ?? "send_failed" };
        await runWithTenant(householdId, () => appendAudit({ type: "identity.verify_send", email, ok: !!sent.ok, ...(sent.ok ? {} : { error: sent.error, detail: sent.message }) }));
      }
      return json(res, 200, {
        session: sessionView, household: { id: householdId }, ...(wantToken ? { token: s.token } : {}),
        emailVerification,
      }, req, { "set-cookie": sessionCookie(s.token) });
    }
    if (path === "/api/login" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const idn = verifyCredentials(body.email, body.password);
      if (!idn) { audit({ type: "identity.login", ok: false }, req); return json(res, 401, { error: "invalid_credentials" }, req); }
      const member = await runWithTenant(idn.householdId, () => getMember(idn.actorId));
      if (!member || member.archived) return json(res, 403, { error: "member_archived", message: "This account's household profile was removed." }, req);
      const s = createSession({ actorId: idn.actorId, actorName: member.displayName ?? idn.displayName, role: member.role, householdId: idn.householdId });
      maybeSeedSandbox(s);
      await runWithTenant(idn.householdId, () => appendAudit({ type: "identity.login", ok: true, actorId: idn.actorId }));
      const sessionView = { actorId: s.actorId, actorName: s.actorName, role: s.role, csrf: s.csrf, householdId: s.householdId };
      const wantToken = req.headers["x-homeops-bearer"] === "1";
      return json(res, 200, { session: sessionView, ...(wantToken ? { token: s.token } : {}) }, req, { "set-cookie": sessionCookie(s.token) });
    }
    /* Clicking the link in the verification email. A GET that changes state is normally a
     * smell, but a link in an email cannot be anything else, and the standard protections
     * apply: the token is 32 bytes of entropy, single-use, and carries no authority beyond
     * marking one address confirmed. Renders a page rather than JSON because a human is
     * looking at it. The POST form below stays for clients that hold the token themselves. */
    if (path === "/api/verify-email" && method === "GET") {
      const idn = consumeVerifyToken(url.searchParams.get("token") ?? "");
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(idn
        ? htmlMessage("Email confirmed", `${escapeHtml(idn.email)} is confirmed. You can close this tab and carry on in FamiliOS.`)
        : htmlMessage("Link expired", "This confirmation link is invalid or has already been used. Sign in and request a new one if you still need to confirm your address."));
    }
    if (path === "/api/verify-email" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const idn = consumeVerifyToken(String(body.token ?? ""));
      if (!idn) return json(res, 400, { error: "invalid_token" }, req);
      return json(res, 200, { ok: true, email: idn.email, verified: true }, req);
    }
    // D1 [01:32] — "Forgot password: it should send an email with a recovery code." The code
    // is now actually SENT (notify.mjs sendRecoveryCode, through the account's own household
    // Google connection — the only email transport this deployment has).
    //
    // The response is deliberately identical whether or not the account exists, and whether
    // or not the send succeeded. Anything else is account enumeration: "no email transport
    // configured for that household" tells an attacker the household is real. Failures are
    // recorded in the audit log instead, which is where an operator can see them.
    if (path === "/api/password-reset/request" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const email = String(body.email ?? "").trim();
      const idn = beginPasswordReset(email);
      if (idn?.resetCode) {
        // Fire-and-forget: the response must not vary with delivery timing either.
        void runWithTenant(idn.householdId, () => sendRecoveryCode({
          householdId: idn.householdId, actorId: idn.actorId, email: idn.email ?? email,
          code: idn.resetCode, kind: "password",
        })).catch(() => {});
      }
      return json(res, 200, { ok: true, message: "If that email has an account, a recovery code is on its way. It expires in 15 minutes." }, req);
    }
    // Exchange the 6-digit code for the one-time token the completion step wants. Separate
    // from /complete so the app can confirm the code BEFORE asking for a new password —
    // typing a password twice only to be told the code was wrong is a bad way to find out.
    if (path === "/api/password-reset/verify-code" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const found = findByResetCode(String(body.email ?? ""), String(body.code ?? ""));
      if (found.error) {
        return json(res, 400, {
          error: found.error,
          message: found.error === "too_many_attempts"
            ? "Too many tries with that code. Request a new one."
            : "That code isn't right, or it's expired. Check the email or request a new code.",
          ...(found.attemptsLeft != null ? { attemptsLeft: found.attemptsLeft } : {}),
        }, req);
      }
      return json(res, 200, { ok: true, token: found.identity.resetToken }, req);
    }
    // D2 [01:46] — "forgot email, or forgot username." The answer is emailed TO the account,
    // never returned in the response: a caller who controls that inbox learns their own
    // address (the point), and a caller who doesn't learns nothing. Proof of belonging is the
    // household's own join code, which a family has from another member.
    if (path === "/api/email-recovery/request" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const inv = getInvite(String(body.inviteCode ?? "").trim());
      if (inv?.householdId) {
        const idn = findIdentityForRecovery({ householdId: inv.householdId, displayName: String(body.displayName ?? "") });
        if (idn) {
          void runWithTenant(idn.householdId, () => sendRecoveryCode({
            householdId: idn.householdId, actorId: idn.actorId, email: idn.email, code: null, kind: "email",
          })).catch(() => {});
        }
      }
      return json(res, 200, { ok: true, message: "If that matches an account, we've emailed the address to itself." }, req);
    }
    if (path === "/api/password-reset/complete" && method === "POST") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!validPassword(body.password)) return json(res, 400, { error: "weak_password", message: "Use at least 8 characters." }, req);
      const idn = completePasswordReset(String(body.token ?? ""), body.password);
      if (!idn) return json(res, 400, { error: "invalid_or_expired_token" }, req);
      deleteSessionsForActor(idn.actorId, idn.householdId); // every device re-authenticates
      return json(res, 200, { ok: true }, req);
    }
    /* ---- Plan & billing (C1.5) ---- */
    if (path === "/api/plan" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { plan: getPlan(g.session.householdId) }, req);
    }

    /* ---- The Adult Member silo -------------------------------------------------------------
 *
 * An Adult Member is a grown-up in the household who is NOT one of its administrators —
 * a partner, an adult child living at home, a live-in parent. Until now they were treated
 * as a spectator: they could read the family calendar and add a task, and that was it.
 * Asked for directly: they need their own connected accounts, their own calendars, their own
 * tasks, and their own assistant — "a standalone silo for each individual adult member".
 *
 * The shape of that silo, and the reason for each half:
 *
 *   PRIVATE OUTWARD. Their chats and helpers are theirs. A personal chat is already
 *   invisible to everyone else; what's added here is that an Adult Member can only ever
 *   CREATE personal ones, so a private thought can't be published into the family space by
 *   picking the wrong toggle. Their helpers are personal too, so nothing they build starts
 *   running on the household's behalf.
 *
 *   INFORMED INWARD. The silo is about authorship, not ignorance. Their assistant still sees
 *   the whole household — the calendar, the tasks, who's who, the meal plan, and now the
 *   family chats — because an assistant that can't see Thursday is useless to the person
 *   asking about Thursday. It reads all of it and writes none of it.
 *
 * The asymmetry is the whole design: full read of the household, writes confined to their own
 * things. Owner and Adult Admin are unchanged and keep every household-level power.
 */
function isAdultMemberOnly(session) {
  return session?.role === "Adult Member";
}
/** May this session create or change THIS agent? Admins: any. Adult Member: only their own,
 *  and only while it stays personal. Anyone else: no. */
function mayWriteAgent(session, agent, nextVisibility) {
  /* T1 — a nest helper belongs to the nest, and role is not a way in. An Owner who isn't in
   * it has no more claim on it than anyone else, or "isolated from the broader family group"
   * would mean isolated from everyone except the person who can already see everything. */
  if (agent?.visibility === "nest" && !canSeeNest(agent.nestId, session?.householdId, session?.actorId)) {
    return { ok: false, error: "forbidden", message: "That helper belongs to a nest you're not part of." };
  }
  if (roleAtLeast(session?.role, "Adult Admin")) return { ok: true };
  if (!isAdultMemberOnly(session)) return { ok: false, error: "insufficient_role" };
  const vis = nextVisibility ?? agent?.visibility ?? "household";
  // A nest helper is not a household helper — it runs for the two people who agreed to it,
  // so the silo has no reason to block it. createAgent verifies the membership.
  if (vis !== "personal" && vis !== "nest") {
    return { ok: false, error: "personal_only", message: "You can create helpers for yourself. A helper that runs for the whole household needs an Owner or Adult Admin." };
  }
  // …but inside a nest it's "their own agents", plural and shared: membership was already
  // verified above, so a nest helper is editable by anyone in that nest, not only its author.
  if (agent && agent.createdBy && agent.createdBy !== session.actorId && agent.visibility !== "nest") {
    return { ok: false, error: "forbidden", message: "That helper belongs to someone else." };
  }
  if (agent && agent.system) return { ok: false, error: "forbidden" };
  return { ok: true };
}

/* ---- D5: operator-only, cross-household invite minting ----
     * 404 (not 403) when the deployment has no operator configured, so the surface does not
     * even announce itself on an install that has it switched off. */
    if (path === "/api/admin/households" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!isOperator(g.session)) return json(res, 404, { error: "not_found" }, req);
      const rows = [];
      for (const id of tenantEngine().tenantIds()) {
        if (!/^hh_[a-z0-9]+$/.test(id)) continue;   // skip "local" and "_system"
        const info = runWithTenant(id, () => {
          const members = listMembers(() => true);
          return { name: getSettings(id).householdName ?? null, memberCount: members.length, createdAt: getSettings(id).householdCreatedAt ?? null };
        });
        rows.push({ id, ...info });
      }
      rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      audit({ type: "admin.households_listed", count: rows.length, ok: true }, req, g.session);
      return json(res, 200, { households: rows }, req);
    }
    if (path === "/api/admin/invites" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!isOperator(g.session)) return json(res, 404, { error: "not_found" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const householdId = String(body.householdId ?? "").trim();
      if (!/^hh_[a-z0-9]+$/.test(householdId) || !tenantEngine().tenantIds().includes(householdId)) {
        return json(res, 400, { error: "unknown_household" }, req);
      }
      // Owner is still not grantable by invite — the operator can seat anyone in a household,
      // but not hand out its ownership. That stays with whoever created it.
      const role = INVITABLE_ROLES.includes(body.role) ? body.role : "Adult Member";
      const made = createInvite({
        householdId,
        householdName: runWithTenant(householdId, () => getSettings(householdId).householdName ?? null),
        displayName: String(body.displayName ?? "").trim() || "Invited member",
        role,
        invitedBy: g.session.actorId,
      });
      if (made.error) return json(res, 400, { error: made.error }, req);
      audit({ type: "admin.invite_created", householdId, role, ok: true }, req, g.session);
      return json(res, 200, made, req);   // createInvite already returns { invite }
    }

    /* ---- Nests: a small group inside the household ----
     * "There should be some way to associate two profiles… send an invite to create a nest…
     * and the other person would approve — you can either join or decline… and be able to
     * leave that nest at any point." Membership is consented both ways, and leaving never
     * deletes what was made inside. */
    if (path === "/api/nests" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const roster = new Map(listMembers((m) => m.householdId === g.session.householdId).map((m) => [m.actorId, m.displayName]));
      // Only what concerns THIS person: the nests they are in, and the invitations waiting on
      // them. A nest they were never asked to join is none of their business.
      const mine = nestsFor(g.session.householdId, g.session.actorId);
      const invites = nestInvitesFor(g.session.householdId, g.session.actorId);
      return json(res, 200, {
        nests: mine.map((n) => publicNest(n, roster, g.session.actorId)),
        invitations: invites.map((n) => publicNest(n, roster, g.session.actorId)),
      }, req);
    }
    if (path === "/api/nests" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Any adult may form one. It grants no authority over anyone — it is a shared room.
      if (!isAdultRole(g.session.role)) return json(res, 403, { error: "insufficient_role", message: "Adults can create a nest." }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const out = createNest({
        householdId: g.session.householdId, actorId: g.session.actorId,
        name: body.name, inviteActorIds: Array.isArray(body.inviteActorIds) ? body.inviteActorIds : [],
      });
      if (out.error) return json(res, 400, { error: out.error, ...(out.message ? { message: out.message } : {}) }, req);
      const roster = new Map(listMembers((m) => m.householdId === g.session.householdId).map((m) => [m.actorId, m.displayName]));
      // Tell the people invited — an invitation nobody sees is not an invitation.
      for (const m of out.nest.members.filter((x) => x.status === "invited")) {
        addNotification({
          householdId: g.session.householdId, actorId: m.actorId, channel: "in_app",
          title: `${roster.get(g.session.actorId) ?? "Someone"} invited you to a nest`,
          body: `${nestLabel(out.nest, roster)} — a shared space just for the two of you. Join or decline in Settings.`,
          to: null,
        });
        void pushToMember({
          householdId: g.session.householdId, actorId: m.actorId,
          title: "You've been invited to a nest",
          body: `${roster.get(g.session.actorId) ?? "Someone"} wants to share a space with you.`,
          data: { type: "nest", id: out.nest.id },
        }).catch(() => {});
      }
      audit({ type: "nest.create", nestId: out.nest.id, ok: true }, req, g.session);
      return json(res, 200, { nest: publicNest(out.nest, roster, g.session.actorId) }, req);
    }
    const nestAction = path.match(/^\/api\/nests\/([^/]+)\/(accept|decline|leave|invite)$/);
    if (nestAction && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const [, nestId, action] = nestAction;
      const roster = new Map(listMembers((m) => m.householdId === g.session.householdId).map((m) => [m.actorId, m.displayName]));
      let out;
      if (action === "accept" || action === "decline") {
        /* Cluster X — "Amelia has not answered because there is no surfaced area for her to
         * answer on the child profile. Approval should run through a nested adult with the
         * highest level of access." A child's invitation is answered FOR them, by the most
         * senior joined adult of the nest doing the inviting (the Owner qualifies from
         * anywhere — someone must always be able to resolve a stuck invite). forActorId is
         * only honoured for a Child View target; adults still answer for themselves. */
        const body = (await readBody(req)) ?? {};
        let respondingFor = g.session.actorId;
        if (body.forActorId && String(body.forActorId) !== g.session.actorId) {
          const target = getMember(String(body.forActorId));
          if (!target || target.role !== "Child View") {
            return json(res, 403, { error: "forbidden", message: "You can only answer a nest invitation for a child." }, req);
          }
          const nest = listNests((n) => n.id === nestId && n.householdId === g.session.householdId)[0];
          const joinedAdults = (nest?.members ?? [])
            .filter((m) => m.status === "joined")
            .map((m) => getMember(m.actorId))
            .filter((m) => m && isAdultRole(m.role));
          const rank = { "Owner": 3, "Adult Admin": 2, "Adult Member": 1 };
          const topRank = Math.max(0, ...joinedAdults.map((m) => rank[m.role] ?? 0));
          const myRank = rank[g.session.role] ?? 0;
          const isSenior = g.session.role === "Owner"
            || (joinedAdults.some((m) => m.actorId === g.session.actorId) && myRank >= topRank);
          if (!isSenior) {
            return json(res, 403, { error: "not_senior_adult", message: "A child's invitation is answered by the nest's most senior adult (or the Owner)." }, req);
          }
          respondingFor = String(body.forActorId);
        }
        out = respondToNest({ nestId, householdId: g.session.householdId, actorId: respondingFor, accept: action === "accept" });
      } else if (action === "leave") {
        out = leaveNest({ nestId, householdId: g.session.householdId, actorId: g.session.actorId });
      } else {
        const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
        out = inviteToNest({ nestId, householdId: g.session.householdId, actorId: g.session.actorId, inviteActorIds: Array.isArray(body.inviteActorIds) ? body.inviteActorIds : [] });
      }
      if (out.error) {
        const code = out.error === "not_found" ? 404 : out.error === "forbidden" ? 403 : 400;
        return json(res, code, { error: out.error, ...(out.message ? { message: out.message } : {}) }, req);
      }
      audit({ type: `nest.${action}`, nestId, ok: true }, req, g.session);
      return json(res, 200, { nest: publicNest(out.nest, roster, g.session.actorId), ...(out.archived ? { archived: true } : {}) }, req);
    }

    /* ---- Household invites: join codes for existing households ---- */
    if (path === "/api/invites" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const made = createInvite({
        householdId: g.session.householdId, householdName: getSettings(g.session.householdId).householdName ?? null,
        displayName: body.displayName, role: body.role ?? "Adult Member", invitedBy: g.session.actorId,
      });
      if (made.error) return json(res, 400, { error: made.error }, req);
      audit({ type: "invite.created", role: made.invite.role, ok: true }, req, g.session);
      return json(res, 200, { invite: made.invite }, req);
    }
    if (path === "/api/invites" && method === "GET") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { invites: listInvites(g.session.householdId) }, req);
    }
    const invOne = path.match(/^\/api\/invites\/([a-z0-9]+)$/);
    if (invOne && method === "DELETE") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const had = revokeInvite(invOne[1], g.session.householdId);
      return json(res, had ? 200 : 404, had ? { ok: true } : { error: "not_found" }, req);
    }
    // Pre-auth preview so the signup screen can show what's being joined.
    const invPreview = path.match(/^\/api\/invites\/([a-z0-9]+)\/preview$/);
    if (invPreview && method === "GET") {
      if (!isAllowedOrigin(req.headers.origin)) return json(res, 403, { error: "origin_not_allowed" }, req);
      const inv = getInvite(invPreview[1]);
      if (!inv) return json(res, 404, { error: "invalid_invite" }, req);
      return json(res, 200, { invite: { householdName: inv.householdName, displayName: inv.displayName, role: inv.role } }, req);
    }

    /* Apple 5.1.1(v) account deletion. An Owner deletes the WHOLE household —
     * physically: the tenant database directory is removed. A non-owner member
     * deletes their own identity and is archived from the roster. Requires the
     * account password again; the resident family household (PIN model, no
     * identity) can never be deleted through this route. */
    if (path === "/api/account" && method === "DELETE") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const idn = listIdentitiesForHousehold(g.session.householdId).find((i) => i.actorId === g.session.actorId);
      if (!idn) return json(res, 400, { error: "not_identity_account", message: "This profile signs in without an email account — remove members from Settings instead." }, req);
      if (!verifyCredentials(idn.email, body.password)) {
        audit({ type: "account.delete", ok: false, error: "bad_password" }, req, g.session);
        return json(res, 403, { error: "password_incorrect" }, req);
      }
      if (g.session.role === "Owner") {
        const hh = g.session.householdId;
        appendAudit({ type: "account.delete", scope: "household", by: g.session.actorId }); // last entry in the household's own log
        deleteIdentitiesForHousehold(hh);
        deleteSessionsForHousehold(hh);
        tenantEngine().deleteTenant(hh);
        // The snapshots go with it. Dropping the tenant DB while leaving 30 days of
        // complete household backups on disk would make "delete my account" untrue —
        // and Apple 5.1.1(v) asks for deletion, not for the live copy only.
        const purged = deleteBackupsFor(hh);
        /* Durable tombstone in the system registry (the household's own audit goes down with
         * it) — written LAST, and carrying the backup count, so that nothing writes into the
         * deleted household's own tenant after it is gone. deleteBackupsFor used to audit its
         * own result, which ran as the deleted tenant and recreated tenants/<hh>/audit.jsonl
         * seconds after removing it: a directory and an id left on disk for a family that had
         * just asked to not exist here. */
        const gone = sysDoc("deleted_households.json", []);
        gone.push({ householdId: hh, at: new Date().toISOString(), by: g.session.actorId, email: idn.email, backupsPurged: purged });
        putSysDoc("deleted_households.json", gone);
        return json(res, 200, { ok: true, deleted: "household" }, req, { "set-cookie": clearSessionCookie() });
      }
      putMember({ actorId: g.session.actorId, archived: true, householdId: g.session.householdId });
      deleteIdentity(idn.email);
      deleteSessionsForActor(g.session.actorId, g.session.householdId);
      audit({ type: "account.delete", scope: "member", ok: true }, req, g.session);
      return json(res, 200, { ok: true, deleted: "account" }, req, { "set-cookie": clearSessionCookie() });
    }

    /* ---- Backups & store health (Owner-only; the family's safety net) ----
     * SCOPE: every call below reads and writes ONLY the caller's own household, because
     * backup.mjs resolves the tenant from the request context (currentTenant()) and never
     * from a body. Before 2026-07-30 one bundle held every tenant and these same
     * Owner-gated routes handed it to any signed-up stranger — see the header note in
     * backup.mjs. The pre-existing all-tenant bundles are reachable only via the
     * operator routes further down. */
    if (path === "/api/backups" && method === "GET") {
      const g = gate(req, { requireSession: true, minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { backups: listBackups(), quarantined: quarantinedCollections() }, req);
    }

    /* ---- "Give me everything you hold about my family" ----
     *
     * A backup is a RESTORE artifact: gzipped, shaped for tenant-db's importer, and containing
     * the household's encrypted credentials because a restore needs them. Handing a family that
     * file and calling it their data is technically true and practically useless — and shipping
     * someone their own OAuth refresh tokens, even encrypted, is a liability nobody asked for.
     *
     * This is the other artifact: readable JSON, everything the household owns, credentials
     * removed and said to be removed. Owner-only, because it spans every member's personal
     * space — a household export is not one person's to take.
     *
     * Deliberately a plain synchronous body rather than a streamed download: a family's whole
     * store is measured in megabytes, and the honest failure of loading it at once is a slow
     * request rather than a half-written file that looks complete. */
    if (path === "/api/export" && method === "GET") {
      const g = gate(req, { requireSession: true, minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const bundle = exportHouseholdWithAudit(g.session.householdId, (hh) => {
        const p = tenantEngine().tenantPath(hh, "audit.jsonl");
        if (!fs.existsSync(p)) return [];
        return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { unparseable: l }; } });
      }, g.session); // whose hidden events are theirs to export in full (ADR-005)
      if (!bundle) return json(res, 503, { error: "storage_unreadable", message: "Your data can't be read cleanly right now, so an export would be incomplete. Restore from a backup first." }, req);
      audit({ type: "household.export_downloaded", collections: bundle.meta.collections }, req, g.session);
      const body = Buffer.from(JSON.stringify(bundle, null, 2), "utf8");
      res.writeHead(200, {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="familios-export-${g.session.householdId}-${new Date().toISOString().slice(0, 10)}.json"`,
        "content-length": body.length,
        ...corsHeaders(req),
      });
      return res.end(body);
    }
    if (path === "/api/backups/run" && method === "POST") {
      const g = gate(req, { minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const name = createBackup();
      return json(res, 200, { ok: true, name }, req);
    }
    const backupOne = path.match(/^\/api\/backups\/([^/]+)$/);
    if (backupOne && backupOne[1] !== "run" && backupOne[1] !== "restore" && method === "GET") {
      const g = gate(req, { requireSession: true, minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const raw = readBackup(backupOne[1]);
      if (!raw) return json(res, 404, { error: "not_found" }, req);
      res.writeHead(200, { "content-type": "application/gzip", "content-disposition": `attachment; filename="${backupOne[1]}"`, ...corsHeaders(req) });
      return res.end(raw);
    }
    if (path === "/api/backups/restore" && method === "POST") {
      const g = gate(req, { minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body?.name) return json(res, 400, { error: "name_required" }, req);
      const out = restoreBackup(String(body.name));
      return json(res, out.ok ? 200 : 422, out, req);
    }
    /* Operator-only access to the pre-2026-07-30 all-tenant bundles. These predate
     * per-household backups and contain every family's data, so household Owner is not a
     * sufficient credential for them — operator authority lives in a deployment env var
     * (HOMEOPS_OPERATOR_EMAILS) that no household can grant itself, and the routes 404
     * when it is unset. Kept because they are a genuine disaster-recovery net. */
    if (path === "/api/admin/legacy-backups" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!isOperator(g.session)) return json(res, 404, { error: "not_found" }, req);
      audit({ type: "admin.legacy_backups.list", ok: true }, req, g.session);
      return json(res, 200, { backups: listLegacyBackups() }, req);
    }
    const legacyOne = path.match(/^\/api\/admin\/legacy-backups\/([^/]+)$/);
    if (legacyOne && legacyOne[1] !== "restore" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!isOperator(g.session)) return json(res, 404, { error: "not_found" }, req);
      const raw = readLegacyBackup(legacyOne[1]);
      if (!raw) return json(res, 404, { error: "not_found" }, req);
      audit({ type: "admin.legacy_backups.download", name: legacyOne[1], ok: true }, req, g.session);
      res.writeHead(200, { "content-type": "application/gzip", "content-disposition": `attachment; filename="${legacyOne[1]}"`, ...corsHeaders(req) });
      return res.end(raw);
    }
    if (path === "/api/admin/legacy-backups/restore" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!isOperator(g.session)) return json(res, 404, { error: "not_found" }, req);
      const body = await readBody(req); if (!body?.name) return json(res, 400, { error: "name_required" }, req);
      const out = restoreLegacyBundle(String(body.name));
      audit({ type: "admin.legacy_backups.restore", name: String(body.name), ok: out.ok, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }
    /* Declutter / fresh start (Owner-only, backup-first). Bulk-clears the assistant's
     * OPERATIONAL history — improvements, memory, chat/inbox, notifications, help
     * requests, approvals, run history, and generated artifacts/reports — and removes
     * explicitly-named duplicate agents + orphaned skills. NEVER touches identity/config/assets: members, settings,
     * accounts, connectors, calendar, tasks/lists, files, knowledge/recipes, or any agent/
     * skill not named in the request. A fresh backup is taken FIRST and its name returned,
     * so the whole operation is reversible via /api/backups/restore. Requires confirm:"RESET". */
    // Start fresh in the Inbox: clear delivered updates and/or decided approvals, nothing else.
    // Narrower than reset-assistant on purpose — memory, chats, runs and helpers are untouched.
    if (path === "/api/household/clear-inbox" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = (await readBody(req)) ?? {};
      const wanted = Array.isArray(body.collections) ? body.collections : ["notifications.json"];
      const allowed = ["notifications.json", "approvals.json"];
      const cleared = {};
      for (const file of wanted) {
        if (!allowed.includes(file)) return json(res, 400, { error: "not_clearable", file }, req);
        const r = clearCollection(file); cleared[file] = r.ok ? r.cleared : (r.error || "err");
      }
      audit({ type: "household.clear_inbox", cleared, ok: true }, req, g.session);
      return json(res, 200, { ok: true, cleared }, req);
    }
    if (path === "/api/household/reset-assistant" && method === "POST") {
      const g = gate(req, { minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (body.confirm !== "RESET") return json(res, 400, { error: "confirm_required", message: "Pass confirm:\"RESET\" — this bulk-clears the assistant's operational data (a backup is taken first)." }, req);
      const backup = createBackup(); // backup-first, ALWAYS
      const CLEAR = ["memory.json", "conversations.json", "notifications.json", "help-requests.json", "approvals.json", "runs.json", "artifacts.json"];
      const cleared = {};
      for (const file of CLEAR) { const r = clearCollection(file); cleared[file] = r.ok ? r.cleared : (r.error || "err"); }
      const deletedAgents = [], skippedAgents = [];
      for (const id of (Array.isArray(body.deleteAgentIds) ? body.deleteAgentIds : [])) { const r = deleteHelper(String(id)); if (r?.ok) deletedAgents.push(id); else skippedAgents.push({ id, error: r?.error || "err" }); }
      audit({ type: "household.reset_assistant", backup, clearedCounts: cleared, deletedAgents, ok: true }, req, g.session);
      return json(res, 200, { ok: true, backup, cleared, deletedAgents, skippedAgents, deletedSkills: [], skippedSkills: [] }, req);
    }
    if (path === "/api/store/quarantine/ack" && method === "POST") {
      const g = gate(req, { minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body?.file) return json(res, 400, { error: "file_required" }, req);
      const ok = acknowledgeQuarantine(String(body.file));
      audit({ type: "store.quarantine_ack", file: body.file, ok }, req, g.session);
      return json(res, 200, { ok }, req);
    }

    // Data revision — one tiny number that changes whenever household data does.
    // Clients poll this (cheap) and refetch screens only on change, which keeps
    // web and iOS in sync within seconds without websocket plumbing. rev is now
    // per-household (WP-009 / HYP-006) — see the comment on _dataRevByTenant in
    // store.mjs for why a global counter made this short-circuit ineffective.
    if (path === "/api/rev" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { rev: getDataRev() }, req);
    }

    // WP-009 (ISS-010/HYP-006): push channel for the rev signal above. Clients
    // that keep a fast poll of /api/rev to stay within a few seconds of fresh
    // blow the "idle app makes almost no requests" budget (PRD §14); a long-
    // lived SSE connection gives sub-second freshness for the cost of ONE
    // request instead of one every few seconds. Polling /api/rev remains the
    // documented fallback for clients that don't/can't hold an SSE connection
    // (see src/store/useStore.ts) — this endpoint is advisory, not the only path.
    if (path === "/api/changes" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const tenantId = g.session.householdId;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no", ...corsHeaders(req) });
      const send = (rev) => { try { res.write(`data: ${JSON.stringify({ rev })}\n\n`); } catch { /* client gone */ } };
      const onBump = ({ tenant, rev }) => { if (tenant === tenantId) send(rev); };
      revEmitter.on("bump", onBump);
      const hb = setInterval(() => { try { res.write(":keepalive\n\n"); } catch { /* ignore */ } }, 20000);
      const cleanup = () => { clearInterval(hb); revEmitter.off("bump", onBump); };
      req.on("close", cleanup);
      send(getDataRevForTenant(tenantId)); // initial snapshot so the client has a baseline immediately
      return; // hold the connection open
    }

    /* ---- Household identity: the name shows on the lock screen, briefings,
     * and invites. Any member can read it; renaming is Owner-only. ---- */
    if (path === "/api/household" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { household: { id: g.session.householdId, name: getSettings(g.session.householdId).householdName ?? null } }, req);
    }
    if (path === "/api/household" && method === "PATCH") {
      const g = gate(req, { minRole: "Owner" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const name = String(body.name ?? "").trim();
      if (!name) return json(res, 400, { error: "name_required" }, req);
      if (name.length > 60) return json(res, 400, { error: "name_too_long", message: "Keep the household name under 60 characters." }, req);
      setSettings({ householdName: name }, g.session.householdId);
      audit({ type: "household.rename", ok: true, name }, req, g.session);
      return json(res, 200, { household: { id: g.session.householdId, name } }, req);
    }

    /* ---- Everything below requires an authenticated, allowed-origin session ---- */
    // Connectors list
    /* WHAT THE APP OFFERS TO SET UP, versus what the ENGINE can reach.
     *
     * These two endpoints feed the Connections screens on web and mobile and nothing else —
     * toolCatalog() reads PROVIDERS and CONNECTORS straight from their modules, so nothing
     * filtered here can stop a tool from running, a helper from working, or a configured
     * account from being used. This is a shelf-tidying decision, not a capability one.
     *
     * Only Google is surfaced. The other OAuth providers are real code with no credentials
     * behind them, so every one of them is a row a family can tap, read a scope list for,
     * and get nowhere with — clutter in front of the handful of things that work. They come
     * back by adding an id here, which is deliberately a code change: a provider becomes
     * offerable when someone has actually wired it up, not when it merely exists.
     *
     * Connectors are filtered on `live` rather than by name, because that set moves on its
     * own — the iMessage bridge is live today and was not last week, and hard-coding it
     * would have hidden the thing this deployment runs on.
     *
     * The trade, said out loud: a connector that is not live cannot be configured FROM the
     * app any more, because its setup surface is what got hidden. Re-surfacing is the
     * one-line change above. */
    const SURFACED_PROVIDER_IDS = new Set(["google"]);

    if (path === "/api/connectors" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { connectors: listConnectors().filter((c) => c.live) }, req);
    }

    const connMatch = path.match(/^\/api\/connectors\/([^/]+)(\/(config|health))?$/);
    if (connMatch) {
      const id = connMatch[1]; const sub = connMatch[3];
      const c = connectorById(id);
      if (sub === "config" && method === "POST") {
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        if (!c) return json(res, 404, { error: "unknown_connector" }, req);
        const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
        const fields = {}, secrets = {};
        for (const f of c.configSchema) { if (!(f.key in body)) continue; if (f.type === "secret") secrets[f.key] = body[f.key]; else fields[f.key] = body[f.key]; }
        setConnectorConfig(id, fields, secrets);
        audit({ type: "connector.config", connectorId: id, ok: true, fields: Object.keys(fields) }, req, g.session);
        return json(res, 200, { connector: publicConnector(c) }, req);
      }
      if (sub === "config" && method === "DELETE") {
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        if (!c) return json(res, 404, { error: "unknown_connector" }, req);
        revokeConnector(id); setHealth(id, { ok: false, status: "revoked" });
        audit({ type: "connector.revoke", connectorId: id, ok: true }, req, g.session);
        return json(res, 200, { connector: publicConnector(c) }, req);
      }
      if (sub === "health" && method === "POST") {
        const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        if (!c) return json(res, 404, { error: "unknown_connector" }, req);
        const h = await healthCheck(id);
        audit({ type: "connector.health", connectorId: id, ok: h.ok }, req, g.session);
        return json(res, 200, h, req);
      }
      if (!sub && method === "GET") {
        const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        if (!c) return json(res, 404, { error: "unknown_connector" }, req);
        return json(res, 200, { connector: publicConnector(c) }, req);
      }
    }

    /* ---- Connector platform: providers + per-user connected accounts ---- */
    if (path === "/api/providers" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Attach this actor's accounts so the UI knows which providers are connected for them.
      const mine = listAccountsFor(g.session.householdId, g.session.actorId);
      const byProvider = {};
      for (const a of mine) (byProvider[a.provider] ||= []).push(a);
      /* B4 [09:48] — "the calendar account shows wr…@gmail.com. It should show ROSS. Our
       * family identifies each other by name, not by email address."
       *
       * The account's own displayName comes from the OAuth provider and is usually the email.
       * The member who connected it is recorded on the account (connectedByActorId), so the
       * name is right here — attached server-side so the web and the app say the same thing. */
      const roster = new Map(listMembers((m) => m.householdId === g.session.householdId).map((m) => [m.actorId, m.displayName]));
      const named = (a) => ({ ...a, memberName: roster.get(a.connectedByActorId) ?? null });
      const providers = listConnectorProviders()
        .filter((p) => SURFACED_PROVIDER_IDS.has(p.id))
        .map((p) => ({ ...p, accounts: (byProvider[p.id] ?? []).map(named) }));
      return json(res, 200, { providers, redirectUri: oauthRedirectUri() }, req);
    }
    if (path === "/api/accounts" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { accounts: listAccountsFor(g.session.householdId, g.session.actorId) }, req);
    }
    // Sandbox-mode ONLY (WP-006 s4–s6): the recorded would-be effects for THIS tenant,
    // so a UI-driven use-case spec can assert what content/recipient/channel WOULD have
    // gone out (see server/test/README-sandbox.md). 404 in real mode — this surface
    // does not exist outside the sandbox, and it never exposes another tenant's data
    // (listSandboxEffects reads the session tenant's own collection).
    if (path === "/api/sandbox/effects" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!sandboxEnabled()) return json(res, 404, { error: "not_found" }, req);
      return json(res, 200, { sandbox: true, effects: listSandboxEffects() }, req);
    }
    // Household graph (P4.2): the server-owned member roster with roles + relationships.
    // This is the source of truth the session role is resolved from (P0.2); the client
    // renders it but cannot mint roles. No secrets — safe for any household member to read.
    if (path === "/api/members" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const members = listMembers({ householdId: g.session.householdId }).filter((m) => !m.archived).map((m) => ({
        actorId: m.actorId, displayName: m.displayName, role: m.role, relationship: m.relationship ?? null,
        color: m.color ?? null, spaceIds: m.spaceIds ?? [], isCurrentUser: m.actorId === g.session.actorId,
        // Self-service profile: an uploaded photo file id or a curated avatar id (e.g. "avatar:03").
        photoFileId: m.photoFileId ?? null,
        // Adult-granted AI access for a child (default off).
        aiEnabled: m.aiEnabled === true,
        // The Owner's narrowing of a Limited Member's calendar (ADR-005). The Owner sets it
        // and the Owner alone reads it back — that the teenager's view leaves out a parent's
        // work calendar is not everyone's business, the teenager's included.
        ...(g.session.role === "Owner" ? { calendarScope: m.calendarScope ?? null } : {}),
      }));
      return json(res, 200, { members }, req);
    }
    // Member management (post-claim): Owners/Adult Admins shape the roster. The last
    // Owner can never be demoted or archived, and you can't archive yourself.
    if (path === "/api/members" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const displayName = String(body.displayName ?? "").trim();
      if (!displayName) return json(res, 400, { error: "name_required" }, req);
      if (!VALID_ROLES.includes(body.role)) return json(res, 400, { error: "bad_role", valid: VALID_ROLES }, req);
      const actorId = String(body.actorId ?? ("m-" + crypto.randomBytes(4).toString("hex"))).trim();
      if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(actorId)) return json(res, 400, { error: "bad_actor_id" }, req);
      if (getMember(actorId)) return json(res, 409, { error: "actor_exists" }, req);
      const color = normalizeMemberColor(body.color);
      const m = putMember({ actorId, displayName, role: body.role, relationship: body.relationship ?? null, householdId: g.session.householdId, ...(color !== undefined ? { color } : {}) });
      audit({ type: "member.create", memberId: actorId, role: body.role, ok: true }, req, g.session);
      return json(res, 200, { member: { actorId: m.actorId, displayName: m.displayName, role: m.role, relationship: m.relationship ?? null, color: m.color ?? null } }, req);
    }
    const memberOne = path.match(/^\/api\/members\/([^/]+)$/);
    if (memberOne && method === "PATCH") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const m = getMember(memberOne[1]);
      if (!m || m.archived) return json(res, 404, { error: "not_found" }, req);
      /* Cluster W — the edit matrix, by RELATIONSHIP rather than by rank alone.
       *
       * "Other adult members or even admins should not have the ability to update anybody
       *  else's account but themselves, their child or someone else in their nest. They
       *  should not be able to update someone outside of their nest."
       *
       * Owner → anyone (they answer for the household). Adults → themselves + their own
       * nest, the nest standing in for "their people" — Melissa edits Ross and Amelia
       * because they share a nest, and cannot touch GPop's account across the hall.
       * Limited members and children → themselves only, and a child's self-service is
       * colour and emoji, nothing else ("for the child, they should only be able to edit
       * their color, and that's it"). */
      const isSelf = m.actorId === g.session.actorId;
      const isOwner = g.session.role === "Owner";
      const myNestIds = new Set(nestsFor(g.session.householdId, g.session.actorId).map((n) => n.id));
      const sameNest = !isSelf && nestsFor(g.session.householdId, m.actorId).some((n) => myNestIds.has(n.id));
      const adultActor = isAdultRole(g.session.role);
      const mayTouch = isOwner || isSelf || (adultActor && sameNest);
      if (!mayTouch) return json(res, 403, { error: "outside_your_nest", message: "You can edit yourself and the people in your nest. The Owner manages everyone else." }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      // Role, relationship, and a child's AI switch stay governance: Adult Admin+ — and only
      // inside the same matrix (an Adult Admin still can't re-role someone outside their nest).
      const governs = isOwner || (roleAtLeast(g.session.role, "Adult Admin") && (isSelf || sameNest));
      if (!governs && (body.relationship !== undefined || body.role != null || body.aiEnabled !== undefined)) {
        return json(res, 403, { error: "insufficient_role", message: "Only an Owner or Adult Admin can change roles or relationships." }, req);
      }
      if (g.session.role === "Child View") {
        const allowed = new Set(["color", "photoFileId"]);
        const asked = Object.keys(body).filter((k) => body[k] !== undefined);
        if (asked.some((k) => !allowed.has(k)) || (body.photoFileId && !String(body.photoFileId).startsWith("emoji:"))) {
          return json(res, 403, { error: "child_limited", message: "Kids can pick their colour and emoji here — a grown-up changes the rest." }, req);
        }
      }
      const patch = {};
      if (body.displayName != null) { const n = String(body.displayName).trim(); if (!n) return json(res, 400, { error: "name_required" }, req); patch.displayName = n; }
      if (body.relationship !== undefined) patch.relationship = body.relationship;
      // Color: an explicit null/"" clears it; a valid accent name or hex sets it; anything else is ignored.
      if (body.color !== undefined) {
        if (body.color === null || body.color === "") patch.color = null;
        else {
          const c = normalizeMemberColor(body.color);
          if (!c) return json(res, 400, { error: "bad_color", message: "Pick a named accent or a #hex colour." }, req);
          const holder = colorHeldBy(c, g.session.householdId, m.actorId);
          if (holder) {
            return json(res, 409, {
              error: "color_taken", holder: holder.displayName,
              message: `${holder.displayName} already has that colour (or one too close to tell apart). Pick one further away.`,
            }, req);
          }
          patch.color = c;
        }
      }
      if (body.role != null) {
        if (!VALID_ROLES.includes(body.role)) return json(res, 400, { error: "bad_role", valid: VALID_ROLES }, req);
        const owners = listMembers({ householdId: g.session.householdId }).filter((x) => !x.archived && x.role === "Owner");
        if (m.role === "Owner" && body.role !== "Owner" && owners.length <= 1) return json(res, 409, { error: "last_owner", message: "The household needs at least one Owner." }, req);
        patch.role = body.role;
      }
      // Profile photo / curated avatar id (self-service). An explicit null/"" clears it.
      if (body.photoFileId !== undefined) {
        patch.photoFileId = body.photoFileId ? String(body.photoFileId).slice(0, 120) : null;
        // A REAL uploaded photo is uploaded private, so another member's Today-strip card
        // 404s on it (canSeeEntity denies a private file they don't own). Flip that one
        // file to household visibility so the whole family can render the avatar. Curated
        // ("avatar:03") and emoji ("emoji:🦊") ids resolve to no file — left untouched.
        if (patch.photoFileId && !patch.photoFileId.startsWith("emoji:")) {
          const f = getFileRec(patch.photoFileId);
          if (f && f.householdId === g.session.householdId && f.visibility !== "household") patchFileRec(f.id, { visibility: "household" });
        }
      }
      // Child AI access — an adult toggles whether a child may chat with the assistant.
      if (body.aiEnabled !== undefined) patch.aiEnabled = !!body.aiEnabled;
      const updated = putMember({ actorId: m.actorId, ...patch });
      /* A session carries the role it was opened with, and gate() trusts it. Sessions renew
       * while used (store.mjs), so a demoted member's old session would otherwise keep the old
       * role for up to a week — a role change ends the member's sessions, and their next
       * sign-in reads the new role. (Archiving already does this.) */
      const sessionsEnded = patch.role && patch.role !== m.role ? deleteSessionsForActor(m.actorId, g.session.householdId) : 0;
      audit({ type: "member.update", memberId: m.actorId, fields: Object.keys(patch), ok: true, ...(sessionsEnded ? { sessionsEnded } : {}) }, req, g.session);
      return json(res, 200, { member: { actorId: updated.actorId, displayName: updated.displayName, role: updated.role, relationship: updated.relationship ?? null, color: updated.color ?? null, photoFileId: updated.photoFileId ?? null, aiEnabled: updated.aiEnabled === true } }, req);
    }
    /* A Limited Member's calendar scope (ADR-005): the Owner narrows what their calendar
     * shows — per other member "all", "none" or chosen calendars. Its own route, not a field
     * on PATCH /api/members/:id (whose allow-list never admits it): the Owner-only rule and
     * the validation live in one place, and nobody can set their own scope by editing their
     * profile. Their own events and the ones they take part in always show (event-privacy). */
    const memberScope = path.match(/^\/api\/members\/([^/]+)\/calendar-scope$/);
    if (memberScope && method === "PUT") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (g.session.role !== "Owner") return json(res, 403, { error: "owner_only", message: "Only the Owner can choose what a limited member's calendar shows." }, req);
      const m = getMember(memberScope[1]);
      if (!m || m.archived || (m.householdId && m.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
      if (m.role !== "Limited Member") return json(res, 400, { error: "not_limited_member", message: "A calendar scope applies to limited members only." }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const r = normalizeCalendarScope(body.scope, m, privacyContext(g.session.householdId));
      if (!r.ok) return json(res, 400, { error: r.error, message: r.message }, req);
      const updated = putMember({ actorId: m.actorId, calendarScope: r.value });
      audit({ type: "member.calendar_scope", memberId: m.actorId, cleared: r.value === null, members: r.value ? Object.keys(r.value.members).length : 0, ok: true }, req, g.session);
      return json(res, 200, { member: { actorId: updated.actorId, calendarScope: updated.calendarScope ?? null } }, req);
    }
    if (memberOne && method === "DELETE") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const m = getMember(memberOne[1]);
      if (!m || m.archived) return json(res, 404, { error: "not_found" }, req);
      if (m.actorId === g.session.actorId) return json(res, 409, { error: "cannot_archive_self", message: "You can't remove the profile you're signed in as." }, req);
      const owners = listMembers({ householdId: g.session.householdId }).filter((x) => !x.archived && x.role === "Owner");
      if (m.role === "Owner" && owners.length <= 1) return json(res, 409, { error: "last_owner", message: "The household needs at least one Owner." }, req);
      putMember({ actorId: m.actorId, archived: true });
      // A removed member's devices lose access NOW, not at token expiry.
      const killed = deleteSessionsForActor(m.actorId);
      // …and stop being REACHABLE. Their push tokens and contact methods stayed live, so a
      // scheduled briefing kept emailing them and task reminders kept ringing their phone.
      let tokensRemoved = 0;
      for (const t of getPushTokens()) if (t.actorId === m.actorId) { removePushToken(t.token); tokensRemoved++; }
      let methodsClosed = 0;
      for (const cm of listContactMethods((c) => c.householdId === g.session.householdId && c.memberId === m.actorId)) {
        patchContactMethod(cm.id, { optInStatus: "Opted Out", allowedAgentIds: [] });
        methodsClosed++;
      }
      audit({ type: "member.archive", memberId: m.actorId, sessionsKilled: killed, tokensRemoved, methodsClosed, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }
    const acctHealth = path.match(/^\/api\/accounts\/([^/]+)\/health$/);
    if (acctHealth && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const owned = getOwnedAccount(acctHealth[1], g.session);
      if (owned.error) return json(res, owned.error === "forbidden" ? 403 : 404, { error: owned.error }, req);
      const h = await checkAccountHealth(owned.account);
      audit({ type: "account.health", provider: owned.account.provider, accountId: owned.account.id, ok: h.ok }, req, g.session);
      return json(res, 200, h, req);
    }
    /* The manual counterpart to the timer. Any ADULT may run it for the whole household —
     * deliberately wider than POST /api/accounts/:id/health, which is restricted to the
     * member who connected that one account. That restriction is exactly why a stale status
     * on someone ELSE's account was unfixable from the screen showing it: Ross could see that
     * Melissa's calendar said "reconnect" and had no way to ask whether that was still true.
     * Re-checking is read-only — it can clear or confirm a status, never grant access. */
    if (path === "/api/accounts/health-check" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!isAdultRole(g.session.role)) return json(res, 403, { error: "insufficient_role" }, req);
      const out = await sweepAccountHealth({ householdId: g.session.householdId, force: true });
      audit({ type: "account.health_sweep", ...out, ok: true }, req, g.session);
      return json(res, 200, { ok: true, ...out }, req);
    }
    const acctMatch = path.match(/^\/api\/accounts\/([^/]+)$/);
    if (acctMatch && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const owned = getOwnedAccount(acctMatch[1], g.session);
      if (owned.error) return json(res, owned.error === "forbidden" ? 403 : 404, { error: owned.error }, req);
      revokeAccount(owned.account.id);
      audit({ type: "account.revoke", provider: owned.account.provider, accountId: owned.account.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }

    /* ---- Server-side approvals (list / create / decide) ----
     * Authority is role-safe: low-trust roles (Child View, Guest/Helper) cannot
     * initiate external actions or approve them, and only approvals an actor may
     * observe/decide are returned. The frozen-input hash + household IDOR checks are
     * preserved; the approver-role policy is the new layer. */
    if (path === "/api/approvals" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Only return approvals this actor may observe: ones they requested, or ones
      // they are an allowed approver for. A child never sees adult approvals.
      const visible = listApprovals({ householdId: g.session.householdId }).filter((a) =>
        a.requestedBy === g.session.actorId || canApprove(a, { role: g.session.role, actorId: g.session.actorId }));
      return json(res, 200, { approvals: visible.map(publicApproval) }, req);
    }
    if (path === "/api/approvals" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Children/guests cannot initiate external actions — requesting an executable
      // approval requires at least a Limited Member.
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      // Resolve the tool from the provider platform first, then legacy connectors.
      const platform = findToolGlobal(body.toolId);
      const conn = platform ? null : listConnectors().find((x) => x.tools.some((t) => t.id === body.toolId));
      const tool = platform?.tool ?? conn?.tools.find((t) => t.id === body.toolId);
      const connectorId = platform?.provider.id ?? conn?.id;
      if (!tool) return json(res, 404, { error: "unknown_tool" }, req);
      if (!tool.requiresApproval) return json(res, 400, { error: "approval_not_required" }, req);
      const a = createApproval({ actorId: g.session.actorId, householdId: g.session.householdId, connectorId, toolId: body.toolId, input: body.input ?? {}, risk: tool.risk, category: body.category, preview: body.preview, source: "executable" });
      audit({ type: "approval.create", connectorId, toolId: body.toolId, approvalId: a.id, ok: true }, req, g.session);
      void notifyApproval(a);
      return json(res, 200, { approval: publicApproval(a) }, req);
    }
    const aprDecide = path.match(/^\/api\/approvals\/([^/]+)\/decide$/);
    if (aprDecide && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      // Household scoping: only a member of the approval's own household may decide it
      // (mirrors the account routes' ownership check). Prevents cross-household IDOR.
      const existing = getApproval(aprDecide[1]);
      if (!existing || existing.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      // Authority gate: a low-trust role can no longer approve high-risk actions.
      const out = decideApproval(aprDecide[1], { decision: body.decision === "approve" ? "approve" : "deny", actorId: g.session.actorId, actorRole: g.session.role });
      if (out.error === "approver_not_allowed") { audit({ type: "approval.decide", approvalId: aprDecide[1], ok: false, error: out.error }, req, g.session); return json(res, 403, { error: out.error }, req); }
      if (out.error) { audit({ type: "approval.decide", approvalId: aprDecide[1], ok: false, error: out.error }, req, g.session); return json(res, 409, { error: out.error }, req); }
      audit({ type: "approval.decide", approvalId: aprDecide[1], ok: true, decision: out.approval.status }, req, g.session);
      // Auto-resume the durable run parked on this approval (fire-and-forget): on
      // approve it continues + consumes the approval; on deny the run fails cleanly.
      // Re-check the parked run is the same household before driving it.
      const parked = findRunByApprovalId(aprDecide[1]);
      if (parked && parked.householdId === g.session.householdId) resumeRun(parked.id).catch(() => {});
      return json(res, 200, { approval: publicApproval(out.approval) }, req);
    }
    const aprGet = path.match(/^\/api\/approvals\/([^/]+)$/);
    if (aprGet && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const a = getApproval(aprGet[1]);
      if (!a || a.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      return json(res, 200, { approval: publicApproval(a) }, req);
    }

    /* ---- Tool execution (approval enforced via server-side record) ---- */
    const toolMatch = path.match(/^\/api\/tools\/([^/]+)\/execute$/);
    if (toolMatch && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const toolId = toolMatch[1];
      const input = body.input ?? {};
      const platform = findToolGlobal(toolId);

      // Shared approval gate: the client `approved` boolean is ignored; a valid,
      // unconsumed, input-hash-matching server approval is required for gated tools.
      const requiresApproval = platform?.tool.requiresApproval ?? (listConnectors().find((x) => x.tools.some((t) => t.id === toolId))?.tools.find((t) => t.id === toolId)?.requiresApproval);
      let approvalId;
      if (requiresApproval) {
        const c = consumeApproval({ id: body.approvalId, actorId: g.session.actorId, householdId: g.session.householdId, toolId, input });
        if (c.error) { audit({ type: "tool.execute", toolId, ok: false, error: c.error }, req, g.session); return json(res, 422, { ok: false, error: c.error, message: approvalErrorMessage(c.error) }, req); }
        approvalId = c.approval.id;
      }

      if (platform) {
        // Provider-platform tool → run against THIS actor's connected account.
        if (!externalActionsEnabled(g.session.householdId) && ["Write", "Send", "Download"].includes(platform.tool.action)) return json(res, 423, { ok: false, error: "external_actions_disabled", message: "External actions are paused by the household kill switch." }, req);
        const accounts = listAccountsFor(g.session.householdId, g.session.actorId).filter((a) => a.provider === platform.provider.id);
        const account = body.accountId ? accounts.find((a) => a.id === body.accountId) : accounts[0];
        if (!account) { audit({ type: "tool.execute", toolId, ok: false, error: "no_account" }, req, g.session); return json(res, 422, { ok: false, error: "not_connected", message: `Connect your ${platform.provider.name} account to use this tool.` }, req); }
        try {
          const result = await platform.tool.run(apiForAccount(account), input);
          audit({ type: "tool.execute", connectorId: platform.provider.id, toolId, accountId: account.id, ok: true, action: platform.tool.action }, req, g.session);
          return json(res, 200, { ok: true, result }, req);
        } catch (e) {
          // Typed validation failures (e.code) surface honestly — an empty email body
          // is invalid_input, not a Google-side error.
          const code = e?.code === "invalid_input" ? "invalid_input" : "provider_error";
          audit({ type: "tool.execute", connectorId: platform.provider.id, toolId, accountId: account.id, ok: false, error: code }, req, g.session);
          return json(res, 422, { ok: false, error: code, message: String(e?.message ?? e) }, req);
        }
      }

      // Legacy utility connectors (weather/rss/http/sms/...).
      const out = await executeTool(toolId, input, { actorId: g.session.actorId, requestId: req.__rid, approvalConsumed: !!approvalId, approvalId });
      return json(res, out.ok ? 200 : 422, out, req);
    }

    /* ---- Durable runs (the canonical server-side runtime) ---- */
    if (path === "/api/runs" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const runs = listRuns({
        householdId: g.session.householdId,
        status: url.searchParams.get("status") || undefined,
        source: url.searchParams.get("source") || undefined,
        agentId: url.searchParams.get("agentId") || undefined,
        skillId: url.searchParams.get("skillId") || undefined,
        limit: Number(url.searchParams.get("limit") || 100),
      });
      // Object-level scope: adults see the household's runs; low-trust roles
      // (Child View, Guest/Helper, Limited Member) see only runs they started.
      const scoped = (isAdultRole(g.session.role) ? runs : runs.filter((r) => r.actorId === g.session.actorId))
        .filter((r) => !secretRunHidden(r, g.session));
      return json(res, 200, { runs: scoped.map(publicRun) }, req);
    }
    if (path === "/api/runs/start" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Children/guests cannot initiate automation runs (which may reach external tools).
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      // WP-006 slice 1 — through the single orchestrate() entry (skillId → runSkill; raw
      // plan → startRun-as-is). No route creates a run directly anymore.
      const out = await orchestrate({
        source: body.skillId ? (body.source ?? "skill") : (body.source ?? "manual"),
        via: "manual",
        skillId: body.skillId ?? null,
        plan: (body.plan && typeof body.plan === "object") ? body.plan : null,
        params: body.params ?? {},
        session: g.session,
        sourceRef: clientSourceRef(body.sourceRef),
      });
      if (out.error) {
        const code = out.error === "unknown_skill" ? 404 : out.error === "nothing_to_run" ? 400 : 422;
        // WP-101 slice 1: typed preflight refusals (no_acting_agent) carry a plain-language
        // `message` naming the fix. Dropping it would leave the client with a bare error
        // code and nothing to show the family.
        return json(res, code, {
          error: out.error === "nothing_to_run" ? "plan_or_skill_required" : out.error,
          ...(out.message ? { message: out.message } : {}),
        }, req);
      }
      const run = out.run;
      audit({ type: "run.start", runId: run.id, source: run.source, ok: true }, req, g.session);
      return json(res, 200, { run: publicRun(run) }, req);
    }
    const runGet = path.match(/^\/api\/runs\/([^/]+)$/);
    if (runGet && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const r = getRun(runGet[1]);
      if (!r || r.householdId !== g.session.householdId || secretRunHidden(r, g.session)) return json(res, 404, { error: "not_found" }, req);
      return json(res, 200, { run: publicRun(r) }, req);
    }
    // Interactive email review (item 3): correlate a completed run's gmail.search results
    // (which carry subject/from per message) with its gmail.modifyLabels steps (which say
    // what was added/removed to which messageIds), producing a per-message review list the
    // chat can render with revert/relabel actions. Household-scoped; empty when the run
    // never touched Gmail labels.
    const runReview = path.match(/^\/api\/runs\/([^/]+)\/email-review$/);
    if (runReview && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const r = getRun(runReview[1]);
      if (!r || r.householdId !== g.session.householdId || secretRunHidden(r, g.session)) return json(res, 404, { error: "not_found" }, req);
      // 1) Metadata map: id -> {subject, from} from every gmail.search result.
      const meta = {};
      const labels = [];
      const labelSeen = new Set();
      for (const s of r.steps ?? []) {
        if (s.toolId === "gmail.search" && s.result && Array.isArray(s.result.messages)) {
          for (const m of s.result.messages) if (m?.id) meta[m.id] = { subject: m.subject ?? "", from: m.from ?? "", snippet: m.snippet ?? "" };
        }
        if (s.toolId === "gmail.listLabels" && s.result && Array.isArray(s.result.labels)) {
          for (const l of s.result.labels) if (l?.name && !labelSeen.has(l.name)) { labelSeen.add(l.name); labels.push({ id: l.id, name: l.name, type: l.type }); }
        }
      }
      // 2) Per-message applied changes from every SUCCEEDED gmail.modifyLabels step.
      const byId = new Map();
      for (const s of r.steps ?? []) {
        if (s.toolId !== "gmail.modifyLabels" || s.status !== "succeeded") continue;
        const ids = String(s.input?.messageIds ?? "").split(",").map((x) => x.trim()).filter(Boolean);
        const added = Array.isArray(s.result?.added) ? s.result.added : [];
        const removed = Array.isArray(s.result?.removed) ? s.result.removed : [];
        for (const id of ids) {
          const cur = byId.get(id) ?? { id, subject: meta[id]?.subject ?? "", from: meta[id]?.from ?? "", snippet: meta[id]?.snippet ?? "", added: [], removed: [] };
          for (const a of added) if (!cur.added.includes(a)) cur.added.push(a);
          for (const rm of removed) if (!cur.removed.includes(rm)) cur.removed.push(rm);
          byId.set(id, cur);
        }
      }
      const messages = [...byId.values()];
      return json(res, 200, { runId: r.id, messages, labels, touchedGmail: messages.length > 0 }, req);
    }
    const runResume = path.match(/^\/api\/runs\/([^/]+)\/resume$/);
    if (runResume && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const r = getRun(runResume[1]);
      if (!r || r.householdId !== g.session.householdId || secretRunHidden(r, g.session)) return json(res, 404, { error: "not_found" }, req);
      await resumeRun(runResume[1]);
      return json(res, 200, { run: publicRun(getRun(runResume[1])) }, req);
    }
    const runCancel = path.match(/^\/api\/runs\/([^/]+)\/cancel$/);
    if (runCancel && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const r = getRun(runCancel[1]);
      if (!r || r.householdId !== g.session.householdId || secretRunHidden(r, g.session)) return json(res, 404, { error: "not_found" }, req);
      await cancelRun(runCancel[1]);
      audit({ type: "run.cancel", runId: runCancel[1], ok: true }, req, g.session);
      return json(res, 200, { run: publicRun(getRun(runCancel[1])) }, req);
    }
    // Live run progress over Server-Sent Events: pushes a full run snapshot on every
    // state transition (engine.mjs emits per-run events). The /api/runs/{id} poll
    // remains the durable fallback — SSE is advisory; runs.json is the truth.
    const runEvents = path.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (runEvents && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const r0 = getRun(runEvents[1]);
      if (!r0 || r0.householdId !== g.session.householdId || secretRunHidden(r0, g.session)) return json(res, 404, { error: "not_found" }, req);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no", ...corsHeaders(req) });
      // WP-101 slice 3: partially_failed is terminal. Omitting it here would leave the SSE
      // stream open forever on a finished run (the client waits on a run that will never
      // emit again).
      const TERMINAL_RUN = ["completed", "partially_failed", "failed", "cancelled", "expired"];
      const emitter = runEmitter(runEvents[1]);
      let hb;
      const cleanup = () => { clearInterval(hb); emitter.off("event", onEvent); };
      const send = (run) => { if (run) { try { res.write(`data: ${JSON.stringify(publicRun(run))}\n\n`); } catch { /* client gone */ } } };
      const onEvent = ({ run }) => {
        send(run);
        // Close the stream once the run can never change again — no lingering connection.
        if (run && TERMINAL_RUN.includes(run.status)) { cleanup(); try { res.end(); } catch { /* ignore */ } }
      };
      emitter.on("event", onEvent);
      hb = setInterval(() => { try { res.write(":keepalive\n\n"); } catch { /* ignore */ } }, 20000);
      req.on("close", cleanup);
      send(r0); // initial snapshot
      if (TERMINAL_RUN.includes(r0.status)) { cleanup(); try { res.end(); } catch { /* ignore */ } } // already done → one snapshot + close
      return; // hold the connection open for live runs
    }

    /* ---- Family data: server-owned events & tasks (P1.2 / P4.1) ----
     * Reads are object-level filtered by role/visibility (children/guests see only
     * household/childVisible items + their own); writes require Limited Member+. */
    /* GET /api/events is a DECLARED READ (server/actions/reads.mjs), answered by
     * handleActionRoutes at the top of this chain: the per-viewer decorations (editable,
     * appendable, myNotes, staleSource) and the ISS-121 stale-source rule live there, as
     * does the output schema both clients' event types are generated from. */
    /* POST /api/events is a DECLARED action (server/actions/events.mjs) and is answered by
     * handleActionRoutes at the top of this chain — the same run the agent tool uses, with
     * via:"user". Nothing here may re-declare it; action-routes.test.mjs checks. */
    /* ---- E5/E6/E7: who's coming, told, and answering ----
     * [12:26] "Replace or augment 'note for driver' with WHO'S ATTENDING — let me pick GPop,
     *          Beannie, Melissa."
     * [12:56] "Selecting them should notify them, or at least inform them they're on it."
     * [13:07] "And they should be able to accept or decline, like a meeting invite."
     *
     * `attendees` is a list of { memberId, status, respondedAt } living alongside the older
     * `participantIds` (which many screens and the Google push still read). Setting attendees
     * keeps participantIds in step, so nothing downstream has to learn a new field to keep
     * working — and an existing event with participants but no RSVP list is read as everyone
     * "invited", not as everyone silently accepted.
     */
    const eventAttendees = path.match(/^\/api\/events\/([^/]+)\/attendees$/);
    if (eventAttendees && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const ev = getEvent(eventAttendees[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(ev, g.session)) return json(res, 403, { error: "forbidden" }, req);
      { const hidden = hiddenEventRefusal(ev, g.session); if (hidden) return json(res, hidden.status, { error: hidden.error, message: hidden.message }, req); }
      /* "I shouldn't be able to change who's coming. That would be handled by the event
       * creator." Owner of the EVENT — being an adult, or even the household Owner, is not
       * a seat at someone else's guest list. Wanting on it goes through request-attend.
       * A household feed's mirror (no member owner) stays adult-managed: which of US are
       * going to the school's early dismissal is this family's own bookkeeping. */
      const guestKeeper = getMember(ev.ownerId ?? "")
        ? (ev.ownerId === g.session.actorId || ev.createdBy === g.session.actorId)
        : isAdultRole(g.session.role);
      if (!guestKeeper) {
        return json(res, 403, { error: "not_event_owner", message: "Only the person whose event this is can change who's on it. You can request to attend instead." }, req);
      }
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const wanted = Array.isArray(body.memberIds) ? body.memberIds.map(String) : null;
      if (!wanted) return json(res, 400, { error: "member_ids_required" }, req);
      // Only real, non-archived household members — an invite to an id nobody holds is a
      // row on a card that can never respond.
      const roster = new Map(listMembers((m) => m.householdId === g.session.householdId && !m.archived).map((m) => [m.actorId, m]));
      const ids = [...new Set(wanted.filter((x) => roster.has(x)))];
      const prior = new Map((ev.attendees ?? []).map((a) => [a.memberId, a]));
      // An existing answer is PRESERVED across an edit: re-saving the list must not silently
      // reset someone who already declined back to "invited".
      const attendees = ids.map((memberId) => prior.get(memberId) ?? { memberId, status: "invited", respondedAt: null });
      // Whoever is genuinely new AND isn't the person doing the adding — nobody needs a
      // notification telling them what they just did.
      const added = ids.filter((x) => !prior.has(x) && x !== g.session.actorId);
      const updated = patchEvent(ev.id, { attendees, participantIds: ids });

      // E6 — newly added people are actually told. Their own device (push) plus a durable
      // in-app notification, so it survives a phone that was off. Never re-notified on an
      // unrelated edit: only `added`.
      const when = updated.startAt ? formatForHousehold(updated.startAt, g.session.householdId) : "no date set yet";
      for (const memberId of added) {
        addNotification({
          householdId: g.session.householdId, actorId: memberId, channel: "in_app",
          title: `You're on "${updated.title}"`,
          body: `${when}${updated.location ? ` · ${updated.location}` : ""}. Let them know if you can make it.`,
          to: null,
        });
        void pushToMember({
          householdId: g.session.householdId, actorId: memberId,
          title: `You're on "${updated.title}"`,
          body: `${when}. Accept or decline in FamiliOS.`,
          data: { type: "event", id: updated.id },
        }).catch(() => {});
      }
      audit({ type: "event.attendees_set", eventId: ev.id, count: ids.length, notified: added.length, ok: true }, req, g.session);
      return json(res, 200, { event: updated, notified: added.length }, req);
    }
    // E7 — accept or decline, for YOURSELF. An adult may answer on behalf of a child they can
    // already act for; nobody else can put words in another member's mouth.
    const eventRsvp = path.match(/^\/api\/events\/([^/]+)\/rsvp$/);
    if (eventRsvp && method === "POST") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const ev = getEvent(eventRsvp[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(ev, g.session)) return json(res, 403, { error: "forbidden" }, req);
      // A participant of a hidden event is not its owner: they see a block, and a block
      // has nothing to answer (ADR-005).
      { const hidden = hiddenEventRefusal(ev, g.session); if (hidden) return json(res, hidden.status, { error: hidden.error, message: hidden.message }, req); }
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const status = ["accepted", "declined", "invited"].includes(body.status) ? body.status : null;
      if (!status) return json(res, 400, { error: "bad_status", message: "Answer with accepted, declined, or invited." }, req);
      const memberId = String(body.memberId ?? g.session.actorId);
      if (memberId !== g.session.actorId) {
        /* An adult may answer for a CHILD — a six-year-old doesn't RSVP. What this used to
         * allow was any adult answering for any ADULT, which is exactly the "I am able to
         * select that I'm coming" problem inverted: putting words in someone's mouth. */
        const target = getMember(memberId);
        if (!isAdultRole(g.session.role) || !target || target.role !== "Child View") {
          return json(res, 403, { error: "forbidden", message: "You can only answer for yourself (or for a child)." }, req);
        }
      }
      const list = ev.attendees ?? (ev.participantIds ?? []).map((m) => ({ memberId: m, status: "invited", respondedAt: null }));
      if (!list.some((a) => a.memberId === memberId)) {
        return json(res, 400, { error: "not_an_attendee", message: "That person isn't on this event." }, req);
      }
      const attendees = list.map((a) => (a.memberId === memberId
        ? { ...a, status, respondedAt: status === "invited" ? null : new Date().toISOString() }
        : a));
      const updated = patchEvent(ev.id, { attendees });
      // The organizer finds out. Silent RSVPs are the reason people text "did you see my
      // reply?" — and the event owner is the one who has to plan around the answer.
      if (ev.ownerId && ev.ownerId !== memberId) {
        const who = getMember(memberId)?.displayName ?? "Someone";
        const verb = status === "accepted" ? "is coming" : status === "declined" ? "can't make it" : "hasn't answered";
        const when = updated.startAt ? formatForHousehold(updated.startAt, g.session.householdId) : "no date set";
        /* Cluster I — "Melissa should have received a notification during that period. She
         * did not." The in-app record existed; the PUSH didn't, so a phone in a pocket
         * heard nothing. And the record itself said "Ross is coming" with no event, no
         * time — "I can't actually see any context about it." Both halves fixed here:
         * push rides along, and the body says what, when. data.id lets the client open
         * the event instead of just dismissing the row. */
        addNotification({
          householdId: g.session.householdId, actorId: ev.ownerId, channel: "in_app",
          title: `${who} ${verb}`,
          body: `"${updated.title}" · ${when}`,
          data: { type: "event", id: updated.id },
          to: null,
        });
        void pushToMember({
          householdId: g.session.householdId, actorId: ev.ownerId,
          title: `${who} ${verb}`,
          body: `"${updated.title}" · ${when}`,
          data: { type: "event", id: updated.id },
        }).catch(() => {});
      }
      audit({ type: "event.rsvp", eventId: ev.id, memberId, status, ok: true }, req, g.session);
      return json(res, 200, { event: updated }, req);
    }

    /* ---- Cluster D: the polite doors into someone else's event ----
     *
     * "Would like to tag along? … send a request to attend. And Melissa would get a
     *  notification … accept or decline. If she accepted I would be added to the event."
     * "Want to give them a lift → offer transportation … at that point I would be assigned
     *  as the driver."
     * "There should be a button that says suggest to the owner of this event."
     *
     * Three kinds, one shape: a pending entry on the event, a notification (in-app + push)
     * to the owner, and a respond endpoint only the owner can call. Nothing on the shared
     * record changes until the owner says yes — that is the entire point of the door. */
    const eventAsk = path.match(/^\/api\/events\/([^/]+)\/(request-attend|offer-drive|suggest-bring)$/);
    if (eventAsk && method === "POST") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const ev = getEvent(eventAsk[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(ev, g.session)) return json(res, 403, { error: "forbidden" }, req);
      { const hidden = hiddenEventRefusal(ev, g.session); if (hidden) return json(res, hidden.status, { error: hidden.error, message: hidden.message }, req); }
      const kind = eventAsk[2] === "request-attend" ? "attend" : eventAsk[2] === "offer-drive" ? "drive" : "bring";
      const owner = ev.ownerId ?? ev.createdBy;
      if (!owner) return json(res, 422, { error: "no_owner", message: "This event has no owner to ask." }, req);
      if (owner === g.session.actorId) return json(res, 400, { error: "own_event", message: "It's your event — just edit it." }, req);
      const body = (await readBody(req)) ?? {};
      const item = kind === "bring" ? String(body.item ?? "").trim() : null;
      if (kind === "bring" && !item) return json(res, 400, { error: "item_required", message: "Say what you're suggesting they bring." }, req);
      if (kind === "attend" && (ev.participantIds ?? []).includes(g.session.actorId)) {
        return json(res, 400, { error: "already_on_it", message: "You're already on this event." }, req);
      }
      const requests = { attend: [], drive: [], bring: [], ...(ev.requests ?? {}) };
      // One standing ask per person per kind — a second tap is impatience, not a new request.
      const dup = requests[kind].some((r) => r.actorId === g.session.actorId && (kind !== "bring" || r.item === item));
      if (dup) {
        // The ask is already standing; a second tap used to re-notify the owner every time.
        return json(res, 200, { ok: true, pending: true, duplicate: true, requests }, req);
      }
      requests[kind] = [...requests[kind], { actorId: g.session.actorId, ...(item ? { item } : {}), at: new Date().toISOString() }];
      patchEvent(ev.id, { requests });
      const who = getMember(g.session.actorId)?.displayName ?? "Someone";
      const when = ev.startAt ? formatForHousehold(ev.startAt, g.session.householdId) : "no date set";
      const title = kind === "attend" ? `${who} would like to join "${ev.title}"`
        : kind === "drive" ? `${who} offered to drive for "${ev.title}"`
        : `${who} suggests bringing ${item} to "${ev.title}"`;
      addNotification({
        householdId: g.session.householdId, actorId: owner, channel: "in_app",
        title, body: `${when} — accept or decline in the event.`,
        data: { type: "event", id: ev.id }, to: null,
      });
      void pushToMember({
        householdId: g.session.householdId, actorId: owner,
        title, body: `${when} — accept or decline in FamiliOS.`,
        data: { type: "event", id: ev.id },
      }).catch(() => {});
      audit({ type: `event.${eventAsk[2].replace(/-/g, "_")}`, eventId: ev.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true, pending: true, requests }, req);
    }
    const eventRespond = path.match(/^\/api\/events\/([^/]+)\/requests\/respond$/);
    if (eventRespond && method === "POST") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const ev = getEvent(eventRespond[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      /* ownerId/createdBy below can disagree with who OWNS a hidden event (a synced event
       * belongs to its calendar's owner), so the hide is checked first, by eventOwnerOf. */
      { const hidden = hiddenEventRefusal(ev, g.session); if (hidden) return json(res, hidden.status, { error: hidden.error, message: hidden.message }, req); }
      // Only the owner answers — the same boundary as everywhere else in Cluster D.
      if (ev.ownerId !== g.session.actorId && ev.createdBy !== g.session.actorId) {
        return json(res, 403, { error: "not_event_owner", message: "Only the person whose event this is can answer requests on it." }, req);
      }
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const kind = ["attend", "drive", "bring"].includes(body.kind) ? body.kind : null;
      const actorId = String(body.actorId ?? "");
      if (!kind || !actorId) return json(res, 400, { error: "bad_request", message: "kind and actorId are required." }, req);
      const requests = { attend: [], drive: [], bring: [], ...(ev.requests ?? {}) };
      const entry = requests[kind].find((r) => r.actorId === actorId && (kind !== "bring" || !body.item || r.item === body.item));
      if (!entry) return json(res, 404, { error: "no_such_request" }, req);
      requests[kind] = requests[kind].filter((r) => r !== entry);
      const accept = body.accept === true;
      let patch = { requests };
      if (accept && kind === "attend") {
        const ids = [...new Set([...(ev.participantIds ?? []), actorId])];
        const prior = new Map((ev.attendees ?? []).map((a) => [a.memberId, a]));
        // They asked to come, so their answer is already known — "accepted", not "invited".
        patch = { ...patch, participantIds: ids, attendees: ids.map((m) => prior.get(m) ?? { memberId: m, status: m === actorId ? "accepted" : "invited", respondedAt: m === actorId ? new Date().toISOString() : null }) };
      }
      if (accept && kind === "drive") patch = { ...patch, driverId: actorId };
      if (accept && kind === "bring") patch = { ...patch, whatToBring: [...(ev.whatToBring ?? []), { item: entry.item, memberId: actorId }] };
      const updated = patchEvent(ev.id, patch);
      const verb = kind === "attend" ? (accept ? "You're on" : "Couldn't add you to")
        : kind === "drive" ? (accept ? "You're driving for" : "They've got driving covered for")
        : (accept ? `They'll bring ${entry.item} to` : `No need for ${entry.item} at`);
      addNotification({
        householdId: g.session.householdId, actorId, channel: "in_app",
        title: `${verb} "${ev.title}"`, body: accept ? "See you there." : "Thanks for offering.",
        data: { type: "event", id: ev.id }, to: null,
      });
      void pushToMember({
        householdId: g.session.householdId, actorId,
        title: `${verb} "${ev.title}"`, body: accept ? "See you there." : "Thanks for offering.",
        data: { type: "event", id: ev.id },
      }).catch(() => {});
      audit({ type: "event.request_responded", eventId: ev.id, kind, requester: actorId, accept, ok: true }, req, g.session);
      return json(res, 200, { event: updated }, req);
    }
    const eventOne = path.match(/^\/api\/events\/([^/]+)$/);
    if (eventOne && (method === "PATCH" || method === "POST")) {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const ev = getEvent(eventOne[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      // Seeing it is the only entry requirement — what you may WRITE is decided below,
      // where owner and viewer take different doors.
      if (!canSeeEntity(ev, g.session)) return json(res, 403, { error: "forbidden" }, req);
      /* A hidden event (ADR-005) is its owner's alone — including the viewer's-margin door
       * below: someone shown only "<Name> working" must not keep notes on the meeting
       * underneath it, and a private note would also prove the event exists. */
      { const hidden = hiddenEventRefusal(ev, g.session); if (hidden) return json(res, hidden.status, { error: hidden.error, message: hidden.message }, req); }
      // Three-layer calendar: canonical (FamiliOS-owned) events are always editable.
      // Linked events that originated in a connected Google Calendar are editable
      // TWO-WAY: the edit is written to Google first, then mirrored locally, so the
      // source of truth (Google) moves with us. ICS-fed linked/public events remain
      // read-only mirrors — editing them would blur source-of-truth, so we refuse
      // and tell the client to copy.
      // Edit-own-only: a linked Google event is two-way editable ONLY by the member who
      // connected that Google account. Another member's synced event (or an ICS mirror)
      // is read-only here — you can see it and it syncs, but you can't edit or push it.
      const linkedGoogle = ev.layer === "linked" && isEditableLinkedGoogle(ev, g.session.householdId, g.session.actorId);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      // never reassign identity/ownership-of-record. shareState and secret are the owner's
      // hide/surprise choice and have ONE door, POST /api/events/sharing (adult owner only);
      // privacy and block are per-viewer decorations GET adds, never stored — a client that
      // echoes the record back must not write them onto it.
      const { id, householdId, createdBy, createdAt, ifUpdatedAt, shareState, secret, privacy, block, ...patch } = body;
      // ISS-105: the same guard on edit — a bad stamp here would make an event that
      // renders today silently vanish from every day view.
      if (badTimestamp(patch.startAt)) return json(res, 400, { error: "invalid_startAt", message: "That start date/time isn't a valid timestamp." }, req);
      if (badTimestamp(patch.endAt)) return json(res, 400, { error: "invalid_endAt", message: "That end date/time isn't a valid timestamp." }, req);
      if (ifUpdatedAt && ev.updatedAt && ifUpdatedAt !== ev.updatedAt) {
        return json(res, 409, { error: "stale_write", message: "This event changed on another device — refresh and try again.", current: ev }, req);
      }
      if ("remindOffsets" in patch && patch.remindOffsets !== undefined && !isValidReminderList(patch.remindOffsets)) {
        return json(res, 400, { error: "bad_reminder", message: "Pick reminder times from the offered list." }, req);
      }
      // Moving the start, or changing the reminder set, re-arms the reminders (same rule as tasks).
      if (("startAt" in patch && patch.startAt !== ev.startAt) || ("remindOffsets" in patch && JSON.stringify(patch.remindOffsets) !== JSON.stringify(ev.remindOffsets ?? undefined))) {
        patch.remindersSent = [];
      }
      if ("nestId" in patch || patch.visibility === "nest") {
        const vis = resolveVisibility(patch.visibility, patch.nestId, g.session, ev);
        if (!vis) return json(res, 403, { error: "not_in_nest", message: "You can only move this into a nest you're part of." }, req);
        patch.visibility = vis.visibility; patch.nestId = vis.nestId;
      } else if ("visibility" in patch && patch.visibility !== "nest") patch.nestId = null;
      /* Cluster D — the fork. "This is his item and I should not be able to edit any of the
       * information under schedule or the title of the event… The only part that I should be
       * able to add is this section — just for me."
       *
       * Not the event's owner (and not the member whose Google account this mirror is
       * two-way linked to)? Then exactly two fields exist for you, and both are YOURS:
       * your private note and your private bring list. They live in the per-viewer store,
       * never on the shared record, so nothing you type here can appear on the owner's
       * card — which is precisely the leak the video demonstrates twice.
       *
       * Everything else is refused BY NAME rather than dropped. A request that half-works
       * silently is how "I edited G-pop's event" becomes something you only discover at his
       * dinner table. Attendance and driving have their own doors (request-attend,
       * offer-drive), and the refusal points at them. */
      /* Two different kinds of "not yours":
       *
       *   A MEMBER's event — Melissa's dance run, GPop's bike ride, her synced Google
       *   calendar. ownerId names a real member, and Cluster D applies in full: that
       *   member alone edits, everyone else keeps margins and knocks.
       *
       *   The HOUSEHOLD's event — a school-district ICS feed, a church calendar. No member
       *   owns "Early dismissal"; its FamiliOS half (who from this family is going, what to
       *   bring, a pickup note) is collective, so any adult may append to it — the Q2
       *   behaviour, still wanted. The source's half stays refused below either way. */
      const ownerMember = ev.ownerId ? getMember(ev.ownerId) : null;
      const isEventOwner = ownerMember
        ? (ev.ownerId === g.session.actorId || linkedGoogle)
        : (ev.createdBy === g.session.actorId || linkedGoogle || isAdultRole(g.session.role));
      if (!isEventOwner) {
        // A child's margin is a nice idea for another day; today children are read-only
        // outside their own things (Cluster Z), and this preserves that boundary.
        if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "forbidden" }, req);
        const VIEWER_FIELDS = new Set(["localNotes", "myBring"]);
        const refused = Object.keys(patch).filter((k) => patch[k] !== undefined && !VIEWER_FIELDS.has(k));
        if (refused.length > 0) {
          const ownerName = getMember(ev.ownerId ?? ev.createdBy)?.displayName ?? "its owner";
          return json(res, 403, {
            error: "not_event_owner", fields: refused,
            message: `This is ${ownerName}'s event — only they can change its ${andList(refused.map(fieldLabel))}. Your "just for me" notes are still yours, and you can request to attend or offer to drive.`,
          }, req);
        }
        const myNotes = putViewerNote({ eventId: ev.id, actorId: g.session.actorId, note: patch.localNotes, bring: patch.myBring });
        audit({ type: "event.viewer_note", eventId: ev.id, ok: true }, req, g.session);
        // viewerOnly: nothing on the shared record moved, and the client should say so.
        return json(res, 200, { event: { ...ev, myNotes }, localOnly: true, viewerOnly: true }, req);
      }
      /* Q2 — "it says edit at the source or copy it on the web app. Let me append to it
       * here in FamiliOS without syncing it back out."
       *
       * A mirrored event has two halves. The calendar it came from owns WHEN and WHERE it
       * is — change those here and the next sync silently overwrites you, or worse, doesn't,
       * and this household is reading a different event from everyone else on that invite.
       * But who's going, what to bring, the reminder, the pickup note — the source calendar
       * has never heard of those. They're FamiliOS's own, the sync never writes them, and
       * there is no reason to refuse them.
       *
       * So refuse the source's half by name and take the rest, instead of turning away the
       * whole edit and telling him to go use a different app. */
      if (ev.layer && ev.layer !== "canonical" && !linkedGoogle) {
        const claimed = Object.keys(patch).filter((k) => SOURCE_OWNED_FIELDS.has(k) && patch[k] !== undefined);
        if (claimed.length > 0) {
          return json(res, 409, {
            error: "read_only_layer", fields: claimed,
            message: `This event comes from a calendar outside FamiliOS, so its ${andList(claimed.map(fieldLabel))} can only change there. Anything you add here — your notes, who's going, what to bring, a reminder — stays in FamiliOS.`,
          }, req);
        }
        const updated = patchEvent(ev.id, patch);
        audit({ type: "event.append", eventId: ev.id, fields: Object.keys(patch), ok: true }, req, g.session);
        kickCalendarRefresh(g.session.householdId, "event.update");
        // localOnly is the honest part: nothing left this app.
        return json(res, 200, { event: updated, localOnly: true }, req);
      }
      if (linkedGoogle) {
        // Google-owned fields only — participants/checklists etc. stay FamiliOS-local
        // concepts and are patched on the mirror without touching Google.
        const { title, startAt, endAt, location, notes, ...localOnly } = patch;
        const gPatch = Object.fromEntries(Object.entries({ title, startAt, endAt, location, notes }).filter(([, v]) => v !== undefined));
        if (Object.keys(gPatch).length > 0) {
          if (!externalActionsEnabled(g.session.householdId)) return json(res, 423, { error: "external_actions_disabled" }, req);
          const r = await editLinkedGoogleEvent({ ev, patch: gPatch, householdId: g.session.householdId, actorId: g.session.actorId });
          audit({ type: "event.update", eventId: ev.id, ok: r.ok, target: "google-linked", ...(r.ok ? {} : { error: r.error }) }, req, g.session);
          if (!r.ok) return json(res, 422, { error: r.error, message: r.message ?? "Couldn't update the event in Google Calendar." }, req);
        }
        const updated = Object.keys(localOnly).length > 0 ? patchEvent(ev.id, localOnly) : getEvent(ev.id);
        kickCalendarRefresh(g.session.householdId, "event.update");
        return json(res, 200, { event: updated }, req);
      }
      const updated = patchEvent(ev.id, patch);
      audit({ type: "event.update", eventId: ev.id, ok: true }, req, g.session);
      // After the write, never before: the refresh then sees (and, via the sweep's two-way
      // pass, carries) the change. Fire-and-forget — the response does not wait on Google.
      kickCalendarRefresh(g.session.householdId, "event.update");
      // Auto-sync: a local edit to a Google-linked event mirrors to Google immediately
      // (server-triggered, no approval) when the household enabled calendar auto-sync.
      if (getSettings(g.session.householdId).calendarAutoSync === true && updated.provenance?.googleEventId && externalActionsEnabled(g.session.householdId)) {
        void pushEventToGoogle({ ev: updated, householdId: g.session.householdId, actorId: g.session.actorId })
          .then((r) => appendAudit({ type: "calendar.autopush", eventId: updated.id, ok: r.ok, ...(r.ok ? { action: r.action } : { error: r.error }) }))
          .catch(() => {});
      }
      return json(res, 200, { event: updated }, req);
    }
    if (eventOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const ev = getEvent(eventOne[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      // Before the adult test: being an adult (even the household Owner) is no way into
      // someone else's hidden event (ADR-005).
      { const hidden = hiddenEventRefusal(ev, g.session); if (hidden) return json(res, hidden.status, { error: hidden.error, message: hidden.message }, req); }
      if (!isAdultRole(g.session.role) && ev.ownerId !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
      // Edit-own-only: a linked event you didn't connect is read-only — refuse rather than
      // delete the local mirror (which would just re-import on the next sync anyway).
      if (ev.layer && ev.layer !== "canonical" && !isEditableLinkedGoogle(ev, g.session.householdId, g.session.actorId)) {
        return json(res, 409, { error: "read_only_layer", message: "This event is synced from another calendar and can't be deleted here." }, req);
      }
      // Google-linked events delete two-way (Google first, then the local mirror) —
      // deleting only the mirror would just re-import on the next subscription sync.
      if (ev.layer === "linked" && isEditableLinkedGoogle(ev, g.session.householdId, g.session.actorId)) {
        if (!externalActionsEnabled(g.session.householdId)) return json(res, 423, { error: "external_actions_disabled" }, req);
        const r = await deleteLinkedGoogleEvent({ ev, householdId: g.session.householdId, actorId: g.session.actorId });
        audit({ type: "event.delete", eventId: ev.id, ok: r.ok, target: "google-linked", ...(r.ok ? {} : { error: r.error }) }, req, g.session);
        if (!r.ok) return json(res, 422, { error: r.error, message: r.message ?? "Couldn't delete the event in Google Calendar." }, req);
        kickCalendarRefresh(g.session.householdId, "event.delete");
        return json(res, 200, { ok: true, google: "deleted" }, req);
      }
      // ISS-106: a CANONICAL event that was pushed to Google keeps a googleEventId.
      // Deleting only the local record left the Google copy alive, so the next
      // subscription sync re-imported it — the "deleted events come back" case. (Linked
      // events were already handled above; the meal-delete route already did this for
      // meal events, with the same reasoning.) Awaited rather than fire-and-forget so the
      // response can state the Google outcome instead of implying a clean delete.
      const gCopyId = ev.provenance?.googleEventId ?? null;
      let googleOutcome;
      if (gCopyId) {
        if (!externalActionsEnabled(g.session.householdId)) {
          googleOutcome = "kept_external_actions_disabled";
        } else {
          const r = await deleteGoogleCopy({ ev, householdId: g.session.householdId, actorId: g.session.actorId });
          googleOutcome = r?.ok ? "deleted" : "failed";
        }
        // The copy is still on Google. Without this, the next subscription sync re-imported
        // it as a fresh linked event — the "deleted events come back" loop, still open on
        // every non-happy path. The tombstone makes the sync skip it for 90 days.
        if (googleOutcome !== "deleted") addEventTombstone({ googleEventId: gCopyId, title: ev.title, reason: googleOutcome });
      }
      deleteEventRec(ev.id);
      audit({ type: "event.delete", eventId: ev.id, ok: true, ...(googleOutcome ? { google: googleOutcome } : {}) }, req, g.session);
      kickCalendarRefresh(g.session.householdId, "event.delete");
      return json(res, 200, { ok: true, ...(googleOutcome ? { google: googleOutcome } : {}) }, req);
    }
    /* ---- Task lists as REAL records (Cluster L) ----
     *
     * "It appears that after you delete the last task on a given list, the actual list
     *  disappears. That should not be the case — that list name should persist until the
     *  user decides they would like to click and delete it."
     *
     * Lists used to be a mirage: derived from the tasks' listName strings, so an empty list
     * was indistinguishable from no list, and deleting one was impossible because there was
     * nothing to delete. This registry makes the list itself the durable thing. Tasks keep
     * their listName field — the registry ADDS existence, it doesn't re-key anything, so
     * every pre-existing task still lands in its list. */
    if (path === "/api/task-lists" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const all = listTaskLists(g.session.householdId).filter((l) => canSeeEntity(l, g.session));
      return json(res, 200, { lists: all }, req);
    }
    if (path === "/api/task-lists" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const name = String(body.name ?? "").trim();
      if (!name) return json(res, 400, { error: "name_required" }, req);
      const vis = resolveVisibility(body.visibility, body.nestId, g.session);
      if (!vis) return json(res, 403, { error: "not_in_nest", message: "You can only put a list in a nest you're part of." }, req);
      // One list per name per room — a second "Groceries" in the same room is a typo, not a list.
      const dup = listTaskLists(g.session.householdId).some((l) =>
        l.name.toLowerCase() === name.toLowerCase() && l.visibility === vis.visibility && (l.nestId ?? null) === (vis.nestId ?? null));
      if (dup) return json(res, 409, { error: "list_exists" }, req);
      const rec = addTaskList({
        id: "tl_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        name, ...vis, createdBy: g.session.actorId, createdAt: new Date().toISOString(),
      });
      audit({ type: "tasklist.create", listId: rec.id, name, ok: true }, req, g.session);
      kickCalendarRefresh(g.session.householdId, "tasklist.create");
      return json(res, 200, { list: rec }, req);
    }
    const taskListOne = path.match(/^\/api\/task-lists\/([^/]+)$/);
    if (taskListOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const l = listTaskLists(g.session.householdId).find((x) => x.id === taskListOne[1]);
      // A list you can't see is a list that doesn't exist for you — 404, not 403, or a
      // probed id would confirm there's a private list behind it.
      if (!l || !canSeeEntity(l, g.session)) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && l.createdBy !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
      markTaskListDeleted(l.id);
      // The list's tasks go WITH it — a deleted list whose items linger under "All" would be
      // the vanish-into-another-room bug inverted. Said in the audit, counted in the reply.
      const doomed = listTasks((t) => t.householdId === g.session.householdId && t.type === "list" && t.listName === l.name && (t.visibility ?? "household") === l.visibility && (t.nestId ?? null) === (l.nestId ?? null));
      for (const t of doomed) deleteTaskRec(t.id);
      audit({ type: "tasklist.delete", listId: l.id, name: l.name, tasksRemoved: doomed.length, ok: true }, req, g.session);
      kickCalendarRefresh(g.session.householdId, "tasklist.delete");
      return json(res, 200, { ok: true, tasksRemoved: doomed.length }, req);
    }
    /* GET /api/tasks is a DECLARED READ (server/actions/reads.mjs), answered by
     * handleActionRoutes at the top of this chain. */
    /* POST /api/tasks is a DECLARED action (server/actions/tasks.mjs), answered by
     * handleActionRoutes at the top of this chain with via:"user" — the same run the
     * homeops.create_task tool uses. action-routes-tasks.test.mjs forbids a copy here. */
    const taskOne = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskOne && (method === "PATCH" || method === "POST")) {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const tk = getTask(taskOne[1]);
      if (!tk || tk.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(tk, g.session)) return json(res, 403, { error: "forbidden" }, req);
      // A child may complete a task assigned to them; broader edits need an adult/owner.
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const onlyStatus = Object.keys(body).every((k) => ["status", "ifUpdatedAt"].includes(k));
      const mayEdit = isAdultRole(g.session.role) || tk.createdBy === g.session.actorId || (onlyStatus && tk.assignedMemberId === g.session.actorId);
      if (!mayEdit) return json(res, 403, { error: "forbidden" }, req);
      const { id, householdId, createdBy, createdAt, ifUpdatedAt, ...patch } = body;
      if (ifUpdatedAt && tk.updatedAt && ifUpdatedAt !== tk.updatedAt) {
        return json(res, 409, { error: "stale_write", message: "This task changed on another device — refresh and try again.", current: tk }, req);
      }
      for (const k of ["startAt", "endAt", "dueAt"]) {
        if (k in patch && badTimestamp(patch[k])) return json(res, 400, { error: "bad_timestamp", message: `"${k}" isn't a valid date and time.` }, req);
      }
      if ("remindMinutesBefore" in patch && !isValidReminder(patch.remindMinutesBefore)) {
        return json(res, 400, { error: "bad_reminder" }, req);
      }
      if ("remindOffsets" in patch && !isValidReminderList(patch.remindOffsets)) {
        return json(res, 400, { error: "bad_reminder", message: "Pick reminder times from the offered list." }, req);
      }
      // Moving the time, or changing the lead, must RE-ARM the reminder — otherwise a task
      // pushed from Tuesday to Friday keeps a spent stamp and silently never nudges again.
      const timingChanged = ["startAt", "dueAt", "remindMinutesBefore", "remindOffsets"].some((k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(tk[k]));
      if (timingChanged) { patch.reminderSentAt = null; patch.remindersSent = []; }
      /* Cluster M — done is a MOMENT, so it gets a stamp; the archive sweep measures three
       * days from here. Reopening clears it (and un-archives), because a task pulled back
       * into play is in play. */
      if (patch.status === "done" && tk.status !== "done") patch.completedAt = new Date().toISOString();
      if (patch.status && patch.status !== "done" && patch.status !== "archived" && (tk.status === "done" || tk.status === "archived")) patch.completedAt = null;
      /* T1 — a task may be moved into a nest you're in, or back out of one (unlike a chat: a
       * task is a line you wrote, not a history other people would suddenly be able to read).
       * What's refused is naming a nest you're NOT in, which would otherwise be a way to
       * push an item into a private space you can't see. */
      if ("nestId" in patch || patch.visibility === "nest") {
        const target = patch.nestId ?? tk.nestId;
        if (patch.visibility === "nest" || target) {
          if (!canSeeNest(String(target ?? ""), g.session.householdId, g.session.actorId)) {
            return json(res, 403, { error: "not_in_nest", message: "You can only move this into a nest you're part of." }, req);
          }
          patch.visibility = "nest"; patch.nestId = String(target);
        }
      }
      if ("visibility" in patch && patch.visibility !== "nest") patch.nestId = null; // leaving a nest scope clears the pointer
      const updated = patchTask(tk.id, patch);
      // A task pushed to the calendar (to-calendar) is a real two-way link; renaming or moving
      // the task used to leave its event at the old title and time.
      const mirrorKeys = ["title", "startAt", "endAt", "dueAt", "notes"].filter((k) => k in patch);
      if (mirrorKeys.length) {
        const linked = listEvents((e) => e.householdId === g.session.householdId && (e.taskId === tk.id || (tk.eventId && e.id === tk.eventId)))[0];
        const startAt = updated.startAt || updated.dueAt;
        if (linked && startAt) {
          const ev2 = patchEvent(linked.id, { title: updated.title, startAt, endAt: updated.endAt ?? null, notes: updated.notes ?? "" });
          if (getSettings(g.session.householdId).calendarAutoSync === true && ev2.provenance?.googleEventId && externalActionsEnabled(g.session.householdId)) {
            void pushEventToGoogle({ ev: ev2, householdId: g.session.householdId, actorId: updated.assignedMemberId || g.session.actorId })
              .then((r) => appendAudit({ type: "calendar.autopush", eventId: ev2.id, ok: r.ok, ...(r.ok ? { action: r.action } : { error: r.error }) })).catch(() => {});
          }
        }
      }
      audit({ type: "task.update", taskId: tk.id, ok: true }, req, g.session);
      kickCalendarRefresh(g.session.householdId, "task.update");
      return json(res, 200, { task: updated }, req);
    }
    if (taskOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const tk = getTask(taskOne[1]);
      if (!tk || tk.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && tk.createdBy !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
      deleteTaskRec(tk.id);
      // The task's calendar mirror goes with it — including the pushed Google copy, best
      // effort — exactly as a meal's does. Deleting only the task left a phantom event.
      const linkedEvents = listEvents((e) => e.householdId === g.session.householdId && (e.taskId === tk.id || (tk.eventId && e.id === tk.eventId)));
      for (const e of linkedEvents) {
        if (e.provenance?.googleEventId && externalActionsEnabled(g.session.householdId)) {
          void deleteGoogleCopy({ ev: e, householdId: g.session.householdId, actorId: g.session.actorId })
            .then((r) => { appendAudit({ type: "calendar.googledelete", eventId: e.id, ok: r.ok }); if (!r.ok) addEventTombstone({ googleEventId: e.provenance.googleEventId, title: e.title, reason: "task_delete_google_failed" }); })
            .catch(() => {});
        }
        deleteEventRec(e.id);
      }
      audit({ type: "task.delete", taskId: tk.id, removedEvents: linkedEvents.length, ok: true }, req, g.session);
      kickCalendarRefresh(g.session.householdId, "task.delete");
      return json(res, 200, { ok: true, removedEvents: linkedEvents.length }, req);
    }

    // H7 [23:18] — "when a task has a date it should append to the calendar, and push to
    // that person's Google account." Same back-reference pattern as meals: linked by taskId,
    // idempotent (re-adding updates the linked event rather than duplicating it), and once
    // it's a canonical event the existing approval-gated push sends it to Google. The
    // ASSIGNEE is the event's owner, because "that person's Google account" is the ask —
    // pushing a chore assigned to Beannie into my calendar helps nobody.
    const taskCal = path.match(/^\/api\/tasks\/([^/]+)\/to-calendar$/);
    if (taskCal && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const tk = getTask(taskCal[1]);
      if (!tk || tk.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(tk, g.session)) return json(res, 403, { error: "forbidden" }, req);
      const startAt = tk.startAt || tk.dueAt;
      if (!startAt) return json(res, 400, { error: "date_required", message: "Give the task a date before adding it to the calendar." }, req);
      const owner = tk.assignedMemberId || tk.createdBy || g.session.actorId;
      const fields = {
        title: tk.title,
        startAt,
        endAt: tk.endAt ?? null,
        notes: tk.notes ?? "",
      };
      const existing = listEvents((e) => e.householdId === g.session.householdId && e.taskId === tk.id)[0];
      if (existing) {
        const updated = patchEvent(existing.id, fields);
        if (getSettings(g.session.householdId).calendarAutoSync === true && updated.provenance?.googleEventId && externalActionsEnabled(g.session.householdId)) {
          void pushEventToGoogle({ ev: updated, householdId: g.session.householdId, actorId: owner })
            .then((r) => appendAudit({ type: "calendar.autopush", eventId: updated.id, ok: r.ok, ...(r.ok ? { action: r.action } : { error: r.error }) })).catch(() => {});
        }
        audit({ type: "task.to_calendar", taskId: tk.id, eventId: existing.id, action: "updated", ok: true }, req, g.session);
        kickCalendarRefresh(g.session.householdId, "task.to-calendar");
        return json(res, 200, { ok: true, event: updated, action: "updated" }, req);
      }
      const ev = putEvent(newEventRecord({
        ...fields, allDay: false, spaceId: tk.spaceId ?? "sp-family",
        participantIds: tk.assignedMemberId ? [tk.assignedMemberId] : [],
        ownerId: owner, taskId: tk.id, visibility: tk.visibility ?? "household", category: "Task",
        provenance: { via: "task", actorId: g.session.actorId },
      }, g.session));
      patchTask(tk.id, { eventId: ev.id });   // so the task row can say it's on the calendar
      audit({ type: "task.to_calendar", taskId: tk.id, eventId: ev.id, action: "created", ok: true }, req, g.session);
      kickCalendarRefresh(g.session.householdId, "task.to-calendar");
      return json(res, 200, { ok: true, event: ev, action: "created" }, req);
    }

    /* ---- Help requests: "can you help?" asks between members ----
     * ANY signed-in member may ask (children and grandparents included — asking for
     * help must never need a role); only the recipient can answer; the requester or
     * an adult can cancel while pending. Notifications go to the two people involved
     * (in-app record + targeted push), never the whole household. */
    /* ---- Family messages: threads between members (server/family-messages.mjs) ---- */
    if (path === "/api/threads" || path.startsWith("/api/threads/")) {
      const handled = await handleFamilyMessageRoutes({ req, res, path, method, url, gate, json, readBody, audit });
      if (handled) return;
    }
    if (path === "/api/help-requests" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const mine = listHelpRequests((h) => h.householdId === g.session.householdId)
        .filter((h) => h.fromActorId === g.session.actorId || h.toActorId === g.session.actorId || isAdultRole(g.session.role))
        .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
        // Direction: legacy rows have no `kind` — they were all "ask" (a requester asking
        // a helper). "offer" is a member offering to help with the RECIPIENT's item.
        .map((h) => ({ ...h, kind: h.kind === "offer" ? "offer" : "ask" }));
      return json(res, 200, { helpRequests: mine }, req);
    }
    if (path === "/api/help-requests" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      // One function for the route and for a chat suggestion (server/help-requests.mjs).
      const out = createHelpRequest({ session: g.session, toActorId: body.toActorId, message: body.message, kind: body.kind, eventId: body.eventId ?? null, taskId: body.taskId ?? null });
      if (!out.ok) return json(res, out.status, { error: out.error, message: out.message, ...(out.helpRequest ? { helpRequest: out.helpRequest } : {}) }, req);
      audit({ type: "help.request", helpRequestId: out.helpRequest.id, toActorId: out.helpRequest.toActorId, kind: out.helpRequest.kind, ok: true }, req, g.session);
      return json(res, 200, { helpRequest: out.helpRequest }, req);
    }
    const helpRespond = path.match(/^\/api\/help-requests\/([^/]+)\/respond$/);
    if (helpRespond && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const hr = getHelpRequest(helpRespond[1]);
      if (!hr || hr.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (hr.toActorId !== g.session.actorId) return json(res, 403, { error: "forbidden", message: "Only the person who was asked can answer this request." }, req);
      if (hr.status !== "pending") return json(res, 409, { error: "already_answered", helpRequest: hr }, req);
      const body = (await readBody(req)) ?? {};
      if (!["accept", "decline"].includes(body.response)) return json(res, 400, { error: "bad_response", message: 'response must be "accept" or "decline".' }, req);
      const status = body.response === "accept" ? "accepted" : "declined";
      const responseNote = String(body.note ?? "").trim().slice(0, 500) || null;
      const updated = patchHelpRequest(hr.id, { status, responseNote, respondedAt: new Date().toISOString() });
      // WP-001 (ISS-001): accepting help with a linked task TRANSFERS the task.
      // ask   → the helper is the recipient (hr.toActorId, the acceptor);
      // offer → the helper is the offerer (hr.fromActorId).
      // A missing/deleted task is reported honestly as reassigned:false — never faked.
      let reassignedTask = null;
      if (status === "accepted" && hr.taskId) {
        const linked = getTask(hr.taskId);
        if (linked && linked.householdId === g.session.householdId) {
          const helperId = hr.kind === "offer" ? hr.fromActorId : hr.toActorId;
          reassignedTask = patchTask(linked.id, { assignedMemberId: helperId });
        }
      }
      // A proposal made in a chat ("ask Beannie to drive to speech therapy?") is applied on a
      // yes — the event takes the driver or the extra participant — and both people hear the
      // outcome where the question was asked: in the thread, as lines from FamiliOS.
      let applied = null;
      if (hr.proposal?.threadId) {
        try {
          const ev = hr.proposal.eventId ? getEvent(hr.proposal.eventId) : null;
          /* A hidden event (ADR-005) is named in the thread by its block — "Beannie working" —
           * whoever is reading, because a thread line is read by everyone in the thread, not
           * by its owner alone. And it is changed only on its owner's word: the owner asked,
           * or the owner is the one saying yes. */
          const hid = ev ? obscureStateOf(ev, eventPrivacyContext(ev.householdId)) : null;
          const ownerAgreed = !hid?.obscured || hid.ownerId === hr.fromActorId || hid.ownerId === g.session.actorId;
          if (status === "accepted" && ev && ev.householdId === g.session.householdId && hr.proposal.patch && ownerAgreed) {
            const pp = hr.proposal.patch;
            const patch = {};
            if (pp.driverId) patch.driverId = String(pp.driverId);
            if (pp.participantId && !(ev.participantIds ?? []).includes(String(pp.participantId))) patch.participantIds = [...(ev.participantIds ?? []), String(pp.participantId)];
            if (Object.keys(patch).length) { patchEvent(ev.id, { ...patch, updatedAt: new Date().toISOString() }); applied = { eventId: ev.id, ...patch }; }
          }
          const what = ev ? `“${hid?.obscured ? obscuredLabel(hid.kind, hid.owner) : ev.title}”${ev.startAt ?` (${formatForHousehold(ev.startAt, g.session.householdId)})` : ""}` : `“${hr.message}”`;
          const line = status === "accepted"
            ? (applied ? `${hr.toName} accepted — calendar updated: ${applied.driverId ? `${hr.toName} is driving to` : `${hr.toName} is going to`} ${what}, now on ${hr.toName}'s upcoming events.` : `${hr.toName} accepted: ${what}.`)
            : `${hr.toName} declined: ${what}${responseNote ? ` — ${responseNote}` : ""}.`;
          await postFamilyMessage({ threadId: hr.proposal.threadId, fromActorId: g.session.actorId, kind: "system", text: line });
        } catch { /* the answer is recorded either way */ }
      }
      // Copy tracks direction: the notified party is always the creator (hr.fromActorId).
      // ask → "X accepted your request"; offer → "X accepted your help offer".
      const noun = hr.kind === "offer" ? "help offer" : "request";
      const title = hr.kind === "offer" ? `Help offer ${status}` : `Request ${status}`;
      const note = responseNote ? ` — ${responseNote}` : "";
      addNotification({ householdId: g.session.householdId, actorId: hr.fromActorId, channel: "in_app", title, body: `${hr.toName} ${status} your ${noun}${note}` });
      void pushToMember({ householdId: g.session.householdId, actorId: hr.fromActorId, title, body: `${hr.toName} ${status} your ${noun}${note}`, data: { type: "help_request", id: hr.id } });
      audit({ type: "help.respond", helpRequestId: hr.id, status, reassigned: !!reassignedTask, ...(reassignedTask ? { taskId: reassignedTask.id, assignedMemberId: reassignedTask.assignedMemberId } : {}), ok: true }, req, g.session);
      return json(res, 200, { helpRequest: updated, reassigned: !!reassignedTask, ...(reassignedTask ? { task: reassignedTask } : {}), ...(applied ? { applied } : {}) }, req);
    }
    const helpCancel = path.match(/^\/api\/help-requests\/([^/]+)\/cancel$/);
    if (helpCancel && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const hr = getHelpRequest(helpCancel[1]);
      if (!hr || hr.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (hr.fromActorId !== g.session.actorId && !isAdultRole(g.session.role)) return json(res, 403, { error: "forbidden" }, req);
      if (hr.status !== "pending") return json(res, 409, { error: "already_answered", helpRequest: hr }, req);
      const updated = patchHelpRequest(hr.id, { status: "cancelled" });
      audit({ type: "help.cancel", helpRequestId: hr.id, ok: true }, req, g.session);
      return json(res, 200, { helpRequest: updated }, req);
    }

    /* ---- Meal plan (family meals) — household/visibility scoped; Limited Member+ writes.
     * Grocery items reuse tasks (type:"list", listName:"Groceries"). ---- */
    /* GET /api/meals and POST /api/meals are DECLARED (server/actions/meals.mjs), answered by
     * handleActionRoutes at the top of this chain; syncMealGroceries moved there with them
     * and is imported above for the PATCH route below. */
    const mealOne = path.match(/^\/api\/meals\/([^/]+)$/);
    if (mealOne && (method === "PATCH" || method === "POST")) {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const m = getMeal(mealOne[1]);
      if (!m || m.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(m, g.session) || (!isAdultRole(g.session.role) && m.createdBy !== g.session.actorId)) return json(res, 403, { error: "forbidden" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const { id, householdId, createdBy, createdAt, ifUpdatedAt, ...patch } = body;
      // Optional optimistic-concurrency guard: two devices editing the same
      // record no longer silently clobber each other — the stale one gets a 409
      // and refetches. Opt-in field, so existing clients are unaffected.
      if (ifUpdatedAt && m.updatedAt && ifUpdatedAt !== m.updatedAt) {
        return json(res, 409, { error: "stale_write", message: "This was changed on another device — refresh and try again.", current: m }, req);
      }
      if (Array.isArray(patch.ingredients)) {
        patch.ingredients = patch.ingredients.map((i) => (typeof i === "string" ? { item: i, have: false } : { item: String(i?.item ?? ""), have: !!i?.have })).filter((i) => i.item);
      }
      const updated = patchMeal(m.id, patch);
      // The edit path was a bare patchMeal: move a meal to Saturday and its calendar event
      // stayed on Thursday with the old title; add an ingredient and the grocery list never
      // heard. Same cascade the create and to-calendar routes already do.
      const groceriesAdded = "ingredients" in patch ? syncMealGroceries(updated, g.session).added : 0;
      let eventSynced = false;
      const affectsEvent = ["date", "slot", "time", "title", "notes", "ingredients", "instructions", "servings", "recipeUrl"].some((k) => k in patch);
      if (affectsEvent) {
        const linked = listEvents((e) => e.householdId === g.session.householdId && e.mealId === m.id)[0];
        if (linked && updated.date) {
          const ev2 = patchEvent(linked.id, mealEventFields(updated, householdTimeZone(g.session.householdId)));
          eventSynced = true;
          if (getSettings(g.session.householdId).calendarAutoSync === true && ev2.provenance?.googleEventId && externalActionsEnabled(g.session.householdId)) {
            void pushEventToGoogle({ ev: ev2, householdId: g.session.householdId, actorId: g.session.actorId })
              .then((r) => appendAudit({ type: "calendar.autopush", eventId: ev2.id, ok: r.ok, ...(r.ok ? { action: r.action } : { error: r.error }) })).catch(() => {});
          }
        }
      }
      audit({ type: "meal.update", mealId: m.id, groceriesAdded, eventSynced, ok: true }, req, g.session);
      return json(res, 200, { meal: updated, groceriesAdded, eventSynced }, req);
    }
    if (mealOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const m = getMeal(mealOne[1]);
      if (!m || m.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && m.createdBy !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
      // Grocery items carry a real mealId back-reference. Default: unlink (a
      // still-wanted item survives its source meal). With ?groceries=delete the
      // caller opted to remove the meal's ingredients from the list too.
      const dropGroceries = url.searchParams.get("groceries") === "delete";
      let removedGroceries = 0;
      if (dropGroceries) {
        for (const t of listTasks((t) => t.householdId === g.session.householdId && t.mealId === m.id)) { deleteTaskRec(t.id); removedGroceries++; }
      }
      // The meal, its calendar event (with the pushed Google copy, best-effort — without
      // that the next subscription sync would resurrect it) and the unlink of whatever
      // is still on the list: the one cascade plan_meal's replace and famili.delete_meal
      // also run.
      const retired = await retireMeal(m, g.session, { mode: "delete" });
      audit({ type: "meal.delete", mealId: m.id, removedEvents: retired.eventsRemoved, removedGroceries, unlinkedGroceries: retired.groceryItemsUnlinked, ok: true }, req, g.session);
      return json(res, 200, { ok: true, removedEvents: retired.eventsRemoved, removedGroceries, unlinkedGroceries: retired.groceryItemsUnlinked }, req);
    }
    const mealGrocery = path.match(/^\/api\/meals\/([^/]+)\/to-grocery$/);
    if (mealGrocery && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const m = getMeal(mealGrocery[1]);
      if (!m || m.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      /* Shares ONE implementation with the automatic add on meal create (syncMealGroceries).
       * This route used to add unconditionally, so once creating a meal also added its
       * ingredients, pressing this button put a second "beans" on the list. Two code paths
       * writing the same list will always drift; now there is one, and it dedupes.
       *
       * Which makes this button a RE-SYNC rather than an add: press it after editing a meal
       * and only genuinely new ingredients appear. Adding nothing is the correct, common
       * answer, and `added: 0` says so honestly. */
      const added = syncMealGroceries(m, g.session).added;
      audit({ type: "meal.to_grocery", mealId: m.id, added, ok: true }, req, g.session);
      return json(res, 200, { ok: true, added }, req);
    }
    // Push a meal onto the household calendar as a CANONICAL event (item 5). Linked by
    // mealId (same back-reference pattern as groceries); idempotent — re-pushing updates
    // the linked event instead of duplicating it. Once it exists as a canonical event,
    // the existing approval-gated POST /api/calendar/push/:id sends it to Google.
    const mealCal = path.match(/^\/api\/meals\/([^/]+)\/to-calendar$/);
    if (mealCal && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const m = getMeal(mealCal[1]);
      if (!m || m.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!m.date) return json(res, 400, { error: "date_required", message: "Give the meal a date before adding it to the calendar." }, req);
      // Title, a real instant on the household's clock, and the full meal context (recipe
      // link, ingredients, instructions) as the body, so the SAME details land in Google
      // Calendar's description — composed once, in mealEventFields, for every writer.
      const fields = mealEventFields(m, householdTimeZone(g.session.householdId));
      const existing = listEvents((e) => e.householdId === g.session.householdId && e.mealId === m.id)[0];
      if (existing) {
        const updated = patchEvent(existing.id, fields);
        if (getSettings(g.session.householdId).calendarAutoSync === true && updated.provenance?.googleEventId && externalActionsEnabled(g.session.householdId)) {
          void pushEventToGoogle({ ev: updated, householdId: g.session.householdId, actorId: g.session.actorId })
            .then((r) => appendAudit({ type: "calendar.autopush", eventId: updated.id, ok: r.ok, ...(r.ok ? { action: r.action } : { error: r.error }) })).catch(() => {});
        }
        audit({ type: "meal.to_calendar", mealId: m.id, eventId: existing.id, action: "updated", ok: true }, req, g.session);
        return json(res, 200, { ok: true, event: updated, action: "updated" }, req);
      }
      const ev = putEvent(newEventRecord({
        ...fields, ownerId: g.session.actorId, mealId: m.id,
        visibility: m.visibility ?? "household",
        provenance: { via: "meal", actorId: g.session.actorId },
      }, g.session));
      audit({ type: "meal.to_calendar", mealId: m.id, eventId: ev.id, action: "created", ok: true }, req, g.session);
      return json(res, 200, { ok: true, event: ev, action: "created" }, req);
    }

    /* ---- Knowledge (KN): user-authored household knowledge ----
     * A real CRUD collection the family owns (custom instructions, family facts,
     * preferences, rules, reference notes) — distinct from auto-generated memory.
     * Mirrors meals: Limited Member+ creates; adult OR the creator edits/deletes;
     * "personal" items are visible only to the creator + adults. Tenant-scoped. */
    if (path === "/api/knowledge" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      /* "The actual logic of who sees what needs to extend throughout the app."
       *
       * This used to be its own rule: `personal` meant the creator OR ANY ADULT — behind a
       * chip that says "Just me" and a badge with a padlock on it. So a note you marked
       * private was readable by every adult in the household, and every OTHER reader of a
       * knowledge item (which went through canSeeEntity, where `personal` isn't a word)
       * fell through to the household default and showed it to everyone.
       *
       * One gate now, the same one tasks and files use, so "Just me" means the same thing
       * everywhere it's offered — including nest scope, which knowledge simply couldn't
       * express before. */
      const items = listKnowledge((k) => k.householdId === g.session.householdId)
        .filter((k) => canSeeEntity(k, g.session))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return json(res, 200, { items }, req);
    }
    if (path === "/api/knowledge" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!String(body.title ?? "").trim()) return json(res, 400, { error: "title_required" }, req);
      // Same three scopes as a task, same refusal for a nest you're not in.
      const knVis = resolveVisibility(body.visibility, body.nestId, g.session);
      if (!knVis) return json(res, 403, { error: "not_in_nest", message: "You can only save this into a nest you're part of." }, req);
      const item = addKnowledge({
        id: "kn_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        title: String(body.title).trim(),
        // `type` is a free string (client uses "Custom Instruction","Family Fact","Preference","Rule","Reference Note").
        type: typeof body.type === "string" && body.type.trim() ? body.type.trim() : "Reference Note",
        content: typeof body.content === "string" ? body.content : "",
        tags: Array.isArray(body.tags) ? body.tags.map(String).filter(Boolean).slice(0, 20) : [],
        ...knVis,
        sensitive: !!body.sensitive,
        fileIds: Array.isArray(body.fileIds) ? body.fileIds.map(String).slice(0, 50) : [],
        createdBy: g.session.actorId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      audit({ type: "knowledge.create", knowledgeId: item.id, ok: true }, req, g.session);
      return json(res, 200, { item }, req);
    }
    const knowledgeOne = path.match(/^\/api\/knowledge\/([^/]+)$/);
    if (knowledgeOne && (method === "PATCH" || method === "POST")) {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const k = getKnowledge(knowledgeOne[1]);
      if (!k || k.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && k.createdBy !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const { ifUpdatedAt } = body;
      // Optional optimistic-concurrency guard (same as meals): a stale write 409s and refetches.
      if (ifUpdatedAt && k.updatedAt && ifUpdatedAt !== k.updatedAt) {
        return json(res, 409, { error: "stale_write", message: "This was changed on another device — refresh and try again.", current: k }, req);
      }
      // Never trust the client for id/household/createdBy/timestamps — build the patch from writable fields only.
      const patch = {};
      if (body.title !== undefined) { const t = String(body.title).trim(); if (!t) return json(res, 400, { error: "title_required" }, req); patch.title = t; }
      if (body.type !== undefined) patch.type = typeof body.type === "string" && body.type.trim() ? body.type.trim() : k.type;
      if (body.content !== undefined) patch.content = typeof body.content === "string" ? body.content : "";
      if (body.tags !== undefined) patch.tags = Array.isArray(body.tags) ? body.tags.map(String).filter(Boolean).slice(0, 20) : [];
      if (body.visibility !== undefined || body.nestId !== undefined) {
        const v = resolveVisibility(body.visibility, body.nestId, g.session, k);
        if (!v) return json(res, 403, { error: "not_in_nest", message: "You can only move this into a nest you're part of." }, req);
        patch.visibility = v.visibility; patch.nestId = v.nestId;
      }
      if (body.sensitive !== undefined) patch.sensitive = !!body.sensitive;
      if (body.fileIds !== undefined) patch.fileIds = Array.isArray(body.fileIds) ? body.fileIds.map(String).slice(0, 50) : [];
      const updated = patchKnowledge(k.id, patch);
      audit({ type: "knowledge.update", knowledgeId: k.id, ok: true }, req, g.session);
      return json(res, 200, { item: updated }, req);
    }
    if (knowledgeOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const k = getKnowledge(knowledgeOne[1]);
      if (!k || k.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && k.createdBy !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
      removeKnowledge(k.id);
      audit({ type: "knowledge.delete", knowledgeId: k.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }

    /* ---- Calendar subscriptions (CAL): the read-only "linked" calendar layer ----
     * Subscribe to an .ics feed (school/sports/holidays) or paste an .ics. Synced events
     * are layer:"linked" (the events PATCH route already refuses edits — copy to edit).
     * Who may add, sync, change or remove which calendar is the Connections matrix in
     * calendar-permissions.mjs; every route below asks it, and every subscription leaves
     * through subscriptionView. Reads are household-scoped: everyone gets the legend. */
    if (path === "/api/calendar/subscriptions" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const all = listSubscriptions((s) => s.householdId === g.session.householdId);
      const subs = all.map((s) => subscriptionView(s, g.session));
      // What the Add button may offer, so the client never shows a door the server shuts.
      // Same count as the add routes: calendars they own AND added themselves (ADR-005 decision 3).
      const ownedCount = all.filter((s) => subscriptionOwnerId(s, s.accountId ? getAccountRaw(s.accountId) : null) === g.session.actorId && (s.createdBy ?? null) === g.session.actorId).length;
      const self = canAddCalendar(viewerOf(g.session), { forMember: null, ownedCount });
      const canAdd = {
        self: self.ok,
        limitReached: !self.ok && self.error === "calendar_limit",
        forMembers: g.session.role === "Owner"
          ? listMembers({ householdId: g.session.householdId }).filter((m) => !m.archived && m.actorId !== g.session.actorId).map((m) => m.actorId)
          : [],
      };
      return json(res, 200, { subscriptions: subs, canAdd }, req);
    }
    /* Refresh the WHOLE household's calendars (server/calendar-refresh.mjs). Any signed-in
     * member may ask — a child opening the app included — because asking is safe: the
     * engine syncs each calendar as its owner, runs one refresh per household at a time and
     * at most once a minute. gate() on a POST still demands CSRF from cookie clients.
     * { wait:true } waits (up to 8 s) and answers with the summary, or { pending:true } if
     * it is still going; otherwise the refresh is started and the answer is immediate. */
    if (path === "/api/calendar/refresh" && method === "POST") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = (await readBody(req)) ?? {};
      const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason : "manual";
      if (body.wait === true) return json(res, 200, await awaitCalendarRefresh(g.session.householdId, { reason }), req);
      kickCalendarRefresh(g.session.householdId, reason);
      return json(res, 200, { ok: true, pending: true }, req);
    }
    // Kept for old app builds (build-79 iOS calls this every 60 s): an alias of the refresh
    // above, open to any signed-in member, never forced past the one-minute floor, and
    // answering in its original shape — zeros when the floor skipped it or it is still running.
    if (path === "/api/calendar/sync-all" && method === "POST") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const r = await awaitCalendarRefresh(g.session.householdId, { reason: "sync-all" });
      const ran = r.ok && !r.skipped && !r.pending && r.synced != null;
      const pulled = ran ? r.pulled : { checked: 0, merged: 0, conflicts: 0, unlinked: 0 };
      return json(res, 200, {
        ok: true,
        synced: ran ? r.synced : 0, imported: ran ? r.imported : 0, updated: ran ? r.updated : 0, removed: ran ? r.removed : 0,
        pulled: { checked: pulled.checked, merged: pulled.merged, conflicts: pulled.conflicts, unlinked: pulled.unlinked },
        errors: ran ? r.errors : [],
      }, req);
    }
    if (path === "/api/calendar/subscriptions" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const add = resolveCalendarAddTarget(g.session, body);
      if (!add.ok) return json(res, add.status, add.body, req);
      if (!String(body.url ?? "").trim()) return json(res, 400, { error: "url_required" }, req);
      // webcal:// is only the "open in a calendar app" spelling of an https feed (Apple and
      // Google both hand these out); fetch cannot speak it, so store what it means.
      const url = String(body.url).trim().replace(/^webcals?:\/\//i, "https://");
      const sub = putSubscription({
        id: "sub_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        name: String(body.name ?? "Subscribed calendar").slice(0, 80), url, source: "url",
        color: nextSubscriptionColor(g.session.householdId),
        ownerActorId: add.target, isWork: false,
        createdBy: g.session.actorId, createdAt: Date.now(), updatedAt: new Date().toISOString(),
      });
      const r = await syncSubscription({ sub, session: g.session });
      patchSubscription(sub.id, { lastSyncAt: Date.now(), lastResult: r.ok ? { imported: r.imported, updated: r.updated, removed: r.removed } : { error: r.error }, eventCount: r.ok ? r.total : 0 });
      if (r.ok) restampSubscriptionEvents(sub, add.target); // events are the owner's, not the adder's
      audit({ type: "calendar.subscribe", subscriptionId: sub.id, forMemberId: add.target !== g.session.actorId ? add.target : undefined, ok: r.ok, error: r.ok ? undefined : r.error }, req, g.session);
      return json(res, r.ok ? 200 : 422, { subscription: subscriptionView(getSubscription(sub.id), g.session), sync: r }, req);
    }
    // Push a FamiliOS canonical event TO Google Calendar (the write half of two-way sync).
    // Approval-first (writing to your real calendar needs sign-off) + deduped: a stored
    // provenance.googleEventId turns re-pushes into updates. Linked (synced) events can't be
    // pushed back. The live Google write goes through apiForAccount (auto-refresh).
    const pushMatch = path.match(/^\/api\/calendar\/push\/([^/]+)$/);
    if (pushMatch && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Adult Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = (await readBody(req)) ?? {};
      const ev = getEvent(pushMatch[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(ev, g.session)) return json(res, 403, { error: "forbidden" }, req);
      { const hidden = hiddenEventRefusal(ev, g.session); if (hidden) return json(res, hidden.status, { error: hidden.error, message: hidden.message }, req); }
      if (ev.layer && ev.layer !== "canonical") return json(res, 400, { error: "not_pushable", message: "This event is synced from another calendar — only your own FamiliOS events can be pushed to Google." }, req);
      if (!ev.startAt) return json(res, 400, { error: "no_start", message: "Give the event a start time before pushing it." }, req);
      const account = listAccountsFor(g.session.householdId, g.session.actorId).find((a) => a.provider === "google");
      if (!account) return json(res, 422, { error: "connect_google_first", message: "Connect your Google account (with calendar access) in Connections first." }, req);
      if (!(account.scopes ?? []).some((s) => /calendar/i.test(String(s)))) return json(res, 422, { error: "calendar_scope_missing", message: "Reconnect Google and grant calendar access." }, req);
      const input = { summary: ev.title, start: ev.startAt, location: ev.location ?? "" };
      const gid = ev.provenance?.googleEventId ?? null;
      // Approval-first by default. When the household turned on calendar auto-sync,
      // Google pushes are pre-authorized (an explicit Adult Admin setting) and the
      // gate is skipped — the audit log still records every write.
      const autoSync = getSettings(g.session.householdId).calendarAutoSync === true;
      if (!autoSync) {
        if (!body.approvalId) {
          const a = createApproval({ actorId: g.session.actorId, householdId: g.session.householdId, connectorId: "google", toolId: "calendar.create", input, risk: "Medium", category: "Calendar", preview: `${gid ? "Update" : "Add"} “${ev.title}” ${gid ? "on" : "to"} Google Calendar`, source: "executable" });
          void notifyApproval(a);
          return json(res, 200, { needsApproval: true, approval: publicApproval(a) }, req);
        }
        const c = consumeApproval({ id: body.approvalId, actorId: g.session.actorId, householdId: g.session.householdId, toolId: "calendar.create", input });
        if (c.error) { audit({ type: "calendar.push", eventId: ev.id, ok: false, error: c.error }, req, g.session); return json(res, 422, { error: c.error, message: approvalErrorMessage(c.error) }, req); }
      }
      const r = await pushEventToGoogle({ ev, householdId: g.session.householdId, actorId: g.session.actorId });
      if (!r.ok) { audit({ type: "calendar.push", eventId: ev.id, ok: false, error: r.error, status: r.status }, req, g.session); return json(res, 422, { error: r.error, status: r.status, message: r.message ?? "Google rejected the write." }, req); }
      audit({ type: "calendar.push", eventId: ev.id, googleEventId: r.googleEventId, action: r.action, autoSync, ok: true }, req, g.session);
      return json(res, 200, { ok: true, googleEventId: r.googleEventId, action: r.action }, req);
    }
    // Two-way sync, merge-back half (Phase 9): pull Google-side edits into pushed canonical
    // events. Clean Google edits merge; both-sides-changed flags provenance.conflict for
    // review (never silently overwritten); Google deletions unlink (FamiliOS stays canonical).
    if (path === "/api/calendar/pull-google-edits" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Adult Member")) return json(res, 403, { error: "insufficient_role" }, req);
      // This member's own pushed events only, each checked with the account it lives in.
      const r = await pullGoogleEdits({ householdId: g.session.householdId, actorId: g.session.actorId });
      audit({ type: "calendar.pull_edits", ok: r.ok, ...(r.ok ? { checked: r.checked, merged: r.merged, conflicts: r.conflicts, unlinked: r.unlinked, errors: r.errors } : { error: r.error }) }, req, g.session);
      if (!r.ok) return json(res, 422, { error: r.error, message: r.error === "no_account" ? "Connect your Google account (with calendar access) in Connections first." : undefined }, req);
      return json(res, 200, r, req);
    }
    // Resolve a flagged pull conflict (provenance.conflict) — the human decision the
    // merge-back engine defers to. choice:"google" adopts Google's version; choice:"local"
    // keeps FamiliOS' fields (re-push to sync Google). Either way the flag clears and the
    // merge baseline resets so the next pull doesn't re-flag the same difference.
    const resolveMatch = path.match(/^\/api\/events\/([^/]+)\/resolve-conflict$/);
    if (resolveMatch && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Adult Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = (await readBody(req)) ?? {};
      const ev = getEvent(resolveMatch[1]);
      if (!ev || ev.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!canSeeEntity(ev, g.session)) return json(res, 403, { error: "forbidden" }, req);
      { const hidden = hiddenEventRefusal(ev, g.session); if (hidden) return json(res, hidden.status, { error: hidden.error, message: hidden.message }, req); }
      const patch = resolveConflictPatch(ev, body.choice);
      if (!patch) return json(res, 400, { error: ev.provenance?.conflict ? "bad_choice" : "no_conflict", message: ev.provenance?.conflict ? 'choice must be "google" or "local".' : "This event has no pending sync conflict." }, req);
      const updated = patchEvent(ev.id, patch);
      audit({ type: "calendar.resolve_conflict", eventId: ev.id, choice: body.choice, ok: true }, req, g.session);
      kickCalendarRefresh(g.session.householdId, "event.resolve-conflict");
      return json(res, 200, { ok: true, event: updated }, req);
    }
    // Connect the actor's Google Calendar as a read-only linked source (pull sync). Needs a
    // Google account connected in Connections with calendar access. One subscription per
    // account — repeat calls just re-sync. Push (FamiliOS → Google) is a separate build.
    if (path === "/api/calendar/connect-google" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = (await readBody(req)) ?? {};
      // Role / owner_only / bad_member first, cap later: re-connecting an account that already
      // has its calendar is a re-sync, and must not be refused as "a second calendar".
      const pre = resolveCalendarAddTarget(g.session, body, { countCap: false });
      if (!pre.ok) return json(res, pre.status, pre.body, req);
      // Which of the CALLER's own Google accounts (a member may have a personal and a work
      // one). Never another member's: their tokens are theirs to point at a calendar.
      const mine = listAccountsFor(g.session.householdId, g.session.actorId).filter((a) => a.provider === "google");
      let account;
      if (body.accountId != null && String(body.accountId) !== "") {
        account = mine.find((a) => a.id === String(body.accountId));
        if (!account) return json(res, 400, { error: "bad_account", message: "That isn't one of your connected Google accounts." }, req);
      } else account = mine[0];
      if (!account) return json(res, 422, { error: "connect_google_first", message: "Connect your Google account (with calendar access) in Connections first." }, req);
      if (!(account.scopes ?? []).some((s) => /calendar/i.test(String(s)))) return json(res, 422, { error: "calendar_scope_missing", message: "Your Google account isn't authorized for calendar. Reconnect it and grant calendar access." }, req);
      let sub = listSubscriptions((s) => s.householdId === g.session.householdId && s.source === "google" && s.accountId === account.id)[0];
      if (!sub) {
        const add = resolveCalendarAddTarget(g.session, body);
        if (!add.ok) return json(res, add.status, add.body, req);
        sub = putSubscription({
          id: "sub_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
          name: `Google Calendar (${account.displayName ?? "primary"})`, url: null, source: "google", accountId: account.id,
          color: nextSubscriptionColor(g.session.householdId),
          ownerActorId: add.target, isWork: false,
          createdBy: g.session.actorId, createdAt: Date.now(), updatedAt: new Date().toISOString(),
        });
      }
      const r = await syncSubscription({ sub, session: g.session });
      patchSubscription(sub.id, { lastSyncAt: Date.now(), lastResult: r.ok ? { imported: r.imported, updated: r.updated, removed: r.removed } : { error: r.error }, eventCount: r.ok ? r.total : (sub.eventCount ?? 0) });
      if (r.ok) restampSubscriptionEvents(sub, subscriptionOwnerOf(sub).ownerActorId);
      audit({ type: "calendar.connect_google", subscriptionId: sub.id, ok: r.ok, error: r.ok ? undefined : r.error }, req, g.session);
      return json(res, r.ok ? 200 : 422, { subscription: subscriptionView(getSubscription(sub.id), g.session), sync: r }, req);
    }
    // Paste-import an .ics one-off (no URL); still grouped under a subscription so it's removable.
    if (path === "/api/calendar/import-ics" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const add = resolveCalendarAddTarget(g.session, body);
      if (!add.ok) return json(res, add.status, add.body, req);
      if (!String(body.ics ?? "").trim()) return json(res, 400, { error: "ics_required" }, req);
      const sub = putSubscription({
        id: "sub_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId,
        name: String(body.name ?? "Imported calendar").slice(0, 80), url: null, source: "import",
        color: nextSubscriptionColor(g.session.householdId),
        icsText: String(body.ics).slice(0, 200_000), // kept so a re-sync can re-parse the pasted feed
        ownerActorId: add.target, isWork: false,
        createdBy: g.session.actorId, createdAt: Date.now(), updatedAt: new Date().toISOString(),
      });
      const r = await syncSubscription({ sub, icsText: String(body.ics), session: g.session });
      if (!r.ok) { deleteSubscriptionRec(sub.id); return json(res, 422, { error: r.error, message: "That didn't look like a valid calendar file." }, req); }
      patchSubscription(sub.id, { lastSyncAt: Date.now(), lastResult: { imported: r.imported, updated: r.updated }, eventCount: r.total });
      restampSubscriptionEvents(sub, add.target);
      audit({ type: "calendar.import", subscriptionId: sub.id, imported: r.imported, forMemberId: add.target !== g.session.actorId ? add.target : undefined, ok: true }, req, g.session);
      return json(res, 200, { subscription: subscriptionView(getSubscription(sub.id), g.session), sync: r }, req);
    }
    const subSync = path.match(/^\/api\/calendar\/subscriptions\/([^/]+)\/sync$/);
    if (subSync && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const sub = getSubscription(subSync[1]);
      if (!sub || sub.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      /* Cluster Y — "there should be no availability to sync or remove a calendar that was
       * not added through their login." Now expressed as the Connections matrix: members
       * sync their own, an Admin anything but the Owner's, the Owner anything. (A refresh of
       * the WHOLE household — anyone may ask — is /api/calendar/sync-all, not this.) */
      const { owner } = subscriptionOwnerOf(sub);
      if (!calendarCan(viewerOf(g.session), sub, owner).sync) {
        return json(res, 403, { error: "not_your_calendar", message: calendarRefusal("sync", sub, owner) }, req);
      }
      const r = await syncSubscription({ sub, session: g.session });
      patchSubscription(sub.id, { lastSyncAt: Date.now(), lastResult: r.ok ? { imported: r.imported, updated: r.updated, removed: r.removed } : { error: r.error }, eventCount: r.ok ? r.total : (sub.eventCount ?? 0) });
      if (r.ok && owner) restampSubscriptionEvents(sub, owner.actorId); // whoever pressed Sync, the events stay the owner's
      audit({ type: "calendar.sync", subscriptionId: sub.id, ok: r.ok, error: r.ok ? undefined : r.error }, req, g.session);
      return json(res, r.ok ? 200 : 422, { subscription: subscriptionView(getSubscription(sub.id), g.session), sync: r }, req);
    }
    const subOne = path.match(/^\/api\/calendar\/subscriptions\/([^/]+)$/);
    // Rename or recolour a calendar, mark it as work, or say whose it is. "Imported calendar"
    // is not a name a family recognises, and an ICS feed has no account to tell us whose
    // events these are. Each field needs its own flag from the matrix (edit / markWork /
    // assign), and the request is all-or-nothing: a refused field refuses the whole patch,
    // so a client never half-applies a form.
    if (subOne && method === "PATCH") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const sub = getSubscription(subOne[1]);
      if (!sub || sub.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const { owner, ownerActorId: currentOwnerId } = subscriptionOwnerOf(sub);
      const can = calendarCan(viewerOf(g.session), sub, owner);
      const refuse = (action, who = owner) => json(res, 403, { error: "not_your_calendar", message: calendarRefusal(action, sub, who) }, req);
      const patch = {};
      if (typeof body.name === "string") {
        if (!can.edit) return refuse("edit");
        const name = body.name.trim().slice(0, 80);
        if (!name) return json(res, 400, { error: "name_required" }, req);
        patch.name = name;
      }
      if (body.color !== undefined) {
        if (!can.edit) return refuse("edit");
        if (!SUB_COLORS.includes(body.color)) return json(res, 400, { error: "bad_color", message: `Pick one of: ${SUB_COLORS.join(", ")}.` }, req);
        patch.color = body.color;
      }
      let newOwner = null;
      // The iOS edit sheet (build 79 and earlier) sends ownerActorId on EVERY save, unchanged —
      // naming the current owner again is not a reassignment, so it needs no assign right.
      if (body.ownerActorId !== undefined && String(body.ownerActorId ?? "") !== String(currentOwnerId ?? "")) {
        if (!can.assign) return refuse("assign");
        // Every calendar has exactly one owner — the matrix has nothing to say about a
        // calendar that belongs to no one, so "unassign" is no longer a state it can enter.
        if (body.ownerActorId === null || body.ownerActorId === "") return json(res, 400, { error: "owner_required", message: "Every calendar belongs to someone — pick who this one is for." }, req);
        const m = getMember(String(body.ownerActorId));
        if (!m || m.householdId !== g.session.householdId || m.archived) return json(res, 400, { error: "bad_member" }, req);
        patch.ownerActorId = m.actorId;
        newOwner = m;
        // "Work" is an adult's thing (their employer's calendar); handing it to a child or a
        // limited member drops the flag rather than leaving a child with a work calendar.
        if (!ADULT_ROLES.includes(m.role)) patch.isWork = false;
      }
      if (body.isWork !== undefined) {
        // Judged against the owner the calendar will HAVE, so "give this to Morgan and mark it
        // work" is one request, and "give it to Lily and mark it work" is refused outright.
        const whoWillOwn = newOwner ? { actorId: newOwner.actorId, role: newOwner.role, displayName: newOwner.displayName ?? null } : owner;
        const effective = newOwner ? calendarCan(viewerOf(g.session), sub, whoWillOwn) : can;
        if (!effective.markWork) return refuse("markWork", whoWillOwn);
        if (typeof body.isWork !== "boolean") return json(res, 400, { error: "bad_is_work", message: "isWork must be true or false." }, req);
        patch.isWork = body.isWork;
      }
      if (!Object.keys(patch).length) return json(res, 400, { error: "nothing_to_change" }, req);
      const next = patchSubscription(sub.id, patch);
      // Every event this calendar already imported takes the new owner on the spot (colour,
      // free/busy, who may see it) rather than at the next sync — ownerId AND createdBy,
      // because canSeeEntity reads either as ownership.
      const restamped = newOwner ? restampSubscriptionEvents(next, newOwner.actorId, "reassign") : 0;
      audit({ type: "calendar.subscription_update", subscriptionId: sub.id, fields: Object.keys(patch), restamped, ok: true }, req, g.session);
      return json(res, 200, { subscription: subscriptionView(next, g.session), restamped }, req);
    }
    if (subOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const sub = getSubscription(subOne[1]);
      if (!sub || sub.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      // Cluster Y — removing someone else's calendar removes THEIR events from the family's
      // view. Who may: its owner (Adult Member and up), an Admin for non-adults' calendars,
      // the Owner for any. A Limited Member asks the Owner.
      const { owner } = subscriptionOwnerOf(sub);
      if (!calendarCan(viewerOf(g.session), sub, owner).remove) {
        return json(res, 403, { error: "not_your_calendar", message: calendarRefusal("remove", sub, owner) }, req);
      }
      const removed = removeSubscriptionEvents(sub.id, g.session);
      deleteSubscriptionRec(sub.id);
      audit({ type: "calendar.unsubscribe", subscriptionId: sub.id, removedEvents: removed, ok: true }, req, g.session);
      return json(res, 200, { ok: true, removedEvents: removed }, req);
    }

    /* ---- Server-durable assistant conversations (P1.1) ----
     * Threads/messages live server-side, scoped to the actor who owns them. */
    if (path === "/api/conversations" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const mine = listConversations((c) => canSeeConversation(c, g.session))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return json(res, 200, { conversations: mine }, req);
    }
    if (path === "/api/conversations" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const c = putConversation({
        id: "conv_" + crypto.randomBytes(8).toString("hex"), householdId: g.session.householdId, actorId: g.session.actorId,
        // The client seeds this with the truncated first message; titleAuto marks it as a
        // placeholder the namer is allowed to replace (I1).
        title: String(body.title ?? "New chat").slice(0, 80), titleAuto: true, messages: [],
        // An Adult Member's chats are their own — see the silo note. Forced here rather than
        // trusted from the body, so a mis-set toggle can never publish a private thread.
        /* A chat can live in a nest — "it would say Personal, and then GPop + Beannie as its
         * own group, the way it does for the whole household where it says personal or
         * family". Membership is verified here; naming a nest you are not in does not put you
         * in it. An Adult Member is still barred from the HOUSEHOLD space (the silo), but a
         * nest is theirs by consent, so it is open to them. */
        ...(body.visibility === "nest" && body.nestId && canSeeNest(String(body.nestId), g.session.householdId, g.session.actorId)
          ? { visibility: "nest", nestId: String(body.nestId) }
          /* Cluster R/Z — "there should be NO personal chat if AI chat is turned on for the
           * child accounts. It should just be their nest or their family." A child's chats
           * are readable by their adults BY DESIGN — coerced here, not merely hidden in the
           * picker, because a clamp that lives client-side is a clamp the next screen
           * forgets. Everyone else keeps personal as the safe default. */
          : g.session.role === "Child View"
            ? { visibility: "household" }
            : { visibility: (body.visibility === "household" && !isAdultMemberOnly(g.session)) ? "household" : "personal" }),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      return json(res, 200, { conversation: c }, req);
    }
    const convOne = path.match(/^\/api\/conversations\/([^/]+)$/);
    if (convOne && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const c = getConversation(convOne[1]);
      if (!canSeeConversation(c, g.session)) return json(res, 404, { error: "not_found" }, req);
      return json(res, 200, { conversation: c }, req);
    }
    // I1 — renaming a thread by hand pins the name: titleAuto:false stops the auto-namer
    // from ever overwriting a title a person chose deliberately.
    // I3 — and the same route moves a thread between Personal and Family, which was
    // previously only possible by starting a new chat.
    if (convOne && method === "PATCH") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const c = getConversation(convOne[1]);
      if (!canSeeConversation(c, g.session)) return json(res, 404, { error: "not_found" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const patch = {};
      if (body.title !== undefined) {
        const title = String(body.title).trim();
        if (!title) return json(res, 400, { error: "title_required" }, req);
        patch.title = title.slice(0, 80);
        patch.titleAuto = false;
      }
      /* I3 [16:45] — "from inside a chat I can't switch between Personal and Family without
       * starting a new one. That's not the correct path."
       *
       * Moving a thread between spaces is a real visibility change, so only its OWNER may do
       * it: making a personal thread family-visible publishes everything already in it, and
       * that is not a decision for anyone else to take on your behalf. */
      if (body.visibility !== undefined) {
        if (c.actorId !== g.session.actorId) {
          return json(res, 403, { error: "forbidden", message: "Only the person who started this chat can move it between Personal and Family." }, req);
        }
        if (body.visibility === "household" && isAdultMemberOnly(g.session)) {
          return json(res, 403, { error: "personal_only", message: "Your chats stay private to you. Sharing one with the household needs an Owner or Adult Admin." }, req);
        }
        patch.visibility = body.visibility === "household" ? "household" : "personal";
      }
      if (Object.keys(patch).length === 0) return json(res, 400, { error: "nothing_to_change" }, req);
      const next = putConversation({ ...c, ...patch, updatedAt: new Date().toISOString() });
      audit({ type: "conversation.update", conversationId: c.id, changed: Object.keys(patch), ok: true }, req, g.session);
      return json(res, 200, { conversation: next }, req);
    }
    if (convOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const c = getConversation(convOne[1]);
      if (!canSeeConversation(c, g.session)) return json(res, 404, { error: "not_found" }, req);
      if (c.actorId !== g.session.actorId && !isAdultRole(g.session.role)) return json(res, 403, { error: "forbidden" }, req);
      deleteConversationRec(c.id);
      return json(res, 200, { ok: true }, req);
    }
    // Append a run-result note to a conversation the actor owns. This is how a
    // finished plan run reports back INTO the chat it was launched from (web +
    // iOS both use it), so results/artifacts live in the thread durably instead
    // of only on the Activity screen.
    const convMsg = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (convMsg && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const c = getConversation(convMsg[1]);
      if (!canSeeConversation(c, g.session)) return json(res, 404, { error: "not_found" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const text = String(body.text ?? "").trim();
      if (!text) return json(res, 400, { error: "text_required" }, req);
      c.messages.push({
        role: "assistant", text: text.slice(0, 8000), at: new Date().toISOString(),
        kind: body.kind === "run_result" ? "run_result" : "note",
        ...(body.runId ? { runId: String(body.runId).slice(0, 64) } : {}),
      });
      c.updatedAt = new Date().toISOString();
      putConversation(c);
      return json(res, 200, { conversation: c }, req);
    }

    /* ---- Memory & artifacts (read; written by runs) — household-scoped ---- */
    if (path === "/api/memory" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      /* Personal memory belongs to its author ALONE. The adult bypass that used to sit
       * here was the knowledge-items leak wearing a different collection: a fact said in a
       * private chat, readable by every adult in the house. Role is not a way in. Nest
       * memories reach the nest, household memories reach everyone — the same three rooms
       * as everything else since the visibility work. */
      const all = listMemory({ householdId: g.session.householdId, limit: 200 });
      const visible = all.filter((m) => canSeeMemory(m, g.session));
      return json(res, 200, { memory: visible }, req);
    }
    // Archive/delete a memory entry the actor can see (mirrors the GET visibility rule).
    // Safe by construction: memory is a reference record, not a live dependency — see
    // deleteMemoryEntry's comment in store.mjs for why this never breaks baked-in behavior.
    const memOne = path.match(/^\/api\/memory\/([^/]+)$/);
    if (memOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const m = getMemoryEntry(memOne[1]);
      if (!m || m.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      // EXACTLY the GET rule. This used to carry an `|| isAdultRole(...)` bypass the GET had
      // deliberately removed — an adult could delete a personal memory they could not read,
      // and anyone could delete a nest memory outside their nest.
      // canForgetMemory = canSeeMemory, plus one case: a PERSONAL memory whose author is not a
      // live member (an agent, the scheduler, someone who left) is personal to nobody, and an
      // adult may clear it. The assistant's delete tool uses the same predicate — nests.mjs.
      if (!canForgetMemory(m, g.session)) return json(res, 404, { error: "not_found" }, req); // don't leak existence
      deleteMemoryEntry(m.id);
      audit({ type: "memory.delete", memoryId: m.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }
    // WP-007 s5 — retrieval-quality memory search + profile for the Activity & Memory
    // tab's search box. Scoped to the session's own household (containerTag), same
    // visibility boundary as GET /api/memory. Honest degraded flag when the provider
    // (sidecar or its sqlite-FTS5 fallback — see memory-provider.mjs/DEC-014) can't answer,
    // so the client can show real fallback copy instead of silently returning nothing.
    if (path === "/api/memory/search" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const q = String(url.searchParams.get("q") ?? "").trim();
      const containerTag = g.session.householdId;
      const [searchRes, profileRes] = await Promise.all([
        q ? memoryProvider.search(q, { containerTag, limit: 20 }) : Promise.resolve({ ok: true, degraded: false, results: [] }),
        memoryProvider.profile({ containerTag }),
      ]);
      const degraded = !!(searchRes?.degraded || profileRes?.degraded);
      return json(res, 200, {
        ok: true,
        degraded,
        results: Array.isArray(searchRes?.results) ? searchRes.results : [],
        profile: profileRes?.ok ? { totalMemories: profileRes.totalMemories, byType: profileRes.byType, byScope: profileRes.byScope, highlights: profileRes.highlights } : null,
      }, req);
    }
    if (path === "/api/artifacts" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      /* BUG-05 — "there is no privacy with these artifacts… you can see artifacts that were
       * performed in private chats."
       *
       * There wasn't: this returned everything in the household, unfiltered — the only
       * collection that skipped the gate. An artifact is the OUTPUT of a run, and a run
       * remembers the conversation it came from, so the artifact inherits that room's
       * walls: personal chat → its author, nest chat → the nest, family chat → everyone.
       * Resolved at read time rather than stamped at write time so every artifact that
       * already exists is covered retroactively — stamping would have grandfathered the
       * exact leak he demonstrated.
       *
       * Runs with no conversation (scheduled household agents) stay household-visible,
       * which is what they are. The assistant's own context building is unaffected: his
       * ask is that Beannie's ASSISTANT may know about the meal plan while Beannie's
       * LIBRARY doesn't list the artifact. */
      const all = listArtifacts({ householdId: g.session.householdId, runId: url.searchParams.get("runId") || undefined, limit: 200 });
      const visible = all.filter((a) => {
        const run = a.runId ? getRun(a.runId) : null;
        const convId = run?.sourceRef?.conversationId;
        if (!convId) return true;
        const conv = getConversation(convId);
        return !conv || canSeeConversation(conv, g.session);
      }).slice(0, 100);
      return json(res, 200, { artifacts: visible }, req);
    }

    /* ---- Contact methods (server-owned registry) ----
     * Canonical per-member delivery addresses with verified/opt-in state and a
     * per-agent allowlist. Reads are household-scoped (the roster's coordination
     * data — no secrets). Writes are role-gated: adults manage anyone's methods,
     * everyone else manages only their own. Honest states: a new external method
     * starts unverified/Pending and notify refuses it until it's verified;
     * in-app/dashboard methods have no external address to confirm, so they are
     * born verified. Changing an external address resets verification. */
    if (path === "/api/contact-methods" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      /* Cluster W — "As the owner, I should be able to see all contacts and make all
       * modifications necessary. Others should not." Everyone else sees their own methods
       * and their nest's — the same reach as everything since the edit matrix. Contact
       * methods are where notifications go; another adult silently re-pointing YOUR phone
       * number is the household's mail being redirected. */
      const reach = contactReach(g.session);
      const methods = listContactMethods((c) => c.householdId === g.session.householdId && reach(c.memberId));
      return json(res, 200, { contactMethods: methods }, req);
    }
    if (path === "/api/contact-methods" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const memberId = String(body.memberId ?? g.session.actorId).trim();
      if (!contactReach(g.session)(memberId)) return json(res, 403, { error: "outside_your_nest", message: "You can add contact methods for yourself and your nest. The Owner manages everyone's." }, req);
      if (!isAdultRole(g.session.role) && memberId !== g.session.actorId) return json(res, 403, { error: "insufficient_role" }, req);
      const member = getMember(memberId);
      if (!member || member.archived || (member.householdId ?? "local") !== g.session.householdId) return json(res, 404, { error: "member_not_found" }, req);
      const label = String(body.label ?? "").trim();
      if (!label) return json(res, 400, { error: "label_required" }, req);
      if (!CONTACT_METHOD_TYPES.includes(body.type)) return json(res, 400, { error: "bad_type", valid: CONTACT_METHOD_TYPES }, req);
      const fixed = CONTACT_FIXED_VALUES[body.type];
      const value = fixed ?? String(body.value ?? "").trim();
      if (!fixed && !validContactValue(body.type, value)) return json(res, 400, { error: "invalid_value", message: body.type === "Email" ? "Enter a valid email address." : "Enter a valid phone number." }, req);
      // Client→server migration preserves ids (idempotent: an existing id is returned
      // unchanged, mirroring the agents migration contract).
      const suppliedId = typeof body.id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(body.id) ? body.id : null;
      if (suppliedId) {
        const existing = getContactMethod(suppliedId);
        if (existing && existing.householdId === g.session.householdId) return json(res, 200, { contactMethod: existing }, req);
        if (existing) return json(res, 409, { error: "id_conflict" }, req);
      }
      const cm = putContactMethod({
        id: suppliedId ?? ("cm_" + crypto.randomBytes(8).toString("hex")),
        householdId: g.session.householdId, memberId, label, type: body.type, value,
        // Internal channels are deliverable by construction; external ones must be
        // verified first — via the code loop (send-verification/verify). Only an
        // adult may carry over an already-verified state on create (the migration
        // path); a non-adult can never self-attest an address they merely typed.
        verified: fixed ? true : (isAdultRole(g.session.role) && !!body.verified),
        optInStatus: fixed ? "Opted In" : (isAdultRole(g.session.role) && OPT_IN_STATES.includes(body.optInStatus) ? body.optInStatus : "Pending"),
        // SECURITY (finding C3): same adult gate on CREATE — otherwise the whole
        // check above is bypassed by setting the allowlist at creation time.
        allowedAgentIds: (isAdultRole(g.session.role) && Array.isArray(body.allowedAgentIds))
          ? body.allowedAgentIds.filter((a) => typeof a === "string" && (() => { const x = getAgent(a); return x && (x.householdId === g.session.householdId || x.householdId === "local"); })())
          : [],
        createdBy: g.session.actorId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      audit({ type: "contact_method.create", contactMethodId: cm.id, memberId, methodType: cm.type, ok: true }, req, g.session);
      return json(res, 200, { contactMethod: cm }, req);
    }
    /* ---- The true verification loop ----
     * send-verification: a 6-digit code goes out through the method's REAL channel
     * (email via the caller's connected Google, text via the SMS connector). Honest
     * when the channel isn't set up — nothing is sent and the response says so.
     * verify: entering the code proves control of the address → verified + opted-in.
     * One pending challenge per method; 10-minute expiry; 5 attempts; 60s resend
     * cooldown after a successful send. Manage-gated like every other write. */
    const contactSendVerification = path.match(/^\/api\/contact-methods\/([^/]+)\/send-verification$/);
    if (contactSendVerification && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const cm = getContactMethod(contactSendVerification[1]);
      if (!cm || cm.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && cm.memberId !== g.session.actorId) return json(res, 403, { error: "insufficient_role" }, req);
      if (cm.verified) return json(res, 400, { error: "already_verified", message: "This contact method is already verified." }, req);
      if (CONTACT_FIXED_VALUES[cm.type]) return json(res, 400, { error: "not_applicable", message: "In-app methods have no external address to verify." }, req);
      // Resend cooldown only counts sends that actually went out — a needs-setup
      // failure shouldn't lock the user out of retrying right after they fix it.
      const prior = getContactVerification(cm.id);
      if (prior?.delivered && prior.nextSendAt > Date.now()) {
        return json(res, 429, { error: "resend_too_soon", retryInMs: prior.nextSendAt - Date.now(), message: "A code was just sent — wait a moment before requesting another." }, req);
      }
      const code = String(crypto.randomInt(100000, 1000000));
      const out = await sendVerificationCode({ session: g.session, method: cm, code });
      if (!out.ok) {
        deleteContactVerification(cm.id); // no code reached the address; nothing to enter
        audit({ type: "contact_method.verification_sent", contactMethodId: cm.id, channel: out.channel, ok: false, needsSetup: out.needsSetup ?? undefined }, req, g.session);
        return json(res, 200, { ok: false, channel: out.channel, needsSetup: out.needsSetup, message: out.message ?? "Couldn't send the verification code." }, req);
      }
      putContactVerification({
        id: cm.id, householdId: g.session.householdId, code, channel: out.channel, delivered: true,
        attempts: 0, maxAttempts: 5, expiresAt: Date.now() + 10 * 60 * 1000, nextSendAt: Date.now() + 60 * 1000,
        requestedBy: g.session.actorId, createdAt: new Date().toISOString(),
      });
      audit({ type: "contact_method.verification_sent", contactMethodId: cm.id, channel: out.channel, ok: true }, req, g.session);
      return json(res, 200, { ok: true, channel: out.channel, expiresInMs: 10 * 60 * 1000, message: `Code sent to ${cm.value}.` }, req);
    }
    const contactVerify = path.match(/^\/api\/contact-methods\/([^/]+)\/verify$/);
    if (contactVerify && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const cm = getContactMethod(contactVerify[1]);
      if (!cm || cm.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && cm.memberId !== g.session.actorId) return json(res, 403, { error: "insufficient_role" }, req);
      if (cm.verified) return json(res, 200, { ok: true, alreadyVerified: true, contactMethod: cm }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const given = String(body.code ?? "").trim();
      if (!given) return json(res, 400, { error: "code_required" }, req);
      const ch = getContactVerification(cm.id);
      if (!ch) return json(res, 400, { error: "no_pending_verification", message: "No code has been sent — request one first." }, req);
      if (ch.expiresAt < Date.now()) {
        deleteContactVerification(cm.id);
        return json(res, 400, { error: "code_expired", message: "That code expired — request a new one." }, req);
      }
      if (ch.attempts >= ch.maxAttempts) {
        deleteContactVerification(cm.id);
        return json(res, 429, { error: "too_many_attempts", message: "Too many wrong attempts — request a new code." }, req);
      }
      // Constant-time compare; short-lived local codes, but no reason to be sloppy.
      // (Shape-check first — timingSafeEqual throws on unequal lengths.)
      const wellFormed = /^\d{6}$/.test(given);
      if (!wellFormed || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(String(ch.code)))) {
        const updated = patchContactVerification(cm.id, { attempts: ch.attempts + 1 });
        audit({ type: "contact_method.verify", contactMethodId: cm.id, ok: false, error: "code_incorrect" }, req, g.session);
        return json(res, 400, { error: "code_incorrect", attemptsLeft: Math.max(0, ch.maxAttempts - updated.attempts), message: "That code doesn't match." }, req);
      }
      deleteContactVerification(cm.id); // single-use
      const updated = patchContactMethod(cm.id, {
        verified: true, optInStatus: "Opted In",
        verifiedVia: ch.channel, verifiedBy: g.session.actorId, verifiedAt: new Date().toISOString(),
      });
      audit({ type: "contact_method.verify", contactMethodId: cm.id, via: ch.channel, ok: true }, req, g.session);
      return json(res, 200, { ok: true, contactMethod: updated }, req);
    }
    const contactOne = path.match(/^\/api\/contact-methods\/([^/]+)$/);
    if (contactOne && (method === "PATCH" || method === "POST")) {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const cm = getContactMethod(contactOne[1]);
      if (!cm || cm.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!contactReach(g.session)(cm.memberId)) return json(res, 403, { error: "outside_your_nest", message: "You can manage your own contact methods and your nest's. The Owner manages everyone's." }, req);
      // Same gate POST has: reach grants a nest-mate's methods, but rewriting or deleting
      // ANOTHER member's address is an adult act.
      if (!isAdultRole(g.session.role) && cm.memberId !== g.session.actorId) return json(res, 403, { error: "insufficient_role", message: "Only an adult can change another member's contact methods." }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const patch = {};
      if (body.label != null) { const l = String(body.label).trim(); if (!l) return json(res, 400, { error: "label_required" }, req); patch.label = l; }
      if (body.value != null) {
        if (CONTACT_FIXED_VALUES[cm.type]) return json(res, 400, { error: "value_fixed", message: "This method type has no external address to change." }, req);
        const v = String(body.value).trim();
        if (!validContactValue(cm.type, v)) return json(res, 400, { error: "invalid_value" }, req);
        // A changed address is a NEW address — honesty requires re-verification,
        // and any code sent to the OLD address must stop working immediately.
        // SECURITY (adversarial review, finding C2): a changed address is a NEW address,
        // so verification resets — and the PER-AGENT SEND ALLOWLIST must reset with it.
        // Leaving `allowedAgentIds` intact let the method's owner (any role, including
        // Child View) repoint an adult-granted standing consent at an address they
        // control, re-verify via the household's own SMS connector, and receive the
        // family's automated messages at an outside number. Granting an agent send
        // rights is an adult act; re-granting after a repoint must be one too.
        if (v !== cm.value) {
          patch.value = v; patch.verified = false; patch.optInStatus = "Pending"; patch.verifiedVia = null;
          patch.verifiedBy = null; patch.verifiedAt = null; patch.allowedAgentIds = [];
          deleteContactVerification(cm.id);
        }
      }
      if (body.allowedAgentIds != null) {
        if (!Array.isArray(body.allowedAgentIds)) return json(res, 400, { error: "bad_allowed_agents" }, req);
        // SECURITY (adversarial review, finding C3): this allowlist IS the standing
        // consent that lets an agent send to this address unattended, with no per-run
        // approval. It was the only field on this record NOT adult-gated — so a
        // Guest could self-verify an address they control and then grant an agent
        // permission to mail it every morning, with no adult ever involved. It is
        // adult-only, and every id must resolve to an agent in THIS household.
        if (!isAdultRole(g.session.role)) {
          return json(res, 403, { error: "insufficient_role", message: "Allowing a helper to message a contact is an adult decision — ask an adult to grant it." }, req);
        }
        const ids = body.allowedAgentIds.filter((a) => typeof a === "string");
        const bad = ids.filter((id) => { const a = getAgent(id); return !a || (a.householdId !== g.session.householdId && a.householdId !== "local"); });
        if (bad.length) return json(res, 400, { error: "unknown_agent", message: "One of those helpers doesn't exist in this household.", ids: bad }, req);
        patch.allowedAgentIds = ids;
      }
      if (body.verified != null) {
        // The honest path to verified is the code loop (send-verification → verify).
        // Setting it directly is an ADULT-ONLY manual override, recorded as such —
        // a member can no longer self-attest an address by flipping a flag.
        if (body.verified && !isAdultRole(g.session.role)) {
          return json(res, 403, { error: "insufficient_role", message: "Verify with the code sent to this contact method, or ask an adult to override." }, req);
        }
        patch.verified = !!body.verified;
        patch.verifiedVia = body.verified ? "manual" : null;
        if (body.verified) { patch.verifiedBy = g.session.actorId; patch.verifiedAt = new Date().toISOString(); }
      }
      if (body.optInStatus != null) {
        if (!OPT_IN_STATES.includes(body.optInStatus)) return json(res, 400, { error: "bad_opt_in_status", valid: OPT_IN_STATES }, req);
        patch.optInStatus = body.optInStatus;
      }
      const updated = patchContactMethod(cm.id, patch);
      audit({ type: "contact_method.update", contactMethodId: cm.id, verified: updated.verified, ok: true }, req, g.session);
      return json(res, 200, { contactMethod: updated }, req);
    }
    if (contactOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const cm = getContactMethod(contactOne[1]);
      if (!cm || cm.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!contactReach(g.session)(cm.memberId)) return json(res, 403, { error: "outside_your_nest", message: "You can manage your own contact methods and your nest's. The Owner manages everyone's." }, req);
      // Same gate POST has: reach grants a nest-mate's methods, but rewriting or deleting
      // ANOTHER member's address is an adult act.
      if (!isAdultRole(g.session.role) && cm.memberId !== g.session.actorId) return json(res, 403, { error: "insufficient_role", message: "Only an adult can change another member's contact methods." }, req);
      deleteContactMethodRec(cm.id);
      deleteContactVerification(cm.id); // a pending code for a deleted method is dead
      audit({ type: "contact_method.delete", contactMethodId: cm.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }

    /* ---- Notification delivery (item 16b) ----
     * Real routing to a contact method's channel (in-app/dashboard now; email via the
     * caller's connected Google; text via the sms connector). Honest about what needs
     * setup. Email/text use the SESSION actor's own connected account — never someone
     * else's. GET lists the actor's own in-app notifications.
     * Pass methodId to resolve the channel/address from the server-owned registry
     * (verified + opt-in enforced, per-agent allowlist honored); methodType/to stays
     * for ad-hoc sends. */
    if (path === "/api/notify" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const methodType = String(body.methodType ?? body.channel ?? "In-App");
      // SECURITY (adversarial review, finding H2): this route reaches the SAME external
      // delivery path as the scheduler, but had no role floor and made the per-agent
      // allowlist optional — a caller who simply omitted `agentId` skipped gate 3
      // entirely and could text any verified method in the household. Since WP-005
      // rests its whole consent story on that allowlist, an authenticated-but-
      // unprivileged bypass of it cannot stand. External channels now require an adult;
      // in-app/dashboard notifications stay open to everyone (they reach no one outside).
      // The hole is specifically messaging SOMEONE ELSE unattended; notifying your own
      // verified address is legitimate and stays open to every role.
      const target = typeof body.methodId === "string" ? getContactMethod(body.methodId) : null;
      const external = ["Email", "Phone/Text"].includes(methodType)
        || (target && ["Email", "Phone/Text"].includes(target.type));
      const ownMethod = target && target.memberId === g.session.actorId;
      if (external && !ownMethod && !isAdultRole(g.session.role)) {
        return json(res, 403, { error: "insufficient_role", message: "Messaging someone else outside the household is an adult action." }, req);
      }
      const out = await deliverNotification({
        session: g.session, methodId: typeof body.methodId === "string" ? body.methodId : null,
        methodType, to: body.to ?? null, title: body.title, body: body.body,
        agentId: typeof body.agentId === "string" ? body.agentId : null,
      });
      audit({ type: "notify", channel: out.channel, methodId: body.methodId ?? undefined, ok: out.ok, needsSetup: out.needsSetup ?? undefined }, req, g.session);
      return json(res, 200, out, req);
    }
    if (path === "/api/notifications" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const mine = listNotifications((n) => n.householdId === g.session.householdId && n.actorId === g.session.actorId)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 100);
      return json(res, 200, { notifications: mine }, req);
    }
    const notifRead = path.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (notifRead && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const all = listNotifications((n) => n.id === notifRead[1] && n.householdId === g.session.householdId && n.actorId === g.session.actorId);
      if (!all.length) return json(res, 404, { error: "not_found" }, req);
      markNotificationRead(notifRead[1]);
      return json(res, 200, { ok: true }, req);
    }

    /* ---- Risk-class overrides (item 9) ----
     * An Owner/Adult Admin may re-class a tool/function's risk and skip its approval
     * gate for their household. Server-enforced in the engine's resolveTool; every
     * change is audited. GET returns the effective catalog + current overrides so
     * clients render exactly what the engine will enforce. */
    if (path === "/api/risk-overrides" && method === "GET") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Only what governs THIS person: their nest's rules, plus the household's. Another
      // nest's relaxed rule is none of their business and must never look like theirs.
      const mine = new Set(nestsFor(g.session.householdId, g.session.actorId).map((n) => `nest:${n.id}`));
      const overrides = listRiskOverrides((o) => o.householdId === g.session.householdId)
        .filter((o) => !o.scope || o.scope === "household" || mine.has(o.scope));
      return json(res, 200, { overrides, catalog: toolCatalog(g.session) }, req);
    }
    if (path === "/api/risk-overrides" && method === "PUT") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const toolId = String(body.toolId ?? "").trim();
      const known = toolCatalog(g.session).find((t) => t.toolId === toolId);
      if (!known) return json(res, 404, { error: "unknown_tool" }, req);
      const RISKS = ["Low", "Medium", "High", "Sensitive"];
      const riskClass = body.riskClass == null ? null : (RISKS.includes(body.riskClass) ? body.riskClass : undefined);
      if (riskClass === undefined) return json(res, 400, { error: "invalid_risk_class" }, req);
      /* Lowering a tool's risk class — or waiving its approval entirely — is the single most
       * consequential switch a household has. It gets the PIN. */
      const gated = await requireHouseholdPin(g.session, body.pin);
      if (gated) return json(res, 403, gated, req);
      /* Cluster W — "if there's nests, then both nest members will have access to this for
       * their particular nest, and these will not apply to anybody outside of their nest.
       * They don't apply family-wide."
       *
       * So an override belongs to a NEST when its setter is in one, and to the household
       * otherwise. The id carries the scope, which is what keeps one nest's relaxed rule
       * from silently governing the other nest's runs. */
      const myNest = nestsFor(g.session.householdId, g.session.actorId)[0] ?? null;
      const scopeId = myNest ? `nest:${myNest.id}` : "household";
      const rec = putRiskOverride({
        id: `${g.session.householdId}:${scopeId}:${toolId}`, householdId: g.session.householdId, toolId,
        scope: scopeId, nestId: myNest?.id ?? null,
        riskClass, skipApproval: !!body.skipApproval,
        setBy: g.session.actorId, setAt: new Date().toISOString(),
      });
      audit({ type: "risk_override.set", toolId, riskClass: rec.riskClass, skipApproval: rec.skipApproval, ok: true }, req, g.session);
      return json(res, 200, { override: rec }, req);
    }
    const rovOne = path.match(/^\/api\/risk-overrides\/(.+)$/);
    if (rovOne && method === "DELETE") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const toolId = decodeURIComponent(rovOne[1]);
      const myNest = nestsFor(g.session.householdId, g.session.actorId)[0] ?? null;
      const scopeId = myNest ? `nest:${myNest.id}` : "household";
      // Yours to clear means yours: the one in YOUR scope, not whichever matched first.
      const existing = listRiskOverrides((o) => o.householdId === g.session.householdId && o.toolId === toolId)
        .find((o) => (o.scope ?? "household") === scopeId);
      if (!existing) return json(res, 404, { error: "not_found" }, req);
      deleteRiskOverrideRec(existing.id);
      audit({ type: "risk_override.cleared", toolId, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }


    /* ---- Household files (Phase 5): server-owned file library ----
     * Metadata + bytes live server-side so every client (web/mobile) sees the same
     * library. Upload is JSON base64 (no multipart dependency), capped at ~5 MB. */
    if (path === "/api/files" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      /* Files uploaded BEFORE `kind` existed carry no kind, and the back-compat rule treats a
       * missing kind as a document — which is right for a school form and wrong for the photo
       * that is currently somebody's face. So the ones a member actually points at are
       * retagged here, once, on read: "the profile images are still not stored elsewhere…
       * they're shown as home files."
       *
       * Deliberately derived from the ROSTER rather than guessed from a filename: a file is an
       * avatar because a member's photoFileId names it, which is the only thing that makes it
       * one. Cheap (a Set built from members already in memory) and self-healing — a photo
       * replaced tomorrow stops being an avatar the moment nobody points at it.
       */
      {
        const claimed = new Set(
          listMembers((m) => m.householdId === g.session.householdId)
            .map((m) => m.photoFileId)
            .filter((x) => typeof x === "string" && !x.startsWith("emoji:")),
        );
        for (const fid of claimed) {
          const f = getFileRec(fid);
          if (f && f.householdId === g.session.householdId && (f.kind ?? "document") !== "avatar") {
            putFileRec({ ...f, kind: "avatar" });
          }
        }
      }
      // Avatars are excluded: they're chrome, not household documents (see the POST below).
      // `?include=all` exists so a future "everything stored for this household" view — or a
      // support question about disk use — can still see them, rather than the app pretending
      // the bytes aren't there.
      /* O3 [08:31] — the briefing was attributed to "m-owner". "It needs to be their real name
       * as it is in the app." The record stores an actor id, which is right; resolving it to a
       * name is the server's job, not something every screen should re-derive. */
      const roster = new Map(listMembers((m) => m.householdId === g.session.householdId).map((m) => [m.actorId, m.displayName]));
      const includeAll = url.searchParams.get("include") === "all";
      const visible = listFiles((f) => f.householdId === g.session.householdId)
        // Avatars are chrome and chat attachments belong to their thread — the Library lists documents.
        .filter((f) => includeAll || !["avatar", "message"].includes(f.kind ?? "document"))
        .filter((f) => canSeeEntity(f, g.session))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map((f) => ({ ...f, uploadedByName: roster.get(f.uploadedBy) ?? null }));
      return json(res, 200, { files: visible }, req);
    }
    if (path === "/api/files" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { error: "insufficient_role" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const name = String(body.name ?? "").trim();
      if (!name) return json(res, 400, { error: "name_required" }, req);
      /* "Photos, files, documents, videos, whatever seem to have a 5 MB cap, which is very
       * small." It was 5 MB — small enough that a phone photo at full resolution, or any
       * video at all, bounced. 25 MB per page now (base64 inflates by 4/3, hence ~34 MB), with
       * the request ceiling above sized to clear it. */
      const MAX_FILE_BYTES = 25 * 1024 * 1024;
      const CAP = Math.ceil(MAX_FILE_BYTES * 4 / 3); // ~34 MB of base64, enforced per page
      // A logical file can carry multiple pages (front+back of an ID card, a multi-page
      // scan). `pages: [{ name?, base64 }]` writes one blob per page; the classic single
      // `contentBase64` upload is preserved verbatim as a 1-page file (full back-compat).
      const hasPages = Array.isArray(body.pages) && body.pages.length > 0;
      const pageBufs = [];
      if (hasPages) {
        if (body.pages.length > 20) return json(res, 400, { error: "too_many_pages", message: "Cap is 20 pages per file." }, req);
        for (const p of body.pages) {
          const pb64 = String(p?.base64 ?? "");
          if (!pb64) return json(res, 400, { error: "content_required" }, req);
          if (pb64.length > CAP) return json(res, 413, { error: "too_large", message: "Each page is capped at 25 MB." }, req);
          let buf;
          try { buf = Buffer.from(pb64, "base64"); } catch { return json(res, 400, { error: "bad_base64" }, req); }
          if (!buf || buf.length === 0) return json(res, 400, { error: "bad_base64" }, req);
          pageBufs.push({ name: typeof p?.name === "string" && p.name.trim() ? p.name.trim() : null, buf });
        }
      } else {
        const b64 = String(body.contentBase64 ?? "");
        if (!b64) return json(res, 400, { error: "content_required" }, req);
        if (b64.length > CAP) return json(res, 413, { error: "too_large", message: "Files are capped at 25 MB." }, req);
        let buf;
        try { buf = Buffer.from(b64, "base64"); } catch { return json(res, 400, { error: "bad_base64" }, req); }
        if (!buf || buf.length === 0) return json(res, 400, { error: "bad_base64" }, req);
        pageBufs.push({ name: null, buf });
      }
      /* IMG_2957.PNG appeared three times in the library at 3.4 MB each — attaching the same
       * photo twice created a second copy of it, and a third. Same household, same name, same
       * bytes: that is one file the family uploaded more than once, not three documents.
       *
       * Deduped on a content hash. The EXISTING record is returned untouched, so anything
       * already pointing at it (a member's avatar, a chat attachment, a knowledge item) keeps
       * resolving. Different bytes under the same name are still a new file — a v2 of a form
       * is not a duplicate. */
      const contentHash = crypto.createHash("sha256")
        .update(String(name))
        .update(Buffer.concat(pageBufs.map((p) => p.buf)))
        .digest("hex");
      {
        const existing = listFiles((f) => f.householdId === g.session.householdId && f.contentHash === contentHash)[0];
        if (existing) {
          audit({ type: "file.upload", fileId: existing.id, name, deduped: true, ok: true }, req, g.session);
          return json(res, 200, { file: existing, deduped: true }, req);
        }
      }
      const id = "file_" + crypto.randomBytes(8).toString("hex");
      // Page 0's blob lives under the record id (so a legacy single-page reader still works);
      // extra pages get `<id>_p1`, `<id>_p2`, … . pageBlobIds indexes them in order.
      const pageBlobIds = pageBufs.map((_, i) => (i === 0 ? id : `${id}_p${i}`));
      const sizeBytes = pageBufs.reduce((n, p) => n + p.buf.length, 0);
      const rec = putFileRec({
        id, householdId: g.session.householdId,
        name, mime: typeof body.mime === "string" ? body.mime : "application/octet-stream",
        sizeBytes, pageCount: pageBufs.length, pageBlobIds, pageNames: pageBufs.map((p) => p.name),
        tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 10) : [],
        visibility: body.visibility ?? "household", spaceId: body.spaceId ?? "sp-family",
        uploadedBy: g.session.actorId, source: body.source ?? "upload",
        /* Reported: "the profile images are being stored as home files instead of in a
         * dedicated location." They were — an avatar went through the same upload path as a
         * school form, so everyone's face turned up in the family document library.
         *
         * The blob still lives in the same store (it has to; that's what serves the picture),
         * but the record now says what it is, and the library lists DOCUMENTS. An avatar is
         * chrome, not a household file. Anything without a kind stays a document, so every
         * file uploaded before today is unaffected. */
        kind: body.kind === "avatar" ? "avatar" : body.kind === "message" ? "message" : "document",
        // A chat attachment is private to the thread: the participants are its readers, and
        // canSeeEntity honours participantIds on any record.
        ...(body.kind === "message" && Array.isArray(body.participantIds) ? { participantIds: body.participantIds.map(String).slice(0, 50) } : {}),
        contentHash,
        createdAt: new Date().toISOString(),
      });
      pageBufs.forEach((p, i) => writeFileBlob(pageBlobIds[i], p.buf));
      audit({ type: "file.upload", fileId: rec.id, name, sizeBytes, pageCount: pageBufs.length, ok: true }, req, g.session);

      /* P3 — "I uploaded a receipt from Home Depot for a Ryobi drill as a PDF. I let Famili
       * decide, and Famili decided to put it into Home… this is wrong, it should have gone into
       * Bills & Receipts."
       *
       * The client decided from the FILENAME, which for a camera-roll PDF is `IMG_3011.pdf` and
       * matches nothing — so it fell through to Home, whose pattern matches everything. The
       * server can do better because the server can READ it: the same understandFile that lets
       * the assistant answer questions about a document can tell a receipt from a permission
       * slip. Only for "let Famili decide" (the client sends `autoFile`), so an explicit choice
       * is never second-guessed.
       *
       * Deliberately after the response is prepared and awaited before returning: filing that
       * lands a second later would mean the confirmation toast names the wrong space, which is
       * the exact complaint. */
      if (body.autoFile === true) {
        try {
          const read = await understandFile(rec.id, { householdId: g.session.householdId });
          if (read.ok && read.text) {
            const decided = decideSpaceFromText(read.text, name);
            if (decided) {
              /* REPLACE the client's space tag, don't sit next to it.
               *
               * "Let Famili decide" still sends a filename guess as a fallback for a file
               * that can't be read — and for `IMG_3011.pdf` that guess is `home`, because
               * home's pattern matches everything. Appending `bills-receipts` to it left the
               * record tagged BOTH, and every reader takes the first space tag it finds
               * (apps/mobile/src/lib/spaces.ts spaceOf), which is still `home`. The response
               * said bills-receipts, the audit said bills-receipts, and the toast said
               * "Saved to Home" — the original complaint, intact, behind a green tick.
               *
               * Once the file has been READ the guess is superseded, so it goes. Everything
               * that isn't a space tag — `sensitive` above all — has nothing to do with this
               * decision and stays exactly where it was. */
              const kept = (rec.tags ?? []).filter((t) => !SPACE_TAGS.has(String(t).toLowerCase()));
              const tagged = putFileRec({ ...rec, tags: [...new Set([decided, ...kept])] });
              audit({ type: "file.autofile", fileId: rec.id, space: decided, ok: true }, req, g.session);
              return json(res, 200, { file: tagged, autoFiled: decided }, req);
            }
          }
        } catch { /* filing is a convenience; a failure must not lose the upload */ }
      }
      return json(res, 200, { file: rec }, req);
    }
    /* O2 [08:24] — "the Daily Household Briefing has some odd characters in it, and it says
     * that it cannot be previewed. We need the ability to preview that."
     *
     * The odd characters were the split-UTF-8 bug (fixed in readRaw). The "cannot be
     * previewed" was real: the client only renders text and images inline, so a PDF got
     * "no inline preview — open it on the web app to download", which is a dead end on a phone.
     *
     * The server can now read a file (file-understanding.mjs) — so it does, and returns text a
     * phone can show. A PDF becomes its text, a photo becomes a description. Anything genuinely
     * unreadable returns the honest reason rather than a shrug. */
    const filePreview = path.match(/^\/api\/files\/([^/]+)\/preview$/);
    if (filePreview && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const f = getFileRec(filePreview[1]);
      if (!f || f.householdId !== g.session.householdId || !canSeeEntity(f, g.session)) return json(res, 404, { error: "not_found" }, req);
      const out = await understandFile(f.id, { householdId: g.session.householdId });
      if (!out.ok) return json(res, 200, { ok: false, error: out.error, message: out.message }, req);
      return json(res, 200, { ok: true, kind: out.kind, text: out.text, truncated: !!out.truncated }, req);
    }
    const fileContent = path.match(/^\/api\/files\/([^/]+)\/content$/);
    if (fileContent && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const f = getFileRec(fileContent[1]);
      if (!f || f.householdId !== g.session.householdId || !canSeeEntity(f, g.session)) return json(res, 404, { error: "not_found" }, req);
      // Legacy/single-page files have no pageBlobIds — their single blob is under the record id.
      const blobIds = Array.isArray(f.pageBlobIds) && f.pageBlobIds.length ? f.pageBlobIds : [f.id];
      const page = parseInt(url.searchParams.get("page") ?? "0", 10);
      const idx = Number.isFinite(page) ? page : 0;
      if (idx < 0 || idx >= blobIds.length) return json(res, 404, { error: "page_not_found" }, req);
      const buf = readFileBlob(blobIds[idx]);
      if (!buf) return json(res, 410, { error: "content_missing" }, req);
      const pageName = Array.isArray(f.pageNames) ? f.pageNames[idx] : null;
      return json(res, 200, { name: pageName || f.name, mime: f.mime, page: idx, pageCount: f.pageCount ?? blobIds.length, contentBase64: buf.toString("base64") }, req);
    }
    const fileOne = path.match(/^\/api\/files\/([^/]+)$/);
    if (fileOne && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const f = getFileRec(fileOne[1]);
      if (!f || f.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      if (!isAdultRole(g.session.role) && f.uploadedBy !== g.session.actorId) return json(res, 403, { error: "forbidden" }, req);
      deleteFileRec(f.id);
      audit({ type: "file.delete", fileId: f.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }



    // E1 [10:55] — "It's just raw text. It needs address autocomplete, smart sorting like
    // most web apps." Fires on keystrokes from the event location field, so it stays cheap:
    // labels and addresses only, no ratings, no drive times. A dead upstream returns an empty
    // list rather than an error — a lookup that can't answer must never interrupt typing.
    if (path === "/api/places/suggest" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
      const out = await suggestAddresses(url.searchParams.get("q") ?? "", {
        lat: num(url.searchParams.get("lat")), lng: num(url.searchParams.get("lng")),
      });
      return json(res, 200, out, req);
    }



    /* ======================== Helpers ========================================
     * One concept, one set of routes. A helper is a name, what it should do in plain
     * English, when it runs, and one autonomy dial — so there is no second screen where
     * a schedule lives, no third where a recipe lives, and no fourth that decides what
     * gets approved. Running one is the same tool loop that answers a chat message.
     * ======================================================================== */
    if (path === "/api/helper-templates" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { sections: helperTemplates() }, req);
    }

    /* ========================================================================
     * GROUP CHATS — the external iMessage threads Famili has been let into.
     *
     * A chat appears here as `pending` only once a verified member of THIS household has
     * spoken in it; until then FamiliOS does not know the thread exists and holds nothing
     * about it. Binding is an adult's deliberate act and requires the speak grant to
     * already exist, because the first thing a bind does is introduce Famili in the thread
     * — and an introduction that parks for approval would leave the bind neither done nor
     * failed. Revoking, by contrast, is answered to anyone: see group-chat.mjs.
     * ======================================================================== */
    if (path === "/api/group-chats" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const perm = speakPermission(g.session.householdId);
      const chats = listImessageChats((c) => c.status !== "revoked").map((c) => ({
        id: c.id, chatGuid: c.chatGuid, displayName: c.displayName ?? "", status: c.status,
        boundBy: c.boundBy ?? null, boundAt: c.boundAt ?? null, speakGrant: c.speakGrant ?? null,
        lastMessageAt: c.lastMessageAt ?? null, lastSpokeAt: c.lastSpokeAt ?? null,
        knownParticipants: (c.knownParticipants ?? []).map((p) => ({ memberId: p.memberId, name: getMember(p.memberId)?.displayName ?? null })),
        // Pseudonymous, and the word is deliberate: a salted slow hash of a ten-digit
        // number resists a casual read of a backup, not a determined attacker.
        unknownParticipantCount: (c.unknownParticipantHashes ?? []).length,
        messageCount: Object.values(c.messageIdsByDay ?? {}).reduce((n, ids) => n + ids.length, 0),
      }));
      /* CAN IT HEAR, not just may it speak.
       *
       * These are two different questions and the card only ever asked one. A household
       * could have every permission granted and a bound chat and still have Famili deaf,
       * because the triage tier had no usable model — and the only place that truth
       * existed was a decision-log row nobody opens. With the AI screens no longer
       * routed, there is now nowhere else a person could ever find out.
       *
       * So the one card that says whether Famili is in your chat also says whether it is
       * actually listening, in the words triageTier already uses. */
      const hear = triageTier(g.session.householdId);
      return json(res, 200, {
        chats,
        canSpeak: perm.ok, speakGrant: perm.ok ? perm.grant : null,
        speakBlockedReason: perm.ok ? null : perm.message,
        canListen: hear.ok,
        listenModel: hear.ok ? hear.model : null,
        listenBlockedReason: hear.ok ? null : hear.message,
        transcriptDays: Number(getSettings(g.session.householdId).chatTranscriptDays ?? 0),
      }, req);
    }
    if (path === "/api/group-chats" && method === "POST") {
      // Bind. Adult Admin and up: this lets an automated voice into a thread containing
      // people who are not in this household, which is not a Limited Member's call.
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!String(body.chatId ?? "").trim()) return json(res, 400, { error: "invalid_input", message: "Which chat?" }, req);
      const out = await bindChat({ chatId: String(body.chatId), session: g.session, displayName: body.displayName ?? "" });
      if (!out.ok) return json(res, out.status ?? 400, { error: out.error, message: out.message }, req);
      audit({ type: "imessage.chat_bind", chatId: body.chatId, ok: true }, req, g.session);
      return json(res, 200, { ok: true, chat: { id: out.chat.id, status: out.chat.status, speakGrant: out.chat.speakGrant } }, req);
    }
    const groupChatId = path.match(/^\/api\/group-chats\/([^/]+)$/);
    if (groupChatId && method === "DELETE") {
      const g = gate(req, { minRole: "Adult Member" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const chat = getImessageChat(groupChatId[1]);
      if (!chat || chat.householdId !== g.session.householdId) return json(res, 404, { error: "not_found" }, req);
      const out = revokeChat({ chat, by: "member", actorId: g.session.actorId });
      audit({ type: "imessage.chat_revoke", chatId: chat.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true, messagesDeleted: out.messagesDeleted }, req);
    }
    if (path === "/api/helpers" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { helpers: listHelpers(g.session).map((h) => publicHelper(h, g.session)) }, req);
    }
    if (path === "/api/helpers" && method === "POST") {
      const g = gate(req, { minRole: "Adult Member" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!String(body.name ?? "").trim()) return json(res, 400, { error: "name_required", message: "Give the helper a name." }, req);
      if (!String(body.instructions ?? "").trim()) return json(res, 400, { error: "instructions_required", message: "Say what this helper should do." }, req);
      const may = mayWriteHelper(g.session, null);
      if (!may.ok) return json(res, 403, { error: may.error, message: may.message }, req);
      // An Adult Member’s helper is their own — the same silo their chats live in.
      const visibility = isAdultMemberOnly(g.session) ? "personal" : body.visibility;
      // The top tier is the one setting that lets a helper send and spend with nobody
      // watching. It is the only thing here behind the household PIN, and turning it OFF
      // never is: making someone prove themselves in order to become more careful is how
      // you teach them to leave it on.
      if (body.autonomy === "full") {
        const gated = await requireHouseholdPin(g.session, body.pin);
        if (gated) return json(res, 403, gated, req);
      }
      if (body && "pin" in body) delete body.pin;   // consumed here; never persisted
      const helper = createHelper({ ...body, visibility }, g.session);
      audit({ type: "helper.create", agentId: helper.id, name: helper.name, ok: true }, req, g.session);
      return json(res, 200, { helper: publicHelper(helper, g.session) }, req);
    }
    const helperOne = path.match(/^\/api\/helpers\/([^/]+)$/);
    if (helperOne) {
      const id = helperOne[1];
      if (method === "GET") {
        const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const h = getHelper(id, g.session);
        if (!h) return json(res, 404, { error: "not_found" }, req);
        return json(res, 200, { helper: publicHelper(h, g.session) }, req);
      }
      if (method === "PATCH" || method === "PUT") {
        const g = gate(req, { minRole: "Adult Member" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const h = getHelper(id, g.session);
        if (!h) return json(res, 404, { error: "not_found" }, req);
        const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
        // The requested visibility is checked alongside the stored one: editing a helper you
        // own must not be a way to hand it to the whole family.
        const may = mayWriteHelper(g.session, h, body.visibility);
        if (!may.ok) return json(res, 403, { error: may.error, message: may.message }, req);
        if (body.autonomy === "full") {
          const gated = await requireHouseholdPin(g.session, body.pin);
          if (gated) return json(res, 403, gated, req);
        }
        if (body && "pin" in body) delete body.pin;
        const updated = updateHelper(id, body, g.session);
        audit({ type: "helper.update", agentId: id, ok: true }, req, g.session);
        return json(res, 200, { helper: publicHelper(updated, g.session) }, req);
      }
      if (method === "DELETE") {
        const g = gate(req, { minRole: "Adult Member" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const h = getHelper(id, g.session);
        if (!h) return json(res, 404, { error: "not_found" }, req);
        const may = mayWriteHelper(g.session, h);
        if (!may.ok) return json(res, 403, { error: may.error, message: may.message }, req);
        const r = deleteHelper(id);
        if (r.error) return json(res, 404, { error: r.error }, req);
        audit({ type: "helper.delete", agentId: id, ok: true }, req, g.session);
        return json(res, 200, { ok: true }, req);
      }
    }
    const helperAction = path.match(/^\/api\/helpers\/([^/]+)\/(run|history)$/);
    if (helperAction) {
      const [, id, action] = helperAction;
      const g = gate(req, action === "history" ? { requireSession: true } : { minRole: "Adult Member" });
      if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const h = getHelper(id, g.session);
      if (!h) return json(res, 404, { error: "not_found" }, req);
      if (action === "history") {
        // A helper’s history IS its thread: every run wrote what it actually did there.
        const conv = h.conversationId ? getConversation(h.conversationId) : null;
        return json(res, 200, { conversationId: h.conversationId ?? null, messages: conv?.messages ?? [], lastRun: h.lastRun ?? null }, req);
      }
      if (method !== "POST") return json(res, 405, { error: "method_not_allowed" }, req);
      // Running a helper can reach tools and send things, so it obeys the same rule as
      // editing one.
      const may = mayWriteHelper(g.session, h);
      if (!may.ok) return json(res, 403, { error: may.error, message: may.message }, req);
      // Optional note from the person pressing Run ("focus on Monday", "email it to me").
      const body = (await readBody(req)) ?? {};
      const request = typeof body?.request === "string" ? body.request.trim().slice(0, 2000) : "";
      const out = await runHelper({ helperId: id, session: g.session, reason: "manual", payload: request ? { request } : null });
      audit({ type: "helper.run", agentId: id, ok: !!out.ok, error: out.ok ? undefined : out.error, withRequest: !!request }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }

    /* A TestFlight build already on someone’s phone still asks for /api/agents. Answer it
     * with the same rows rather than a 404, so an un-updated app degrades to a read-only
     * list instead of an error screen. */
    if (path === "/api/agents" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { agents: listHelpers(g.session).map((h) => publicHelper(h, g.session)) }, req);
    }

    /* ---- Trigger registry (Slice 6) — real server-side triggers ---- */
    if (path === "/api/triggers" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { triggers: listPublicTriggers(g.session, { type: url.searchParams.get("type") || undefined }) }, req);
    }
    if (path === "/api/triggers" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!body.name?.trim()) return json(res, 400, { error: "name_required" }, req);
      if (body.type && !TRIGGER_TYPES.includes(body.type)) return json(res, 400, { error: "unknown_type" }, req);
      const t = createTrigger(body, g.session, Date.now());
      audit({ type: "trigger.create", triggerId: t.id, name: t.name, triggerType: t.type, ok: true }, req, g.session);
      return json(res, 200, { trigger: publicTrigger(t) }, req);
    }
    const triggerBase = path.match(/^\/api\/triggers\/([^/]+)$/);
    if (triggerBase) {
      const id = triggerBase[1];
      if (method === "GET") {
        const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const t = getTrigger(id);
        if (!t || (t.householdId !== "local" && t.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        return json(res, 200, { trigger: publicTrigger(t) }, req);
      }
      if (method === "PUT" || method === "PATCH") {
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const t = getTrigger(id);
        if (!t || (t.householdId !== "local" && t.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
        const updated = updateTrigger(id, body, Date.now());
        audit({ type: "trigger.update", triggerId: id, ok: true }, req, g.session);
        return json(res, 200, { trigger: publicTrigger(updated) }, req);
      }
      if (method === "DELETE") {
        const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
        const t = getTrigger(id);
        if (!t || (t.householdId !== "local" && t.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
        const r = deleteTrigger(id);
        if (r.error) return json(res, r.error === "not_found" ? 404 : 422, { error: r.error }, req);
        audit({ type: "trigger.delete", triggerId: id, ok: true }, req, g.session);
        return json(res, 200, { ok: true }, req);
      }
    }
    const triggerFire = path.match(/^\/api\/triggers\/([^/]+)\/fire$/);
    if (triggerFire && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const t = getTrigger(triggerFire[1]);
      if (!t || (t.householdId !== "local" && t.householdId !== g.session.householdId)) return json(res, 404, { error: "not_found" }, req);
      const body = await readBody(req);
      const out = await fireTrigger(t, { triggerType: "manual", payload: body?.payload });
      audit({ type: "trigger.manual_fire", triggerId: t.id, runId: out.runId, ok: out.ok, error: out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }


    /* ---- OAuth start (PKCE; state bound to actor + household + provider) ---- */
    const oauthStartMatch = path.match(/^\/api\/oauth\/([^/]+)\/start$/);
    if (oauthStartMatch && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      // Children and guests never connect accounts: the lowest role that may add a calendar
      // (a Limited Member's one) is the lowest that may start the connection behind it.
      if (!roleAtLeast(g.session.role, "Limited Member")) return json(res, 403, { ok: false, error: "insufficient_role" }, req);
      if (!externalActionsEnabled(g.session.householdId)) return json(res, 423, { ok: false, error: "external_actions_disabled" }, req);
      const provider = connectorProviderById(oauthStartMatch[1]);
      if (!provider) return json(res, 404, { ok: false, error: "unknown_provider" }, req);
      if (!providerConfigured(provider)) return json(res, 422, { ok: false, error: "not_configured_by_deployment", message: `This deployment has not set ${provider.clientIdEnv} / ${provider.clientSecretEnv}.` }, req);
      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = provider.usePKCE ? crypto.createHash("sha256").update(codeVerifier).digest("base64url") : undefined;
      // Mobile flows mark the state string itself (`<provider>.m.<nonce>`) so the
      // callback can hand control back to the app even if the persisted state
      // record is lost or expired (otherwise the user is stranded in the browser).
      const isMobileStart = req.headers["x-homeops-mobile"] === "1";
      const state = `${provider.id}.${isMobileStart ? "m." : ""}${crypto.randomBytes(16).toString("hex")}`;
      const urlOut = buildAuthUrl(provider, oauthRedirectUri(), state, codeChallenge);
      putOAuthState(state, { provider: provider.id, actorId: g.session.actorId, householdId: g.session.householdId, codeVerifier, appOrigin: req.headers.origin, from: req.headers["x-homeops-mobile"] === "1" ? "mobile" : "web" });
      audit({ type: "oauth.start", provider: provider.id, ok: true }, req, g.session);
      return json(res, 200, { ok: true, url: urlOut }, req);
    }

    /* ---- Jobs (list / run) ---- */
    if (path === "/api/jobs" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { jobs: JOBS.map(jobView) }, req);
    }
    const jobRun = path.match(/^\/api\/jobs\/([^/]+)\/run$/);
    if (jobRun && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const job = JOBS.find((x) => x.id === jobRun[1]);
      if (!job) return json(res, 404, { error: "unknown_job" }, req);
      // Explicit rather than relying on the request's ambient context: "Run now" must run for
      // the household that pressed it, and be obvious about that at the call site.
      const out = await runJob(job, "manual", g.session.householdId);
      audit({ type: "job.manual_run", jobId: job.id, ok: out.ok, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, { job: jobView(job), result: out }, req);
    }

    /* ---- Browser automation (honest handshake) ---- */
    if (path === "/api/browser/session" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!externalActionsEnabled(g.session.householdId)) return json(res, 423, { ok: false, error: "external_actions_disabled" }, req);
      const h = await healthCheck("browser");
      audit({ type: "browser.session", ok: h.ok, error: h.ok ? undefined : h.status }, req, g.session);
      if (!h.ok) return json(res, 422, { ok: false, status: "runtime_unavailable", message: "No executable browser automation runtime is connected. Set BROWSER_RUNTIME_URL to a reachable runtime to enable." }, req);
      return json(res, 200, { ok: true, status: "login_required", message: "Runtime reachable. Sign in within the secure browser session — we never ask for your password." }, req);
    }

    /* ---- Settings (kill switch, owner PIN) — admin only ---- */
    if (path === "/api/settings" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const s = getSettings(g.session.householdId);
      return json(res, 200, { settings: settingsView(s, g.session) }, req);
    }
    if (path === "/api/settings" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const prev = getSettings(g.session.householdId);
      const patch = {};
      /* The switches that change what runs WITHOUT asking a human first. Same reasoning as
       * the risk overrides: a deliberate pause, proved by the PIN, at the moment of the act.
       * Setting the PIN itself is exempt — you can't be asked for what you're establishing. */
      /* storeAllChatParticipants is here because it widens what is retained about people
       * who never consented to any of this — the same category of change as opening the
       * kill switch, and not one a shoulder-surfed session should be able to make. */
      const DANGEROUS = ["externalActionsEnabled", "calendarAutoSync", "autoApproveImprovements", "storeAllChatParticipants"];
      /* The autonomy preset joins them, but only on the way UP to Trusted — the tier that
       * clears send/spend gates household-wide. Balanced can never reach a delivering
       * capability (policy.mjs rule 7 is bounded by isHighStakes), and dropping back to
       * Cautious is the careful direction, so neither is gated: a PIN prompt for becoming
       * safer is how you teach someone to stop reading them. */
      const raisingToTrusted = body.autonomy === "Trusted" && prev.autonomy !== "Trusted";
      if (raisingToTrusted || DANGEROUS.some((k) => body[k] !== undefined && body[k] !== prev[k])) {
        const gated = await requireHouseholdPin(g.session, body.pin);
        if (gated) return json(res, 403, gated, req);
      }
      /* G4/G5, at household scale. Attribution is stamped from the SESSION and never accepted
       * from the body — identical reasoning to agents.mjs sanitizeApprovalPolicy, because it is
       * the identical claim: rule 7 honours Trusted only when autonomySetByRole names someone
       * with the standing to have chosen it, so a request body must not be able to say so. */
      if (body.autonomy !== undefined) {
        if (!STANCES_LIST.includes(body.autonomy)) return json(res, 400, { error: "invalid_autonomy" }, req);
        patch.autonomy = body.autonomy;
        const mayTrust = ["Owner", "Adult Admin"].includes(String(g.session.role));
        patch.autonomySetBy = g.session.actorId;
        patch.autonomySetByRole = body.autonomy === "Trusted" && mayTrust ? g.session.role : null;
        patch.autonomySetAt = new Date().toISOString();
      }
      if (typeof body.externalActionsEnabled === "boolean") patch.externalActionsEnabled = body.externalActionsEnabled;
      // Calendar auto-sync: Adult Admin opt-in that pre-authorizes Google Calendar
      // pushes (no per-event approvals) and turns on the server-triggered two-way sweep.
      if (typeof body.calendarAutoSync === "boolean") patch.calendarAutoSync = body.calendarAutoSync;
      // AI-judged auto-approval of LOW-risk improvement proposals (default ON). When off,
      // every proposal — even low-risk — waits for a human in the evolution review queue.
      if (typeof body.autoApproveImprovements === "boolean") patch.autoApproveImprovements = body.autoApproveImprovements;
      // WP-010 pre-auth privacy (ISS-015): when ON, this household's roster is hidden from
      // the pre-auth profile picker to anyone without a session for it (see /api/profiles).
      if (typeof body.hideProfilesPreAuth === "boolean") patch.hideProfilesPreAuth = body.hideProfilesPreAuth;
      /* GROUP CHAT. Three dials, and the defaults are the quiet ones.
       *
       * chatProposalsEnabled is the shadow-mode gate: the classifier runs and records its
       * verdict from the moment a chat is bound, and proposes nothing until this is turned
       * on, so the precision bar is read off the decision log rather than guessed at.
       * chatTranscriptDays defaults to 0, meaning the transcript is ephemeral; raising it
       * is what buys a coordination loop's ability to check whether someone said they had
       * already handled something. 90 is the ceiling. */
      if (typeof body.chatProposalsEnabled === "boolean") patch.chatProposalsEnabled = body.chatProposalsEnabled;
      /* storeAllChatParticipants changes what is kept about people who are not FamiliOS
       * users and cannot check. Famili already told every bound chat which policy it runs
       * under, so the chats are told FIRST and the change only lands if they all heard it —
       * the same rule bindChat applies to the same promise. Turning it OFF also deletes what
       * was kept, because the chat is being told it is gone. */
      let storagePolicyChange = null;
      if (typeof body.storeAllChatParticipants === "boolean") {
        const current = getSettings(g.session.householdId).storeAllChatParticipants === true;
        if (body.storeAllChatParticipants !== current) {
          const heard = await announceStoragePolicy({ householdId: g.session.householdId, session: g.session, storeAll: body.storeAllChatParticipants });
          if (!heard.ok) {
            appendAudit({ type: "imessage.storage_policy_changed", ok: false, error: "announcement_failed", failed: heard.failed.length, householdId: g.session.householdId });
            return json(res, 409, {
              error: "announcement_failed",
              message: `Famili couldn't tell ${heard.failed.length === 1 ? "one of your chats" : `${heard.failed.length} of your chats`} about the change, so nothing was changed. Check that it can still speak there, then try again.`,
              failed: heard.failed,
            }, req);
          }
          storagePolicyChange = body.storeAllChatParticipants;
        }
        patch.storeAllChatParticipants = body.storeAllChatParticipants;
      }
      if (body.chatTranscriptDays !== undefined) {
        const d = Number(body.chatTranscriptDays);
        if (!Number.isFinite(d) || d < 0 || d > 90) return json(res, 400, { error: "invalid_input", message: "Keep chat history between 0 and 90 days." }, req);
        patch.chatTranscriptDays = Math.floor(d);
      }
      // The triage tier. Naming a provider it has no key for is refused rather than stored:
      // a tier that reads as configured and cannot answer is the fabricated readiness this
      // codebase refuses everywhere else.
      if (body.aiTriageProvider !== undefined) {
        const pid = body.aiTriageProvider === null || body.aiTriageProvider === "" ? null : String(body.aiTriageProvider);
        if (pid && !aiProviderById(pid)) return json(res, 400, { error: "unknown_provider", message: "That isn't a provider FamiliOS knows." }, req);
        patch.aiTriageProvider = pid;
        if (!pid) patch.aiTriageModel = null;
      }
      if (body.aiTriageModel !== undefined) patch.aiTriageModel = body.aiTriageModel ? String(body.aiTriageModel).slice(0, 120) : null;
      if (body.aiTriageDailyBudget !== undefined) {
        const b = Number(body.aiTriageDailyBudget);
        if (!Number.isFinite(b) || b < 0) return json(res, 400, { error: "invalid_input", message: "A daily classification cap is a number, or 0 for unmetered." }, req);
        patch.aiTriageDailyBudget = Math.floor(b);
      }
      /* A DIAL THAT WAS ENFORCED AND COULD NOT BE TURNED.
       *
       * store.mjs has metered every AI call per household since C1.3, and aiBudgetExhausted()
       * is checked on the real paths — but NOTHING ever wrote `aiDailyCallBudget`. The cap was
       * live, functional, and permanently unset: a family that wanted to bound their own spend
       * had no way to say so, and an operator's only recourse was editing the store by hand.
       *
       * 0 or null means unmetered, which is the documented default and the way to switch it
       * back off. Not PIN-gated: unlike the autonomy switches this cannot cause an action to
       * leave the house — the worst it does is make the assistant stop early, which is the
       * careful direction. */
      if (body.aiDailyCallBudget !== undefined) {
        if (body.aiDailyCallBudget === null || body.aiDailyCallBudget === 0 || body.aiDailyCallBudget === "") {
          patch.aiDailyCallBudget = null;
        } else {
          const n = Number(body.aiDailyCallBudget);
          if (!Number.isFinite(n) || n < 0 || n > 100000) return json(res, 400, { error: "invalid_budget", message: "A daily call budget is a whole number of calls, or 0 for no limit." }, req);
          patch.aiDailyCallBudget = Math.floor(n);
        }
      }
      /* The household's own sign-in PIN. Refuse a too-short one HERE rather than in the
       * form: this is the gate on every Owner and Adult Admin sign-in, and a client that
       * skips its own validation must not be able to set a one-digit PIN on it. */
      if (typeof body.ownerPin === "string" && body.ownerPin) {
        if (!/^\d{4,12}$/.test(body.ownerPin)) {
          return json(res, 400, { error: "bad_pin", message: "A sign-in PIN is 4 to 12 digits." }, req);
        }
        patch.ownerPinHash = await hashPin(body.ownerPin);
      }
      // Household timezone: an IANA zone name (e.g. "America/New_York") that anchors
      // "every day at 7 AM" triggers to a real wall-clock time (server/triggers.mjs
      // nextAnchorOccurrence). Without this, a scheduled trigger silently falls back to
      // the SERVER's clock (UTC on Render) — "7 AM" then means 7 AM UTC, not 7 AM local.
      // `timezone: null` explicitly clears it back to that disclosed fallback.
      if (body.timezone === null) patch.timezone = null;
      else if (typeof body.timezone === "string" && body.timezone) {
        if (!isValidTimezone(body.timezone)) return json(res, 400, { error: "invalid_timezone" }, req);
        patch.timezone = body.timezone;
      }
      const next = setSettings(patch, g.session.householdId);
      /* REPLACING the household PIN ends every OTHER Owner / Adult Admin session: a session
       * opened with the old PIN — which may be the reason it is being changed — must not
       * outlive it now that sessions renew while used. The person who changed it stays signed
       * in. Setting a FIRST PIN ends nothing: before it, elevated sign-in was either the
       * break-glass PIN (whose sessions keep a 12-hour end, store.mjs) or a development server. */
      if (patch.ownerPinHash && prev.ownerPinHash) deleteElevatedSessions(g.session.householdId, g.session.token);
      /* Turning it OFF deletes what was kept, in the same breath as announcing that it is
       * gone. Holding a non-member's words under a policy the household has withdrawn is the
       * one outcome this setting must never produce. */
      let nonMemberRowsDropped = 0;
      if (storagePolicyChange !== null) {
        if (storagePolicyChange === false) nonMemberRowsDropped = dropNonMemberMessages(g.session.householdId).dropped;
        appendAudit({ type: "imessage.storage_policy_changed", ok: true, storeAll: storagePolicyChange, dropped: nonMemberRowsDropped, householdId: g.session.householdId });
      }
      // "Every day at 7 AM" was resolved on the OLD clock; the next fire would land at the
      // wrong hour (and a one-shot schedule at the wrong hour forever).
      let reanchored = 0;
      if ("timezone" in patch && patch.timezone !== prev.timezone) reanchored = reanchorHelperSchedules(g.session.householdId) + reanchorTriggersForHousehold(g.session.householdId);
      audit({ type: "settings.update", ok: true, changed: Object.keys(patch), ...(reanchored ? { reanchoredTriggers: reanchored } : {}), prevExternalActions: prev.externalActionsEnabled, nextExternalActions: next.externalActionsEnabled }, req, g.session);
      return json(res, 200, { settings: settingsView(next, g.session) }, req);
    }

    /* ---- AI providers ---- */
    if (path === "/api/ai/providers" && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { providers: listAIProviders(g.session.householdId) }, req);
    }
    const aiCfg = path.match(/^\/api\/ai\/providers\/([^/]+)\/config$/);
    if (aiCfg && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      if (!aiProviderById(aiCfg[1])) return json(res, 404, { error: "unknown_provider" }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const p = setProviderConfig(aiCfg[1], body, g.session.householdId);
      audit({ type: "ai.config", providerId: aiCfg[1], ok: true }, req, g.session);
      return json(res, 200, { provider: p }, req);
    }
    if (aiCfg && method === "DELETE") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const p = revokeProvider(aiCfg[1], g.session.householdId); if (!p) return json(res, 404, { error: "unknown_provider" }, req);
      audit({ type: "ai.revoke", providerId: aiCfg[1], ok: true }, req, g.session);
      return json(res, 200, { provider: p }, req);
    }
    const aiHealth = path.match(/^\/api\/ai\/providers\/([^/]+)\/health$/);
    if (aiHealth && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const h = await providerHealth(aiHealth[1]);
      audit({ type: "ai.health", providerId: aiHealth[1], ok: h.ok }, req, g.session);
      return json(res, 200, h, req);
    }
    const aiModels = path.match(/^\/api\/ai\/providers\/([^/]+)\/models$/);
    if (aiModels && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const m = await providerModels(aiModels[1]);
      return json(res, m.ok ? 200 : 422, m, req);
    }
    if (path === "/api/ai/active" && method === "POST") {
      const g = gate(req, { minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (body.providerId && !aiProviderById(body.providerId)) return json(res, 404, { error: "unknown_provider" }, req);
      setActiveProvider(body.providerId ?? null, g.session.householdId);
      audit({ type: "ai.active", providerId: body.providerId ?? null, ok: true }, req, g.session);
      return json(res, 200, { activeProvider: body.providerId ?? null }, req);
    }
    if (path === "/api/ai/chat" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const gated = planGate(g, res, req); if (gated) return gated;
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const id = body.providerId || getSettings(g.session.householdId).aiActiveProvider;
      if (!id) return json(res, 400, { error: "no_provider", message: "No AI provider selected." }, req);
      const out = await providerChat(id, { messages: body.messages ?? [], model: body.model });
      audit({ type: "ai.chat", providerId: id, ok: out.ok, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }

    if (path === "/api/assistant" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const aiGated = childAiGate(g, res, req); if (aiGated) return aiGated;
      const gated = planGate(g, res, req); if (gated) return gated;
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      /* THE ATTACHMENT BUG. Recorded verbatim: "I'm not receiving readable attachment
       * contents, so I can't inspect the specific image you sent here."
       *
       * That was true. The client uploaded the file, showed the chip, and passed
       * `context.attachedFileId` — and nothing on this side ever opened it. The model got a
       * filename and was asked to describe a photo.
       *
       * The file is now READ before the turn: text is decoded, a photo goes through the
       * household's own vision model, and the result is handed to the assistant as context.
       * A file we genuinely can't read reports why, in the reply, instead of the assistant
       * apologising for an emptiness it can't explain. */
      await attachFileContext(body, g.session);
      /* AT-MOST-ONCE for a named turn (claimAssistantTurn, store.mjs). The phone re-sends
       * a turn to THIS route whenever its stream fails — including after that stream has
       * already run the tools. A finished twin gets the first answer; nothing runs twice. */
      const turnKey = assistantTurnKeyFor(g.session, body);
      if (turnKey) {
        const claim = claimAssistantTurn(turnKey);
        if (claim.state === "done") {
          audit({ type: "assistant.respond", ok: claim.result?.ok, kind: claim.result?.kind, model: claim.result?.model, replayed: true }, req, g.session);
          return json(res, claim.result?.ok ? 200 : 422, { ...claim.result, replayed: true }, req);
        }
        if (claim.state === "running") return json(res, 409, TURN_IN_PROGRESS, req);
      }

      // Prior turns from the durable conversation ride into the model call —
      // otherwise the assistant forgets facts stated one message earlier.
      const histConv = body.conversationId ? getConversation(body.conversationId) : null;
      const history = histConv && canSeeConversation(histConv, g.session) ? [...(histConv.messages ?? [])] : [];
        /* THREAD ORDER (ISS-005/009/011/016) — the user's turn is written BEFORE the model
         * runs, not after. A durable run is now created INSIDE the turn (an approval-gated
         * tool becomes a parked run), and the run's own reaction posts back to this same
         * conversation from a background hook. Persisting afterwards let that reaction land
         * above the question that caused it.
         *
         * History is read first, so the message being answered is not also handed back to
         * the model as something it already said. */
        const convForTurn = histConv && canSeeConversation(histConv, g.session) ? histConv : null;
      if (convForTurn) appendConversationMessage(convForTurn.id, { role: "user", text: String(body.message), at: new Date().toISOString() });
      // WP-006 slice 2 — plan chat against the acting agent's (agt_household, effective)
      // PERMITTED catalog. ensureOpenDefaultAgent neutralizes the seeded-narrow allow-list
      // (the same widening the chat run itself applies), so ordinary chat capability is
      // never shrunk — only a household's explicit DENY reaches the model's menu, and a
      // local provider additionally gets the relevance-ranked, budget-capped catalog.
      const actingAgent = ensureDefaultHelper();
      /* Who is listening, decided here from the stored conversation (ADR-005), and the turn's
       * ledger — read after the turn so a turn that handed a surprise over records nothing. */
      const audience = askAudience(convForTurn, g.session);
      const ledger = {};
      let out;
      try {
        out = await runAssistantAgent({ message: body.message, context: body.context, session: g.session, providerId: body.providerId, history, agent: actingAgent, conversationId: body.conversationId ?? null, visibility: chatRunVisibility(body.conversationId), audience, ledger });
      } catch (e) {
        if (turnKey) releaseAssistantTurn(turnKey);
        throw e;
      }
      attachAgentRun(out);
      if (turnKey) finishAssistantTurn(turnKey, out);
      // Server-durable thread: if a conversation is named, persist the turn so history
      // survives refresh and is owned by the server, not the client. Failed turns are
      // persisted too — the user saw their question and the honest error, so a refresh
      // must not erase the exchange (that was the "history gone after refresh" bug).
      if (convForTurn) {
        appendConversationMessage(convForTurn.id, assistantTurnMessage(out, new Date().toISOString()));
        // I1 — name the thread from the first exchange (see maybeNameConversation).
        if (out.ok) maybeNameConversation(convForTurn.id, { question: String(body.message), answer: out.answer ?? "", session: g.session });
        // BUG-06 — the writer memory never had. Scoped to the room it was said in.
        // Never from a turn that handed an owner's surprise over (ADR-005): it records nothing.
        if (out.ok && !ledger.secretReleased) {
          void captureMemoryFromExchange({ householdId: g.session.householdId, actorId: g.session.actorId, visibility: convForTurn.visibility, nestId: convForTurn.nestId, message: body.message, answer: out.answer });
        }
      }
      audit({ type: "assistant.respond", ok: out.ok, kind: out.kind, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }
    // SSE streaming assistant — same as POST /api/assistant but streams tokens to the
    // client as they arrive, then sends a "done" event with the fully parsed result.
    // Clients that don't support SSE can fall back to POST /api/assistant unchanged.
    if (path === "/api/assistant/stream" && method === "POST") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const aiGated = childAiGate(g, res, req); if (aiGated) return aiGated;
      const gated = planGate(g, res, req); if (gated) return gated;
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      // Same as POST /api/assistant — and this is the route the app really uses, so an
      // attachment that only worked on the non-streaming path would still look broken.
      await attachFileContext(body, g.session);
      /* The same at-most-once guard as POST /api/assistant, checked BEFORE the stream opens
       * so a refusal can still be a plain JSON 409 — which is exactly what makes the phone
       * fall back to the non-streaming route, where it is refused again instead of run
       * twice. A finished twin is answered as a one-frame stream, so the happy path stays SSE. */
      const turnKey = assistantTurnKeyFor(g.session, body);
      let claimed = null;
      if (turnKey) {
        claimed = claimAssistantTurn(turnKey);
        if (claimed.state === "running") return json(res, 409, TURN_IN_PROGRESS, req);
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...corsHeaders(req) });
      if (claimed?.state === "done") {
        audit({ type: "assistant.stream", ok: claimed.result?.ok, kind: claimed.result?.kind, model: claimed.result?.model, replayed: true }, req, g.session);
        res.write(`data: ${JSON.stringify({ type: "done", result: { ...claimed.result, replayed: true } })}\n\n`);
        res.end();
        return;
      }
      // The first honest word BEFORE the first model round-trip — the client had nothing
      // truthful to show for the slowest seconds of the turn (Severity-5 item 6).
      try { res.write(`data: ${JSON.stringify({ type: "phase", phase: "thinking" })}\n\n`); } catch { /* client hung up */ }
      let tokenCount = 0;
      try {
        const histConv = body.conversationId ? getConversation(body.conversationId) : null;
        const history = histConv && canSeeConversation(histConv, g.session) ? [...(histConv.messages ?? [])] : [];
        /* THREAD ORDER (ISS-005/009/011/016) — the user's turn is written BEFORE the model
         * runs, not after. A durable run is now created INSIDE the turn (an approval-gated
         * tool becomes a parked run), and the run's own reaction posts back to this same
         * conversation from a background hook. Persisting afterwards let that reaction land
         * above the question that caused it.
         *
         * History is read first, so the message being answered is not also handed back to
         * the model as something it already said. */
        const conv = histConv && canSeeConversation(histConv, g.session) ? histConv : null;
        if (conv) appendConversationMessage(conv.id, { role: "user", text: String(body.message), at: new Date().toISOString() });
        // WP-006 slice 2 — same acting-agent catalog pruning as POST /api/assistant.
        const actingAgent = ensureDefaultHelper();
        const sse = (ev) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { /* client hung up */ } };
        const onToken = (tok) => {
          tokenCount++;
          if (tokenCount % 4 === 0) sse({ type: "progress", tokens: tokenCount });
          // The answer text itself, live, as the model writes it.
          if (typeof tok === "string" && tok) sse({ type: "delta", text: tok });
        };
        // What it's actually doing, as opposed to what the token counter implies. A web
        // lookup used to spend its whole (long) life claiming to be writing.
        const onPhase = (phase) => sse({ type: "phase", phase });
        // Same audience and ledger as POST /api/assistant (ADR-005).
        const audience = askAudience(conv, g.session);
        const ledger = {};
        const out = await runAssistantAgent(
          { message: body.message, context: body.context, session: g.session, providerId: body.providerId, history, agent: actingAgent, conversationId: body.conversationId ?? null, visibility: chatRunVisibility(body.conversationId), audience, ledger },
          { onToken, onPhase, onEvent: (ev) => sse(ev) },
        );
        attachAgentRun(out);
        if (turnKey) finishAssistantTurn(turnKey, out);

        if (conv) {
          appendConversationMessage(conv.id, assistantTurnMessage(out, new Date().toISOString()));
          // I1 — the streaming path is the one the real chat UI uses, so naming has to happen
          // here too or it would never fire in practice.
          if (out.ok) maybeNameConversation(conv.id, { question: String(body.message), answer: out.answer ?? "", session: g.session });
          // BUG-06 — same as POST /api/assistant, and this is the path the app actually
          // uses, so leaving it out here would be leaving the bug in.
          if (out.ok && !ledger.secretReleased) {
            void captureMemoryFromExchange({ householdId: g.session.householdId, actorId: g.session.actorId, visibility: conv.visibility, nestId: conv.nestId, message: body.message, answer: out.answer });
          }
        }
        audit({ type: "assistant.stream", ok: out.ok, kind: out.kind, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
        res.write(`data: ${JSON.stringify({ type: "done", result: out })}\n\n`);
      } catch (e) {
        if (turnKey) releaseAssistantTurn(turnKey);
        res.write(`data: ${JSON.stringify({ type: "done", result: { ok: false, error: "stream_error" } })}\n\n`);
      }
      res.end();
      return;
    }
    if (path === "/api/miniapps/generate" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const out = await generateMiniApp({ goal: body.goal, type: body.type, session: g.session, providerId: body.providerId });
      audit({ type: "miniapp.generate", ok: out.ok, model: out.model, error: out.ok ? undefined : out.error }, req, g.session);
      return json(res, out.ok ? 200 : 422, out, req);
    }

    /* ---- Webhook event history (auth-protected read) ---- */
    if (whMatch && method === "GET") {
      const g = gate(req, { requireSession: true }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { events: getWebhookEvents(whMatch[1]) }, req);
    }

    /* ---- Audit (admin only) ---- */
    if (path === "/api/audit" && method === "GET") {
      const g = gate(req, { requireSession: true, minRole: "Adult Admin" }); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      return json(res, 200, { events: readAudit(Number(url.searchParams.get("limit") || 100)) }, req);
    }

    /* ---- Expo push token registration (mobile clients) ---- */
    if (path === "/api/push-tokens" && method === "POST") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (!body.token || typeof body.token !== "string") return json(res, 400, { error: "token_required" }, req);
      // Record who owns this device so an approval push can target the right person.
      addPushToken(body.token, { householdId: g.session?.householdId ?? null, actorId: g.session?.actorId ?? null });
      audit({ type: "push.register", ok: true }, req, g.session);
      return json(res, 200, { ok: true }, req);
    }
    /* ---- Client crash / error reports ------------------------------------------
     * The iOS app had NO crash reporting of any kind: a render error was a white
     * screen on a device nobody watching the server could see. Rather than add a
     * third-party vendor (and a secret to manage), a client crash lands in the
     * household's OWN audit trail — the same place every other event goes, which
     * means it shows up in Activity with plain-language copy and a timestamp.
     *
     * Deliberately forgiving: a crash report must never be the thing that fails.
     * A missing session is accepted (a crash can happen before/at sign-in), and the
     * payload is truncated rather than rejected, because a rejected report is a
     * report nobody ever sees. */
    if (path === "/api/client-errors" && method === "POST") {
      const g = gate(req, {});                       // session optional by design
      const body = await readBody(req);
      if (!body) return json(res, 400, { error: "malformed_json" }, req);
      const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : undefined);
      appendAudit({
        type: "client.error",
        ok: false,
        platform: clip(body.platform, 32) ?? "unknown",
        appVersion: clip(body.appVersion, 32),
        fatal: body.fatal === true,
        message: clip(body.message, 500) ?? "(no message)",
        stack: clip(body.stack, 4000),
        screen: clip(body.screen, 120),
        householdId: g.ok ? g.session?.householdId ?? null : null,
        actorId: g.ok ? g.session?.actorId ?? null : null,
      });
      return json(res, 200, { ok: true }, req);
    }
    if (path === "/api/push-tokens" && method === "DELETE") {
      const g = gate(req, {}); if (!g.ok) return json(res, g.status, { error: g.error }, req);
      const body = await readBody(req); if (!body) return json(res, 400, { error: "malformed_json" }, req);
      if (body.token) removePushToken(body.token);
      return json(res, 200, { ok: true }, req);
    }

    if (serveStatic(req, res, path)) return;
    return json(res, 404, { error: "not_found", path }, req);
  } catch (e) {
    return json(res, 500, { error: "server_error", message: String(e?.message ?? e) }, req);
  }
};

/* ---- SECURITY (WP-005 adversarial review, finding C1) ----
 * POST /api/runs/start strips every authority-bearing field from a body's `sourceRef`:
 * clientSourceRef, which lives in orchestrator.mjs beside the other half of the same guard
 * (orchestrate's own drop of the verdict inputs) so a test can import it — this module starts
 * a server when it loads. */


// WP-001 slice 3 — the other half of persistBuildOutcome: when a build is REFUSED,
// the conversation says so. Silence here is what let a family believe an automation
// existed when the server had declined to create one.
/* ---- WP-006 (ISS-011): ROLE-AWARE PROPOSALS ----
 * The assistant would happily hand a Guest/Helper a full build card — "here's the
 * helper I'll create, confirm?" — and the confirm then 403'd on /api/assistant/build,
 * because creating durable agents is Adult Admin only. A dead card is worse than a
 * refusal: it looks like progress and ends in a wall. So a build proposal aimed at
 * someone who cannot build is demoted, HERE at the single server authority, into a
 * plain answer that says what was understood and who can actually set it up. */
/**
 * Read whatever the user attached and fold it into the turn's context.
 *
 * Mutates `body.context` in place: `attachedFileText` is what the assistant reads, and
 * `attachedFileError` is the honest account when the file can't be read — which the planner
 * prompt is told to relay rather than blaming the attachment feature.
 */
async function attachFileContext(body, session) {
  const fileId = body?.context?.attachedFileId;
  if (!fileId || typeof fileId !== "string") return;
  try {
    const out = await understandFile(fileId, { householdId: session.householdId });
    body.context = { ...body.context };
    if (out.ok) {
      body.context.attachedFileText = out.text;
      body.context.attachedFileKind = out.kind;
      if (out.truncated) body.context.attachedFileTruncated = true;
    } else {
      body.context.attachedFileError = out.message ?? "That file couldn't be read.";
    }
  } catch (e) {
    body.context = { ...body.context, attachedFileError: String(e?.message ?? e) };
  }
}


function publicApproval(a) {
  // NOTE: the approval record deliberately never stores the raw input — only
  // `inputHash` (the consume-once integrity check against whatever input is supplied
  // at execution time). The real, human-readable content lives on the ORIGINATING RUN
  // STEP (see publicRun below) — that's what the client renders for a rich preview.
  return { id: a.id, connectorId: a.connectorId, toolId: a.toolId, status: a.status, risk: a.risk, category: a.category, preview: a.preview, createdAt: a.createdAt, expiresAt: a.expiresAt, decidedBy: a.decidedBy, decidedAt: a.decidedAt,
    requestedBy: a.requestedBy, source: a.source ?? "executable", allowedApproverRoles: a.allowedApproverRoles ?? [], consumedBy: a.consumedBy ?? null };
}
// Runs are the household's own data; the authenticated same-household session sees
// the full durable trace (steps, inputs, results). No cross-household leakage —
// callers always scope by g.session.householdId before calling this.
function publicRun(r) {
  return {
    id: r.id, householdId: r.householdId, actorId: r.actorId, source: r.source, sourceRef: r.sourceRef,
    /* Cluster T — the ledger can only say WHO if the record carries it. Resolved at read
     * time so a renamed agent shows its current name, not a stale copy. */
    agentId: r.agentId ?? null,
    agentName: r.agentId ? (getAgent(r.agentId)?.name ?? null) : null,
    title: r.title, summary: r.summary, status: r.status, cursor: r.cursor, error: r.error,
    createdAt: r.createdAt, updatedAt: r.updatedAt, startedAt: r.startedAt, finishedAt: r.finishedAt,
    steps: (r.steps ?? []).map((s) => ({
      index: s.index, toolId: s.toolId, functionId: s.functionId, title: s.title, detail: s.detail,
      requiresApproval: s.requiresApproval, risk: s.risk, connectorId: s.connectorId, connectorName: s.connectorName,
      attribution: s.attribution, status: s.status, approvalId: s.approvalId, attempts: s.attempts, input: s.input ?? {},
      // WP-003: the truth flags travel to both clients so a skipped step renders as
      // skipped rather than falling into an unknown-status default.
      effectClaimed: !!s.effectClaimed, clampedOut: s.clampedOut ?? null,
      result: s.result ?? null, toolCalls: s.toolCalls ?? [], startedAt: s.startedAt, finishedAt: s.finishedAt,
    })),
  };
}
function approvalErrorMessage(err) {
  const map = {
    approval_not_found: "No matching approval was found.",
    approval_tool_mismatch: "This approval is for a different action.",
    approval_scope_mismatch: "This approval belongs to another household.",
    approval_already_used: "This approval was already used.",
    approval_not_approved: "This action has not been approved.",
    approval_expired: "This approval has expired — request it again.",
    approval_input_changed: "The action details changed after approval — request approval again.",
    approval_not_executable: "This is a sample approval and cannot run a real action.",
    approval_policy_missing: "This approval has no authority policy — request it again.",
    approver_not_allowed: "The person who approved this isn't allowed to approve this action.",
  };
  return map[err] ?? "Approval could not be validated.";
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function htmlMessage(title, body) {
  return `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#f4f0e9;color:#1f2535;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center;max-width:28rem;padding:1rem"><h2>FamiliOS — ${escapeHtml(title)}</h2><p style="color:#4a5568">${escapeHtml(body)}</p></div></body>`;
}

server.listen(PORT, () => {
  seedDefaults();          // ensure a real agent + runnable hybrid skill exist
  // Hosted deployments hand AI keys via env — configure + activate, never overwriting a
  // Settings-made choice (see bootstrapAIFromEnv). ONCE PER HOUSEHOLD: the keys belong to
  // the deployment, so every tenant is entitled to them, and running this bare configured
  // only the resident family — leaving every household that ever signed up with no AI
  // provider and no route to one but pasting a personal API key into Settings. Idempotent,
  // so a family that chose its own provider (or a local Ollama) keeps it.
  void forEachTenant(async (t) => {
    try { const boot = bootstrapAIFromEnv(t); if (boot.length) console.log(`[ai] bootstrapped ${t} from env: ${boot.join(", ")}`); } catch { /* one household must not break the rest */ }
  });
  // Every calendar names its owner (the Connections matrix is keyed on it), and the events
  // it mirrored in say so too. Idempotent — writes only what is missing or wrong — so it
  // simply runs on every boot, once per household like the backfill above.
  void forEachTenant((t) => {
    try { const r = backfillCalendarOwners(t); if (r.subscriptions || r.events) console.log(`[calendar] ${t}: named the owner of ${r.subscriptions} calendar(s), restamped ${r.events} event(s)`); } catch { /* one household must not break the rest */ }
  });
  registerAssistantRunHooks(); // inline chat results + one-shot self-repair for conversation runs
  // A scheduled helper fires through the trigger tick; registering the runner here (rather
  // than importing it there) is what keeps triggers and helpers out of an import cycle.
  setHelperRunner(runHelper);
  registerTriggerRunHooks();   // WP-001: write each run's TERMINAL status back to its trigger
  /* The two halves of the deferred coordination loop, registered rather than imported:
   * coordination.mjs already reads the chat record and the transcript through
   * group-chat.mjs, and sms.mjs is reached from there too, so importing either back would
   * close a cycle. Same reason setHelperRunner exists one line up. */
  setCoordinationOpener(openLoopFromRefusal);
  setLoopReplyHandler(answerLoopReply);
  // Recovery + sweeps + trigger tick run once PER HOUSEHOLD, each inside that
  // household's tenant context — one family's broken state never blocks another's.
  void forEachTenant(() => recoverRuns()); // re-drive any runs that were mid-flight at shutdown
  setInterval(() => { void forEachTenant(() => expireStaleRuns()); }, 60_000); // sweep stale parked runs
  setInterval(() => { void forEachTenant(() => tick()); }, 10_000); // fire due schedule/recurring triggers
  // H5 — task reminders reach the ASSIGNEE's phone, which is why they're swept here rather
  // than scheduled on whichever device happened to create the task. Every 30s so a
  // "15 minutes before" lands within half a minute of the mark.
  setInterval(() => { void forEachTenant(() => sweepTaskReminders()); }, 30_000);
  setInterval(() => { void forEachTenant(() => sweepEventReminders()); }, 30_000);
  /* The passive group-chat listener. Debounce lives as a TIMESTAMP on the chat record, not
   * as a setTimeout, so a deploy does not silently drop every in-flight window — the
   * failure mode of a lost timer here is "the message that never came", which leaves no
   * trace. 60s is generous against a 45s quiet gap.
   *
   * Reentrancy guard, because these two are the first swept work that SENDS: the ladder has
   * none of its own and forEachTenant is serial, so a slow pass must not overlap the next
   * tick. (Expo push gained an 8s deadline in the same change, for the same reason.)
   * Writes nothing when nothing is due — the CI data-isolation gate hashes the live
   * server's data dir and requires it byte-identical while the suite runs beside it. */
  let _groupSweepInFlight = false;
  setInterval(() => {
    if (_groupSweepInFlight) return;
    _groupSweepInFlight = true;
    void sweepGroupTriageAllTenants().finally(() => { _groupSweepInFlight = false; });
  }, 60_000);
  setInterval(() => { void forEachTenant(() => pruneChatDecisions()); }, 60 * 60_000);
  /* Deferred coordination loops. Same reentrancy guard and the same never-write-when-idle
   * rule: this one sends a private message to a person, so a pass that overlapped itself
   * would be a second nudge about someone's health. The record is stamped before the send
   * for the same reason a reminder is. */
  let _loopSweepInFlight = false;
  setInterval(() => {
    if (_loopSweepInFlight) return;
    _loopSweepInFlight = true;
    void sweepCoordinationLoopsAllTenants().finally(() => { _loopSweepInFlight = false; });
  }, 60_000);
  // Archive is cheap and slow-moving; hourly is generous. First pass shortly after boot so
  // a long-stopped server catches up without waiting an hour.
  setInterval(() => { void forEachTenant(() => sweepTaskArchive()); }, 60 * 60_000);
  setTimeout(() => { void forEachTenant(() => sweepTaskArchive()); }, 20_000);
  // Connection health, on a timer — see accounts.mjs sweepAccountHealth. Without this, an
  // account's status describes the last thing that happened to touch it rather than what the
  // credential can do now, which is how "needs reconnect" outlived the problem it named.
  // Every 5 minutes; each account is throttled to one real probe per 15.
  /* forEachTenant hands the callback the household it is running as. This one ignored it and
   * passed the RESIDENT constant every iteration — so the loop faithfully visited every
   * household and swept the same one N times. For every signed-up family, an account's status
   * therefore went on describing the last thing that happened to touch it: precisely the
   * "needs reconnect" that outlives the problem it names, which is the bug accounts.mjs
   * sweepAccountHealth exists to prevent. */
  setInterval(() => { void forEachTenant((t) => sweepAccountHealth({ householdId: t })); }, 5 * 60_000);
  // Calendar auto-sync: re-pull url/google subscriptions that have gone stale so linked
  // events stay fresh without a manual "Sync now". Pasted imports are static — skipped.
  // Staleness window via HOMEOPS_CAL_SYNC_MINUTES (default 6h); swept every 15 minutes.
  // The staleness check still decides WHICH households are due; the refresh itself is the one
  // engine every other door uses (calendar-refresh.mjs) — each calendar synced as its owner,
  // single-flight with any refresh a member's app already started, audited only on change.
  // A slow sweep (many households, a Google that answers slowly) never overlaps the next.
  const calSyncMs = Math.max(5, parseInt(process.env.HOMEOPS_CAL_SYNC_MINUTES ?? "360", 10) || 360) * 60_000;
  let _calSweepInFlight = false;
  setInterval(() => {
    if (_calSweepInFlight) return;
    _calSweepInFlight = true;
    void forEachTenant(async () => {
      const due = new Set(listSubscriptions((s) => s.source !== "import" && (Date.now() - (s.lastSyncAt ?? 0)) > calSyncMs).map((s) => s.householdId));
      for (const hh of due) {
        try { await refreshHouseholdCalendars(hh, { reason: "sweep" }); } catch { /* one household must not stop the sweep */ }
      }
      // Two-way Google sweep (opt-in via Settings → calendar auto-sync): server-triggered,
      // no approvals — pull Google-side edits into pushed events AND push local edits back,
      // so both calendars mirror each other without anyone opening the app. Conflicts
      // (both sides changed) still flag for human review — auto-sync never clobbers. Once
      // per HOUSEHOLD now: each event goes through the account it lives in (calendar.mjs).
      const googleHouseholds = new Set(listSubscriptions((s) => s.source === "google").map((s) => s.householdId));
      for (const hh of googleHouseholds) {
        // Auto-sync is a per-household opt-in — gate on THAT household.
        if (getSettings(hh).calendarAutoSync !== true || !externalActionsEnabled(hh)) continue;
        try {
          const r = await runWithTenant(hh, () => autoSyncGoogle({ householdId: hh }));
          runWithTenant(hh, () => appendAudit({ type: "calendar.auto_two_way", householdId: hh, ok: true, merged: r.pull?.merged ?? 0, conflicts: r.pull?.conflicts ?? 0, pushed: r.pushed, pushErrors: r.pushErrors, pushSkipped: r.pushSkipped }));
        } catch { /* one household must not stop the sweep */ }
      }
    }).finally(() => { _calSweepInFlight = false; });
  }, 15 * 60_000);
  startScheduler();
  /* Move each household's connector secrets onto its OWN derived vault key (see store.mjs).
   *
   * Deferred and unref'd for the same reason the backup tick is: a first pass rewrites
   * connectors.json for every tenant, and doing that while the process is still opening those
   * same SQLite files is how the concurrent suite went flaky on Windows once already.
   *
   * Idempotent — a blob already on v2 is skipped — so it costs one read per household per boot
   * after the first, and a blob that won't decrypt is left exactly as found rather than
   * replaced. Failing here must never cost a family their Google connection. */
  setTimeout(() => {
    void forEachTenant((t) => {
      try {
        const moved = migrateVaultToTenantKeys();
        if (moved) appendAudit({ type: "vault.rekeyed", secrets: moved, householdId: t });
      } catch { /* the old key still decrypts; nothing is lost by trying again next boot */ }
    });
  }, 45_000).unref?.();
  // Probe the browser runtime once at boot (in-process Playwright first, then
  // any external BROWSER_RUNTIME_URL) so the connector's readiness — and the
  // /api/health browserRuntime flag — reflect reality from the start.
  healthCheck("browser").catch(() => {});
  // Nightly household backup (+ weekly Owner notice), piggybacked on a light timer.
  // Once per household, in that household's own tenant context — the snapshot, the 24h
  // cadence stamp, and the weekly Owner notice are all per-family now. Previously this ran
  // bare, so it took ONE all-tenant snapshot and only ever told the resident Owner.
  setInterval(() => { void forEachTenant((t) => backupTick(t)); }, 30 * 60_000);
  // Deliberately NOT at boot. A first tick exports every tenant's whole database, and doing
  // that while the process is still coming up competes for the same SQLite files the server
  // is opening — on Windows that surfaces as a transient `disk I/O error`, and it made a
  // concurrent test suite flaky. A minute's delay keeps the "a server that restarts often
  // still gets its nightly snapshot" guarantee and removes the startup contention. Unref'd
  // so it never holds the process open.
  /* Ten minutes, not one. The delay exists to avoid startup contention, and 60s did that
   * — but it also lands squarely inside the window the CI `data-isolation` job measures.
   * That job boots a real server on server/.data, hashes the directory, runs the whole
   * suite beside it and requires the directory byte-identical afterwards. On a fresh data
   * dir `lastBackupAt` is 0, so the first tick RUNS: it writes a backup file (a new line in
   * the find listing), an audit row, and churns the WAL. Verified by booting HEAD with no
   * suite running at all and watching the gate go red on its own at T+60s.
   *
   * The suite takes around 66 seconds, so the gate could only ever pass by finishing inside
   * ~58 — a coin flip dressed as a check, and a gate that goes red for reasons nobody caused
   * is a gate people learn to ignore. Ten minutes keeps the guarantee the comment below
   * cares about (a server that restarts often still gets its snapshot) and takes the first
   * tick out of the measured window entirely. */
  setTimeout(() => { void forEachTenant((t) => backupTick(t)); }, 10 * 60_000).unref?.();
  // eslint-disable-next-line no-console
  // Report the ACTUAL bound port (PORT=0 asks the OS for a free one — the test
  // harness relies on this line to learn where the server landed).
  const boundPort = server.address()?.port ?? PORT;
  console.log(`FamiliOS backend (control plane v${VERSION}) listening on http://localhost:${boundPort} — env=${IS_PROD ? "production" : "development"}, origins=${ALLOWED_ORIGINS.join(",") || "(none)"}`);

  // Graceful shutdown: deploys used to hard-kill mid-run ("interrupted" failures).
  // Now: refuse new runs, hand every lease back cleanly (recovery re-drives on the
  // next boot), close Chromium, and exit before the platform's SIGKILL deadline.
  let shuttingDown = false;
  const shutdown = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      setDraining(true);
      const released = releaseAllLeases();
      appendAudit({ type: "server.shutdown", signal: sig, leasesReleased: released });
    } catch { /* never block exit */ }
    void closeBrowser().catch(() => {}).finally(() => process.exit(0));
    // Hard floor: exit even if the browser hangs.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => shutdown(sig));
});
